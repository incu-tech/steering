import { mkdir, writeFile, readdir, stat } from 'fs/promises';
import { dirname, join } from 'path';
import { getFormatSpec } from './formats.ts';
import { degradeForTarget } from './degradation.ts';
import { serializeRule } from './serialize/index.ts';
import { parseRules, ruleNameFromPath } from './parse/index.ts';
import { detectFormat } from './detect.ts';
import { getFormatDir, getOutputBasename } from './output-paths.ts';
import type {
  AgentFormat,
  CanonicalRule,
  ConversionResult,
  ConversionWarning,
} from './types.ts';

/** Degrade + serialize a single rule. Pure (no IO). */
export function convertRuleToFormat(
  rule: CanonicalRule,
  format: AgentFormat
): { content: string; warnings: ConversionWarning[] } {
  const { rule: degraded, warnings } = degradeForTarget(rule, format);
  const all = [...warnings];
  if (degraded.body.trim() === '') {
    all.push({
      type: 'empty_body',
      message: `${rule.name}: body is empty — generated anyway.`,
      originalValue: '',
      appliedFallback: '',
    });
  }
  return { content: serializeRule(degraded, format), warnings: all };
}

export interface RenderedDoc {
  /** Rule name used to derive the on-disk filename. */
  name: string;
  content: string;
  warnings: ConversionWarning[];
}

/**
 * Turn one source's canonical rules into the document(s) to write, without
 * touching disk. Single-file formats (AGENTS.md) combine every rule into one
 * document; multi-file formats yield one document per rule. Reused by `convert`,
 * the `add` pipeline, and `update`.
 */
export function renderRules(
  rules: CanonicalRule[],
  format: AgentFormat,
  sourceName: string
): RenderedDoc[] {
  const spec = getFormatSpec(format);

  if (spec.single) {
    const warnings: ConversionWarning[] = [];
    const parts: string[] = [];
    for (const rule of rules) {
      const { content, warnings: w } = convertRuleToFormat(rule, format);
      warnings.push(...w);
      if (content.trim() !== '') parts.push(content.trimEnd());
    }
    const combined = parts.length ? `${parts.join('\n\n')}\n` : '';
    return [{ name: sourceName, content: combined, warnings }];
  }

  return rules.map((rule) => {
    const { content, warnings } = convertRuleToFormat(rule, format);
    return { name: rule.name, content, warnings };
  });
}

export interface ConvertOptions {
  /** Path to a single source file. */
  source: string;
  targetFormat: AgentFormat;
  /** Target directory; defaults to the format's standard dir under `cwd`. */
  outputDir?: string;
  /** Source format; auto-detected when omitted. */
  from?: AgentFormat;
  /** Compute results without writing any files. */
  dryRun?: boolean;
  cwd?: string;
}

/** Convert a single source file, writing the result(s) to disk. */
export async function convert(options: ConvertOptions): Promise<ConversionResult[]> {
  const cwd = options.cwd ?? process.cwd();
  const { rules } = await parseRules(options.source, options.from);
  const sourceName = ruleNameFromPath(
    options.source,
    options.from ?? detectFormat(options.source).format ?? 'kiro'
  );
  const dir = options.outputDir ?? getFormatDir(options.targetFormat, false, cwd);

  const docs = renderRules(rules, options.targetFormat, sourceName);
  const results: ConversionResult[] = [];

  for (const doc of docs) {
    const outputPath = join(dir, getOutputBasename(options.targetFormat, doc.name));
    if (!options.dryRun) {
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, doc.content, 'utf-8');
    }
    results.push({
      sourcePath: options.source,
      outputPath,
      targetFormat: options.targetFormat,
      warnings: doc.warnings,
    });
  }
  return results;
}

const RULE_FILE = /(\.mdc|\.md)$/i;

/** List rule-like files directly inside a directory (non-recursive). */
export async function listRuleFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && RULE_FILE.test(e.name))
    .map((e) => join(dir, e.name))
    .sort();
}

export interface ConvertDirectoryOptions {
  sourceDir: string;
  targetFormat: AgentFormat;
  outputDir?: string;
  from?: AgentFormat;
  dryRun?: boolean;
  cwd?: string;
}

/** Convert every rule file in a directory. */
export async function convertDirectory(
  options: ConvertDirectoryOptions
): Promise<ConversionResult[]> {
  const files = await listRuleFiles(options.sourceDir);
  const results: ConversionResult[] = [];
  for (const file of files) {
    results.push(
      ...(await convert({
        source: file,
        targetFormat: options.targetFormat,
        outputDir: options.outputDir,
        from: options.from,
        dryRun: options.dryRun,
        cwd: options.cwd,
      }))
    );
  }
  return results;
}

/** True if `path` is a directory. */
export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
