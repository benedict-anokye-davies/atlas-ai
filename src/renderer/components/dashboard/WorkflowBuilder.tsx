/**
 * WorkflowBuilder - Visual drag-and-drop workflow editor using ReactFlow
 * Allows users to create automation workflows by connecting trigger, action, and condition nodes
 */

import { useCallback, useState, useMemo } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  BackgroundVariant,
  addEdge,
  Connection,
  useNodesState,
  useEdgesState,
  NodeTypes,
  Panel,
  MarkerType,
  type NodeProps,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useDashboardStore } from '../../stores/dashboardStore';

// ============================================================================
// Node Types
// ============================================================================

type WorkflowNodeType = 'trigger' | 'action' | 'condition' | 'output';

interface WorkflowNodeData {
  label: string;
  type: WorkflowNodeType;
  icon: string;
  description?: string;
  config?: Record<string, unknown>;
}

// ============================================================================
// Custom Node Components
// ============================================================================

function TriggerNode({ data, selected }: NodeProps<WorkflowNodeData>) {
  return (
    <div className={`workflow-node workflow-node-trigger ${selected ? 'selected' : ''}`}>
      <div className="workflow-node-icon">{data.icon}</div>
      <div className="workflow-node-content">
        <span className="workflow-node-label">{data.label}</span>
        {data.description && <span className="workflow-node-desc">{data.description}</span>}
      </div>
      <div className="workflow-node-handle workflow-node-handle-output" />
    </div>
  );
}

function ActionNode({ data, selected }: NodeProps<WorkflowNodeData>) {
  return (
    <div className={`workflow-node workflow-node-action ${selected ? 'selected' : ''}`}>
      <div className="workflow-node-handle workflow-node-handle-input" />
      <div className="workflow-node-icon">{data.icon}</div>
      <div className="workflow-node-content">
        <span className="workflow-node-label">{data.label}</span>
        {data.description && <span className="workflow-node-desc">{data.description}</span>}
      </div>
      <div className="workflow-node-handle workflow-node-handle-output" />
    </div>
  );
}

function ConditionNode({ data, selected }: NodeProps<WorkflowNodeData>) {
  return (
    <div className={`workflow-node workflow-node-condition ${selected ? 'selected' : ''}`}>
      <div className="workflow-node-handle workflow-node-handle-input" />
      <div className="workflow-node-icon">{data.icon}</div>
      <div className="workflow-node-content">
        <span className="workflow-node-label">{data.label}</span>
        {data.description && <span className="workflow-node-desc">{data.description}</span>}
      </div>
      <div className="workflow-node-handle workflow-node-handle-output-true" data-label="Yes" />
      <div className="workflow-node-handle workflow-node-handle-output-false" data-label="No" />
    </div>
  );
}

function OutputNode({ data, selected }: NodeProps<WorkflowNodeData>) {
  return (
    <div className={`workflow-node workflow-node-output ${selected ? 'selected' : ''}`}>
      <div className="workflow-node-handle workflow-node-handle-input" />
      <div className="workflow-node-icon">{data.icon}</div>
      <div className="workflow-node-content">
        <span className="workflow-node-label">{data.label}</span>
        {data.description && <span className="workflow-node-desc">{data.description}</span>}
      </div>
    </div>
  );
}

// ============================================================================
// Node Palette Items
// ============================================================================

interface PaletteItem {
  type: WorkflowNodeType;
  label: string;
  icon: string;
  description: string;
}

const triggerPalette: PaletteItem[] = [
  { type: 'trigger', label: 'Voice Command', icon: '🎤', description: 'Triggered by voice' },
  { type: 'trigger', label: 'Schedule', icon: '⏰', description: 'Run on schedule' },
  { type: 'trigger', label: 'Webhook', icon: '🔗', description: 'HTTP webhook' },
  { type: 'trigger', label: 'File Change', icon: '📁', description: 'Watch file changes' },
  { type: 'trigger', label: 'Email', icon: '📧', description: 'New email received' },
  { type: 'trigger', label: 'Price Alert', icon: '📈', description: 'Price threshold' },
];

