#!/usr/bin/env node

// Thin alias package so `npx steering.sh ...` works as a short, brandable
// invocation. All logic lives in @incu/steering (declared as a dependency);
// this just runs its CLI. Patches to @incu/steering are picked up via the
// "^" semver range without republishing this alias.
import '@incu/steering/cli';
