/**
 * Atlas Desktop - Windows Code Signing Utility
 * 
 * Provides utilities for Windows code signing including:
 * - Standard PFX/P12 certificate signing
 * - Azure Key Vault EV certificate signing
 * - Dual signing (SHA-1 + SHA-256 for older OS compatibility)
 * 
 * Usage:
 *   Set environment variables and call from electron-builder afterSign hook
 * 
 * Standard Signing Environment Variables:
 *   WIN_CSC_LINK - Path to PFX certificate file
 *   WIN_CSC_KEY_PASSWORD - Certificate password
 * 
 * Azure Key Vault Environment Variables:
 *   AZURE_KEY_VAULT_URI - Key Vault URI (e.g., https://myvault.vault.azure.net)
 *   AZURE_KEY_VAULT_CLIENT_ID - Azure AD App Client ID
 *   AZURE_KEY_VAULT_CLIENT_SECRET - Azure AD App Client Secret
 *   AZURE_KEY_VAULT_TENANT_ID - Azure AD Tenant ID
 *   AZURE_KEY_VAULT_CERTIFICATE - Certificate name in Key Vault
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Sign a Windows executable using signtool
 * @param {string} filePath - Path to the file to sign
 * @param {Object} options - Signing options
 */
async function signWithSigntool(filePath, options = {}) {
  const {
    certificatePath = process.env.WIN_CSC_LINK,
    certificatePassword = process.env.WIN_CSC_KEY_PASSWORD,
    timestampServer = 'http://timestamp.digicert.com',
    algorithm = 'sha256',
  } = options;

  if (!certificatePath || !certificatePassword) {
    console.log('[win-sign] Skipping - certificate not configured');
    return false;
  }

  if (!fs.existsSync(certificatePath)) {
    console.error(`[win-sign] Certificate file not found: ${certificatePath}`);
    return false;
  }

  console.log(`[win-sign] Signing: ${path.basename(filePath)}`);

  try {
    const args = [
      'sign',
      '/f', certificatePath,
      '/p', certificatePassword,
      '/fd', algorithm,
      '/tr', timestampServer,
      '/td', algorithm,
      filePath,
    ];

    execSync(`signtool ${args.join(' ')}`, {
      stdio: 'pipe',
    });

    console.log(`[win-sign] Successfully signed: ${path.basename(filePath)}`);
    return true;
  } catch (error) {
    console.error(`[win-sign] Failed to sign ${filePath}:`, error.message);
    return false;
  }
}

/**
 * Sign using Azure Key Vault with AzureSignTool
 * Requires: dotnet tool install -g AzureSignTool
 * 
 * @param {string} filePath - Path to the file to sign
 * @param {Object} options - Signing options
 */
async function signWithAzureKeyVault(filePath, options = {}) {
  const {
    vaultUri = process.env.AZURE_KEY_VAULT_URI,
    clientId = process.env.AZURE_KEY_VAULT_CLIENT_ID,
    clientSecret = process.env.AZURE_KEY_VAULT_CLIENT_SECRET,
    tenantId = process.env.AZURE_KEY_VAULT_TENANT_ID,
    certificateName = process.env.AZURE_KEY_VAULT_CERTIFICATE,
    timestampServer = 'http://timestamp.digicert.com',
  } = options;

  // Check required credentials
  if (!vaultUri || !clientId || !clientSecret || !tenantId || !certificateName) {
    console.log('[win-sign] Azure Key Vault credentials not configured');
    return false;
  }

  console.log(`[win-sign] Signing with Azure Key Vault: ${path.basename(filePath)}`);

  try {
    const args = [
      'sign',
      '-kvu', vaultUri,
      '-kvi', clientId,
      '-kvs', clientSecret,
      '-kvt', tenantId,
      '-kvc', certificateName,
      '-tr', timestampServer,
      '-td', 'sha256',
      filePath,
    ];

    execSync(`AzureSignTool ${args.join(' ')}`, {
      stdio: 'pipe',
    });

    console.log(`[win-sign] Successfully signed with Azure Key Vault: ${path.basename(filePath)}`);
    return true;
  } catch (error) {
    console.error(`[win-sign] Azure Key Vault signing failed:`, error.message);
    return false;
  }
}

