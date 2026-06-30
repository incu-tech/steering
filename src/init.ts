import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { basename, join } from 'path';
import { MANIFEST_FILE, STEERING_SUBDIR } from './constants.ts';
import { c, info, success, warn } from './ui.ts';

const EXAMPLE_STEERING = `---
inclusion: always
---

# Example Steering

Replace this with persistent context your AI agent should always apply —
coding standards, architecture decisions, conventions, etc.

- Be specific and actionable
- One concern per steering file
`;

function manifestTemplate(name: string): string {
  return (
    JSON.stringify(
      {
        name,
        version: '0.1.0',
        description: `Steering files for ${name}`,
        steering: [
          {
            name: 'example',
            description: 'An example steering file — edit or replace me',
            file: `${STEERING_SUBDIR}/example.md`,
          },
        ],
      },
      null,
      2
    ) + '\n'
  );
}

export async function runInit(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const name = (args[0] && args[0]!.trim()) || basename(cwd);

  const manifestPath = join(cwd, MANIFEST_FILE);
  if (existsSync(manifestPath)) {
    warn(`${MANIFEST_FILE} already exists — leaving it untouched.`);
    return;
  }

  await mkdir(join(cwd, STEERING_SUBDIR), { recursive: true });
  await writeFile(manifestPath, manifestTemplate(name), 'utf-8');

  const examplePath = join(cwd, STEERING_SUBDIR, 'example.md');
  if (!existsSync(examplePath)) {
    await writeFile(examplePath, EXAMPLE_STEERING, 'utf-8');
  }

  success(`Initialized steering package "${name}"`);
  info('');
  info(c.dim('Created:'));
  info(`  ${MANIFEST_FILE}`);
  info(`  ${STEERING_SUBDIR}/example.md`);
  info('');
  info(c.dim('Next steps:'));
  info(`  1. Edit ${c.cyan(`${STEERING_SUBDIR}/example.md`)} and add more steering files`);
  info(`  2. List them in ${c.cyan(MANIFEST_FILE)}`);
  info(`  3. Push to GitHub, then ${c.cyan('npx steering add <owner>/<repo>')}`);
}
