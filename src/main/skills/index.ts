/**
 * @fileoverview Skills module index - exports all skill-related functionality
 * @module skills
 */

// ClawdHub client for skill discovery
export {
  ClawdHubClient,
  getClawdHubClient,
  shutdownClawdHubClient,
  type ClawdHubSkill,
  type ClawdHubSearchParams,
  type ClawdHubSearchResult,
  type ClawdHubCategory,
  type ClawdHubReview,
  type ClawdHubClientConfig,
} from './clawdhub-client';

// Git-based skill installer
export {
  GitInstaller,
  getGitInstaller,
  initializeGitInstaller,
  shutdownGitInstaller,
  type InstallProgress,
  type InstalledSkill,
  type InstallOptions,
  type SkillManifest,
} from './git-installer';
