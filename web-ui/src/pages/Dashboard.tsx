interface DashboardProps {
  gateway: {
    connected: boolean;
    health: {
      status: string;
      uptime: number;
      clients: { total: number; operators: number; nodes: number };
      version: string;
    } | null;
    clients: Array<{
      id: string;
      role: string;
      name?: string;
      platform?: string;
      pairingStatus: string;
    }>;
    refresh: () => Promise<void>;
  };
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export default function Dashboard({ gateway }: DashboardProps) {
  const { health, clients } = gateway;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold">Dashboard</h2>
        <button
          onClick={gateway.refresh}
          className="px-4 py-2 bg-atlas-card border border-atlas-border rounded-lg hover:bg-white/5 transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Status"
          value={health?.status || 'Unknown'}
          color={health?.status === 'healthy' ? 'green' : 'yellow'}
        />
        <StatCard
          label="Uptime"
          value={health ? formatUptime(health.uptime) : '-'}
        />
        <StatCard
          label="Clients"
          value={health?.clients.total.toString() || '0'}
        />
        <StatCard
          label="Version"
          value={health?.version || '-'}
        />
      </div>

      {/* Connected Clients */}
      <div className="bg-atlas-card border border-atlas-border rounded-lg p-4">
        <h3 className="text-lg font-medium mb-4">Connected Clients</h3>

        {clients.length === 0 ? (
          <p className="text-gray-500">No clients connected</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-gray-500 border-b border-atlas-border">
                  <th className="pb-2">ID</th>
                  <th className="pb-2">Role</th>
                  <th className="pb-2">Name</th>
                  <th className="pb-2">Platform</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => (
                  <tr key={client.id} className="border-b border-atlas-border/50">
                    <td className="py-2 font-mono text-sm">
                      {client.id.substring(0, 8)}
                    </td>
                    <td className="py-2">
                      <span
                        className={`px-2 py-1 rounded text-xs ${
                          client.role === 'operator'
                            ? 'bg-blue-500/20 text-blue-400'
                            : client.role === 'node'
                            ? 'bg-purple-500/20 text-purple-400'
                            : 'bg-gray-500/20 text-gray-400'
                        }`}
                      >
                        {client.role}
                      </span>
                    </td>
                    <td className="py-2">{client.name || '-'}</td>
                    <td className="py-2">{client.platform || '-'}</td>
                    <td className="py-2">
                      <span
                        className={`px-2 py-1 rounded text-xs ${
                          client.pairingStatus === 'approved'
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-yellow-500/20 text-yellow-400'
                        }`}
                      >
                        {client.pairingStatus}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color = 'white',
}: {
  label: string;
  value: string;
  color?: 'white' | 'green' | 'yellow' | 'red';
}) {
  const colorClasses = {
    white: 'text-white',
    green: 'text-green-400',
    yellow: 'text-yellow-400',
    red: 'text-red-400',
  };

  return (
    <div className="bg-atlas-card border border-atlas-border rounded-lg p-4">
      <p className="text-gray-500 text-sm mb-1">{label}</p>
      <p className={`text-2xl font-semibold ${colorClasses[color]}`}>{value}</p>
    </div>
  );
}