const actionPalette: PaletteItem[] = [
  { type: 'action', label: 'Run Terminal', icon: '💻', description: 'Execute command' },
  { type: 'action', label: 'Open App', icon: '🚀', description: 'Launch application' },
  { type: 'action', label: 'Send Email', icon: '✉️', description: 'Send email' },
  { type: 'action', label: 'HTTP Request', icon: '🌐', description: 'Make API call' },
  { type: 'action', label: 'Write File', icon: '📝', description: 'Write to file' },
  { type: 'action', label: 'Screenshot', icon: '📸', description: 'Capture screen' },
  { type: 'action', label: 'Notify', icon: '🔔', description: 'Show notification' },
  { type: 'action', label: 'AI Chat', icon: '🤖', description: 'Query LLM' },
];

const conditionPalette: PaletteItem[] = [
  { type: 'condition', label: 'If/Else', icon: '🔀', description: 'Branch logic' },
  { type: 'condition', label: 'Contains', icon: '🔍', description: 'Text contains' },
  { type: 'condition', label: 'Compare', icon: '⚖️', description: 'Value comparison' },
  { type: 'condition', label: 'File Exists', icon: '📋', description: 'Check file' },
];

const outputPalette: PaletteItem[] = [
  { type: 'output', label: 'Log', icon: '📜', description: 'Log output' },
  { type: 'output', label: 'Store Memory', icon: '🧠', description: 'Save to memory' },
  { type: 'output', label: 'Set Variable', icon: '📦', description: 'Set variable' },
];

// ============================================================================
// Workflow Builder Component
// ============================================================================

