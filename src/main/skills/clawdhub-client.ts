/**
 * @fileoverview ClawdHub API Client for skill discovery and installation
 * @module skills/clawdhub-client
 * 
 * @description
 * Provides integration with ClawdHub registry for discovering, browsing,
 * and installing community skills. Supports search, categories, trending,
 * and one-click installation from git repositories.
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('ClawdHubClient');

// ClawdHub API base URL
const CLAWDHUB_API_BASE = 'https://api.clawdhub.com/v1';
const CLAWDHUB_CDN_BASE = 'https://cdn.clawdhub.com';

/**
 * Skill listing from ClawdHub registry
 */
export interface ClawdHubSkill {
  /** Unique skill identifier */
  id: string;
  /** Display name */
  name: string;
  /** Short description */
  description: string;
  /** Full description/README */
  readme?: string;
  /** Skill author */
  author: {
    username: string;
    displayName?: string;
    avatarUrl?: string;
    verified?: boolean;
  };
  /** Git repository URL */
  repository: string;
  /** Default branch */
  branch: string;
  /** Latest version tag */
  version: string;
  /** Skill categories */
  categories: string[];
  /** Search tags */
  tags: string[];
  /** Tool names this skill provides */
  tools: string[];
  /** Required environment variables */
  envVars?: string[];
  /** Required binaries */
  binaries?: string[];
  /** Download/install count */
  installs: number;
  /** Star/like count */
  stars: number;
  /** Average rating (1-5) */
  rating: number;
  /** Number of ratings */
  ratingCount: number;
  /** Creation timestamp */
  createdAt: string;
  /** Last update timestamp */
  updatedAt: string;
  /** Icon URL */
  iconUrl?: string;
  /** Screenshot URLs */
  screenshots?: string[];
  /** License identifier */
  license?: string;
  /** Minimum Atlas version */
  minAtlasVersion?: string;
  /** Whether skill is featured */
  featured?: boolean;
  /** Whether skill is verified */
  verified?: boolean;
}

/**
 * Search parameters for ClawdHub
 */
export interface ClawdHubSearchParams {
  /** Search query */
  query?: string;
  /** Filter by category */
  category?: string;
  /** Filter by tags */
  tags?: string[];
  /** Filter by author */
  author?: string;
  /** Sort field */
  sortBy?: 'installs' | 'stars' | 'rating' | 'updated' | 'created' | 'name';
  /** Sort direction */
  sortOrder?: 'asc' | 'desc';
  /** Page number (1-indexed) */
  page?: number;
  /** Results per page */
  perPage?: number;
  /** Only show verified skills */
  verifiedOnly?: boolean;
  /** Only show featured skills */
  featuredOnly?: boolean;
}

/**
 * Search results from ClawdHub
 */
export interface ClawdHubSearchResult {
  /** Skills matching search */
  skills: ClawdHubSkill[];
  /** Total matching results */
  total: number;
  /** Current page */
  page: number;
  /** Results per page */
  perPage: number;
  /** Total pages */
  totalPages: number;
}

/**
 * Category information
 */
export interface ClawdHubCategory {
  /** Category slug */
  id: string;
  /** Display name */
  name: string;
  /** Description */
  description: string;
  /** Icon name */
  icon: string;
  /** Number of skills in category */
  skillCount: number;
}

/**
 * User review for a skill
 */
export interface ClawdHubReview {
  /** Review ID */
  id: string;
  /** Reviewer username */
  username: string;
  /** Rating (1-5) */
  rating: number;
  /** Review text */
  comment: string;
  /** Creation timestamp */
  createdAt: string;
  /** Helpful votes */
  helpfulCount: number;
}

/**
 * Client configuration
 */
export interface ClawdHubClientConfig {
  /** API base URL override */
  apiBase?: string;
  /** CDN base URL override */
  cdnBase?: string;
  /** Request timeout in ms */
  timeout?: number;
  /** User agent string */
  userAgent?: string;
  /** API key for authenticated requests */
  apiKey?: string;
}

/**
 * ClawdHub API client for skill discovery and installation
 */
