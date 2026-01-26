/**
 * Atlas Desktop - Jira/Linear Integration
 * 
 * Connects to project management tools:
 * - Creates issues from voice commands
 * - Updates ticket status automatically
 * - Links commits to tickets
 * - Shows relevant tickets while coding
 * - Suggests tickets based on code context
 * 
 * @module integrations/project-management
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { getStore } from '../store';

const logger = createModuleLogger('ProjectManagement');

// ============================================================================
// Types
// ============================================================================

export type PMProvider = 'jira' | 'linear' | 'github-issues' | 'asana';
export type IssueStatus = 'todo' | 'in-progress' | 'in-review' | 'done' | 'cancelled';
export type IssuePriority = 'urgent' | 'high' | 'medium' | 'low' | 'none';
export type IssueType = 'bug' | 'feature' | 'task' | 'story' | 'epic';

export interface PMConfig {
  provider: PMProvider;
  apiToken: string;
  baseUrl?: string; // For Jira
  teamId?: string; // For Linear
  projectKey?: string;
  defaultAssignee?: string;
}

export interface Issue {
  id: string;
  key: string; // e.g., PROJ-123
  title: string;
  description?: string;
  type: IssueType;
  status: IssueStatus;
  priority: IssuePriority;
  assignee?: User;
  reporter?: User;
  labels: string[];
  created: Date;
  updated: Date;
  dueDate?: Date;
  estimate?: number; // story points or hours
  url: string;
  comments: Comment[];
  linkedCommits: string[];
  subtasks: Issue[];
}

export interface User {
  id: string;
  name: string;
  email?: string;
  avatar?: string;
}

export interface Comment {
  id: string;
  author: User;
  body: string;
  created: Date;
}

export interface CreateIssueParams {
  title: string;
  description?: string;
  type?: IssueType;
  priority?: IssuePriority;
  labels?: string[];
  assignee?: string;
  estimate?: number;
}

export interface SearchParams {
  query?: string;
  status?: IssueStatus[];
  assignee?: string;
  labels?: string[];
  type?: IssueType;
  limit?: number;
}

// ============================================================================
// Linear Client
// ============================================================================

class LinearClient {
  private apiKey: string;
  private teamId?: string;
  
  constructor(apiKey: string, teamId?: string) {
    this.apiKey = apiKey;
    this.teamId = teamId;
  }
  
  private async graphql<T>(query: string, variables?: Record<string, any>): Promise<T> {
    const response = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': this.apiKey,
      },
      body: JSON.stringify({ query, variables }),
    });
    
    if (!response.ok) {
      throw new Error(`Linear API error: ${response.status}`);
    }
    
    const data = await response.json();
    if (data.errors) {
      throw new Error(data.errors[0]?.message || 'GraphQL error');
    }
    
    return data.data;
  }
  
  async getIssues(params: SearchParams = {}): Promise<Issue[]> {
    const query = `
      query Issues($filter: IssueFilter, $first: Int) {
        issues(filter: $filter, first: $first) {
          nodes {
            id
            identifier
            title
            description
            state { name }
            priority
            assignee { id name email }
            creator { id name email }
            labels { nodes { name } }
            createdAt
            updatedAt
            dueDate
            estimate
            url
            comments { nodes { id body createdAt user { id name } } }
            children { nodes { id identifier title } }
          }
        }
      }
    `;
    
    const filter: any = {};
    if (this.teamId) filter.team = { id: { eq: this.teamId } };
    if (params.query) filter.title = { containsIgnoreCase: params.query };
    if (params.assignee) filter.assignee = { id: { eq: params.assignee } };
    
    const result = await this.graphql<any>(query, {
      filter,
      first: params.limit || 50,
    });
    
    return result.issues.nodes.map((issue: any) => this.mapLinearIssue(issue));
  }
  
  async getIssue(id: string): Promise<Issue | null> {
    const query = `
      query Issue($id: String!) {
        issue(id: $id) {
          id
          identifier
          title
          description
          state { name }
          priority
          assignee { id name email }
          creator { id name email }
          labels { nodes { name } }
          createdAt
          updatedAt
          dueDate
          estimate
          url
          comments { nodes { id body createdAt user { id name } } }
          children { nodes { id identifier title } }
        }
      }
    `;
    
    const result = await this.graphql<any>(query, { id });
    return result.issue ? this.mapLinearIssue(result.issue) : null;
  }
  
  async createIssue(params: CreateIssueParams): Promise<Issue> {
    const mutation = `
      mutation CreateIssue($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
            id
            identifier
            title
            url
          }
        }
      }
    `;
    
    const input: any = {
      title: params.title,
      description: params.description,
      teamId: this.teamId,
    };
    
    if (params.priority) {
      const priorityMap: Record<IssuePriority, number> = {
        'urgent': 1,
        'high': 2,
        'medium': 3,
        'low': 4,
        'none': 0,
      };
      input.priority = priorityMap[params.priority];
    }
    
    if (params.estimate) input.estimate = params.estimate;
    if (params.assignee) input.assigneeId = params.assignee;
    if (params.labels?.length) input.labelIds = params.labels;
    
    const result = await this.graphql<any>(mutation, { input });
    
    if (!result.issueCreate.success) {
      throw new Error('Failed to create issue');
    }
    
    return this.mapLinearIssue(result.issueCreate.issue);
  }
  
  async updateIssueStatus(issueId: string, status: IssueStatus): Promise<void> {
    // First, get state ID for the status
    const statesQuery = `
      query States($teamId: String!) {
        team(id: $teamId) {
          states { nodes { id name } }
        }
      }
    `;
    
    const statesResult = await this.graphql<any>(statesQuery, { teamId: this.teamId });
    const statusMap: Record<IssueStatus, string> = {
      'todo': 'Todo',
      'in-progress': 'In Progress',
      'in-review': 'In Review',
      'done': 'Done',
      'cancelled': 'Cancelled',
    };
    
    const state = statesResult.team.states.nodes.find(
      (s: any) => s.name.toLowerCase() === statusMap[status].toLowerCase()
    );
    
    if (!state) {
      throw new Error(`Status "${status}" not found`);
    }
    
    const mutation = `
      mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
        }
      }
    `;
    
    await this.graphql(mutation, {
      id: issueId,
      input: { stateId: state.id },
    });
  }
  
  async addComment(issueId: string, body: string): Promise<void> {
    const mutation = `
      mutation CreateComment($input: CommentCreateInput!) {
        commentCreate(input: $input) {
          success
        }
      }
    `;
    
    await this.graphql(mutation, {
      input: { issueId, body },
    });
  }
  
  private mapLinearIssue(issue: any): Issue {
    const statusMap: Record<string, IssueStatus> = {
      'backlog': 'todo',
      'todo': 'todo',
      'in progress': 'in-progress',
      'in review': 'in-review',
      'done': 'done',
      'cancelled': 'cancelled',
      'canceled': 'cancelled',
    };
    
    const priorityMap: Record<number, IssuePriority> = {
      0: 'none',
      1: 'urgent',
      2: 'high',
      3: 'medium',
      4: 'low',
    };
    
    return {
      id: issue.id,
      key: issue.identifier,
      title: issue.title,
      description: issue.description,
      type: 'task', // Linear doesn't have issue types like Jira
      status: statusMap[issue.state?.name?.toLowerCase()] || 'todo',
      priority: priorityMap[issue.priority] || 'none',
      assignee: issue.assignee ? {
        id: issue.assignee.id,
        name: issue.assignee.name,
        email: issue.assignee.email,
      } : undefined,
      reporter: issue.creator ? {
        id: issue.creator.id,
        name: issue.creator.name,
        email: issue.creator.email,
      } : undefined,
      labels: issue.labels?.nodes?.map((l: any) => l.name) || [],
      created: new Date(issue.createdAt),
      updated: new Date(issue.updatedAt),
      dueDate: issue.dueDate ? new Date(issue.dueDate) : undefined,
      estimate: issue.estimate,
      url: issue.url,
      comments: issue.comments?.nodes?.map((c: any) => ({
        id: c.id,
        author: { id: c.user.id, name: c.user.name },
        body: c.body,
        created: new Date(c.createdAt),
      })) || [],
      linkedCommits: [],
      subtasks: issue.children?.nodes?.map((child: any) => ({
        id: child.id,
        key: child.identifier,
        title: child.title,
        type: 'task' as IssueType,
        status: 'todo' as IssueStatus,
        priority: 'none' as IssuePriority,
        labels: [],
        created: new Date(),
        updated: new Date(),
        url: '',
        comments: [],
        linkedCommits: [],
        subtasks: [],
      })) || [],
    };
  }
}

// ============================================================================
// Jira Client
// ============================================================================

class JiraClient {
  private baseUrl: string;
  private email: string;
  private apiToken: string;
  private projectKey: string;
  
  constructor(baseUrl: string, email: string, apiToken: string, projectKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.email = email;
    this.apiToken = apiToken;
    this.projectKey = projectKey;
  }
  
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}/rest/api/3${endpoint}`;
    const auth = Buffer.from(`${this.email}:${this.apiToken}`).toString('base64');
    
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...options.headers,
      },
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Jira API error: ${response.status} - ${error}`);
    }
    
    return response.json();
  }
  
  async searchIssues(params: SearchParams = {}): Promise<Issue[]> {
    let jql = `project = ${this.projectKey}`;
    
    if (params.query) {
      jql += ` AND (summary ~ "${params.query}" OR description ~ "${params.query}")`;
    }
    
    if (params.status?.length) {
      const statuses = params.status.map(s => this.mapStatusToJira(s)).join(',');
      jql += ` AND status IN (${statuses})`;
    }
    
    if (params.assignee) {
      jql += ` AND assignee = "${params.assignee}"`;
    }
    
    jql += ' ORDER BY updated DESC';
    
    const result = await this.request<any>('/search', {
      method: 'POST',
      body: JSON.stringify({
        jql,
        maxResults: params.limit || 50,
        fields: [
          'summary', 'description', 'status', 'priority', 'assignee',
          'reporter', 'labels', 'created', 'updated', 'duedate',
          'timeestimate', 'comment', 'subtasks', 'issuetype',
        ],
      }),
    });
    
    return result.issues.map((issue: any) => this.mapJiraIssue(issue));
  }
  
  async getIssue(key: string): Promise<Issue | null> {
    try {
      const issue = await this.request<any>(`/issue/${key}`);
      return this.mapJiraIssue(issue);
    } catch {
      return null;
    }
  }
  
  async createIssue(params: CreateIssueParams): Promise<Issue> {
    const result = await this.request<any>('/issue', {
      method: 'POST',
      body: JSON.stringify({
        fields: {
          project: { key: this.projectKey },
          summary: params.title,
          description: params.description ? {
            type: 'doc',
            version: 1,
            content: [{
              type: 'paragraph',
              content: [{ type: 'text', text: params.description }],
            }],
          } : undefined,
          issuetype: { name: this.mapTypeToJira(params.type || 'task') },
          priority: params.priority ? { name: this.mapPriorityToJira(params.priority) } : undefined,
          labels: params.labels,
          assignee: params.assignee ? { id: params.assignee } : undefined,
        },
      }),
    });
    
    return (await this.getIssue(result.key))!;
  }
  
  async updateIssueStatus(issueKey: string, status: IssueStatus): Promise<void> {
    // Get available transitions
    const transitions = await this.request<any>(`/issue/${issueKey}/transitions`);
    
    const targetStatus = this.mapStatusToJira(status);
    const transition = transitions.transitions.find(
      (t: any) => t.to.name.toLowerCase() === targetStatus.toLowerCase()
    );
    
    if (!transition) {
      throw new Error(`Cannot transition to status "${status}"`);
    }
    
    await this.request(`/issue/${issueKey}/transitions`, {
      method: 'POST',
      body: JSON.stringify({ transition: { id: transition.id } }),
    });
  }
  
  async addComment(issueKey: string, body: string): Promise<void> {
    await this.request(`/issue/${issueKey}/comment`, {
      method: 'POST',
      body: JSON.stringify({
        body: {
          type: 'doc',
          version: 1,
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: body }],
          }],
        },
      }),
    });
  }
  
  private mapStatusToJira(status: IssueStatus): string {
    const map: Record<IssueStatus, string> = {
      'todo': 'To Do',
      'in-progress': 'In Progress',
      'in-review': 'In Review',
      'done': 'Done',
      'cancelled': 'Cancelled',
    };
    return map[status];
  }
  
  private mapTypeToJira(type: IssueType): string {
    const map: Record<IssueType, string> = {
      'bug': 'Bug',
      'feature': 'Story',
      'task': 'Task',
      'story': 'Story',
      'epic': 'Epic',
    };
    return map[type];
  }
  
  private mapPriorityToJira(priority: IssuePriority): string {
    const map: Record<IssuePriority, string> = {
      'urgent': 'Highest',
      'high': 'High',
      'medium': 'Medium',
      'low': 'Low',
      'none': 'Lowest',
    };
    return map[priority];
  }
  
  private mapJiraIssue(issue: any): Issue {
    const fields = issue.fields;
    
    const statusMap: Record<string, IssueStatus> = {
      'to do': 'todo',
      'in progress': 'in-progress',
      'in review': 'in-review',
      'done': 'done',
      'cancelled': 'cancelled',
    };
    
    const priorityMap: Record<string, IssuePriority> = {
      'highest': 'urgent',
      'high': 'high',
      'medium': 'medium',
      'low': 'low',
      'lowest': 'none',
    };
    
    const typeMap: Record<string, IssueType> = {
      'bug': 'bug',
      'story': 'story',
      'task': 'task',
      'epic': 'epic',
      'feature': 'feature',
    };
    
    return {
      id: issue.id,
      key: issue.key,
      title: fields.summary,
      description: this.extractJiraDescription(fields.description),
      type: typeMap[fields.issuetype?.name?.toLowerCase()] || 'task',
      status: statusMap[fields.status?.name?.toLowerCase()] || 'todo',
      priority: priorityMap[fields.priority?.name?.toLowerCase()] || 'none',
      assignee: fields.assignee ? {
        id: fields.assignee.accountId,
        name: fields.assignee.displayName,
        email: fields.assignee.emailAddress,
        avatar: fields.assignee.avatarUrls?.['48x48'],
      } : undefined,
      reporter: fields.reporter ? {
        id: fields.reporter.accountId,
        name: fields.reporter.displayName,
        email: fields.reporter.emailAddress,
      } : undefined,
      labels: fields.labels || [],
      created: new Date(fields.created),
      updated: new Date(fields.updated),
      dueDate: fields.duedate ? new Date(fields.duedate) : undefined,
      estimate: fields.timeestimate ? fields.timeestimate / 3600 : undefined,
      url: `${this.baseUrl}/browse/${issue.key}`,
      comments: (fields.comment?.comments || []).map((c: any) => ({
        id: c.id,
        author: {
          id: c.author.accountId,
          name: c.author.displayName,
        },
        body: this.extractJiraDescription(c.body),
        created: new Date(c.created),
      })),
      linkedCommits: [],
      subtasks: (fields.subtasks || []).map((st: any) => ({
        id: st.id,
        key: st.key,
        title: st.fields.summary,
        type: 'task' as IssueType,
        status: statusMap[st.fields.status?.name?.toLowerCase()] || 'todo',
        priority: 'none' as IssuePriority,
        labels: [],
        created: new Date(),
        updated: new Date(),
        url: `${this.baseUrl}/browse/${st.key}`,
        comments: [],
        linkedCommits: [],
        subtasks: [],
      })),
    };
  }
  
  private extractJiraDescription(doc: any): string {
    if (!doc?.content) return '';
    
    return doc.content
      .map((block: any) => {
        if (block.type === 'paragraph') {
          return block.content?.map((c: any) => c.text || '').join('') || '';
        }
        return '';
      })
      .join('\n');
  }
}

// ============================================================================
// Project Management Integration Class
// ============================================================================

export class ProjectManagement extends EventEmitter {
  private configs: Map<string, PMConfig> = new Map();
  private linearClient: LinearClient | null = null;
  private jiraClient: JiraClient | null = null;
  private activeProvider: PMProvider | null = null;
  
  constructor() {
    super();
  }
  
  // ==========================================================================
  // Configuration
  // ==========================================================================
  
  configure(config: PMConfig): void {
    this.configs.set(config.provider, config);
    
    switch (config.provider) {
      case 'linear':
        this.linearClient = new LinearClient(config.apiToken, config.teamId);
        break;
      case 'jira':
        if (!config.baseUrl || !config.projectKey) {
          throw new Error('Jira requires baseUrl and projectKey');
        }
        // For Jira, apiToken should be "email:token" format
        const [email, token] = config.apiToken.split(':');
        this.jiraClient = new JiraClient(config.baseUrl, email, token, config.projectKey);
        break;
    }
    
    this.activeProvider = config.provider;
    this.emit('configured', config.provider);
    logger.info('Project management configured', { provider: config.provider });
  }
  
  setActiveProvider(provider: PMProvider): void {
    if (!this.configs.has(provider)) {
      throw new Error(`Provider "${provider}" not configured`);
    }
    this.activeProvider = provider;
    this.emit('providerChanged', provider);
  }
  
  // ==========================================================================
  // Issue Operations
  // ==========================================================================
  
  async getIssues(params: SearchParams = {}): Promise<Issue[]> {
    if (this.activeProvider === 'linear' && this.linearClient) {
      return this.linearClient.getIssues(params);
    }
    if (this.activeProvider === 'jira' && this.jiraClient) {
      return this.jiraClient.searchIssues(params);
    }
    throw new Error('No provider configured');
  }
  
  async getIssue(key: string): Promise<Issue | null> {
    if (this.activeProvider === 'linear' && this.linearClient) {
      return this.linearClient.getIssue(key);
    }
    if (this.activeProvider === 'jira' && this.jiraClient) {
      return this.jiraClient.getIssue(key);
    }
    throw new Error('No provider configured');
  }
  
  async createIssue(params: CreateIssueParams): Promise<Issue> {
    logger.info('Creating issue', { title: params.title });
    
    let issue: Issue;
    
    if (this.activeProvider === 'linear' && this.linearClient) {
      issue = await this.linearClient.createIssue(params);
    } else if (this.activeProvider === 'jira' && this.jiraClient) {
      issue = await this.jiraClient.createIssue(params);
    } else {
      throw new Error('No provider configured');
    }
    
    this.emit('issueCreated', issue);
    return issue;
  }
  
  async updateStatus(issueKey: string, status: IssueStatus): Promise<void> {
    logger.info('Updating issue status', { issueKey, status });
    
    if (this.activeProvider === 'linear' && this.linearClient) {
      await this.linearClient.updateIssueStatus(issueKey, status);
    } else if (this.activeProvider === 'jira' && this.jiraClient) {
      await this.jiraClient.updateIssueStatus(issueKey, status);
    } else {
      throw new Error('No provider configured');
    }
    
    this.emit('statusUpdated', { issueKey, status });
  }
  
  async addComment(issueKey: string, body: string): Promise<void> {
    logger.info('Adding comment', { issueKey });
    
    if (this.activeProvider === 'linear' && this.linearClient) {
      await this.linearClient.addComment(issueKey, body);
    } else if (this.activeProvider === 'jira' && this.jiraClient) {
      await this.jiraClient.addComment(issueKey, body);
    } else {
      throw new Error('No provider configured');
    }
    
    this.emit('commentAdded', { issueKey, body });
  }
  
  // ==========================================================================
  // Convenience Methods
  // ==========================================================================
  
  async getMyIssues(): Promise<Issue[]> {
    const config = this.configs.get(this.activeProvider!);
    return this.getIssues({
      assignee: config?.defaultAssignee,
      status: ['todo', 'in-progress'],
    });
  }
  
  async startWorkingOn(issueKey: string): Promise<void> {
    await this.updateStatus(issueKey, 'in-progress');
    this.emit('workStarted', issueKey);
  }
  
  async markForReview(issueKey: string): Promise<void> {
    await this.updateStatus(issueKey, 'in-review');
    this.emit('markedForReview', issueKey);
  }
  
  async completeIssue(issueKey: string): Promise<void> {
    await this.updateStatus(issueKey, 'done');
    this.emit('issueCompleted', issueKey);
  }
  
  async linkCommit(issueKey: string, commitHash: string, message: string): Promise<void> {
    const comment = `Commit linked: ${commitHash}\n\n${message}`;
    await this.addComment(issueKey, comment);
    this.emit('commitLinked', { issueKey, commitHash });
  }
  
  // ==========================================================================
  // Voice Commands
  // ==========================================================================
  
  async createIssueFromVoice(transcript: string): Promise<Issue> {
    // Parse natural language into issue
    const parsed = this.parseVoiceCommand(transcript);
    return this.createIssue(parsed);
  }
  
  private parseVoiceCommand(transcript: string): CreateIssueParams {
    const lower = transcript.toLowerCase();
    
    // Detect issue type
    let type: IssueType = 'task';
    if (lower.includes('bug') || lower.includes('fix')) type = 'bug';
    if (lower.includes('feature') || lower.includes('add')) type = 'feature';
    if (lower.includes('story')) type = 'story';
    
    // Detect priority
    let priority: IssuePriority = 'medium';
    if (lower.includes('urgent') || lower.includes('critical')) priority = 'urgent';
    if (lower.includes('high priority') || lower.includes('important')) priority = 'high';
    if (lower.includes('low priority') || lower.includes('minor')) priority = 'low';
    
    // Clean up title
    const title = transcript
      .replace(/^(create|make|add|new)\s+(a\s+)?(bug|task|feature|story|issue)\s*/i, '')
      .replace(/\s+(with\s+)?(urgent|high|low|medium)\s+priority/i, '')
      .trim();
    
    return {
      title: title || 'New issue from voice',
      type,
      priority,
    };
  }
  
  // ==========================================================================
  // Context Suggestions
  // ==========================================================================
  
  async suggestIssuesForFile(filePath: string): Promise<Issue[]> {
    // Search for issues related to this file
    const fileName = filePath.split('/').pop() || '';
    const dirName = filePath.split('/').slice(-2, -1)[0] || '';
    
    const query = `${fileName} OR ${dirName}`;
    return this.getIssues({ query, limit: 5 });
  }
  
  async suggestIssuesForError(errorMessage: string): Promise<Issue[]> {
    // Search for existing bug reports
    return this.getIssues({
      query: errorMessage.slice(0, 50),
      status: ['todo', 'in-progress'],
      limit: 5,
    });
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: ProjectManagement | null = null;

export function getProjectManagement(): ProjectManagement {
  if (!instance) {
    instance = new ProjectManagement();
  }
  return instance;
}

export default {
  ProjectManagement,
  getProjectManagement,
};
