// Metro, taught about the monorepo. Without this the bundler resolves from `apps/mobile` only and
// `@b8/contracts` is unresolvable at RUNTIME even when TypeScript is perfectly happy — the failure
// arrives as a red screen on the device rather than an error in CI, which is the worst place for it.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch the whole workspace, so editing `packages/contracts` reloads the app.
config.watchFolders = [workspaceRoot];

// 2. Resolve from the local node_modules FIRST, then the hoisted root. Order matters: Expo pins
//    react 19.2.3 and react-native 0.86.3, while `apps/web` is on react 19.2.4. Local-first means
//    the phone gets the versions Expo tested against rather than whichever npm hoisted.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 3. Do not walk up past the workspace root looking for modules — that is how a stray install in a
//    parent directory silently becomes a dependency.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
