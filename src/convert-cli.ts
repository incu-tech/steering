#!/usr/bin/env node

import { runConvert } from './convert-command.ts';
import { flushTelemetry } from './telemetry.ts';

runConvert(process.argv.slice(2))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(() => flushTelemetry().then(() => process.exit(process.exitCode ?? 0)));
