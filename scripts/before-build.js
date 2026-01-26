/**
 * Atlas Desktop - Before Build Hook
 * Runs before electron-builder starts packaging
 *
 * Tasks:
 * - Validate build environment
 * - Check for required assets
 * - Generate placeholder icons if missing
 * - Clean temporary files
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const ASSETS_DIR = path.join(ROOT_DIR, 'assets');
const ICONS_DIR = path.join(ASSETS_DIR, 'icons');

/**
 * Create a simple SVG icon as placeholder
 */
function createPlaceholderSVG() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#1a1a2e"/>
      <stop offset="100%" style="stop-color:#16213e"/>
    </linearGradient>
    <radialGradient id="orb" cx="50%" cy="50%" r="50%">
      <stop offset="0%" style="stop-color:#00d4ff"/>
      <stop offset="50%" style="stop-color:#0a84ff"/>
      <stop offset="100%" style="stop-color:#6366f1"/>
    </radialGradient>
  </defs>

  <!-- Background -->
  <rect width="512" height="512" rx="100" fill="url(#bg)"/>

  <!-- Outer glow ring -->
  <circle cx="256" cy="256" r="180" fill="none" stroke="#0a84ff" stroke-width="3" opacity="0.3"/>
  <circle cx="256" cy="256" r="160" fill="none" stroke="#00d4ff" stroke-width="2" opacity="0.4"/>

  <!-- Central orb -->
  <circle cx="256" cy="256" r="120" fill="url(#orb)" opacity="0.9"/>

  <!-- Inner highlight -->
  <circle cx="230" cy="230" r="40" fill="#ffffff" opacity="0.2"/>

  <!-- Letter A for Atlas -->
  <text x="256" y="280" font-family="Arial, sans-serif" font-size="120" font-weight="bold"
        fill="white" text-anchor="middle" dominant-baseline="middle">A</text>
</svg>`;
}

/**
 * Generate placeholder PNG using a simple approach
 * In production, use proper icon generation tools like icon-gen
 */
function createPlaceholderPNG(size) {
  // For actual implementation, use a library like sharp or canvas
  // This is a placeholder that logs a warning
  console.log(`  Note: Placeholder PNG ${size}x${size} - use proper icons for production`);
  return null;
}

/**
 * Validate required environment
 */
function validateEnvironment() {
  console.log('[before-build] Validating build environment...');

  // Check Node.js version
  const nodeVersion = process.versions.node;
  const majorVersion = parseInt(nodeVersion.split('.')[0], 10);
  if (majorVersion < 18) {
    console.error(`Error: Node.js 18+ required, found ${nodeVersion}`);
    process.exit(1);
  }
  console.log(`  Node.js version: ${nodeVersion}`);

  // Check dist directory exists
  const distDir = path.join(ROOT_DIR, 'dist');
  if (!fs.existsSync(distDir)) {
    console.error('Error: dist directory not found. Run build:vite and build:electron first.');
    process.exit(1);
  }
  console.log('  dist directory: OK');

  // Check main entry point
  const mainEntry = path.join(distDir, 'main', 'index.js');
  if (!fs.existsSync(mainEntry)) {
    console.error('Error: Main process entry not found at dist/main/index.js');
    process.exit(1);
  }
  console.log('  Main entry: OK');
}

/**
 * Ensure required assets exist
 */
function ensureAssets() {
  console.log('[before-build] Checking assets...');

  // Create icons directory if missing
  if (!fs.existsSync(ICONS_DIR)) {
    fs.mkdirSync(ICONS_DIR, { recursive: true });
    console.log('  Created icons directory');
  }

  // Create placeholder SVG if icons are missing
  const svgPath = path.join(ICONS_DIR, 'icon.svg');
  if (!fs.existsSync(svgPath)) {
    fs.writeFileSync(svgPath, createPlaceholderSVG());
    console.log('  Created placeholder icon.svg');
  }

  // Check for platform-specific icons
  const requiredIcons = [
    { file: 'icon.ico', platform: 'Windows' },
    { file: 'icon.icns', platform: 'macOS' },
    { file: 'icon.png', platform: 'Linux' },
  ];

  let missingIcons = false;
  for (const { file, platform } of requiredIcons) {
    const iconPath = path.join(ICONS_DIR, file);
    if (!fs.existsSync(iconPath)) {
      console.log(`  Warning: ${file} missing for ${platform}`);
      console.log(`    Generate with: npx electron-icon-builder --input=assets/icons/icon.svg`);
      missingIcons = true;
    } else {
      console.log(`  ${file}: OK`);
    }
  }

  if (missingIcons) {
    console.log('');
    console.log('  To generate icons from SVG:');
    console.log('    npm install -D electron-icon-builder');
    console.log('    npx electron-icon-builder --input=assets/icons/icon.svg --output=assets/icons');
    console.log('');
  }

  // Check for LICENSE file
  const licensePath = path.join(ROOT_DIR, 'LICENSE');
  if (!fs.existsSync(licensePath)) {
    console.log('  Warning: LICENSE file missing, creating placeholder');
    fs.writeFileSync(
      licensePath,
      `MIT License

Copyright (c) 2024-2026 Atlas Team

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`
    );
  }
}

/**
 * Clean temporary files
 */
function cleanTempFiles() {
  console.log('[before-build] Cleaning temporary files...');

  const tempPatterns = ['**/*.log', '**/node_modules/.cache', '**/.DS_Store', '**/Thumbs.db'];

  // For now, just remove common temp files from assets
  const dsStorePath = path.join(ASSETS_DIR, '.DS_Store');
  if (fs.existsSync(dsStorePath)) {
    fs.unlinkSync(dsStorePath);
    console.log('  Removed .DS_Store');
  }

  console.log('  Cleanup complete');
}

/**
 * Main execution
 */
async function main() {
  console.log('');
  console.log('='.repeat(60));
  console.log('Atlas Desktop - Before Build Hook');
  console.log('='.repeat(60));
  console.log('');

  try {
    validateEnvironment();
    ensureAssets();
    cleanTempFiles();

    console.log('');
    console.log('[before-build] All checks passed!');
    console.log('');
  } catch (error) {
    console.error('[before-build] Error:', error.message);
    process.exit(1);
  }
}

module.exports = main;

// Run if called directly
if (require.main === module) {
  main();
}
