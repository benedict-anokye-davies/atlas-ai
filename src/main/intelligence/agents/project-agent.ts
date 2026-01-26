/**
 * Project Intelligence Agent
 * Analyzes projects, tasks, and provides project management insights
 */

import { createModuleLogger } from '../../utils/logger';
import { EntityType, AgentContext, AgentResponse, AgentInsight, AgentAction, ProjectEntity, TaskEntity } from '../types';
import { BaseIntelligenceAgent } from './base-agent';
import {
  AgentCapability,
  AgentQuery,
  AgentQueryResult,
  AgentAlert,
  AgentRecommendation,
  ProjectHealth,
  TaskPrioritization,
} from './types';

const logger = createModuleLogger('ProjectAgent');

// ============================================================================
// PROJECT AGENT
// ============================================================================

export class ProjectAgent extends BaseIntelligenceAgent {
  id = 'project';
  name = 'Project Intelligence';
  description = 'Analyzes projects, tasks, and provides project management insights';
  capabilities: AgentCapability[] = [
    'entity_query',
    'relationship_query',
    'temporal_query',
    'pattern_detection',
    'recommendation',
    'alert_generation',
  ];
  focusEntities: EntityType[] = ['project', 'task'];

  // --------------------------------------------------------------------------
  // QUERY HANDLING
  // --------------------------------------------------------------------------

  protected async handleQuery(query: AgentQuery): Promise<AgentQueryResult> {
    const lowerQuery = query.query.toLowerCase();

    if (lowerQuery.includes('project') && (lowerQuery.includes('status') || lowerQuery.includes('health'))) {
      return this.handleProjectHealthQuery(query);
    }

    if (lowerQuery.includes('task') || lowerQuery.includes('todo')) {
      return this.handleTaskQuery(query);
    }

    if (lowerQuery.includes('priorit') || lowerQuery.includes('important')) {
      return this.handlePriorityQuery(query);
    }

    if (lowerQuery.includes('overdue') || lowerQuery.includes('late') || lowerQuery.includes('deadline')) {
      return this.handleDeadlineQuery(query);
    }

    return this.handleGeneralQuery(query);
  }

  private async handleProjectHealthQuery(query: AgentQuery): Promise<AgentQueryResult> {
    const projects = this.getProjects();
    const healthReports = projects.map(p => this.calculateProjectHealth(p));

    const atRisk = healthReports.filter(h => h.status === 'at_risk' || h.status === 'blocked');

    return {
      answer: `You have ${projects.length} projects. ` +
        `${atRisk.length > 0 ? `${atRisk.length} project(s) need attention: ${atRisk.map(p => p.projectName).join(', ')}.` : 'All projects are on track.'}`,
      confidence: 0.9,
      evidence: healthReports.map(h => ({
        entityId: h.projectId,
        entityType: 'project' as EntityType,
        relevance: 1 - h.healthScore,
        snippet: `${h.projectName}: ${h.status} (${h.metrics.progressPercent.toFixed(0)}% complete)`,
      })),
      insights: [],
      followUpQueries: [
        'What tasks are overdue?',
        'Which project needs the most attention?',
        'What are my priorities for today?',
      ],
      suggestedActions: [],
    };
  }

  private async handleTaskQuery(query: AgentQuery): Promise<AgentQueryResult> {
    const tasks = this.getTasks();
    const pending = tasks.filter(t => t.status !== 'completed');
    const today = tasks.filter(t => this.isDueToday(t));

    return {
      answer: `You have ${pending.length} pending tasks. ` +
        `${today.length} due today: ${today.slice(0, 3).map(t => t.name).join(', ')}${today.length > 3 ? '...' : ''}`,
      confidence: 0.9,
      evidence: pending.slice(0, 5).map(t => ({
        entityId: t.id,
        entityType: 'task' as EntityType,
        relevance: this.calculateTaskUrgency(t),
        snippet: `${t.name} - ${t.status}${t.dueDate ? ` (due ${this.formatDate(t.dueDate)})` : ''}`,
      })),
      insights: [],
      followUpQueries: ['What should I work on next?', 'What tasks are overdue?', 'Show my completed tasks'],
      suggestedActions: [],
    };
  }

