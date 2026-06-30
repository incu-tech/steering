import type { SteeringManifest, ManifestSteeringEntry } from './types.ts';

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface ManifestParseResult {
  manifest: SteeringManifest | null;
  errors: string[];
}

/**
 * Parse and validate the contents of a `steering.json` manifest.
 *
 * Validation is strict (the PRD requires exiting with a list of what's wrong),
 * but the `file` paths themselves are not checked against the filesystem here —
 * that happens during discovery so the same logic works for remote trees.
 */
export function parseManifest(raw: string): ManifestParseResult {
  const errors: string[] = [];

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    return { manifest: null, errors: [`steering.json is not valid JSON: ${(err as Error).message}`] };
  }

  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return { manifest: null, errors: ['steering.json must be a JSON object'] };
  }

  const obj = json as Record<string, unknown>;

  if (typeof obj.name !== 'string' || obj.name.trim() === '') {
    errors.push('steering.json: "name" is required and must be a non-empty string');
  } else if (!KEBAB_CASE.test(obj.name)) {
    errors.push(`steering.json: "name" must be kebab-case (got "${obj.name}")`);
  }

  if (obj.version !== undefined && typeof obj.version !== 'string') {
    errors.push('steering.json: "version" must be a string when present');
  }
  if (obj.description !== undefined && typeof obj.description !== 'string') {
    errors.push('steering.json: "description" must be a string when present');
  }

  const entries: ManifestSteeringEntry[] = [];
  if (!Array.isArray(obj.steering)) {
    errors.push('steering.json: "steering" is required and must be an array');
  } else if (obj.steering.length === 0) {
    errors.push('steering.json: "steering" must contain at least one entry');
  } else {
    const seen = new Set<string>();
    obj.steering.forEach((rawEntry, i) => {
      if (typeof rawEntry !== 'object' || rawEntry === null) {
        errors.push(`steering.json: steering[${i}] must be an object`);
        return;
      }
      const entry = rawEntry as Record<string, unknown>;
      const label = typeof entry.name === 'string' ? `"${entry.name}"` : `steering[${i}]`;

      if (typeof entry.name !== 'string' || entry.name.trim() === '') {
        errors.push(`steering.json: steering[${i}] is missing a "name"`);
        return;
      }
      if (!KEBAB_CASE.test(entry.name)) {
        errors.push(`steering.json: ${label} name must be kebab-case`);
      }
      if (seen.has(entry.name)) {
        errors.push(`steering.json: duplicate steering name ${label}`);
      }
      seen.add(entry.name);

      if (typeof entry.file !== 'string' || entry.file.trim() === '') {
        errors.push(`steering.json: ${label} is missing a "file" path`);
        return;
      }
      if (entry.file.includes('..')) {
        errors.push(`steering.json: ${label} "file" must not contain ".." path segments`);
        return;
      }
      if (entry.description !== undefined && typeof entry.description !== 'string') {
        errors.push(`steering.json: ${label} "description" must be a string when present`);
      }

      entries.push({
        name: entry.name,
        description: typeof entry.description === 'string' ? entry.description : '',
        file: entry.file.replace(/\\/g, '/'),
      });
    });
  }

  if (errors.length > 0) {
    return { manifest: null, errors };
  }

  return {
    manifest: {
      name: obj.name as string,
      version: obj.version as string | undefined,
      description: obj.description as string | undefined,
      author: typeof obj.author === 'string' ? obj.author : undefined,
      license: typeof obj.license === 'string' ? obj.license : undefined,
      steering: entries,
    },
    errors: [],
  };
}
