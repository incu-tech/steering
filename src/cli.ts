#!/usr/bin/env node

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { parseAddOptions, runAdd } from './add.ts';
import { runList } from './list.ts';
import { parseRemoveOptions, runRemove } from './remove.ts';
import { runInit } from './init.ts';
import { runCheck, runUpdate } from './update.ts';
import { runConvert } from './convert-command.ts';
import { flushTelemetry, setVersion } from './telemetry.ts';
import { banner, disableBanner, c } from './ui.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const VERSION = getVersion();

function showHelp(): void {
  banner(VERSION, true);
  console.log(`${c.bold('steering')} — package manager for AI agent steering files

${c.bold('Usage:')} steering <command> [options]

${c.bold('Commands:')}
  add <source>      Install steering files from a GitHub repo or local path
  list, ls          List installed steering files
  remove <name>     Remove an installed steering file (alias: rm)
  check             Check for available updates
  update            Update installed steering files (alias: upgrade)
  init [name]       Scaffold a new steering package
  convert <source>  Convert rule files between agent formats

${c.bold('add options:')}
  --list            List available steering files without installing
  -s, --steering    Install only the named file(s) (repeatable)
  --all             Install all steering files from the source
  --agent <fmt>     Target agent format (repeatable; auto-detected if omitted)
  --all-agents      Install to every agent detected in the workspace
  --all-formats     Install to all supported formats (detected or not)
  --from <fmt>      Source format (auto-detected if omitted)
  -g, --global      Install to the agent's global dir (all workspaces)
  -y, --yes         Skip confirmation prompts
  --dry-run         Show what would be installed without writing

${c.bold('convert options:')}
  --to <fmt>        Target format (required unless --all-agents)
  --from <fmt>      Source format (auto-detected if omitted)
  -o, --out <path>  Output directory (default: target format's standard dir)
  --all-agents      Convert to every supported format at once
  --dry-run         Show what would be written without writing
  --force           Overwrite existing files without asking

${c.bold('Formats:')} kiro, claude-code, cursor, windsurf, copilot, opencode, agents-md, cline

${c.bold('list / check / update / remove options:')}
  -g, --global      Target global installs
  --workspace       Target workspace installs (default for list)
  --all             list: show both scopes (check/update span both by default)
  --agent <fmt>     remove: restrict to one agent (otherwise removes from all)
  -y, --yes         Skip confirmation prompts (remove/update)

${c.bold('Sources:')}
  owner/repo                         GitHub shorthand
  https://github.com/owner/repo      GitHub URL
  .../tree/main/path                 subfolder in a repo
  owner/repo@name                    a single steering file
  ./local-path                       local directory (development)

${c.bold('Global options:')}
  --no-banner       Hide the wordmark banner (also: STEERING_NO_BANNER, NO_COLOR)

${c.bold('Environment:')}
  GITHUB_TOKEN / GH_TOKEN            auth for private repos & higher rate limits
  STEERING_NO_BANNER / NO_COLOR      hide the wordmark banner
  DISABLE_TELEMETRY / DO_NOT_TRACK   (telemetry is disabled in this build)

${c.bold('Examples:')}
  ${c.dim('$')} npx steering.sh add incu/kiro-steering
  ${c.dim('$')} npx steering.sh add incu/kiro-steering -s security -g -y
  ${c.dim('$')} npx steering.sh add ./my-steering --all
  ${c.dim('$')} npx steering.sh list --all
  ${c.dim('$')} npx steering.sh check
`);
}

async function main(): Promise<void> {
  setVersion(VERSION);
  const rawArgs = process.argv.slice(2);
  // `--no-banner` can appear anywhere; strip it so it doesn't shift the command/args.
  if (rawArgs.includes('--no-banner')) disableBanner();
  const args = rawArgs.filter((a) => a !== '--no-banner');
  const command = args[0];
  const rest = args.slice(1);

  // Wordmark at the start of actionable commands (help renders its own; --version stays bare).
  const bare = command === undefined || command === '--version' || command === '-v' || command === '--help' || command === '-h';
  if (!bare) banner(VERSION);

  switch (command) {
    case 'add':
    case 'a':
    case 'install':
    case 'i': {
      const { source, options } = parseAddOptions(rest);
      await runAdd(source, options);
      break;
    }
    case 'list':
    case 'ls':
      await runList(rest);
      break;
    case 'remove':
    case 'rm':
    case 'r': {
      const { names, options } = parseRemoveOptions(rest);
      await runRemove(names, options);
      break;
    }
    case 'check':
      await runCheck(rest);
      break;
    case 'update':
    case 'upgrade':
      await runUpdate(rest);
      break;
    case 'init':
      await runInit(rest);
      break;
    case 'convert':
      await runConvert(rest);
      break;
    case '--version':
    case '-v':
      console.log(VERSION);
      break;
    case undefined:
    case '--help':
    case '-h':
      showHelp();
      break;
    default:
      console.log(`Unknown command: ${command}`);
      console.log(`Run ${c.bold('steering --help')} for usage.`);
      process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(() => flushTelemetry().then(() => process.exit(process.exitCode ?? 0)));
