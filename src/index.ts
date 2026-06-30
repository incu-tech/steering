/**
 * Public library API for the universal agent rule converter.
 *
 * @example
 * import { convert, detectFormat, parseRule, serializeRule } from '@incu/steering';
 */

export type {
  AgentFormat,
  CanonicalRule,
  ConversionResult,
  ConversionWarning,
  WarningType,
} from './convert/types.ts';
export { AGENT_FORMATS } from './convert/types.ts';
export type { InclusionMode } from './types.ts';

export {
  convert,
  convertDirectory,
  convertRuleToFormat,
  renderRules,
  type ConvertOptions,
  type ConvertDirectoryOptions,
  type RenderedDoc,
} from './convert/convert.ts';

export {
  parseRule,
  parseRules,
  parseContent,
  ruleNameFromPath,
  FormatDetectionError,
  type ParseFileResult,
} from './convert/parse/index.ts';

export { serializeRule } from './convert/serialize/index.ts';
export { detectFormat, type DetectionResult } from './convert/detect.ts';
export { degradeForTarget, type DegradeResult } from './convert/degradation.ts';
export {
  FORMATS,
  getFormatSpec,
  supportsInclusion,
  type FormatSpec,
} from './convert/formats.ts';
export {
  getFormatDir,
  getOutputBasename,
  getOutputPath,
  sanitizeName,
} from './convert/output-paths.ts';
