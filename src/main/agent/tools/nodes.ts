/**
 * @fileoverview Node Tools - Companion Device Control
 * @module agent/tools/nodes
 * @author Atlas Team
 * @since 1.0.0
 *
 * @description
 * Tools for managing and controlling companion devices (nodes) connected
 * to Atlas via the gateway. Nodes can provide capabilities like:
 * - Camera (snap, clip, stream)
 * - Screen capture
 * - Location services
 * - Notifications
 * - System commands
 *
 * @see https://docs.clawd.bot/concepts/nodes
 *
 * @example
 * import { nodesListTool, nodesInvokeTool } from './nodes';
 *
 * // List connected nodes
 * const nodes = await nodesListTool.execute({});
 *
 * // Take a photo on a connected device
 * await nodesInvokeTool.execute({
 *   nodeId: 'abc123',
 *   command: 'camera.snap',
 * });
 */

import { createModuleLogger } from '../../utils/logger';
import { getGateway, GatewayClient, NodeCapability } from '../../gateway';
import type { AgentTool, ActionResult } from '../index';

const logger = createModuleLogger('NodeTools');

// =============================================================================
// Types
// =============================================================================

/**
 * Node info returned by list command
 */
interface NodeInfo {
  id: string;
  name?: string;
  platform?: string;
  capabilities: NodeCapability[];
  pairingStatus: 'approved' | 'pending' | 'rejected';
  connectedAt: number;
}

// =============================================================================
// Nodes List Tool
// =============================================================================

/**
 * List connected nodes
 */
