#!/usr/bin/env npx ts-node

/**
 * Atlas Desktop - Release Automation Script
 *
 * Handles semantic versioning, changelog generation, and release orchestration.
 * Follows conventional commit format for automatic changelog generation.
 *
 * Usage:
 *   npx ts-node scripts/release.ts [major|minor|patch|<version>]
 *   npx ts-node scripts/release.ts --dry-run
 *   npx ts-node scripts/release.ts --help
 *
 * @module scripts/release
 */

import { execSync, spawn, SpawnOptions } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// ============================================================================
// Types
// ============================================================================

interface PackageJson {
  name: string;
  version: string;
  description?: string;
  [key: string]: unknown;
}

interface CommitInfo {
  hash: string;
  shortHash: string;
  type: string;
  scope?: string;
  subject: string;
  body?: string;
  breaking: boolean;
  date: string;
  author: string;
}

interface ChangelogSection {
  title: string;
  emoji: string;
  types: string[];
  commits: CommitInfo[];
}

interface ReleaseConfig {
  dryRun: boolean;
  verbose: boolean;
  skipTests: boolean;
  skipBuild: boolean;
  prerelease?: string;
  targetVersion?: string;
  bumpType?: 'major' | 'minor' | 'patch';
}

interface ReleaseResult {
  success: boolean;
  version: string;
  changelog: string;
  artifacts: string[];
  errors: string[];
}

// ============================================================================
// Constants
// ============================================================================

const ROOT_DIR = join(__dirname, '..');
const PACKAGE_JSON_PATH = join(ROOT_DIR, 'package.json');
const CHANGELOG_PATH = join(ROOT_DIR, 'CHANGELOG.md');
const RELEASE_DIR = join(ROOT_DIR, 'release');

// Conventional commit types and their changelog sections
const CHANGELOG_SECTIONS: ChangelogSection[] = [
  { title: 'Breaking Changes', emoji: '!', types: ['BREAKING'], commits: [] },
  { title: 'Features', emoji: '+', types: ['feat'], commits: [] },
  { title: 'Bug Fixes', emoji: '*', types: ['fix'], commits: [] },
  { title: 'Performance Improvements', emoji: '^', types: ['perf'], commits: [] },
  { title: 'Documentation', emoji: '#', types: ['docs'], commits: [] },
  { title: 'Code Refactoring', emoji: '~', types: ['refactor'], commits: [] },
  { title: 'Tests', emoji: '?', types: ['test'], commits: [] },
  { title: 'Build System', emoji: '%', types: ['build', 'ci'], commits: [] },
  { title: 'Chores', emoji: '-', types: ['chore'], commits: [] },
];

// Version regex for validation
const SEMVER_REGEX = /^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.-]+))?(?:\+([a-zA-Z0-9.-]+))?$/;

// Conventional commit regex
const COMMIT_REGEX = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Execute a shell command synchronously
 */
function exec(command: string, options?: { cwd?: string; silent?: boolean }): string {
  const opts = { cwd: options?.cwd || ROOT_DIR, encoding: 'utf-8' as const };
  try {
    const result = execSync(command, opts);
    return result.toString().trim();
  } catch (error) {
    if (options?.silent) return '';
    throw error;
  }
}

/**
 * Execute a command and stream output
 */
async function execStream(
  command: string,
  args: string[],
  options?: SpawnOptions
): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: 'inherit',
      cwd: ROOT_DIR,
      shell: true,
      ...options,
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(code);
      } else {
        reject(new Error(`Command failed with code ${code}`));
      }
    });

    proc.on('error', reject);
  });
}

/**
 * Log with formatting
 */
function log(message: string, type: 'info' | 'success' | 'warn' | 'error' = 'info'): void {
  const prefixes = {
    info: '[INFO]',
    success: '[OK]',
    warn: '[WARN]',
    error: '[ERROR]',
  };
  console.log(`${prefixes[type]} ${message}`);
}

/**
 * Parse semantic version string
 */
