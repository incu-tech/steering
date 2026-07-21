# PRD — `steering` (product overview)

> Entry document for humans and for the incu-way flows. It is a **reverse-engineered
> overview** of the product as it exists today; the technical detail lives in
> [`docs/architecture/`](docs/architecture/) and the per-feature specs in
> [`docs/prds/`](docs/prds/).

## What it is

`steering` is a **CLI distributed via `npx`** that manages AI-agent *steering files*
(context/rule files) the same way `npx skills` manages Agent Skills: **packaging,
installing, updating, and removing** context files from Git repositories (public and
private) and local paths.

It is published on npm under three names over the same tool:
- **`@incu/steering`** — canonical package (all the logic + library).
- **`steering.sh`** and **`steering-cli`** — thin aliases in `aliases/` that depend on
  `@incu/steering`.

Inspired by [`vercel-labs/skills`](https://github.com/vercel-labs/skills) (MIT).

## Who it's for

Teams that standardize their AI agents' context through versioned repos — particularly
**enterprise / banking** environments that host that context on GitHub, GitLab,
Bitbucket, or self-hosted Git, and want to install/update it reproducibly and share it
per team.

## Core capabilities

- **`add`** — installs steering files from a source (`owner/repo`, a Git URL, or a local
  path), autodetecting the workspace agent(s) and converting to each one's native format.
- **`check` / `update`** — detects upstream changes (via git blob SHA) and updates the
  installed files.
- **`remove` / `list`** — uninstalls and lists what is installed.
- **Multi-format conversion** — a file is authored once (Kiro as the pivot format) and
  installed/converted to `claude-code`, `cursor`, `windsurf`, `copilot`, `opencode`,
  `agents-md`, `cline`.

## Scope and non-goals

- It is **not** a registry/website (that is the future `steering.sh`).
- It does **not** manage per-host tokens: auth for private repos is delegated to the
  GitHub config (token/`gh`) or to the user's `git` (SSH / credential helper).
- It does **not** change the conversion model nor add formats beyond those supported.

## Status and features

- Implemented base: installation from **GitHub** (API) and **local paths**, multi-format
  conversion, local (workspace) and global locks, `check`/`update`.
- Per-feature PRDs in [`docs/prds/`](docs/prds/):
  - `000-initial` — base CLI + conversion subsystem.
  - `001-multi-target-add` — `add` to multiple agents/formats.
  - `002-git-sources` — installing from **any Git remote** (in progress).

## Architecture

See [`docs/architecture/overview.md`](docs/architecture/overview.md) for the design of the
`source → discover → convert → install → lock` pipeline and its components.
