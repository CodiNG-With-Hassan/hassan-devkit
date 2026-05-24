---
'@coding-with-hassan/devkit': minor
---

Switch `db:*` and `docker:restart` commands to address services through `docker compose exec <service>` instead of hardcoded container names. This means client repos no longer need to set `container_name:` in their compose file or repeat the brand prefix on every service — the compose project name does the disambiguation.

**Breaking change** to the `hassan-devkit` config block in `package.json`:

```diff
 "hassan-devkit": {
   "db": {
-    "container": "de-autozaak-db",
+    "service": "db",
     "user": "postgres",
     "name": "de_autozaak"
   }
 }
```

`docker:restart` now takes a compose service name (e.g. `api`) instead of a hardcoded container name (e.g. `de-autozaak-api`).
