/**
 * Life Coach Dashboard - Goals, habits, and daily briefings
 */

import React, { useState, useEffect, useCallback } from 'react';
import './LifeCoachDashboard.css';

interface Goal {
  id: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  deadline?: string;
  progress: number;
  completedAt?: string;
}

interface Habit {
  id: string;
  title: string;
  description?: string;
  category: string;
  frequency: string;
  currentStreak: number;
  longestStreak: number;
  active: boolean;
}

interface DailyBriefing {
  greeting: string;
  motivationalMessage: string;
  todaysGoals: string[];
  habitReminders: string[];
  upcomingDeadlines: Array<{ title: string; daysLeft: number }>;
  productivityTip?: string;
}

interface ProgressSummary {
  goalsCompleted: number;
  goalsInProgress: number;
  habitsCompletedToday: number;
  habitsTotalToday: number;
  longestStreak: number;
}

interface LifeCoachDashboardProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LifeCoachDashboard: React.FC<LifeCoachDashboardProps> = ({
  isOpen,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'briefing' | 'goals' | 'habits'>('briefing');
  const [briefing, setBriefing] = useState<DailyBriefing | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [progress, setProgress] = useState<ProgressSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New goal/habit form state
  const [showGoalForm, setShowGoalForm] = useState(false);
  const [showHabitForm, setShowHabitForm] = useState(false);
  const [newGoal, setNewGoal] = useState({
    title: '',
    description: '',
    category: 'productivity',
    priority: 'medium',
    deadline: '',
  });
  const [newHabit, setNewHabit] = useState({
    title: '',
    description: '',
    category: 'productivity',
    frequency: 'daily',
    targetDays: 7,
  });

  // Get API safely
  const getApi = useCallback(() => {
    const atlasAny = window.atlas as unknown as Record<string, unknown>;
    return atlasAny?.lifeCoach as {
      getBriefing?: () => Promise<{ success: boolean; data?: DailyBriefing; error?: string }>;
      getGoals?: () => Promise<{ success: boolean; data?: Goal[]; error?: string }>;
      getHabits?: () => Promise<{ success: boolean; data?: Habit[]; error?: string }>;
      getProgress?: () => Promise<{ success: boolean; data?: ProgressSummary; error?: string }>;
      addGoal?: (goal: typeof newGoal) => Promise<{ success: boolean; data?: Goal; error?: string }>;
      addHabit?: (habit: typeof newHabit) => Promise<{ success: boolean; data?: Habit; error?: string }>;
      completeHabit?: (id: string) => Promise<{ success: boolean; error?: string }>;
      updateGoalProgress?: (id: string, progress: number) => Promise<{ success: boolean; error?: string }>;
    } | undefined;
  }, []);

  // Load all data
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const api = getApi();
      
      if (!api) {
        // Use mock data if API not available
        setBriefing({
          greeting: 'Good morning!',
          motivationalMessage: 'Every step forward counts. Keep building momentum!',
          todaysGoals: ['Complete feature implementation', 'Review code'],
          habitReminders: ['Exercise', 'Read for 30 minutes'],
          upcomingDeadlines: [{ title: 'Project deadline', daysLeft: 3 }],
          productivityTip: 'Try the 2-minute rule: If it takes less than 2 minutes, do it now.',
        });
        setGoals([
          {
            id: '1',
            title: 'Learn TypeScript',
            description: 'Master TypeScript for better code quality',
            category: 'learning',
            priority: 'high',
            progress: 65,
          },
        ]);
        setHabits([
          {
            id: '1',
            title: 'Morning exercise',
            category: 'health',
            frequency: 'daily',
            currentStreak: 5,
            longestStreak: 14,
            active: true,
          },
        ]);
        setProgress({
          goalsCompleted: 2,
          goalsInProgress: 3,
          habitsCompletedToday: 1,
          habitsTotalToday: 3,
          longestStreak: 14,
        });
        return;
      }

      const [briefingRes, goalsRes, habitsRes, progressRes] = await Promise.all([
        api.getBriefing?.() || Promise.resolve({ success: false } as { success: boolean; data?: DailyBriefing }),
        api.getGoals?.() || Promise.resolve({ success: false } as { success: boolean; data?: Goal[] }),
        api.getHabits?.() || Promise.resolve({ success: false } as { success: boolean; data?: Habit[] }),
        api.getProgress?.() || Promise.resolve({ success: false } as { success: boolean; data?: ProgressSummary }),
      ]);

      if (briefingRes.success && briefingRes.data) setBriefing(briefingRes.data);
      if (goalsRes.success && goalsRes.data) setGoals(goalsRes.data);
      if (habitsRes.success && habitsRes.data) setHabits(habitsRes.data);
      if (progressRes.success && progressRes.data) setProgress(progressRes.data);

    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [getApi]);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, loadData]);

  // Add new goal
  const handleAddGoal = async () => {
    const api = getApi();
    if (api?.addGoal && newGoal.title) {
      const result = await api.addGoal(newGoal);
      if (result.success && result.data) {
        setGoals([...goals, result.data]);
        setNewGoal({ title: '', description: '', category: 'productivity', priority: 'medium', deadline: '' });
        setShowGoalForm(false);
      }
    }
  };

  // Add new habit
  const handleAddHabit = async () => {
    const api = getApi();
    if (api?.addHabit && newHabit.title) {
      const result = await api.addHabit(newHabit);
      if (result.success && result.data) {
        setHabits([...habits, result.data]);
        setNewHabit({ title: '', description: '', category: 'productivity', frequency: 'daily', targetDays: 7 });
        setShowHabitForm(false);
      }
    }
  };

  // Complete habit
  const handleCompleteHabit = async (habitId: string) => {
    const api = getApi();
    if (api?.completeHabit) {
      const result = await api.completeHabit(habitId);
      if (result.success) {
        loadData(); // Refresh data
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="life-coach-overlay" onClick={onClose}>
      <div className="life-coach-dashboard" onClick={e => e.stopPropagation()}>
        <div className="life-coach-header">
          <h2>Life Coach</h2>
          <button className="close-button" onClick={onClose}>x</button>
        </div>

        {/* Progress summary */}
        {progress && (
          <div className="progress-summary">
            <div className="progress-stat">
              <span className="stat-value">{progress.goalsInProgress}</span>
              <span className="stat-label">Active Goals</span>
            </div>
            <div className="progress-stat">
              <span className="stat-value">{progress.habitsCompletedToday}/{progress.habitsTotalToday}</span>
              <span className="stat-label">Habits Today</span>
            </div>
            <div className="progress-stat">
              <span className="stat-value">{progress.longestStreak}</span>
              <span className="stat-label">Longest Streak</span>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="life-coach-tabs">
          <button
            className={`tab ${activeTab === 'briefing' ? 'active' : ''}`}
            onClick={() => setActiveTab('briefing')}
          >
            Daily Briefing
          </button>
          <button
            className={`tab ${activeTab === 'goals' ? 'active' : ''}`}
            onClick={() => setActiveTab('goals')}
          >
            Goals
          </button>
          <button
            className={`tab ${activeTab === 'habits' ? 'active' : ''}`}
            onClick={() => setActiveTab('habits')}
          >
            Habits
          </button>
        </div>

        <div className="life-coach-content">
          {loading && <div className="loading">Loading...</div>}
          {error && <div className="error">{error}</div>}

          {/* Daily Briefing Tab */}
          {activeTab === 'briefing' && briefing && (
            <div className="briefing-content">
              <div className="greeting">{briefing.greeting}</div>
              <div className="motivation">{briefing.motivationalMessage}</div>
              
              {briefing.todaysGoals.length > 0 && (
                <div className="briefing-section">
                  <h4>Focus Areas</h4>
                  <ul>
                    {briefing.todaysGoals.map((goal, i) => (
                      <li key={i}>{goal}</li>
                    ))}
                  </ul>
                </div>
              )}

              {briefing.habitReminders.length > 0 && (
                <div className="briefing-section">
                  <h4>Habit Reminders</h4>
                  <ul>
                    {briefing.habitReminders.map((habit, i) => (
                      <li key={i}>{habit}</li>
                    ))}
                  </ul>
                </div>
              )}

              {briefing.upcomingDeadlines.length > 0 && (
                <div className="briefing-section deadlines">
                  <h4>Upcoming Deadlines</h4>
                  <ul>
                    {briefing.upcomingDeadlines.map((d, i) => (
                      <li key={i} className={d.daysLeft <= 2 ? 'urgent' : ''}>
                        {d.title} - {d.daysLeft} day{d.daysLeft !== 1 ? 's' : ''} left
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {briefing.productivityTip && (
                <div className="briefing-section tip">
                  <h4>Productivity Tip</h4>
                  <p>{briefing.productivityTip}</p>
                </div>
              )}
            </div>
          )}

          {/* Goals Tab */}
          {activeTab === 'goals' && (
            <div className="goals-content">
              <button className="add-button" onClick={() => setShowGoalForm(!showGoalForm)}>
                + Add Goal
              </button>

              {showGoalForm && (
                <div className="form">
                  <input
                    type="text"
                    placeholder="Goal title"
                    value={newGoal.title}
                    onChange={e => setNewGoal({ ...newGoal, title: e.target.value })}
                  />
                  <textarea
                    placeholder="Description"
                    value={newGoal.description}
                    onChange={e => setNewGoal({ ...newGoal, description: e.target.value })}
                  />
                  <select
                    value={newGoal.category}
                    onChange={e => setNewGoal({ ...newGoal, category: e.target.value })}
                  >
                    <option value="productivity">Productivity</option>
                    <option value="health">Health</option>
                    <option value="learning">Learning</option>
                    <option value="social">Social</option>
                    <option value="financial">Financial</option>
                    <option value="personal">Personal</option>
                  </select>
                  <select
                    value={newGoal.priority}
                    onChange={e => setNewGoal({ ...newGoal, priority: e.target.value })}
                  >
                    <option value="high">High Priority</option>
                    <option value="medium">Medium Priority</option>
                    <option value="low">Low Priority</option>
                  </select>
                  <input
                    type="date"
                    value={newGoal.deadline}
                    onChange={e => setNewGoal({ ...newGoal, deadline: e.target.value })}
                  />
                  <button onClick={handleAddGoal}>Save Goal</button>
                </div>
              )}

              <div className="goals-list">
                {goals.filter(g => !g.completedAt).map(goal => (
                  <div key={goal.id} className={`goal-card priority-${goal.priority}`}>
                    <div className="goal-header">
                      <h4>{goal.title}</h4>
                      <span className={`category ${goal.category}`}>{goal.category}</span>
                    </div>
                    {goal.description && <p>{goal.description}</p>}
                    <div className="progress-bar">
                      <div
                        className="progress-fill"
                        style={{ width: `${goal.progress}%` }}
                      />
                    </div>
                    <span className="progress-text">{goal.progress}%</span>
                    {goal.deadline && (
                      <span className="deadline">Due: {new Date(goal.deadline).toLocaleDateString()}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Habits Tab */}
          {activeTab === 'habits' && (
            <div className="habits-content">
              <button className="add-button" onClick={() => setShowHabitForm(!showHabitForm)}>
                + Add Habit
              </button>

              {showHabitForm && (
                <div className="form">
                  <input
                    type="text"
                    placeholder="Habit title"
                    value={newHabit.title}
                    onChange={e => setNewHabit({ ...newHabit, title: e.target.value })}
                  />
                  <textarea
                    placeholder="Description (optional)"
                    value={newHabit.description}
                    onChange={e => setNewHabit({ ...newHabit, description: e.target.value })}
                  />
                  <select
                    value={newHabit.category}
                    onChange={e => setNewHabit({ ...newHabit, category: e.target.value })}
                  >
                    <option value="productivity">Productivity</option>
                    <option value="health">Health</option>
                    <option value="learning">Learning</option>
                    <option value="mindfulness">Mindfulness</option>
                    <option value="social">Social</option>
                  </select>
                  <select
                    value={newHabit.frequency}
                    onChange={e => setNewHabit({ ...newHabit, frequency: e.target.value })}
                  >
                    <option value="daily">Daily</option>
                    <option value="weekdays">Weekdays</option>
                    <option value="weekends">Weekends</option>
                    <option value="weekly">Weekly</option>
                  </select>
                  <button onClick={handleAddHabit}>Save Habit</button>
                </div>
              )}

              <div className="habits-list">
                {habits.filter(h => h.active).map(habit => (
                  <div key={habit.id} className="habit-card">
                    <div className="habit-info">
                      <h4>{habit.title}</h4>
                      <div className="habit-meta">
                        <span className={`category ${habit.category}`}>{habit.category}</span>
                        <span className="frequency">{habit.frequency}</span>
                      </div>
                      <div className="streak-info">
                        <span className="current-streak">Current: {habit.currentStreak} days</span>
                        <span className="best-streak">Best: {habit.longestStreak} days</span>
                      </div>
                    </div>
                    <button
                      className="complete-button"
                      onClick={() => handleCompleteHabit(habit.id)}
                    >
                      Complete
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LifeCoachDashboard;
