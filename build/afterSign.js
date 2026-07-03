// Re-signs the app bundle after electron-builder's ad-hoc sign so that
// Info.plist is bound and the TCC identifier matches the bundle ID.
// Only runs on macOS with ad-hoc signing (no Developer ID cert configured).

const { execSync } = require('child_process')

module.exports = async function afterSign({ appOutDir, packager, electronPlatformName }) {
  // electronPlatformName reflects the BUILD TARGET (darwin/win32/linux), not the host
  // OS running electron-builder — process.platform would stay 'darwin' even while
  // cross-building a Windows target from macOS, wrongly trying to codesign a
  // nonexistent .app bundle instead of the .exe electron-builder actually produced.
  if (electronPlatformName !== 'darwin') return

  const identity = packager.config.mac?.identity
  // Skip when a real Developer ID is configured — it handles signing correctly.
  if (identity && identity !== null && identity !== '-') return

  const appPath = `${appOutDir}/${packager.appInfo.productFilename}.app`
  console.log(`[afterSign] Re-signing ${appPath} with ad-hoc to bind Info.plist`)
  execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' })
}
