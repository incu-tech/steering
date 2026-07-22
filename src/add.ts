import { existsSync } from 'fs';
import { join, relative } from 'path';
import * as p from '@clack/prompts';
import { parseSource } from './source-parser.ts';
import { resolveSource, ResolveError, type ResolvedSource } from './resolve.ts';
import { ManifestError, filterByName } from './steering.ts';
import { fileExists, getInstalledPath, getTargetDir, writeRuleFile } from './installer.ts';
import { addToGlobalLock } from './steering-lock.ts';
import { addToLocalLock } from './local-lock.ts';
import { AGENT_FORMATS, type AgentFormat } from './convert/types.ts';
import { FORMATS, getFormatSpec, resolveFormatName, FORMAT_ALIASES } from './convert/formats.ts';
import { renderRules, type RenderedDoc } from './convert/convert.ts';
import { getOutputBasename } from './convert/output-paths.ts';
import { c, fail, info, isInteractive, success, warn } from './ui.ts';
import type { SteeringFile } from './types.ts';

export interface AddOptions {
  list: boolean;
  steeringNames: string[];
  all: boolean;
  global: boolean;
  yes: boolean;
  dryRun: boolean;
  /** Target agent formats (repeatable --agent). Empty → auto-detect. */
  agents: AgentFormat[];
  /** Install to every agent detected in the workspace. */
  allAgents: boolean;
  /** Install to all 8 supported formats, detected or not. */
  allFormats: boolean;
  /** Source format override (auto-detected per file when omitted). */
  from?: AgentFormat;
}

function parseFormatFlag(value: string | undefined, flag: string): AgentFormat {
  const resolved = value ? resolveFormatName(value) : undefined;
  if (resolved) {
    if (value !== resolved) info(c.dim(`${flag} ${value} → ${resolved}`));
    return resolved;
  }
  fail(
    `Invalid ${flag} format "${value ?? ''}". Valid: ${AGENT_FORMATS.join(', ')} ` +
      `(also accepted: ${Object.keys(FORMAT_ALIASES).join(', ')})`
  );
}

export function parseAddOptions(args: string[]): {
  source: string | undefined;
  options: AddOptions;
} {
  const options: AddOptions = {
    list: false,
    steeringNames: [],
    all: false,
    global: false,
    yes: false,
    dryRun: false,
    agents: [],
    allAgents: false,
    allFormats: false,
  };
  let source: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    switch (arg) {
      case '--list':
      case '-l':
        options.list = true;
        break;
      case '--steering':
      case '-s': {
        const next = args[++i];
        if (next) options.steeringNames.push(next);
        break;
      }
      case '--all':
        options.all = true;
        break;
      case '--agent':
        options.agents.push(parseFormatFlag(args[++i], '--agent'));
        break;
      case '--all-agents':
        options.allAgents = true;
        break;
      case '--all-formats':
        options.allFormats = true;
        break;
      case '--from':
        options.from = parseFormatFlag(args[++i], '--from');
        break;
      case '--global':
      case '-g':
        options.global = true;
        break;
      case '--yes':
      case '-y':
        options.yes = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      default:
        if (!arg.startsWith('-') && source === undefined) {
          source = arg;
        }
    }
  }

  return { source, options };
}

function inclusionTag(file: SteeringFile): string {
  return c.dim(`[${file.inclusion}]`);
}

/**
 * Paths whose presence signals an agent is in use: its rules dir/file plus the
 * parent agent dir (e.g. `.cursor` when `.cursor/rules` doesn't exist yet).
 * `.github` is intentionally excluded — it exists in almost every repo and would
 * falsely flag Copilot.
 */
function presenceMarkers(format: AgentFormat): string[] {
  const marker = FORMATS[format].marker;
  const markers = [marker];
  const slash = marker.indexOf('/');
  if (slash !== -1) {
    const parent = marker.slice(0, slash);
    if (parent !== '.github') markers.push(parent);
  }
  return markers;
}

