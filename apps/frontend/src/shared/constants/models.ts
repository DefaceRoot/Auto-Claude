/**
 * Model and agent profile constants
 * Claude models, GLM models, thinking levels, memory backends, and agent profiles
 */

import type { AgentProfile, PhaseModelConfig, FeatureModelConfig, FeatureThinkingConfig, ModelProvider, AgentFramework } from '../types/settings';

// ============================================
// Agent Frameworks
// ============================================

// Available framework options for task execution
export const AGENT_FRAMEWORKS: { value: AgentFramework; label: string; description: string }[] = [
  {
    value: 'auto-claude',
    label: 'Auto Claude',
    description: 'Full pipeline with spec creation and QA review'
  },
  {
    value: 'quick-mode',
    label: 'Quick Mode',
    description: 'Fast iterations - planning and coding only'
  }
];

// ============================================
// Provider Configuration
// ============================================

export const MODEL_PROVIDERS = {
  anthropic: {
    baseUrl: undefined, // Uses default Anthropic API
    authTokenEnvVar: 'CLAUDE_CODE_OAUTH_TOKEN',
  },
  zai: {
    baseUrl: 'https://api.z.ai/api/anthropic',
    authTokenEnvVar: 'ANTHROPIC_AUTH_TOKEN',
    timeout: 3000000, // 50 minutes per Z.ai docs
  }
} as const;

// ============================================
// Available Models
// ============================================

export const AVAILABLE_MODELS = [
  // Anthropic Claude models
  { value: 'opus', label: 'Claude Opus 4.5', provider: 'anthropic' as ModelProvider },
  { value: 'sonnet', label: 'Claude Sonnet 4.5', provider: 'anthropic' as ModelProvider },
  { value: 'haiku', label: 'Claude Haiku 4.5', provider: 'anthropic' as ModelProvider },
  // Z.ai GLM models
  { value: 'glm-4.7', label: 'GLM-4.7 (Opus tier)', provider: 'zai' as ModelProvider },
  { value: 'glm-4.5-air', label: 'GLM-4.5-Air (Haiku tier)', provider: 'zai' as ModelProvider },
] as const;

// Maps model shorthand to actual model IDs
// Note: GLM models use Claude model IDs because Z.ai's API expects Claude IDs
// and handles the GLM mapping server-side
export const MODEL_ID_MAP: Record<string, string> = {
  // Claude models
  opus: 'claude-opus-4-5-20251101',
  sonnet: 'claude-sonnet-4-5-20250929',
  haiku: 'claude-haiku-4-5-20251001',
  // GLM models (Z.ai) - mapped to Claude IDs for API compatibility
  // Z.ai routes these to GLM-4.7/GLM-4.5-Air on their backend
  'glm-4.7': 'claude-opus-4-5-20251101',  // Opus tier → GLM-4.7
  'glm-4.5-air': 'claude-haiku-4-5-20251001',  // Haiku tier → GLM-4.5-Air
} as const;

// ============================================
// Provider Helper Functions
// ============================================

/**
 * Get the provider for a model (anthropic or zai)
 */
export function getModelProvider(model: string): ModelProvider {
  const modelInfo = AVAILABLE_MODELS.find(m => m.value === model);
  return modelInfo?.provider ?? 'anthropic';
}

/**
 * Check if a model is a GLM model (uses Z.ai API)
 */
export function isGLMModel(model: string): boolean {
  return getModelProvider(model) === 'zai';
}

// Maps thinking levels to budget tokens (null = no extended thinking)
export const THINKING_BUDGET_MAP: Record<string, number | null> = {
  none: null,
  low: 1024,
  medium: 4096,
  high: 16384,
  ultrathink: 65536
} as const;

// ============================================
// Thinking Levels
// ============================================

// Thinking levels for Claude model (budget token allocation)
export const THINKING_LEVELS = [
  { value: 'none', label: 'None', description: 'No extended thinking' },
  { value: 'low', label: 'Low', description: 'Brief consideration' },
  { value: 'medium', label: 'Medium', description: 'Moderate analysis' },
  { value: 'high', label: 'High', description: 'Deep thinking' },
  { value: 'ultrathink', label: 'Ultra Think', description: 'Maximum reasoning depth' }
] as const;