function parseVersion(version: string): { major: number; minor: number; patch: number; prerelease?: string } | null {
  const match = version.match(SEMVER_REGEX);
  if (!match) return null;

  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4],
  };
}

/**
 * Bump version based on type
 */
function bumpVersion(
  current: string,
  type: 'major' | 'minor' | 'patch',
  prerelease?: string
): string {
  const parsed = parseVersion(current);
  if (!parsed) throw new Error(`Invalid version: ${current}`);

  let { major, minor, patch } = parsed;

  switch (type) {
    case 'major':
      major++;
      minor = 0;
      patch = 0;
      break;
    case 'minor':
      minor++;
      patch = 0;
      break;
    case 'patch':
      patch++;
      break;
  }

  let version = `${major}.${minor}.${patch}`;
  if (prerelease) {
    version += `-${prerelease}`;
  }

  return version;
}

// ============================================================================
// Git Functions
// ============================================================================

/**
 * Get the latest git tag
 */
function getLatestTag(): string | null {
  try {
    return exec('git describe --tags --abbrev=0', { silent: true }) || null;
  } catch {
    return null;
  }
}

/**
 * Get commits since a specific tag or ref
 */
function getCommitsSince(since?: string): CommitInfo[] {
  const range = since ? `${since}..HEAD` : 'HEAD';
  const format = '%H|%h|%s|%b|%ai|%an';

  let output: string;
  try {
    output = exec(`git log ${range} --format="${format}" --no-merges`);
  } catch {
    return [];
  }

  if (!output) return [];

  const commits: CommitInfo[] = [];
  const entries = output.split('\n').filter(Boolean);

  for (const entry of entries) {
    const [hash, shortHash, subject, body, date, author] = entry.split('|');

    // Parse conventional commit format
    const match = subject.match(COMMIT_REGEX);
    if (!match) continue;

    const [, type, scope, breaking, message] = match;

    commits.push({
      hash,
      shortHash,
      type: type.toLowerCase(),
      scope: scope || undefined,
      subject: message,
      body: body || undefined,
      breaking: Boolean(breaking) || body?.includes('BREAKING CHANGE'),
      date,
      author,
    });
  }

  return commits;
}

/**
 * Determine version bump type from commits
 */
function determineBumpType(commits: CommitInfo[]): 'major' | 'minor' | 'patch' {
  const hasBreaking = commits.some((c) => c.breaking);
  if (hasBreaking) return 'major';

  const hasFeature = commits.some((c) => c.type === 'feat');
  if (hasFeature) return 'minor';

  return 'patch';
}

/**
 * Create and push git tag
 */
function createTag(version: string, message: string, dryRun: boolean): void {
  const tagName = `v${version}`;

  if (dryRun) {
    log(`Would create tag: ${tagName}`, 'info');
    return;
  }

  exec(`git tag -a ${tagName} -m "${message}"`);
  log(`Created tag: ${tagName}`, 'success');
}

/**
 * Push tags to remote
 */
function pushTags(dryRun: boolean): void {
  if (dryRun) {
    log('Would push tags to remote', 'info');
    return;
  }

  exec('git push --tags');
  log('Pushed tags to remote', 'success');
}

// ============================================================================
// Changelog Functions
// ============================================================================

/**
 * Generate changelog content from commits
 */
function generateChangelog(
  version: string,
  commits: CommitInfo[],
  previousVersion?: string
): string {
  // Reset sections
  const sections = CHANGELOG_SECTIONS.map((s) => ({ ...s, commits: [] as CommitInfo[] }));

  // Categorize commits
  for (const commit of commits) {
    // Handle breaking changes specially
    if (commit.breaking) {
      sections[0].commits.push(commit);
    }

    // Add to appropriate section
    const section = sections.find((s) => s.types.includes(commit.type));
    if (section && !commit.breaking) {
      section.commits.push(commit);
    }
  }

  // Build changelog content
  const date = new Date().toISOString().split('T')[0];
  let content = `## [${version}](https://github.com/atlas-team/atlas-desktop/compare/${previousVersion ? `v${previousVersion}...v${version}` : `v${version}`}) (${date})\n\n`;

  for (const section of sections) {
    if (section.commits.length === 0) continue;

    content += `### ${section.title}\n\n`;

    for (const commit of section.commits) {
      const scope = commit.scope ? `**${commit.scope}:** ` : '';
      content += `* ${scope}${commit.subject} ([${commit.shortHash}](https://github.com/atlas-team/atlas-desktop/commit/${commit.hash}))\n`;
    }

    content += '\n';
  }

  return content;
}

