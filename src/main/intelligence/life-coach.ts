/**
 * Life Coach - Proactive life improvement assistant
 * Daily briefings, habit tracking, goal reminders, motivational nudges
 */

import { EventEmitter } from 'events';
import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { createModuleLogger } from '../utils/logger';
import { getLLMManager } from '../llm/manager';
import { clamp100, count, isoDate } from '../../shared/utils';

const logger = createModuleLogger('LifeCoach');

export interface Goal {
  id: string;
  title: string;
  description: string;
  category: 'health' | 'productivity' | 'learning' | 'social' | 'financial' | 'personal';
  priority: 'high' | 'medium' | 'low';
  deadline?: string; // ISO date
  milestones: Milestone[];
  progress: number; // 0-100
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface Milestone {
  id: string;
  title: string;
  completed: boolean;
  completedAt?: string;
}

export interface Habit {
  id: string;
  title: string;
  description?: string;
  category: 'health' | 'productivity' | 'learning' | 'mindfulness' | 'social';
  frequency: 'daily' | 'weekdays' | 'weekends' | 'weekly';
  timeOfDay?: 'morning' | 'afternoon' | 'evening' | 'anytime';
  targetDays: number; // Days per week/month
  currentStreak: number;
  longestStreak: number;
  completions: HabitCompletion[];
  createdAt: string;
  active: boolean;
}

export interface HabitCompletion {
  date: string; // YYYY-MM-DD
  completed: boolean;
  note?: string;
}

export interface DailyBriefing {
  date: string;
  greeting: string;
  weatherSummary?: string;
  focusAreas: string[];
  todaysGoals: string[];
  habitReminders: string[];
  upcomingDeadlines: Array<{ title: string; daysLeft: number }>;
  motivationalMessage: string;
  productivityTip?: string;
}

export interface LifeCoachConfig {
  briefingTime: string; // HH:mm format
  enableMorningBriefing: boolean;
  enableProgressCheckins: boolean;
  checkinIntervalHours: number;
  motivationStyle: 'encouraging' | 'direct' | 'gentle' | 'intense';
  focusAreas: string[];
}

class LifeCoach extends EventEmitter {
  private goals: Goal[] = [];
  private habits: Habit[] = [];
  private config: LifeCoachConfig;
  private dataPath: string;
  private briefingTimer: NodeJS.Timeout | null = null;
  private checkinTimer: NodeJS.Timeout | null = null;

  constructor() {
    super();
    
    this.dataPath = path.join(app.getPath('userData'), 'life-coach');
    this.config = {
      briefingTime: '08:00',
      enableMorningBriefing: true,
      enableProgressCheckins: true,
      checkinIntervalHours: 4,
      motivationStyle: 'encouraging',
      focusAreas: ['productivity', 'health', 'learning'],
    };

    this.ensureDataDir();
    this.loadData();
  }

  /**
   * Initialize and start timers
   */
  async initialize(): Promise<void> {
    logger.info('Life Coach initializing');
    
    this.loadData();
    this.scheduleBriefing();
    this.scheduleCheckins();
    
    logger.info('Life Coach ready', {
      goals: this.goals.length,
      habits: this.habits.length,
    });
  }

