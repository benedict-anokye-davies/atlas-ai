/**
 * Atlas Banking - Payee Validator (UK Confirmation of Payee)
 *
 * Validates UK bank account details before payment.
 * Uses Confirmation of Payee (CoP) to verify name matches account.
 *
 * @module banking/payee-validator
 */

import { EventEmitter } from 'events';
import { createModuleLogger } from '../utils/logger';
import { app } from 'electron';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';

const logger = createModuleLogger('PayeeValidator');

/**
 * CoP match result
 */
export type CoPMatchResult = 
  | 'exact_match'      // Name matches exactly
  | 'close_match'      // Name is similar
  | 'no_match'         // Name doesn't match
  | 'unavailable'      // CoP not available for this account
  | 'error';           // Validation failed

/**
 * Validation result
 */
export interface PayeeValidationResult {
  isValid: boolean;
  sortCode: string;
  accountNumber: string;
  providedName: string;
  matchResult: CoPMatchResult;
  suggestedName?: string;
  confidence: number;
  warnings: string[];
  timestamp: number;
}

/**
 * Saved payee
 */
export interface SavedPayee {
  id: string;
  name: string;
  nickname?: string;
  sortCode: string;
  accountNumber: string;
  verified: boolean;
  lastUsed?: number;
  useCount: number;
  createdAt: number;
}

/**
 * UK Bank data for validation
 */
interface UKBankData {
  sortCodeRanges: Array<{
    start: string;
    end: string;
    bankName: string;
    validationMethod: 'standard' | 'exception';
  }>;
}

// Basic UK sort code to bank mapping (simplified)
const UK_BANKS: Record<string, string> = {
  '01': 'National Westminster Bank',
  '04': 'Barclays Bank',
  '05': 'Clydesdale Bank',
  '07': 'Nationwide Building Society',
  '08': 'Co-operative Bank',
  '09': 'Santander',
  '11': 'HSBC',
  '12': 'Bank of Scotland',
  '13': 'Bank of Scotland',
  '14': 'Bank of Scotland',
  '15': 'Bank of Scotland',
  '16': 'Royal Bank of Scotland',
  '17': 'Royal Bank of Scotland',
  '18': 'Royal Bank of Scotland',
  '19': 'Royal Bank of Scotland',
  '20': 'Barclays Bank',
  '30': 'Lloyds Bank',
  '40': 'HSBC',
  '60': 'National Westminster Bank',
  '70': 'Nationwide Building Society',
  '77': 'TSB Bank',
  '80': 'Bank of Scotland',
  '82': 'Clydesdale Bank',
  '83': 'Santander',
  '87': 'Santander',
  '89': 'Santander',
};

/**
 * Payee Validator
 */
export class PayeeValidator extends EventEmitter {
  private savedPayees: Map<string, SavedPayee> = new Map();
  private validationHistory: PayeeValidationResult[] = [];
  private dataPath: string;

  constructor() {
    super();
    this.dataPath = join(app.getPath('userData'), 'banking');
    this.loadData();
  }

  /**
   * Load payee data
   */
  private loadData(): void {
    try {
      const filePath = join(this.dataPath, 'payees.json');
      if (existsSync(filePath)) {
        const data = JSON.parse(readFileSync(filePath, 'utf-8'));
        this.savedPayees = new Map(Object.entries(data.payees || {}));
        this.validationHistory = data.validationHistory || [];
        logger.info('Loaded payee data', { payees: this.savedPayees.size });
      }
    } catch (error) {
      logger.warn('Failed to load payee data', { error: (error as Error).message });
    }
  }

  /**
   * Save payee data
   */
  private saveData(): void {
    try {
      if (!existsSync(this.dataPath)) {
        mkdirSync(this.dataPath, { recursive: true });
      }
      const filePath = join(this.dataPath, 'payees.json');
      const data = {
        payees: Object.fromEntries(this.savedPayees),
        validationHistory: this.validationHistory.slice(-500),
      };
      writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error('Failed to save payee data', { error: (error as Error).message });
    }
  }

  /**
   * Validate UK sort code format
   */
  validateSortCode(sortCode: string): { valid: boolean; formatted: string; bankName?: string } {
    // Remove all non-digits
    const cleaned = sortCode.replace(/[^0-9]/g, '');

    if (cleaned.length !== 6) {
      return { valid: false, formatted: sortCode };
    }

    // Format as XX-XX-XX
    const formatted = `${cleaned.slice(0, 2)}-${cleaned.slice(2, 4)}-${cleaned.slice(4, 6)}`;

    // Look up bank name
    const prefix = cleaned.slice(0, 2);
    const bankName = UK_BANKS[prefix];

    return { valid: true, formatted, bankName };
  }

