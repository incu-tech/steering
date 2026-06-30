import pc from 'picocolors';

/**
 * Whether we can safely show interactive prompts. steering frequently runs
 * inside agents (Kiro/Claude) and CI where stdin isn't a TTY — prompting there
 * hangs, so callers fall back to flag-driven, non-interactive behavior.
 */
export function isInteractive(): boolean {
  return Boolean(process.stdout.isTTY && process.stdin.isTTY) && !isCI();
}

export function isCI(): boolean {
  return !!(
    process.env.CI ||
    process.env.GITHUB_ACTIONS ||
    process.env.GITLAB_CI ||
    process.env.CIRCLECI ||
    process.env.TRAVIS ||
    process.env.BUILDKITE ||
    process.env.JENKINS_URL
  );
}

export const c = pc;

export function info(msg: string): void {
  console.log(msg);
}

export function success(msg: string): void {
  console.log(`${pc.green('✓')} ${msg}`);
}

export function warn(msg: string): void {
  console.warn(`${pc.yellow('!')} ${msg}`);
}

export function errorMsg(msg: string): void {
  console.error(`${pc.red('✗')} ${msg}`);
}

/** Exit the process after printing a polished error message. */
export function fail(msg: string): never {
  errorMsg(msg);
  process.exit(1);
}