  private async handlePriorityQuery(query: AgentQuery): Promise<AgentQueryResult> {
    const prioritization = await this.prioritizeTasks();

    return {
      answer: `Based on urgency and importance, here are your top priorities:\n` +
        prioritization.tasks.slice(0, 5).map((t, i) =>
          `${i + 1}. ${t.taskName} (score: ${t.priorityScore.toFixed(1)})`
        ).join('\n'),
      confidence: 0.85,
      evidence: prioritization.tasks.slice(0, 5).map(t => ({
        entityId: t.taskId,
        entityType: 'task' as EntityType,
        relevance: t.priorityScore / 10,
        snippet: t.factors.join(', '),
      })),
      insights: [],
      followUpQueries: ['Why is this task high priority?', 'What can I delegate?', 'How long will these take?'],
      suggestedActions: prioritization.tasks.slice(0, 3).map(t => ({
        type: 'start_task',
        description: `Start working on: ${t.taskName}`,
        parameters: { taskId: t.taskId },
      })),
    };
  }

  private async handleDeadlineQuery(query: AgentQuery): Promise<AgentQueryResult> {
    const tasks = this.getTasks();
    const overdue = tasks.filter(t => this.isOverdue(t));
    const upcoming = tasks.filter(t => this.isDueSoon(t, 3));

    return {
      answer: overdue.length > 0
        ? `You have ${overdue.length} overdue task(s): ${overdue.map(t => t.name).join(', ')}.`
        : `No overdue tasks! ${upcoming.length} task(s) due in the next 3 days.`,
      confidence: 0.95,
      evidence: [...overdue, ...upcoming].slice(0, 5).map(t => ({
        entityId: t.id,
        entityType: 'task' as EntityType,
        relevance: this.isOverdue(t) ? 1 : 0.7,
        snippet: `${t.name} - due ${t.dueDate ? this.formatDate(t.dueDate) : 'no date'}`,
      })),
      insights: overdue.length > 0 ? [{
        id: this.generateId(),
        type: 'warning',
        title: 'Overdue Tasks',
        description: `${overdue.length} tasks are past their deadline`,
        confidence: 1,
        relatedEntityIds: overdue.map(t => t.id),
        actionable: true,
      }] : [],
      followUpQueries: ['How can I catch up?', 'Which tasks can be rescheduled?'],
      suggestedActions: [],
    };
  }

  private async handleGeneralQuery(query: AgentQuery): Promise<AgentQueryResult> {
    return {
      answer: 'I can help with project and task management. Try asking about project status, tasks, priorities, or deadlines.',
      confidence: 0.5,
      evidence: [],
      insights: [],
      followUpQueries: [
        'What are my projects?',
        'What tasks do I have today?',
        'What should I prioritize?',
      ],
      suggestedActions: [],
    };
  }

  // --------------------------------------------------------------------------
  // INSIGHTS
  // --------------------------------------------------------------------------

  protected async computeInsights(context: AgentContext): Promise<AgentInsight[]> {
    const insights: AgentInsight[] = [];
    const tasks = this.getTasks();

    // Productivity pattern
    const completed = tasks.filter(t => t.status === 'completed');
    const completedThisWeek = completed.filter(t =>
      new Date(t.updatedAt).getTime() > Date.now() - 7 * 24 * 60 * 60 * 1000
    );

    if (completedThisWeek.length >= 5) {
      insights.push({
        id: this.generateId(),
        type: 'achievement',
        title: 'Productive Week!',
        description: `You completed ${completedThisWeek.length} tasks this week. Great progress!`,
        confidence: 1,
        relatedEntityIds: completedThisWeek.slice(0, 5).map(t => t.id),
        actionable: false,
      });
    }

    // Blocked tasks
    const blocked = tasks.filter(t => t.status === 'blocked');
    if (blocked.length > 0) {
      insights.push({
        id: this.generateId(),
        type: 'warning',
        title: 'Blocked Tasks',
        description: `${blocked.length} task(s) are blocked: ${blocked.map(t => t.name).join(', ')}`,
        confidence: 1,
        relatedEntityIds: blocked.map(t => t.id),
        actionable: true,
        suggestedAction: {
          type: 'unblock',
          description: 'Review and unblock tasks',
          parameters: { taskIds: blocked.map(t => t.id) },
        },
      });
    }

    // Old tasks
    const stale = tasks.filter(t =>
      t.status === 'pending' &&
      new Date(t.updatedAt).getTime() < Date.now() - 14 * 24 * 60 * 60 * 1000
    );

    if (stale.length >= 3) {
      insights.push({
        id: this.generateId(),
        type: 'suggestion',
        title: 'Stale Tasks',
        description: `${stale.length} tasks haven't been updated in 2+ weeks. Consider reviewing them.`,
        confidence: 0.8,
        relatedEntityIds: stale.map(t => t.id),
        actionable: true,
      });
    }

    return insights;
  }

