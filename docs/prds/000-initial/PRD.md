# PRD: `steering` CLI — Package Manager for Kiro Steering Files

**Version:** 0.1.0-draft  
**Status:** Ready for implementation  
**Owner:** Incu  
**Target consumer:** Claude Code (agentic implementation)

---

## 1. Overview

`steering` is a CLI tool (distributed via `npx`) that manages Kiro steering files the same way `npx skills` manages Agent Skills. It allows teams to package, publish, install, update, and remove Kiro steering files from Git repositories — both public and private.

The primary use case is enterprise teams (e.g. Interbanking) who need to distribute consistent AI context files across many developers without manual setup.

### 1.1 Core analogy

```
npx skills add owner/repo   →   installs SKILL.md files into .agents/skills/
npx steering add owner/repo →   installs .md files into .kiro/steering/
```

### 1.2 Non-goals (explicit)

- No public registry/website in v1 (that is `steering.sh` — a future product)
- No support for agents other than Kiro in v1
- No steering file authoring or validation UX beyond basic frontmatter checks
- No authentication management (relies on GITHUB_TOKEN / gh CLI like skills does)

---

## 2. Source of truth: vercel-labs/skills

This CLI is a **focused fork** of `https://github.com/vercel-labs/skills` (open source, MIT license). The core mechanics — GitHub source parsing, lock file with tree SHA update detection, symlink/copy installer — are reused with targeted modifications.

Before implementing, read the source structure of vercel-labs/skills:

```
src/
├── cli.ts           # Entry point, command routing
├── add.ts           # Core install logic
├── agents.ts        # Agent registry (40+ agents)
├── installer.ts     # Symlink/copy to agent-specific dirs
├── skill-lock.ts    # Global lock (~/.agents/.skill-lock.json)
├── local-lock.ts    # Project lock (skills-lock.json)
├── source-parser.ts # Parse GitHub shorthand, URLs, local paths
├── blob.ts          # GitHub Trees API calls (SHA detection)
├── skills.ts        # Skill discovery within a repo
└── telemetry.ts     # Anonymous usage (opt-out via DISABLE_TELEMETRY)
```

**Key divergences from skills CLI** are documented in Section 5.

---

## 3. Steering file format

Steering files are standard Kiro steering files. The CLI does not invent a new format — it installs files that Kiro already understands natively.

### 3.1 File format (as per Kiro docs)

Each steering file is a `.md` file with optional YAML frontmatter:

```markdown
---
inclusion: always | fileMatch | manual | auto
fileMatchPattern: "**/*.java"   # only when inclusion: fileMatch
description: "..."              # only when inclusion: auto
---

# Content of the steering file
...
```

If no frontmatter is present, Kiro defaults to `inclusion: always`.

### 3.2 Package structure (in source repo)

A steering package is a Git repository (or subfolder) with the following layout:

```
my-steering-repo/
├── steering.json            # Package manifest (required)
└── steering/
    ├── security.md
    ├── architecture.md
    ├── java-conventions.md
    └── api-design.md
```

#### `steering.json` manifest schema

```json
{
  "name": "incu-standards",
  "version": "1.0.0",
  "description": "Kiro steering files for Interbanking development teams",
  "author": "Incu",
  "license": "UNLICENSED",
  "steering": [
    {
      "name": "security",
      "description": "Banking security standards and OWASP guidelines",
      "file": "steering/security.md"
    },
    {
      "name": "java-conventions",
      "description": "Java code conventions for Spring Boot services",
      "file": "steering/java-conventions.md"
    }
  ]
}
```

**Fields:**
- `name` (required): package identifier, kebab-case
- `version` (optional): semver string
- `description` (optional): human-readable summary
- `steering` (required): array of steering file descriptors
  - `name`: identifier used in CLI commands and lock file
  - `description`: shown in `--list` and interactive prompts
  - `file`: relative path from repo root to the `.md` file

---

## 4. CLI specification

### 4.1 Entry point

```bash
npx steering <command> [options]
```

Binary name: `steering`  
Package name: `@incu/steering` (npm) — or `steering-kiro` if that's taken

### 4.2 Commands

---

#### `steering add <source> [options]`

Install steering files from a source.

**Sources supported** (same as vercel-labs/skills `source-parser.ts`):

```bash
# GitHub shorthand
npx steering add incu/kiro-steering

# Full GitHub URL
npx steering add https://github.com/incu/kiro-steering

# Specific subfolder in a repo
npx steering add https://github.com/org/monorepo/tree/main/packages/kiro-steering

# GitLab
npx steering add https://gitlab.com/org/repo

# Any git URL
npx steering add git@github.com:org/repo.git

# Local path (for development)
npx steering add ./my-local-steering
```

