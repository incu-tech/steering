import { mkdir, writeFile, readFile } from 'fs/promises';
import { dirname, join, resolve, basename } from 'path';
import * as p from '@clack/prompts';
import {
  AGENT_FORMATS,
  type AgentFormat,
  type CanonicalRule,
  type ConversionWarning,
} from './convert/types.ts';
import { getFormatSpec, resolveFormatName, FORMAT_ALIASES } from './convert/formats.ts';
import { getFormatDir, getOutputBasename } from './convert/output-paths.ts';
import { parseRules, FormatDetectionError } from './convert/parse/index.ts';
import { detectFormat } from './convert/detect.ts';
import { convertRuleToFormat, renderRules, isDirectory, listRuleFiles } from './convert/convert.ts';
import { writeMergedFile } from './installer.ts';
import { c, fail, info, isInteractive, warn } from './ui.ts';

export interface ConvertCliOptions {
  to?: AgentFormat;
  from?: AgentFormat;
  out?: string;
  dryRun: boolean;
  force: boolean;
  warnOnly: boolean;
  allAgents: boolean;
}

function parseAgentFormat(value: string | undefined, flag: string): AgentFormat {
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

export function parseConvertOptions(args: string[]): {
  source: string | undefined;
  options: ConvertCliOptions;
} {
  const options: ConvertCliOptions = {
    dryRun: false,
    force: false,
    warnOnly: false,
    allAgents: false,
  };
  let source: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    switch (arg) {
      case '--to':
        options.to = parseAgentFormat(args[++i], '--to');
        break;
      case '--from':
        options.from = parseAgentFormat(args[++i], '--from');
        break;
      case '--out':
      case '-o':
        options.out = args[++i];
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--force':
        options.force = true;
        break;
      case '--warn-only':
        options.warnOnly = true;
        break;
      case '--all-agents':
        options.allAgents = true;
        break;
      default:
        if (!arg.startsWith('-') && source === undefined) source = arg;
    }
  }
  return { source, options };
}

/**
 * The marker-block key for everything this run writes into a single-file target.
 *
 * It must be the source the USER named, not each expanded input file, so that it
 * matches the id `add`/`update`/`remove` use for the same source: those key a
 * local source's block by its resolved path (`resolveLocal` in src/resolve.ts
 * returns `sourceId: root`, itself `resolve(input)` from `parseSource`). Keying
 * by the individual file instead produced a SECOND block with identical content
 * for a source already installed via `add` — duplicated rules the agent reads
 * twice, in a block no lock entry tracks and therefore no `steering remove` can
 * ever clean up.
 *
 * A glob is keyed by the directory it scans, which is the directory whose rule
 * files `resolveSourceFiles` actually expands it to.
 */
function blockSourceId(source: string): string {
  return resolve(source.includes('*') ? dirname(source) || '.' : source);
}

/**
 * Document name for a single-file format's one aggregated doc. The format has a
 * fixed filename, so this never reaches the output path — it only labels the
 * rendered doc, matching what `add` passes (`planInstall` in src/add.ts).
 */
function singleFileStem(spec: { fixedName?: string }): string {
  return (spec.fixedName ?? '').replace(/\.md$/i, '').toLowerCase();
}

/** Expand a source argument into concrete file paths. */
async function resolveSourceFiles(source: string): Promise<string[]> {
  if (await isDirectory(source)) return listRuleFiles(source);
  if (source.includes('*')) {
    // Minimal glob support: list rule files in the pattern's directory.
    const dir = dirname(source) || '.';
    return listRuleFiles(dir);
  }
  return [source];
}

interface PlannedDoc {
  outPath: string;
  content: string;
  inclusionLabel: string;
  warnings: ConversionWarning[];
}

/**
 * Rules bound for one single-file target (AGENTS.md), accumulated across EVERY
 * source file in this run before a single write.
 *
 * Two separate constraints force the aggregation. A single-file format has a
 * fixed output name, so every input file resolves to the same `AGENTS.md`; and
 * the merge keys a block by the source the user named, not by each input file
 * (see `blockSourceId`). Writing per file would therefore have each file
 * replace the previous one's block — only the last would survive. Aggregating
 * first is also exactly what `add` does (`planInstall` in src/add.ts renders
 * all of a source's rules into one document), which is what makes a `convert`
 * of an already-`add`ed source a genuine no-op instead of a second copy.
 */
interface SingleFileTarget {
  outPath: string;
  rules: CanonicalRule[];
  /** Source files contributing rules, for the summary line. */
  files: string[];
}

