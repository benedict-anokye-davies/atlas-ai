import { useState, useEffect } from 'react';

interface PairingProps {
  gateway: {
    connected: boolean;
    request: <T>(method: string, params?: Record<string, unknown>) => Promise<T>;
  };
}

interface PairingRequest {
  id: string;
  channel: string;
  senderId: string;
  senderName?: string;
  firstMessage?: string;
  createdAt: number;
}

export default function Pairing({ gateway }: PairingProps) {
  const [requests, setRequests] = useState<PairingRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRequests = async () => {
    if (!gateway.connected) return;

    try {
      const result = await gateway.request<PairingRequest[]>('pairing.list');
      setRequests(result || []);
    } catch (error) {
      console.error('Failed to fetch pairing requests:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
  }, [gateway.connected]);

  const handleApprove = async (id: string) => {
    try {
      await gateway.request('pairing.approve', { id });
      await fetchRequests();
    } catch (error) {
      alert(`Failed to approve: ${(error as Error).message}`);
    }
  };

  const handleDeny = async (id: string) => {
    try {
      await gateway.request('pairing.deny', { id });
      await fetchRequests();
    } catch (error) {
      alert(`Failed to deny: ${(error as Error).message}`);
    }
  };

  const handleBlock = async (id: string) => {
    if (!confirm('Are you sure you want to block this sender?')) return;

    try {
      await gateway.request('pairing.block', { id });
      await fetchRequests();
    } catch (error) {
      alert(`Failed to block: ${(error as Error).message}`);
    }
  };

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleString();
  };

  if (loading) {
    return <div className="text-gray-500">Loading pairing requests...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold">DM Pairing</h2>
        <button
          onClick={fetchRequests}
          className="px-4 py-2 bg-atlas-card border border-atlas-border rounded-lg hover:bg-white/5"
        >
          Refresh
        </button>
      </div>

      {requests.length === 0 ? (
        <div className="bg-atlas-card border border-atlas-border rounded-lg p-8 text-center">
          <p className="text-gray-500">No pending pairing requests</p>
          <p className="text-gray-600 text-sm mt-2">
            When someone sends a DM to Atlas on a messaging channel,
            they'll appear here for approval.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {requests.map((request) => (
            <div
              key={request.id}
              className="bg-atlas-card border border-atlas-border rounded-lg p-4"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-xs">
                      {request.channel}
                    </span>
                    <span className="text-gray-500 text-sm">
                      {formatTime(request.createdAt)}
                    </span>
                  </div>

                  <h3 className="font-medium mb-1">
                    {request.senderName || request.senderId}
                  </h3>

                  {request.firstMessage && (
                    <p className="text-gray-400 text-sm italic">
                      "{request.firstMessage.substring(0, 100)}..."
                    </p>
                  )}

                  <p className="text-gray-600 text-xs mt-2">
                    ID: {request.senderId}
                  </p>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => handleApprove(request.id)}
                    className="px-4 py-2 bg-green-500/10 text-green-400 border border-green-500/30 rounded-lg hover:bg-green-500/20"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => handleDeny(request.id)}
                    className="px-4 py-2 bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 rounded-lg hover:bg-yellow-500/20"
                  >
                    Deny
                  </button>
                  <button
                    onClick={() => handleBlock(request.id)}
                    className="px-4 py-2 bg-red-500/10 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/20"
                  >
                    Block
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
