import { useState, useEffect } from 'react';

interface SessionsProps {
  gateway: {
    connected: boolean;
    request: <T>(method: string, params?: Record<string, unknown>) => Promise<T>;
  };
}

interface Session {
  id: string;
  channel: string;
  identifier: string;
  label?: string;
  state: string;
  turnCount: number;
  createdAt: number;
  lastActivityAt: number;
}

export default function Sessions({ gateway }: SessionsProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'active' | 'paused'>('all');

  const fetchSessions = async () => {
    if (!gateway.connected) return;

    try {
      const result = await gateway.request<Session[]>('sessions.list', {
        state: filter === 'all' ? undefined : filter,
      });
      setSessions(result || []);
    } catch (error) {
      console.error('Failed to fetch sessions:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, [gateway.connected, filter]);

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleString();
  };

  if (loading) {
    return <div className="text-gray-500">Loading sessions...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold">Sessions</h2>

        <div className="flex gap-2">
          {(['all', 'active', 'paused'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded ${
                filter === f
                  ? 'bg-atlas-red text-white'
                  : 'bg-atlas-card border border-atlas-border text-gray-400 hover:text-white'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {sessions.length === 0 ? (
        <div className="bg-atlas-card border border-atlas-border rounded-lg p-8 text-center">
          <p className="text-gray-500">No sessions found</p>
        </div>
      ) : (
        <div className="bg-atlas-card border border-atlas-border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="text-left text-gray-500 border-b border-atlas-border">
                <th className="p-4">ID</th>
                <th className="p-4">Channel</th>
                <th className="p-4">Label</th>
                <th className="p-4">State</th>
                <th className="p-4">Turns</th>
                <th className="p-4">Last Activity</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr
                  key={session.id}
                  className="border-b border-atlas-border/50 hover:bg-white/5"
                >
                  <td className="p-4 font-mono text-sm">
                    {session.id.substring(0, 8)}
                  </td>
                  <td className="p-4">{session.channel}</td>
                  <td className="p-4">
                    {session.label || session.identifier.substring(0, 16)}
                  </td>
                  <td className="p-4">
                    <span
                      className={`px-2 py-1 rounded text-xs ${
                        session.state === 'active'
                          ? 'bg-green-500/20 text-green-400'
                          : session.state === 'paused'
                          ? 'bg-yellow-500/20 text-yellow-400'
                          : 'bg-gray-500/20 text-gray-400'
                      }`}
                    >
                      {session.state}
                    </span>
                  </td>
                  <td className="p-4">{session.turnCount}</td>
                  <td className="p-4 text-gray-400 text-sm">
                    {formatTime(session.lastActivityAt)}
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