**Options:**

| Flag | Short | Description |
|------|-------|-------------|
| `--list` | | List available steering files without installing |
| `--steering <name>` | `-s` | Install only the named steering file(s) |
| `--all` | | Install all steering files from source |
| `--global` | `-g` | Install to `~/.kiro/steering/` (applies to all workspaces) |
| `--yes` | `-y` | Skip confirmation prompts |

**Default behavior (no flags):** Interactive prompt showing available steering files with checkboxes. Detects if running in a Kiro workspace (checks for `.kiro/` directory). If yes, defaults to workspace install. If no `.kiro/` is found, offers global install.

**Examples:**

```bash
# Interactive install from private repo
npx steering add incu/kiro-steering

# Install specific files, global, non-interactive
npx steering add incu/kiro-steering -s security -s architecture -g -y

# List available without installing
npx steering add incu/kiro-steering --list

# Install all, workspace scope
npx steering add incu/kiro-steering-public --all
```

**Installation paths:**

| Scope | Path |
|-------|------|
| Workspace | `<cwd>/.kiro/steering/<name>.md` |
| Global | `~/.kiro/steering/<name>.md` |

The filename on disk is `<name>.md` as defined in `steering.json`. If no `steering.json` is found, the CLI falls back to installing all `.md` files found in the `steering/` directory, using the filename (without extension) as the name.

---

#### `steering list [options]`

List installed steering files.

**Options:**

| Flag | Description |
|------|-------------|
| `--global` / `-g` | Show globally installed files |
| `--workspace` | Show workspace-installed files (default) |
| `--all` | Show both |

**Output format:**

```
Workspace steering files (.kiro/steering/):
  ✓ security          [always]     from incu/kiro-steering
  ✓ architecture      [always]     from incu/kiro-steering
  ✓ java-conventions  [fileMatch]  from incu/kiro-steering

Global steering files (~/.kiro/steering/):
  ✓ personal-style    [always]     from myuser/my-steering
```

---

#### `steering remove <name> [options]`

Remove an installed steering file.

**Options:**

| Flag | Description |
|------|-------------|
| `--global` / `-g` | Remove from global install |
| `--yes` / `-y` | Skip confirmation |

```bash
npx steering remove security
npx steering remove security -g -y
```

---

#### `steering check [options]`

Check if installed steering files have updates available (compares GitHub tree SHAs — same mechanism as vercel-labs/skills `blob.ts`).

**Options:**

| Flag | Description |
|------|-------------|
| `--global` / `-g` | Check global installs only |

**Output:**

```
Checking for updates...
  incu/kiro-steering
    security          — up to date
    architecture      — update available (HEAD diverged)
    java-conventions  — up to date
```

---

#### `steering update [options]`

Update all installed steering files that have changes. Re-downloads only changed files.

**Options:**

| Flag | Description |
|------|-------------|
| `--global` / `-g` | Update global installs |
| `--yes` / `-y` | Skip confirmation |

---

#### `steering init [name]`

Scaffold a new steering package in the current directory.

Creates:

```
.
├── steering.json
└── steering/
    └── example.md
```

```bash
npx steering init my-org-standards
```

---

