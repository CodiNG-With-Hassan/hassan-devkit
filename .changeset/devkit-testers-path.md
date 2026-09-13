---
'@coding-with-hassan/devkit': patch
---

`test-cases:generate --testers <file>` now accepts an absolute path (it was joined onto the working directory and failed with ENOENT); relative paths still resolve against the cwd.
