# @hassan/renovate-config

Shared [Renovate](https://docs.renovatebot.com/) preset for client repos that consume the `@hassan/*` devkit. It groups upgrades into meaningful PRs so a busy dependency week doesn't drown your inbox.

## Use

Create `renovate.json` at the root of a client repo:

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["github>CodiNG-With-Hassan/hassan-devkit//packages/renovate-config"]
}
```

Renovate resolves presets directly from GitHub, so this preset works without you needing to install anything in the client repo. (The preset is also published to npm under `@hassan/renovate-config` for npm-based consumers.)

## What it does

- Runs weekly, Monday before 6am Amsterdam time.
- Caps concurrent open PRs at 5, hourly creation at 2.
- Groups updates so each PR is meaningful instead of one-per-package:
  - `@hassan/*` — your own devkit bumps, runs at any time (not gated by the weekly schedule).
  - `@angular/*`, `angular-eslint`, `@angular-eslint/*` — Angular framework.
  - `@nestjs/*` — NestJS framework.
  - `primeng`, `primeicons`, `@primeuix/*` — PrimeNG.
  - `@ngrx/*` — NgRx.
  - `typeorm`, `pg` — database layer.
- Pins GitHub Actions to commit digests.
- Enables semantic commits and the dependency dashboard issue.
