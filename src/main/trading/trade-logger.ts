/**
 * Atlas Trading - Trade Logger
 *
 * Logs all trades to the Obsidian brain for historical tracking,
 * analysis, and transparency.
 *
 * @module trading/trade-logger
 */

import * as path from 'path';
import * as fse from 'fs-extra';
import { format } from 'date-fns';
import Decimal from 'decimal.js';
import { ExchangeId, Order, Trade, PriceAlert } from './types';
import { getVaultPath } from '../memory/obsidian-brain';
import { sanitizeFilename } from '../memory/note-writer';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('TradeLogger');

/**
 * Trade log entry
 */
export interface TradeLogEntry {
  timestamp: number;
  datetime: string;
  exchange: ExchangeId;
  symbol: string;
  side: 'buy' | 'sell';
  type: string;
  amount: string;
  price: string;
  cost: string;
  fee?: string;
  feeCurrency?: string;
  orderId: string;
  tradeId?: string;
  status: string;
  notes?: string;
}

/**
 * Get the trading directory in the vault
 */
function getTradingDir(): string {
  const vaultPath = getVaultPath();
  return path.join(vaultPath, 'trading');
}

/**
 * Ensure trading directories exist
 */
async function ensureTradingDirs(): Promise<void> {
  const tradingDir = getTradingDir();
  await fse.ensureDir(tradingDir);
  await fse.ensureDir(path.join(tradingDir, 'orders'));
  await fse.ensureDir(path.join(tradingDir, 'trades'));
  await fse.ensureDir(path.join(tradingDir, 'alerts'));
  await fse.ensureDir(path.join(tradingDir, 'daily'));
}

/**
 * Format a Decimal value for display
 */
function formatDecimal(value: Decimal | undefined): string {
  if (!value) return '0';
  return value.toFixed();
}

/**
 * Log an order to the Obsidian brain
 */
