/**
 * DashboardLayout - Main AGNT-style dashboard grid layout
 * Centers the orb with surrounding panels for metrics, goals, workflows, etc.
 */

import { useEffect, useState, useCallback } from 'react';
import { useDashboardStore } from '../../stores/dashboardStore';
import { MetricsBar } from './MetricsBar';
import { OrbZone } from './OrbZone';
import { LeftSidebar } from './LeftSidebar';
import { RightSidebar } from './RightSidebar';
import { BottomPanel } from './BottomPanel';
import { WorkflowBuilder } from './WorkflowBuilder';
import { BrainExplorer, BrainMiniWidget } from '../brain';
import './dashboard.css';

// Helper function to get node color by type
function getNodeColor(type: string): string {
  const colors: Record<string, string> = {
    fact: '#00D4FF',
    preference: '#00FF88',
    entity: '#FFD700',
    concept: '#FF6B6B',
    memory: '#9B59B6',
    knowledge: '#3498DB',
    skill: '#E74C3C',
    person: '#F39C12',
    place: '#1ABC9C',
    event: '#E91E63',
    task: '#00BCD4',
    self: '#FF4444',
  };
  return colors[type] || '#00D4FF';
}

interface DashboardLayoutProps {
  children?: React.ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const {
    view,
    setView,
    initialize,
    isLoading,
    leftSidebarCollapsed,
    rightSidebarCollapsed,
    bottomPanelCollapsed,
  } = useDashboardStore();

  // Brain visualization state
  const [brainNodes, setBrainNodes] = useState<Array<{
    id: string;
    label: string;
    type: string;
    confidence: number;
    size: number;
    color: string;
  }>>([]);
  const [brainEdges, setBrainEdges] = useState<Array<{
    source: string;
    target: string;
    type: string;
    weight: number;
  }>>([]);
  const [activeConcepts, setActiveConcepts] = useState<string[]>([]);

  // Initialize dashboard on mount
  useEffect(() => {
    initialize();
  }, [initialize]);

  // Fetch brain visualization data periodically
  useEffect(() => {
    const fetchBrainData = async () => {
      try {
        const result = await window.atlas?.invoke('brain:get-visualization', { limit: 50 }) as { success?: boolean; data?: { nodes: Array<{ id: string; label: string; type: string; importance: number }>; edges: Array<{ source: string; target: string; type: string; weight: number }> } } | undefined;
        if (result?.success && result.data) {
          const { nodes, edges } = result.data;
          setBrainNodes(nodes.map((n) => ({
            id: n.id,
            label: n.label,
            type: n.type,
            confidence: n.importance,
            size: Math.max(0.1, n.importance * 0.5),
            color: getNodeColor(n.type),
          })));
          setBrainEdges(edges.map((e) => ({
            source: e.source,
            target: e.target,
            type: e.type,
            weight: e.weight,
          })));
        }
      } catch (err) {
        console.error('[Brain] Failed to fetch visualization data:', err);
      }
    };

    fetchBrainData();
    const interval = setInterval(fetchBrainData, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, []);

  // Handle brain node click
  const handleBrainNodeClick = useCallback((nodeId: string) => {
    setActiveConcepts(prev => 
      prev.includes(nodeId) 
        ? prev.filter(id => id !== nodeId)
        : [...prev, nodeId]
    );
  }, []);

  // Handle expanding to full brain explorer
  const handleExpandBrain = useCallback(() => {
    setView('brain-explorer');
  }, [setView]);

  // Handle closing brain explorer
  const handleCloseBrainExplorer = useCallback(() => {
    setView('dashboard');
  }, [setView]);

  // Orb-only mode - just render the orb
  if (view === 'orb-only') {
    return (
      <div className="dashboard-orb-only">
        <OrbZone />
      </div>
    );
  }

  // Workflow builder mode
  if (view === 'workflow-builder') {
    return <WorkflowBuilder />;
  }

  // Brain explorer mode
  if (view === 'brain-explorer') {
    return (
      <BrainExplorer
        nodes={brainNodes}
        edges={brainEdges}
        onClose={handleCloseBrainExplorer}
        theme="jarvis"
      />
    );
  }

  return (
    <div
      className={`dashboard-layout ${isLoading ? 'loading' : ''}`}
      data-left-collapsed={leftSidebarCollapsed}
      data-right-collapsed={rightSidebarCollapsed}
      data-bottom-collapsed={bottomPanelCollapsed}
    >
      {/* Top Metrics Bar */}
      <header className="dashboard-header">
        <MetricsBar />
      </header>

      {/* Main Content Area */}
      <div className="dashboard-content">
        {/* Left Sidebar - Goals Map */}
        <aside
          className={`dashboard-sidebar dashboard-sidebar-left ${leftSidebarCollapsed ? 'collapsed' : ''}`}
        >
          <LeftSidebar />
        </aside>

        {/* Center - Orb Zone */}
        <main className="dashboard-main">
          <OrbZone />
        </main>

        {/* Right Sidebar - Workflows & Integrations */}
        <aside
          className={`dashboard-sidebar dashboard-sidebar-right ${rightSidebarCollapsed ? 'collapsed' : ''}`}
        >
          <RightSidebar />
        </aside>
      </div>

      {/* Bottom Panel - Agents Swarm & Run Stats */}
      <footer className={`dashboard-footer ${bottomPanelCollapsed ? 'collapsed' : ''}`}>
        <BottomPanel />
      </footer>

      {/* Brain Mini Widget - Bottom Right Corner */}
      {brainNodes.length > 0 && (
        <div className="brain-mini-container">
          <BrainMiniWidget
            nodes={brainNodes}
            edges={brainEdges}
            isActive={activeConcepts.length > 0}
            activeConcepts={activeConcepts}
            theme="jarvis"
            onNodeClick={handleBrainNodeClick}
            onExpand={handleExpandBrain}
          />
        </div>
      )}

      {/* Additional children (modals, overlays, etc.) */}
      {children}
    </div>
  );
}

export default DashboardLayout;
