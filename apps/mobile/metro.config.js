const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const workspaceRoot = path.resolve(__dirname, '../..');
const projectRoot = __dirname;

/**
 * Monorepo-aware Metro config. Metro's default resolver assumes a single
 * `node_modules` next to the app; in this pnpm workspace, workspace packages
 * (@arutech/types, @arutech/validation) live under the repo root and are
 * pnpm-symlinked into apps/mobile/node_modules, so we:
 *  - watch the whole workspace (watchFolders) so Metro picks up changes to
 *    shared packages, not just apps/mobile's own files;
 *  - let Metro follow pnpm's symlinks instead of only its own node_modules
 *    (unstable_enableSymlinks) — without this, Metro resolves a symlinked
 *    package to a *second*, incompatible copy of React inside the target
 *    package's own node_modules and the app fails at runtime with
 *    "Invalid hook call" / duplicate-React errors.
 *
 * https://reactnative.dev/docs/metro
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: [workspaceRoot],
  resolver: {
    unstable_enableSymlinks: true,
    unstable_enablePackageExports: true,
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(workspaceRoot, 'node_modules'),
    ],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
