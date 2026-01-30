import { useState, useEffect } from 'react';

interface ChannelsProps {
  gateway: {
    connected: boolean;
    request: <T>(method: string, params?: Record<string, unknown>) => Promise<T>;
  };
}

const CHANNEL_INFO = {
  telegram: { name: 'Telegram', icon: '✈️', color: 'blue' },
  discord: { name: 'Discord', icon: '🎮', color: 'indigo' },
  whatsapp: { name: 'WhatsApp', icon: '📱', color: 'green' },
  slack: { name: 'Slack', icon: '💼', color: 'purple' },
  desktop: { name: 'Desktop', icon: '🖥️', color: 'gray' },
  webchat: { name: 'WebChat', icon: '🌐', color: 'cyan' },
};

export default function Channels({ gateway }: ChannelsProps) {
  const [connectedChannels, setConnectedChannels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchChannels = async () => {
    if (!gateway.connected) return;

    try {
      const channels = await gateway.request<string[]>('channels.list');
      setConnectedChannels(channels || []);
    } catch (error) {
      console.error('Failed to fetch channels:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchChannels();
  }, [gateway.connected]);

  const handleConnect = async (channel: string) => {
    // In a real implementation, this would show a modal for configuration
    const token = prompt(`Enter ${channel} token:`);
    if (!token) return;

    try {
      await gateway.request('channels.connect', {
        channel,
        config: { token },
      });
      await fetchChannels();
    } catch (error) {
      alert(`Failed to connect: ${(error as Error).message}`);
    }
  };

  const handleDisconnect = async (channel: string) => {
    try {
      await gateway.request('channels.disconnect', { channel });
      await fetchChannels();
    } catch (error) {
      alert(`Failed to disconnect: ${(error as Error).message}`);
    }
  };

  if (loading) {
    return <div className="text-gray-500">Loading channels...</div>;
  }

  return (
    <div>
      <h2 className="text-2xl font-semibold mb-6">Channels</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Object.entries(CHANNEL_INFO).map(([key, info]) => {
          const isConnected = connectedChannels.includes(key);

          return (
            <div
              key={key}
              className="bg-atlas-card border border-atlas-border rounded-lg p-4"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{info.icon}</span>
                  <div>
                    <h3 className="font-medium">{info.name}</h3>
                    <p className="text-sm text-gray-500">
                      {isConnected ? 'Connected' : 'Disconnected'}
                    </p>
                  </div>
                </div>
                <span
                  className={`w-3 h-3 rounded-full ${
                    isConnected ? 'bg-green-500' : 'bg-gray-500'
                  }`}
                />
              </div>

              {isConnected ? (
                <button
                  onClick={() => handleDisconnect(key)}
                  className="w-full px-4 py-2 bg-red-500/10 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/20 transition-colors"
                >
                  Disconnect
                </button>
              ) : (
                <button
                  onClick={() => handleConnect(key)}
                  className="w-full px-4 py-2 bg-atlas-red/10 text-atlas-red border border-atlas-red/30 rounded-lg hover:bg-atlas-red/20 transition-colors"
                >
                  Connect
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
