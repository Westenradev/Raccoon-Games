// Runs every browser test in this folder, one after the other.
// Run: node tests/e2e/run-all.js
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.e2e.js')).sort();
let failed = 0;
for (const f of files) {
  console.log('\n=== ' + f + ' ===');
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit' });
  if (r.status !== 0) failed += 1;
}
console.log('\n' + (files.length - failed) + ' of ' + files.length + ' browser test files passed.');
process.exit(failed ? 1 : 0);