  // --------------------------------------------------------------------------
  // ALERTS
  // --------------------------------------------------------------------------

  protected async computeAlerts(context: AgentContext): Promise<AgentAlert[]> {
    const alerts: AgentAlert[] = [];
    const tasks = this.getTasks();

    // Overdue alerts
    const overdue = tasks.filter(t => this.isOverdue(t));
    for (const task of overdue) {
      alerts.push({
        id: this.generateId(),
        agentId: this.id,
        type: 'urgent',
        title: 'Overdue Task',
        description: `"${task.name}" was due ${this.formatDate(task.dueDate!)}`,
        relatedEntities: [task.id],
        priority: 8,
        actionable: true,
        suggestedActions: [{
          type: 'complete_task',
          description: 'Complete this task',
          parameters: { taskId: task.id },
        }, {
          type: 'reschedule',
          description: 'Reschedule this task',
          parameters: { taskId: task.id },
        }],
        createdAt: new Date(),
        dismissed: false,
      });
    }

    // Due today alerts
    const dueToday = tasks.filter(t => this.isDueToday(t) && t.status !== 'completed');
    if (dueToday.length > 0) {
      alerts.push({
        id: this.generateId(),
        agentId: this.id,
        type: 'info',
        title: 'Tasks Due Today',
        description: `${dueToday.length} task(s) due today: ${dueToday.map(t => t.name).join(', ')}`,
        relatedEntities: dueToday.map(t => t.id),
        priority: 6,
        actionable: true,
        suggestedActions: [{
          type: 'focus',
          description: 'Focus on today\'s tasks',
          parameters: { taskIds: dueToday.map(t => t.id) },
        }],
        createdAt: new Date(),
        dismissed: false,
      });
    }

    return alerts;
  }

  // --------------------------------------------------------------------------
  // RECOMMENDATIONS
  // --------------------------------------------------------------------------

  protected async computeRecommendations(context: AgentContext): Promise<AgentRecommendation[]> {
    const recommendations: AgentRecommendation[] = [];
    const tasks = this.getTasks();
    const projects = this.getProjects();

    // Break down large tasks
    const largeTasks = tasks.filter(t =>
      t.estimatedHours && t.estimatedHours > 4 && t.status !== 'completed'
    );

    if (largeTasks.length > 0) {
      recommendations.push({
        id: this.generateId(),
        agentId: this.id,
        type: 'process_improvement',
        title: 'Break Down Large Tasks',
        description: `${largeTasks.length} task(s) are estimated at 4+ hours`,
        rationale: 'Smaller tasks are easier to complete and track progress',
        confidence: 0.75,
        impact: 'medium',
        effort: 'low',
        relatedEntities: largeTasks.map(t => t.id),
        actions: [{
          type: 'break_down',
          description: 'Break down into smaller subtasks',
          parameters: { taskIds: largeTasks.map(t => t.id) },
        }],
        createdAt: new Date(),
      });
    }

    // Review project health
    for (const project of projects) {
      const health = this.calculateProjectHealth(project);
      if (health.status === 'at_risk' || health.status === 'blocked') {
        recommendations.push({
          id: this.generateId(),
          agentId: this.id,
          type: 'project_health',
          title: `Review ${project.name}`,
          description: `Project "${project.name}" needs attention`,
          rationale: health.risks.join('; ') || 'Health score is low',
          confidence: 0.85,
          impact: 'high',
          effort: 'medium',
          relatedEntities: [project.id],
          actions: [{
            type: 'review_project',
            description: 'Review project status and blockers',
            parameters: { projectId: project.id },
          }],
          createdAt: new Date(),
        });
      }
    }

    return recommendations;
  }

  // --------------------------------------------------------------------------
  // ACTIONS
  // --------------------------------------------------------------------------

  protected async handleAction(action: AgentAction): Promise<AgentResponse> {
    switch (action.type) {
      case 'start_task':
        return {
          success: true,
          message: `Task marked as in progress. Focus on: ${action.parameters?.taskId}`,
        };

      case 'complete_task':
        return {
          success: true,
          message: 'Task completion noted.',
        };

      case 'reschedule':
        return {
          success: true,
          message: 'Task rescheduling request noted.',
        };

      default:
        return {
          success: false,
          message: `Unknown action type: ${action.type}`,
        };
    }
  }

  // --------------------------------------------------------------------------
  // UTILITY METHODS
  // --------------------------------------------------------------------------

  private getProjects(): ProjectEntity[] {
    const store = this.getStore();
    return store.getEntitiesByType('project', 100) as ProjectEntity[];
  }

