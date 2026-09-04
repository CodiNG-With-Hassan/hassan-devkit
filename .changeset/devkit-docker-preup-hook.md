---
'@coding-with-hassan/devkit': minor
---

Add an optional `docker.preUp` hook to the `hassan-devkit` config block. When set, `docker:up` runs that shell command from the repo root before `docker compose up -d --build`, and aborts the up if it exits non-zero. Projects use it to refresh values their compose file reads from `.env` on every up (e.g. an image tag derived from the lockfile, or the active compose profiles), so those can never go stale:

```json
{
  "hassan-devkit": {
    "docker": { "preUp": "scripts/worktree.sh env" }
  }
}
```
