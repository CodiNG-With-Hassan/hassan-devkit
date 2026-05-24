# Changesets

This folder is managed by [changesets](https://github.com/changesets/changesets).

To add a new changeset, run `pnpm changeset` and follow the prompts. Commit the generated file alongside your code changes. On merge to `main`, the GitHub Action opens a "Version Packages" PR that bumps versions and updates changelogs; merging that PR publishes the changed packages to npm.