export const nodesListTool: AgentTool = {
  name: 'nodes_list',
  description: `List all connected companion devices (nodes).

Use this tool to:
- See what devices are connected
- Check device capabilities
- Find a device to send commands to

Nodes can provide: camera, screen capture, location, notifications, system commands.`,

  parameters: {
    type: 'object',
    properties: {
      capability: {
        type: 'string',
        enum: ['canvas', 'camera', 'screen', 'location', 'notifications', 'system.run', 'sms'],
        description: 'Filter by capability (optional)',
      },
      approved: {
        type: 'boolean',
        description: 'Only show approved nodes (default: true)',
      },
    },
    required: [],
  },

  async execute(params: Record<string, unknown>): Promise<ActionResult> {
    try {
      const gateway = getGateway();

      if (!gateway.isRunning) {
        return {
          success: false,
          output: 'Gateway is not running. Start the gateway to use node features.',
          error: 'Gateway not running',
        };
      }

      let nodes = gateway.getNodes();

      // Filter by capability
      const capability = params.capability as NodeCapability | undefined;
      if (capability) {
        nodes = nodes.filter((n) => n.capabilities?.includes(capability));
      }

      // Filter by approval status
      const approvedOnly = params.approved !== false;
      if (approvedOnly) {
        nodes = nodes.filter((n) => n.pairingStatus === 'approved');
      }

      if (nodes.length === 0) {
        return {
          success: true,
          output: 'No connected nodes found.',
          data: { nodes: [] },
        };
      }

      // Format output
      const nodeInfos: NodeInfo[] = nodes.map((n) => ({
        id: n.id,
        name: n.name,
        platform: n.platform,
        capabilities: n.capabilities || [],
        pairingStatus: n.pairingStatus,
        connectedAt: n.connectedAt,
      }));

      const output = nodeInfos
        .map((n) => {
          const caps = n.capabilities.length > 0 ? n.capabilities.join(', ') : 'none';
          const status = n.pairingStatus === 'pending' ? ' ⏳ (pending)' : '';
          return `**${n.name || n.id.slice(0, 8)}**${status}
  ID: ${n.id.slice(0, 8)}...
  Platform: ${n.platform || 'unknown'}
  Capabilities: ${caps}`;
        })
        .join('\n\n');

      logger.info('Nodes listed', { count: nodes.length });

      return {
        success: true,
        output: `Found ${nodes.length} connected node(s):\n\n${output}`,
        data: { nodes: nodeInfos },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to list nodes', { error });

      return {
        success: false,
        output: `Failed to list nodes: ${errorMessage}`,
        error: errorMessage,
      };
    }
  },
};

// =============================================================================
// Nodes Invoke Tool
// =============================================================================

/**
 * Invoke a command on a node
 */
export const nodesInvokeTool: AgentTool = {
  name: 'nodes_invoke',
  description: `Execute a command on a connected companion device.

Available commands depend on node capabilities:
- camera.snap: Take a photo
- camera.clip: Record a video clip
- screen.capture: Take a screenshot
- screen.record: Record screen
- location.get: Get current location
- notifications.send: Send a notification
- system.run: Run a system command

Use nodes_list first to see available capabilities.`,

  parameters: {
    type: 'object',
    properties: {
      nodeId: {
        type: 'string',
        description: 'The ID of the node to send the command to',
      },
      command: {
        type: 'string',
        description: 'The command to execute (e.g., "camera.snap", "screen.capture")',
      },
      params: {
        type: 'object',
        description: 'Command parameters (varies by command)',
      },
    },
    required: ['nodeId', 'command'],
  },

  async execute(params: Record<string, unknown>): Promise<ActionResult> {
    try {
      const gateway = getGateway();
      const nodeId = params.nodeId as string;
      const command = params.command as string;
      const commandParams = params.params as Record<string, unknown> | undefined;

      if (!gateway.isRunning) {
        return {
          success: false,
          output: 'Gateway is not running.',
          error: 'Gateway not running',
        };
      }

      // Validate node exists and is approved
      const node = gateway.getClient(nodeId);
      if (!node) {
        return {
          success: false,
          output: `Node not found: ${nodeId}`,
          error: 'Node not found',
        };
      }

      if (node.pairingStatus !== 'approved') {
        return {
          success: false,
          output: `Node ${nodeId.slice(0, 8)}... is not approved. Use nodes_approve first.`,
          error: 'Node not approved',
        };
      }

      // Check capability
      const [category] = command.split('.');
      const requiredCapability = category as NodeCapability;
      if (node.capabilities && !node.capabilities.includes(requiredCapability)) {
        return {
          success: false,
          output: `Node ${node.name || nodeId.slice(0, 8)} doesn't have the ${requiredCapability} capability.`,
          error: 'Missing capability',
        };
      }

      logger.info('Invoking node command', {
        nodeId: nodeId.slice(0, 8),
        command,
      });

      // Forward to gateway's node.invoke handler
      const result = await new Promise<unknown>((resolve, reject) => {
        const handler = async () => {
          try {
            // Use gateway's registered handler
            const response = await gateway['_handlers'].get('node.invoke')?.(
              { role: 'operator' } as GatewayClient,
              { nodeId, command, commandParams }
            );
            resolve(response);
          } catch (error) {
            reject(error);
          }
        };
        handler();
      });

      return {
        success: true,
        output: `Command "${command}" executed on node ${node.name || nodeId.slice(0, 8)}`,
        data: { nodeId, command, result },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to invoke node command', { error });

      return {
        success: false,
        output: `Command failed: ${errorMessage}`,
        error: errorMessage,
      };
    }
  },
};

// =============================================================================
// Nodes Approve Tool
// =============================================================================

/**
 * Approve a pending node
 */
export const nodesApproveTool: AgentTool = {
  name: 'nodes_approve',
  description: `Approve a pending companion device for Atlas control.

New nodes start in 'pending' status and must be approved before 
commands can be sent to them. This is a security measure.`,

  parameters: {
    type: 'object',
    properties: {
      nodeId: {
        type: 'string',
        description: 'The ID of the node to approve',
      },
    },
    required: ['nodeId'],
  },

  async execute(params: Record<string, unknown>): Promise<ActionResult> {
    try {
      const gateway = getGateway();
      const nodeId = params.nodeId as string;

      if (!gateway.isRunning) {
        return {
          success: false,
          output: 'Gateway is not running.',
          error: 'Gateway not running',
        };
      }

      const node = gateway.getClient(nodeId);
      if (!node || node.role !== 'node') {
        return {
          success: false,
          output: `Node not found: ${nodeId}`,
          error: 'Node not found',
        };
      }

      if (node.pairingStatus === 'approved') {
        return {
          success: true,
          output: `Node ${node.name || nodeId.slice(0, 8)} is already approved.`,
          data: { nodeId, status: 'approved' },
        };
      }

      // Update status
      node.pairingStatus = 'approved';
      gateway.sendEvent(nodeId, 'pairing.approved', {});

      logger.info('Node approved', {
        nodeId: nodeId.slice(0, 8),
        name: node.name,
      });

      return {
        success: true,
        output: `✅ Node ${node.name || nodeId.slice(0, 8)} has been approved.`,
        data: { nodeId, status: 'approved', name: node.name },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to approve node', { error });

      return {
        success: false,
        output: `Failed to approve node: ${errorMessage}`,
        error: errorMessage,
      };
    }
  },
};

// =============================================================================
// Nodes Reject Tool
// =============================================================================

/**
 * Reject and disconnect a node
 */
export const nodesRejectTool: AgentTool = {
  name: 'nodes_reject',
  description: `Reject a companion device and disconnect it.

Use this for:
- Unknown devices trying to connect
- Devices that are no longer trusted
- Cleaning up old connections`,

  parameters: {
    type: 'object',
    properties: {
      nodeId: {
        type: 'string',
        description: 'The ID of the node to reject',
      },
    },
    required: ['nodeId'],
  },

  async execute(params: Record<string, unknown>): Promise<ActionResult> {
    try {
      const gateway = getGateway();
      const nodeId = params.nodeId as string;

      if (!gateway.isRunning) {
        return {
          success: false,
          output: 'Gateway is not running.',
          error: 'Gateway not running',
        };
      }

      const node = gateway.getClient(nodeId);
      if (!node || node.role !== 'node') {
        return {
          success: false,
          output: `Node not found: ${nodeId}`,
          error: 'Node not found',
        };
      }

      const nodeName = node.name || nodeId.slice(0, 8);

      // Update status and disconnect
      node.pairingStatus = 'rejected';
      gateway.sendEvent(nodeId, 'pairing.rejected', {});
      node.ws.close(4004, 'Pairing rejected');

      logger.info('Node rejected', { nodeId: nodeId.slice(0, 8), name: node.name });

      return {
        success: true,
        output: `Node ${nodeName} has been rejected and disconnected.`,
        data: { nodeId, status: 'rejected' },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to reject node', { error });

      return {
        success: false,
        output: `Failed to reject node: ${errorMessage}`,
        error: errorMessage,
      };
    }
  },
};

// =============================================================================
// Nodes Notify Tool
// =============================================================================

/**
 * Send a notification to a node
 */
export const nodesNotifyTool: AgentTool = {
  name: 'nodes_notify',
  description: `Send a notification to a connected companion device.

The device must have the 'notifications' capability.`,

  parameters: {
    type: 'object',
    properties: {
      nodeId: {
        type: 'string',
        description: 'The ID of the node to notify',
      },
      title: {
        type: 'string',
        description: 'Notification title',
      },
      body: {
        type: 'string',
        description: 'Notification body/message',
      },
      sound: {
        type: 'boolean',
        description: 'Play notification sound (default: true)',
      },
      vibrate: {
        type: 'boolean',
        description: 'Vibrate device (default: true)',
      },
    },
    required: ['nodeId', 'title'],
  },

  async execute(params: Record<string, unknown>): Promise<ActionResult> {
    try {
      const nodeId = params.nodeId as string;

      // Use nodesInvokeTool with notifications.send command
      const result = await nodesInvokeTool.execute({
        nodeId,
        command: 'notifications.send',
        params: {
          title: params.title,
          body: params.body,
          sound: params.sound !== false,
          vibrate: params.vibrate !== false,
        },
      });

      if (result.success) {
        return {
          success: true,
          output: `📱 Notification sent to device ${nodeId.slice(0, 8)}`,
          data: result.data,
        };
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to send notification', { error });

      return {
        success: false,
        output: `Failed to send notification: ${errorMessage}`,
        error: errorMessage,
      };
    }
  },
};

// =============================================================================
// Export All Tools
// =============================================================================

export const nodeTools = [
  nodesListTool,
  nodesInvokeTool,
  nodesApproveTool,
  nodesRejectTool,
  nodesNotifyTool,
];

export default nodeTools;
