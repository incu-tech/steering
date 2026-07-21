# CLAUDE.md — `steering` CLI

Short guide for working in this repo.

## What it is

CLI (distributed via `npx`) that manages **AI-agent steering files** the same way
`npx skills` manages Agent Skills: packaging, installing, updating, and removing
context files from Git repos (public and private).

Published on npm under three names (same tool):
- **`@incu/steering`** — canonical package (all the logic + library).
- **`steering.sh`** and **`steering-cli`** — thin aliases in `aliases/` that depend on
  `@incu/steering` and only run its CLI (`import '@incu/steering/cli'`). A single
  source of truth; they inherit patches by semver range.

Inspired by [`vercel-labs/skills`](https://github.com/vercel-labs/skills) (MIT).

## Supported formats

`kiro` (canonical), `claude-code`, `cursor`, `windsurf`, `copilot`, `opencode`,
`agents-md`, `cline`. A file is authored once and installed/converted to each agent's
native format. The conversion subsystem lives in `src/convert/` (Kiro is the pivot,
being the most expressive format). Without `--agent`, `add` autodetects the workspace
target(s) and falls back to Kiro.

## Layout

- `src/` — source code (strict TS, ESM, imports with the `.ts` extension).
- `src/convert/` — per-format parsers/serializers + detection.
- `bin/` — entrypoints: `steering` → `cli.mjs`, `steering-convert` → `convert.mjs`.
- `aliases/` — alias packages `steering.sh` and `steering-cli`.
- `tests/` and `src/**/*.test.ts` — Vitest.

## Stack

- **Runtime:** Node ≥18. **Package manager:** pnpm (see `pnpm-workspace.yaml`).
- **Build:** `obuild` → `dist/`. **Test:** Vitest. **Format:** Prettier.
- **Runtime deps:** `yaml`, `picocolors`, `@clack/prompts`. Frontmatter uses a custom
  parser based on `yaml` (not `gray-matter`, which has an RCE via `eval`).

```bash
pnpm install
pnpm test          # vitest
pnpm type-check    # tsc --noEmit
pnpm build         # obuild → dist/
```

## Key concepts (not obvious from the code)

- **Install paths:** each format installs into its own dir (Kiro →
  `.kiro/steering/<name>.md`). Global with `-g`.
- **Lock files:**
  - Local (workspace): `steering-lock.json`, **minimal** (no hashes/timestamps) to
    avoid merge conflicts; change detection recomputes the file's blob SHA from disk.
  - Global: `~/.steering/steering-lock.json` (neutral dir, not under any agent's home).
- **Change detection:** git blob SHA. For GitHub it's read from the API tree; for
  local/cloned it's computed with `computeGitBlobSha()`. `check`/`update` compare that SHA.
- **Auth (GitHub):** lazy. **Public repos work without a token**; the token is only
  looked up on 401/403/rate-limit. Order: `GITHUB_TOKEN` → `GH_TOKEN` → `gh auth token`.
  `gh` is not required.
- **Kiro frontmatter:** `inclusion: always | fileMatch | manual | auto`. Validation is
  **advisory** (warn, never blocks installation).

## `steering.json` (source package manifest)

```json
{
  "name": "incu-standards",
  "version": "1.0.0",
  "steering": [
    { "name": "security", "description": "...", "file": "steering/security.md" }
  ]
}
```

Discovery of a source repo, in order: `steering.json` → `.md` in `steering/`
→ `.md` at the root.

## Conventions

- After generating new code, run `snyk_code_scan` and remediate before continuing.
- Strict TS, ESM, imports with the `.ts` extension. Format with Prettier (`pnpm format`).
- Before opening a PR: `pnpm type-check`, `pnpm test`, and `pnpm format:check` all green.

## Project documentation

- **`PRD.md`** (root) — product overview; entry point for the incu-way flows.
- **`docs/architecture/`** — living architecture (overview, components, data model).
- **`docs/prds/NNN-slug/`** — per-feature PRDs (pre-existing local convention, preserved).
- **`docs/bugs/`** — bug reports and analysis (written by `incu-way-bugs`).
- **`docs/security/`** — findings and remediations (written by `snyk-remediation`).
- **`.incu-way/items/`** — incu-way work-item state.

## incu-way workflow

### Branch model

- **`main`** — stable/release. **`develop`** — integration. Never commit directly to
  either.
- Work happens on branches by type: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`,
  `docs/<slug>`. They integrate into `develop` via a reviewed **Pull Request**;
  `develop → main` on release.

### Development flow (features)

For ambiguous, cross-cutting, or risky product work, use **`incu-way-development`**:
discovery → PRD (`docs/prds/`) → gated plan → implementation → validation → PR. For
small, direct changes, go straight to a `feat/`/`fix/` branch without the full flow.

### Bug flow

For regressions or high-impact issues, use **`incu-way-bugs`**: expected behavior,
reproduction, root cause, and a fix plan (in `docs/bugs/`) before touching code. Trivial
fixes can go straight to a `fix/` branch.

### Security

- **Automated (SAST/SCA):** run `snyk_code_scan` on new/modified code and remediate with
  **`snyk-remediation`** (see also the global CLAUDE.md).
- **Standards review (manual):** `incu-way-security-validation` (OWASP/CWE) and
  `incu-way-threat-model` for new surfaces (auth, network, external input). The custom
  frontmatter parser avoids the `gray-matter` RCE — do not reintroduce that dependency.

### Worktree (isolation)

Isolated work can happen on a branch in the current checkout or in a separate **git
worktree**. If the tree has uncommitted changes, resolve them (commit/stash) before
switching branches or creating a worktree. The worktree parent directory should be in
`.gitignore` if it lives inside the repo.
