import { homedir } from 'os';
import { join } from 'path';
import type { AgentConfig } from './types.ts';

/** Directory (relative to a workspace root) where Kiro reads steering files. */
export const WORKSPACE_STEERING_DIR = join('.kiro', 'steering');

/** Absolute directory where Kiro reads global (user-level) steering files. */
export const GLOBAL_STEERING_DIR = join(homedir(), '.kiro', 'steering');

/** Marker directory used to detect that the cwd is a Kiro workspace. */
export const KIRO_WORKSPACE_MARKER = '.kiro';

/** Project-scoped lock file, committed to the repo. */
export const LOCAL_LOCK_FILE = 'steering-lock.json';

/**
 * Global lock file: the tool's own registry of globally-installed steering
 * files. Lives in a neutral `~/.steering/` dir (not under any single agent's
 * home) since installs can target multiple formats.
 */
export const GLOBAL_LOCK_FILE = join(homedir(), '.steering', 'steering-lock.json');

/** Package manifest filename inside a steering source repo. */
export const MANIFEST_FILE = 'steering.json';

/** Conventional subdirectory holding `.md` steering files in a source repo. */
export const STEERING_SUBDIR = 'steering';

/**
 * v1 ships a single agent: Kiro. The multi-agent selection prompt from the
 * upstream `skills` CLI is intentionally removed.
 */
export const KIRO: AgentConfig = {
  name: 'kiro',
  displayName: 'Kiro',
  workspaceDir: WORKSPACE_STEERING_DIR,
  globalDir: GLOBAL_STEERING_DIR,
};
