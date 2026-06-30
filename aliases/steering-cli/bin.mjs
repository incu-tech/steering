#!/usr/bin/env node

// Thin alias package so `npx steering-cli ...` works as a short invocation.
// All logic lives in @incu/steering (declared as a dependency); this just runs
// its CLI. Patches to @incu/steering are picked up via the "^" semver range
// without republishing this alias.
import '@incu/steering/cli';