async function confirmOverwrite(path: string, options: ConvertCliOptions): Promise<boolean> {
  if (options.force || options.dryRun) return true;
  if (!isInteractive()) {
    warn(`Skipping ${path} — already exists (use --force to overwrite).`);
    return false;
  }
  const ok = await p.confirm({ message: `${path} exists. Overwrite?`, initialValue: false });
  if (p.isCancel(ok)) {
    info('Cancelled.');
    process.exit(0);
  }
  return ok === true;
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

export async function runConvert(args: string[]): Promise<void> {
  const { source, options } = parseConvertOptions(args);

  if (!source) {
    fail('Missing source. Usage: steering convert <source> --to <format> [options]');
  }
  if (!options.to && !options.allAgents) {
    fail('Specify a target with --to <format>, or use --all-agents.');
  }

  const cwd = process.cwd();
  let files: string[];
  try {
    files = await resolveSourceFiles(source!);
  } catch {
    fail(`Source not found: ${source}`);
  }
  if (files.length === 0) {
    fail(`No rule files found at ${source}.`);
  }

  let totalConverted = 0;
  const allWarnings: ConversionWarning[] = [];
  const sourceId = blockSourceId(source!);
  const singleTargets = new Map<AgentFormat, SingleFileTarget>();

  for (const file of files) {
    let srcFormat: AgentFormat;
    let rules;
    try {
      const parsed = await parseRules(file, options.from);
      srcFormat = parsed.format;
      rules = parsed.rules;
    } catch (err) {
      if (err instanceof FormatDetectionError) {
        fail(err.message);
      }
      throw err;
    }

    const targets = options.allAgents
      ? AGENT_FORMATS.filter((f) => f !== srcFormat)
      : [options.to!];

    for (const target of targets) {
      const outDir = options.allAgents
        ? getFormatDir(target, false, cwd)
        : (options.out ?? getFormatDir(target, false, cwd));
      const spec = getFormatSpec(target);

      // A single-file target is written once, after every file has been parsed —
      // see `SingleFileTarget`. Collect this file's rules and move on.
      if (spec.single) {
        const outPath = join(outDir, getOutputBasename(target, singleFileStem(spec)));
        // Never clobber the source file itself (identity / --all-agents).
        if (resolve(outPath) === resolve(file)) continue;
        const acc = singleTargets.get(target) ?? { outPath, rules: [], files: [] };
        acc.rules.push(...rules);
        acc.files.push(file);
        singleTargets.set(target, acc);
        // No per-file line here: the single write is reported once on flush
        // below, which would otherwise leave a header with nothing under it.
        continue;
      }

      const docs: PlannedDoc[] = rules.map((rule) => {
        const { content, warnings } = convertRuleToFormat(rule, target);
        return {
          outPath: join(outDir, getOutputBasename(target, rule.name)),
          content,
          inclusionLabel: rule.inclusion,
          warnings,
        };
      });

      info(`${c.bold(basename(file))} ${c.dim(`(${srcFormat})`)} → ${spec.displayName}`);
      for (const doc of docs) {
        // Never clobber the source file itself (identity / --all-agents).
        if (resolve(doc.outPath) === resolve(file)) continue;

        if (!options.dryRun && (await exists(doc.outPath))) {
          if (!(await confirmOverwrite(doc.outPath, options))) continue;
        }
        if (!options.dryRun) {
          await mkdir(dirname(doc.outPath), { recursive: true });
          await writeFile(doc.outPath, doc.content, 'utf-8');
        }

        const mark = doc.warnings.length ? c.yellow('⚠') : c.green('✓');
        const detail = doc.warnings.length
          ? c.dim(`  [${doc.warnings.map((w) => w.appliedFallback || w.type).join(', ')}]`)
          : '';
        info(`  ${c.dim(doc.inclusionLabel.padEnd(9))} ${doc.outPath} ${mark}${detail}`);
        allWarnings.push(...doc.warnings);
        totalConverted++;
      }
    }
  }

  // Flush the aggregated single-file targets: one merged write per format, under
  // the block id of the source the user named. No "already exists, overwrite?"
  // prompt — the merge replaces only this source's own block, so unlike the old
  // raw `writeFile` (which destroyed every other source's block plus any
  // hand-written content) there is nothing destructive left to confirm.
  for (const [target, acc] of singleTargets) {
    const spec = getFormatSpec(target);
    const [doc] = renderRules(acc.rules, target, singleFileStem(spec));
    if (!doc) continue;

    if (!options.dryRun) {
      const { legacyContentDetected } = await writeMergedFile(acc.outPath, doc.content, sourceId);
      if (legacyContentDetected) {
        warn(
          `${acc.outPath} already had content but no steering markers — preserving it as-is. ` +
            'If this was an older conversion of this same source, remove the duplicate manually.'
        );
      }
    }

    const mark = doc.warnings.length ? c.yellow('⚠') : c.green('✓');
    const detail = doc.warnings.length
      ? c.dim(`  [${doc.warnings.map((w) => w.appliedFallback || w.type).join(', ')}]`)
      : '';
    const from = acc.files.length === 1 ? basename(acc.files[0]!) : `${acc.files.length} files`;
    info(`${c.bold(spec.displayName)} ${c.dim(`(${from})`)}`);
    info(`  ${c.dim('always'.padEnd(9))} ${acc.outPath} ${mark}${detail}`);
    allWarnings.push(...doc.warnings);
    totalConverted++;
  }

  info('');
  const noun = totalConverted === 1 ? 'file' : 'files';
  const suffix = options.dryRun ? c.dim(' (dry run — nothing written)') : '';
  info(
    `${totalConverted} ${noun} converted, ${allWarnings.length} warning${allWarnings.length === 1 ? '' : 's'}.${suffix}`
  );

  if (allWarnings.length) {
    info('');
    info(c.bold('Warnings:'));
    for (const w of allWarnings) info(`  ${c.yellow('!')} ${w.message}`);
  }
}
