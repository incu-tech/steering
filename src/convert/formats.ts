import type { InclusionMode } from '../types.ts';
import type { AgentFormat } from './types.ts';

/**
 * Static description of a target format: where its files live, how they are
 * named, and which inclusion modes it can represent natively. Used by
 * `output-paths.ts` (paths), `detect.ts` (markers), and `degradation.ts`
 * (capabilities → warnings).
 */
export interface FormatSpec {
  id: AgentFormat;
  displayName: string;
  /**
   * Directory (relative to a workspace/home root) that holds this format's
   * files. Empty string means the repo/home root (used by `agents-md`).
   */
  dir: string;
  /** File extension, including the leading dot — e.g. ".md", ".mdc". */
  ext: string;
  /**
   * Fixed filename for single-file formats (e.g. "AGENTS.md"). When set, the
   * rule `name` does not influence the on-disk filename.
   */
  fixedName?: string;
  /** True when the format is one flat file that holds every rule. */
  single: boolean;
  /**
   * Workspace marker (relative path) used to detect that this agent is in use.
   * For directory-based formats this is the rules directory; for `agents-md`
   * it is the file itself.
   */
  marker: string;
  /** Inclusion modes the format represents natively; others must degrade. */
  supports: InclusionMode[];
}

const ALL_MODES: InclusionMode[] = ['always', 'fileMatch', 'manual', 'auto'];

export const FORMATS: Record<AgentFormat, FormatSpec> = {
  kiro: {
    id: 'kiro',
    displayName: 'Kiro',
    dir: '.kiro/steering',
    ext: '.md',
    single: false,
    marker: '.kiro/steering',
    supports: ALL_MODES,
  },
  'claude-code': {
    id: 'claude-code',
    displayName: 'Claude Code',
    dir: '.claude/rules',
    ext: '.md',
    single: false,
    marker: '.claude/rules',
    // `paths` covers always (absent) and fileMatch (present); manual/auto degrade.
    supports: ['always', 'fileMatch'],
  },
  cursor: {
    id: 'cursor',
    displayName: 'Cursor',
    dir: '.cursor/rules',
    ext: '.mdc',
    single: false,
    marker: '.cursor/rules',
    supports: ALL_MODES,
  },
  windsurf: {
    id: 'windsurf',
    displayName: 'Windsurf',
    dir: '.windsurf/rules',
    ext: '.md',
    single: false,
    marker: '.windsurf/rules',
    supports: ALL_MODES,
  },
  copilot: {
    id: 'copilot',
    displayName: 'GitHub Copilot',
    dir: '.github/instructions',
    ext: '.instructions.md',
    single: false,
    marker: '.github/instructions',
    // `applyTo` covers always (absent) and fileMatch (present); manual/auto degrade.
    supports: ['always', 'fileMatch'],
  },
  opencode: {
    id: 'opencode',
    displayName: 'OpenCode',
    dir: '.opencode/rules',
    ext: '.md',
    single: false,
    marker: '.opencode/rules',
    supports: ['always', 'fileMatch'],
  },
  'agents-md': {
    id: 'agents-md',
    displayName: 'AGENTS.md',
    dir: '',
    ext: '.md',
    fixedName: 'AGENTS.md',
    single: true,
    marker: 'AGENTS.md',
    // Flat file, no frontmatter: everything is effectively "always".
    supports: ['always'],
  },
  cline: {
    id: 'cline',
    displayName: 'Cline',
    dir: '.clinerules',
    ext: '.md',
    single: false,
    marker: '.clinerules',
    supports: ['always'],
  },
};

export function getFormatSpec(format: AgentFormat): FormatSpec {
  return FORMATS[format];
}

/** True when the format can natively represent the given inclusion mode. */
export function supportsInclusion(format: AgentFormat, mode: InclusionMode): boolean {
  return FORMATS[format].supports.includes(mode);
}
