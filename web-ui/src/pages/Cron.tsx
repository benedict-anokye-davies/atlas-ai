import { useState, useEffect } from 'react';

interface CronProps {
  gateway: {
    connected: boolean;
    request: <T>(method: string, params?: Record<string, unknown>) => Promise<T>;
  };
}

interface Task {
  id: string;
  name: string;
  cron?: string;
  state: string;
  nextRunAt?: number;
  lastRunAt?: number;
  runCount: number;
}

export default function Cron({ gateway }: CronProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTasks = async () => {
    if (!gateway.connected) return;

    try {
      const result = await gateway.request<Task[]>('cron.list');
      setTasks(result || []);
    } catch (error) {
      console.error('Failed to fetch tasks:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, [gateway.connected]);

  const handlePause = async (id: string) => {
    try {
      await gateway.request('cron.pause', { id });
      await fetchTasks();
    } catch (error) {
      alert(`Failed to pause: ${(error as Error).message}`);
    }
  };

  const handleResume = async (id: string) => {
    try {
      await gateway.request('cron.resume', { id });
      await fetchTasks();
    } catch (error) {
      alert(`Failed to resume: ${(error as Error).message}`);
    }
  };

  const handleCancel = async (id: string) => {
    if (!confirm('Are you sure you want to cancel this task?')) return;

    try {
      await gateway.request('cron.cancel', { id });
      await fetchTasks();
    } catch (error) {
      alert(`Failed to cancel: ${(error as Error).message}`);
    }
  };

  const formatTime = (ts?: number) => {
    if (!ts) return '-';
    return new Date(ts).toLocaleString();
  };

  if (loading) {
    return <div className="text-gray-500">Loading scheduled tasks...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold">Scheduled Tasks</h2>
        <button
          onClick={fetchTasks}
          className="px-4 py-2 bg-atlas-card border border-atlas-border rounded-lg hover:bg-white/5"
        >
          Refresh
        </button>
      </div>

      {tasks.length === 0 ? (
        <div className="bg-atlas-card border border-atlas-border rounded-lg p-8 text-center">
          <p className="text-gray-500">No scheduled tasks</p>
          <p className="text-gray-600 text-sm mt-2">
            Use the CLI or API to schedule tasks.
          </p>
        </div>
      ) : (
        <div className="bg-atlas-card border border-atlas-border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="text-left text-gray-500 border-b border-atlas-border">
                <th className="p-4">Name</th>
                <th className="p-4">Schedule</th>
                <th className="p-4">State</th>
                <th className="p-4">Next Run</th>
                <th className="p-4">Runs</th>
                <th className="p-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr
                  key={task.id}
                  className="border-b border-atlas-border/50 hover:bg-white/5"
                >
                  <td className="p-4">
                    <div>
                      <p className="font-medium">{task.name}</p>
                      <p className="text-gray-500 text-xs">{task.id.substring(0, 8)}</p>
                    </div>
                  </td>
                  <td className="p-4 font-mono text-sm">
                    {task.cron || 'One-time'}
                  </td>
                  <td className="p-4">
                    <span
                      className={`px-2 py-1 rounded text-xs ${
                        task.state === 'active'
                          ? 'bg-green-500/20 text-green-400'
                          : task.state === 'paused'
                          ? 'bg-yellow-500/20 text-yellow-400'
                          : task.state === 'completed'
                          ? 'bg-blue-500/20 text-blue-400'
                          : 'bg-gray-500/20 text-gray-400'
                      }`}
                    >
                      {task.state}
                    </span>
                  </td>
                  <td className="p-4 text-gray-400 text-sm">
                    {formatTime(task.nextRunAt)}
                  </td>
                  <td className="p-4">{task.runCount}</td>
                  <td className="p-4">
                    <div className="flex gap-2">
                      {task.state === 'active' && (
                        <button
                          onClick={() => handlePause(task.id)}
                          className="px-3 py-1 text-sm bg-yellow-500/10 text-yellow-400 rounded hover:bg-yellow-500/20"
                        >
                          Pause
                        </button>
                      )}
                      {task.state === 'paused' && (
                        <button
                          onClick={() => handleResume(task.id)}
                          className="px-3 py-1 text-sm bg-green-500/10 text-green-400 rounded hover:bg-green-500/20"
                        >
                          Resume
                        </button>
                      )}
                      <button
                        onClick={() => handleCancel(task.id)}
                        className="px-3 py-1 text-sm bg-red-500/10 text-red-400 rounded hover:bg-red-500/20"
                      >
                        Cancel
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
