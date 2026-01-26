/**
 * Atlas Trading - Credentials Manager
 *
 * Secure storage for exchange API keys using OS keychain.
 * Uses keytar for cross-platform secure credential storage.
 *
 * @module trading/credentials
 */

import keytar from 'keytar';
import { ExchangeId, ExchangeCredentials } from './types';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('CredentialsManager');

/**
 * Service name for keytar storage
 */
const SERVICE_NAME = 'atlas-trading';

/**
 * Account name format: exchange-{id}-{type}
 */
function getAccountName(exchangeId: ExchangeId, type: 'apiKey' | 'secret' | 'extra'): string {
  return `${exchangeId}-${type}`;
}

/**
 * Credentials Manager - Secure storage for exchange API credentials
 */
export class CredentialsManager {
  /**
   * Store credentials for an exchange
   */
  async storeCredentials(exchangeId: ExchangeId, credentials: ExchangeCredentials): Promise<void> {
    try {
      // Store API key
      await keytar.setPassword(
        SERVICE_NAME,
        getAccountName(exchangeId, 'apiKey'),
        credentials.apiKey
      );

      // Store secret
      await keytar.setPassword(
        SERVICE_NAME,
        getAccountName(exchangeId, 'secret'),
        credentials.secret
      );

      // Store extra credentials if present
      if (credentials.extra && Object.keys(credentials.extra).length > 0) {
        await keytar.setPassword(
          SERVICE_NAME,
          getAccountName(exchangeId, 'extra'),
          JSON.stringify(credentials.extra)
        );
      }

      logger.info('Credentials stored securely', { exchangeId });
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to store credentials', { exchangeId, error: err.message });
      throw new Error(`Failed to store credentials for ${exchangeId}: ${err.message}`);
    }
  }

  /**
   * Retrieve credentials for an exchange
   */
  async getCredentials(exchangeId: ExchangeId): Promise<ExchangeCredentials | null> {
    try {
      const apiKey = await keytar.getPassword(SERVICE_NAME, getAccountName(exchangeId, 'apiKey'));
      const secret = await keytar.getPassword(SERVICE_NAME, getAccountName(exchangeId, 'secret'));

      if (!apiKey || !secret) {
        logger.debug('No credentials found', { exchangeId });
        return null;
      }

      const extraJson = await keytar.getPassword(SERVICE_NAME, getAccountName(exchangeId, 'extra'));
      const extra = extraJson ? JSON.parse(extraJson) : undefined;

      logger.debug('Credentials retrieved', { exchangeId });

      return {
        apiKey,
        secret,
        extra,
      };
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to retrieve credentials', { exchangeId, error: err.message });
      throw new Error(`Failed to retrieve credentials for ${exchangeId}: ${err.message}`);
    }
  }

  /**
   * Delete credentials for an exchange
   */
  async deleteCredentials(exchangeId: ExchangeId): Promise<void> {
    try {
      await keytar.deletePassword(SERVICE_NAME, getAccountName(exchangeId, 'apiKey'));
      await keytar.deletePassword(SERVICE_NAME, getAccountName(exchangeId, 'secret'));
      await keytar.deletePassword(SERVICE_NAME, getAccountName(exchangeId, 'extra'));

      logger.info('Credentials deleted', { exchangeId });
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to delete credentials', { exchangeId, error: err.message });
      throw new Error(`Failed to delete credentials for ${exchangeId}: ${err.message}`);
    }
  }

  /**
   * Check if credentials exist for an exchange
   */
  async hasCredentials(exchangeId: ExchangeId): Promise<boolean> {
    try {
      const apiKey = await keytar.getPassword(SERVICE_NAME, getAccountName(exchangeId, 'apiKey'));
      return apiKey !== null;
    } catch (error) {
      return false;
    }
  }

  /**
   * List all exchanges with stored credentials
   */
  async listStoredExchanges(): Promise<ExchangeId[]> {
    try {
      const credentials = await keytar.findCredentials(SERVICE_NAME);
      const exchanges = new Set<ExchangeId>();

      for (const cred of credentials) {
        // Extract exchange ID from account name (format: {exchangeId}-{type})
        const parts = cred.account.split('-');
        if (parts.length >= 2) {
          const exchangeId = parts[0] as ExchangeId;
          if (['binance', 'coinbase', 'schwab', 'metaapi'].includes(exchangeId)) {
            exchanges.add(exchangeId);
          }
        }
      }

      return Array.from(exchanges);
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to list stored exchanges', { error: err.message });
      return [];
    }
  }
}

// Singleton instance
let credentialsManagerInstance: CredentialsManager | null = null;

/**
 * Get the singleton CredentialsManager instance
 */
export function getCredentialsManager(): CredentialsManager {
  if (!credentialsManagerInstance) {
    credentialsManagerInstance = new CredentialsManager();
  }
  return credentialsManagerInstance;
}

export default CredentialsManager;
