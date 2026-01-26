/**
 * Atlas Desktop - After Sign Hook
 * Runs after code signing (macOS notarization hook)
 *
 * For macOS notarization, this hook can be used to:
 * - Submit to Apple notarization service
 * - Wait for notarization completion
 * - Staple the notarization ticket
 *
 * Note: Actual notarization requires Apple Developer credentials
 * and should be configured in electron-builder.yml or via environment variables.
 */

const { notarize } = require('@electron/notarize');
const path = require('path');

/**
 * macOS notarization hook
 * @param {Object} context - Electron-builder context
 */
async function notarizeMacos(context) {
  const { electronPlatformName, appOutDir } = context;

  // Only notarize for macOS
  if (electronPlatformName !== 'darwin') {
    return;
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('Atlas Desktop - After Sign Hook (macOS Notarization)');
  console.log('='.repeat(60));
  console.log('');

  // Check for required environment variables
  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_ID_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    console.log('[after-sign] Skipping notarization - Apple credentials not configured');
    console.log('');
    console.log('  To enable notarization, set these environment variables:');
    console.log('    APPLE_ID - Your Apple ID email');
    console.log('    APPLE_ID_PASSWORD - App-specific password');
    console.log('    APPLE_TEAM_ID - Your Apple Developer Team ID');
    console.log('');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`[after-sign] Starting notarization for: ${appPath}`);

  try {
    await notarize({
      tool: 'notarytool',
      appPath,
      appleId,
      appleIdPassword,
      teamId,
    });

    console.log('[after-sign] Notarization completed successfully!');
  } catch (error) {
    console.error('[after-sign] Notarization failed:', error.message);
    console.log('');
    console.log('  Common issues:');
    console.log('    - Invalid Apple ID or app-specific password');
    console.log('    - Application not properly code signed');
    console.log('    - Missing entitlements');
    console.log('    - Network connectivity issues');
    console.log('');

    // Throw to fail the build for production releases
    if (process.env.NOTARIZE_REQUIRED === 'true') {
      throw error;
    }
  }
}

module.exports = notarizeMacos;
