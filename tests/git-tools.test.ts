/**
 * Git Tools Tests
 * Tests for git tool commands and utilities
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseGitStatus,
  parseGitLog,
  parseGitDiff,
  parseGitBranches,
  parseGitRemotes,
  parseGitStashList,
} from '../src/main/agent/tools/git/utils/parser';
import {
  validateBranchName,
  validateCommitMessage,
  validatePushOperation,
  validateResetOperation,
  validateRemoteUrl,
} from '../src/main/agent/tools/git/utils/validator';
import { getGitTools } from '../src/main/agent/tools/git';
import {
  summarizeToolResultForVoice,
  getContextualTools,
} from '../src/main/agent/llm-tools';

describe('Git Parser', () => {
  describe('parseGitStatus', () => {
    it('should parse clean repository status', () => {
      const output = `# branch.head main
# branch.upstream origin/main
# branch.ab +0 -0`;

      const result = parseGitStatus(output);

      expect(result.branch).toBe('main');
      expect(result.tracking).toBe('origin/main');
      expect(result.ahead).toBe(0);
      expect(result.behind).toBe(0);
      expect(result.clean).toBe(true);
    });

    it('should parse status with modified files', () => {
      const output = `# branch.head feature
# branch.ab +2 -1
1 M. N... 100644 100644 100644 abc123 def456 src/file.ts`;

      const result = parseGitStatus(output);

      expect(result.branch).toBe('feature');
      expect(result.ahead).toBe(2);
      expect(result.behind).toBe(1);
      expect(result.clean).toBe(false);
      expect(result.staged.length).toBe(1);
    });

    it('should parse untracked files', () => {
      const output = `# branch.head main
? new-file.ts
? another-file.ts`;

      const result = parseGitStatus(output);

      expect(result.untracked).toContain('new-file.ts');
      expect(result.untracked).toContain('another-file.ts');
      expect(result.clean).toBe(false);
    });
  });

  describe('parseGitLog', () => {
    it('should parse commit log', () => {
      const output = `abc123|abc12|John Doe|john@example.com|2024-01-15|feat: add feature
def456|def45|Jane Doe|jane@example.com|2024-01-14|fix: bug fix`;

      const result = parseGitLog(output, 'main');

      expect(result.commits).toHaveLength(2);
      expect(result.commits[0].hash).toBe('abc123');
      expect(result.commits[0].author).toBe('John Doe');
      expect(result.commits[0].message).toBe('feat: add feature');
      expect(result.branch).toBe('main');
    });

    it('should handle empty log', () => {
      const result = parseGitLog('', 'main');

      expect(result.commits).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('parseGitDiff', () => {
    it('should parse diff numstat', () => {
      const output = `10\t5\tsrc/file1.ts
20\t3\tsrc/file2.ts`;

      const result = parseGitDiff(output);

      expect(result.files).toHaveLength(2);
      expect(result.files[0].additions).toBe(10);
      expect(result.files[0].deletions).toBe(5);
      expect(result.totalAdditions).toBe(30);
      expect(result.totalDeletions).toBe(8);
    });

    it('should handle binary files', () => {
      const output = `-\t-\timage.png`;

      const result = parseGitDiff(output);

      expect(result.files[0].binary).toBe(true);
      expect(result.files[0].additions).toBe(0);
    });
  });

  describe('parseGitBranches', () => {
    it('should parse local branches', () => {
      const output = `* main abc123 commit message
  feature def456 another commit`;

      const result = parseGitBranches(output);

      expect(result.current).toBe('main');
      expect(result.local).toHaveLength(2);
      expect(result.local[0].name).toBe('main');
      expect(result.local[0].current).toBe(true);
      expect(result.local[1].name).toBe('feature');
      expect(result.local[1].current).toBe(false);
    });

    it('should parse remote branches', () => {
      const local = '* main abc123 commit';
      const remote = `origin/main
origin/feature`;

      const result = parseGitBranches(local, remote);

      expect(result.remote).toHaveLength(2);
      expect(result.remote[0].name).toBe('origin/main');
    });
  });

  describe('parseGitRemotes', () => {
    it('should parse remote list', () => {
      const output = `origin\thttps://github.com/user/repo.git (fetch)
origin\thttps://github.com/user/repo.git (push)
upstream\thttps://github.com/other/repo.git (fetch)
upstream\thttps://github.com/other/repo.git (push)`;

      const result = parseGitRemotes(output);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('origin');
      expect(result[0].fetchUrl).toBe('https://github.com/user/repo.git');
      expect(result[1].name).toBe('upstream');
    });
  });

  describe('parseGitStashList', () => {
    it('should parse stash list', () => {
      const output = `stash@{0}: WIP on main: work in progress
stash@{1}: On feature: saving changes`;

      const result = parseGitStashList(output);

      expect(result).toHaveLength(2);
      expect(result[0].index).toBe(0);
      expect(result[0].branch).toBe('main');
      expect(result[0].message).toBe('work in progress');
    });

    it('should handle empty stash list', () => {
      const result = parseGitStashList('');

      expect(result).toHaveLength(0);
    });
  });
});

describe('Git Validator', () => {
  describe('validateBranchName', () => {
    it('should accept valid branch names', () => {
      const result = validateBranchName('feature/add-login');
      expect(result.valid).toBe(true);
    });

    it('should reject branch names with invalid characters', () => {
      const result = validateBranchName('branch name');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should reject branch names starting with hyphen', () => {
      const result = validateBranchName('-feature');
      expect(result.valid).toBe(false);
    });

    it('should reject branch names with consecutive periods', () => {
      const result = validateBranchName('feature..name');
      expect(result.valid).toBe(false);
    });

    it('should warn about protected branches', () => {
      const result = validateBranchName('main');
      expect(result.valid).toBe(true);
      expect(result.warnings).toContain("'main' is typically a protected branch");
    });
  });

  describe('validateCommitMessage', () => {
    it('should accept valid commit messages', () => {
      const result = validateCommitMessage('feat: add new feature');
      expect(result.valid).toBe(true);
    });

    it('should reject empty commit messages', () => {
      const result = validateCommitMessage('');
      expect(result.valid).toBe(false);
    });

    it('should warn about non-conventional format', () => {
      const result = validateCommitMessage('Added some feature');
      expect(result.valid).toBe(true);
      expect(result.warnings.some((w: string) => w.includes('conventional'))).toBe(true);
    });

    it('should warn about very short messages', () => {
      const result = validateCommitMessage('fix');
      expect(result.warnings.some((w: string) => w.includes('short'))).toBe(true);
    });

    it('should warn about long subject lines', () => {
      const longMessage = 'feat: ' + 'a'.repeat(80);
      const result = validateCommitMessage(longMessage);
      expect(result.warnings.some((w: string) => w.includes('72'))).toBe(true);
    });
  });

  describe('validatePushOperation', () => {
    it('should accept normal push', () => {
      const result = validatePushOperation({});
      expect(result.valid).toBe(true);
      expect(result.riskLevel).toBe('low');
    });

    it('should warn about force push', () => {
      const result = validatePushOperation({ force: true });
      expect(result.riskLevel).toBe('high');
      expect(result.requiresConfirmation).toBe(true);
      expect(result.warnings.some((w: string) => w.includes('Force'))).toBe(true);
    });

    it('should extra warn about force push to protected branch', () => {
      const result = validatePushOperation({ force: true, branch: 'main' });
      expect(result.warnings.length).toBeGreaterThan(1);
    });
  });

  describe('validateResetOperation', () => {
    it('should accept soft reset', () => {
      const result = validateResetOperation({ mode: 'soft' });
      expect(result.valid).toBe(true);
      expect(result.riskLevel).toBe('low');
    });

    it('should warn about hard reset', () => {
      const result = validateResetOperation({ mode: 'hard' });
      expect(result.riskLevel).toBe('high');
      expect(result.requiresConfirmation).toBe(true);
    });

    it('should warn about resetting to previous commits', () => {
      const result = validateResetOperation({ mode: 'mixed', to: 'HEAD~1' });
      expect(result.requiresConfirmation).toBe(true);
    });
  });

  describe('validateRemoteUrl', () => {
    it('should accept HTTPS URLs', () => {
      const result = validateRemoteUrl('https://github.com/user/repo.git');
      expect(result.valid).toBe(true);
    });

    it('should accept SSH URLs', () => {
      const result = validateRemoteUrl('git@github.com:user/repo.git');
      expect(result.valid).toBe(true);
    });

    it('should reject empty URLs', () => {
      const result = validateRemoteUrl('');
      expect(result.valid).toBe(false);
    });
  });
});

describe('Git Tools Integration', () => {
  describe('getGitTools', () => {
    it('should return all git tools', () => {
      const tools = getGitTools();

      expect(tools.length).toBeGreaterThan(0);
      expect(tools.some((t) => t.name === 'git_status')).toBe(true);
      expect(tools.some((t) => t.name === 'git_commit')).toBe(true);
      expect(tools.some((t) => t.name === 'git_push')).toBe(true);
    });

    it('should have execute functions for all tools', () => {
      const tools = getGitTools();

      tools.forEach((tool) => {
        expect(typeof tool.execute).toBe('function');
      });
    });

    it('should have descriptions for all tools', () => {
      const tools = getGitTools();

      tools.forEach((tool) => {
        expect(tool.description).toBeDefined();
        expect(tool.description.length).toBeGreaterThan(0);
      });
    });
  });
});

describe('Git Tool Definitions', () => {
  describe('Tool Parameters', () => {
    it('git_status should have optional cwd parameter', () => {
      const tools = getGitTools();
      const statusTool = tools.find((t) => t.name === 'git_status');

      const params = statusTool?.parameters as { properties: Record<string, unknown>; required?: string[] };
      expect(params.properties.cwd).toBeDefined();
      expect(params.required || []).not.toContain('cwd');
    });

    it('git_commit should require message parameter', () => {
      const tools = getGitTools();
      const commitTool = tools.find((t) => t.name === 'git_commit');

      const params = commitTool?.parameters as { properties: Record<string, unknown>; required: string[] };
      expect(params.properties.message).toBeDefined();
      expect(params.required).toContain('message');
    });

    it('git_checkout should require target parameter', () => {
      const tools = getGitTools();
      const checkoutTool = tools.find((t) => t.name === 'git_checkout');

      const params = checkoutTool?.parameters as { properties: Record<string, unknown>; required: string[] };
      expect(params.properties.target).toBeDefined();
      expect(params.required).toContain('target');
    });

    it('git_clone should require url parameter', () => {
      const tools = getGitTools();
      const cloneTool = tools.find((t) => t.name === 'git_clone');

      const params = cloneTool?.parameters as { properties: Record<string, unknown>; required: string[] };
      expect(params.properties.url).toBeDefined();
      expect(params.required).toContain('url');
    });

    it('git_reset should require mode parameter', () => {
      const tools = getGitTools();
      const resetTool = tools.find((t) => t.name === 'git_reset');

      const params = resetTool?.parameters as { properties: Record<string, unknown>; required: string[] };
      expect(params.properties.mode).toBeDefined();
      expect(params.required).toContain('mode');
    });
  });
});

describe('LLM Tool Voice Summaries', () => {
  describe('Git tool summaries', () => {
    it('should summarize git_status for clean repo', () => {
      const result = summarizeToolResultForVoice('git_status', {
        success: true,
        data: { branch: 'main', clean: true, staged: [], unstaged: [], untracked: [] },
      });

      expect(result).toContain('main');
      expect(result).toContain('clean');
    });

    it('should summarize git_status with changes', () => {
      const result = summarizeToolResultForVoice('git_status', {
        success: true,
        data: {
          branch: 'feature',
          clean: false,
          staged: [{ path: 'file.ts' }],
          unstaged: [{ path: 'file2.ts' }],
          untracked: ['file3.ts'],
        },
      });

      expect(result).toContain('feature');
      expect(result).toContain('1 staged');
      expect(result).toContain('1 unstaged');
      expect(result).toContain('1 untracked');
    });

    it('should summarize git_commit', () => {
      const result = summarizeToolResultForVoice('git_commit', {
        success: true,
        data: { hash: 'abc1234567890' },
      });

      expect(result).toContain('abc1234');
    });

    it('should summarize git_push', () => {
      const result = summarizeToolResultForVoice('git_push', {
        success: true,
        data: { remote: 'origin', pushed: true },
      });

      expect(result).toContain('origin');
      expect(result).toContain('successfully');
    });

    it('should summarize git_pull with updates', () => {
      const result = summarizeToolResultForVoice('git_pull', {
        success: true,
        data: { updated: true, conflicts: false },
      });

      expect(result).toContain('new changes');
    });

    it('should summarize git_pull with conflicts', () => {
      const result = summarizeToolResultForVoice('git_pull', {
        success: true,
        data: { updated: true, conflicts: true },
      });

      expect(result).toContain('conflicts');
    });

    it('should summarize git_branch list', () => {
      const result = summarizeToolResultForVoice('git_branch', {
        success: true,
        data: {
          current: 'main',
          local: [{ name: 'main' }, { name: 'feature' }],
        },
      });

      expect(result).toContain('main');
      expect(result).toContain('2');
    });

    it('should summarize git_diff', () => {
      const result = summarizeToolResultForVoice('git_diff', {
        success: true,
        data: { filesChanged: 3, totalAdditions: 50, totalDeletions: 20 },
      });

      expect(result).toContain('3 files');
      expect(result).toContain('50 additions');
      expect(result).toContain('20 deletions');
    });

    it('should summarize git_log', () => {
      const result = summarizeToolResultForVoice('git_log', {
        success: true,
        data: { commits: [{}, {}, {}], total: 3 },
      });

      expect(result).toContain('3 commits');
    });

    it('should summarize git_stash list', () => {
      const result = summarizeToolResultForVoice('git_stash', {
        success: true,
        data: [{}, {}],
      });

      expect(result).toContain('2 stashed');
    });

    it('should summarize git_clone', () => {
      const result = summarizeToolResultForVoice('git_clone', {
        success: true,
        data: { cloned: true, directory: '/path/to/repo' },
      });

      expect(result).toContain('/path/to/repo');
    });

    it('should summarize git_init', () => {
      const result = summarizeToolResultForVoice('git_init', {
        success: true,
        data: { initialized: true },
      });

      expect(result).toContain('Initialized');
    });
  });
});

describe('Tool Category Registration', () => {
  it('should return all git tools from getGitTools', () => {
    const gitTools = getGitTools();
    expect(gitTools).toBeDefined();
    expect(gitTools.length).toBeGreaterThan(0);
    // Verify it has all the expected git tools
    expect(gitTools.length).toBe(21);
  });

  it('should include all expected git tools', () => {
    const gitTools = getGitTools();
    const gitToolNames = gitTools.map((t) => t.name);

    expect(gitToolNames).toContain('git_status');
    expect(gitToolNames).toContain('git_commit');
    expect(gitToolNames).toContain('git_push');
    expect(gitToolNames).toContain('git_pull');
    expect(gitToolNames).toContain('git_branch');
    expect(gitToolNames).toContain('git_checkout');
    expect(gitToolNames).toContain('git_merge');
    expect(gitToolNames).toContain('git_diff');
    expect(gitToolNames).toContain('git_log');
    expect(gitToolNames).toContain('git_stash');
    expect(gitToolNames).toContain('git_reset');
    expect(gitToolNames).toContain('git_rebase');
    expect(gitToolNames).toContain('git_tag');
    expect(gitToolNames).toContain('git_remote');
    expect(gitToolNames).toContain('git_fetch');
    expect(gitToolNames).toContain('git_clone');
    expect(gitToolNames).toContain('git_init');
  });
});

describe('Contextual Tool Selection', () => {
  it('should return git tools for git-related messages', () => {
    const tools = getContextualTools('Can you show me the git status?');

    const gitTools = tools.filter((t: { function: { name: string } }) =>
      t.function.name.startsWith('git_')
    );

    expect(gitTools.length).toBeGreaterThan(0);
  });

  it('should return git tools for commit messages', () => {
    const tools = getContextualTools('Please commit these changes');

    const gitTools = tools.filter((t: { function: { name: string } }) =>
      t.function.name.startsWith('git_')
    );

    expect(gitTools.length).toBeGreaterThan(0);
  });

  it('should return git tools for push messages', () => {
    const tools = getContextualTools('Push to the remote repository');

    const gitTools = tools.filter((t: { function: { name: string } }) =>
      t.function.name.startsWith('git_')
    );

    expect(gitTools.length).toBeGreaterThan(0);
  });

  it('should return git tools for branch messages', () => {
    const tools = getContextualTools('Create a new branch called feature');

    const gitTools = tools.filter((t: { function: { name: string } }) =>
      t.function.name.startsWith('git_')
    );

    expect(gitTools.length).toBeGreaterThan(0);
  });
});

