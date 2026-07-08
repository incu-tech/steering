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

/** ANSI Shadow wordmark, printed at the start of interactive runs (à la skills.sh). */
const WORDMARK = [
  '███████╗████████╗███████╗███████╗██████╗ ██╗███╗   ██╗ ██████╗',
  '██╔════╝╚══██╔══╝██╔════╝██╔════╝██╔══██╗██║████╗  ██║██╔════╝',
  '███████╗   ██║   █████╗  █████╗  ██████╔╝██║██╔██╗ ██║██║  ███╗',
  '╚════██║   ██║   ██╔══╝  ██╔══╝  ██╔══██╗██║██║╚██╗██║██║   ██║',
  '███████║   ██║   ███████╗███████╗██║  ██║██║██║ ╚████║╚██████╔╝',
  '╚══════╝   ╚═╝   ╚══════╝╚══════╝╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝ ╚═════╝',
];

/** Banner opt-out via env: `STEERING_NO_BANNER`, `NO_COLOR`, or the `--no-banner` flag. */
let bannerDisabled = false;

export function disableBanner(): void {
  bannerDisabled = true;
}

function bannerOptedOut(): boolean {
  return bannerDisabled || !!process.env.STEERING_NO_BANNER || !!process.env.NO_COLOR;
}

/**
 * Print the wordmark banner. Skipped outside an interactive TTY (agents/CI)
 * so machine-readable output stays clean, and when opted out via env/flag.
 * Pass `force` for the help screen, which humans invoke deliberately even
 * when piped (still honors the opt-out).
 */
export function banner(version?: string, force = false): void {
  if (bannerOptedOut()) return;
  if (!force && !isInteractive()) return;
  const tag = version ? `${pc.dim('AI agent steering files')} ${pc.dim('· v' + version)}` : pc.dim('AI agent steering files');
  console.log();
  for (const line of WORDMARK) console.log(pc.cyan(line));
  console.log(`  ${tag}`);
  console.log();
}

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