  /**
   * Validate UK account number format
   */
  validateAccountNumber(accountNumber: string): { valid: boolean; formatted: string } {
    // Remove all non-digits
    const cleaned = accountNumber.replace(/[^0-9]/g, '');

    if (cleaned.length !== 8) {
      return { valid: false, formatted: accountNumber };
    }

    return { valid: true, formatted: cleaned };
  }

  /**
   * Perform UK Modulus check (simplified version)
   * Full implementation would require the BACS modulus checking algorithm
   */
  private performModulusCheck(sortCode: string, accountNumber: string): boolean {
    // This is a simplified check - real implementation needs BACS modulus weights
    // For now, we just validate format
    const sc = sortCode.replace(/[^0-9]/g, '');
    const an = accountNumber.replace(/[^0-9]/g, '');

    return sc.length === 6 && an.length === 8;
  }

  /**
   * Validate payee details
   * In production, this would call the UK Confirmation of Payee API
   */
  async validatePayee(
    name: string,
    sortCode: string,
    accountNumber: string
  ): Promise<PayeeValidationResult> {
    const warnings: string[] = [];

    // Validate sort code
    const scResult = this.validateSortCode(sortCode);
    if (!scResult.valid) {
      return {
        isValid: false,
        sortCode,
        accountNumber,
        providedName: name,
        matchResult: 'error',
        confidence: 0,
        warnings: ['Invalid sort code format. UK sort codes must be 6 digits.'],
        timestamp: Date.now(),
      };
    }

    // Validate account number
    const anResult = this.validateAccountNumber(accountNumber);
    if (!anResult.valid) {
      return {
        isValid: false,
        sortCode: scResult.formatted,
        accountNumber,
        providedName: name,
        matchResult: 'error',
        confidence: 0,
        warnings: ['Invalid account number format. UK account numbers must be 8 digits.'],
        timestamp: Date.now(),
      };
    }

    // Perform modulus check
    if (!this.performModulusCheck(scResult.formatted, anResult.formatted)) {
      warnings.push('Account details may not be valid - please double-check');
    }

    // Check if we have this payee saved
    const savedPayee = this.findSavedPayee(scResult.formatted, anResult.formatted);

    if (savedPayee) {
      // Check name similarity
      const similarity = this.calculateNameSimilarity(name, savedPayee.name);

      if (similarity >= 0.9) {
        return {
          isValid: true,
          sortCode: scResult.formatted,
          accountNumber: anResult.formatted,
          providedName: name,
          matchResult: 'exact_match',
          suggestedName: savedPayee.name,
          confidence: 1,
          warnings,
          timestamp: Date.now(),
        };
      } else if (similarity >= 0.6) {
        warnings.push(`Name provided differs from saved payee name: "${savedPayee.name}"`);
        return {
          isValid: true,
          sortCode: scResult.formatted,
          accountNumber: anResult.formatted,
          providedName: name,
          matchResult: 'close_match',
          suggestedName: savedPayee.name,
          confidence: similarity,
          warnings,
          timestamp: Date.now(),
        };
      } else {
        warnings.push(`Name provided does not match saved payee: "${savedPayee.name}"`);
        return {
          isValid: false,
          sortCode: scResult.formatted,
          accountNumber: anResult.formatted,
          providedName: name,
          matchResult: 'no_match',
          suggestedName: savedPayee.name,
          confidence: similarity,
          warnings,
          timestamp: Date.now(),
        };
      }
    }

    // In production, this would call the actual CoP API
    // For now, return unavailable with basic validation
    if (scResult.bankName) {
      warnings.push(`Bank identified as: ${scResult.bankName}`);
    } else {
      warnings.push('Unable to identify bank from sort code');
    }

    const result: PayeeValidationResult = {
      isValid: true,
      sortCode: scResult.formatted,
      accountNumber: anResult.formatted,
      providedName: name,
      matchResult: 'unavailable',
      confidence: 0.5,
      warnings: [
        ...warnings,
        'Confirmation of Payee not available - please verify details carefully',
      ],
      timestamp: Date.now(),
    };

    this.validationHistory.push(result);
    this.saveData();

    return result;
  }