  /**
   * Generate morning briefing
   */
  async generateDailyBriefing(): Promise<DailyBriefing> {
    const today = new Date();
    const dateStr = isoDate(today);
    const hour = today.getHours();
    
    // Determine greeting based on time
    let greeting: string;
    if (hour < 12) {
      greeting = 'Good morning!';
    } else if (hour < 17) {
      greeting = 'Good afternoon!';
    } else {
      greeting = 'Good evening!';
    }

    // Get active goals with upcoming deadlines
    const upcomingDeadlines = this.goals
      .filter(g => g.deadline && !g.completedAt)
      .map(g => {
        const deadline = new Date(g.deadline!);
        const daysLeft = Math.ceil((deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        return { title: g.title, daysLeft };
      })
      .filter(d => d.daysLeft <= 7 && d.daysLeft >= 0)
      .sort((a, b) => a.daysLeft - b.daysLeft);

    // Get habits due today
    const habitsToday = this.habits.filter(h => {
      if (!h.active) return false;
      const dayOfWeek = today.getDay();
      if (h.frequency === 'daily') return true;
      if (h.frequency === 'weekdays') return dayOfWeek >= 1 && dayOfWeek <= 5;
      if (h.frequency === 'weekends') return dayOfWeek === 0 || dayOfWeek === 6;
      return true;
    });

    // Check which habits are not yet completed today
    const pendingHabits = habitsToday.filter(h => {
      const todayCompletion = h.completions.find(c => c.date === dateStr);
      return !todayCompletion?.completed;
    });

    // Generate personalized message using LLM
    const motivationalMessage = await this.generateMotivationalMessage({
      pendingHabits: pendingHabits.length,
      upcomingDeadlines: upcomingDeadlines.length,
      style: this.config.motivationStyle,
    });

    const briefing: DailyBriefing = {
      date: dateStr,
      greeting,
      focusAreas: this.config.focusAreas,
      todaysGoals: this.goals
        .filter(g => !g.completedAt)
        .slice(0, 3)
        .map(g => g.title),
      habitReminders: pendingHabits.map(h => h.title),
      upcomingDeadlines,
      motivationalMessage,
      productivityTip: await this.getProductivityTip(),
    };

    this.emit('briefing:generated', briefing);
    logger.info('Daily briefing generated');
    
    return briefing;
  }

  /**
   * Generate motivational message using LLM
   */
  private async generateMotivationalMessage(context: {
    pendingHabits: number;
    upcomingDeadlines: number;
    style: string;
  }): Promise<string> {
    try {
      const llm = getLLMManager();
      
      const prompt = `Generate a brief, ${context.style} motivational message for someone starting their day.
Context:
- They have ${context.pendingHabits} habits to complete today
- They have ${context.upcomingDeadlines} upcoming deadlines this week

Keep it under 2 sentences. Be genuine and specific to their situation.`;

      const response = await llm.chat(prompt, undefined, {
        temperature: 0.8,
        maxTokens: 100,
      });

      return response.content || 'You got this! Make today count.';
    } catch {
      return this.getFallbackMotivation(context.style);
    }
  }

  /**
   * Get fallback motivation if LLM fails
   */
  private getFallbackMotivation(style: string): string {
    const messages: Record<string, string[]> = {
      encouraging: [
        "Every step forward counts. You're making progress!",
        "Today is full of possibilities. Embrace them!",
        "Your consistency is building something amazing.",
      ],
      direct: [
        "Time to execute. Your goals won't achieve themselves.",
        "Focus on what matters. Eliminate distractions.",
        "Results come from action. Start now.",
      ],
      gentle: [
        "Take it one moment at a time. You're doing great.",
        "Remember to be kind to yourself today.",
        "Small progress is still progress.",
      ],
      intense: [
        "No excuses. Today we dominate.",
        "Champions are made in moments like these.",
        "Rise and conquer. Your future self is counting on you.",
      ],
    };

    const styleMessages = messages[style] || messages.encouraging;
    return styleMessages[Math.floor(Math.random() * styleMessages.length)];
  }

  /**
   * Get a productivity tip
   */
  private async getProductivityTip(): Promise<string> {
    const tips = [
      "Try the 2-minute rule: If it takes less than 2 minutes, do it now.",
      "Block distracting websites during your focus hours.",
      "Take a 5-minute break every 25 minutes (Pomodoro technique).",
      "Start with your most challenging task when your energy is highest.",
      "Keep a 'done' list to track your daily accomplishments.",
      "Set specific times for checking email and messages.",
      "Use noise-canceling headphones or ambient sounds for deep work.",
      "Review your goals every morning to stay aligned.",
      "Batch similar tasks together to reduce context switching.",
      "End each day by planning tomorrow's top 3 priorities.",
    ];
    
    return tips[Math.floor(Math.random() * tips.length)];
  }

  /**
   * Add a new goal
   */
  addGoal(goal: Omit<Goal, 'id' | 'createdAt' | 'updatedAt' | 'milestones' | 'progress'>): Goal {
    const newGoal: Goal = {
      ...goal,
      id: `goal_${Date.now()}`,
      milestones: [],
      progress: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.goals.push(newGoal);
    this.saveData();
    this.emit('goal:added', newGoal);
    logger.info('Goal added', { id: newGoal.id, title: newGoal.title });
    
    return newGoal;
  }

  /**
   * Update goal progress
   */
  updateGoalProgress(goalId: string, progress: number): void {
    const goal = this.goals.find(g => g.id === goalId);
    if (!goal) return;

    goal.progress = clamp100(progress);
    goal.updatedAt = new Date().toISOString();

    if (goal.progress === 100 && !goal.completedAt) {
      goal.completedAt = new Date().toISOString();
      this.emit('goal:completed', goal);
      logger.info('Goal completed!', { id: goal.id, title: goal.title });
    }

    this.saveData();
    this.emit('goal:updated', goal);
  }

  /**
   * Add a new habit
   */
  addHabit(habit: Omit<Habit, 'id' | 'createdAt' | 'currentStreak' | 'longestStreak' | 'completions' | 'active'>): Habit {
    const newHabit: Habit = {
      ...habit,
      id: `habit_${Date.now()}`,
      currentStreak: 0,
      longestStreak: 0,
      completions: [],
      createdAt: new Date().toISOString(),
      active: true,
    };

    this.habits.push(newHabit);
    this.saveData();
    this.emit('habit:added', newHabit);
    logger.info('Habit added', { id: newHabit.id, title: newHabit.title });
    
    return newHabit;
  }

  /**
   * Mark habit as complete for today
   */
  completeHabit(habitId: string, note?: string): void {
    const habit = this.habits.find(h => h.id === habitId);
    if (!habit) return;

    const today = isoDate();
    const existingCompletion = habit.completions.find(c => c.date === today);

    if (existingCompletion) {
      existingCompletion.completed = true;
      existingCompletion.note = note;
    } else {
      habit.completions.push({
        date: today,
        completed: true,
        note,
      });
    }

    // Update streak
    this.updateHabitStreak(habit);

    this.saveData();
    this.emit('habit:completed', habit);
    logger.info('Habit completed', { 
      id: habit.id, 
      title: habit.title, 
      streak: habit.currentStreak 
    });
  }

  /**
   * Update habit streak
   */
  private updateHabitStreak(habit: Habit): void {
    // Sort completions by date descending
    const sortedCompletions = habit.completions
      .filter(c => c.completed)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    if (sortedCompletions.length === 0) {
      habit.currentStreak = 0;
      return;
    }

    // Count consecutive days
    let streak = 1;
    for (let i = 1; i < sortedCompletions.length; i++) {
      const current = new Date(sortedCompletions[i - 1].date);
      const previous = new Date(sortedCompletions[i].date);
      const diffDays = Math.round((current.getTime() - previous.getTime()) / (1000 * 60 * 60 * 24));
      
      if (diffDays === 1) {
        streak++;
      } else {
        break;
      }
    }

    habit.currentStreak = streak;
    habit.longestStreak = Math.max(habit.longestStreak, streak);
  }

  /**
   * Get all goals
   */
  getGoals(): Goal[] {
    return [...this.goals];
  }

  /**
   * Get all habits
   */
  getHabits(): Habit[] {
    return [...this.habits];
  }

  /**
   * Get progress summary
   */
  getProgressSummary(): {
    goalsCompleted: number;
    goalsInProgress: number;
    habitsCompletedToday: number;
    habitsTotalToday: number;
    longestStreak: number;
  } {
    const today = isoDate();
    const todayHabits = this.habits.filter(h => h.active);
    const completedToday = todayHabits.filter(h => 
      h.completions.some(c => c.date === today && c.completed)
    );

    const longestStreak = Math.max(0, ...this.habits.map(h => h.longestStreak));

    return {
      goalsCompleted: count(this.goals, g => g.completedAt !== undefined),
      goalsInProgress: count(this.goals, g => !g.completedAt),
      habitsCompletedToday: completedToday.length,
      habitsTotalToday: todayHabits.length,
      longestStreak,
    };
  }

  /**
   * Schedule morning briefing
   */
  private scheduleBriefing(): void {
    if (!this.config.enableMorningBriefing) return;

    if (this.briefingTimer) {
      clearTimeout(this.briefingTimer);
    }

    const now = new Date();
    const [hours, minutes] = this.config.briefingTime.split(':').map(Number);
    const briefingTime = new Date(now);
    briefingTime.setHours(hours, minutes, 0, 0);

    // If time has passed today, schedule for tomorrow
    if (briefingTime <= now) {
      briefingTime.setDate(briefingTime.getDate() + 1);
    }

    const delay = briefingTime.getTime() - now.getTime();
    
    this.briefingTimer = setTimeout(async () => {
      const briefing = await this.generateDailyBriefing();
      this.emit('briefing:ready', briefing);
      this.scheduleBriefing(); // Schedule next
    }, delay);

    logger.debug('Briefing scheduled', { 
      time: briefingTime.toISOString(),
      delayMs: delay 
    });
  }

  /**
   * Schedule progress check-ins
   */
  private scheduleCheckins(): void {
    if (!this.config.enableProgressCheckins) return;

    if (this.checkinTimer) {
      clearInterval(this.checkinTimer);
    }

    const intervalMs = this.config.checkinIntervalHours * 60 * 60 * 1000;
    
    this.checkinTimer = setInterval(() => {
      this.performCheckin();
    }, intervalMs);

    logger.debug('Check-ins scheduled', { 
      intervalHours: this.config.checkinIntervalHours 
    });
  }

  /**
   * Perform a progress check-in
   */
  private async performCheckin(): Promise<void> {
    const summary = this.getProgressSummary();
    
    // Only check in during reasonable hours
    const hour = new Date().getHours();
    if (hour < 9 || hour > 21) return;

    this.emit('checkin:due', summary);
    logger.debug('Check-in triggered', summary);
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<LifeCoachConfig>): void {
    this.config = { ...this.config, ...config };
    this.saveData();
    
    // Reschedule if timing changed
    if (config.briefingTime || config.enableMorningBriefing !== undefined) {
      this.scheduleBriefing();
    }
    if (config.checkinIntervalHours || config.enableProgressCheckins !== undefined) {
      this.scheduleCheckins();
    }

    logger.info('Config updated', config);
  }

  /**
   * Ensure data directory exists
   */
  private ensureDataDir(): void {
    if (!fs.existsSync(this.dataPath)) {
      fs.mkdirSync(this.dataPath, { recursive: true });
    }
  }

  /**
   * Save data to disk
   */
  private saveData(): void {
    try {
      const data = {
        goals: this.goals,
        habits: this.habits,
        config: this.config,
      };
      fs.writeFileSync(
        path.join(this.dataPath, 'data.json'),
        JSON.stringify(data, null, 2)
      );
    } catch (error) {
      logger.error('Failed to save data', error);
    }
  }

  /**
   * Load data from disk
   */
  private loadData(): void {
    try {
      const filePath = path.join(this.dataPath, 'data.json');
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        this.goals = data.goals || [];
        this.habits = data.habits || [];
        this.config = { ...this.config, ...data.config };
        logger.info('Data loaded', { 
          goals: this.goals.length, 
          habits: this.habits.length 
        });
      }
    } catch (error) {
      logger.error('Failed to load data', error);
    }
  }

  /**
   * Stop all timers
   */
  stop(): void {
    if (this.briefingTimer) {
      clearTimeout(this.briefingTimer);
      this.briefingTimer = null;
    }
    if (this.checkinTimer) {
      clearInterval(this.checkinTimer);
      this.checkinTimer = null;
    }
    logger.info('Life Coach stopped');
  }
}

// Singleton
let lifeCoach: LifeCoach | null = null;

export function getLifeCoach(): LifeCoach {
  if (!lifeCoach) {
    lifeCoach = new LifeCoach();
  }
  return lifeCoach;
}
