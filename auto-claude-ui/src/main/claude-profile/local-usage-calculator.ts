/**
 * Local Usage Calculator
 * Reads Claude Code's JSONL conversation files to calculate token usage.
 * Similar approach to ccusage (https://github.com/ryoppippi/ccusage)
 */

import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';

/**
 * Token usage from a single message/event
 */
interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/**
 * Parsed JSONL event
 */
interface ClaudeEvent {
  timestamp?: string | number;
  time?: string | number;
  createdAt?: string | number;
  created_at?: string | number;
  message?: {
    role?: string;
    usage?: TokenUsage;
  };
  usage?: TokenUsage;
  costUSD?: number;
  isSidechain?: boolean;
}

/**
 * Aggregated usage for a time window
 */
export interface AggregatedUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  costUSD: number;
  eventCount: number;
  oldestEvent: Date | null;
  newestEvent: Date | null;
}

/**
 * Usage snapshot with estimated percentages
 */
export interface LocalUsageSnapshot {
  sessionUsage: AggregatedUsage;  // Last 5 hours
  weeklyUsage: AggregatedUsage;   // Last 7 days
  sessionPercent: number;         // Estimated based on assumed limits
  weeklyPercent: number;          // Estimated based on assumed limits
  sessionResetTime: string;
  weeklyResetTime: string;
  fetchedAt: Date;
}

// Estimated limits for Claude Pro (these are rough estimates)
// Claude doesn't publish exact limits, but based on community observations:
// Session limit ~500k-1M tokens per 5 hours
// Weekly limit ~5-10M tokens per 7 days
const ESTIMATED_SESSION_LIMIT = 750000; // 750k tokens per 5 hours (conservative estimate)
const ESTIMATED_WEEKLY_LIMIT = 7500000; // 7.5M tokens per 7 days (conservative estimate)

/**
 * Get Claude project directories (both legacy and new paths)
 */
function getClaudeProjectDirs(): string[] {
  const home = homedir();
  const dirs: string[] = [];

  // New path (primary)
  const newPath = join(home, '.config', 'claude', 'projects');
  if (existsSync(newPath)) {
    dirs.push(newPath);
  }

  // Legacy path
  const legacyPath = join(home, '.claude', 'projects');
  if (existsSync(legacyPath) && legacyPath !== newPath) {
    dirs.push(legacyPath);
  }

  return dirs;
}

/**
 * Find all JSONL files in Claude project directories
 */
function findJsonlFiles(projectDirs: string[]): string[] {
  const files: string[] = [];

  for (const projectDir of projectDirs) {
    try {
      const entries = readdirSync(projectDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          // Each subdirectory is a project - look for JSONL files inside
          const subdir = join(projectDir, entry.name);
          try {
            const subEntries = readdirSync(subdir);
            for (const subEntry of subEntries) {
              if (subEntry.endsWith('.jsonl')) {
                files.push(join(subdir, subEntry));
              }
            }
          } catch {
            // Skip inaccessible directories
          }
        } else if (entry.name.endsWith('.jsonl')) {
          files.push(join(projectDir, entry.name));
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  return files;
}

/**
 * Parse a single line of JSONL
 */
function parseJsonlLine(line: string): ClaudeEvent | null {
  try {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('{')) {
      return null;
    }
    return JSON.parse(trimmed) as ClaudeEvent;
  } catch {
    return null;
  }
}

/**
 * Extract token usage from an event
 */
function extractUsage(event: ClaudeEvent): TokenUsage | null {
  // Skip sidechain events (parallel agent tasks)
  if (event.isSidechain) {
    return null;
  }

  // Try message.usage first (standard format)
  if (event.message?.usage) {
    return event.message.usage;
  }

  // Try top-level usage
  if (event.usage) {
    return event.usage;
  }

  return null;
}

/**
 * Create an empty aggregated usage object
 */
function createEmptyAggregation(): AggregatedUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    costUSD: 0,
    eventCount: 0,
    oldestEvent: null,
    newestEvent: null,
  };
}

