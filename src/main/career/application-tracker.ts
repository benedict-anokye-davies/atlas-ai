/**
 * Application Tracker
 *
 * Tracks job applications, interviews, and outcomes.
 * Provides analytics on application success rates.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { createModuleLogger } from '../utils/logger';
import {
  JobApplication,
  JobListing,
  JobStatus,
  Interview,
  InterviewType,
  Communication,
  ApplicationOutcome,
  StatusChange,
  ApplicationAnalytics,
  InterviewAnalytics,
} from './types';

const logger = createModuleLogger('ApplicationTracker');

// ============================================================================
// Application Tracker
// ============================================================================

export class ApplicationTracker extends EventEmitter {
  private applications: Map<string, JobApplication> = new Map();
  private dataPath: string;
  private initialized = false;

  constructor() {
    super();
    this.dataPath = path.join(app.getPath('userData'), 'career', 'applications.json');
  }

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await this.loadApplications();
      this.initialized = true;
      logger.info('Application tracker initialized');
    } catch (error) {
      logger.error('Failed to initialize application tracker', error as Record<string, unknown>);
    }
  }

  private async loadApplications(): Promise<void> {
    if (!fs.existsSync(this.dataPath)) {
      return;
    }

    try {
      const data = fs.readFileSync(this.dataPath, 'utf-8');
      const apps = JSON.parse(data) as JobApplication[];

      for (const app of apps) {
        this.applications.set(app.id, app);
      }

      logger.info(`Loaded ${apps.length} applications`);
    } catch (error) {
      logger.error('Failed to load applications', error as Record<string, unknown>);
    }
  }

  private async saveApplications(): Promise<void> {
    const apps = Array.from(this.applications.values());

    const dir = path.dirname(this.dataPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(this.dataPath, JSON.stringify(apps, null, 2));
  }

  // --------------------------------------------------------------------------
  // Application Management
  // --------------------------------------------------------------------------

  async createApplication(
    job: JobListing,
    cvVersionId: string,
    coverLetter?: string
  ): Promise<JobApplication> {
    const now = Date.now();

    const application: JobApplication = {
      id: `app_${now}`,
      jobId: job.id,
      job,
      appliedAt: now,
      cvVersionUsed: cvVersionId,
      coverLetter,
      applicationMethod: 'online',
      status: 'applied',
      statusHistory: [
        {
          from: 'saved',
          to: 'applied',
          at: now,
        },
      ],
      interviews: [],
      communications: [],
      notes: '',
    };

    this.applications.set(application.id, application);
    await this.saveApplications();

    this.emit('application-created', application);
    logger.info('Created application', { applicationId: application.id, company: job.company });

    return application;
  }

  getApplication(id: string): JobApplication | undefined {
    return this.applications.get(id);
  }

  getAllApplications(): JobApplication[] {
    return Array.from(this.applications.values())
      .sort((a, b) => b.appliedAt - a.appliedAt);
  }

  getApplicationsByStatus(status: JobStatus): JobApplication[] {
    return this.getAllApplications().filter((app) => app.status === status);
  }

  getActiveApplications(): JobApplication[] {
    const inactiveStatuses: JobStatus[] = [
      'offer-accepted',
      'offer-declined',
      'rejected',
      'withdrawn',
      'ghosted',
    ];

    return this.getAllApplications().filter(
      (app) => !inactiveStatuses.includes(app.status)
    );
  }

  // --------------------------------------------------------------------------
  // Status Updates
  // --------------------------------------------------------------------------

  async updateStatus(applicationId: string, newStatus: JobStatus, notes?: string): Promise<void> {
    const app = this.applications.get(applicationId);
    if (!app) {
      throw new Error(`Application ${applicationId} not found`);
    }

    const statusChange: StatusChange = {
      from: app.status,
      to: newStatus,
      at: Date.now(),
      notes,
    };

    app.statusHistory.push(statusChange);
    app.status = newStatus;

    await this.saveApplications();
    this.emit('status-updated', app, statusChange);

    logger.info('Updated application status', {
      applicationId,
      from: statusChange.from,
      to: newStatus,
    });
  }

  async markAsRejected(applicationId: string, reason?: string, feedback?: string): Promise<void> {
    const app = this.applications.get(applicationId);
    if (!app) throw new Error(`Application ${applicationId} not found`);

    app.outcome = {
      result: 'rejected',
      at: Date.now(),
      rejectionReason: reason,
      feedback,
    };

    await this.updateStatus(applicationId, 'rejected', reason);
  }

  async markAsGhosted(applicationId: string): Promise<void> {
    await this.updateStatus(applicationId, 'ghosted', 'No response after follow-ups');
  }

  async withdraw(applicationId: string, reason?: string): Promise<void> {
    const app = this.applications.get(applicationId);
    if (!app) throw new Error(`Application ${applicationId} not found`);

    app.outcome = {
      result: 'withdrawn',
      at: Date.now(),
    };

    await this.updateStatus(applicationId, 'withdrawn', reason);
  }

  // --------------------------------------------------------------------------
  // Interview Management
  // --------------------------------------------------------------------------

  async scheduleInterview(
    applicationId: string,
    interview: Omit<Interview, 'id'>
  ): Promise<Interview> {
    const app = this.applications.get(applicationId);
    if (!app) throw new Error(`Application ${applicationId} not found`);

    const newInterview: Interview = {
      ...interview,
      id: `int_${Date.now()}`,
    };

    app.interviews.push(newInterview);

    // Update status based on interview type
    const interviewStatuses: Record<InterviewType, JobStatus> = {
      'recruiter-screen': 'screening',
      'hiring-manager': 'phone-interview',
      'technical-phone': 'technical-interview',
      'coding-challenge': 'technical-interview',
      'system-design': 'technical-interview',
      'behavioral': 'phone-interview',
      'take-home': 'technical-interview',
      'pair-programming': 'technical-interview',
      'presentation': 'onsite-interview',
      'panel': 'onsite-interview',
      'culture-fit': 'onsite-interview',
      'final-round': 'final-interview',
    };

    const newStatus = interviewStatuses[interview.type];
    if (newStatus) {
      await this.updateStatus(applicationId, newStatus);
    }

    await this.saveApplications();
    this.emit('interview-scheduled', app, newInterview);

    return newInterview;
  }

  async completeInterview(
    applicationId: string,
    interviewId: string,
    feedback: string,
    performance: 1 | 2 | 3 | 4 | 5,
    lessonsLearned?: string
  ): Promise<void> {
    const app = this.applications.get(applicationId);
    if (!app) throw new Error(`Application ${applicationId} not found`);

    const interview = app.interviews.find((i) => i.id === interviewId);
    if (!interview) throw new Error(`Interview ${interviewId} not found`);

    interview.completedAt = Date.now();
    interview.feedback = feedback;
    interview.performance = performance;
    interview.lessonsLearned = lessonsLearned;

    await this.saveApplications();
    this.emit('interview-completed', app, interview);
  }

  getUpcomingInterviews(): { application: JobApplication; interview: Interview }[] {
    const upcoming: { application: JobApplication; interview: Interview }[] = [];
    const now = Date.now();

    for (const app of this.applications.values()) {
      for (const interview of app.interviews) {
        if (interview.scheduledAt > now && !interview.completedAt) {
          upcoming.push({ application: app, interview });
        }
      }
    }

    return upcoming.sort((a, b) => a.interview.scheduledAt - b.interview.scheduledAt);
  }

  // --------------------------------------------------------------------------
  // Communication Tracking
  // --------------------------------------------------------------------------

  async addCommunication(applicationId: string, communication: Omit<Communication, 'id'>): Promise<void> {
    const app = this.applications.get(applicationId);
    if (!app) throw new Error(`Application ${applicationId} not found`);

    const newComm: Communication = {
      ...communication,
      id: `comm_${Date.now()}`,
    };

    app.communications.push(newComm);
    await this.saveApplications();

    this.emit('communication-added', app, newComm);
  }

  getPendingFollowUps(): { application: JobApplication; communication: Communication }[] {
    const pending: { application: JobApplication; communication: Communication }[] = [];
    const now = Date.now();

    for (const app of this.applications.values()) {
      for (const comm of app.communications) {
        if (comm.followUpNeeded && comm.followUpDate && comm.followUpDate <= now) {
          pending.push({ application: app, communication: comm });
        }
      }
    }

    return pending.sort((a, b) =>
      (a.communication.followUpDate || 0) - (b.communication.followUpDate || 0)
    );
  }

  // --------------------------------------------------------------------------
  // Offer Management
  // --------------------------------------------------------------------------

  async recordOffer(
    applicationId: string,
    offer: {
      salary: number;
      currency: string;
      bonus?: number;
      equity?: string;
      benefits: string[];
      startDate: number;
      deadline: number;
    }
  ): Promise<void> {
    const app = this.applications.get(applicationId);
    if (!app) throw new Error(`Application ${applicationId} not found`);

    app.outcome = {
      result: 'offer',
      at: Date.now(),
      offer: {
        ...offer,
        negotiated: false,
        accepted: false,
      },
    };

    await this.updateStatus(applicationId, 'offer-received');
  }

  async acceptOffer(applicationId: string): Promise<void> {
    const app = this.applications.get(applicationId);
    if (!app || !app.outcome?.offer) {
      throw new Error('No offer to accept');
    }

    app.outcome.offer.accepted = true;
    await this.updateStatus(applicationId, 'offer-accepted');
  }

  async declineOffer(applicationId: string, reason?: string): Promise<void> {
    const app = this.applications.get(applicationId);
    if (!app || !app.outcome?.offer) {
      throw new Error('No offer to decline');
    }

    app.outcome.offer.accepted = false;
    await this.updateStatus(applicationId, 'offer-declined', reason);
  }

  async negotiateOffer(applicationId: string, counterOffer: number): Promise<void> {
    const app = this.applications.get(applicationId);
    if (!app || !app.outcome?.offer) {
      throw new Error('No offer to negotiate');
    }

    app.outcome.offer.negotiated = true;
    app.outcome.offer.counterOffer = counterOffer;
    await this.saveApplications();

    this.emit('offer-negotiated', app);
  }

  // --------------------------------------------------------------------------
  // Analytics
  // --------------------------------------------------------------------------

  getApplicationAnalytics(): ApplicationAnalytics {
    const apps = this.getAllApplications();
    const total = apps.length;

    // Count by status
    const byStatus: Record<JobStatus, number> = {} as Record<JobStatus, number>;
    for (const app of apps) {
      byStatus[app.status] = (byStatus[app.status] || 0) + 1;
    }

    // Count by source
    const bySource: Record<string, number> = {};
    for (const app of apps) {
      const source = app.job.source;
      bySource[source] = (bySource[source] || 0) + 1;
    }

    // Calculate rates
    const gotResponse = apps.filter((a) =>
      ['screening', 'phone-interview', 'technical-interview', 'onsite-interview',
        'final-interview', 'offer-received', 'offer-accepted', 'offer-declined', 'rejected'].includes(a.status)
    ).length;

    const gotInterview = apps.filter((a) => a.interviews.length > 0).length;
    const gotOffer = apps.filter((a) => a.outcome?.result === 'offer').length;

    // Average time to response
    let totalResponseTime = 0;
    let responseCount = 0;
    for (const app of apps) {
      if (app.statusHistory.length > 1) {
        const firstResponse = app.statusHistory[1];
        const responseTime = firstResponse.at - app.appliedAt;
        totalResponseTime += responseTime;
        responseCount++;
      }
    }

    const avgResponseDays = responseCount > 0
      ? Math.round(totalResponseTime / responseCount / (24 * 60 * 60 * 1000))
      : 0;

    // Find best performing CV
    const cvPerformance = new Map<string, { applications: number; interviews: number }>();
    for (const app of apps) {
      const cvId = app.cvVersionUsed;
      if (!cvPerformance.has(cvId)) {
        cvPerformance.set(cvId, { applications: 0, interviews: 0 });
      }
      const perf = cvPerformance.get(cvId)!;
      perf.applications++;
      if (app.interviews.length > 0) perf.interviews++;
    }

    let topCVVersion: string | undefined;
    let topCVRate = 0;
    for (const [cvId, perf] of cvPerformance) {
      const rate = perf.applications > 2 ? perf.interviews / perf.applications : 0;
      if (rate > topCVRate) {
        topCVRate = rate;
        topCVVersion = cvId;
      }
    }

    return {
      totalApplications: total,
      byStatus,
      bySource: bySource as Record<any, number>,
      responseRate: total > 0 ? Math.round((gotResponse / total) * 100) : 0,
      interviewRate: total > 0 ? Math.round((gotInterview / total) * 100) : 0,
      offerRate: total > 0 ? Math.round((gotOffer / total) * 100) : 0,
      averageTimeToResponse: avgResponseDays,
      topPerformingCVVersion: topCVVersion,
    };
  }

  getInterviewAnalytics(): InterviewAnalytics {
    const allInterviews: Interview[] = [];
    for (const app of this.applications.values()) {
      allInterviews.push(...app.interviews);
    }

    const completed = allInterviews.filter((i) => i.completedAt);
    const total = allInterviews.length;

    // Count by type
    const byType: Record<InterviewType, number> = {} as Record<InterviewType, number>;
    for (const interview of allInterviews) {
      byType[interview.type] = (byType[interview.type] || 0) + 1;
    }

    // Average performance
    const performances = completed.filter((i) => i.performance).map((i) => i.performance!);
    const avgPerformance = performances.length > 0
      ? performances.reduce((a, b) => a + b, 0) / performances.length
      : 0;

    // Pass rate (interviews that led to next stage)
    // This is a rough estimate based on multiple interviews per application
    const appsWithMultipleInterviews = Array.from(this.applications.values())
      .filter((a) => a.interviews.length > 1);
    const passRate = total > 0
      ? Math.round((appsWithMultipleInterviews.length / total) * 100)
      : 0;

    // Collect common questions from feedback
    const commonQuestions: string[] = [];
    for (const interview of completed) {
      if (interview.questionsAsked) {
        commonQuestions.push(...interview.questionsAsked);
      }
    }

    // Areas of strength/weakness (from performance ratings)
    const strongAreas: string[] = [];
    const weakAreas: string[] = [];

    for (const interview of completed) {
      if (interview.performance && interview.performance >= 4) {
        strongAreas.push(interview.type);
      } else if (interview.performance && interview.performance <= 2) {
        weakAreas.push(interview.type);
      }
    }

    return {
      totalInterviews: total,
      byType,
      averagePerformance: Math.round(avgPerformance * 10) / 10,
      passRate,
      strongAreas: [...new Set(strongAreas)],
      weakAreas: [...new Set(weakAreas)],
      commonQuestions: [...new Set(commonQuestions)].slice(0, 10),
    };
  }

  // --------------------------------------------------------------------------
  // Notes
  // --------------------------------------------------------------------------

  async updateNotes(applicationId: string, notes: string): Promise<void> {
    const app = this.applications.get(applicationId);
    if (!app) throw new Error(`Application ${applicationId} not found`);

    app.notes = notes;
    await this.saveApplications();
  }

  async addLessonsLearned(applicationId: string, lessons: string): Promise<void> {
    const app = this.applications.get(applicationId);
    if (!app) throw new Error(`Application ${applicationId} not found`);

    app.lessonsLearned = lessons;
    await this.saveApplications();
  }

  // --------------------------------------------------------------------------
  // Search & Filter
  // --------------------------------------------------------------------------

  searchApplications(query: string): JobApplication[] {
    const queryLower = query.toLowerCase();

    return this.getAllApplications().filter((app) => {
      const searchText = [
        app.job.title,
        app.job.company,
        app.notes,
        ...app.job.requirements,
      ].join(' ').toLowerCase();

      return searchText.includes(queryLower);
    });
  }

  getApplicationsInDateRange(startDate: number, endDate: number): JobApplication[] {
    return this.getAllApplications().filter(
      (app) => app.appliedAt >= startDate && app.appliedAt <= endDate
    );
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: ApplicationTracker | null = null;

export function getApplicationTracker(): ApplicationTracker {
  if (!instance) {
    instance = new ApplicationTracker();
  }
  return instance;
}

export default ApplicationTracker;
