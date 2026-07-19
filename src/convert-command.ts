import { mkdir, writeFile, readFile } from 'fs/promises';
import { dirname, join, resolve, basename } from 'path';
import * as p from '@clack/prompts';
import { AGENT_FORMATS, type AgentFormat, type ConversionWarning } from './convert/types.ts';
import { getFormatSpec, resolveFormatName, FORMAT_ALIASES } from './convert/formats.ts';
import { getFormatDir, getOutputBasename } from './convert/output-paths.ts';
import { parseRules, ruleNameFromPath, FormatDetectionError } from './convert/parse/index.ts';
import { detectFormat } from './convert/detect.ts';
import { convertRuleToFormat, renderRules, isDirectory, listRuleFiles } from './convert/convert.ts';
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
      const sourceName = ruleNameFromPath(file, srcFormat);
      const spec = getFormatSpec(target);

      const docs: PlannedDoc[] = spec.single
        ? renderRules(rules, target, sourceName).map((d) => ({
            outPath: join(outDir, getOutputBasename(target, d.name)),
            content: d.content,
            inclusionLabel: 'always',
            warnings: d.warnings,
          }))
        : rules.map((rule) => {
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