/**
 * Add usage to an aggregation
 */
function addToAggregation(
  agg: AggregatedUsage,
  usage: TokenUsage,
  timestamp: Date,
  costUSD?: number
): void {
  agg.inputTokens += usage.input_tokens || 0;
  agg.outputTokens += usage.output_tokens || 0;
  agg.cacheCreationTokens += usage.cache_creation_input_tokens || 0;
  agg.cacheReadTokens += usage.cache_read_input_tokens || 0;
  agg.totalTokens +=
    (usage.input_tokens || 0) +
    (usage.output_tokens || 0) +
    (usage.cache_creation_input_tokens || 0) +
    (usage.cache_read_input_tokens || 0);
  agg.costUSD += costUSD || 0;
  agg.eventCount++;

  if (!agg.oldestEvent || timestamp < agg.oldestEvent) {
    agg.oldestEvent = timestamp;
  }
  if (!agg.newestEvent || timestamp > agg.newestEvent) {
    agg.newestEvent = timestamp;
  }
}

/**
 * Format a duration in milliseconds to a human-readable string
 */
function formatDuration(ms: number): string {
  if (ms <= 0) return '0m';

  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h`;
  }

  return `${hours}h ${minutes}m`;
}

/**
 * Calculate usage from local JSONL files
 * @param sessionHours Hours to look back for session usage (default: 5)
 * @param weeklyDays Days to look back for weekly usage (default: 7)
 */
export async function calculateLocalUsage(
  sessionHours: number = 5,
  weeklyDays: number = 7
): Promise<LocalUsageSnapshot | null> {
  const projectDirs = getClaudeProjectDirs();

  if (projectDirs.length === 0) {
    console.warn('[LocalUsageCalculator] No Claude project directories found');
    return null;
  }

  const jsonlFiles = findJsonlFiles(projectDirs);

  if (jsonlFiles.length === 0) {
    console.warn('[LocalUsageCalculator] No JSONL files found');
    return null;
  }

  console.warn('[LocalUsageCalculator] Found', jsonlFiles.length, 'JSONL files');

  const now = new Date();
  const sessionCutoff = new Date(now.getTime() - sessionHours * 60 * 60 * 1000);
  const weeklyCutoff = new Date(now.getTime() - weeklyDays * 24 * 60 * 60 * 1000);

  console.warn('[LocalUsageCalculator] Time windows:', {
    now: now.toISOString(),
    sessionCutoff: sessionCutoff.toISOString(),
    weeklyCutoff: weeklyCutoff.toISOString()
  });

  const sessionUsage = createEmptyAggregation();
  const weeklyUsage = createEmptyAggregation();

  let totalEventsProcessed = 0;
  let eventsSkippedOld = 0;
  let eventsSkippedNoUsage = 0;
  let eventsSkippedNoTimestamp = 0;
  let sampleEventLogged = false;

  // Process each file - check timestamps inside, not file mtime
  // (file mtime can be updated by file system operations without content changes)
  for (const file of jsonlFiles) {
    try {
      // Read file line by line
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      for (const line of lines) {
        const event = parseJsonlLine(line);
        if (!event) continue;

        totalEventsProcessed++;

        // Log a sample event to understand the structure
        if (!sampleEventLogged && (event.usage || event.message?.usage)) {
          sampleEventLogged = true;
          console.warn('[LocalUsageCalculator] Sample event structure:', {
            hasTimestamp: !!event.timestamp,
            hasTime: !!(event as any).time,
            hasCreatedAt: !!(event as any).createdAt,
            timestampValue: event.timestamp,
            timestampType: typeof event.timestamp,
            keys: Object.keys(event).slice(0, 10), // First 10 keys
          });
        }

        // Parse timestamp - try multiple field names and formats
        let timestamp: Date | null = null;
        const tsValue = event.timestamp || event.time || event.createdAt || event.created_at;

        if (tsValue) {
          // Handle ISO string
          if (typeof tsValue === 'string') {
            timestamp = new Date(tsValue);
          }
          // Handle numeric timestamp (milliseconds or seconds)
          else if (typeof tsValue === 'number') {
            // If timestamp is in seconds (< year 2100 in ms), convert to ms
            if (tsValue < 4102444800000) {
              timestamp = new Date(tsValue < 4102444800 ? tsValue * 1000 : tsValue);
            } else {
              timestamp = new Date(tsValue);
            }
          }

          // Validate timestamp
          if (timestamp && isNaN(timestamp.getTime())) {
            timestamp = null;
          }
        }

        if (!timestamp) {
          eventsSkippedNoTimestamp++;
          continue;
        }

        // STRICT time filtering - skip events outside weekly window
        if (timestamp < weeklyCutoff) {
          eventsSkippedOld++;
          continue;
        }

        // Extract usage
        const usage = extractUsage(event);
        if (!usage) {
          eventsSkippedNoUsage++;
          continue;
        }

        // Only count input_tokens and output_tokens (NOT cache tokens)
        // Cache tokens represent context size, not actual rate-limited usage
        // Also, cache tokens can be massive (100K+) which would massively inflate usage
        const actualUsage: TokenUsage = {
          input_tokens: usage.input_tokens || 0,
          output_tokens: usage.output_tokens || 0,
          // Don't count cache tokens - they don't count against rate limits the same way
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        };

        const totalTokensInEvent = actualUsage.input_tokens + actualUsage.output_tokens;

        if (totalTokensInEvent === 0) {
          continue;
        }

        // Add to weekly aggregation
        addToAggregation(weeklyUsage, actualUsage, timestamp, event.costUSD);

        // Add to session aggregation if within session window
        if (timestamp >= sessionCutoff) {
          addToAggregation(sessionUsage, actualUsage, timestamp, event.costUSD);
        }
      }
    } catch (error) {
      // Silently skip problematic files
    }
  }

  console.warn('[LocalUsageCalculator] Processing stats:', {
    totalEventsProcessed,
    eventsSkippedOld,
    eventsSkippedNoUsage,
    eventsSkippedNoTimestamp,
    sessionEvents: sessionUsage.eventCount,
    weeklyEvents: weeklyUsage.eventCount
  });

  // Calculate estimated percentages
  const sessionPercent = Math.min(
    100,
    Math.round((sessionUsage.totalTokens / ESTIMATED_SESSION_LIMIT) * 100)
  );
  const weeklyPercent = Math.min(
    100,
    Math.round((weeklyUsage.totalTokens / ESTIMATED_WEEKLY_LIMIT) * 100)
  );

  // Calculate reset times
  const sessionResetMs = sessionHours * 60 * 60 * 1000;
  const weeklyResetMs = weeklyDays * 24 * 60 * 60 * 1000;

  // Session resets 5 hours after oldest event in window, or immediately if no events
  const sessionResetTime = sessionUsage.oldestEvent
    ? formatDuration(
        Math.max(0, sessionResetMs - (now.getTime() - sessionUsage.oldestEvent.getTime()))
      )
    : 'Now';

  // Weekly resets are typically on a fixed schedule (e.g., Sunday)
  // For now, estimate based on oldest event in window
  const weeklyResetTime = weeklyUsage.oldestEvent
    ? formatDuration(
        Math.max(0, weeklyResetMs - (now.getTime() - weeklyUsage.oldestEvent.getTime()))
      )
    : 'Now';

  console.warn('[LocalUsageCalculator] Usage calculated:', {
    sessionTokens: sessionUsage.totalTokens,
    weeklyTokens: weeklyUsage.totalTokens,
    sessionPercent,
    weeklyPercent,
    sessionEvents: sessionUsage.eventCount,
    weeklyEvents: weeklyUsage.eventCount,
  });

  return {
    sessionUsage,
    weeklyUsage,
    sessionPercent,
    weeklyPercent,
    sessionResetTime,
    weeklyResetTime,
    fetchedAt: now,
  };
}