/** Agent formats detected as in use in the workspace. */
function detectPresentFormats(cwd: string): AgentFormat[] {
  return AGENT_FORMATS.filter((f) => presenceMarkers(f).some((m) => existsSync(join(cwd, m))));
}

/** De-duplicate formats, preserving first-seen order. */
function dedupeFormats(formats: AgentFormat[]): AgentFormat[] {
  return [...new Set(formats)];
}

/**
 * Resolve the set of target formats (PRD FR-1..FR-4):
 *   - explicit `--agent` (repeatable) → those
 *   - `--all-formats` → all 8
 *   - `--all-agents` → detected (error if none)
 *   - auto: 0 detected → kiro; 1 → it; many → multiselect (TTY) / all (no-TTY)
 */
async function resolveTargetFormats(
  options: AddOptions,
  present: AgentFormat[]
): Promise<AgentFormat[]> {
  if (options.agents.length > 0) return dedupeFormats(options.agents);
  if (options.allFormats) return [...AGENT_FORMATS];
  if (options.allAgents) {
    if (present.length === 0) {
      fail(
        `No agent detected in this workspace. Use ${c.cyan('--agent <fmt>')} or ${c.cyan('--all-formats')}.`
      );
    }
    return present;
  }

  if (present.length === 0) return ['kiro'];
  if (present.length === 1) return present;

  if (isInteractive()) {
    const choice = await p.multiselect({
      message: 'Multiple agents detected. Install for which ones?',
      options: present.map((f) => ({ value: f, label: FORMATS[f].displayName })),
      initialValues: present,
      required: true,
    });
    if (p.isCancel(choice)) {
      info('Cancelled.');
      process.exit(0);
    }
    return choice as AgentFormat[];
  }

  info(
    `Multiple agents detected; installing to all (${present.map((f) => FORMATS[f].displayName).join(', ')}). Use --agent to narrow.`
  );
  return present;
}

/** Workspace install unless --global; never silently escalates to global. */
async function resolveScope(
  options: AddOptions,
  cwd: string,
  present: AgentFormat[],
  targets: AgentFormat[]
): Promise<{ global: boolean }> {
  if (options.global) return { global: true };
  // Explicitly naming targets (--agent / --all-formats) signals workspace intent
  // even before the agent's dir exists — we'll create it.
  const explicitTargets = options.agents.length > 0 || options.allFormats;
  const workspaceLike =
    explicitTargets ||
    present.length > 0 ||
    existsSync(join(cwd, '.kiro')) ||
    existsSync(join(cwd, 'AGENTS.md'));
  if (workspaceLike) return { global: false };

  // No agent dirs here. A global install touches every workspace on the
  // machine, so it must be an explicit choice: ask when we can, and fall back
  // to the workspace (never global) when we can't.
  const workspaceDir = relative(cwd, getTargetDir(false, cwd, targets[0])) || '.';
  const globalDir = getTargetDir(true, cwd, targets[0]);
  if (!options.yes && isInteractive()) {
    const choice = await p.select({
      message: 'No agent detected in this workspace. Where should the files be installed?',
      options: [
        { value: 'workspace', label: `This workspace (${workspaceDir}/)` },
        { value: 'global', label: `Globally, for every workspace (${globalDir}/)` },
      ],
      initialValue: 'workspace',
    });
    if (p.isCancel(choice)) {
      info('Cancelled.');
      process.exit(0);
    }
    return { global: choice === 'global' };
  }
  info(
    `No agent detected in this workspace — installing to ${c.cyan(`${workspaceDir}/`)}. ` +
      `Use ${c.cyan('--global')} for a machine-wide install.`
  );
  return { global: false };
}

function printAvailable(resolved: ResolvedSource): void {
  info(`${c.bold('Available steering files')} ${c.dim(`(${resolved.sourceId})`)}`);
  const pad = Math.max(...resolved.files.map((f) => f.name.length));
  for (const f of resolved.files) {
    const desc = f.description ? `  ${c.dim(f.description)}` : '';
    info(`  ${f.name.padEnd(pad)}  ${inclusionTag(f)} ${c.dim(`(${f.sourceFormat})`)}${desc}`);
  }
}

