/**
 * Atlas Desktop - Git Repository Statistics Tool
 *
 * Provides comprehensive git repository statistics including:
 * - Commit frequency charts
 * - Contributor statistics
 * - Code churn analysis
 * - File change hotspots
 * - Branch activity overview
 *
 * Voice command: "Show repo stats"
 *
 * @module agent/tools/git-stats
 */

import { spawn, SpawnOptions } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import { AgentTool, ActionResult } from '../../../shared/types/agent';
import { createModuleLogger } from '../../utils/logger';

const logger = createModuleLogger('GitStatsTool');

// Configuration
const DEFAULT_TIMEOUT = 60000; // 60 seconds (stats can take longer)
const MAX_OUTPUT_SIZE = 2 * 1024 * 1024; // 2MB for stats data

// ============================================================================
// Git Stats Types
// ============================================================================

/**
 * Commit frequency data point
 */
export interface CommitFrequencyPoint {
  /** Date string (YYYY-MM-DD or YYYY-MM for monthly) */
  date: string;
  /** Number of commits */
  count: number;
  /** Number of additions */
  additions?: number;
  /** Number of deletions */
  deletions?: number;
}

/**
 * Contributor statistics
 */
export interface ContributorStats {
  /** Author name */
  name: string;
  /** Author email */
  email: string;
  /** Total commits by this author */
  commits: number;
  /** Total lines added */
  additions: number;
  /** Total lines deleted */
  deletions: number;
  /** First commit date */
  firstCommit: string;
  /** Last commit date */
  lastCommit: string;
  /** Percentage of total commits */
  percentage: number;
}

/**
 * File hotspot (frequently changed files)
 */
export interface FileHotspot {
  /** File path */
  path: string;
  /** Number of times file was changed */
  changeCount: number;
  /** Total additions to this file */
  additions: number;
  /** Total deletions from this file */
  deletions: number;
  /** Churn rate (additions + deletions) */
  churn: number;
  /** Last modified date */
  lastModified: string;
  /** Authors who modified this file */
  authors: string[];
}

/**
 * Branch activity statistics
 */
export interface BranchActivity {
  /** Branch name */
  name: string;
  /** Number of commits on branch */
  commits: number;
  /** Is this the current branch */
  isCurrent: boolean;
  /** Last commit date */
  lastCommit: string;
  /** Commits ahead of main/master */
  ahead: number;
  /** Commits behind main/master */
  behind: number;
  /** Primary contributors to this branch */
  contributors: string[];
}

/**
 * Code churn analysis
 */
export interface CodeChurn {
  /** Total lines added in period */
  totalAdditions: number;
  /** Total lines deleted in period */
  totalDeletions: number;
  /** Net lines changed (additions - deletions) */
  netChange: number;
  /** Churn rate (additions + deletions) */
  churnRate: number;
  /** Average churn per commit */
  avgChurnPerCommit: number;
  /** Files with highest churn */
  highChurnFiles: FileHotspot[];
}

/**
 * Repository overview statistics
 */
export interface RepoOverview {
  /** Total number of commits */
  totalCommits: number;
  /** Total number of contributors */
  totalContributors: number;
  /** Repository age in days */
  ageInDays: number;
  /** First commit date */
  firstCommitDate: string;
  /** Last commit date */
  lastCommitDate: string;
  /** Total branches */
  totalBranches: number;
  /** Total tags */
  totalTags: number;
  /** Total lines of code (approximate) */
  totalLinesOfCode: number;
  /** Languages detected */
  languages: { name: string; percentage: number; files: number }[];
}

/**
 * Complete repository statistics
 */
export interface RepositoryStats {
  /** Repository overview */
  overview: RepoOverview;
  /** Commit frequency over time */
  commitFrequency: CommitFrequencyPoint[];
  /** Top contributors */
  contributors: ContributorStats[];
  /** Code churn analysis */
  codeChurn: CodeChurn;
  /** File hotspots */
  hotspots: FileHotspot[];
  /** Branch activity */
  branches: BranchActivity[];
  /** Generation timestamp */
  generatedAt: string;
  /** Time period analyzed */
  period: {
    since?: string;
    until?: string;
  };
}

