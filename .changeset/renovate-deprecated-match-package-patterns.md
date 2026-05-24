---
'@coding-with-hassan/renovate-config': patch
---

Replace deprecated `matchPackagePatterns` with `matchPackageNames` (and the `/regex/` form). Recent Renovate versions reject the deprecated key outright, which would stop PRs in any consumer repo. Behaviour of the grouped rules is unchanged.