async function selectFiles(resolved: ResolvedSource, options: AddOptions): Promise<SteeringFile[]> {
  // Explicit -s names: filter, erroring on unknown names.
  if (options.steeringNames.length > 0) {
    const selected: SteeringFile[] = [];
    for (const name of options.steeringNames) {
      const matches = filterByName(resolved.files, name);
      if (matches.length === 0) {
        fail(
          `No steering file named "${name}" in ${resolved.sourceId}. ` +
            `Available: ${resolved.files.map((f) => f.name).join(', ')}`
        );
      }
      selected.push(...matches);
    }
    return [...new Map(selected.map((f) => [f.name, f])).values()];
  }

  if (options.all) return resolved.files;

  if (!isInteractive()) {
    fail(
      `Multiple steering files found and no selection given.\n` +
        `  Use ${c.cyan('--all')} to install all, ${c.cyan('-s <name>')} to pick, ` +
        `or ${c.cyan('--list')} to see them.`
    );
  }

  const choice = await p.multiselect({
    message: `Select steering files to install from ${resolved.sourceId}`,
    options: resolved.files.map((f) => ({
      value: f.name,
      label: `${f.name} ${c.dim(`[${f.inclusion}]`)}`,
      hint: f.description || undefined,
    })),
    required: true,
  });

  if (p.isCancel(choice)) {
    info('Cancelled.');
    process.exit(0);
  }

  const chosen = new Set(choice as string[]);
  return resolved.files.filter((f) => chosen.has(f.name));
}

async function confirmOverwrite(name: string, path: string, options: AddOptions): Promise<boolean> {
  if (options.yes) return true;
  if (!isInteractive()) {
    warn(`Skipping "${name}" — already exists at ${path} (use ${c.cyan('--yes')} to overwrite).`);
    return false;
  }
  const ok = await p.confirm({
    message: `"${name}" already exists. Overwrite?`,
    initialValue: false,
  });
  if (p.isCancel(ok)) {
    info('Cancelled.');
    process.exit(0);
  }
  return ok === true;
}

/** A unit of installation: one source file → one or more rendered documents. */
interface InstallUnit {
  file: SteeringFile;
  docs: RenderedDoc[];
}

/** Build install units, aggregating into a single doc for single-file targets. */
function planInstall(selected: SteeringFile[], targetFormat: AgentFormat): InstallUnit[] {
  if (getFormatSpec(targetFormat).single) {
    // Single-file target (AGENTS.md): aggregate every rule into one document,
    // attributed to the first source file for lock bookkeeping.
    const allRules = selected.flatMap((f) => f.rules);
    const docs = renderRules(
      allRules,
      targetFormat,
      getFormatSpec(targetFormat).fixedName!.replace(/\.md$/i, '').toLowerCase()
    );
    return [{ file: selected[0]!, docs }];
  }
  return selected.map((file) => {
    // Identity install (e.g. the kiro→kiro enterprise case): write the source
    // bytes verbatim — no reformatting needed, and it keeps installs
    // byte-faithful to upstream. `update` mirrors this in reconstructContent.
    if (file.sourceFormat === targetFormat) {
      return { file, docs: [{ name: file.name, content: file.content, warnings: [] }] };
    }
    return { file, docs: renderRules(file.rules, targetFormat, file.name) };
  });
}

