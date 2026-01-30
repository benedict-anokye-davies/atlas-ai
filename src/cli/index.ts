#!/usr/bin/env node
/**
 * @fileoverview Atlas CLI - Command Line Interface
 * @module cli
 * @author Atlas Team
 * @since 1.0.0
 *
 * @description
 * The Atlas CLI provides command-line control over the Atlas Desktop
 * assistant. Communicates with the Gateway via WebSocket to manage:
 * - Gateway lifecycle (start/stop/status)
 * - Channel connections (Telegram, Discord, WhatsApp, Slack)
 * - DM pairing approvals
 * - Session management
 * - Cron/scheduled tasks
 * - Node (companion device) management
 * - Skills management
 * - Browser automation
 *
 * Inspired by Clawdbot CLI architecture.
 *
 * @example
 * ```bash
 * # Start the gateway
 * atlas gateway start
 *
 * # Connect Telegram channel
 * atlas channels login telegram --token BOT_TOKEN
 *
 * # List pending pairing requests
 * atlas pairing list
 *
 * # Approve a sender
 * atlas pairing approve abc123
 *
 * # List scheduled tasks
 * atlas cron list
 * ```
 */

import { Command } from 'commander';
import { createGatewayClient, GatewayClient } from './utils/gateway-client';

// =============================================================================
// CLI Setup
// =============================================================================

const program = new Command();

program
  .name('atlas')
  .description('Atlas Desktop AI Assistant - Command Line Interface')
  .version('1.0.0')
  .option('-H, --host <host>', 'Gateway host', '127.0.0.1')
  .option('-P, --port <port>', 'Gateway port', '18789')
  .option('-T, --token <token>', 'Gateway authentication token');

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get a connected gateway client
 */
async function getClient(): Promise<GatewayClient> {
  const opts = program.opts();
  const client = createGatewayClient({
    host: opts.host,
    port: parseInt(opts.port, 10),
    token: opts.token,
  });

  try {
    await client.connect();
    return client;
  } catch (error) {
    console.error('Failed to connect to gateway:', (error as Error).message);
    console.error('Is the Atlas desktop app running?');
    process.exit(1);
  }
}

/**
 * Format JSON output
 */
