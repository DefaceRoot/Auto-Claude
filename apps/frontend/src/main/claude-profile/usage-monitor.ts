/**
 * Usage Monitor - Real-time usage tracking and proactive account switching
 *
 * Monitors Claude account usage at configured intervals (default: 10s).
 * The usage indicator is ALWAYS visible when an OAuth token is configured.
 * Auto-switching to alternative accounts is optional (disabled by default).
 *
 * Uses hybrid approach:
 * 1. Primary: Direct OAuth API (https://api.anthropic.com/api/oauth/usage)
 * 2. Fallback: Local JSONL file analysis (like ccusage)
 */

import { EventEmitter } from 'events';
import { getClaudeProfileManager } from '../claude-profile-manager';
import { ClaudeUsageSnapshot } from '../../shared/types/agent';
import { calculateLocalUsage, calculateLocalUsageWithLimits } from './local-usage-calculator';

export class UsageMonitor extends EventEmitter {
  private static instance: UsageMonitor;
  private intervalId: NodeJS.Timeout | null = null;
  private currentUsage: ClaudeUsageSnapshot | null = null;
  private isChecking = false;
  private useApiMethod = true; // Try API first, fall back to CLI if it fails

  private constructor() {
    super();
    console.warn('[UsageMonitor] Initialized');
  }

  static getInstance(): UsageMonitor {
    if (!UsageMonitor.instance) {
      UsageMonitor.instance = new UsageMonitor();
    }
    return UsageMonitor.instance;
  }

  /**
   * Start monitoring usage at configured interval.
   * Works with either OAuth token (API) or local file analysis (fallback).
   * Auto-switch threshold checking only runs if proactiveSwapEnabled is true.
   */
  start(): void {
    const profileManager = getClaudeProfileManager();
    const settings = profileManager.getAutoSwitchSettings();

    if (this.intervalId) {
      console.warn('[UsageMonitor] Already running');
      return;
    }

    // Use configured interval, default to 10 seconds
    const interval = settings.usageCheckInterval || 10000;
    console.warn('[UsageMonitor] Starting with interval:', interval, 'ms');
    console.warn('[UsageMonitor] Will use API if token available, otherwise local file analysis');

    // Check immediately
    this.checkUsageAndSwap();

    // Then check periodically
    this.intervalId = setInterval(() => {
      this.checkUsageAndSwap();
    }, interval);
  }

