import type { AgentFormat, CanonicalRule } from '../types.ts';
import { serializeKiro } from './kiro.ts';
import { serializePaths } from './claude-code.ts';
import { serializeCursor } from './cursor.ts';
import { serializeCopilot } from './copilot.ts';
import { serializePlain } from './plain.ts';

/**
 * Serialize a canonical rule to a target format's on-disk representation.
 *
 * The rule should already be representable in the target (its inclusion mode in
 * the format's `supports`, Copilot patterns truncated to one) — run it through
 * `degradeForTarget` first. Serializers still degrade gracefully if not.
 */
export function serializeRule(rule: CanonicalRule, format: AgentFormat): string {
  switch (format) {
    case 'kiro':
      return serializeKiro(rule);
    case 'claude-code':
    case 'opencode':
      return serializePaths(rule);
    case 'cursor':
    case 'windsurf':
      return serializeCursor(rule);
    case 'copilot':
      return serializeCopilot(rule);
    case 'agents-md':
    case 'cline':
      return serializePlain(rule);
  }
}