export function WorkflowBuilder() {
  const { setView } = useDashboardStore();
  const [workflowName, setWorkflowName] = useState('New Workflow');
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  // Initial nodes and edges
  const initialNodes: Node<WorkflowNodeData>[] = [];
  const initialEdges: Edge[] = [];

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Node types mapping
  const nodeTypes: NodeTypes = useMemo(
    () => ({
      trigger: TriggerNode,
      action: ActionNode,
      condition: ConditionNode,
      output: OutputNode,
    }),
    []
  );

  // Handle edge connections
  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            type: 'smoothstep',
            animated: true,
            markerEnd: { type: MarkerType.ArrowClosed },
            style: { stroke: '#00d4aa', strokeWidth: 2 },
          },
          eds
        )
      );
    },
    [setEdges]
  );

  // Handle node selection
  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setSelectedNode(node.id);
  }, []);

  // Handle pane click (deselect)
  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  // Add node from palette
  const addNode = useCallback(
    (item: PaletteItem) => {
      const newNode: Node<WorkflowNodeData> = {
        id: `node-${Date.now()}`,
        type: item.type,
        position: { x: 250 + Math.random() * 200, y: 100 + Math.random() * 200 },
        data: {
          label: item.label,
          type: item.type,
          icon: item.icon,
          description: item.description,
        },
      };
      setNodes((nds) => [...nds, newNode]);
    },
    [setNodes]
  );

  // Delete selected node
  const deleteSelectedNode = useCallback(() => {
    if (selectedNode) {
      setNodes((nds) => nds.filter((n) => n.id !== selectedNode));
      setEdges((eds) => eds.filter((e) => e.source !== selectedNode && e.target !== selectedNode));
      setSelectedNode(null);
    }
  }, [selectedNode, setNodes, setEdges]);

  // Save workflow
  const saveWorkflow = useCallback(async () => {
    const workflow = {
      id: `wf_${Date.now()}`,
      name: workflowName || 'Untitled Workflow',
      status: 'paused' as const,
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type as 'trigger' | 'action' | 'condition' | 'output',
        position: n.position,
        data: {
          label: n.data.label,
          config: n.data.config,
        },
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: e.type,
      })),
    };

    try {
      if (!window.atlas) {
        throw new Error('Atlas API not available');
      }
      const result = await window.atlas.dashboard?.saveWorkflow?.(workflow) as { success: boolean; error?: string } | undefined;
      if (result?.success) {
        // Show success notification
        console.log(`Workflow "${workflowName}" saved successfully`);
      } else {
        console.error('Failed to save workflow:', result?.error);
        alert(`Failed to save workflow: ${result?.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error saving workflow:', error);
      alert(`Error saving workflow: ${error}`);
    }
  }, [workflowName, nodes, edges]);

  // Return to dashboard
  const goBack = useCallback(() => {
    setView('dashboard');
  }, [setView]);

  return (
    <div className="workflow-builder">
      {/* Header */}
      <div className="workflow-builder-header">
        <button className="workflow-back-btn" onClick={goBack} title="Back to Dashboard">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <input
          type="text"
          className="workflow-name-input"
          value={workflowName}
          onChange={(e) => setWorkflowName(e.target.value)}
          placeholder="Workflow name..."
        />
        <div className="workflow-header-actions">
          {selectedNode && (
            <button className="workflow-delete-btn" onClick={deleteSelectedNode}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              </svg>
              Delete Node
            </button>
          )}
          <button className="workflow-save-btn" onClick={saveWorkflow}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
            Save Workflow
          </button>
        </div>
      </div>

      {/* Main Builder Area */}
      <div className="workflow-builder-content">
        {/* Node Palette */}
        <div className="workflow-palette">
          <div className="palette-section">
            <h3 className="palette-section-title">Triggers</h3>
            <div className="palette-items">
              {triggerPalette.map((item, i) => (
                <button key={i} className="palette-item" onClick={() => addNode(item)}>
                  <span className="palette-item-icon">{item.icon}</span>
                  <span className="palette-item-label">{item.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="palette-section">
            <h3 className="palette-section-title">Actions</h3>
            <div className="palette-items">
              {actionPalette.map((item, i) => (
                <button key={i} className="palette-item" onClick={() => addNode(item)}>
                  <span className="palette-item-icon">{item.icon}</span>
                  <span className="palette-item-label">{item.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="palette-section">
            <h3 className="palette-section-title">Conditions</h3>
            <div className="palette-items">
              {conditionPalette.map((item, i) => (
                <button key={i} className="palette-item" onClick={() => addNode(item)}>
                  <span className="palette-item-icon">{item.icon}</span>
                  <span className="palette-item-label">{item.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="palette-section">
            <h3 className="palette-section-title">Outputs</h3>
            <div className="palette-items">
              {outputPalette.map((item, i) => (
                <button key={i} className="palette-item" onClick={() => addNode(item)}>
                  <span className="palette-item-icon">{item.icon}</span>
                  <span className="palette-item-label">{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ReactFlow Canvas */}
        <div className="workflow-canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            nodeTypes={nodeTypes}
            fitView
            snapToGrid
            snapGrid={[15, 15]}
            defaultEdgeOptions={{
              type: 'smoothstep',
              animated: true,
              markerEnd: { type: MarkerType.ArrowClosed },
            }}
          >
            <Controls className="workflow-controls" />
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#1e1e2e" />
            <Panel position="bottom-center" className="workflow-hint-panel">
              {nodes.length === 0 ? (
                <span>Click items from the palette to add nodes, then drag to connect them</span>
              ) : (
                <span>
                  {nodes.length} node{nodes.length !== 1 ? 's' : ''} | {edges.length} connection
                  {edges.length !== 1 ? 's' : ''}
                </span>
              )}
            </Panel>
          </ReactFlow>
        </div>

        {/* Properties Panel */}
        {selectedNode && (
          <div className="workflow-properties">
            <h3 className="properties-title">Properties</h3>
            <div className="properties-content">
              {(() => {
                const node = nodes.find((n) => n.id === selectedNode);
                if (!node) return null;
                return (
                  <>
                    <div className="property-row">
                      <label>Type</label>
                      <span className="property-value">{node.data.type}</span>
                    </div>
                    <div className="property-row">
                      <label>Label</label>
                      <input
                        type="text"
                        value={node.data.label}
                        onChange={(e) => {
                          setNodes((nds) =>
                            nds.map((n) =>
                              n.id === selectedNode
                                ? { ...n, data: { ...n.data, label: e.target.value } }
                                : n
                            )
                          );
                        }}
                      />
                    </div>
                    <div className="property-row">
                      <label>Description</label>
                      <input
                        type="text"
                        value={node.data.description || ''}
                        onChange={(e) => {
                          setNodes((nds) =>
                            nds.map((n) =>
                              n.id === selectedNode
                                ? { ...n, data: { ...n.data, description: e.target.value } }
                                : n
                            )
                          );
                        }}
                      />
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default WorkflowBuilder;
