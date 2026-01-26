/**
 * Atlas Discord Integration
 *
 * Two-way Discord integration for:
 * - Notifications (trade alerts, study reminders, system events)
 * - Remote commands (via Discord messages)
 * - Status updates
 * - Log streaming
 *
 * @module integrations/discord
 */

import { Client, GatewayIntentBits, TextChannel, EmbedBuilder, Message, ChannelType } from 'discord.js';
import { createModuleLogger } from '../utils/logger';
import { EventEmitter } from 'events';

const logger = createModuleLogger('Discord');

// ============================================================================
// Types
// ============================================================================

export interface DiscordConfig {
  botToken: string;
  guildId: string;           // Server ID
  notificationChannelId: string;
  commandChannelId: string;
  logChannelId?: string;
  userId: string;            // Your Discord user ID for DMs
}

export interface DiscordNotification {
  type: 'trade' | 'study' | 'system' | 'alert' | 'reminder' | 'career';
  title: string;
  message: string;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  color?: number;
  urgent?: boolean;
}

export interface DiscordCommand {
  name: string;
  description: string;
  handler: (args: string[], message: Message) => Promise<string | EmbedBuilder>;
}

// ============================================================================
// Discord Service
// ============================================================================

export class DiscordService extends EventEmitter {
  private client: Client;
  private config: DiscordConfig | null = null;
  private isConnected: boolean = false;
  private commands: Map<string, DiscordCommand> = new Map();
  private notificationChannel: TextChannel | null = null;
  private commandChannel: TextChannel | null = null;
  private logChannel: TextChannel | null = null;

  // Color palette
  private readonly COLORS = {
    trade: 0x00FF00,      // Green
    tradeLoss: 0xFF0000,  // Red
    study: 0x5865F2,      // Discord blue
    system: 0x99AAB5,     // Gray
    alert: 0xFFA500,      // Orange
    reminder: 0xFFD700,   // Gold
    career: 0x9B59B6,     // Purple
    success: 0x2ECC71,    // Emerald
    error: 0xE74C3C,      // Red
  };