### 4.3 Environment variables

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKEN` | GitHub PAT for private repos and higher rate limits |
| `GH_TOKEN` | Alternative to GITHUB_TOKEN (checked second) |
| `DISABLE_TELEMETRY` | Set to `1` to opt out of anonymous usage tracking |
| `DO_NOT_TRACK` | Alternative opt-out for telemetry |

Private repos: the CLI will attempt to use `GITHUB_TOKEN`, then `GH_TOKEN`, then `gh auth token` (GitHub CLI). If none are found and the repo is private, it exits with a clear error message explaining how to authenticate.

---

## 5. Divergences from vercel-labs/skills

This section documents exactly what changes vs the upstream source.

### 5.1 Install paths

| | skills | steering |
|---|---|---|
| Workspace dir | `.agents/skills/<name>/` | `.kiro/steering/` (flat) |
| Global dir | `~/.agents/skills/<name>/` | `~/.kiro/steering/` (flat) |
| Installed file | `<name>/SKILL.md` | `<name>.md` |

**Key difference:** steering files are flat `.md` files, not folders. The installer is simpler — there's no folder hierarchy, just a single file per steering entry.

### 5.2 Lock files

| | skills | steering |
|---|---|---|
| Global lock | `~/.agents/.skill-lock.json` | `~/.kiro/.steering-lock.json` |
| Local lock | `skills-lock.json` | `steering-lock.json` |
| Lock key field | `skills` | `steering` |

Lock file structure is otherwise identical (v3 format with `skillFolderHash` → renamed to `steeringFileHash`).

### 5.3 Agent registry

`agents.ts` in skills defines 40+ agents. In steering, there is **only one agent: Kiro**. The agent registry is simplified to:

```typescript
export const AGENTS = [
  {
    name: "kiro",
    displayName: "Kiro",
    workspaceDir: ".kiro/steering",
    globalDir: "~/.kiro/steering",
    isUniversal: false,
  }
];
```

The interactive agent-selection prompt (prominent in skills) is **removed** since there's only one target.

### 5.4 Package discovery (skills.ts → steering.ts)

In skills, the CLI discovers `SKILL.md` files recursively in the repo. In steering:

1. Look for `steering.json` at repo root — parse `steering` array to find files
2. Fallback: look for `.md` files in `steering/` directory at root
3. Fallback: look for `.md` files anywhere in the repo root (last resort)

### 5.5 Removed features (out of scope for v1)

- `skills experimental_sync` (node_modules sync) — not applicable
- `skills find` (queries skills.sh registry) — no public registry in v1
- Multi-agent installation prompts

### 5.6 Added features (steering-specific)

- Frontmatter validation: warn if a steering file has invalid Kiro frontmatter (`inclusion` must be `always | fileMatch | manual | auto`; `fileMatchPattern` required when `inclusion: fileMatch`)
- `--dry-run` flag on `add`: show what would be installed without writing files

---

## 6. Lock file format

### Global lock (`~/.kiro/.steering-lock.json`)

```json
{
  "version": 3,
  "steering": {
    "security": {
      "name": "security",
      "source": "incu/kiro-steering",
      "steeringFilePath": "steering/security.md",
      "steeringFileHash": "abc123def456...",
      "scope": "global",
      "installedAt": "2026-06-03T10:00:00Z"
    }
  }
}
```

### Local lock (`steering-lock.json`, committed to repo)

```json
{
  "version": 1,
  "steering": {
    "security": {
      "name": "security",
      "source": "incu/kiro-steering",
      "steeringFilePath": "steering/security.md"
    },
    "architecture": {
      "name": "architecture",
      "source": "incu/kiro-steering",
      "steeringFilePath": "steering/architecture.md"
    }
  }
}
```

The local lock is **minimal** (no hashes, no timestamps) to reduce git merge conflicts — same principle as `skills-lock.json` in the original.

---

## 7. File structure of the CLI project

```
steering-cli/
├── package.json
├── tsconfig.json
├── bin/
│   └── cli.mjs              # npx entry point
├── src/
│   ├── cli.ts               # Entry point + command routing (fork of skills/cli.ts)
│   ├── add.ts               # Core add logic (fork of skills/add.ts)
│   ├── list.ts              # List command
│   ├── remove.ts            # Remove command
│   ├── init.ts              # Init command (new)
│   ├── agents.ts            # Simplified: Kiro only
│   ├── installer.ts         # Flat .md installer (simplified fork)
│   ├── steering-lock.ts     # Fork of skill-lock.ts with renamed fields
│   ├── local-lock.ts        # Fork of local-lock.ts with renamed fields
│   ├── source-parser.ts     # Unchanged from skills (reuse as-is)
│   ├── blob.ts              # Unchanged from skills (GitHub Trees API)
│   ├── steering.ts          # Steering discovery in repo (replaces skills.ts)
│   ├── manifest.ts          # steering.json parsing + validation (new)
│   ├── frontmatter.ts       # Kiro frontmatter validation (new)
│   ├── telemetry.ts         # Optional: fork or stub
│   └── constants.ts         # Paths, defaults
└── tests/
    ├── add.test.ts
    ├── manifest.test.ts
    ├── frontmatter.test.ts
    └── installer.test.ts
