import type { AgentFormat, CanonicalRule } from './convert/types.ts';

/**
 * Kiro inclusion modes for steering files.
 * @see https://kiro.dev docs — steering file frontmatter
 */
export type InclusionMode = 'always' | 'fileMatch' | 'manual' | 'auto';

export const INCLUSION_MODES: InclusionMode[] = ['always', 'fileMatch', 'manual', 'auto'];

/**
 * A resolved steering file, ready to be installed. Produced by the discovery
 * layer (`steering.ts`) from either a GitHub repo tree or a local directory.
 */
export interface SteeringFile {
  /** Identifier used in CLI commands and lock files (kebab-case). */
  name: string;
  /** Human-readable summary shown in `--list` and prompts. */
  description: string;
  /** Path of the `.md` file relative to the source repo root (e.g. "steering/security.md"). */
  repoPath: string;
  /** Full markdown content (frontmatter + body) as found in the source. */
  content: string;
  /** Detected format of the source file. */
  sourceFormat: AgentFormat;
  /** Canonical rules parsed from the source (one, or many for a split AGENTS.md). */
  rules: CanonicalRule[];
  /** Inclusion mode of the first rule (used for display/listing). */
  inclusion: InclusionMode;
  /**
   * Change-detection hash. For GitHub sources this is the git blob SHA from the
   * repo tree; for local sources it is a SHA-256 of the file content.
   */
  hash: string;
  /**
   * Version of the source package (`steering.json` `version`), when the source
   * has a manifest. Recorded in the lock files so `list`/`check` can report the
   * installed package version. Absent for manifest-less sources.
   */
  sourceVersion?: string;
  /** Non-fatal frontmatter validation warnings (shown but never block install). */
  warnings: string[];
}

/**
 * A single entry in a `steering.json` package manifest.
 */
export interface ManifestSteeringEntry {
  name: string;
  description?: string;
  file: string;
}

/**
 * The `steering.json` package manifest.
 */
export interface SteeringManifest {
  name: string;
  version?: string;
  description?: string;
  author?: string;
  license?: string;
  steering: ManifestSteeringEntry[];
}

/**
 * A source string parsed into a structured shape.
 * `github` and `local` read through the GitHub API / filesystem; `git` and
 * `gitlab` are installable via a generic `git clone`. `well-known` (a non-git
 * HTTP URL) is parsed for clear error messaging but not yet installable.
 */
export interface ParsedSource {
  type: 'github' | 'gitlab' | 'git' | 'local' | 'well-known';
  url: string;
  subpath?: string;
  localPath?: string;
  ref?: string;
  /** Single-file filter extracted from `owner/repo@name` syntax. */
  steeringFilter?: string;
}

/**
 * The single supported agent in v1: Kiro.
 */
export interface AgentConfig {
  name: string;
  displayName: string;
  /** Workspace-scoped steering dir, relative to cwd. */
  workspaceDir: string;
  /** Global steering dir (absolute, under the user's home). */
  globalDir: string;
}