  private getTasks(): TaskEntity[] {
    const store = this.getStore();
    return store.getEntitiesByType('task', 500) as TaskEntity[];
  }

  private calculateProjectHealth(project: ProjectEntity): ProjectHealth {
    const store = this.getStore();
    const tasks = store.search(project.name, { entityTypes: ['task'], limit: 100 }) as TaskEntity[];

    const total = tasks.length;
    const completed = tasks.filter(t => t.status === 'completed').length;
    const pending = tasks.filter(t => t.status === 'pending').length;
    const overdue = tasks.filter(t => this.isOverdue(t)).length;
    const blocked = tasks.filter(t => t.status === 'blocked').length;

    const progressPercent = total > 0 ? (completed / total) * 100 : 0;

    const risks: string[] = [];
    const blockers: string[] = [];

    if (overdue > 0) risks.push(`${overdue} overdue tasks`);
    if (blocked > 0) blockers.push(`${blocked} blocked tasks`);

    let status: 'on_track' | 'at_risk' | 'blocked' | 'completed' = 'on_track';
    if (progressPercent === 100) status = 'completed';
    else if (blocked > 0) status = 'blocked';
    else if (overdue > 2 || overdue / total > 0.2) status = 'at_risk';

    const healthScore = Math.max(0, 1 - (overdue * 0.2) - (blocked * 0.3));

    return {
      projectId: project.id,
      projectName: project.name,
      healthScore,
      status,
      metrics: {
        tasksTotal: total,
        tasksCompleted: completed,
        tasksPending: pending,
        tasksOverdue: overdue,
        progressPercent,
        daysRemaining: project.deadline
          ? Math.max(0, Math.ceil((new Date(project.deadline).getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
          : undefined,
      },
      risks,
      blockers,
      recommendations: [],
    };
  }

  async prioritizeTasks(): Promise<TaskPrioritization> {
    const tasks = this.getTasks().filter(t => t.status !== 'completed');

    const scored = tasks.map(task => {
      let score = 0;
      const factors: string[] = [];

      // Urgency (due date)
      if (task.dueDate) {
        const daysUntilDue = (new Date(task.dueDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
        if (daysUntilDue < 0) {
          score += 3;
          factors.push('Overdue');
        } else if (daysUntilDue < 1) {
          score += 2.5;
          factors.push('Due today');
        } else if (daysUntilDue < 3) {
          score += 2;
          factors.push('Due soon');
        } else if (daysUntilDue < 7) {
          score += 1;
          factors.push('Due this week');
        }
      }

      // Priority level
      if (task.priority === 'urgent') {
        score += 3;
        factors.push('Urgent priority');
      } else if (task.priority === 'high') {
        score += 2;
        factors.push('High priority');
      } else if (task.priority === 'medium') {
        score += 1;
        factors.push('Medium priority');
      }

      // Blocked status (negative)
      if (task.status === 'blocked') {
        score -= 1;
        factors.push('Currently blocked');
      }

      return {
        taskId: task.id,
        taskName: task.name,
        priorityScore: Math.max(0, score),
        factors,
        suggestedDueDate: task.dueDate ? new Date(task.dueDate) : undefined,
      };
    });

    scored.sort((a, b) => b.priorityScore - a.priorityScore);

    return {
      tasks: scored,
      rationale: 'Prioritized by due date, priority level, and status',
    };
  }

  private calculateTaskUrgency(task: TaskEntity): number {
    if (!task.dueDate) return 0.3;
    const daysUntilDue = (new Date(task.dueDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    if (daysUntilDue < 0) return 1;
    if (daysUntilDue < 1) return 0.9;
    if (daysUntilDue < 3) return 0.7;
    return 0.4;
  }

  private isOverdue(task: TaskEntity): boolean {
    if (!task.dueDate || task.status === 'completed') return false;
    return new Date(task.dueDate).getTime() < Date.now();
  }

  private isDueToday(task: TaskEntity): boolean {
    if (!task.dueDate || task.status === 'completed') return false;
    const due = new Date(task.dueDate);
    const today = new Date();
    return due.toDateString() === today.toDateString();
  }

  private isDueSoon(task: TaskEntity, days: number): boolean {
    if (!task.dueDate || task.status === 'completed') return false;
    const due = new Date(task.dueDate);
    const cutoff = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    return due <= cutoff && due > new Date();
  }

  private formatDate(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: ProjectAgent | null = null;

export function getProjectAgent(): ProjectAgent {
  if (!instance) {
    instance = new ProjectAgent();
  }
  return instance;
}
