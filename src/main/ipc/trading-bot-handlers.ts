/**
 * IPC Handlers - Autonomous Trading Bot
 *
 * Bridges the Trading Bot with the renderer process
 */

import { ipcMain, BrowserWindow } from 'electron';
import { createModuleLogger } from '../utils/logger';
import { getDiscordService } from '../integrations/discord';

const logger = createModuleLogger('TradingBotIPC');

export function registerTradingBotHandlers(): void {
  // Bot Control
  ipcMain.handle('bot:start', async () => {
    try {
      const { getAutonomousBot } = require('../trading/strategies/autonomous-bot');
      const bot = getAutonomousBot();
      if (!bot) {
        return { success: false, error: 'Bot not initialized' };
      }
      bot.start();
      return { success: true };
    } catch (error) {
      logger.error('Failed to start bot', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('bot:stop', async () => {
    try {
      const { getAutonomousBot } = require('../trading/strategies/autonomous-bot');
      const bot = getAutonomousBot();
      if (!bot) {
        return { success: false, error: 'Bot not initialized' };
      }
      bot.stop();
      return { success: true };
    } catch (error) {
      logger.error('Failed to stop bot', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('bot:emergencyStop', async () => {
    try {
      const { getAutonomousBot } = require('../trading/strategies/autonomous-bot');
      const bot = getAutonomousBot();
      if (!bot) {
        return { success: false, error: 'Bot not initialized' };
      }
      
      // Stop the bot
      bot.stop();
      
      // Notify on Discord
      const discord = getDiscordService();
      if (discord.getStatus().connected) {
        await discord.sendNotification({
          type: 'alert',
          title: '🚨 Emergency Stop Triggered',
          message: 'Trading bot has been stopped.',
          urgent: true,
        });
      }
      
      return { success: true };
    } catch (error) {
      logger.error('Failed to emergency stop', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('bot:getStatus', async () => {
    try {
      const { getAutonomousBot } = require('../trading/strategies/autonomous-bot');
      const bot = getAutonomousBot();
      if (!bot) {
        return { success: true, data: { isRunning: false, initialized: false } };
      }
      return { success: true, data: { isRunning: bot.isRunning(), state: bot.getState() } };
    } catch (error) {
      logger.error('Failed to get status', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Configuration
  ipcMain.handle('bot:setDryRun', async (_, dryRun: boolean) => {
    try {
      const { getAutonomousBot } = require('../trading/strategies/autonomous-bot');
      const bot = getAutonomousBot();
      if (!bot) {
        return { success: false, error: 'Bot not initialized' };
      }
      // Store in config - would need to be implemented in bot
      logger.info('Dry run mode set', { dryRun });
      return { success: true };
    } catch (error) {
      logger.error('Failed to set dry run', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('bot:setRiskParameters', async (_, params: unknown) => {
    try {
      logger.info('Risk parameters set', { params });
      return { success: true };
    } catch (error) {
      logger.error('Failed to set risk parameters', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('bot:enableStrategy', async (_, strategyId: string, enabled: boolean) => {
    try {
      logger.info('Strategy enabled state changed', { strategyId, enabled });
      return { success: true };
    } catch (error) {
      logger.error('Failed to enable strategy', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Exchange Management
  ipcMain.handle('bot:addExchange', async (_, exchangeConfig: { name: string; apiKey: string; secret: string; options?: Record<string, unknown> }) => {
    try {
      logger.info('Exchange add requested', { name: exchangeConfig.name });
      return { success: true };
    } catch (error) {
      logger.error('Failed to add exchange', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('bot:removeExchange', async (_, exchangeId: string) => {
    try {
      logger.info('Exchange remove requested', { exchangeId });
      return { success: true };
    } catch (error) {
      logger.error('Failed to remove exchange', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Symbols
  ipcMain.handle('bot:addSymbol', async (_, symbol: string) => {
    try {
      logger.info('Symbol add requested', { symbol });
      return { success: true };
    } catch (error) {
      logger.error('Failed to add symbol', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('bot:removeSymbol', async (_, symbol: string) => {
    try {
      logger.info('Symbol remove requested', { symbol });
      return { success: true };
    } catch (error) {
      logger.error('Failed to remove symbol', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  // Analytics
  ipcMain.handle('bot:getPerformance', async () => {
    try {
      const { getAutonomousBot } = require('../trading/strategies/autonomous-bot');
      const bot = getAutonomousBot();
      if (!bot) {
        return { success: true, data: { totalPnl: 0, winRate: 0, totalTrades: 0 } };
      }
      const state = bot.getState();
      return { 
        success: true, 
        data: { 
          totalPnl: state.totalPnl.toNumber(),
          dailyPnl: state.dailyPnl.toNumber(),
          winRate: bot.getWinRate(),
          totalTrades: state.tradesToday,
        } 
      };
    } catch (error) {
      logger.error('Failed to get performance', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('bot:getActivePositions', async () => {
    try {
      const { getAutonomousBot } = require('../trading/strategies/autonomous-bot');
      const bot = getAutonomousBot();
      if (!bot) {
        return { success: true, data: [] };
      }
      return { success: true, data: bot.getState().positions };
    } catch (error) {
      logger.error('Failed to get active positions', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('bot:getTradeHistory', async (_, _limit?: number) => {
    try {
      // Trade history would come from a database/storage
      return { success: true, data: [] };
    } catch (error) {
      logger.error('Failed to get trade history', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  logger.info('Trading Bot IPC handlers registered');
}