/**
 * Statistics export format
 */
export interface StatsExport {
  /** Export format */
  format: 'json' | 'csv' | 'markdown';
  /** Export content */
  content: string;
  /** Filename suggestion */
  filename: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Execute a git command and return the result
 */
async function executeGitCommand(
  args: string[],
  cwd?: string
): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number }> {
  const workingDir = cwd ? path.resolve(cwd) : process.cwd();

  return new Promise((resolve) => {
    const spawnOptions: SpawnOptions = {
      cwd: workingDir,
      shell: os.platform() === 'win32',
      windowsHide: true,
    };

    const proc = spawn('git', args, spawnOptions);
    let stdout = '';
    let stderr = '';

    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      resolve({
        success: false,
        stdout,
        stderr: 'Command timed out',
        exitCode: -1,
      });
    }, DEFAULT_TIMEOUT);

    proc.stdout?.on('data', (data: Buffer) => {
      if (stdout.length + data.length <= MAX_OUTPUT_SIZE) {
        stdout += data.toString();
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      if (stderr.length + data.length <= MAX_OUTPUT_SIZE) {
        stderr += data.toString();
      }
    });

    proc.on('close', (exitCode) => {
      clearTimeout(timeout);
      resolve({
        success: exitCode === 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: exitCode ?? -1,
      });
    });

    proc.on('error', (error) => {
      clearTimeout(timeout);
      resolve({
        success: false,
        stdout: '',
        stderr: error.message,
        exitCode: -1,
      });
    });
  });
}

/**
 * Check if directory is a git repository
 */
async function isGitRepository(cwd?: string): Promise<boolean> {
  const result = await executeGitCommand(['rev-parse', '--is-inside-work-tree'], cwd);
  return result.success && result.stdout === 'true';
}

/**
 * Get commit frequency by day/week/month
 */
async function getCommitFrequency(
  cwd?: string,
  since?: string,
  until?: string,
  granularity: 'day' | 'week' | 'month' = 'day'
): Promise<CommitFrequencyPoint[]> {
  const args = ['log', '--format=%aI', '--no-merges'];

  if (since) args.push(`--since=${since}`);
  if (until) args.push(`--until=${until}`);

  const result = await executeGitCommand(args, cwd);
  if (!result.success) return [];

  const dates = result.stdout.split('\n').filter((d) => d.trim());
  const frequency = new Map<string, number>();

  for (const dateStr of dates) {
    const date = new Date(dateStr);
    let key: string;

    switch (granularity) {
      case 'month':
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        break;
      case 'week': {
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        key = weekStart.toISOString().substring(0, 10);
        break;
      }
      default:
        key = date.toISOString().substring(0, 10);
    }

    frequency.set(key, (frequency.get(key) || 0) + 1);
  }

  // Sort by date and return
  return Array.from(frequency.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, count }));
}

/**
 * Get contributor statistics
 */
