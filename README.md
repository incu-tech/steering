# steering

Package manager for AI agent **steering files** — distribute coding standards,
architecture decisions, and conventions to your team's AI agents from a Git
repo, public or private. Same workflow as `npx skills`, but for steering files.

Authored once, installed in each agent's native format —
[Kiro](https://kiro.dev), Cursor, Claude Code, GitHub Copilot, Windsurf, and more.

```bash
npx skills       add owner/repo   →  installs SKILL.md into .agents/skills/
npx steering.sh  add owner/repo   →  installs steering files for your AI agent
```

## Install / invocation

The CLI is published under three names — pick whichever you prefer, they are the
same tool:

| Run with | Package | Notes |
|----------|---------|-------|
| `npx steering.sh <cmd>` | [`steering.sh`](https://www.npmjs.com/package/steering.sh) | Short, brandable (recommended) |
| `npx steering-cli <cmd>` | [`steering-cli`](https://www.npmjs.com/package/steering-cli) | Conventional alias |
| `npx @incu/steering <cmd>` | [`@incu/steering`](https://www.npmjs.com/package/@incu/steering) | Canonical package |

For frequent use, install once and drop the `npx`:

```bash
npm i -g steering.sh      # or: pnpm add -g steering.sh
steering add owner/repo   # the `steering` command is now on your PATH
```

## Quick start

```bash
# In a workspace your agent recognizes (e.g. a .kiro/ directory)
npx steering.sh add incu/kiro-steering            # interactive picker
npx steering.sh add incu/kiro-steering --all -y   # install everything
npx steering.sh add incu/kiro-steering -s security -g  # one file, global

npx steering.sh list                # what's installed
npx steering.sh check               # any updates upstream?
npx steering.sh update -y           # pull changed files
npx steering.sh remove security     # uninstall

npx steering.sh init my-standards   # scaffold a new steering package
```

## Commands

| Command | Description |
|---------|-------------|
| `add <source>` | Install steering files from a GitHub repo or local path |
| `list`, `ls` | List installed steering files |
| `check` | Check for available updates (compares git blob SHAs) |
| `update` | Re-download changed files (alias: `upgrade`) |
| `remove <name>` | Remove an installed steering file (alias: `rm`) |
| `init [name]` | Scaffold a new steering package (`steering.json` + example) |
| `convert <source>` | Convert rule files between agent formats |

### `add` options

| Flag | Description |
|------|-------------|
| `--list` | List available files in the source without installing |
| `-s, --steering <name>` | Install only the named file(s) (repeatable) |
| `--all` | Install all steering files from the source |
| `--agent <fmt>` | Target agent format (repeatable; auto-detected if omitted) |
| `--all-agents` | Install to every agent detected in the workspace |
| `--all-formats` | Install to all supported formats (detected or not) |
| `--from <fmt>` | Source format (auto-detected if omitted) |
| `-g, --global` | Install to the agent's global dir (all workspaces) |
| `-y, --yes` | Skip confirmation prompts |
| `--dry-run` | Show what would be installed without writing |

### `list` / `check` / `update` / `remove` options

| Flag | Description |
|------|-------------|
| `-g, --global` | Target global installs |
| `--workspace` | Target workspace installs (default for `list`) |
| `--all` | `list`: show both scopes (`check` / `update` span both by default) |
| `--agent <fmt>` | `remove`: restrict to one agent (otherwise removes from all) |
| `-y, --yes` | Skip confirmation prompts (`remove` / `update`) |

### `convert` options

`convert` translates a steering/rule file from one agent format to another
(e.g. a Kiro file into Cursor rules).

| Flag | Description |
|------|-------------|
| `--to <fmt>` | Target format (required unless `--all-agents`) |
| `--from <fmt>` | Source format (auto-detected if omitted) |
| `-o, --out <path>` | Output directory (default: the target format's standard dir) |
| `--all-agents` | Convert to every supported format at once |
| `--dry-run` | Show what would be written without writing |
| `--force` | Overwrite existing files without asking |

## Supported formats

`kiro`, `claude-code`, `cursor`, `windsurf`, `copilot`, `opencode`, `agents-md`,
`cline`.

The agent names used by [`npx skills`](https://github.com/vercel-labs/skills)
are accepted as aliases, so the same `--agent` value works with both tools:
`github-copilot` → `copilot`, `codex` and `universal` → `agents-md` (Codex
reads `AGENTS.md`), `kiro-cli` → `kiro`.

A file authored once is installed (or converted) into each agent's native
location and frontmatter. Kiro is the **canonical** format — the most expressive
schema, used as the pivot when converting between formats. Without `--agent`,
the CLI auto-detects the target(s) from the workspace and falls back to Kiro.

## Sources

| Source | Example |
|--------|---------|
| GitHub shorthand | `owner/repo` |
| GitHub URL | `https://github.com/owner/repo` |
| Subfolder | `https://github.com/org/monorepo/tree/main/packages/steering` |
| Single file | `owner/repo@security` |
| Local path (dev) | `./my-steering` |

> Currently **GitHub** and **local** sources are installable. GitLab / raw-git
> URLs parse but are not installable yet (they're reported with a clear message).

## Steering packages

A source repo is discovered in this order:

1. a `steering.json` manifest at the root
2. `.md` files in a `steering/` directory
3. `.md` files at the repo root

```jsonc
// steering.json
{
  "name": "incu-standards",
  "version": "1.0.0",
  "steering": [
    { "name": "security", "description": "OWASP + banking", "file": "steering/security.md" }
  ]
}
```

Each steering file is a `.md` with optional frontmatter
(`inclusion: always | fileMatch | manual | auto`, the canonical Kiro schema):

```markdown
---
inclusion: fileMatch
fileMatchPattern: "**/*.java"
---

# Java conventions

...
```

Invalid frontmatter is reported as a warning but never blocks installation.

## Install scopes & lock files

| Scope | Install path (Kiro target) | Lock file |
|-------|----------------------------|-----------|
| Workspace (default) | `<cwd>/.kiro/steering/<name>.md` | `steering-lock.json` (commit it) |
| Global (`-g`) | `~/.kiro/steering/<name>.md` | `~/.steering/steering-lock.json` |

Each target format installs into its own directory (e.g. `.cursor/rules/` for
Cursor); the paths above are for the Kiro target. The global lock lives in a
neutral `~/.steering/` dir since installs can span multiple formats.

The workspace lock is intentionally minimal (no hashes/timestamps) to avoid git
merge conflicts; update detection recomputes the git blob SHA from the installed
file when you run `check` / `update`.

## Authentication

For private repos / higher rate limits, the CLI resolves a token in this order:
`GITHUB_TOKEN` → `GH_TOKEN` → `gh auth token`. With none of these on a private
repo it exits with guidance.

## Environment variables

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKEN` / `GH_TOKEN` | GitHub auth |
| `DISABLE_TELEMETRY` / `DO_NOT_TRACK` | Telemetry opt-out (telemetry is disabled in this build) |

## Development

This repo uses **pnpm**.

```bash
pnpm install
pnpm test          # vitest
pnpm type-check    # tsc --noEmit
pnpm build         # obuild → dist/cli.mjs
node bin/cli.mjs --help
```

The `npx` aliases (`steering.sh`, `steering-cli`) are thin wrapper packages under
`aliases/`; they depend on `@incu/steering` and just run its CLI, so there is a
single source of truth.

## Credits & license

MIT. Forked from [vercel-labs/skills](https://github.com/vercel-labs/skills)
(also MIT) — see [`LICENSE`](./LICENSE) for the dual attribution.
