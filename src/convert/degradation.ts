import { getFormatSpec, supportsInclusion } from './formats.ts';
import type { AgentFormat, CanonicalRule, ConversionWarning } from './types.ts';

export interface DegradeResult {
  /** Rule transformed so it is representable in the target format. */
  rule: CanonicalRule;
  warnings: ConversionWarning[];
}

/**
 * Transform a canonical rule so it can be faithfully serialized into `format`,
 * emitting a warning for every unavoidable semantic loss. After this runs, the
 * rule's inclusion mode is guaranteed to be in the format's `supports`, and any
 * Copilot multi-pattern truncation has been applied.
 *
 * @see docs/prds/000-initial/PRD-converter.md §4, §4.1
 */
export function degradeForTarget(rule: CanonicalRule, format: AgentFormat): DegradeResult {
  const spec = getFormatSpec(format);
  const warnings: ConversionWarning[] = [];
  let r: CanonicalRule = { ...rule };

  // 1. Inclusion mode not representable in the target.
  if (!supportsInclusion(format, r.inclusion)) {
    if (format === 'agents-md' || format === 'cline') {
      // Flat formats: only `always`. fileMatch keeps its content but loses its
      // activation condition (noted as a leading comment); manual/auto collapse.
      if (r.inclusion === 'fileMatch' && r.filePatterns?.length) {
        const patterns = r.filePatterns.join(', ');
        r.body = `<!-- ${spec.displayName}: originally fileMatch for ${patterns} -->\n\n${r.body.replace(/^\s+/, '')}`;
        warnings.push({
          type: 'degraded_inclusion',
          message: `${rule.name}: 'fileMatch' has no activation condition in ${spec.displayName} — content kept, pattern noted as a comment.`,
          originalValue: `fileMatch (${patterns})`,
          appliedFallback: 'always',
        });
      } else {
        warnings.push({
          type: 'unsupported_mode',
          message: `${rule.name}: '${r.inclusion}' mode not supported in ${spec.displayName} — installed as always.`,
          originalValue: r.inclusion,
          appliedFallback: 'always',
        });
      }
    } else {
      // claude-code / opencode / copilot: support always + fileMatch only, so
      // the unsupported modes are manual / auto. Both degrade to always.
      warnings.push({
        type: 'unsupported_mode',
        message: `${rule.name}: '${r.inclusion}' mode not supported in ${spec.displayName} — installed as always.`,
        originalValue: r.inclusion,
        appliedFallback: 'always',
      });
    }
    r = { ...r, inclusion: 'always', filePatterns: undefined, description: undefined };
  }

  // 2. Copilot's `applyTo` accepts a single glob only.
  if (format === 'copilot' && r.inclusion === 'fileMatch' && r.filePatterns && r.filePatterns.length > 1) {
    const kept = r.filePatterns[0]!;
    const dropped = r.filePatterns.slice(1);
    warnings.push({
      type: 'patterns_truncated',
      message: `${rule.name}: Copilot 'applyTo' accepts one pattern — kept "${kept}", dropped ${dropped.join(', ')}.`,
      originalValue: r.filePatterns.join(', '),
      appliedFallback: kept,
    });
    r = { ...r, filePatterns: [kept] };
  }

  return { rule: r, warnings };
}
