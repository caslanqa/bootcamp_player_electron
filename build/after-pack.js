const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

/**
 * Re-sign macOS bundles ad-hoc.
 *
 * With `mac.identity: null` electron-builder skips signing entirely, which
 * leaves the bundle carrying the ad-hoc signature Electron's own binary shipped
 * with — a signature its edits (rename, icon, extra resources) have already
 * invalidated. `codesign --verify` then fails and macOS refuses to launch the app
 * with "the application is damaged", which no amount of Gatekeeper coaxing fixes.
 *
 * An ad-hoc signature is not a Developer ID: users still have to clear the
 * download quarantine (see README → Installing). It only makes the bundle
 * internally valid so it can run at all, which matters on Apple Silicon.
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  if (process.platform !== 'darwin') {
    console.warn('  • skipped ad-hoc signing  reason=codesign only exists on macOS')
    return
  }

  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const identifier = context.packager.appInfo.id

  execFileSync(
    'codesign',
    ['--force', '--deep', '--sign', '-', '--identifier', identifier, appPath],
    { stdio: 'inherit' }
  )
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' })
  console.log(`  • ad-hoc signed  identifier=${identifier}`)
}