  /**
   * Force an immediate usage refresh
   * Returns the updated usage snapshot
   */
  async forceRefresh(): Promise<ClaudeUsageSnapshot | null> {
    console.warn('[UsageMonitor] Force refresh requested');

    const profileManager = getClaudeProfileManager();
    const activeProfile = profileManager.getActiveProfile();

    if (!activeProfile) {
      console.warn('[UsageMonitor] No active profile for force refresh');
      return null;
    }

    const decryptedToken = profileManager.getProfileToken(activeProfile.id);
    console.warn('[UsageMonitor] Token status:', {
      profileId: activeProfile.id,
      hasToken: !!decryptedToken,
      tokenLength: decryptedToken?.length ?? 0
    });

    // Reset API method flag on force refresh - always try API first if we have a token
    if (decryptedToken) {
      this.useApiMethod = true;
    }

    // fetchUsage will try API first (if token), then fall back to local files
    const usage = await this.fetchUsage(activeProfile.id, decryptedToken);
    if (usage) {
      this.currentUsage = usage;
      this.emit('usage-updated', usage);
    }
    return usage;
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.warn('[UsageMonitor] Stopped');
    }
  }

  /**
   * Get current usage snapshot (for UI indicator)
   */
  getCurrentUsage(): ClaudeUsageSnapshot | null {
    return this.currentUsage;
  }

  /**
   * Check usage and trigger swap if thresholds exceeded
   */
  private async checkUsageAndSwap(): Promise<void> {
    if (this.isChecking) {
      return; // Prevent concurrent checks
    }

    this.isChecking = true;

    try {
      const profileManager = getClaudeProfileManager();
      const activeProfile = profileManager.getActiveProfile();

      if (!activeProfile) {
        console.warn('[UsageMonitor] No active profile');
        return;
      }

      // Fetch current usage (hybrid approach)
      // Get decrypted token from ProfileManager (activeProfile.oauthToken is encrypted)
      const decryptedToken = profileManager.getProfileToken(activeProfile.id);
      const usage = await this.fetchUsage(activeProfile.id, decryptedToken ?? undefined);
      if (!usage) {
        console.warn('[UsageMonitor] Failed to fetch usage');
        return;
      }

      this.currentUsage = usage;

      // Emit usage update for UI (always)
      this.emit('usage-updated', usage);

      // Only check thresholds and perform auto-switch if enabled
      const settings = profileManager.getAutoSwitchSettings();
      if (settings.enabled && settings.proactiveSwapEnabled) {
        const sessionExceeded = usage.sessionPercent >= settings.sessionThreshold;
        const weeklyExceeded = usage.weeklyPercent >= settings.weeklyThreshold;

        if (sessionExceeded || weeklyExceeded) {
          console.warn('[UsageMonitor] Threshold exceeded:', {
            sessionPercent: usage.sessionPercent,
            sessionThreshold: settings.sessionThreshold,
            weeklyPercent: usage.weeklyPercent,
            weeklyThreshold: settings.weeklyThreshold
          });

          // Attempt proactive swap
          await this.performProactiveSwap(
            activeProfile.id,
            sessionExceeded ? 'session' : 'weekly'
          );
        }
      }
    } catch (error) {
      console.error('[UsageMonitor] Check failed:', error);
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Fetch usage - HYBRID APPROACH
   * Tries API first, falls back to CLI if API fails
   */
  private async fetchUsage(
    profileId: string,
    oauthToken?: string
  ): Promise<ClaudeUsageSnapshot | null> {
    const profileManager = getClaudeProfileManager();
    const profile = profileManager.getProfile(profileId);
    if (!profile) {
      console.warn('[UsageMonitor] Profile not found:', profileId);
      return null;
    }

    // Attempt 1: Direct API call (preferred)
    if (this.useApiMethod && oauthToken) {
      console.warn('[UsageMonitor] Attempting API fetch with token length:', oauthToken.length);
      const apiUsage = await this.fetchUsageViaAPI(oauthToken, profileId, profile.name);
      if (apiUsage) {
        console.warn('[UsageMonitor] Successfully fetched via API');
        return apiUsage;
      }

      // API failed - switch to CLI method for future calls
      console.warn('[UsageMonitor] API method failed, falling back to CLI');
      this.useApiMethod = false;
    } else {
      // Log why we're skipping API
      if (!this.useApiMethod) {
        console.warn('[UsageMonitor] Skipping API (disabled from previous failure)');
      }
      if (!oauthToken) {
        console.warn('[UsageMonitor] Skipping API (no token provided)');
      }
    }

    // Attempt 2: Local file analysis (fallback)
    return await this.fetchUsageViaLocalFiles(profileId, profile.name);
  }

  /**
   * Fetch usage via OAuth API endpoint
   * Endpoint: https://api.anthropic.com/api/oauth/usage
   */
  private async fetchUsageViaAPI(
    oauthToken: string,
    profileId: string,
    profileName: string
  ): Promise<ClaudeUsageSnapshot | null> {
    try {
      console.warn('[UsageMonitor] Calling API: https://api.anthropic.com/api/oauth/usage');
      const response = await fetch('https://api.anthropic.com/api/oauth/usage', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${oauthToken}`,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01'
        }
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'Unable to read response body');
        console.error('[UsageMonitor] API error:', {
          status: response.status,
          statusText: response.statusText,
          body: errorBody
        });
        return null;
      }

      const data = await response.json() as {
        five_hour_utilization?: number;
        seven_day_utilization?: number;
        five_hour_reset_at?: string;
        seven_day_reset_at?: string;
      };

      // Expected response format:
      // {
      //   "five_hour_utilization": 0.72,  // 0.0-1.0
      //   "seven_day_utilization": 0.45,  // 0.0-1.0
      //   "five_hour_reset_at": "2025-01-17T15:00:00Z",
      //   "seven_day_reset_at": "2025-01-20T12:00:00Z"
      // }

      const sessionPercent = Math.round((data.five_hour_utilization || 0) * 100);
      const weeklyPercent = Math.round((data.seven_day_utilization || 0) * 100);

      // CALIBRATION: Get local usage data to learn actual limits
      if (sessionPercent > 5 || weeklyPercent > 5) {  // Only calibrate if there's meaningful usage
        const localUsage = await calculateLocalUsage();
        if (localUsage && (localUsage.sessionUsage.costUSD > 0 || localUsage.weeklyUsage.costUSD > 0)) {
          const profileManager = getClaudeProfileManager();

          // Only calibrate if percentages are significantly different from estimates
          // This prevents calibration from running when estimates are already close
          const estimatedSessionPercent = Math.round((localUsage.sessionUsage.costUSD / 0.85) * 100);
          const estimatedWeeklyPercent = Math.round((localUsage.weeklyUsage.costUSD / 28.0) * 100);

          const sessionDiff = Math.abs(sessionPercent - estimatedSessionPercent);
          const weeklyDiff = Math.abs(weeklyPercent - estimatedWeeklyPercent);

          if (sessionDiff > 10 || weeklyDiff > 10) {  // More than 10% difference
            console.warn('[UsageMonitor] Calibrating limits - estimates are off by:', {
              sessionDiff,
              weeklyDiff,
              apiSession: sessionPercent,
              apiWeekly: weeklyPercent,
              localSessionCost: localUsage.sessionUsage.costUSD.toFixed(4),
              localWeeklyCost: localUsage.weeklyUsage.costUSD.toFixed(4)
            });

            profileManager.updateUsageCalibration(
              profileId,
              localUsage.sessionUsage.costUSD,
              sessionPercent,
              localUsage.weeklyUsage.costUSD,
              weeklyPercent
            );
          }
        }
      }

      return {
        sessionPercent,
        weeklyPercent,
        sessionResetTime: this.formatResetTime(data.five_hour_reset_at),
        weeklyResetTime: this.formatResetTime(data.seven_day_reset_at),
        profileId,
        profileName,
        fetchedAt: new Date(),
        limitType: (data.seven_day_utilization || 0) > (data.five_hour_utilization || 0)
          ? 'weekly'
          : 'session'
      };
    } catch (error) {
      console.error('[UsageMonitor] API fetch failed:', error);
      return null;
    }
  }

  /**
   * Fetch usage via local JSONL file analysis (fallback)
   * Reads Claude Code's conversation logs and calculates token usage,
   * similar to how ccusage works (https://github.com/ryoppippi/ccusage).
   */
  private async fetchUsageViaLocalFiles(
    profileId: string,
    profileName: string
  ): Promise<ClaudeUsageSnapshot | null> {
    try {
      console.warn('[UsageMonitor] Attempting local file-based usage calculation');

      const profileManager = getClaudeProfileManager();
      const calibratedLimits = profileManager.getCalibratedLimits(profileId);

      console.warn('[UsageMonitor] Using calibrated limits:', {
        profileId,
        sessionLimit: calibratedLimits.sessionCostUSD.toFixed(2),
        weeklyLimit: calibratedLimits.weeklyCostUSD.toFixed(2),
        source: profileManager.getProfile(profileId)?.usageCalibration?.sampleCount
          ? `calibrated (${profileManager.getProfile(profileId)!.usageCalibration!.sampleCount} samples)`
          : 'conservative estimate'
      });

      const localUsage = await calculateLocalUsageWithLimits(
        calibratedLimits.sessionCostUSD,
        calibratedLimits.weeklyCostUSD
      );

      if (!localUsage) {
        console.warn('[UsageMonitor] Local usage calculation returned null');
        return null;
      }

      return {
        sessionPercent: localUsage.sessionPercent,
        weeklyPercent: localUsage.weeklyPercent,
        sessionResetTime: localUsage.sessionResetTime,
        weeklyResetTime: localUsage.weeklyResetTime,
        profileId,
        profileName,
        fetchedAt: localUsage.fetchedAt,
        limitType: localUsage.weeklyPercent > localUsage.sessionPercent ? 'weekly' : 'session',
        sessionTokens: localUsage.sessionUsage.totalTokens,
        weeklyTokens: localUsage.weeklyUsage.totalTokens,
        isEstimated: true  // Still marked as estimated since we're using local files
      };
    } catch (error) {
      console.error('[UsageMonitor] Local file analysis failed:', error);
      return null;
    }
  }

  /**
   * Format ISO timestamp to human-readable reset time
   */
  private formatResetTime(isoTimestamp?: string): string {
    if (!isoTimestamp) return 'Unknown';

    try {
      const date = new Date(isoTimestamp);
      const now = new Date();
      const diffMs = date.getTime() - now.getTime();
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

      if (diffHours < 24) {
        return `${diffHours}h ${diffMins}m`;
      }

      const diffDays = Math.floor(diffHours / 24);
      const remainingHours = diffHours % 24;
      return `${diffDays}d ${remainingHours}h`;
    } catch (_error) {
      return isoTimestamp;
    }
  }

  /**
   * Perform proactive profile swap
   */
  private async performProactiveSwap(
    currentProfileId: string,
    limitType: 'session' | 'weekly'
  ): Promise<void> {
    const profileManager = getClaudeProfileManager();
    const bestProfile = profileManager.getBestAvailableProfile(currentProfileId);

    if (!bestProfile) {
      console.warn('[UsageMonitor] No alternative profile for proactive swap');
      this.emit('proactive-swap-failed', {
        reason: 'no_alternative',
        currentProfile: currentProfileId
      });
      return;
    }

    console.warn('[UsageMonitor] Proactive swap:', {
      from: currentProfileId,
      to: bestProfile.id,
      reason: limitType
    });

    // Switch profile
    profileManager.setActiveProfile(bestProfile.id);

    // Emit swap event
    this.emit('proactive-swap-completed', {
      fromProfile: { id: currentProfileId, name: profileManager.getProfile(currentProfileId)?.name },
      toProfile: { id: bestProfile.id, name: bestProfile.name },
      limitType,
      timestamp: new Date()
    });

    // Notify UI
    this.emit('show-swap-notification', {
      fromProfile: profileManager.getProfile(currentProfileId)?.name,
      toProfile: bestProfile.name,
      reason: 'proactive',
      limitType
    });

    // Note: Don't immediately check new profile - let normal interval handle it
    // This prevents cascading swaps if multiple profiles are near limits
  }
}

/**
 * Get the singleton UsageMonitor instance
 */
export function getUsageMonitor(): UsageMonitor {
  return UsageMonitor.getInstance();
}