export async function runAdd(source: string | undefined, options: AddOptions): Promise<void> {
  if (!source) {
    fail(`Missing source. Usage: ${c.cyan('steering add <owner/repo | ./path>')}`);
  }

  const parsed = parseSource(source!);

  let resolved: ResolvedSource;
  try {
    resolved = await resolveSource(parsed, options.from);
  } catch (err) {
    if (err instanceof ManifestError || err instanceof ResolveError) {
      fail(err.message);
    }
    throw err;
  }

  if (options.list) {
    printAvailable(resolved);
    return;
  }

  const selected = await selectFiles(resolved, options);
  if (selected.length === 0) {
    info('Nothing selected.');
    return;
  }

  // Surface non-fatal frontmatter warnings from discovery.
  for (const f of selected) {
    for (const w of f.warnings) warn(w);
  }

  const cwd = process.cwd();
  const present = detectPresentFormats(cwd);
  const targets = await resolveTargetFormats(options, present);
  const { global } = await resolveScope(options, cwd, present, targets);

  const scopeOf = (targetFormat: AgentFormat): string => {
    const targetDir = getTargetDir(global, cwd, targetFormat);
    return global
      ? `global (${targetDir})`
      : `workspace (${relative(cwd, targetDir) || getFormatSpec(targetFormat).dir}/)`;
  };

  if (options.dryRun) {
    info(`${c.bold('Dry run')} — would install:`);
    for (const targetFormat of targets) {
      info(`  ${c.bold(getFormatSpec(targetFormat).displayName)} → ${scopeOf(targetFormat)}`);
      for (const unit of planInstall(selected, targetFormat)) {
        for (const doc of unit.docs) {
          const detail = doc.warnings.length
            ? c.yellow(` ⚠ ${doc.warnings.length} warning(s)`)
            : '';
          info(`    ${getOutputBasename(targetFormat, doc.name)}${detail}`);
        }
      }
    }
    return;
  }

  let installed = 0;
  const agentsUsed = new Set<AgentFormat>();

  for (const targetFormat of targets) {
    for (const { file, docs } of planInstall(selected, targetFormat)) {
      for (const doc of docs) {
        const targetPath = getInstalledPath(doc.name, global, cwd, targetFormat);
        if (await fileExists(targetPath)) {
          const ok = await confirmOverwrite(doc.name, targetPath, options);
          if (!ok) continue;
        }

        await writeRuleFile(targetFormat, doc.name, doc.content, global, cwd);

        if (global) {
          await addToGlobalLock({
            name: doc.name,
            source: resolved.sourceId,
            sourceType: resolved.sourceType,
            sourceUrl: resolved.sourceUrl,
            ref: resolved.ref,
            steeringFilePath: file.repoPath,
            steeringFileHash: file.hash,
            ...(file.sourceVersion ? { sourceVersion: file.sourceVersion } : {}),
            sourceFormat: file.sourceFormat,
            targetFormat,
            scope: 'global',
          });
        } else {
          // Keep the committed lock small for the common kiro→kiro case (no
          // format churn); only record formats when conversion is involved.
          const isNativeKiro = file.sourceFormat === 'kiro' && targetFormat === 'kiro';
          await addToLocalLock(
            {
              name: doc.name,
              source: resolved.sourceId,
              steeringFilePath: file.repoPath,
              steeringFileHash: file.hash,
              ...(file.sourceVersion ? { sourceVersion: file.sourceVersion } : {}),
              ...(isNativeKiro ? {} : { sourceFormat: file.sourceFormat, targetFormat }),
            },
            cwd
          );
        }

        for (const w of doc.warnings) warn(w.message);
        success(
          `${getOutputBasename(targetFormat, doc.name)} ${c.dim(`(${file.sourceFormat}→${targetFormat})`)}`
        );
        installed++;
        agentsUsed.add(targetFormat);
      }
    }
  }

  info('');
  const agentList = [...agentsUsed].map((f) => getFormatSpec(f).displayName).join(', ');
  const scopeWord = global ? 'global' : 'workspace';
  info(
    `Installed ${c.bold(String(installed))} file${installed === 1 ? '' : 's'} across ` +
      `${agentsUsed.size} agent${agentsUsed.size === 1 ? '' : 's'} (${agentList}) [${scopeWord}]`
  );
  if (!global) {
    info(c.dim(`Commit ${c.cyan('steering-lock.json')} to share with your team.`));
  }
}
