/**
 * Nova Desktop - Git Output Parser
 * Parses git command output into structured data
 */

import {
  GitStatusResult,
  GitStatusFile,
  GitFileStatus,
  GitCommitInfo,
  GitLogResult,
  GitDiffResult,
  GitDiffEntry,
  GitBranchInfo,
  GitBranchListResult,
  GitRemoteInfo,
  GitStashEntry,
  GitTagInfo,
} from '../types';

/**
 * Parse git status --porcelain=v2 --branch output
 */
export function parseGitStatus(output: string): GitStatusResult {
  const lines = output.trim().split('\n').filter(Boolean);
  const result: GitStatusResult = {
    branch: 'HEAD',
    ahead: 0,
    behind: 0,
    staged: [],
    unstaged: [],
    untracked: [],
    conflicts: [],
    clean: true,
  };

  for (const line of lines) {
    if (line.startsWith('# branch.head ')) {
      result.branch = line.slice(14);
    } else if (line.startsWith('# branch.upstream ')) {
      result.tracking = line.slice(18);
    } else if (line.startsWith('# branch.ab ')) {
      const match = line.match(/\+(\d+) -(\d+)/);
      if (match) {
        result.ahead = parseInt(match[1], 10);
        result.behind = parseInt(match[2], 10);
      }
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      // Changed entries
      const entry = parseStatusEntry(line);
      if (entry) {
        if (entry.staged) {
          result.staged.push(entry);
        } else {
          result.unstaged.push(entry);
        }
        result.clean = false;
      }
    } else if (line.startsWith('? ')) {
      // Untracked
      result.untracked.push(line.slice(2));
      result.clean = false;
    } else if (line.startsWith('u ')) {
      // Unmerged (conflict)
      const path = line.split('\t').pop() || '';
      result.conflicts.push(path);
      result.clean = false;
    }
  }

  return result;
}

/**
 * Parse a single status entry
 */
function parseStatusEntry(line: string): GitStatusFile | null {
  const parts = line.split(' ');
  if (parts.length < 2) return null;

  const xy = parts[1];
  const stagedCode = xy[0];
  const unstagedCode = xy[1];

  // Get path (last tab-separated field for renames, or after the status codes)
  const tabIndex = line.indexOf('\t');
  let path = '';
  let oldPath: string | undefined;

  if (tabIndex !== -1) {
    const paths = line.slice(tabIndex + 1).split('\t');
    path = paths[paths.length - 1];
    if (paths.length > 1) {
      oldPath = paths[0];
    }
  } else {
    // Fallback: get the last space-separated part
    path = parts[parts.length - 1];
  }

  const status = codeToStatus(stagedCode !== '.' ? stagedCode : unstagedCode);
  const staged = stagedCode !== '.';

  return {
    path,
    status,
    staged,
    oldPath,
  };
}

/**
 * Convert git status code to status type
 */
function codeToStatus(code: string): GitFileStatus {
  switch (code) {
    case 'M':
      return 'modified';
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    case '?':
      return 'untracked';
    case '!':
      return 'ignored';
    case 'U':
      return 'unmerged';
    default:
      return 'modified';
  }
}

/**
 * Parse git log output (--format=<format>)
 * Format: hash|shortHash|author|email|date|subject
 */
export function parseGitLog(output: string, branch: string): GitLogResult {
  const lines = output.trim().split('\n').filter(Boolean);
  const commits: GitCommitInfo[] = [];

  for (const line of lines) {
    const parts = line.split('|');
    if (parts.length >= 6) {
      commits.push({
        hash: parts[0],
        shortHash: parts[1],
        author: parts[2],
        authorEmail: parts[3],
        date: parts[4],
        message: parts[5],
        subject: parts[5],
        body: parts.slice(6).join('|') || undefined,
      });
    }
  }

  return {
    commits,
    total: commits.length,
    branch,
  };
}

/**
 * Parse git diff --numstat output
 */
export function parseGitDiff(output: string, _patchOutput?: string): GitDiffResult {
  const lines = output.trim().split('\n').filter(Boolean);
  const files: GitDiffEntry[] = [];
  let totalAdditions = 0;
  let totalDeletions = 0;

  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length >= 3) {
      const additions = parts[0] === '-' ? 0 : parseInt(parts[0], 10);
      const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10);
      const pathPart = parts.slice(2).join('\t');

      // Handle renames: old => new
      const renameParts = pathPart.split(' => ');
      let path = pathPart;
      let oldPath: string | undefined;

      if (renameParts.length === 2) {
        oldPath = renameParts[0].replace(/^\{|\}$/g, '');
        path = renameParts[1].replace(/^\{|\}$/g, '');
      }

      const binary = parts[0] === '-' && parts[1] === '-';
      let status: 'added' | 'deleted' | 'modified' | 'renamed' = 'modified';

      if (oldPath) {
        status = 'renamed';
      } else if (additions > 0 && deletions === 0) {
        status = 'added';
      } else if (deletions > 0 && additions === 0) {
        status = 'deleted';
      }

      files.push({
        path,
        oldPath,
        status,
        additions,
        deletions,
        binary,
      });

      totalAdditions += additions;
      totalDeletions += deletions;
    }
  }

  return {
    files,
    totalAdditions,
    totalDeletions,
    filesChanged: files.length,
  };
}

