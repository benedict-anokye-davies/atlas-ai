import { Routes, Route, NavLink } from 'react-router-dom';
import { useGateway } from './hooks/useGateway';
import Dashboard from './pages/Dashboard';
import Channels from './pages/Channels';
import Sessions from './pages/Sessions';
import Pairing from './pages/Pairing';
import Cron from './pages/Cron';
import Nodes from './pages/Nodes';
import Skills from './pages/Skills';

function App() {
  const gateway = useGateway();

  return (
    <div className="min-h-screen bg-atlas-dark flex">
      {/* Sidebar */}
      <nav className="w-64 bg-atlas-card border-r border-atlas-border p-4 flex flex-col">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-atlas-red">Atlas</h1>
          <p className="text-sm text-gray-500">Gateway Dashboard</p>
        </div>

        <div className="flex-1 space-y-1">
          <NavItem to="/" label="Dashboard" icon="📊" />
          <NavItem to="/channels" label="Channels" icon="💬" />
          <NavItem to="/sessions" label="Sessions" icon="🗣️" />
          <NavItem to="/pairing" label="Pairing" icon="🔐" />
          <NavItem to="/cron" label="Scheduled" icon="⏰" />
          <NavItem to="/nodes" label="Nodes" icon="📱" />
          <NavItem to="/skills" label="Skills" icon="🧩" />
        </div>

        {/* Connection status */}
        <div className="pt-4 border-t border-atlas-border">
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                gateway.connected ? 'bg-green-500' : 'bg-red-500'
              }`}
            />
            <span className="text-sm text-gray-400">
              {gateway.connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
          {gateway.health && (
            <p className="text-xs text-gray-500 mt-1">
              {gateway.health.clients.total} client(s)
            </p>
          )}
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 p-6 overflow-auto">
        {gateway.error && (
          <div className="mb-4 p-4 bg-red-900/20 border border-red-500/50 rounded-lg">
            <p className="text-red-400">{gateway.error}</p>
          </div>
        )}

        <Routes>
          <Route path="/" element={<Dashboard gateway={gateway} />} />
          <Route path="/channels" element={<Channels gateway={gateway} />} />
          <Route path="/sessions" element={<Sessions gateway={gateway} />} />
          <Route path="/pairing" element={<Pairing gateway={gateway} />} />
          <Route path="/cron" element={<Cron gateway={gateway} />} />
          <Route path="/nodes" element={<Nodes gateway={gateway} />} />
          <Route path="/skills" element={<Skills gateway={gateway} />} />
        </Routes>
      </main>
    </div>
  );
}

function NavItem({ to, label, icon }: { to: string; label: string; icon: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
          isActive
            ? 'bg-atlas-red/10 text-atlas-red'
            : 'text-gray-400 hover:text-white hover:bg-white/5'
        }`
      }
    >
      <span>{icon}</span>
      <span>{label}</span>
    </NavLink>
  );
}

export default App;
