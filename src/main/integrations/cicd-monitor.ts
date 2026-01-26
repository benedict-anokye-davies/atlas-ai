/**
 * Atlas Desktop - CI/CD Monitoring Integration
 * 
 * Monitors your CI/CD pipelines and takes action:
 * - Watches GitHub Actions, CircleCI, Jenkins
 * - Alerts when builds fail
 * - Auto-investigates failures
 * - Suggests fixes based on error logs
 * - Can auto-fix common issues
 * 
 * @module integrations/cicd-monitor
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { getErrorMessage } from '../../shared/utils';
import { getStore } from '../store';
import { getTTSManager } from '../tts/manager';

const logger = createModuleLogger('CICDMonitor');

// ============================================================================
// Types
// ============================================================================

export type CICDProvider = 'github-actions' | 'circleci' | 'jenkins' | 'gitlab-ci' | 'azure-devops';
export type BuildStatus = 'pending' | 'running' | 'success' | 'failure' | 'cancelled';

export interface CICDConfig {
  provider: CICDProvider;
  apiToken: string;
  repoOwner?: string;
  repoName?: string;
  pollInterval: number; // ms
  voiceAlerts: boolean;
  autoInvestigate: boolean;
  autoFix: boolean;
}

export interface Pipeline {
  id: string;
  name: string;
  provider: CICDProvider;
  repoUrl?: string;
  branch?: string;
  lastRun?: PipelineRun;
  status: BuildStatus;
}

export interface PipelineRun {
  id: string;
  pipelineId: string;
  number: number;
  status: BuildStatus;
  conclusion?: string;
  startedAt: Date;
  completedAt?: Date;
  duration?: number; // seconds
  jobs: Job[];
  commit?: {
    sha: string;
    message: string;
    author: string;
  };
  url: string;
}

export interface Job {
  id: string;
  name: string;
  status: BuildStatus;
  steps: Step[];
  logs?: string;
}

export interface Step {
  name: string;
  status: BuildStatus;
  duration?: number;
  output?: string;
}

export interface BuildFailure {
  runId: string;
  pipelineName: string;
  failedJob: string;
  failedStep?: string;
  errorMessage: string;
  errorType: 'test' | 'build' | 'lint' | 'deploy' | 'unknown';
  logs: string;
  suggestedFix?: string;
  canAutoFix: boolean;
}

// ============================================================================
// GitHub Actions Client
// ============================================================================

class GitHubActionsClient {
  private token: string;
  private owner: string;
  private repo: string;
  
  constructor(token: string, owner: string, repo: string) {
    this.token = token;
    this.owner = owner;
    this.repo = repo;
  }
  
  private async request<T>(endpoint: string): Promise<T> {
    const url = `https://api.github.com${endpoint}`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }
    
    return response.json();
  }
  
  async getWorkflows(): Promise<any> {
    return this.request(`/repos/${this.owner}/${this.repo}/actions/workflows`);
  }
  
  async getWorkflowRuns(workflowId?: string | number): Promise<any> {
    const endpoint = workflowId
      ? `/repos/${this.owner}/${this.repo}/actions/workflows/${workflowId}/runs`
      : `/repos/${this.owner}/${this.repo}/actions/runs`;
    return this.request(endpoint);
  }
  
  async getRunJobs(runId: number): Promise<any> {
    return this.request(`/repos/${this.owner}/${this.repo}/actions/runs/${runId}/jobs`);
  }
  
  async getJobLogs(jobId: number): Promise<string> {
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/actions/jobs/${jobId}/logs`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'application/vnd.github+json',
      },
    });
    
    if (!response.ok) {
      throw new Error(`Failed to get logs: ${response.status}`);
    }
    
    return response.text();
  }
  
  async rerunWorkflow(runId: number): Promise<void> {
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/actions/runs/${runId}/rerun`;
    
    await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'application/vnd.github+json',
      },
    });
  }
}

// ============================================================================
// CircleCI Client
// ============================================================================

interface CircleCIPipeline {
  id: string;
  number: number;
  state: string;
  created_at: string;
  updated_at: string;
  trigger: {
    type: string;
    received_at: string;
  };
  vcs: {
    branch: string;
    revision: string;
    origin_repository_url: string;
  };
  branch?: string;
}

interface CircleCIWorkflow {
  id: string;
  name: string;
  status: string;
  created_at: string;
  stopped_at?: string;
  pipeline_id: string;
  pipeline_number: number;
}

interface CircleCIJob {
  id: string;
  name: string;
  status: string;
  started_at?: string;
  stopped_at?: string;
  job_number: number;
}

class CircleCIClient {
  private token: string;
  private projectSlug: string;

  constructor(token: string, owner: string, repo: string) {
    this.token = token;
    this.projectSlug = `gh/${owner}/${repo}`;
  }

  private async request<T>(endpoint: string): Promise<T> {
    const url = `https://circleci.com/api/v2${endpoint}`;

    const response = await fetch(url, {
      headers: {
        'Circle-Token': this.token,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`CircleCI API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async getPipelines(limit = 10): Promise<CircleCIPipeline[]> {
    const data = await this.request<{ items: CircleCIPipeline[] }>(
      `/project/${this.projectSlug}/pipeline?branch=main`
    );
    return data.items.slice(0, limit).map(p => ({
      ...p,
      branch: p.vcs?.branch,
    }));
  }

  async getWorkflows(pipelineId: string): Promise<CircleCIWorkflow[]> {
    const data = await this.request<{ items: CircleCIWorkflow[] }>(
      `/pipeline/${pipelineId}/workflow`
    );
    return data.items;
  }

  async getWorkflowJobs(workflowId: string): Promise<CircleCIJob[]> {
    const data = await this.request<{ items: CircleCIJob[] }>(
      `/workflow/${workflowId}/job`
    );
    return data.items;
  }

  async getJobLogs(jobNumber: string): Promise<string> {
    // CircleCI v2 API returns job steps/actions
    try {
      const data = await this.request<{ items: Array<{ name: string; actions: Array<{ output_url?: string }> }> }>(
        `/project/${this.projectSlug}/${jobNumber}/steps`
      );
      
      // Collect output from all steps
      const outputs: string[] = [];
      for (const step of data.items || []) {
        for (const action of step.actions || []) {
          if (action.output_url) {
            try {
              const outputResponse = await fetch(action.output_url, {
                headers: { 'Circle-Token': this.token },
              });
              if (outputResponse.ok) {
                const output = await outputResponse.json();
                if (Array.isArray(output)) {
                  outputs.push(...output.map((o: { message?: string }) => o.message || ''));
                }
              }
            } catch {
              // Continue on output fetch errors
            }
          }
        }
      }
      return outputs.join('\n');
    } catch {
      return '';
    }
  }

  async cancelWorkflow(workflowId: string): Promise<void> {
    await this.request(`/workflow/${workflowId}/cancel`);
  }

  async rerunWorkflow(workflowId: string): Promise<void> {
    await fetch(`https://circleci.com/api/v2/workflow/${workflowId}/rerun`, {
      method: 'POST',
      headers: {
        'Circle-Token': this.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from_failed: true }),
    });
  }
}

// ============================================================================
// GitLab CI Client
// ============================================================================

interface GitLabPipeline {
  id: number;
  iid: number;
  status: string;
  ref: string;
  sha: string;
  web_url: string;
  created_at: string;
  updated_at: string;
  finished_at?: string;
}

interface GitLabJob {
  id: number;
  name: string;
  status: string;
  stage: string;
  started_at?: string;
  finished_at?: string;
  web_url: string;
}

class GitLabCIClient {
  private token: string;
  private projectPath: string;
  private baseUrl: string;

  constructor(token: string, owner: string, repo: string, gitlabUrl = 'https://gitlab.com') {
    this.token = token;
    this.projectPath = encodeURIComponent(`${owner}/${repo}`);
    this.baseUrl = gitlabUrl;
  }

  private async request<T>(endpoint: string): Promise<T> {
    const url = `${this.baseUrl}/api/v4${endpoint}`;

    const response = await fetch(url, {
      headers: {
        'PRIVATE-TOKEN': this.token,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async getPipelines(limit = 10): Promise<GitLabPipeline[]> {
    const data = await this.request<GitLabPipeline[]>(
      `/projects/${this.projectPath}/pipelines?per_page=${limit}`
    );
    return data;
  }

  async getPipeline(pipelineId: number): Promise<GitLabPipeline> {
    return this.request<GitLabPipeline>(
      `/projects/${this.projectPath}/pipelines/${pipelineId}`
    );
  }

  async getPipelineJobs(pipelineId: number): Promise<GitLabJob[]> {
    return this.request<GitLabJob[]>(
      `/projects/${this.projectPath}/pipelines/${pipelineId}/jobs`
    );
  }

  async getJobLogs(jobId: number): Promise<string> {
    const url = `${this.baseUrl}/api/v4/projects/${this.projectPath}/jobs/${jobId}/trace`;

    const response = await fetch(url, {
      headers: {
        'PRIVATE-TOKEN': this.token,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get GitLab job logs: ${response.status}`);
    }

    return response.text();
  }

  async retryJob(jobId: number): Promise<void> {
    await fetch(`${this.baseUrl}/api/v4/projects/${this.projectPath}/jobs/${jobId}/retry`, {
      method: 'POST',
      headers: {
        'PRIVATE-TOKEN': this.token,
      },
    });
  }

  async cancelPipeline(pipelineId: number): Promise<void> {
    await fetch(`${this.baseUrl}/api/v4/projects/${this.projectPath}/pipelines/${pipelineId}/cancel`, {
      method: 'POST',
      headers: {
        'PRIVATE-TOKEN': this.token,
      },
    });
  }

  async retryPipeline(pipelineId: number): Promise<void> {
    await fetch(`${this.baseUrl}/api/v4/projects/${this.projectPath}/pipelines/${pipelineId}/retry`, {
      method: 'POST',
      headers: {
        'PRIVATE-TOKEN': this.token,
      },
    });
  }
}

// ============================================================================
// CI/CD Monitor Class
// ============================================================================

export class CICDMonitor extends EventEmitter {
  private configs: Map<string, CICDConfig> = new Map();
  private pipelines: Map<string, Pipeline> = new Map();
  private pollTimers: Map<string, NodeJS.Timeout> = new Map();
  private isRunning: boolean = false;
  private failures: BuildFailure[] = [];
  
  constructor() {
    super();
  }
  
  // ==========================================================================
  // Configuration
  // ==========================================================================
  
  addProvider(id: string, config: CICDConfig): void {
    this.configs.set(id, config);
    logger.info('CI/CD provider added', { id, provider: config.provider });
    this.emit('providerAdded', { id, config });
  }
  
  removeProvider(id: string): void {
    this.stopWatching(id);
    this.configs.delete(id);
    logger.info('CI/CD provider removed', { id });
    this.emit('providerRemoved', { id });
  }
  
  // ==========================================================================
  // Monitoring
  // ==========================================================================
  
  startAll(): void {
    if (this.isRunning) return;
    
    for (const [id] of this.configs) {
      this.startWatching(id);
    }
    
    this.isRunning = true;
    this.emit('started');
    logger.info('CI/CD monitoring started');
  }
  
  stopAll(): void {
    for (const [id] of this.configs) {
      this.stopWatching(id);
    }
    
    this.isRunning = false;
    this.emit('stopped');
    logger.info('CI/CD monitoring stopped');
  }
  
  startWatching(providerId: string): void {
    const config = this.configs.get(providerId);
    if (!config) return;
    
    // Clear existing timer
    const existing = this.pollTimers.get(providerId);
    if (existing) clearInterval(existing);
    
    // Immediate check
    this.checkProvider(providerId);
    
    // Start polling
    const timer = setInterval(
      () => this.checkProvider(providerId),
      config.pollInterval
    );
    
    this.pollTimers.set(providerId, timer);
    logger.info('Started watching provider', { providerId });
  }
  
  stopWatching(providerId: string): void {
    const timer = this.pollTimers.get(providerId);
    if (timer) {
      clearInterval(timer);
      this.pollTimers.delete(providerId);
    }
    logger.info('Stopped watching provider', { providerId });
  }
  
  private async checkProvider(providerId: string): Promise<void> {
    const config = this.configs.get(providerId);
    if (!config) return;
    
    try {
      switch (config.provider) {
        case 'github-actions':
          await this.checkGitHubActions(providerId, config);
          break;
        case 'circleci':
          await this.checkCircleCI(providerId, config);
          break;
        case 'gitlab-ci':
          await this.checkGitLabCI(providerId, config);
          break;
        // Add more providers as needed
      }
    } catch (error) {
      logger.error('Provider check failed', { providerId, error });
    }
  }
  
  // ==========================================================================
  // GitHub Actions
  // ==========================================================================
  
  private async checkGitHubActions(providerId: string, config: CICDConfig): Promise<void> {
    if (!config.repoOwner || !config.repoName) {
      throw new Error('GitHub Actions requires repoOwner and repoName');
    }
    
    const client = new GitHubActionsClient(
      config.apiToken,
      config.repoOwner,
      config.repoName
    );
    
    // Get recent workflow runs
    const runs = await client.getWorkflowRuns();
    
    for (const run of runs.workflow_runs.slice(0, 5)) {
      const pipelineId = `${providerId}:${run.workflow_id}`;
      
      const previousRun = this.pipelines.get(pipelineId)?.lastRun;
      
      // Check for status change
      if (previousRun?.id !== run.id.toString() || previousRun?.status !== this.mapGitHubStatus(run.status)) {
        const jobs = await client.getRunJobs(run.id);
        
        const pipelineRun: PipelineRun = {
          id: run.id.toString(),
          pipelineId,
          number: run.run_number,
          status: this.mapGitHubStatus(run.status),
          conclusion: run.conclusion,
          startedAt: new Date(run.run_started_at),
          completedAt: run.completed_at ? new Date(run.completed_at) : undefined,
          jobs: jobs.jobs.map((job: any) => ({
            id: job.id.toString(),
            name: job.name,
            status: this.mapGitHubStatus(job.status),
            steps: (job.steps || []).map((step: any) => ({
              name: step.name,
              status: this.mapGitHubStatus(step.status),
              duration: step.completed_at
                ? Math.round((new Date(step.completed_at).getTime() - new Date(step.started_at).getTime()) / 1000)
                : undefined,
            })),
          })),
          commit: {
            sha: run.head_sha,
            message: run.head_commit?.message || '',
            author: run.head_commit?.author?.name || '',
          },
          url: run.html_url,
        };
        
        // Update pipeline
        const pipeline: Pipeline = {
          id: pipelineId,
          name: run.name,
          provider: 'github-actions',
          repoUrl: `https://github.com/${config.repoOwner}/${config.repoName}`,
          branch: run.head_branch,
          lastRun: pipelineRun,
          status: pipelineRun.status,
        };
        
        this.pipelines.set(pipelineId, pipeline);
        this.emit('pipelineUpdated', pipeline);
        
        // Check for failure
        if (pipelineRun.status === 'failure' && previousRun?.status !== 'failure') {
          await this.handleFailure(pipeline, pipelineRun, config, client);
        }
        
        // Notify on completion
        if (pipelineRun.status === 'success' && previousRun?.status === 'running') {
          this.emit('buildSuccess', pipeline);
          if (config.voiceAlerts) {
            await this.speak(`Build passed: ${pipeline.name}`);
          }
        }
      }
    }
  }
  
  private mapGitHubStatus(status: string): BuildStatus {
    const statusMap: Record<string, BuildStatus> = {
      'queued': 'pending',
      'in_progress': 'running',
      'completed': 'success', // Will be overridden by conclusion
      'failure': 'failure',
      'cancelled': 'cancelled',
      'success': 'success',
    };
    return statusMap[status] || 'pending';
  }
  
  // ==========================================================================
  // CircleCI Integration
  // ==========================================================================
  
  private async checkCircleCI(providerId: string, config: CICDConfig): Promise<void> {
    if (!config.apiToken) {
      logger.warn('CircleCI API token not configured');
      return;
    }

    const client = new CircleCIClient(config.apiToken, config.repoOwner || '', config.repoName || '');

    try {
      // Fetch recent pipelines
      const pipelinesData = await client.getPipelines();
      
      for (const pipelineData of pipelinesData) {
        const pipelineId = `circleci-${pipelineData.id}`;
        
        // Get or create pipeline entry
        let pipeline = this.pipelines.get(pipelineId);
        if (!pipeline) {
          pipeline = {
            id: pipelineId,
            name: `${config.repoOwner}/${config.repoName}`,
            provider: 'circleci',
            repoUrl: `https://app.circleci.com/pipelines/${config.repoOwner}/${config.repoName}`,
            branch: pipelineData.branch,
            status: 'pending',
          };
          this.pipelines.set(pipelineId, pipeline);
        }

        // Get workflow details
        const workflows = await client.getWorkflows(pipelineData.id);
        
        for (const workflow of workflows) {
          const previousStatus = pipeline.status;
          pipeline.status = this.mapCircleCIStatus(workflow.status);

          // Get jobs for the workflow
          const jobs = await client.getWorkflowJobs(workflow.id);
          
          const pipelineRun: PipelineRun = {
            id: workflow.id,
            pipelineId,
            number: pipelineData.number,
            status: pipeline.status,
            startedAt: new Date(workflow.created_at),
            completedAt: workflow.stopped_at ? new Date(workflow.stopped_at) : undefined,
            jobs: jobs.map((j) => ({
              id: j.id,
              name: j.name,
              status: this.mapCircleCIStatus(j.status),
              steps: [],
            })),
            url: `https://app.circleci.com/pipelines/${config.repoOwner}/${config.repoName}/${pipelineData.number}/workflows/${workflow.id}`,
          };

          pipeline.lastRun = pipelineRun;

          // Handle status changes
          if (pipelineRun.status === 'failure' && previousStatus !== 'failure') {
            await this.handleCircleCIFailure(pipeline, pipelineRun, config, client);
          }

          if (pipelineRun.status === 'success' && previousStatus === 'running') {
            this.emit('buildSuccess', pipeline);
            if (config.voiceAlerts) {
              await this.speak(`CircleCI build passed: ${pipeline.name}`);
            }
          }
        }
      }
    } catch (error) {
      logger.error('CircleCI check failed', { error: getErrorMessage(error) });
    }
  }

  private mapCircleCIStatus(status: string): BuildStatus {
    const statusMap: Record<string, BuildStatus> = {
      'not_run': 'pending',
      'running': 'running',
      'success': 'success',
      'failed': 'failure',
      'error': 'failure',
      'failing': 'failure',
      'on_hold': 'pending',
      'canceled': 'cancelled',
      'unauthorized': 'failure',
    };
    return statusMap[status] || 'pending';
  }

  private async handleCircleCIFailure(
    pipeline: Pipeline,
    run: PipelineRun,
    config: CICDConfig,
    client: CircleCIClient
  ): Promise<void> {
    logger.info('CircleCI build failure detected', { pipeline: pipeline.name, run: run.id });

    const failedJob = run.jobs.find((j) => j.status === 'failure');
    if (!failedJob) return;

    let logs = '';
    try {
      logs = await client.getJobLogs(failedJob.id);
    } catch (error) {
      logger.warn('Failed to fetch CircleCI logs', { error });
    }

    const failure: BuildFailure = {
      runId: run.id,
      pipelineName: pipeline.name,
      failedJob: failedJob.name,
      errorMessage: this.extractErrorMessage(logs, this.detectErrorType(logs, failedJob.name)),
      errorType: this.detectErrorType(logs, failedJob.name),
      logs,
      canAutoFix: false,
    };

    this.failures.push(failure);
    this.emit('buildFailure', { pipeline, failure });

    if (config.voiceAlerts) {
      await this.speak(`CircleCI build failed: ${pipeline.name}. ${failure.errorType} error in ${failedJob.name}`);
    }
  }
  
  // ==========================================================================
  // GitLab CI Integration
  // ==========================================================================
  
  private async checkGitLabCI(providerId: string, config: CICDConfig): Promise<void> {
    if (!config.apiToken) {
      logger.warn('GitLab CI API token not configured');
      return;
    }

    const client = new GitLabCIClient(config.apiToken, config.repoOwner || '', config.repoName || '');

    try {
      // Fetch recent pipelines
      const pipelinesData = await client.getPipelines();

      for (const pipelineData of pipelinesData) {
        const pipelineId = `gitlab-${pipelineData.id}`;

        // Get or create pipeline entry
        let pipeline = this.pipelines.get(pipelineId);
        if (!pipeline) {
          pipeline = {
            id: pipelineId,
            name: `${config.repoOwner}/${config.repoName}`,
            provider: 'gitlab-ci',
            repoUrl: pipelineData.web_url,
            branch: pipelineData.ref,
            status: 'pending',
          };
          this.pipelines.set(pipelineId, pipeline);
        }

        const previousStatus = pipeline.status;
        pipeline.status = this.mapGitLabStatus(pipelineData.status);

        // Get jobs for the pipeline
        const jobs = await client.getPipelineJobs(pipelineData.id);

        const pipelineRun: PipelineRun = {
          id: String(pipelineData.id),
          pipelineId,
          number: pipelineData.id,
          status: pipeline.status,
          startedAt: new Date(pipelineData.created_at),
          completedAt: pipelineData.finished_at ? new Date(pipelineData.finished_at) : undefined,
          commit: pipelineData.sha
            ? {
                sha: pipelineData.sha,
                message: '',
                author: '',
              }
            : undefined,
          jobs: jobs.map((j) => ({
            id: String(j.id),
            name: j.name,
            status: this.mapGitLabStatus(j.status),
            steps: [],
          })),
          url: pipelineData.web_url,
        };

        pipeline.lastRun = pipelineRun;

        // Handle status changes
        if (pipelineRun.status === 'failure' && previousStatus !== 'failure') {
          await this.handleGitLabFailure(pipeline, pipelineRun, config, client);
        }

        if (pipelineRun.status === 'success' && previousStatus === 'running') {
          this.emit('buildSuccess', pipeline);
          if (config.voiceAlerts) {
            await this.speak(`GitLab CI build passed: ${pipeline.name}`);
          }
        }
      }
    } catch (error) {
      logger.error('GitLab CI check failed', { error: getErrorMessage(error) });
    }
  }

  private mapGitLabStatus(status: string): BuildStatus {
    const statusMap: Record<string, BuildStatus> = {
      'created': 'pending',
      'waiting_for_resource': 'pending',
      'preparing': 'pending',
      'pending': 'pending',
      'running': 'running',
      'success': 'success',
      'failed': 'failure',
      'canceled': 'cancelled',
      'skipped': 'cancelled',
      'manual': 'pending',
      'scheduled': 'pending',
    };
    return statusMap[status] || 'pending';
  }

  private async handleGitLabFailure(
    pipeline: Pipeline,
    run: PipelineRun,
    config: CICDConfig,
    client: GitLabCIClient
  ): Promise<void> {
    logger.info('GitLab CI build failure detected', { pipeline: pipeline.name, run: run.id });

    const failedJob = run.jobs.find((j) => j.status === 'failure');
    if (!failedJob) return;

    let logs = '';
    try {
      logs = await client.getJobLogs(parseInt(failedJob.id));
    } catch (error) {
      logger.warn('Failed to fetch GitLab logs', { error });
    }

    const failure: BuildFailure = {
      runId: run.id,
      pipelineName: pipeline.name,
      failedJob: failedJob.name,
      errorMessage: this.extractErrorMessage(logs, this.detectErrorType(logs, failedJob.name)),
      errorType: this.detectErrorType(logs, failedJob.name),
      logs,
      canAutoFix: false,
    };

    this.failures.push(failure);
    this.emit('buildFailure', { pipeline, failure });

    if (config.voiceAlerts) {
      await this.speak(`GitLab CI build failed: ${pipeline.name}. ${failure.errorType} error in ${failedJob.name}`);
    }
  }
  
  // ==========================================================================
  // Failure Handling
  // ==========================================================================
  
  private async handleFailure(
    pipeline: Pipeline,
    run: PipelineRun,
    config: CICDConfig,
    client: GitHubActionsClient
  ): Promise<void> {
    logger.info('Build failure detected', { pipeline: pipeline.name, run: run.id });
    
    // Find failed job
    const failedJob = run.jobs.find(j => j.status === 'failure');
    if (!failedJob) return;
    
    // Get logs
    let logs = '';
    try {
      logs = await client.getJobLogs(parseInt(failedJob.id));
    } catch (error) {
      logger.warn('Failed to fetch logs', { error });
    }
    
    // Analyze failure
    const failure = this.analyzeFailure(run, failedJob, logs);
    this.failures.push(failure);
    
    // Emit event
    this.emit('buildFailure', { pipeline, failure });
    
    // Voice alert
    if (config.voiceAlerts) {
      await this.speak(`Build failed: ${pipeline.name}. ${failure.errorType} error in ${failedJob.name}`);
    }
    
    // Auto-investigate
    if (config.autoInvestigate) {
      await this.investigateFailure(failure);
    }
    
    // Auto-fix if possible
    if (config.autoFix && failure.canAutoFix && failure.suggestedFix) {
      this.emit('attemptingAutoFix', { failure });
      // The autonomous agent would handle this
    }
  }
  
  private analyzeFailure(run: PipelineRun, job: Job, logs: string): BuildFailure {
    const errorType = this.detectErrorType(logs, job.name);
    const errorMessage = this.extractErrorMessage(logs, errorType);
    const suggestedFix = this.suggestFix(errorType, errorMessage, logs);
    
    return {
      runId: run.id,
      pipelineName: run.pipelineId,
      failedJob: job.name,
      failedStep: job.steps.find(s => s.status === 'failure')?.name,
      errorMessage,
      errorType,
      logs: logs.slice(-5000), // Last 5000 chars
      suggestedFix,
      canAutoFix: this.canAutoFix(errorType, errorMessage),
    };
  }
  
  private detectErrorType(logs: string, jobName: string): BuildFailure['errorType'] {
    const lower = logs.toLowerCase();
    const name = jobName.toLowerCase();
    
    if (name.includes('test') || lower.includes('test failed') || lower.includes('assertion')) {
      return 'test';
    }
    if (name.includes('build') || lower.includes('build failed') || lower.includes('compilation')) {
      return 'build';
    }
    if (name.includes('lint') || lower.includes('eslint') || lower.includes('linting')) {
      return 'lint';
    }
    if (name.includes('deploy') || lower.includes('deployment')) {
      return 'deploy';
    }
    
    return 'unknown';
  }
  
  private extractErrorMessage(logs: string, errorType: string): string {
    const lines = logs.split('\n');
    
    // Look for common error patterns
    const errorPatterns = [
      /Error:\s*(.+)/i,
      /error\[E\d+\]:\s*(.+)/i,
      /FAILED:\s*(.+)/i,
      /AssertionError:\s*(.+)/i,
      /TypeError:\s*(.+)/i,
      /npm ERR!\s*(.+)/i,
    ];
    
    for (const line of lines) {
      for (const pattern of errorPatterns) {
        const match = line.match(pattern);
        if (match) {
          return match[1].trim();
        }
      }
    }
    
    // Return last meaningful line
    const meaningfulLines = lines.filter(l => l.trim() && !l.startsWith('#'));
    return meaningfulLines.slice(-3).join(' ').slice(0, 200);
  }
  
  private suggestFix(errorType: string, errorMessage: string, logs: string): string | undefined {
    const lower = errorMessage.toLowerCase();
    
    // Common fixes
    if (lower.includes('module not found') || lower.includes('cannot find module')) {
      const match = errorMessage.match(/['"]([^'"]+)['"]/);
      if (match) {
        return `Run: npm install ${match[1]}`;
      }
    }
    
    if (lower.includes('typescript') || lower.includes('ts')) {
      return 'Check TypeScript errors with: npx tsc --noEmit';
    }
    
    if (errorType === 'lint') {
      return 'Run: npm run lint:fix';
    }
    
    if (errorType === 'test' && lower.includes('snapshot')) {
      return 'Run: npm test -- -u to update snapshots';
    }
    
    return undefined;
  }
  
  private canAutoFix(errorType: string, errorMessage: string): boolean {
    const lower = errorMessage.toLowerCase();
    
    // Things we can auto-fix
    if (errorType === 'lint') return true;
    if (lower.includes('module not found')) return true;
    if (lower.includes('snapshot')) return true;
    
    return false;
  }
  
  private async investigateFailure(failure: BuildFailure): Promise<void> {
    logger.info('Investigating failure', {
      job: failure.failedJob,
      type: failure.errorType,
    });
    
    // Emit investigation results
    this.emit('investigationComplete', {
      failure,
      analysis: {
        errorType: failure.errorType,
        rootCause: failure.errorMessage,
        suggestedFix: failure.suggestedFix,
        relatedFiles: this.extractFilesFromLogs(failure.logs),
      },
    });
  }
  
  private extractFilesFromLogs(logs: string): string[] {
    const filePattern = /[\w\-\.\/]+\.[jt]sx?:\d+/g;
    const matches = logs.match(filePattern) || [];
    return [...new Set(matches.map(m => m.split(':')[0]))].slice(0, 10);
  }
  
  // ==========================================================================
  // Voice
  // ==========================================================================
  
  private async speak(text: string): Promise<void> {
    try {
      const tts = getTTSManager();
      if (tts) {
        await tts.speak(text);
      }
    } catch (error) {
      logger.debug('TTS failed', { error });
    }
  }
  
  // ==========================================================================
  // Public API
  // ==========================================================================
  
  getPipelines(): Pipeline[] {
    return Array.from(this.pipelines.values());
  }
  
  getPipeline(id: string): Pipeline | undefined {
    return this.pipelines.get(id);
  }
  
  getFailures(): BuildFailure[] {
    return this.failures;
  }
  
  clearFailures(): void {
    this.failures = [];
  }
  
  async triggerRebuild(pipelineId: string): Promise<void> {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline?.lastRun) return;
    
    const [providerId] = pipelineId.split(':');
    const config = this.configs.get(providerId);
    
    if (!config) return;
    
    if (config.provider === 'github-actions' && config.repoOwner && config.repoName) {
      const client = new GitHubActionsClient(
        config.apiToken,
        config.repoOwner,
        config.repoName
      );
      
      await client.rerunWorkflow(parseInt(pipeline.lastRun.id));
      this.emit('rebuildTriggered', { pipelineId });
      logger.info('Rebuild triggered', { pipelineId });
    }
  }
  
  getStatus(): {
    isRunning: boolean;
    providers: number;
    pipelines: number;
    recentFailures: number;
  } {
    return {
      isRunning: this.isRunning,
      providers: this.configs.size,
      pipelines: this.pipelines.size,
      recentFailures: this.failures.filter(
        f => Date.now() - new Date().getTime() < 24 * 60 * 60 * 1000
      ).length,
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: CICDMonitor | null = null;

export function getCICDMonitor(): CICDMonitor {
  if (!instance) {
    instance = new CICDMonitor();
  }
  return instance;
}

export default {
  CICDMonitor,
  getCICDMonitor,
};
