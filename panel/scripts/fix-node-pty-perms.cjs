#!/usr/bin/env node
/*
 * node-pty's pnpm-installed prebuilds lose the +x bit on spawn-helper, causing
 * `posix_spawnp failed` at runtime. Reapply executable permission after install.
 *
 * The panel is a package of the root pnpm workspace, so node-pty's real files
 * live in the root virtual store (`<root>/node_modules/.pnpm/node-pty@*`) and
 * the panel only holds a symlink to them. Both the panel dir and its parent are
 * probed. The panel dir defaults to this script's package and can be passed as
 * the first argument (used by the tests).
 */
const { chmodSync, existsSync, readdirSync, realpathSync } = require("fs");
const { resolve, join, dirname } = require("path");

function findNodePtyDirs(root) {
  const results = [];
  const direct = resolve(root, "node_modules", "node-pty");
  if (existsSync(direct)) results.push(direct);
  const pnpmRoot = resolve(root, "node_modules", ".pnpm");
  if (existsSync(pnpmRoot)) {
    for (const entry of readdirSync(pnpmRoot)) {
      if (!entry.startsWith("node-pty@")) continue;
      const candidate = join(pnpmRoot, entry, "node_modules", "node-pty");
      if (existsSync(candidate)) results.push(candidate);
    }
  }
  return results;
}

const panelDir = resolve(process.argv[2] || resolve(__dirname, ".."));
const dirs = new Set(
  [panelDir, dirname(panelDir)].flatMap(findNodePtyDirs).map((dir) => realpathSync(dir)),
);
for (const dir of dirs) {
  const prebuilds = join(dir, "prebuilds");
  if (!existsSync(prebuilds)) continue;
  for (const platform of readdirSync(prebuilds)) {
    const helper = join(prebuilds, platform, "spawn-helper");
    if (existsSync(helper)) {
      try {
        chmodSync(helper, 0o755);
      } catch (err) {
        console.warn(`Could not chmod ${helper}: ${err.message}`);
      }
    }
  }
}
