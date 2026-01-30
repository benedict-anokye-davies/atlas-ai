import { useState, useEffect } from 'react';

interface NodesProps {
  gateway: {
    connected: boolean;
    request: <T>(method: string, params?: Record<string, unknown>) => Promise<T>;
  };
}

interface Node {
  id: string;
  name?: string;
  platform?: string;
  capabilities: string[];
  pairingStatus: string;
  connectedAt: number;
}

const CAPABILITY_ICONS: Record<string, string> = {
  canvas: '🎨',
  camera: '📷',
  screen: '🖥️',
  location: '📍',
  notifications: '🔔',
  'system.run': '⚙️',
  sms: '📱',
};

export default function Nodes({ gateway }: NodesProps) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNodes = async () => {
    if (!gateway.connected) return;

    try {
      const result = await gateway.request<Node[]>('nodes.list');
      setNodes(result || []);
    } catch (error) {
      console.error('Failed to fetch nodes:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNodes();
  }, [gateway.connected]);

  const handleApprove = async (id: string) => {
    try {
      await gateway.request('node.approve', { nodeId: id });
      await fetchNodes();
    } catch (error) {
      alert(`Failed to approve: ${(error as Error).message}`);
    }
  };

  const handleReject = async (id: string) => {
    try {
      await gateway.request('node.reject', { nodeId: id });
      await fetchNodes();
    } catch (error) {
      alert(`Failed to reject: ${(error as Error).message}`);
    }
  };

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleString();
  };

  if (loading) {
    return <div className="text-gray-500">Loading nodes...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold">Companion Nodes</h2>
        <button
          onClick={fetchNodes}
          className="px-4 py-2 bg-atlas-card border border-atlas-border rounded-lg hover:bg-white/5"
        >
          Refresh
        </button>
      </div>

      {nodes.length === 0 ? (
        <div className="bg-atlas-card border border-atlas-border rounded-lg p-8 text-center">
          <p className="text-gray-500">No nodes connected</p>
          <p className="text-gray-600 text-sm mt-2">
            Companion nodes are mobile devices that extend Atlas's capabilities
            with camera, location, and other features.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {nodes.map((node) => (
            <div
              key={node.id}
              className="bg-atlas-card border border-atlas-border rounded-lg p-4"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="font-medium">{node.name || 'Unknown Device'}</h3>
                  <p className="text-gray-500 text-sm">
                    {node.platform || 'Unknown platform'}
                  </p>
                  <p className="text-gray-600 text-xs mt-1">
                    Connected: {formatTime(node.connectedAt)}
                  </p>
                </div>
                <span
                  className={`px-2 py-1 rounded text-xs ${
                    node.pairingStatus === 'approved'
                      ? 'bg-green-500/20 text-green-400'
                      : node.pairingStatus === 'pending'
                      ? 'bg-yellow-500/20 text-yellow-400'
                      : 'bg-red-500/20 text-red-400'
                  }`}
                >
                  {node.pairingStatus}
                </span>
              </div>

              <div className="mb-4">
                <p className="text-gray-500 text-xs mb-2">Capabilities</p>
                <div className="flex flex-wrap gap-2">
                  {node.capabilities.map((cap) => (
                    <span
                      key={cap}
                      className="px-2 py-1 bg-white/5 rounded text-sm"
                      title={cap}
                    >
                      {CAPABILITY_ICONS[cap] || '❓'} {cap}
                    </span>
                  ))}
                </div>
              </div>

              {node.pairingStatus === 'pending' && (
                <div className="flex gap-2">
                  <button
                    onClick={() => handleApprove(node.id)}
                    className="flex-1 px-4 py-2 bg-green-500/10 text-green-400 border border-green-500/30 rounded-lg hover:bg-green-500/20"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => handleReject(node.id)}
                    className="flex-1 px-4 py-2 bg-red-500/10 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/20"
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