  constructor() {
    super();
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    });

    this.setupEventHandlers();
    this.registerDefaultCommands();
  }

  private setupEventHandlers(): void {
    this.client.once('ready', () => {
      logger.info('Discord bot connected', { 
        username: this.client.user?.username,
        guilds: this.client.guilds.cache.size 
      });
      this.isConnected = true;
      this.setupChannels();
      this.emit('connected');
    });

    this.client.on('messageCreate', async (message) => {
      // Ignore bot messages
      if (message.author.bot) return;

      // Only respond to configured user
      if (this.config && message.author.id !== this.config.userId) return;

      // Check if message is a command (starts with !)
      if (message.content.startsWith('!')) {
        await this.handleCommand(message);
      }
    });

    this.client.on('error', (error) => {
      logger.error('Discord client error', { error: error.message });
      this.emit('error', error);
    });

    this.client.on('disconnect', () => {
      logger.warn('Discord disconnected');
      this.isConnected = false;
      this.emit('disconnected');
    });
  }

  private async setupChannels(): Promise<void> {
    if (!this.config) return;

    try {
      const guild = this.client.guilds.cache.get(this.config.guildId);
      if (!guild) {
        logger.error('Guild not found', { guildId: this.config.guildId });
        return;
      }

      // Get notification channel
      const notifChannel = guild.channels.cache.get(this.config.notificationChannelId);
      if (notifChannel?.type === ChannelType.GuildText) {
        this.notificationChannel = notifChannel;
      }

      // Get command channel
      const cmdChannel = guild.channels.cache.get(this.config.commandChannelId);
      if (cmdChannel?.type === ChannelType.GuildText) {
        this.commandChannel = cmdChannel;
      }

      // Get log channel
      if (this.config.logChannelId) {
        const logChan = guild.channels.cache.get(this.config.logChannelId);
        if (logChan?.type === ChannelType.GuildText) {
          this.logChannel = logChan;
        }
      }

      logger.info('Discord channels configured');
    } catch (error) {
      logger.error('Failed to setup channels', { error: (error as Error).message });
    }
  }

  // ==========================================================================
  // Connection Management
  // ==========================================================================

  async connect(config: DiscordConfig): Promise<void> {
    this.config = config;
    
    try {
      await this.client.login(config.botToken);
      logger.info('Discord login initiated');
    } catch (error) {
      logger.error('Failed to connect to Discord', { error: (error as Error).message });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.isConnected) {
      await this.client.destroy();
      this.isConnected = false;
      logger.info('Discord disconnected');
    }
  }

  getStatus(): { connected: boolean; username?: string; guilds?: number } {
    return {
      connected: this.isConnected,
      username: this.client.user?.username,
      guilds: this.client.guilds.cache.size,
    };
  }

  // ==========================================================================
  // Notifications
  // ==========================================================================

  async sendNotification(notification: DiscordNotification): Promise<void> {
    if (!this.isConnected || !this.notificationChannel) {
      logger.warn('Cannot send notification - not connected or no channel');
      return;
    }

    try {
      const embed = new EmbedBuilder()
        .setTitle(notification.title)
        .setDescription(notification.message)
        .setColor(notification.color || this.getColorForType(notification.type))
        .setTimestamp();

      // Add emoji based on type
      const emoji = this.getEmojiForType(notification.type);
      embed.setTitle(`${emoji} ${notification.title}`);

      if (notification.fields) {
        for (const field of notification.fields) {
          embed.addFields({ 
            name: field.name, 
            value: field.value, 
            inline: field.inline ?? true 
          });
        }
      }

      // Add footer
      embed.setFooter({ text: 'Atlas AI • JARVIS' });

      await this.notificationChannel.send({ embeds: [embed] });

      // If urgent, also DM the user
      if (notification.urgent && this.config?.userId) {
        try {
          const user = await this.client.users.fetch(this.config.userId);
          await user.send({ embeds: [embed] });
        } catch {
          logger.warn('Could not send DM');
        }
      }

      logger.debug('Notification sent', { type: notification.type, title: notification.title });
    } catch (error) {
      logger.error('Failed to send notification', { error: (error as Error).message });
    }
  }

  private getColorForType(type: DiscordNotification['type']): number {
    switch (type) {
      case 'trade': return this.COLORS.trade;
      case 'study': return this.COLORS.study;
      case 'system': return this.COLORS.system;
      case 'alert': return this.COLORS.alert;
      case 'reminder': return this.COLORS.reminder;
      case 'career': return this.COLORS.career;
      default: return this.COLORS.system;
    }
  }

  private getEmojiForType(type: DiscordNotification['type']): string {
    switch (type) {
      case 'trade': return '📈';
      case 'study': return '📚';
      case 'system': return '🤖';
      case 'alert': return '⚠️';
      case 'reminder': return '⏰';
      case 'career': return '💼';
      default: return '📬';
    }
  }

  // ==========================================================================
  // Specific Notification Helpers
  // ==========================================================================

  async sendTradeAlert(trade: {
    action: 'buy' | 'sell' | 'close';
    symbol: string;
    exchange: string;
    amount: number;
    price: number;
    pnl?: number;
    reason?: string;
  }): Promise<void> {
    const isProfit = trade.pnl && trade.pnl > 0;
    const actionEmoji = trade.action === 'buy' ? '🟢' : trade.action === 'sell' ? '🔴' : '⚪';

    await this.sendNotification({
      type: 'trade',
      title: `${actionEmoji} Trade Executed: ${trade.symbol}`,
      message: trade.reason || 'Automated trade by JARVIS',
      color: trade.pnl !== undefined ? (isProfit ? this.COLORS.trade : this.COLORS.tradeLoss) : this.COLORS.trade,
      fields: [
        { name: 'Action', value: trade.action.toUpperCase(), inline: true },
        { name: 'Exchange', value: trade.exchange, inline: true },
        { name: 'Amount', value: trade.amount.toString(), inline: true },
        { name: 'Price', value: `$${trade.price.toFixed(4)}`, inline: true },
        ...(trade.pnl !== undefined ? [{ 
          name: 'P/L', 
          value: `${isProfit ? '+' : ''}$${trade.pnl.toFixed(2)}`, 
          inline: true 
        }] : []),
      ],
      urgent: trade.pnl !== undefined && Math.abs(trade.pnl) > 100,
    });
  }

  async sendStudyReminder(topic: string, dueCards: number): Promise<void> {
    await this.sendNotification({
      type: 'study',
      title: 'Study Time! 📖',
      message: `You have ${dueCards} flashcards due for review.`,
      fields: [
        { name: 'Topic', value: topic, inline: true },
        { name: 'Due Cards', value: dueCards.toString(), inline: true },
      ],
    });
  }

  async sendSystemStatus(status: {
    cpuUsage: number;
    memoryUsage: number;
    activeProcesses: string[];
    uptime: number;
  }): Promise<void> {
    const hours = Math.floor(status.uptime / 3600);
    const minutes = Math.floor((status.uptime % 3600) / 60);

    await this.sendNotification({
      type: 'system',
      title: 'System Status Update',
      message: `Atlas has been running for ${hours}h ${minutes}m`,
      fields: [
        { name: 'CPU', value: `${status.cpuUsage.toFixed(1)}%`, inline: true },
        { name: 'Memory', value: `${status.memoryUsage.toFixed(1)}%`, inline: true },
        { name: 'Active', value: status.activeProcesses.join(', ') || 'None', inline: false },
      ],
    });
  }

  async sendDailySummary(summary: {
    tradingPnl: number;
    tradesExecuted: number;
    cardsReviewed: number;
    projectsWorked: string[];
    achievements: string[];
  }): Promise<void> {
    const pnlEmoji = summary.tradingPnl >= 0 ? '📈' : '📉';
    const pnlColor = summary.tradingPnl >= 0 ? this.COLORS.success : this.COLORS.error;

    await this.sendNotification({
      type: 'system',
      title: '📊 Daily Summary',
      message: 'Here\'s what we accomplished today!',
      color: pnlColor,
      fields: [
        { name: `${pnlEmoji} Trading P/L`, value: `$${summary.tradingPnl.toFixed(2)}`, inline: true },
        { name: '📊 Trades', value: summary.tradesExecuted.toString(), inline: true },
        { name: '📚 Cards Reviewed', value: summary.cardsReviewed.toString(), inline: true },
        ...(summary.projectsWorked.length > 0 ? [{
          name: '💻 Projects',
          value: summary.projectsWorked.join(', '),
          inline: false,
        }] : []),
        ...(summary.achievements.length > 0 ? [{
          name: '🏆 Achievements',
          value: summary.achievements.join('\n'),
          inline: false,
        }] : []),
      ],
    });
  }

  // ==========================================================================
  // Command System
  // ==========================================================================

  registerCommand(command: DiscordCommand): void {
    this.commands.set(command.name.toLowerCase(), command);
    logger.debug('Command registered', { name: command.name });
  }

  private registerDefaultCommands(): void {
    // Status command
    this.registerCommand({
      name: 'status',
      description: 'Get system status',
      handler: async () => {
        return new EmbedBuilder()
          .setTitle('🤖 Atlas Status')
          .setDescription('All systems operational')
          .setColor(this.COLORS.success)
          .addFields(
            { name: 'Brain', value: '✅ Online', inline: true },
            { name: 'Trading', value: '✅ Active', inline: true },
            { name: 'Study', value: '✅ Ready', inline: true },
          )
          .setTimestamp();
      },
    });

    // Help command
    this.registerCommand({
      name: 'help',
      description: 'List available commands',
      handler: async () => {
        const commandList = Array.from(this.commands.values())
          .map(cmd => `**!${cmd.name}** - ${cmd.description}`)
          .join('\n');

        return new EmbedBuilder()
          .setTitle('📋 Available Commands')
          .setDescription(commandList)
          .setColor(this.COLORS.study)
          .setFooter({ text: 'Prefix all commands with !' });
      },
    });

    // Portfolio command
    this.registerCommand({
      name: 'portfolio',
      description: 'View trading portfolio',
      handler: async () => {
        this.emit('command:portfolio');
        return 'Fetching portfolio...';
      },
    });

    // Study command
    this.registerCommand({
      name: 'study',
      description: 'Get study status',
      handler: async () => {
        this.emit('command:study');
        return 'Fetching study stats...';
      },
    });

    // Trade command
    this.registerCommand({
      name: 'trade',
      description: 'Execute a trade: !trade buy BTC 100',
      handler: async (args) => {
        if (args.length < 3) {
          return '❌ Usage: !trade <buy/sell> <symbol> <amount>';
        }
        const [action, symbol, amount] = args;
        this.emit('command:trade', { action, symbol, amount: parseFloat(amount) });
        return `📤 Trade request submitted: ${action} ${amount} ${symbol}`;
      },
    });

    // Remind command
    this.registerCommand({
      name: 'remind',
      description: 'Set a reminder: !remind 30m Take a break',
      handler: async (args) => {
        if (args.length < 2) {
          return '❌ Usage: !remind <time> <message>';
        }
        const [time, ...messageParts] = args;
        const message = messageParts.join(' ');
        this.emit('command:remind', { time, message });
        return `⏰ Reminder set for ${time}: ${message}`;
      },
    });

    // Pause command
    this.registerCommand({
      name: 'pause',
      description: 'Pause trading bot',
      handler: async () => {
        this.emit('command:pause');
        return '⏸️ Trading bot paused';
      },
    });

    // Resume command
    this.registerCommand({
      name: 'resume',
      description: 'Resume trading bot',
      handler: async () => {
        this.emit('command:resume');
        return '▶️ Trading bot resumed';
      },
    });

    // Goals command
    this.registerCommand({
      name: 'goals',
      description: 'View current goals',
      handler: async () => {
        this.emit('command:goals');
        return 'Fetching goals...';
      },
    });
  }

  private async handleCommand(message: Message): Promise<void> {
    const content = message.content.slice(1).trim();
    const [commandName, ...args] = content.split(/\s+/);
    
    const command = this.commands.get(commandName.toLowerCase());
    
    if (!command) {
      await message.reply(`❓ Unknown command: ${commandName}. Use !help to see available commands.`);
      return;
    }

    try {
      const response = await command.handler(args, message);
      
      if (typeof response === 'string') {
        await message.reply(response);
      } else {
        await message.reply({ embeds: [response] });
      }
      
      logger.info('Command executed', { command: commandName, user: message.author.username });
    } catch (error) {
      logger.error('Command failed', { command: commandName, error: (error as Error).message });
      await message.reply(`❌ Command failed: ${(error as Error).message}`);
    }
  }

  // ==========================================================================
  // Log Streaming
  // ==========================================================================

  async streamLog(level: 'info' | 'warn' | 'error', module: string, message: string): Promise<void> {
    if (!this.isConnected || !this.logChannel) return;

    const levelEmoji = level === 'error' ? '🔴' : level === 'warn' ? '🟡' : '🟢';
    const timestamp = new Date().toLocaleTimeString();

    try {
      await this.logChannel.send(`\`${timestamp}\` ${levelEmoji} **[${module}]** ${message}`);
    } catch {
      // Silently fail - don't spam logs about log failures
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let discordServiceInstance: DiscordService | null = null;

export function getDiscordService(): DiscordService {
  if (!discordServiceInstance) {
    discordServiceInstance = new DiscordService();
  }
  return discordServiceInstance;
}

export function initializeDiscordService(): DiscordService {
  discordServiceInstance = new DiscordService();
  return discordServiceInstance;
}
