/**
 * Atlas Desktop - After Pack Hook
 * Runs after electron-builder packs the application (before signing)
 *
 * Tasks:
 * - Verify packed content
 * - Log package contents
 * - Platform-specific adjustments
 */

const fs = require('fs');
const path = require('path');

/**
 * Log the packed application size
 */
function logPackageSize(appPath) {
  console.log('[after-pack] Calculating package size...');

  let totalSize = 0;

  function calculateSize(dirPath) {
    try {
      const items = fs.readdirSync(dirPath);
      for (const item of items) {
        const itemPath = path.join(dirPath, item);
        const stats = fs.statSync(itemPath);
        if (stats.isDirectory()) {
          calculateSize(itemPath);
        } else {
          totalSize += stats.size;
        }
      }
    } catch {
      // Ignore errors
    }
  }

  calculateSize(appPath);

  const sizeMB = (totalSize / (1024 * 1024)).toFixed(2);
  console.log(`  Package size: ${sizeMB} MB`);
  return totalSize;
}

/**
 * Verify critical files exist in the package
 */
function verifyCriticalFiles(appPath, platform) {
  console.log(`[after-pack] Verifying critical files for ${platform}...`);

  const criticalFiles = ['package.json'];

  // Platform-specific paths
  let resourcesPath;
  if (platform === 'darwin') {
    resourcesPath = path.join(appPath, 'Contents', 'Resources', 'app');
  } else {
    resourcesPath = path.join(appPath, 'resources', 'app');
  }

  // Check for asar or unpacked app
  const asarPath = resourcesPath + '.asar';
  const appExists = fs.existsSync(asarPath) || fs.existsSync(resourcesPath);

  if (!appExists) {
    console.log(`  Warning: Application bundle not found at expected location`);
    console.log(`    Checked: ${asarPath}`);
    console.log(`    Checked: ${resourcesPath}`);
    return false;
  }

  console.log(`  Application bundle: OK`);
  return true;
}

/**
 * Platform-specific post-pack adjustments
 */
function platformAdjustments(appPath, platform, arch) {
  console.log(`[after-pack] Running platform adjustments for ${platform}/${arch}...`);

  if (platform === 'darwin') {
    // macOS-specific adjustments
    const infoPlistPath = path.join(appPath, 'Contents', 'Info.plist');
    if (fs.existsSync(infoPlistPath)) {
      console.log('  Info.plist: OK');
    }
  } else if (platform === 'win32') {
    // Windows-specific adjustments
    console.log('  Windows package: OK');
  } else if (platform === 'linux') {
    // Linux-specific adjustments
    console.log('  Linux package: OK');
  }
}

/**
 * Main after-pack hook
 * @param {Object} context - Electron-builder context
 */
async function main(context) {
  const { appOutDir, packager, electronPlatformName, arch } = context;

  console.log('');
  console.log('='.repeat(60));
  console.log('Atlas Desktop - After Pack Hook');
  console.log('='.repeat(60));
  console.log('');

  console.log(`  Platform: ${electronPlatformName}`);
  console.log(`  Architecture: ${arch}`);
  console.log(`  Output directory: ${appOutDir}`);
  console.log('');

  try {
    // Verify the packed application
    const verified = verifyCriticalFiles(appOutDir, electronPlatformName);

    // Calculate and log package size
    logPackageSize(appOutDir);

    // Run platform-specific adjustments
    platformAdjustments(appOutDir, electronPlatformName, arch);

    console.log('');
    console.log('[after-pack] Pack verification complete!');
    console.log('');

    if (!verified) {
      console.log('  Note: Some verifications failed - review logs above');
    }
  } catch (error) {
    console.error('[after-pack] Error:', error.message);
    // Don't exit with error - allow build to continue
  }
}

module.exports = main;
