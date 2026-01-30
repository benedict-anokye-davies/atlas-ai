const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

async function generateIcons() {
  const svgPath = path.join(__dirname, '..', 'assets', 'icons', 'icon.svg');
  const iconsDir = path.join(__dirname, '..', 'assets', 'icons');
  
  const svgBuffer = fs.readFileSync(svgPath);
  
  // Generate PNG sizes needed for electron-builder
  const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
  
  for (const size of sizes) {
    const pngPath = path.join(iconsDir, size + 'x' + size + '.png');
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(pngPath);
    console.log('Generated:', pngPath);
  }
  
  // Also create icon.png (256x256 is standard)
  const iconPng = path.join(iconsDir, 'icon.png');
  await sharp(svgBuffer)
    .resize(256, 256)
    .png()
    .toFile(iconPng);
  console.log('Generated:', iconPng);
}

generateIcons()
  .then(() => console.log('\nAll icons generated successfully!'))
  .catch((err) => {
    console.error('Error generating icons:', err);
    process.exit(1);
  });
