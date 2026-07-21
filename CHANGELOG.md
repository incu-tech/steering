# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Versions apply to all three published packages (`@incu/steering`, `steering-cli`,
`steering.sh`), which are released together.

## [0.4.0] — 2026-07-21

### Added

- **skills-CLI agent-name aliases.** `--agent`, `--to`, and `--from` now accept the agent
  names used by the `skills` CLI, mapped to steering's canonical format ids:
  `github-copilot` → `copilot`, `codex` and `universal` → `agents-md`, `kiro-cli` → `kiro`.
  Both tools now accept the same values. Canonical ids are unchanged and remain what gets
  persisted in lock files, so existing installs are unaffected.

## [0.3.0] — 2026-07-21

### Added

- **Install from any git remote.** `steering add` now supports GitLab, Bitbucket,
  Azure DevOps, Gitea, and self-hosted Git over HTTPS or SSH — not just GitHub. Non-GitHub
  remotes are shallow-cloned into a temp dir and discovered with the same
  `steering.json` → `steering/` → root precedence as before.
- **Delegated git auth.** Generic git remotes use your own git credentials (SSH agent /
  credential helper) — no `GITHUB_TOKEN` or `gh` required. `steering` never prompts for
  credentials (`GIT_TERMINAL_PROMPT=0`).
- **SSH source recognition.** `git@host:path`, the colon-less `git@host/path`, and
  `ssh://git@host[:port]/path` are all detected as SSH clone sources. A pasted GitLab
  browse path (`…/-/tree/<ref>/<subpath>`) is split into a cloneable SSH URL plus `ref`
  and `subpath`.
- **Host-agnostic `check` / `update`.** Change detection for git remotes uses the git blob
  SHA (computed locally), matching the GitHub path — no host API calls. Clones are cached
  per `(source, ref)` within a run and cleaned up afterward.

### Fixed

- A colon-less SSH URL (`git@host/group/repo…`) was mistakenly parsed as a GitHub
  `owner/repo` shorthand and routed to the GitHub API. It is now recognized as an SSH
  clone source.

### Notes

- No regression to the GitHub path: GitHub repos are still read through the API (no clone),
  with the token looked up lazily only for private repos.
- Not yet supported: sparse/partial clone for large repos, per-host token management
  (GitLab PAT / Bitbucket app password), and non-git `well-known` single-file URLs.

## Previous releases

Releases up to and including `v0.2.3` predate this changelog; see the git history and the
`vX.Y.Z` tags for details.

[0.4.0]: https://github.com/incu-tech/steering/releases/tag/v0.4.0
[0.3.0]: https://github.com/incu-tech/steering/releases/tag/v0.3.0
