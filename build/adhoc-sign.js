// Runs after the app folder is made. On a Mac it signs the app "ad hoc" (no Apple account needed).
// Without any signature, an app for Apple Silicon is reported as "damaged" after a download.
// With this signature the Mac shows the normal "unidentified developer" question instead.
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (process.platform !== 'darwin') {
    console.log('  • ad-hoc signature skipped: codesign exists only on a Mac');
    return;
  }
  // With a real Apple certificate, electron-builder signs the app itself.
  if (process.env.CSC_LINK || process.env.CSC_NAME) return;
  const app = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app');
  console.log('  • signing ad hoc  app=' + app);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
};