/**
 * Update CHANGELOG.md file
 */
function updateChangelog(content: string, dryRun: boolean): void {
  let existingContent = '';

  if (existsSync(CHANGELOG_PATH)) {
    existingContent = readFileSync(CHANGELOG_PATH, 'utf-8');
  }

  // Find position after header
  const headerEnd = existingContent.indexOf('\n## ');
  const header = headerEnd > 0
    ? existingContent.slice(0, headerEnd + 1)
    : '# Changelog\n\nAll notable changes to Atlas Desktop will be documented in this file.\n\nThe format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),\nand this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).\n\n';

  const rest = headerEnd > 0 ? existingContent.slice(headerEnd + 1) : '';

  const newContent = header + content + rest;

  if (dryRun) {
    log('Would update CHANGELOG.md with:', 'info');
    console.log(content);
    return;
  }

  writeFileSync(CHANGELOG_PATH, newContent, 'utf-8');
  log('Updated CHANGELOG.md', 'success');
}

// ============================================================================
// Package Functions
// ============================================================================

/**
 * Read package.json
 */
function readPackageJson(): PackageJson {
  const content = readFileSync(PACKAGE_JSON_PATH, 'utf-8');
  return JSON.parse(content) as PackageJson;
}

/**
 * Update package.json version
 */
