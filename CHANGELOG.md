# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Versions apply to all three published packages (`@incu/steering`, `steering-cli`,
`steering.sh`), which are released together.

## [0.6.0] — 2026-08-17

### Fixed

- **`AGENTS.md` no longer loses a source's rules when another source is installed,
  updated, removed, or converted.** `AGENTS.md` is the one format that aggregates every
  installed source into a single physical file, but every write path replaced that whole
  file with just the current source's rules. Installing a second source silently destroyed
  the first one's content — and any notes you had written in the file by hand; `remove`
  deleted the shared file outright no matter how many sources still depended on it; and
  `steering convert --to agents-md` wrote straight over everything the other commands had
  put there. Each source now owns a marker-delimited block, so writing or removing one
  never disturbs another's content or your own.
- **`steering check` no longer reports an `agents-md` source as permanently out of date.**
  For a lock entry without a stored hash, the comparison diffed the source's freshly
  rendered rules against the entire shared file — including every other source's rules —
  so it could never match. It now compares only the source's own block.
- **`steering remove` no longer reports success when it removed nothing.** Removing a
  source whose rules were not actually present in `AGENTS.md` dropped the lock entry and
  printed "Removed" while leaving the content in the file with no way to ever remove it
  through the CLI. It now says nothing was found and leaves the file alone.
- **`AGENTS.md` files with CRLF line endings are handled correctly.** Marker matching
  compared whole lines, so on a CRLF file no marker ever matched: every `add`/`update`
  appended another duplicate copy of the rules, and `remove` could not strip them.
- **A transient read error no longer overwrites `AGENTS.md`.** Any failure reading the
  existing file was treated as "the file is empty", so an unlucky `EMFILE`/`EBUSY` replaced
  the whole file with only the current source's rules. Only a genuinely missing file is
  treated as empty now; anything else surfaces as an error.

### Changed

- **`AGENTS.md` now contains `<!-- steering:begin … -->` / `<!-- steering:end … -->`
  markers** around each source's rules. They are HTML comments, so agents reading the file
  ignore them. Content you write yourself outside the blocks is preserved, and keeps its
  position when a block is rewritten.
- **`steering add` no longer prompts "already exists, overwrite?" for `AGENTS.md`.** The
  write is now a merge of one source's own block, so there is nothing destructive left to
  confirm. Multi-file formats still prompt as before.
- **`steering convert --to agents-md` merges instead of overwriting**, and aggregates every
  rule file in a directory source into one block — matching what `steering add` produces,
  so converting a source you already installed is now a no-op instead of a second copy.

### Upgrading

If you already have an `AGENTS.md` installed by an earlier version, its content has no
markers yet. On the first `add`/`update` after upgrading, that content is preserved as-is
and the source's rules are also written into a new marked block — leaving two copies. The
CLI prints a warning when it detects this; delete the older unmarked copy by hand once, and
subsequent runs are clean. Nothing is deleted automatically, because content without markers
cannot be safely attributed to a source rather than to you.

## [0.5.0] — 2026-07-22

### Added

- **Source SHA + package version in the workspace lock.** `steering-lock.json` now records
  each file's source change-detection hash (`steeringFileHash`) and the source package
  version (`sourceVersion`, from `steering.json`), alongside the global lock which already
  stored the hash. `steering list` now shows the installed package version.

### Changed

- **Faster `check`/`update`.** Both scopes now short-circuit on the stored source hash —
  when the source is unchanged there is no download or conversion. Previously the workspace
  path re-downloaded and re-converted every file to diff it against disk.
- **Workspace lock bumped to v2.** Existing v1 (hashless) locks still read: entries without
  a hash fall back to the previous download-and-diff behavior until the next `update`
  rewrites them with a hash and version. No manual migration needed.

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

[0.6.0]: https://github.com/incu-tech/steering/releases/tag/v0.6.0
[0.5.0]: https://github.com/incu-tech/steering/releases/tag/v0.5.0
[0.4.0]: https://github.com/incu-tech/steering/releases/tag/v0.4.0
[0.3.0]: https://github.com/incu-tech/steering/releases/tag/v0.3.0
