import type { InclusionMode } from '../types.ts';

/**
 * Every AI-coding agent whose rule/steering format the converter understands.
 * @see docs/prds/000-initial/PRD-converter.md §2
 */
export type AgentFormat =
  | 'kiro'
  | 'claude-code'
  | 'cursor'
  | 'windsurf'
  | 'copilot'
  | 'opencode'
  | 'agents-md'
  | 'cline';

export const AGENT_FORMATS: AgentFormat[] = [
  'kiro',
  'claude-code',
  'cursor',
  'windsurf',
  'copilot',
  'opencode',
  'agents-md',
  'cline',
];

/**
 * Format-neutral representation of a single rule. Every parser produces one (or
 * more) of these; every serializer consumes one. The `inclusion` field reuses
 * Kiro's `InclusionMode` because Kiro is the most expressive format and its four
 * modes are the canonical vocabulary (docs/prds/000-initial/PRD-converter.md §3).
 */
export interface CanonicalRule {
  /** File name without extension (e.g. "security"). */
  name: string;
  /** Activation mode. */
  inclusion: InclusionMode;
  /** Glob patterns for `fileMatch`. */
  filePatterns?: string[];
  /** Semantic description for `auto` (agent-decided). */
  description?: string;
  /** Markdown body without frontmatter. */
  body: string;
}

export type WarningType =
  | 'degraded_inclusion'
  | 'patterns_truncated'
  | 'unsupported_mode'
  | 'empty_body';

/** A single non-fatal semantic-loss event produced during conversion. */
export interface ConversionWarning {
  type: WarningType;
  message: string;
  originalValue: string;
  appliedFallback: string;
}

/** Outcome of converting one source file to one target format. */
export interface ConversionResult {
  sourcePath: string;
  outputPath: string;
  targetFormat: AgentFormat;
  warnings: ConversionWarning[];
}
