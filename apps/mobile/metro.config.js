// Metro, taught about the monorepo.
//
// CORRECTED 2026-09-21, having tested it. An earlier version of this comment claimed that without
// this file `@b8/contracts` is "unresolvable at runtime". That is FALSE and was asserted without
// checking: npm workspaces creates `node_modules/@b8/contracts` as a symlink to
// `packages/contracts`, and Metro follows it through ordinary node_modules lookup. Gutting this
// file — watchFolders and nodeModulesPaths both removed — still produced a working 5.6MB bundle
// with the shared schemas in it.
//
// What it actually buys, in descending order of how much it matters:
//
//   1. watchFolders — Metro only watches files under the project root by default, so without this
//      an edit to `packages/contracts` does not reload the app. This is the real reason the file
//      exists. It is also what moves Metro's SERVER ROOT to the workspace root, which is why the
//      bundle URL is `/apps/mobile/index.bundle` and not `/index.bundle`.
//
//   2. disableHierarchicalLookup — stops Metro walking above the workspace for modules, so a stray
//      install in a parent directory cannot silently become a dependency.
//
//   3. nodeModulesPaths — makes explicit what npm's install layout already does. Verified:
//      `require.resolve('react')` from `apps/mobile` already finds the nested 19.2.3 that Expo
//      pins, while `apps/web` gets the hoisted 19.2.4. Belt-and-braces, not load-bearing — kept
//      because the resolution order should be stated rather than inherited from an install.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

config.resolver.disableHierarchicalLookup = true;

module.exports = config;