function updatePackageVersion(version: string, dryRun: boolean): void {
  const pkg = readPackageJson();

  if (dryRun) {
    log(`Would update package.json version from ${pkg.version} to ${version}`, 'info');
    return;
  }

  pkg.version = version;
  writeFileSync(PACKAGE_JSON_PATH, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
  log(`Updated package.json version to ${version}`, 'success');
}

// ============================================================================
// Build Functions
// ============================================================================

/**
 * Run tests
 */
async function runTests(dryRun: boolean): Promise<void> {
  if (dryRun) {
    log('Would run: npm run test', 'info');
    return;
  }

  log('Running tests...', 'info');
  await execStream('npm', ['run', 'test']);
  log('Tests passed', 'success');
}

/**
 * Run type checking
 */
async function runTypeCheck(dryRun: boolean): Promise<void> {
  if (dryRun) {
    log('Would run: npm run typecheck', 'info');
    return;
  }

  log('Running type check...', 'info');
  await execStream('npm', ['run', 'typecheck']);
  log('Type check passed', 'success');
}

/**
 * Run linting
 */
async function runLint(dryRun: boolean): Promise<void> {
  if (dryRun) {
    log('Would run: npm run lint', 'info');
    return;
  }

  log('Running linter...', 'info');
  await execStream('npm', ['run', 'lint']);
  log('Lint passed', 'success');
}

/**
 * Build the application
 */
async function buildApp(dryRun: boolean): Promise<string[]> {
  if (dryRun) {
    log('Would run: npm run build', 'info');
    return [];
  }

  log('Building application...', 'info');

  // Ensure release directory exists
  if (!existsSync(RELEASE_DIR)) {
    mkdirSync(RELEASE_DIR, { recursive: true });
  }

  await execStream('npm', ['run', 'build']);
  log('Build completed', 'success');

  // List built artifacts
  const artifacts: string[] = [];
  try {
    const files = exec(`ls -1 "${RELEASE_DIR}"`, { silent: true });
    if (files) {
      artifacts.push(...files.split('\n').filter(Boolean));
    }
  } catch {
    // Ignore errors listing files
  }

  return artifacts;
}

// ============================================================================
// Release Functions
// ============================================================================

/**
 * Commit release changes
 */
function commitRelease(version: string, dryRun: boolean): void {
  if (dryRun) {
    log(`Would commit: chore(release): v${version}`, 'info');
    return;
  }

  exec('git add package.json CHANGELOG.md');
  exec(`git commit -m "chore(release): v${version}"`);
  log(`Committed release v${version}`, 'success');
}

/**
 * Create GitHub release (requires gh CLI)
 */
async function createGitHubRelease(
  version: string,
  changelog: string,
  artifacts: string[],
  dryRun: boolean
): Promise<void> {
  // Check if gh CLI is available
  try {
    exec('gh --version', { silent: true });
  } catch {
    log('GitHub CLI (gh) not found. Skipping GitHub release creation.', 'warn');
    return;
  }

  if (dryRun) {
    log(`Would create GitHub release v${version}`, 'info');
    return;
  }

  const tagName = `v${version}`;
  const title = `Atlas Desktop ${tagName}`;

  // Build asset arguments
  const assetArgs = artifacts
    .filter((a) => a.endsWith('.exe') || a.endsWith('.dmg') || a.endsWith('.AppImage') || a.endsWith('.zip'))
    .map((a) => `"${join(RELEASE_DIR, a)}"`)
    .join(' ');

  const releaseNotes = changelog.replace(/"/g, '\\"');

  try {
    let cmd = `gh release create ${tagName} --title "${title}" --notes "${releaseNotes}"`;
    if (assetArgs) {
      cmd += ` ${assetArgs}`;
    }

    exec(cmd);
    log(`Created GitHub release: ${tagName}`, 'success');
  } catch (error) {
    log(`Failed to create GitHub release: ${error}`, 'error');
  }
}

/**
 * Send notification (webhook)
 */
async function sendNotification(
  version: string,
  changelog: string,
  dryRun: boolean
): Promise<void> {
  const webhookUrl = process.env.RELEASE_WEBHOOK_URL;

  if (!webhookUrl) {
    log('No RELEASE_WEBHOOK_URL configured. Skipping notification.', 'info');
    return;
  }

  if (dryRun) {
    log('Would send release notification webhook', 'info');
    return;
  }

  const payload = JSON.stringify({
    text: `Atlas Desktop v${version} has been released!`,
    version,
    changelog: changelog.slice(0, 1000), // Truncate for webhook
    timestamp: new Date().toISOString(),
  });

  try {
    exec(`curl -X POST -H "Content-Type: application/json" -d '${payload}' "${webhookUrl}"`, { silent: true });
    log('Sent release notification', 'success');
  } catch {
    log('Failed to send release notification', 'warn');
  }
}

// ============================================================================
// Main Release Flow
// ============================================================================

/**
 * Parse command line arguments
 */
function parseArgs(): ReleaseConfig {
  const args = process.argv.slice(2);
  const config: ReleaseConfig = {
    dryRun: false,
    verbose: false,
    skipTests: false,
    skipBuild: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--dry-run':
      case '-d':
        config.dryRun = true;
        break;
      case '--verbose':
      case '-v':
        config.verbose = true;
        break;
      case '--skip-tests':
        config.skipTests = true;
        break;
      case '--skip-build':
        config.skipBuild = true;
        break;
      case '--prerelease':
        config.prerelease = args[++i];
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        // Check if it's a version or bump type
        if (['major', 'minor', 'patch'].includes(arg)) {
          config.bumpType = arg as 'major' | 'minor' | 'patch';
        } else if (SEMVER_REGEX.test(arg)) {
          config.targetVersion = arg;
        } else if (!arg.startsWith('-')) {
          log(`Unknown argument: ${arg}`, 'error');
          printHelp();
          process.exit(1);
        }
    }
  }

  return config;
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
Atlas Desktop Release Script

Usage:
  npx ts-node scripts/release.ts [options] [major|minor|patch|<version>]

Options:
  -d, --dry-run      Simulate release without making changes
  -v, --verbose      Show detailed output
  --skip-tests       Skip running tests
  --skip-build       Skip building the application
  --prerelease <id>  Create a prerelease (e.g., beta, rc.1)
  -h, --help         Show this help message

Examples:
  npx ts-node scripts/release.ts patch           # Bump patch version
  npx ts-node scripts/release.ts minor           # Bump minor version
  npx ts-node scripts/release.ts major           # Bump major version
  npx ts-node scripts/release.ts 1.2.3           # Set specific version
  npx ts-node scripts/release.ts --dry-run       # Auto-detect bump, dry run
  npx ts-node scripts/release.ts minor --prerelease beta  # Create beta release
`);
}

/**
 * Main release function
 */
async function release(): Promise<ReleaseResult> {
  const config = parseArgs();
  const result: ReleaseResult = {
    success: false,
    version: '',
    changelog: '',
    artifacts: [],
    errors: [],
  };

  try {
    log('Starting Atlas Desktop release process...', 'info');

    if (config.dryRun) {
      log('DRY RUN MODE - No changes will be made', 'warn');
    }

    // 1. Read current version
    const pkg = readPackageJson();
    const currentVersion = pkg.version;
    log(`Current version: ${currentVersion}`, 'info');

    // 2. Get latest tag and commits
    const latestTag = getLatestTag();
    log(`Latest tag: ${latestTag || 'none'}`, 'info');

    const commits = getCommitsSince(latestTag || undefined);
    log(`Found ${commits.length} commits since last release`, 'info');

    if (commits.length === 0 && !config.targetVersion) {
      log('No new commits since last release. Use --dry-run to force.', 'warn');
      if (!config.dryRun) {
        return result;
      }
    }

    // 3. Determine new version
    let newVersion: string;

    if (config.targetVersion) {
      newVersion = config.targetVersion;
    } else if (config.bumpType) {
      newVersion = bumpVersion(currentVersion, config.bumpType, config.prerelease);
    } else {
      const autoType = determineBumpType(commits);
      log(`Auto-detected bump type: ${autoType}`, 'info');
      newVersion = bumpVersion(currentVersion, autoType, config.prerelease);
    }

    log(`New version: ${newVersion}`, 'info');
    result.version = newVersion;

    // 4. Run quality checks
    if (!config.skipTests) {
      await runTypeCheck(config.dryRun);
      await runLint(config.dryRun);
      await runTests(config.dryRun);
    }

    // 5. Generate changelog
    const changelog = generateChangelog(newVersion, commits, currentVersion);
    result.changelog = changelog;

    if (config.verbose) {
      console.log('\n--- Generated Changelog ---');
      console.log(changelog);
      console.log('---------------------------\n');
    }

    // 6. Update files
    updatePackageVersion(newVersion, config.dryRun);
    updateChangelog(changelog, config.dryRun);

    // 7. Build application
    if (!config.skipBuild) {
      const artifacts = await buildApp(config.dryRun);
      result.artifacts = artifacts;
      log(`Built ${artifacts.length} artifacts`, 'info');
    }

    // 8. Commit and tag
    commitRelease(newVersion, config.dryRun);
    createTag(newVersion, `Release v${newVersion}`, config.dryRun);
    pushTags(config.dryRun);

    // 9. Create GitHub release
    await createGitHubRelease(newVersion, changelog, result.artifacts, config.dryRun);

    // 10. Send notification
    await sendNotification(newVersion, changelog, config.dryRun);

    result.success = true;
    log(`Release v${newVersion} completed successfully!`, 'success');

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    result.errors.push(errorMessage);
    log(`Release failed: ${errorMessage}`, 'error');

    if (config.verbose && error instanceof Error) {
      console.error(error.stack);
    }
  }

  return result;
}

// ============================================================================
// Entry Point
// ============================================================================

// Run release when executed directly
release()
  .then((result) => {
    process.exit(result.success ? 0 : 1);
  })
  .catch((error) => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