async function getContributorStats(
  cwd?: string,
  since?: string,
  until?: string,
  limit = 20
): Promise<ContributorStats[]> {
  // Get shortlog for commit counts
  const shortlogArgs = ['shortlog', '-sne', '--no-merges', 'HEAD'];
  if (since) shortlogArgs.push(`--since=${since}`);
  if (until) shortlogArgs.push(`--until=${until}`);

  const shortlogResult = await executeGitCommand(shortlogArgs, cwd);
  if (!shortlogResult.success) return [];

  const contributors: ContributorStats[] = [];
  const lines = shortlogResult.stdout.split('\n').filter((l) => l.trim());
  let totalCommits = 0;

  for (const line of lines) {
    const match = line.match(/^\s*(\d+)\s+(.+?)\s+<(.+?)>$/);
    if (match) {
      const commits = parseInt(match[1], 10);
      totalCommits += commits;
      contributors.push({
        name: match[2],
        email: match[3],
        commits,
        additions: 0,
        deletions: 0,
        firstCommit: '',
        lastCommit: '',
        percentage: 0,
      });
    }
  }

  // Calculate percentages and get additional stats for top contributors
  for (const contributor of contributors.slice(0, limit)) {
    contributor.percentage = Math.round((contributor.commits / totalCommits) * 1000) / 10;

    // Get first and last commit dates for this author
    const dateArgs = [
      'log',
      '--format=%aI',
      `--author=${contributor.email}`,
      '--reverse',
      '-1',
    ];
    if (since) dateArgs.push(`--since=${since}`);
    if (until) dateArgs.push(`--until=${until}`);

    const firstResult = await executeGitCommand(dateArgs, cwd);
    if (firstResult.success && firstResult.stdout) {
      contributor.firstCommit = firstResult.stdout;
    }

    // Get last commit
    const lastArgs = [
      'log',
      '--format=%aI',
      `--author=${contributor.email}`,
      '-1',
    ];
    if (since) lastArgs.push(`--since=${since}`);
    if (until) lastArgs.push(`--until=${until}`);

    const lastResult = await executeGitCommand(lastArgs, cwd);
    if (lastResult.success && lastResult.stdout) {
      contributor.lastCommit = lastResult.stdout;
    }

    // Get additions/deletions (this is slow, so only do it for top 10)
    if (contributors.indexOf(contributor) < 10) {
      const statArgs = [
        'log',
        '--format=',
        '--numstat',
        `--author=${contributor.email}`,
        '--no-merges',
      ];
      if (since) statArgs.push(`--since=${since}`);
      if (until) statArgs.push(`--until=${until}`);

      const statResult = await executeGitCommand(statArgs, cwd);
      if (statResult.success) {
        for (const statLine of statResult.stdout.split('\n')) {
          const statMatch = statLine.match(/^(\d+)\s+(\d+)/);
          if (statMatch) {
            contributor.additions += parseInt(statMatch[1], 10);
            contributor.deletions += parseInt(statMatch[2], 10);
          }
        }
      }
    }
  }

  return contributors.slice(0, limit);
}

/**
 * Get file hotspots (most frequently changed files)
 */