function formatOutput(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

/**
 * Format table output
 */
function formatTable(headers: string[], rows: string[][]): void {
  // Calculate column widths
  const widths = headers.map((h, i) => {
    const maxRow = rows.reduce((max, row) => Math.max(max, (row[i] || '').length), 0);
    return Math.max(h.length, maxRow);
  });

  // Print header
  const headerLine = headers.map((h, i) => h.padEnd(widths[i])).join('  ');
  console.log(headerLine);
  console.log('-'.repeat(headerLine.length));

  // Print rows
  for (const row of rows) {
    console.log(row.map((cell, i) => (cell || '').padEnd(widths[i])).join('  '));
  }
}

// =============================================================================
// Gateway Commands
// =============================================================================

const gatewayCmd = program.command('gateway').description('Gateway management');

gatewayCmd
  .command('status')
  .description('Get gateway status')
  .action(async () => {
    const client = await getClient();
    try {
      const status = await client.request('status');
      formatOutput(status);
    } finally {
      await client.disconnect();
    }
  });

gatewayCmd
  .command('health')
  .description('Get gateway health')
  .action(async () => {
    const client = await getClient();
    try {
      const health = await client.request('health');
      formatOutput(health);
    } finally {
      await client.disconnect();
    }
  });

gatewayCmd
  .command('clients')
  .description('List connected clients')
  .action(async () => {
    const client = await getClient();
    try {
      const clients = (await client.request('clients.list')) as Array<{
        id: string;
        role: string;
        name?: string;
        platform?: string;
        pairingStatus: string;
      }>;

      if (clients.length === 0) {
        console.log('No clients connected');
        return;
      }

      formatTable(
        ['ID', 'Role', 'Name', 'Platform', 'Status'],
        clients.map((c) => [
          c.id.substring(0, 8),
          c.role,
          c.name || '-',
          c.platform || '-',
          c.pairingStatus,
        ])
      );
    } finally {
      await client.disconnect();
    }
  });

// =============================================================================
// Channel Commands
// =============================================================================

const channelsCmd = program.command('channels').description('Channel management');

channelsCmd
  .command('list')
  .description('List connected channels')
  .action(async () => {
    const client = await getClient();
    try {
      const channels = (await client.request('channels.list')) as string[];

      if (channels.length === 0) {
        console.log('No channels connected');
        return;
      }

      console.log('Connected channels:');
      for (const channel of channels) {
        console.log(`  - ${channel}`);
      }
    } finally {
      await client.disconnect();
    }
  });

channelsCmd
  .command('connect <channel>')
  .description('Connect a channel')
  .option('-t, --token <token>', 'Bot token')
  .option('--app-token <token>', 'App token (for Slack socket mode)')
  .option('--signing-secret <secret>', 'Signing secret')
  .action(async (channel: string, options) => {
    const client = await getClient();
    try {
      const config: Record<string, unknown> = {};

      if (options.token) config.token = options.token;
      if (options.appToken) config.appToken = options.appToken;
      if (options.signingSecret) {
        config.options = { signingSecret: options.signingSecret };
      }

      await client.request('channels.connect', { channel, config });
      console.log(`Channel ${channel} connected`);
    } catch (error) {
      console.error(`Failed to connect ${channel}:`, (error as Error).message);
      process.exit(1);
    } finally {
      await client.disconnect();
    }
  });

channelsCmd
  .command('disconnect <channel>')
  .description('Disconnect a channel')
  .action(async (channel: string) => {
    const client = await getClient();
    try {
      await client.request('channels.disconnect', { channel });
      console.log(`Channel ${channel} disconnected`);
    } finally {
      await client.disconnect();
    }
  });

// =============================================================================
// Pairing Commands
// =============================================================================

const pairingCmd = program.command('pairing').description('DM pairing management');

pairingCmd
  .command('list')
  .description('List pending pairing requests')
  .option('-c, --channel <channel>', 'Filter by channel')
  .action(async (options) => {
    const client = await getClient();
    try {
      const requests = (await client.request('pairing.list', {
        channel: options.channel,
      })) as Array<{
        id: string;
        channel: string;
        senderId: string;
        senderName?: string;
        createdAt: number;
      }>;

      if (!requests || requests.length === 0) {
        console.log('No pending pairing requests');
        return;
      }

      formatTable(
        ['ID', 'Channel', 'Sender', 'Name', 'Created'],
        requests.map((r) => [
          r.id.substring(0, 8),
          r.channel,
          r.senderId.substring(0, 12),
          r.senderName || '-',
          new Date(r.createdAt).toLocaleString(),
        ])
      );
    } finally {
      await client.disconnect();
    }
  });

pairingCmd
  .command('approve <id>')
  .description('Approve a pairing request')
  .action(async (id: string) => {
    const client = await getClient();
    try {
      await client.request('pairing.approve', { id });
      console.log(`Pairing request ${id} approved`);
    } finally {
      await client.disconnect();
    }
  });

pairingCmd
  .command('deny <id>')
  .description('Deny a pairing request')
  .action(async (id: string) => {
    const client = await getClient();
    try {
      await client.request('pairing.deny', { id });
      console.log(`Pairing request ${id} denied`);
    } finally {
      await client.disconnect();
    }
  });

pairingCmd
  .command('block <id>')
  .description('Block a sender')
  .action(async (id: string) => {
    const client = await getClient();
    try {
      await client.request('pairing.block', { id });
      console.log(`Sender ${id} blocked`);
    } finally {
      await client.disconnect();
    }
  });

// =============================================================================
// Session Commands
// =============================================================================

const sessionCmd = program.command('session').description('Session management');

sessionCmd
  .command('list')
  .description('List active sessions')
  .option('-c, --channel <channel>', 'Filter by channel')
  .option('-s, --state <state>', 'Filter by state (active, paused)')
  .action(async (options) => {
    const client = await getClient();
    try {
      const sessions = (await client.request('sessions.list', {
        channel: options.channel,
        state: options.state,
      })) as Array<{
        id: string;
        channel: string;
        identifier: string;
        label?: string;
        state: string;
        turnCount: number;
      }>;

      if (!sessions || sessions.length === 0) {
        console.log('No active sessions');
        return;
      }

      formatTable(
        ['ID', 'Channel', 'Label', 'State', 'Turns'],
        sessions.map((s) => [
          s.id.substring(0, 8),
          s.channel,
          s.label || s.identifier.substring(0, 16),
          s.state,
          s.turnCount.toString(),
        ])
      );
    } finally {
      await client.disconnect();
    }
  });

sessionCmd
  .command('history <id>')
  .description('Get session conversation history')
  .option('-n, --limit <n>', 'Limit number of turns', '10')
  .action(async (id: string, options) => {
    const client = await getClient();
    try {
      const history = (await client.request('sessions.history', {
        sessionId: id,
        limit: parseInt(options.limit, 10),
      })) as Array<{
        input: string;
        response?: string;
        timestamp: number;
      }>;

      if (!history || history.length === 0) {
        console.log('No conversation history');
        return;
      }

      for (const turn of history) {
        const time = new Date(turn.timestamp).toLocaleTimeString();
        console.log(`[${time}] User: ${turn.input}`);
        if (turn.response) {
          console.log(`[${time}] Atlas: ${turn.response.substring(0, 200)}...`);
        }
        console.log('');
      }
    } finally {
      await client.disconnect();
    }
  });

sessionCmd
  .command('send <id> <message>')
  .description('Send a message to a session')
  .action(async (id: string, message: string) => {
    const client = await getClient();
    try {
      await client.request('sessions.send', {
        sessionId: id,
        message,
      });
      console.log('Message sent');
    } finally {
      await client.disconnect();
    }
  });

// =============================================================================
// Cron Commands
// =============================================================================

const cronCmd = program.command('cron').description('Scheduled task management');

cronCmd
  .command('list')
  .description('List scheduled tasks')
  .option('-s, --state <state>', 'Filter by state')
  .action(async (options) => {
    const client = await getClient();
    try {
      const tasks = (await client.request('cron.list', {
        state: options.state,
      })) as Array<{
        id: string;
        name: string;
        cron?: string;
        state: string;
        nextRunAt?: number;
        runCount: number;
      }>;

      if (!tasks || tasks.length === 0) {
        console.log('No scheduled tasks');
        return;
      }

      formatTable(
        ['ID', 'Name', 'Cron', 'State', 'Next Run', 'Runs'],
        tasks.map((t) => [
          t.id.substring(0, 8),
          t.name,
          t.cron || '-',
          t.state,
          t.nextRunAt ? new Date(t.nextRunAt).toLocaleString() : '-',
          t.runCount.toString(),
        ])
      );
    } finally {
      await client.disconnect();
    }
  });

cronCmd
  .command('pause <id>')
  .description('Pause a scheduled task')
  .action(async (id: string) => {
    const client = await getClient();
    try {
      await client.request('cron.pause', { id });
      console.log(`Task ${id} paused`);
    } finally {
      await client.disconnect();
    }
  });

cronCmd
  .command('resume <id>')
  .description('Resume a paused task')
  .action(async (id: string) => {
    const client = await getClient();
    try {
      await client.request('cron.resume', { id });
      console.log(`Task ${id} resumed`);
    } finally {
      await client.disconnect();
    }
  });

cronCmd
  .command('cancel <id>')
  .description('Cancel a scheduled task')
  .action(async (id: string) => {
    const client = await getClient();
    try {
      await client.request('cron.cancel', { id });
      console.log(`Task ${id} cancelled`);
    } finally {
      await client.disconnect();
    }
  });

// =============================================================================
// Node Commands
// =============================================================================

const nodesCmd = program.command('nodes').description('Companion node management');

nodesCmd
  .command('list')
  .description('List connected nodes')
  .action(async () => {
    const client = await getClient();
    try {
      const nodes = (await client.request('nodes.list')) as Array<{
        id: string;
        name?: string;
        platform?: string;
        capabilities: string[];
        pairingStatus: string;
      }>;

      if (!nodes || nodes.length === 0) {
        console.log('No nodes connected');
        return;
      }

      formatTable(
        ['ID', 'Name', 'Platform', 'Capabilities', 'Status'],
        nodes.map((n) => [
          n.id.substring(0, 8),
          n.name || '-',
          n.platform || '-',
          n.capabilities.join(', '),
          n.pairingStatus,
        ])
      );
    } finally {
      await client.disconnect();
    }
  });

nodesCmd
  .command('approve <id>')
  .description('Approve a node pairing')
  .action(async (id: string) => {
    const client = await getClient();
    try {
      await client.request('node.approve', { nodeId: id });
      console.log(`Node ${id} approved`);
    } finally {
      await client.disconnect();
    }
  });

nodesCmd
  .command('reject <id>')
  .description('Reject a node pairing')
  .action(async (id: string) => {
    const client = await getClient();
    try {
      await client.request('node.reject', { nodeId: id });
      console.log(`Node ${id} rejected`);
    } finally {
      await client.disconnect();
    }
  });

// =============================================================================
// Skills Commands
// =============================================================================

const skillsCmd = program.command('skills').description('Skills management');

skillsCmd
  .command('list')
  .description('List installed skills')
  .option('-e, --enabled', 'Only show enabled skills')
  .action(async (options) => {
    const client = await getClient();
    try {
      const skills = (await client.request('skills.list', {
        enabledOnly: options.enabled,
      })) as Array<{
        id: string;
        name: string;
        version: string;
        enabled: boolean;
        source: string;
      }>;

      if (!skills || skills.length === 0) {
        console.log('No skills installed');
        return;
      }

      formatTable(
        ['ID', 'Name', 'Version', 'Enabled', 'Source'],
        skills.map((s) => [s.id, s.name, s.version, s.enabled ? 'Yes' : 'No', s.source])
      );
    } finally {
      await client.disconnect();
    }
  });

skillsCmd
  .command('enable <id>')
  .description('Enable a skill')
  .action(async (id: string) => {
    const client = await getClient();
    try {
      await client.request('skills.enable', { id });
      console.log(`Skill ${id} enabled`);
    } finally {
      await client.disconnect();
    }
  });

skillsCmd
  .command('disable <id>')
  .description('Disable a skill')
  .action(async (id: string) => {
    const client = await getClient();
    try {
      await client.request('skills.disable', { id });
      console.log(`Skill ${id} disabled`);
    } finally {
      await client.disconnect();
    }
  });

skillsCmd
  .command('info <id>')
  .description('Get skill information')
  .action(async (id: string) => {
    const client = await getClient();
    try {
      const info = await client.request('skills.info', { id });
      formatOutput(info);
    } finally {
      await client.disconnect();
    }
  });

// =============================================================================
// Config Commands
// =============================================================================

const configCmd = program.command('config').description('Configuration management');

configCmd
  .command('get [key]')
  .description('Get configuration value')
  .action(async (key?: string) => {
    const client = await getClient();
    try {
      const config = await client.request('config.get', { key });
      formatOutput(config);
    } finally {
      await client.disconnect();
    }
  });

configCmd
  .command('set <key> <value>')
  .description('Set configuration value')
  .action(async (key: string, value: string) => {
    const client = await getClient();
    try {
      // Try to parse as JSON, fall back to string
      let parsedValue: unknown = value;
      try {
        parsedValue = JSON.parse(value);
      } catch {
        // Keep as string
      }

      await client.request('config.set', { key, value: parsedValue });
      console.log(`Config ${key} set`);
    } finally {
      await client.disconnect();
    }
  });

// =============================================================================
// Parse and Execute
// =============================================================================

program.parse(process.argv);

// Show help if no command given
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
