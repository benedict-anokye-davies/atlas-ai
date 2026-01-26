/**
 * IPC Handlers - Discord Integration
 *
 * Bridges the Discord Service with the renderer process
 */

import { ipcMain, BrowserWindow } from 'electron';
import { getDiscordService, DiscordConfig, DiscordNotification } from '../integrations/discord';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('DiscordIPC');

export function registerDiscordHandlers(): void {
  const discord = getDiscordService();

  // Forward Discord events to renderer
  discord.on('connected', () => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
      win.webContents.send('discord:connected');
    });
  });

  discord.on('disconnected', () => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
      win.webContents.send('discord:disconnected');
    });
  });

  discord.on('error', (error) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
      win.webContents.send('discord:error', error);
    });
  });

  // Handle Discord commands that need to trigger actions
  discord.on('command:portfolio', async () => {
    try {
      const { getAutonomousBot } = require('../trading/strategies/autonomous-bot');
      const bot = getAutonomousBot();
      
      if (bot) {
        const state = bot.getState();
        await discord.sendNotification({
          type: 'trade',
          title: '📊 Portfolio Summary',
          message: `Total P/L: $${state.totalPnl.toFixed(2)}`,
          fields: [
            { name: 'Active Positions', value: state.positions.length.toString(), inline: true },
            { name: 'Win Rate', value: `${(bot.getWinRate() * 100).toFixed(1)}%`, inline: true },
            { name: 'Trades Today', value: state.tradesToday.toString(), inline: true },
          ],
        });
      } else {
        await discord.sendNotification({
          type: 'system',
          title: '📊 Portfolio Summary',
          message: 'Trading bot not initialized',
        });
      }
    } catch (error) {
      logger.error('Failed to send portfolio', { error: (error as Error).message });
    }
  });

  discord.on('command:study', async () => {
    try {
      const { getStudySystem } = require('../study/study-system');
      const study = getStudySystem();
      const stats = study.getStudyStats();
      const dueCards = study.getDueFlashcards();

      await discord.sendNotification({
        type: 'study',
        title: '📚 Study Status',
        message: `You have ${dueCards.length} flashcards due for review.`,
        fields: [
          { name: 'Total Cards', value: stats.totalFlashcards.toString(), inline: true },
          { name: 'Mastery', value: `${(stats.averageMastery * 100).toFixed(0)}%`, inline: true },
          { name: 'Concepts', value: stats.totalConcepts.toString(), inline: true },
        ],
      });
    } catch (error) {
      logger.error('Failed to send study status', { error: (error as Error).message });
    }
  });

  discord.on('command:trade', async (data: { action: string; symbol: string; amount: number }) => {
    try {
      const { getAutonomousBot } = require('../trading/strategies/autonomous-bot');
      const bot = getAutonomousBot();

      if (!bot || !bot.isRunning()) {
        await discord.sendNotification({
          type: 'alert',
          title: '⚠️ Trade Rejected',
          message: 'Trading bot is not running. Start the bot first.',
        });
        return;
      }

      await discord.sendNotification({
        type: 'system',
        title: '📤 Trade Request Received',
        message: `Requested: ${data.action} ${data.amount} ${data.symbol}`,
      });
    } catch (error) {
      logger.error('Failed to process trade command', { error: (error as Error).message });
    }
  });

  discord.on('command:pause', () => {
    try {
      const { getAutonomousBot } = require('../trading/strategies/autonomous-bot');
      const bot = getAutonomousBot();
      if (bot) {
        bot.stop();
      }
    } catch (error) {
      logger.error('Failed to pause bot', { error: (error as Error).message });
    }
  });

  discord.on('command:resume', () => {
    try {
      const { getAutonomousBot } = require('../trading/strategies/autonomous-bot');
      const bot = getAutonomousBot();
      if (bot) {
        bot.start();
      }
    } catch (error) {
      logger.error('Failed to resume bot', { error: (error as Error).message });
    }
  });

  // Connection
  ipcMain.handle('discord:connect', async (_, config: DiscordConfig) => {
    try {
      await discord.connect(config);
      return { success: true };
    } catch (error) {
      logger.error('Failed to connect to Discord', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('discord:disconnect', async () => {
    try {
      await discord.disconnect();
      return { success: true };
    } catch (error) {
      logger.error('Failed to disconnect from Discord', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('discord:getStatus', async () => {
    try {
      return { success: true, data: discord.getStatus() };
    } catch (error) {
      logger.error('Failed to get Discord status', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Notifications
  ipcMain.handle('discord:sendNotification', async (_, notification: DiscordNotification) => {
    try {
      await discord.sendNotification(notification);
      return { success: true };
    } catch (error) {
      logger.error('Failed to send notification', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('discord:sendTradeAlert', async (_, trade: Parameters<typeof discord.sendTradeAlert>[0]) => {
    try {
      await discord.sendTradeAlert(trade);
      return { success: true };
    } catch (error) {
      logger.error('Failed to send trade alert', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('discord:sendStudyReminder', async (_, topic: string, dueCards: number) => {
    try {
      await discord.sendStudyReminder(topic, dueCards);
      return { success: true };
    } catch (error) {
      logger.error('Failed to send study reminder', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('discord:sendDailySummary', async (_, summary: Parameters<typeof discord.sendDailySummary>[0]) => {
    try {
      await discord.sendDailySummary(summary);
      return { success: true };
    } catch (error) {
      logger.error('Failed to send daily summary', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Command registration
  ipcMain.handle('discord:registerCommand', async (_, command: { name: string; description: string }) => {
    try {
      discord.registerCommand({
        ...command,
        handler: async () => `Custom command: ${command.name}`,
      });
      return { success: true };
    } catch (error) {
      logger.error('Failed to register command', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  logger.info('Discord IPC handlers registered');
}