export class ClawdHubClient extends EventEmitter {
  private _apiBase: string;
  private _cdnBase: string;
  private _timeout: number;
  private _userAgent: string;
  private _apiKey?: string;
  private _cache: Map<string, { data: unknown; expires: number }> = new Map();
  private _cacheTimeout = 5 * 60 * 1000; // 5 minutes

  constructor(config: ClawdHubClientConfig = {}) {
    super();
    this._apiBase = config.apiBase || CLAWDHUB_API_BASE;
    this._cdnBase = config.cdnBase || CLAWDHUB_CDN_BASE;
    this._timeout = config.timeout || 30000;
    this._userAgent = config.userAgent || 'AtlasDesktop/1.0';
    this._apiKey = config.apiKey;
  }

  /**
   * Make an API request to ClawdHub
   */
  private async _request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this._apiBase}${endpoint}`;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': this._userAgent,
      ...(options.headers as Record<string, string> || {}),
    };

    if (this._apiKey) {
      headers['Authorization'] = `Bearer ${this._apiKey}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this._timeout);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(
          error.message || `ClawdHub API error: ${response.status} ${response.statusText}`
        );
      }

      return response.json() as Promise<T>;
    } catch (error) {
      clearTimeout(timeoutId);
      if ((error as Error).name === 'AbortError') {
        throw new Error('ClawdHub request timed out');
      }
      throw error;
    }
  }

  /**
   * Get cached data or fetch fresh
   */
  private async _cachedRequest<T>(
    cacheKey: string,
    fetcher: () => Promise<T>
  ): Promise<T> {
    const cached = this._cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return cached.data as T;
    }

    const data = await fetcher();
    this._cache.set(cacheKey, {
      data,
      expires: Date.now() + this._cacheTimeout,
    });
    return data;
  }

  /**
   * Search skills on ClawdHub
   */
  async search(params: ClawdHubSearchParams = {}): Promise<ClawdHubSearchResult> {
    const queryParams = new URLSearchParams();
    
    if (params.query) queryParams.set('q', params.query);
    if (params.category) queryParams.set('category', params.category);
    if (params.tags?.length) queryParams.set('tags', params.tags.join(','));
    if (params.author) queryParams.set('author', params.author);
    if (params.sortBy) queryParams.set('sort', params.sortBy);
    if (params.sortOrder) queryParams.set('order', params.sortOrder);
    if (params.page) queryParams.set('page', params.page.toString());
    if (params.perPage) queryParams.set('per_page', params.perPage.toString());
    if (params.verifiedOnly) queryParams.set('verified', 'true');
    if (params.featuredOnly) queryParams.set('featured', 'true');

    const endpoint = `/skills?${queryParams.toString()}`;
    
    logger.debug('Searching ClawdHub', { params });
    
    return this._request<ClawdHubSearchResult>(endpoint);
  }

  /**
   * Get a specific skill by ID
   */
  async getSkill(skillId: string): Promise<ClawdHubSkill> {
    logger.debug('Fetching skill', { skillId });
    
    return this._cachedRequest(
      `skill:${skillId}`,
      () => this._request<ClawdHubSkill>(`/skills/${skillId}`)
    );
  }

  /**
   * Get skill README content
   */
  async getSkillReadme(skillId: string): Promise<string> {
    const skill = await this.getSkill(skillId);
    
    if (skill.readme) {
      return skill.readme;
    }

    // Fetch from CDN if not included
    const response = await fetch(`${this._cdnBase}/skills/${skillId}/README.md`);
    if (!response.ok) {
      throw new Error('README not found');
    }
    return response.text();
  }

  /**
   * Get all categories
   */
  async getCategories(): Promise<ClawdHubCategory[]> {
    return this._cachedRequest(
      'categories',
      () => this._request<ClawdHubCategory[]>('/categories')
    );
  }

  /**
   * Get trending skills
   */
  async getTrending(limit: number = 10): Promise<ClawdHubSkill[]> {
    const result = await this.search({
      sortBy: 'installs',
      sortOrder: 'desc',
      perPage: limit,
    });
    return result.skills;
  }

  /**
   * Get featured skills
   */
  async getFeatured(limit: number = 10): Promise<ClawdHubSkill[]> {
    const result = await this.search({
      featuredOnly: true,
      perPage: limit,
    });
    return result.skills;
  }

  /**
   * Get recently updated skills
   */
  async getRecent(limit: number = 10): Promise<ClawdHubSkill[]> {
    const result = await this.search({
      sortBy: 'updated',
      sortOrder: 'desc',
      perPage: limit,
    });
    return result.skills;
  }

  /**
   * Get skills by category
   */
  async getByCategory(
    category: string,
    page: number = 1,
    perPage: number = 20
  ): Promise<ClawdHubSearchResult> {
    return this.search({ category, page, perPage });
  }

  /**
   * Get skills by author
   */
  async getByAuthor(
    author: string,
    page: number = 1,
    perPage: number = 20
  ): Promise<ClawdHubSearchResult> {
    return this.search({ author, page, perPage });
  }

  /**
   * Get reviews for a skill
   */
  async getReviews(
    skillId: string,
    page: number = 1,
    perPage: number = 20
  ): Promise<{ reviews: ClawdHubReview[]; total: number }> {
    return this._request(`/skills/${skillId}/reviews?page=${page}&per_page=${perPage}`);
  }

  /**
   * Report install of a skill (analytics)
   */
  async reportInstall(skillId: string): Promise<void> {
    try {
      await this._request(`/skills/${skillId}/install`, {
        method: 'POST',
      });
    } catch (error) {
      // Don't fail on analytics errors
      logger.warn('Failed to report install', { skillId, error });
    }
  }

  /**
   * Submit a rating for a skill (requires API key)
   */
  async submitRating(skillId: string, rating: number, comment?: string): Promise<void> {
    if (!this._apiKey) {
      throw new Error('API key required to submit ratings');
    }

    if (rating < 1 || rating > 5) {
      throw new Error('Rating must be between 1 and 5');
    }

    await this._request(`/skills/${skillId}/reviews`, {
      method: 'POST',
      body: JSON.stringify({ rating, comment }),
    });

    // Invalidate cache
    this._cache.delete(`skill:${skillId}`);
  }

  /**
   * Check if a skill version is compatible with current Atlas version
   */
  async checkCompatibility(skillId: string, atlasVersion: string): Promise<{
    compatible: boolean;
    minVersion?: string;
    message?: string;
  }> {
    const skill = await this.getSkill(skillId);
    
    if (!skill.minAtlasVersion) {
      return { compatible: true };
    }

    const isCompatible = this._compareVersions(atlasVersion, skill.minAtlasVersion) >= 0;
    
    return {
      compatible: isCompatible,
      minVersion: skill.minAtlasVersion,
      message: isCompatible
        ? undefined
        : `This skill requires Atlas ${skill.minAtlasVersion} or higher`,
    };
  }

  /**
   * Compare semantic versions
   */
  private _compareVersions(a: string, b: string): number {
    const partsA = a.split('.').map(Number);
    const partsB = b.split('.').map(Number);

    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const partA = partsA[i] || 0;
      const partB = partsB[i] || 0;
      if (partA > partB) return 1;
      if (partA < partB) return -1;
    }
    return 0;
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this._cache.clear();
  }

  /**
   * Get installation URL for a skill
   */
  getInstallUrl(skill: ClawdHubSkill): string {
    return skill.repository;
  }
}

// Singleton instance
let clawdHubClient: ClawdHubClient | null = null;

/**
 * Get the ClawdHub client singleton
 */
export function getClawdHubClient(config?: ClawdHubClientConfig): ClawdHubClient {
  if (!clawdHubClient) {
    clawdHubClient = new ClawdHubClient(config);
  }
  return clawdHubClient;
}

/**
 * Shutdown the ClawdHub client
 */
export function shutdownClawdHubClient(): void {
  if (clawdHubClient) {
    clawdHubClient.clearCache();
    clawdHubClient = null;
  }
}