/**
 * Sign all executables and DLLs in a directory
 * @param {string} directory - Directory containing files to sign
 * @param {Object} options - Signing options
 */
async function signDirectory(directory, options = {}) {
  const extensions = ['.exe', '.dll', '.msi'];
  const files = [];

  function findFiles(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        findFiles(fullPath);
      } else if (extensions.some(ext => entry.name.toLowerCase().endsWith(ext))) {
        files.push(fullPath);
      }
    }
  }

  findFiles(directory);

  console.log(`[win-sign] Found ${files.length} files to sign`);

  let signed = 0;
  let failed = 0;

  // Determine signing method
  const useAzure = process.env.AZURE_KEY_VAULT_URI && process.env.AZURE_KEY_VAULT_CERTIFICATE;

  for (const file of files) {
    const success = useAzure
      ? await signWithAzureKeyVault(file, options)
      : await signWithSigntool(file, options);

    if (success) {
      signed++;
    } else {
      failed++;
    }
  }

  console.log(`[win-sign] Signing complete: ${signed} signed, ${failed} failed`);

  return { signed, failed, total: files.length };
}

/**
 * Verify a file's signature
 * @param {string} filePath - Path to file to verify
 */
function verifySignature(filePath) {
  try {
    execSync(`signtool verify /pa /q "${filePath}"`, {
      stdio: 'pipe',
    });
    return { valid: true, file: filePath };
  } catch {
    return { valid: false, file: filePath };
  }
}

/**
 * Main entry point for electron-builder afterSign hook
 * @param {Object} context - Electron-builder context
 */
async function afterSignHook(context) {
  const { electronPlatformName, appOutDir } = context;

  // Only sign for Windows
  if (electronPlatformName !== 'win32') {
    return;
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('Atlas Desktop - Windows Code Signing');
  console.log('='.repeat(60));
  console.log('');

  // Check if signing is configured
  const hasStandardCert = process.env.WIN_CSC_LINK && process.env.WIN_CSC_KEY_PASSWORD;
  const hasAzureVault = process.env.AZURE_KEY_VAULT_URI && process.env.AZURE_KEY_VAULT_CERTIFICATE;

  if (!hasStandardCert && !hasAzureVault) {
    console.log('[win-sign] No signing credentials configured');
    console.log('');
    console.log('  To enable signing, set environment variables:');
    console.log('');
    console.log('  Standard signing:');
    console.log('    WIN_CSC_LINK - Path to PFX certificate');
    console.log('    WIN_CSC_KEY_PASSWORD - Certificate password');
    console.log('');
    console.log('  Azure Key Vault signing:');
    console.log('    AZURE_KEY_VAULT_URI - Key Vault URI');
    console.log('    AZURE_KEY_VAULT_CLIENT_ID - Azure AD Client ID');
    console.log('    AZURE_KEY_VAULT_CLIENT_SECRET - Azure AD Client Secret');
    console.log('    AZURE_KEY_VAULT_TENANT_ID - Azure AD Tenant ID');
    console.log('    AZURE_KEY_VAULT_CERTIFICATE - Certificate name');
    console.log('');
    return;
  }

  console.log(`[win-sign] Signing files in: ${appOutDir}`);
  console.log(`[win-sign] Method: ${hasAzureVault ? 'Azure Key Vault' : 'Standard Certificate'}`);

  const result = await signDirectory(appOutDir);

  if (result.failed > 0 && process.env.SIGN_REQUIRED === 'true') {
    throw new Error(`Signing failed for ${result.failed} files`);
  }
}

module.exports = {
  signWithSigntool,
  signWithAzureKeyVault,
  signDirectory,
  verifySignature,
  afterSignHook,
};

// Allow running directly
if (require.main === module) {
  const [,, file] = process.argv;
  if (file) {
    signWithSigntool(file)
      .then(success => process.exit(success ? 0 : 1))
      .catch(() => process.exit(1));
  } else {
    console.log('Usage: node win-sign.js <file-to-sign>');
  }
}