```

---

## 8. Tech stack

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Language | TypeScript | Same as skills, Claude Code friendly |
| Runtime | Node.js ≥18 | npx compatible |
| Build | tsup or tsc | Same as skills |
| Test | Vitest | Same as skills |
| Deps | Minimal | `gray-matter` for frontmatter parsing; `picocolors` for terminal color; `@clack/prompts` for interactive UI — same as skills |
| Distribution | npm (`npx`) | Zero-install experience |

---

## 9. Error handling requirements

| Scenario | Expected behavior |
|----------|-------------------|
| Private repo, no token | Exit with message: "This repo requires authentication. Set GITHUB_TOKEN or run `gh auth login`." |
| Invalid steering.json | Exit with validation errors listing what's wrong |
| Invalid frontmatter in .md | Warn (don't fail): "security.md: invalid inclusion mode 'always_on'. Valid values: always, fileMatch, manual, auto" |
| File already exists at target | Prompt to overwrite (or skip with `--yes`) |
| .kiro/ not found in workspace | Warn: "No .kiro/ directory found. Installing globally instead. Use --global to suppress this warning." |
| Network error | Retry once, then fail with clear message |
| GitHub rate limit | Prompt for GITHUB_TOKEN to increase limit |

---

## 10. Implementation order (for Claude Code)

Implement in this sequence to enable incremental testing:

1. **`source-parser.ts`** — copy from vercel-labs/skills, no changes needed
2. **`blob.ts`** — copy from vercel-labs/skills, no changes needed  
3. **`constants.ts`** — define Kiro paths (`~/.kiro/steering/`, `.kiro/steering/`)
4. **`manifest.ts`** — parse and validate `steering.json`
5. **`frontmatter.ts`** — validate Kiro frontmatter in `.md` files
6. **`steering.ts`** — discover steering files in a source repo
7. **`installer.ts`** — write flat `.md` files to target paths
8. **`steering-lock.ts`** — global lock file (fork of skill-lock.ts)
9. **`local-lock.ts`** — project lock file
10. **`add.ts`** — core add command (orchestrates 1-9)
11. **`list.ts`**, **`remove.ts`**, **`init.ts`** — secondary commands
12. **`cli.ts`** — entry point, wire all commands
13. **Tests** — unit tests for manifest, frontmatter, installer, add

---

## 11. Example end-to-end usage (acceptance test)

### Setup a steering package repo

```
interbanking-kiro-steering/
├── steering.json
└── steering/
    ├── security.md          # inclusion: always
    └── java-conventions.md  # inclusion: fileMatch, pattern: "**/*.java"
```

### Developer onboarding flow

```bash
# In a Kiro workspace
cd my-project   # has .kiro/ directory

# Install workspace-scoped steering files
npx steering add incu/kiro-steering

# > Found 2 steering files:
# > [x] security          — Banking security standards
# > [x] java-conventions  — Java/Spring Boot conventions
# > Install to .kiro/steering/? (Y/n)

# Result:
ls .kiro/steering/
# security.md  java-conventions.md

# Commit the lock file
git add steering-lock.json
git commit -m "chore: add interbanking kiro steering files"
```

### Another dev restores from lock file

```bash
# (future: steering install — reads steering-lock.json)
# v1: they run the same add command
npx steering add incu/kiro-steering --all -y
```

### Update check

```bash
npx steering check
# architecture — update available

npx steering update -y
# Updated: architecture
```

---

## 12. Out of scope for v1 / future roadmap

| Feature | Version |
|---------|---------|
| `steering install` — restore all from lock file | v1.1 |
| `steering.sh` public registry and website | v2 |
| Multi-agent support (Cursor `.cursorrules`, Claude Code `CLAUDE.md`) | v2 |
| `steering publish` — push to registry | v2 |
| Kiro Powers integration (bundle steering + hooks + MCP) | v3 |
| VSCode extension / Kiro IDE native integration | v3 |

---

## Appendix A: Example steering files

### `security.md`

```markdown
---
inclusion: always
---

# Security Standards

- Never commit secrets, API keys, or credentials to source control
- Use environment variables for all configuration
- Validate all input at service boundaries
- Follow OWASP Top 10 guidelines
- All endpoints must require authentication unless explicitly documented as public
- Use parameterized queries — never string concatenation for SQL
```

### `java-conventions.md`

```markdown
---
inclusion: fileMatch
fileMatchPattern: "**/*.java"
---

# Java Conventions

- Use Spring Boot 3.x patterns
- Services are annotated with @Service, repos with @Repository
- DTOs use record classes (Java 17+)
- Exception handling via @ControllerAdvice
- All public methods in service layer must have Javadoc
```

---

## Appendix B: Relationship with skills.sh

`steering` is intentionally compatible-but-separate from `skills`. They solve different problems:

| | skills | steering |
|---|---|---|
| Target | Reusable agent workflows (on-demand) | Persistent project context (always-on) |
| File type | `SKILL.md` with Agent Skills spec | Kiro steering `.md` files |
| Scope | Multi-agent (40+ tools) | Kiro-only (v1) |
| Activation | On-demand via `/` command or auto-match | Automatic by Kiro on every interaction |
| Install path | `.agents/skills/` | `.kiro/steering/` |

They can coexist in the same project. A team might use `skills` for workflow procedures and `steering` for persistent coding standards.
