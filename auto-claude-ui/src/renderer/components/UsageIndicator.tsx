/**
 * Usage Indicator - Real-time Claude usage display in header
 *
 * Displays current session/weekly usage as a badge with color-coded status.
 * Click to manually refresh. Shows detailed breakdown on hover.
 * Works with either OAuth API or local file analysis (fallback).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Activity, TrendingUp, AlertCircle, RefreshCw } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './ui/tooltip';
import type { ClaudeUsageSnapshot } from '../../shared/types/agent';

interface UsageIndicatorProps {
  onOpenSettings?: () => void;
}

/**
 * Format token count to human-readable string (e.g., "1.2M", "450K")
 */
function formatTokenCount(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(0)}K`;
  }
  return tokens.toString();
}

export function UsageIndicator({ onOpenSettings }: UsageIndicatorProps) {
  const [usage, setUsage] = useState<ClaudeUsageSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;

    setIsRefreshing(true);
    try {
      const result = await window.electronAPI.forceUsageRefresh();
      if (result.success && result.data) {
        setUsage(result.data);
      }
    } catch (error) {
      console.error('[UsageIndicator] Refresh failed:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing]);

  useEffect(() => {
    // Listen for usage updates from main process
    const unsubscribe = window.electronAPI.onUsageUpdated((snapshot: ClaudeUsageSnapshot) => {
      setUsage(snapshot);
      setIsLoading(false);
    });

    // Request initial usage on mount
    window.electronAPI.requestUsageUpdate().then((result) => {
      if (result.success && result.data) {
        setUsage(result.data);
      }
      setIsLoading(false);
    }).catch(() => {
      setIsLoading(false);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Still loading
  if (isLoading) {
    return (
      <button
        disabled
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-muted-foreground bg-card/80 backdrop-blur-sm border-border opacity-50 shadow-sm"
        aria-label="Loading usage data"
      >
        <RefreshCw className="h-3.5 w-3.5 animate-spin shrink-0" />
        <span className="text-xs text-muted-foreground">Loading...</span>
      </button>
    );
  }

  // No usage data available - show refresh button
  if (!usage) {
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border transition-all hover:opacity-80 hover:shadow-md active:scale-95 text-muted-foreground bg-card/80 backdrop-blur-sm border-border shadow-sm ${isRefreshing ? 'opacity-70' : ''}`}
              aria-label="Refresh usage data"
            >
              <RefreshCw className={`h-3.5 w-3.5 shrink-0 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span className="text-sm font-semibold font-mono">--%</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs max-w-[200px]">
            <p>Click to calculate usage from local conversation files</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Determine color based on highest usage percentage
  const maxUsage = Math.max(usage.sessionPercent, usage.weeklyPercent);

  const colorClasses =
    maxUsage >= 95 ? 'bg-red-500/10 border-red-500/30 text-red-500' :
    maxUsage >= 91 ? 'bg-orange-500/10 border-orange-500/30 text-orange-500' :
    maxUsage >= 71 ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-500' :
    'bg-green-500/10 border-green-500/30 text-green-500';

  // Show spinning refresh icon during refresh, otherwise show status icon
  const StatusIcon = isRefreshing ? RefreshCw :
    maxUsage >= 91 ? AlertCircle :
    maxUsage >= 71 ? TrendingUp :
    Activity;

  // Determine which period to show (the one with higher usage)
  const periodLabel = usage.sessionPercent >= usage.weeklyPercent ? '5h' : '7d';
  const displayPercent = Math.round(Math.max(usage.sessionPercent, usage.weeklyPercent));

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border bg-card/80 backdrop-blur-sm hover:shadow-sm transition-all ${colorClasses} ${isRefreshing ? 'opacity-70' : ''}`}
            aria-label="Claude usage status - click to refresh"
          >
            <StatusIcon className={`h-3.5 w-3.5 shrink-0 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span className="text-sm font-semibold font-mono tabular-nums">{displayPercent}%</span>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{periodLabel}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs w-72">
          <div className="space-y-2">
            {/* Estimated indicator */}
            {usage.isEstimated && (
              <>
                <div className="text-[10px] text-muted-foreground italic text-center">
                  Estimated from local conversation files
                </div>
                <div className="h-px bg-border" />
              </>
            )}

            {/* Session usage */}
            <div>
              <div className="flex items-center justify-between gap-4 mb-1">
                <span className="text-muted-foreground font-medium">Session Usage (5h)</span>
                <div className="flex items-center gap-2">
                  {usage.sessionTokens !== undefined && (
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {formatTokenCount(usage.sessionTokens)} tokens
                    </span>
                  )}
                  <span className="font-semibold tabular-nums">~{Math.round(usage.sessionPercent)}%</span>
                </div>
              </div>
              {usage.sessionResetTime && (
                <div className="text-[10px] text-muted-foreground">
                  Resets: {usage.sessionResetTime}
                </div>
              )}
              {/* Progress bar */}
              <div className="mt-1.5 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    usage.sessionPercent >= 95 ? 'bg-red-500' :
                    usage.sessionPercent >= 91 ? 'bg-orange-500' :
                    usage.sessionPercent >= 71 ? 'bg-yellow-500' :
                    'bg-green-500'
                  }`}
                  style={{ width: `${Math.min(usage.sessionPercent, 100)}%` }}
                />
              </div>
            </div>

            <div className="h-px bg-border" />

            {/* Weekly usage */}
            <div>
              <div className="flex items-center justify-between gap-4 mb-1">
                <span className="text-muted-foreground font-medium">Weekly Usage (7d)</span>
                <div className="flex items-center gap-2">
                  {usage.weeklyTokens !== undefined && (
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {formatTokenCount(usage.weeklyTokens)} tokens
                    </span>
                  )}
                  <span className="font-semibold tabular-nums">~{Math.round(usage.weeklyPercent)}%</span>
                </div>
              </div>
              {usage.weeklyResetTime && (
                <div className="text-[10px] text-muted-foreground">
                  Resets: {usage.weeklyResetTime}
                </div>
              )}
              {/* Progress bar */}
              <div className="mt-1.5 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    usage.weeklyPercent >= 99 ? 'bg-red-500' :
                    usage.weeklyPercent >= 91 ? 'bg-orange-500' :
                    usage.weeklyPercent >= 71 ? 'bg-yellow-500' :
                    'bg-green-500'
                  }`}
                  style={{ width: `${Math.min(usage.weeklyPercent, 100)}%` }}
                />
              </div>
            </div>

            <div className="h-px bg-border" />

            {/* Active profile */}
            <div className="flex items-center justify-between gap-4 pt-1">
              <span className="text-muted-foreground text-[10px] uppercase tracking-wide">Active Account</span>
              <span className="font-semibold text-primary">{usage.profileName}</span>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}