async function getFileHotspots(
  cwd?: string,
  since?: string,
  until?: string,
  limit = 20
): Promise<FileHotspot[]> {
  const args = ['log', '--format=', '--name-only', '--no-merges'];
  if (since) args.push(`--since=${since}`);
  if (until) args.push(`--until=${until}`);

  const result = await executeGitCommand(args, cwd);
  if (!result.success) return [];

  const fileCounts = new Map<string, number>();
  const files = result.stdout.split('\n').filter((f) => f.trim());

  for (const file of files) {
    fileCounts.set(file, (fileCounts.get(file) || 0) + 1);
  }

  // Sort by change count and get top files
  const sortedFiles = Array.from(fileCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  const hotspots: FileHotspot[] = [];

  for (const [filePath, changeCount] of sortedFiles) {
    // Get detailed stats for this file
    const statArgs = ['log', '--format=%an|%aI', '--numstat', '--follow', '--', filePath];
    if (since) statArgs.splice(1, 0, `--since=${since}`);
    if (until) statArgs.splice(1, 0, `--until=${until}`);

    const statResult = await executeGitCommand(statArgs, cwd);

    let additions = 0;
    let deletions = 0;
    let lastModified = '';
    const authors = new Set<string>();

    if (statResult.success) {
      const lines = statResult.stdout.split('\n');
      for (const line of lines) {
        // Author line
        const authorMatch = line.match(/^(.+?)\|(.+)$/);
        if (authorMatch) {
          authors.add(authorMatch[1]);
          if (!lastModified) lastModified = authorMatch[2];
        }
        // Stats line
        const statMatch = line.match(/^(\d+)\s+(\d+)/);
        if (statMatch) {
          additions += parseInt(statMatch[1], 10);
          deletions += parseInt(statMatch[2], 10);
        }
      }
    }

    hotspots.push({
      path: filePath,
      changeCount,
      additions,
      deletions,
      churn: additions + deletions,
      lastModified,
      authors: Array.from(authors),
    });
  }

  return hotspots;
}

/**
 * Get branch activity
 */
async function getBranchActivity(cwd?: string, limit = 10): Promise<BranchActivity[]> {
  // Get current branch
  const currentResult = await executeGitCommand(['branch', '--show-current'], cwd);
  const currentBranch = currentResult.stdout || '';

  // Get default branch
  let defaultBranch = 'main';
  const mainCheck = await executeGitCommand(['show-ref', '--verify', 'refs/heads/main'], cwd);
  if (!mainCheck.success) {
    const masterCheck = await executeGitCommand(['show-ref', '--verify', 'refs/heads/master'], cwd);
    if (masterCheck.success) defaultBranch = 'master';
  }

  // Get all local branches with last commit info
  const branchArgs = [
    'for-each-ref',
    '--sort=-committerdate',
    '--format=%(refname:short)|%(objectname:short)|%(committerdate:iso)|%(authorname)',
    'refs/heads/',
    `--count=${limit}`,
  ];

  const branchResult = await executeGitCommand(branchArgs, cwd);
  if (!branchResult.success) return [];

  const branches: BranchActivity[] = [];

  for (const line of branchResult.stdout.split('\n').filter((l) => l.trim())) {
    const [name, , lastCommit, contributor] = line.split('|');

    // Get commit count on this branch
    const countResult = await executeGitCommand(['rev-list', '--count', name], cwd);
    const commits = countResult.success ? parseInt(countResult.stdout, 10) : 0;

    // Get ahead/behind from default branch
    let ahead = 0;
    let behind = 0;
    if (name !== defaultBranch) {
      const compareResult = await executeGitCommand(
        ['rev-list', '--left-right', '--count', `${defaultBranch}...${name}`],
        cwd
      );
      if (compareResult.success) {
        const parts = compareResult.stdout.split(/\s+/);
        behind = parseInt(parts[0], 10) || 0;
        ahead = parseInt(parts[1], 10) || 0;
      }
    }

    // Get contributors to this branch (unique authors in last 50 commits)
    const authorsResult = await executeGitCommand(
      ['log', '-50', '--format=%an', name],
      cwd
    );
    const contributors = authorsResult.success
      ? [...new Set(authorsResult.stdout.split('\n').filter((a) => a.trim()))]
      : [contributor];

    branches.push({
      name,
      commits,
      isCurrent: name === currentBranch,
      lastCommit,
      ahead,
      behind,
      contributors: contributors.slice(0, 5),
    });
  }

  return branches;
}

/**
 * Get code churn analysis
 */
async function getCodeChurn(
  cwd?: string,
  since?: string,
  until?: string
): Promise<CodeChurn> {
  const args = ['log', '--format=', '--numstat', '--no-merges'];
  if (since) args.push(`--since=${since}`);
  if (until) args.push(`--until=${until}`);

  const result = await executeGitCommand(args, cwd);

  let totalAdditions = 0;
  let totalDeletions = 0;
  let commitCount = 0;

  // Count commits
  const commitArgs = ['rev-list', '--count', '--no-merges', 'HEAD'];
  if (since) commitArgs.push(`--since=${since}`);
  if (until) commitArgs.push(`--until=${until}`);
  const commitResult = await executeGitCommand(commitArgs, cwd);
  if (commitResult.success) {
    commitCount = parseInt(commitResult.stdout, 10) || 1;
  }

  if (result.success) {
    for (const line of result.stdout.split('\n')) {
      const match = line.match(/^(\d+)\s+(\d+)/);
      if (match) {
        totalAdditions += parseInt(match[1], 10);
        totalDeletions += parseInt(match[2], 10);
      }
    }
  }

  const hotspots = await getFileHotspots(cwd, since, until, 10);

  return {
    totalAdditions,
    totalDeletions,
    netChange: totalAdditions - totalDeletions,
    churnRate: totalAdditions + totalDeletions,
    avgChurnPerCommit: Math.round((totalAdditions + totalDeletions) / Math.max(commitCount, 1)),
    highChurnFiles: hotspots.sort((a, b) => b.churn - a.churn).slice(0, 5),
  };
}

/**
 * Get repository overview
 */
async function getRepoOverview(cwd?: string): Promise<RepoOverview> {
  // Total commits
  const commitResult = await executeGitCommand(['rev-list', '--count', 'HEAD'], cwd);
  const totalCommits = commitResult.success ? parseInt(commitResult.stdout, 10) : 0;

  // Total contributors
  const contributorResult = await executeGitCommand(['shortlog', '-sn', 'HEAD'], cwd);
  const totalContributors = contributorResult.success
    ? contributorResult.stdout.split('\n').filter((l) => l.trim()).length
    : 0;

  // First and last commit dates
  const firstResult = await executeGitCommand(['log', '--reverse', '--format=%aI', '-1'], cwd);
  const lastResult = await executeGitCommand(['log', '--format=%aI', '-1'], cwd);

  const firstCommitDate = firstResult.stdout || '';
  const lastCommitDate = lastResult.stdout || '';

  const ageInDays = firstCommitDate
    ? Math.floor((Date.now() - new Date(firstCommitDate).getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  // Total branches
  const branchResult = await executeGitCommand(['branch', '-a', '--list'], cwd);
  const totalBranches = branchResult.success
    ? branchResult.stdout.split('\n').filter((l) => l.trim()).length
    : 0;

  // Total tags
  const tagResult = await executeGitCommand(['tag', '-l'], cwd);
  const totalTags = tagResult.success
    ? tagResult.stdout.split('\n').filter((l) => l.trim()).length
    : 0;

  // Lines of code (approximate via cloc or wc)
  let totalLinesOfCode = 0;
  const locResult = await executeGitCommand(
    ['ls-files', '--', '*.ts', '*.tsx', '*.js', '*.jsx', '*.py', '*.java', '*.go', '*.rs', '*.c', '*.cpp', '*.h'],
    cwd
  );
  if (locResult.success) {
    const files = locResult.stdout.split('\n').filter((f) => f.trim());
    // Rough estimate: count newlines in each file
    for (const file of files.slice(0, 100)) {
      const wcResult = await executeGitCommand(['show', `HEAD:${file}`], cwd);
      if (wcResult.success) {
        totalLinesOfCode += wcResult.stdout.split('\n').length;
      }
    }
    // Extrapolate if we sampled
    if (files.length > 100) {
      totalLinesOfCode = Math.round(totalLinesOfCode * (files.length / 100));
    }
  }

  // Language breakdown
  const languages: { name: string; percentage: number; files: number }[] = [];
  const langResult = await executeGitCommand(['ls-files'], cwd);
  if (langResult.success) {
    const allFiles = langResult.stdout.split('\n').filter((f) => f.trim());
    const extCounts = new Map<string, number>();

    for (const file of allFiles) {
      const ext = path.extname(file).toLowerCase();
      if (ext) {
        extCounts.set(ext, (extCounts.get(ext) || 0) + 1);
      }
    }

    const langMap: Record<string, string> = {
      '.ts': 'TypeScript',
      '.tsx': 'TypeScript',
      '.js': 'JavaScript',
      '.jsx': 'JavaScript',
      '.py': 'Python',
      '.java': 'Java',
      '.go': 'Go',
      '.rs': 'Rust',
      '.c': 'C',
      '.cpp': 'C++',
      '.h': 'C/C++',
      '.css': 'CSS',
      '.scss': 'SCSS',
      '.html': 'HTML',
      '.json': 'JSON',
      '.md': 'Markdown',
      '.yml': 'YAML',
      '.yaml': 'YAML',
    };

    const langCounts = new Map<string, number>();
    for (const [ext, count] of extCounts) {
      const lang = langMap[ext] || ext;
      langCounts.set(lang, (langCounts.get(lang) || 0) + count);
    }

    const sortedLangs = Array.from(langCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    const total = sortedLangs.reduce((sum, [, count]) => sum + count, 0);
    for (const [name, files] of sortedLangs) {
      languages.push({
        name,
        percentage: Math.round((files / total) * 1000) / 10,
        files,
      });
    }
  }

  return {
    totalCommits,
    totalContributors,
    ageInDays,
    firstCommitDate,
    lastCommitDate,
    totalBranches,
    totalTags,
    totalLinesOfCode,
    languages,
  };
}

/**
 * Export stats to various formats
 */
function exportStats(stats: RepositoryStats, format: 'json' | 'csv' | 'markdown'): StatsExport {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);

  switch (format) {
    case 'csv': {
      const lines: string[] = [];

      // Overview section
      lines.push('# Repository Overview');
      lines.push('Metric,Value');
      lines.push(`Total Commits,${stats.overview.totalCommits}`);
      lines.push(`Total Contributors,${stats.overview.totalContributors}`);
      lines.push(`Age (days),${stats.overview.ageInDays}`);
      lines.push(`Total Branches,${stats.overview.totalBranches}`);
      lines.push(`Total Tags,${stats.overview.totalTags}`);
      lines.push(`Lines of Code,${stats.overview.totalLinesOfCode}`);
      lines.push('');

      // Contributors section
      lines.push('# Top Contributors');
      lines.push('Name,Email,Commits,Additions,Deletions,Percentage');
      for (const c of stats.contributors) {
        lines.push(`"${c.name}","${c.email}",${c.commits},${c.additions},${c.deletions},${c.percentage}%`);
      }
      lines.push('');

      // Hotspots section
      lines.push('# File Hotspots');
      lines.push('Path,Changes,Additions,Deletions,Churn');
      for (const h of stats.hotspots) {
        lines.push(`"${h.path}",${h.changeCount},${h.additions},${h.deletions},${h.churn}`);
      }

      return {
        format: 'csv',
        content: lines.join('\n'),
        filename: `repo-stats-${timestamp}.csv`,
      };
    }

    case 'markdown': {
      const lines: string[] = [];

      lines.push('# Repository Statistics Report');
      lines.push(`Generated: ${stats.generatedAt}`);
      lines.push('');

      lines.push('## Overview');
      lines.push(`| Metric | Value |`);
      lines.push(`|--------|-------|`);
      lines.push(`| Total Commits | ${stats.overview.totalCommits.toLocaleString()} |`);
      lines.push(`| Contributors | ${stats.overview.totalContributors} |`);
      lines.push(`| Age | ${stats.overview.ageInDays} days |`);
      lines.push(`| Branches | ${stats.overview.totalBranches} |`);
      lines.push(`| Tags | ${stats.overview.totalTags} |`);
      lines.push(`| Lines of Code | ~${stats.overview.totalLinesOfCode.toLocaleString()} |`);
      lines.push('');

      lines.push('## Top Contributors');
      lines.push('| Author | Commits | +/- | % |');
      lines.push('|--------|---------|-----|---|');
      for (const c of stats.contributors.slice(0, 10)) {
        lines.push(
          `| ${c.name} | ${c.commits} | +${c.additions}/-${c.deletions} | ${c.percentage}% |`
        );
      }
      lines.push('');

      lines.push('## Code Churn');
      lines.push(`- Total Additions: +${stats.codeChurn.totalAdditions.toLocaleString()}`);
      lines.push(`- Total Deletions: -${stats.codeChurn.totalDeletions.toLocaleString()}`);
      lines.push(`- Net Change: ${stats.codeChurn.netChange.toLocaleString()}`);
      lines.push(`- Avg Churn/Commit: ${stats.codeChurn.avgChurnPerCommit}`);
      lines.push('');

      lines.push('## File Hotspots');
      lines.push('| File | Changes | Churn |');
      lines.push('|------|---------|-------|');
      for (const h of stats.hotspots.slice(0, 10)) {
        lines.push(`| ${h.path} | ${h.changeCount} | ${h.churn} |`);
      }
      lines.push('');

      lines.push('## Branch Activity');
      lines.push('| Branch | Commits | Status |');
      lines.push('|--------|---------|--------|');
      for (const b of stats.branches.slice(0, 10)) {
        const status = b.isCurrent
          ? 'current'
          : `+${b.ahead}/-${b.behind}`;
        lines.push(`| ${b.name} | ${b.commits} | ${status} |`);
      }

      return {
        format: 'markdown',
        content: lines.join('\n'),
        filename: `repo-stats-${timestamp}.md`,
      };
    }

    default:
      return {
        format: 'json',
        content: JSON.stringify(stats, null, 2),
        filename: `repo-stats-${timestamp}.json`,
      };
  }
}

// ============================================================================
// Git Stats Tools
// ============================================================================

/**
 * Get comprehensive repository statistics
 */
export const gitRepoStatsTool: AgentTool = {
  name: 'git_repo_stats',
  description:
    'Get comprehensive git repository statistics including commit frequency, contributor stats, ' +
    'code churn analysis, file hotspots, and branch activity. ' +
    'Use with voice command "Show repo stats" or "What are the repository statistics?".',
  parameters: {
    type: 'object',
    properties: {
      since: {
        type: 'string',
        description: 'Start date for analysis (e.g., "2024-01-01", "6 months ago", "last year")',
      },
      until: {
        type: 'string',
        description: 'End date for analysis (default: now)',
      },
      contributorLimit: {
        type: 'number',
        description: 'Maximum number of contributors to return (default: 20)',
      },
      hotspotLimit: {
        type: 'number',
        description: 'Maximum number of file hotspots to return (default: 20)',
      },
      branchLimit: {
        type: 'number',
        description: 'Maximum number of branches to analyze (default: 10)',
      },
      path: {
        type: 'string',
        description: 'Repository directory path (default: current directory)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const cwd = params.path as string | undefined;
    const since = params.since as string | undefined;
    const until = params.until as string | undefined;
    const contributorLimit = (params.contributorLimit as number) || 20;
    const hotspotLimit = (params.hotspotLimit as number) || 20;
    const branchLimit = (params.branchLimit as number) || 10;

    try {
      if (!(await isGitRepository(cwd))) {
        return { success: false, error: 'Not a git repository' };
      }

      logger.info('Generating repository statistics', { since, until });

      // Gather all statistics in parallel where possible
      const [overview, commitFrequency, contributors, codeChurn, hotspots, branches] =
        await Promise.all([
          getRepoOverview(cwd),
          getCommitFrequency(cwd, since, until, 'day'),
          getContributorStats(cwd, since, until, contributorLimit),
          getCodeChurn(cwd, since, until),
          getFileHotspots(cwd, since, until, hotspotLimit),
          getBranchActivity(cwd, branchLimit),
        ]);

      const stats: RepositoryStats = {
        overview,
        commitFrequency,
        contributors,
        codeChurn,
        hotspots,
        branches,
        generatedAt: new Date().toISOString(),
        period: { since, until },
      };

      logger.info('Repository statistics generated', {
        commits: overview.totalCommits,
        contributors: overview.totalContributors,
      });

      return {
        success: true,
        data: stats,
      };
    } catch (error) {
      logger.error('Failed to generate repo stats', { error: (error as Error).message });
      return {
        success: false,
        error: `Failed to generate repository statistics: ${(error as Error).message}`,
      };
    }
  },
};

/**
 * Get commit frequency chart data
 */
export const gitCommitFrequencyTool: AgentTool = {
  name: 'git_commit_frequency',
  description:
    'Get commit frequency data for visualization as a chart. ' +
    'Returns commit counts by day, week, or month.',
  parameters: {
    type: 'object',
    properties: {
      since: {
        type: 'string',
        description: 'Start date (default: 6 months ago)',
      },
      until: {
        type: 'string',
        description: 'End date (default: now)',
      },
      granularity: {
        type: 'string',
        description: 'Time granularity: "day", "week", or "month" (default: day)',
      },
      path: {
        type: 'string',
        description: 'Repository directory path (default: current directory)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const cwd = params.path as string | undefined;
    const since = (params.since as string) || '6 months ago';
    const until = params.until as string | undefined;
    const granularity = (params.granularity as 'day' | 'week' | 'month') || 'day';

    try {
      if (!(await isGitRepository(cwd))) {
        return { success: false, error: 'Not a git repository' };
      }

      const frequency = await getCommitFrequency(cwd, since, until, granularity);

      return {
        success: true,
        data: {
          frequency,
          granularity,
          period: { since, until },
          totalCommits: frequency.reduce((sum, p) => sum + p.count, 0),
        },
      };
    } catch (error) {
      logger.error('Failed to get commit frequency', { error: (error as Error).message });
      return {
        success: false,
        error: `Failed to get commit frequency: ${(error as Error).message}`,
      };
    }
  },
};

/**
 * Get contributor statistics
 */
export const gitContributorStatsTool: AgentTool = {
  name: 'git_contributor_stats',
  description:
    'Get detailed contributor statistics including commit counts, lines changed, and activity period.',
  parameters: {
    type: 'object',
    properties: {
      since: {
        type: 'string',
        description: 'Start date for analysis',
      },
      until: {
        type: 'string',
        description: 'End date for analysis',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of contributors (default: 20)',
      },
      path: {
        type: 'string',
        description: 'Repository directory path (default: current directory)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const cwd = params.path as string | undefined;
    const since = params.since as string | undefined;
    const until = params.until as string | undefined;
    const limit = (params.limit as number) || 20;

    try {
      if (!(await isGitRepository(cwd))) {
        return { success: false, error: 'Not a git repository' };
      }

      const contributors = await getContributorStats(cwd, since, until, limit);

      return {
        success: true,
        data: {
          contributors,
          period: { since, until },
          totalContributors: contributors.length,
        },
      };
    } catch (error) {
      logger.error('Failed to get contributor stats', { error: (error as Error).message });
      return {
        success: false,
        error: `Failed to get contributor statistics: ${(error as Error).message}`,
      };
    }
  },
};

/**
 * Export repository statistics
 */
export const gitExportStatsTool: AgentTool = {
  name: 'git_export_stats',
  description:
    'Export repository statistics to JSON, CSV, or Markdown format. ' +
    'Use with voice command "Export repo stats as markdown".',
  parameters: {
    type: 'object',
    properties: {
      format: {
        type: 'string',
        description: 'Export format: "json", "csv", or "markdown" (default: json)',
      },
      since: {
        type: 'string',
        description: 'Start date for analysis',
      },
      until: {
        type: 'string',
        description: 'End date for analysis',
      },
      path: {
        type: 'string',
        description: 'Repository directory path (default: current directory)',
      },
    },
    required: [],
  },
  execute: async (params: Record<string, unknown>): Promise<ActionResult> => {
    const cwd = params.path as string | undefined;
    const format = (params.format as 'json' | 'csv' | 'markdown') || 'json';
    const since = params.since as string | undefined;
    const until = params.until as string | undefined;

    try {
      if (!(await isGitRepository(cwd))) {
        return { success: false, error: 'Not a git repository' };
      }

      // Generate stats first
      const [overview, commitFrequency, contributors, codeChurn, hotspots, branches] =
        await Promise.all([
          getRepoOverview(cwd),
          getCommitFrequency(cwd, since, until, 'day'),
          getContributorStats(cwd, since, until, 20),
          getCodeChurn(cwd, since, until),
          getFileHotspots(cwd, since, until, 20),
          getBranchActivity(cwd, 10),
        ]);

      const stats: RepositoryStats = {
        overview,
        commitFrequency,
        contributors,
        codeChurn,
        hotspots,
        branches,
        generatedAt: new Date().toISOString(),
        period: { since, until },
      };

      const exported = exportStats(stats, format);

      logger.info('Repository statistics exported', { format, filename: exported.filename });

      return {
        success: true,
        data: exported,
      };
    } catch (error) {
      logger.error('Failed to export stats', { error: (error as Error).message });
      return {
        success: false,
        error: `Failed to export repository statistics: ${(error as Error).message}`,
      };
    }
  },
};

// ============================================================================
// Tool Registry
// ============================================================================

/**
 * Get all git stats tools
 */
export function getGitStatsTools(): AgentTool[] {
  return [
    gitRepoStatsTool,
    gitCommitFrequencyTool,
    gitContributorStatsTool,
    gitExportStatsTool,
  ];
}

export default {
  gitRepoStatsTool,
  gitCommitFrequencyTool,
  gitContributorStatsTool,
  gitExportStatsTool,
  getGitStatsTools,
};
