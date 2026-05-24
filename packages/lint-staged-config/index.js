/**
 * Project-aware lint-staged config factory.
 *
 * Build it in a top-level `lint-staged.config.js` (or `.lintstagedrc.js`):
 *
 *   module.exports = require('@hassan/lint-staged-config')({
 *     api: 'de-autozaak-car-rental',
 *     spa: 'de-autozaak-car-rental-spa',
 *   });
 *
 * Both keys are optional — pass only the projects that exist in your repo.
 *
 * @param {{ api?: string, spa?: string }} projects
 */
module.exports = function defineLintStaged(projects = {}) {
  const config = {};

  if (projects.api) {
    const dir = projects.api;
    config[`${dir}/**/*.ts`] = [`pnpm -C ${dir} exec eslint --fix --cache`];
  }

  if (projects.spa) {
    const dir = projects.spa;
    config[`${dir}/**/*.{ts,html}`] = [
      `pnpm -C ${dir} exec prettier --write`,
      `pnpm -C ${dir} exec eslint --fix --cache`,
    ];
    config[`${dir}/**/*.{scss,css,json}`] = [`pnpm -C ${dir} exec prettier --write`];
  }

  return config;
};