/**
 * Parse git branch output
 */
export function parseGitBranches(localOutput: string, remoteOutput?: string): GitBranchListResult {
  const local: GitBranchInfo[] = [];
  const remote: GitBranchInfo[] = [];
  let current = '';

  // Parse local branches
  const localLines = localOutput.trim().split('\n').filter(Boolean);
  for (const line of localLines) {
    const isCurrent = line.startsWith('* ');
    const name = line.replace(/^\*?\s+/, '').split(/\s+/)[0];

    if (isCurrent) {
      current = name;
    }

    // Check for tracking info in format: name [upstream: ahead N, behind M]
    const trackingMatch = line.match(/\[([^\]]+)\]/);
    let tracking: string | undefined;
    let ahead: number | undefined;
    let behind: number | undefined;

    if (trackingMatch) {
      const trackingInfo = trackingMatch[1];
      const parts = trackingInfo.split(':');
      tracking = parts[0].trim();

      const aheadMatch = trackingInfo.match(/ahead (\d+)/);
      const behindMatch = trackingInfo.match(/behind (\d+)/);
      if (aheadMatch) ahead = parseInt(aheadMatch[1], 10);
      if (behindMatch) behind = parseInt(behindMatch[1], 10);
    }

    local.push({
      name,
      current: isCurrent,
      tracking,
      ahead,
      behind,
    });
  }

  // Parse remote branches if provided
  if (remoteOutput) {
    const remoteLines = remoteOutput.trim().split('\n').filter(Boolean);
    for (const line of remoteLines) {
      const name = line.trim();
      if (name && !name.includes('->')) {
        remote.push({
          name,
          current: false,
        });
      }
    }
  }

  return { current, local, remote };
}

/**
 * Parse git remote -v output
 */
export function parseGitRemotes(output: string): GitRemoteInfo[] {
  const remotes = new Map<string, GitRemoteInfo>();
  const lines = output.trim().split('\n').filter(Boolean);

  for (const line of lines) {
    const match = line.match(/^(\S+)\s+(\S+)\s+\((\w+)\)$/);
    if (match) {
      const [, name, url, type] = match;

      if (!remotes.has(name)) {
        remotes.set(name, {
          name,
          fetchUrl: '',
          pushUrl: '',
        });
      }

      const remote = remotes.get(name)!;
      if (type === 'fetch') {
        remote.fetchUrl = url;
      } else if (type === 'push') {
        remote.pushUrl = url;
      }
    }
  }

  return Array.from(remotes.values());
}

/**
 * Parse git stash list output
 */
export function parseGitStashList(output: string): GitStashEntry[] {
  const entries: GitStashEntry[] = [];
  const lines = output.trim().split('\n').filter(Boolean);

  for (const line of lines) {
    // Format: stash@{0}: WIP on branch: message
    const match = line.match(/^stash@\{(\d+)\}:\s*(?:WIP on|On)\s*(\S+):\s*(.*)$/);
    if (match) {
      entries.push({
        index: parseInt(match[1], 10),
        branch: match[2],
        message: match[3],
        date: '', // Not available in list output
      });
    }
  }

  return entries;
}

/**
 * Parse git tag output
 */
export function parseGitTags(output: string): GitTagInfo[] {
  const tags: GitTagInfo[] = [];
  const lines = output.trim().split('\n').filter(Boolean);

  for (const line of lines) {
    // Simple tag name, we'll get more info if needed
    const name = line.trim();
    if (name) {
      tags.push({
        name,
        hash: '', // Would need separate command
        annotated: false, // Would need separate check
      });
    }
  }

  return tags;
}

/**
 * Parse git show-ref --tags for tag hashes
 */
export function parseGitTagRefs(output: string): Map<string, string> {
  const refs = new Map<string, string>();
  const lines = output.trim().split('\n').filter(Boolean);

  for (const line of lines) {
    const [hash, ref] = line.split(' ');
    if (hash && ref) {
      const tagName = ref.replace('refs/tags/', '');
      refs.set(tagName, hash);
    }
  }

  return refs;
}

export default {
  parseGitStatus,
  parseGitLog,
  parseGitDiff,
  parseGitBranches,
  parseGitRemotes,
  parseGitStashList,
  parseGitTags,
  parseGitTagRefs,
};