// ============================================
// Agent Profiles
// ============================================

// Default phase model configuration for Auto profile
// Uses Opus across all phases for maximum quality
export const DEFAULT_PHASE_MODELS: PhaseModelConfig = {
  spec: 'opus',       // Best quality for spec creation
  planning: 'opus',   // Complex architecture decisions benefit from Opus
  coding: 'opus',     // Highest quality implementation
  qa: 'opus'          // Thorough QA review
};

// Default phase thinking configuration for Auto profile
export const DEFAULT_PHASE_THINKING: import('../types/settings').PhaseThinkingConfig = {
  spec: 'ultrathink',   // Deep thinking for comprehensive spec creation
  planning: 'high',     // High thinking for planning complex features
  coding: 'low',        // Faster coding iterations
  qa: 'low'             // Efficient QA review
};

// ============================================
// Feature Settings (Non-Pipeline Features)
// ============================================

// Default feature model configuration (for insights, ideation, roadmap, github)
export const DEFAULT_FEATURE_MODELS: FeatureModelConfig = {
  insights: 'sonnet',     // Fast, responsive chat
  ideation: 'opus',       // Creative ideation benefits from Opus
  roadmap: 'opus',        // Strategic planning benefits from Opus
  githubIssues: 'opus',   // Issue triage and analysis benefits from Opus
  githubPrs: 'opus'       // PR review benefits from thorough Opus analysis
};

// Default feature thinking configuration
export const DEFAULT_FEATURE_THINKING: FeatureThinkingConfig = {
  insights: 'medium',     // Balanced thinking for chat
  ideation: 'high',       // Deep thinking for creative ideas
  roadmap: 'high',        // Strategic thinking for roadmap
  githubIssues: 'medium', // Moderate thinking for issue analysis
  githubPrs: 'medium'     // Moderate thinking for PR review
};

// Feature labels for UI display
export const FEATURE_LABELS: Record<keyof FeatureModelConfig, { label: string; description: string }> = {
  insights: { label: 'Insights Chat', description: 'Ask questions about your codebase' },
  ideation: { label: 'Ideation', description: 'Generate feature ideas and improvements' },
  roadmap: { label: 'Roadmap', description: 'Create strategic feature roadmaps' },
  githubIssues: { label: 'GitHub Issues', description: 'Automated issue triage and labeling' },
  githubPrs: { label: 'GitHub PR Review', description: 'AI-powered pull request reviews' }
};

// Default agent profiles for preset model/thinking configurations
export const DEFAULT_AGENT_PROFILES: AgentProfile[] = [
  {
    id: 'auto',
    name: 'Auto (Optimized)',
    description: 'Uses Opus across all phases with optimized thinking levels',
    model: 'opus',  // Fallback/default model
    thinkingLevel: 'high',
    icon: 'Sparkles',
    isAutoProfile: true,
    phaseModels: DEFAULT_PHASE_MODELS,
    phaseThinking: DEFAULT_PHASE_THINKING
  },
  {
    id: 'complex',
    name: 'Complex Tasks',
    description: 'For intricate, multi-step implementations requiring deep analysis',
    model: 'opus',
    thinkingLevel: 'ultrathink',
    icon: 'Brain'
  },
  {
    id: 'balanced',
    name: 'Balanced',
    description: 'Good balance of speed and quality for most tasks',
    model: 'sonnet',
    thinkingLevel: 'medium',
    icon: 'Scale'
  },
  {
    id: 'quick',
    name: 'Quick Edits',
    description: 'Fast iterations for simple changes and quick fixes',
    model: 'haiku',
    thinkingLevel: 'low',
    icon: 'Zap'
  }
];

// ============================================
// Memory Backends
// ============================================

export const MEMORY_BACKENDS = [
  { value: 'file', label: 'File-based (default)' },
  { value: 'graphiti', label: 'Graphiti (LadybugDB)' }
] as const;