export async function logOrder(order: Order, notes?: string): Promise<string> {
  await ensureTradingDirs();

  const tradingDir = getTradingDir();
  const datetime = order.datetime || new Date(order.timestamp).toISOString();
  const dateStr = format(new Date(order.timestamp), 'yyyy-MM-dd');
  const timeStr = format(new Date(order.timestamp), 'HH-mm-ss');

  const filename = sanitizeFilename(
    `${dateStr}-${timeStr}-${order.symbol}-${order.side}-${order.id}`
  );
  const filePath = path.join(tradingDir, 'orders', `${filename}.md`);

  const content = `---
type: trading-order
order_id: "${order.id}"
client_order_id: "${order.clientOrderId || ''}"
exchange: ${order.exchange}
symbol: ${order.symbol}
side: ${order.side}
order_type: ${order.type}
status: ${order.status}
amount: "${formatDecimal(order.amount)}"
filled: "${formatDecimal(order.filled)}"
remaining: "${formatDecimal(order.remaining)}"
price: "${formatDecimal(order.price)}"
average: "${formatDecimal(order.average)}"
cost: "${formatDecimal(order.cost)}"
fee: "${order.fee ? formatDecimal(order.fee.cost) : '0'}"
fee_currency: "${order.fee?.currency || ''}"
timestamp: ${order.timestamp}
datetime: "${datetime}"
created: "${new Date().toISOString()}"
tags:
  - trading
  - order
  - ${order.exchange}
  - ${order.side}
  - ${order.status}
---

# Order: ${order.symbol} ${order.side.toUpperCase()}

**Exchange:** [[${order.exchange}]]
**Symbol:** ${order.symbol}
**Time:** ${datetime}

## Order Details

| Field | Value |
|-------|-------|
| ID | \`${order.id}\` |
| Side | ${order.side.toUpperCase()} |
| Type | ${order.type} |
| Status | ${order.status} |
| Amount | ${formatDecimal(order.amount)} |
| Filled | ${formatDecimal(order.filled)} |
| Remaining | ${formatDecimal(order.remaining)} |
| Price | ${formatDecimal(order.price)} |
| Average Fill | ${formatDecimal(order.average)} |
| Total Cost | ${formatDecimal(order.cost)} |
| Fee | ${order.fee ? `${formatDecimal(order.fee.cost)} ${order.fee.currency}` : 'N/A'} |

${notes ? `## Notes\n\n${notes}\n` : ''}

---
*Logged by Atlas Trading System*
`;

  await fse.writeFile(filePath, content, 'utf-8');
  logger.info('Order logged', { orderId: order.id, path: filePath });

  // Also add to daily log
  await addToDailyLog('order', order);

  return filePath;
}

/**
 * Log a trade execution to the Obsidian brain
 */
export async function logTrade(trade: Trade, notes?: string): Promise<string> {
  await ensureTradingDirs();

  const tradingDir = getTradingDir();
  const datetime = trade.datetime || new Date(trade.timestamp).toISOString();
  const dateStr = format(new Date(trade.timestamp), 'yyyy-MM-dd');
  const timeStr = format(new Date(trade.timestamp), 'HH-mm-ss');

  const filename = sanitizeFilename(
    `${dateStr}-${timeStr}-${trade.symbol}-${trade.side}-${trade.id}`
  );
  const filePath = path.join(tradingDir, 'trades', `${filename}.md`);

  const content = `---
type: trading-trade
trade_id: "${trade.id}"
order_id: "${trade.orderId}"
exchange: ${trade.exchange}
symbol: ${trade.symbol}
side: ${trade.side}
trade_type: ${trade.type}
amount: "${formatDecimal(trade.amount)}"
price: "${formatDecimal(trade.price)}"
cost: "${formatDecimal(trade.cost)}"
fee: "${trade.fee ? formatDecimal(trade.fee.cost) : '0'}"
fee_currency: "${trade.fee?.currency || ''}"
taker_or_maker: "${trade.takerOrMaker || ''}"
timestamp: ${trade.timestamp}
datetime: "${datetime}"
created: "${new Date().toISOString()}"
tags:
  - trading
  - trade
  - ${trade.exchange}
  - ${trade.side}
---

# Trade: ${trade.symbol} ${trade.side.toUpperCase()}

**Exchange:** [[${trade.exchange}]]
**Symbol:** ${trade.symbol}
**Time:** ${datetime}

## Trade Details

| Field | Value |
|-------|-------|
| Trade ID | \`${trade.id}\` |
| Order ID | \`${trade.orderId}\` |
| Side | ${trade.side.toUpperCase()} |
| Type | ${trade.type} |
| Amount | ${formatDecimal(trade.amount)} |
| Price | ${formatDecimal(trade.price)} |
| Total Cost | ${formatDecimal(trade.cost)} |
| Fee | ${trade.fee ? `${formatDecimal(trade.fee.cost)} ${trade.fee.currency}` : 'N/A'} |
| Taker/Maker | ${trade.takerOrMaker || 'N/A'} |

${notes ? `## Notes\n\n${notes}\n` : ''}

---
*Logged by Atlas Trading System*
`;

  await fse.writeFile(filePath, content, 'utf-8');
  logger.info('Trade logged', { tradeId: trade.id, path: filePath });

  // Also add to daily log
  await addToDailyLog('trade', trade);

  return filePath;
}

/**
 * Log a triggered price alert
 */
export async function logAlert(alert: PriceAlert, currentPrice: Decimal): Promise<string> {
  await ensureTradingDirs();

  const tradingDir = getTradingDir();
  const now = new Date();
  const dateStr = format(now, 'yyyy-MM-dd');
  const timeStr = format(now, 'HH-mm-ss');

  const filename = sanitizeFilename(`${dateStr}-${timeStr}-${alert.symbol}-${alert.condition}`);
  const filePath = path.join(tradingDir, 'alerts', `${filename}.md`);

  const content = `---
type: trading-alert
alert_id: "${alert.id}"
exchange: ${alert.exchange}
symbol: ${alert.symbol}
condition: ${alert.condition}
target: "${formatDecimal(alert.target)}"
current_price: "${formatDecimal(currentPrice)}"
triggered_at: ${now.getTime()}
created_at: ${alert.createdAt}
created: "${now.toISOString()}"
tags:
  - trading
  - alert
  - ${alert.exchange}
  - ${alert.condition}
---

# Alert Triggered: ${alert.symbol}

**Exchange:** [[${alert.exchange}]]
**Symbol:** ${alert.symbol}
**Time:** ${now.toISOString()}

## Alert Details

| Field | Value |
|-------|-------|
| Condition | ${alert.condition} |
| Target Price | ${formatDecimal(alert.target)} |
| Current Price | ${formatDecimal(currentPrice)} |
| Created | ${new Date(alert.createdAt).toISOString()} |

${alert.note ? `## Notes\n\n${alert.note}\n` : ''}

---
*Logged by Atlas Trading System*
`;

  await fse.writeFile(filePath, content, 'utf-8');
  logger.info('Alert logged', { alertId: alert.id, path: filePath });

  return filePath;
}

/**
 * Add entry to daily trading log
 */
async function addToDailyLog(type: 'order' | 'trade', data: Order | Trade): Promise<void> {
  await ensureTradingDirs();

  const tradingDir = getTradingDir();
  const today = format(new Date(), 'yyyy-MM-dd');
  const dailyPath = path.join(tradingDir, 'daily', `${today}.md`);

  // Check if daily log exists
  const exists = await fse.pathExists(dailyPath);

  if (!exists) {
    // Create new daily log
    const content = `---
type: trading-daily
date: "${today}"
created: "${new Date().toISOString()}"
tags:
  - trading
  - daily
---

# Trading Log: ${today}

## Summary

| Metric | Value |
|--------|-------|
| Total Orders | 0 |
| Total Trades | 0 |
| Net P&L | TBD |

## Activity

`;
    await fse.writeFile(dailyPath, content, 'utf-8');
  }

  // Append entry
  const time = format(new Date(data.timestamp), 'HH:mm:ss');
  const symbol = 'symbol' in data ? data.symbol : '';
  const side = 'side' in data ? data.side : '';
  const amount = 'amount' in data ? formatDecimal(data.amount) : '';
  const price = 'price' in data ? formatDecimal(data.price) : '';

  const entry = `\n- **${time}** [${type.toUpperCase()}] ${symbol} ${side.toUpperCase()} ${amount} @ ${price} (${data.exchange})`;

  await fse.appendFile(dailyPath, entry, 'utf-8');
}

/**
 * Get trading statistics for a period
 */
export async function getTradingStats(
  from: Date,
  to: Date,
  exchange?: ExchangeId
): Promise<{
  orders: number;
  trades: number;
  volume: Decimal;
  fees: Decimal;
}> {
  await ensureTradingDirs();

  const tradingDir = getTradingDir();
  const tradesDir = path.join(tradingDir, 'trades');

  const orders = 0;
  let trades = 0;
  let volume = new Decimal(0);
  let fees = new Decimal(0);

  try {
    const files = await fse.readdir(tradesDir);

    for (const file of files) {
      if (!file.endsWith('.md')) continue;

      const filePath = path.join(tradesDir, file);
      const content = await fse.readFile(filePath, 'utf-8');

      // Parse frontmatter
      const match = content.match(/^---\n([\s\S]*?)\n---/);
      if (!match) continue;

      const frontmatter = match[1];
      const timestampMatch = frontmatter.match(/timestamp:\s*(\d+)/);
      const exchangeMatch = frontmatter.match(/exchange:\s*(\w+)/);
      const costMatch = frontmatter.match(/cost:\s*"([^"]+)"/);
      const feeMatch = frontmatter.match(/fee:\s*"([^"]+)"/);

      if (!timestampMatch) continue;

      const timestamp = parseInt(timestampMatch[1], 10);
      const tradeDate = new Date(timestamp);

      if (tradeDate < from || tradeDate > to) continue;
      if (exchange && exchangeMatch && exchangeMatch[1] !== exchange) continue;

      trades++;

      if (costMatch) {
        volume = volume.plus(new Decimal(costMatch[1]));
      }

      if (feeMatch) {
        fees = fees.plus(new Decimal(feeMatch[1]));
      }
    }
  } catch (error) {
    logger.error('Failed to get trading stats', { error });
  }

  return { orders, trades, volume, fees };
}

export default {
  logOrder,
  logTrade,
  logAlert,
  getTradingStats,
};