  /**
   * Calculate name similarity (Levenshtein-based)
   */
  private calculateNameSimilarity(name1: string, name2: string): number {
    const s1 = name1.toLowerCase().trim();
    const s2 = name2.toLowerCase().trim();

    if (s1 === s2) return 1;

    const len1 = s1.length;
    const len2 = s2.length;

    if (len1 === 0 || len2 === 0) return 0;

    // Create distance matrix
    const matrix: number[][] = [];
    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= len2; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }

    const distance = matrix[len1][len2];
    const maxLen = Math.max(len1, len2);
    return 1 - distance / maxLen;
  }

  /**
   * Find saved payee by account details
   */
  findSavedPayee(sortCode: string, accountNumber: string): SavedPayee | undefined {
    const sc = sortCode.replace(/[^0-9]/g, '');
    const an = accountNumber.replace(/[^0-9]/g, '');

    return Array.from(this.savedPayees.values()).find(
      (p) =>
        p.sortCode.replace(/[^0-9]/g, '') === sc &&
        p.accountNumber.replace(/[^0-9]/g, '') === an
    );
  }

  /**
   * Save a payee
   */
  savePayee(
    name: string,
    sortCode: string,
    accountNumber: string,
    nickname?: string
  ): SavedPayee {
    const scResult = this.validateSortCode(sortCode);
    const anResult = this.validateAccountNumber(accountNumber);

    if (!scResult.valid || !anResult.valid) {
      throw new Error('Invalid account details');
    }

    // Check for existing
    const existing = this.findSavedPayee(scResult.formatted, anResult.formatted);
    if (existing) {
      existing.name = name;
      if (nickname) existing.nickname = nickname;
      existing.verified = true;
      this.saveData();
      return existing;
    }

    const payee: SavedPayee = {
      id: `payee_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name,
      nickname,
      sortCode: scResult.formatted,
      accountNumber: anResult.formatted,
      verified: true,
      useCount: 0,
      createdAt: Date.now(),
    };

    this.savedPayees.set(payee.id, payee);
    this.saveData();

    logger.info('Saved payee', { name, sortCode: scResult.formatted });
    this.emit('payeeSaved', payee);

    return payee;
  }

  /**
   * Get all saved payees
   */
  getSavedPayees(): SavedPayee[] {
    return Array.from(this.savedPayees.values()).sort((a, b) => {
      // Sort by most recently used, then by name
      if (a.lastUsed && b.lastUsed) return b.lastUsed - a.lastUsed;
      if (a.lastUsed) return -1;
      if (b.lastUsed) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  /**
   * Search saved payees
   */
  searchPayees(query: string): SavedPayee[] {
    const q = query.toLowerCase();
    return this.getSavedPayees().filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.nickname?.toLowerCase().includes(q) ||
        p.sortCode.includes(q) ||
        p.accountNumber.includes(q)
    );
  }

  /**
   * Mark payee as used
   */
  markPayeeUsed(id: string): void {
    const payee = this.savedPayees.get(id);
    if (payee) {
      payee.lastUsed = Date.now();
      payee.useCount++;
      this.saveData();
    }
  }

  /**
   * Delete saved payee
   */
  deletePayee(id: string): boolean {
    const deleted = this.savedPayees.delete(id);
    if (deleted) {
      this.saveData();
      this.emit('payeeDeleted', id);
    }
    return deleted;
  }

  /**
   * Get frequently used payees
   */
  getFrequentPayees(limit: number = 5): SavedPayee[] {
    return this.getSavedPayees()
      .filter((p) => p.useCount > 0)
      .sort((a, b) => b.useCount - a.useCount)
      .slice(0, limit);
  }

  /**
   * Get recent payees
   */
  getRecentPayees(limit: number = 5): SavedPayee[] {
    return this.getSavedPayees()
      .filter((p) => p.lastUsed)
      .sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0))
      .slice(0, limit);
  }

  /**
   * Validate and get bank name from sort code
   */
  getBankFromSortCode(sortCode: string): { bankName: string; valid: boolean } | null {
    const result = this.validateSortCode(sortCode);
    if (!result.valid) return null;

    return {
      bankName: result.bankName || 'Unknown Bank',
      valid: result.valid,
    };
  }

  /**
   * Get validation history
   */
  getValidationHistory(limit: number = 50): PayeeValidationResult[] {
    return this.validationHistory
      .slice(-limit)
      .reverse();
  }
}

// Singleton instance
let validator: PayeeValidator | null = null;

export function getPayeeValidator(): PayeeValidator {
  if (!validator) {
    validator = new PayeeValidator();
  }
  return validator;
}
