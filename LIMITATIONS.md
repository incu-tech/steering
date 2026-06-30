# Known limitations & triage — Universal Agent Rule Converter

Conscious design decisions, known gaps, and security-scan triage for the rule
converter (`src/convert/`) and its integration into the `steering` CLI
(`add`/`update`/`convert`). These are **deliberate** and documented here so they
aren't mistaken for bugs. See `docs/prds/000-initial/PRD-converter.md` and
`docs/prds/000-initial/PLAN.md` for the full design.

---

## 1. Conversion behavior

### 1.1 `kiro→kiro` is verbatim; cross-format installs are re-serialized
`add` writes the **source bytes unchanged** when the source and target formats
are the same (the common Kiro→Kiro enterprise case). When the target differs,
files are parsed to the canonical model and **re-serialized**, so installed bytes
will not be byte-identical to the upstream file (key order, quoting, and spacing
are normalized deterministically).

- **Why:** intended per the project decision *"reformat based on target"*. The
  identity short-circuit preserves fidelity for the enterprise case and avoids
  spurious *"update available"* reports for pre-existing installs.
- **Mirror:** `update`'s change detection mirrors this — identity installs
  compare raw bytes; converted installs re-convert and compare.

### 1.2 `description` on a `fileMatch` rule is dropped silently
A Cursor/Windsurf rule may legally carry both `globs` (→ `fileMatch`) and a
`description`. The canonical model treats `description` as **`auto`-only**, so
when a `fileMatch` rule is converted to any format, the description is dropped
**without a warning**.

- **Why:** inherent to the canonical model (`docs/prds/000-initial/PRD-converter.md` §3). No target
  format represents "fileMatch + description" simultaneously.
- **Workaround:** none automatic. If the description matters, model the rule as
  `auto` (drop the globs) or keep it in the body.
- **Possible future fix:** emit a `degraded_inclusion`-style warning when a
  non-empty `description` is discarded.

### 1.3 Format detection defaults instead of prompting on ambiguity
Auto-detection (`detect.ts`) cannot always disambiguate two formats that share a
frontmatter shape:

| Ambiguous signal | Resolves to | Alternatives |
|---|---|---|
| `paths:` array | `claude-code` | `opencode` |
| `globs:` / `alwaysApply:` | `cursor` | `windsurf` |
| `.mdc` extension | `cursor` | `windsurf` |

The converter **silently picks the first option** rather than prompting
(`docs/prds/000-initial/PRD-converter.md` §7 suggested a prompt). The
`alternatives` field is computed but not surfaced in
`add`/`convert`.

- **Workaround:** pass `--from <format>` to force the source format explicitly.

### 1.4 `--out` is a directory only
The `convert` CLI's `--out` flag is treated as an **output directory**. A
full output **file path** (`docs/prds/000-initial/PRD-converter.md` §5.2 allows it) is not supported; the filename is
always derived from the rule name + target format's extension.

### 1.5 `AGENTS.md` as a target aggregates; as a source it splits
- **Source:** `AGENTS.md` is split into one canonical rule per `##` (H2) section;
  content before the first `##` (the preamble), if non-empty, becomes a rule
  named after the file.
- **Target:** `AGENTS.md` is a single flat file, so converting **multiple**
  sources to `agents-md` aggregates them into one file. `fileMatch`/`manual`/
  `auto` rules degrade to `always` (a comment preserves the original pattern for
  `fileMatch`).
- **Lock/`remove` caveat:** an aggregated `AGENTS.md` install is tracked under a
  single lock entry; per-section round-tripping back out is best-effort.

---

## 2. Lock & update model

- **Global lock** (`~/.steering/steering-lock.json`, **not** committed): bumped to
  **v4**, stores the **source** blob SHA plus `sourceFormat`/`targetFormat`.
  `check` compares the source hash (cheap, no content download); `update`
  re-downloads and re-converts. Reading a pre-v4 lock resets it (re-`add` to
  repopulate).
- **Local lock** (`steering-lock.json`, committed): intentionally **hashless**
  to minimize merge conflicts. Stores only stable fields, and **omits**
  `sourceFormat`/`targetFormat` entirely for the `kiro→kiro` case. `check`
  re-downloads the source, re-converts, and diffs against the installed file —
  so a content fetch happens per file on workspace `check` (the accepted cost of
  staying hashless).
- **Determinism requirement:** because workspace `check` compares re-converted
  output byte-for-byte, serializers must be byte-deterministic. This is enforced
  (stable YAML key order, `lineWidth: 0`) and covered by a determinism test.

### 2.1 Multi-target lock keys (feature 001-multi-target-add)
`steering add` can install one steering to several agents at once (`--agent`
repeatable, `--all-agents`, `--all-formats`). The lock keys a name **bare**
(`security`) when it lives in a single format and **composite** (`security@kiro`,
`security@cursor`) when it spans several — readers always use `entry.name` /
`entry.targetFormat`, never the key.

- **Merge edge:** the bare-when-single scheme trades a little merge-friendliness in
  one narrow case: if two branches each add the **same** steering name to a
  **different** single agent, both write the bare key `security` → a git conflict on
  merge. This surfaces as a **visible conflict** (not silent loss); an
  always-composite scheme would auto-merge but would churn every single-target lock.
  We chose bare-when-single to keep the common case clean. *(Decision OQ4.)*
- **`--all-agents` vs `convert --all-agents`:** same flag name, sibling commands,
  **different** semantics by design. `add --all-agents` = agents **detected** in the
  workspace, identity `kiro→kiro` is a valid target, nothing excluded.
  `convert --all-agents` = all formats **except** the source, and ignores `--out`.
- **Single-file target (AGENTS.md) with multiple sources** still aggregates into one
  file (see 1.5); installing many sources to `agents-md` is tracked under one entry.

---

## 3. Security scan triage (Snyk SAST)

`snyk code test src/` → **0 HIGH, 0 MEDIUM, 4 LOW**. The Snyk **MCP** server was
not connected in the implementing session; the **CLI** was used as the fallback.
All four LOW findings are accepted risk:

| Finding | Location | Disposition |
|---|---|---|
| Insecure hash (sha1) | `blob.ts:199` | **Accepted / required.** This is `computeGitBlobSha` — a git blob SHA *is* sha1 by definition (content addressing, not a password hash). Pre-existing code, not introduced by the converter. |
| Path traversal → `readdir` | `cli.ts` (convert routing) | **Accepted.** User-supplied CLI path used to list a directory — the intended purpose of a local file-conversion CLI. |
| Path traversal → `writeFile` | `cli.ts` (convert routing) | **Accepted.** As above, for writing converted output to a user-chosen path. |
| Path traversal → `writeFile` | `convert-cli.ts:6` | **Accepted.** Standalone `steering-convert` entry; same rationale. |

**Note on untrusted input:** the genuine risk vector — a hostile **remote**
manifest/repo controlling output paths — is mitigated independently:
`sanitizeName` (`src/convert/output-paths.ts`) strips path separators and `..`
from rule-derived filenames, and install directories come from fixed per-format
locations (`getFormatDir`), never from remote content.

---

## 4. Out of scope (v1)

- No registry/website (that's the future `steering.sh` product).
- `--out` as a file path (see 1.4).
- Interactive disambiguation prompt for ambiguous detection (see 1.3).
- Legacy single-file rule formats (`.cursorrules`, `.windsurfrules`) are
  **detected** but not first-class install/convert targets.
