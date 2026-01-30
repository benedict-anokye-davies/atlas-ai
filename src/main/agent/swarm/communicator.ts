/**
 * @fileoverview Agent Communicator - Inter-agent communication system
 * @module agent/swarm/communicator
 * @author Atlas Team
 * @since 2.0.0
 *
 * @description
 * Enables communication between agents in the swarm. Supports direct messaging,
 * broadcast channels, and pub/sub patterns for coordination.
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { createModuleLogger } from '../../utils/logger';
import { BaseAgent } from './base-agent';
import { AgentMessage, CommunicationChannel, MessageType } from './types';

const logger = createModuleLogger('AgentCommunicator');

// =============================================================================
// Agent Communicator Class
// =============================================================================

/**
 * Manages inter-agent communication.
 *
 * Provides messaging capabilities for agents to coordinate,
 * share information, and collaborate on tasks.
 *
 * @class AgentCommunicator
 * @extends EventEmitter
 */
export class AgentCommunicator extends EventEmitter {
  private channels: Map<string, CommunicationChannel> = new Map();
  private agentSubscriptions: Map<string, Set<string>> = new Map();

  /**
   * Register an agent to a communication channel.
   *
   * @param {string} channelId - Channel identifier
   * @param {BaseAgent} agent - Agent to register
   */
  registerChannel(channelId: string, agent: BaseAgent): void {
    if (!this.channels.has(channelId)) {
      this.channels.set(channelId, {
        id: channelId,
        name: channelId,
        subscribers: [],
        messages: [],
        createdAt: Date.now(),
      });
    }

    const channel = this.channels.get(channelId)!;
    if (!channel.subscribers.includes(agent.id)) {
      channel.subscribers.push(agent.id);
    }

    // Track agent's subscriptions
    if (!this.agentSubscriptions.has(agent.id)) {
      this.agentSubscriptions.set(agent.id, new Set());
    }
    this.agentSubscriptions.get(agent.id)!.add(channelId);

    logger.debug('Agent registered to channel', { channelId, agentId: agent.id });
  }

  /**
   * Unregister an agent from a channel.
   *
   * @param {string} channelId - Channel identifier
   * @param {string} agentId - Agent ID
   */
  unregisterChannel(channelId: string, agentId: string): void {
    const channel = this.channels.get(channelId);
    if (channel) {
      channel.subscribers = channel.subscribers.filter((id) => id !== agentId);
    }

    const subscriptions = this.agentSubscriptions.get(agentId);
    if (subscriptions) {
      subscriptions.delete(channelId);
    }

    logger.debug('Agent unregistered from channel', { channelId, agentId });
  }

  /**
   * Send a message from one agent to another.
   *
   * @param {string} fromAgentId - Sender agent ID
   * @param {string} toAgentId - Recipient agent ID (null for broadcast)
   * @param {unknown} payload - Message payload
   * @param {MessageType} [type='request'] - Message type
   * @returns {string} Message ID
   */
  sendMessage(
    fromAgentId: string,
    toAgentId: string | null,
    payload: unknown,
    type: MessageType = 'request'
  ): string {
    const message: AgentMessage = {
      id: uuidv4(),
      type,
      from: fromAgentId,
      to: toAgentId,
      payload,
      timestamp: Date.now(),
    };

    // Store in channel if applicable
    if (toAgentId) {
      // Direct message
      this.emit('message', message);
    } else {
      // Broadcast to all agents in shared channels
      this.broadcast(message);
    }

    logger.debug('Message sent', {
      messageId: message.id,
      from: fromAgentId,
      to: toAgentId || 'broadcast',
      type,
    });

    return message.id;
  }

  /**
   * Broadcast a message to all agents.
   *
   * @private
   * @param {AgentMessage} message - Message to broadcast
   */
  private broadcast(message: AgentMessage): void {
    this.emit('broadcast', message);
  }

  /**
   * Get messages for a specific agent.
   *
   * @param {string} agentId - Agent ID
   * @param {string} [channelId] - Optional channel filter
   * @returns {AgentMessage[]} Messages for the agent
   */
  getMessagesForAgent(agentId: string, channelId?: string): AgentMessage[] {
    const messages: AgentMessage[] = [];

    if (channelId) {
      const channel = this.channels.get(channelId);
      if (channel) {
        messages.push(...channel.messages);
      }
    } else {
      // Get from all subscribed channels
      const subscriptions = this.agentSubscriptions.get(agentId);
      if (subscriptions) {
        Array.from(subscriptions).forEach((chId) => {
          const channel = this.channels.get(chId);
          if (channel) {
            messages.push(...channel.messages);
          }
        });
      }
    }

    // Filter messages for this agent
    return messages.filter((msg) => msg.to === agentId || msg.to === null || msg.from === agentId);
  }

  /**
   * Create a new communication channel.
   *
   * @param {string} name - Channel name
   * @returns {string} Channel ID
   */
  createChannel(name: string): string {
    const channelId = uuidv4();
    this.channels.set(channelId, {
      id: channelId,
      name,
      subscribers: [],
      messages: [],
      createdAt: Date.now(),
    });

    logger.info('Channel created', { channelId, name });
    return channelId;
  }

  /**
   * Get all active channels.
   *
   * @returns {CommunicationChannel[]} Array of channels
   */
  getChannels(): CommunicationChannel[] {
    return Array.from(this.channels.values());
  }

  /**
   * Clear all channels and subscriptions.
   */
  clear(): void {
    this.channels.clear();
    this.agentSubscriptions.clear();
    logger.info('All channels cleared');
  }
}
