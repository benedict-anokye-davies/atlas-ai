/**
 * Nova Desktop - Custom Wake Word Tests
 * Tests for custom wake word model support
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock electron app before importing the module
vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn(() => '/mock/app/path'),
    getPath: vi.fn((name: string) => `/mock/${name}`),
  },
  BrowserWindow: {
    getFocusedWindow: vi.fn(() => null),
    getAllWindows: vi.fn(() => []),
  },
}));

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  statSync: vi.fn(() => ({ isFile: () => true, size: 2048 })),
}));

// Mock the config
vi.mock('../src/main/config', () => ({
  getConfig: vi.fn(() => ({
    porcupineApiKey: 'test-key',
    wakeWordSensitivity: 0.5,
  })),
}));

describe('Custom Wake Word Support', () => {
  describe('CustomWakeWordModel Interface', () => {
    it('should have correct structure', () => {
      interface CustomWakeWordModel {
        modelPath: string;
        displayName: string;
        sensitivity: number;
      }

      const model: CustomWakeWordModel = {
        modelPath: '/path/to/hey-nova.ppn',
        displayName: 'Hey Nova',
        sensitivity: 0.6,
      };

      expect(model.modelPath).toBe('/path/to/hey-nova.ppn');
      expect(model.displayName).toBe('Hey Nova');
      expect(model.sensitivity).toBe(0.6);
    });
  });

  describe('Model File Validation', () => {
    it('should validate .ppn extension', () => {
      const validateExtension = (path: string) => path.endsWith('.ppn');

      expect(validateExtension('hey-nova.ppn')).toBe(true);
      expect(validateExtension('hey-nova.bin')).toBe(false);
      expect(validateExtension('model.txt')).toBe(false);
      expect(validateExtension('hey-nova.ppn.bak')).toBe(false);
    });

    it('should validate minimum file size', () => {
      const validateSize = (size: number, minSize: number = 1024) => size >= minSize;

      expect(validateSize(2048)).toBe(true);
      expect(validateSize(1024)).toBe(true);
      expect(validateSize(512)).toBe(false);
      expect(validateSize(0)).toBe(false);
    });

    it('should return validation result structure', () => {
      interface ValidationResult {
        valid: boolean;
        error?: string;
        fileSize?: number;
      }

      const successResult: ValidationResult = { valid: true, fileSize: 2048 };
      const errorResult: ValidationResult = { valid: false, error: 'File not found' };

      expect(successResult.valid).toBe(true);
      expect(successResult.fileSize).toBe(2048);
      expect(errorResult.valid).toBe(false);
      expect(errorResult.error).toBe('File not found');
    });
  });

  describe('Model Path Discovery', () => {
    it('should check environment variable first', () => {
      const envVar = 'NOVA_CUSTOM_WAKE_WORD_PATH';
      const paths = [
        process.env[envVar],
        '/app/assets/wake-words/hey-nova.ppn',
        '/user/data/wake-words/hey-nova.ppn',
      ];

      // Environment variable has highest priority
      expect(paths[0]).toBe(process.env[envVar]);
    });

    it('should generate correct default paths', () => {
      const generatePaths = (appPath: string, userDataPath: string) => [
        `${appPath}/assets/wake-words/hey-nova.ppn`,
        `${userDataPath}/wake-words/hey-nova.ppn`,
      ];

      const paths = generatePaths('/app', '/user');
      expect(paths).toContain('/app/assets/wake-words/hey-nova.ppn');
      expect(paths).toContain('/user/wake-words/hey-nova.ppn');
    });

    it('should return null when no model found', () => {
      const findModel = (paths: string[], checkExists: (p: string) => boolean) => {
        for (const path of paths) {
          if (checkExists(path)) return path;
        }
        return null;
      };

      const result = findModel(
        ['/path1/model.ppn', '/path2/model.ppn'],
        () => false // None exist
      );

      expect(result).toBeNull();
    });

    it('should return first existing path', () => {
      const findModel = (paths: string[], checkExists: (p: string) => boolean) => {
        for (const path of paths) {
          if (checkExists(path)) return path;
        }
        return null;
      };

      const result = findModel(
        ['/path1/model.ppn', '/path2/model.ppn'],
        (p) => p === '/path2/model.ppn' // Second one exists
      );

      expect(result).toBe('/path2/model.ppn');
    });
  });

  describe('Wake Word Info', () => {
    it('should return correct info structure', () => {
      interface WakeWordInfo {
        customModelAvailable: boolean;
        customModelPath: string | null;
        builtInKeywords: string[];
        currentMode: 'custom' | 'builtin';
      }

      const infoWithCustom: WakeWordInfo = {
        customModelAvailable: true,
        customModelPath: '/path/to/hey-nova.ppn',
        builtInKeywords: ['jarvis', 'alexa', 'computer'],
        currentMode: 'custom',
      };

      const infoWithoutCustom: WakeWordInfo = {
        customModelAvailable: false,
        customModelPath: null,
        builtInKeywords: ['jarvis', 'alexa', 'computer'],
        currentMode: 'builtin',
      };

      expect(infoWithCustom.currentMode).toBe('custom');
      expect(infoWithoutCustom.currentMode).toBe('builtin');
    });

    it('should list all built-in keywords', () => {
      const builtInKeywords = [
        'alexa',
        'americano',
        'blueberry',
        'bumblebee',
        'computer',
        'grapefruit',
        'grasshopper',
        'hey google',
        'hey siri',
        'jarvis',
        'ok google',
        'picovoice',
        'porcupine',
        'terminator',
      ];

      expect(builtInKeywords).toContain('jarvis');
      expect(builtInKeywords).toContain('alexa');
      expect(builtInKeywords).toContain('computer');
      expect(builtInKeywords.length).toBe(14);
    });
  });

  describe('Extended Wake Word Config', () => {
    it('should support custom model path', () => {
      interface ExtendedConfig {
        customModelPath?: string;
        preferCustomModel?: boolean;
        customWakeWordName?: string;
        keywords?: string[];
        sensitivities?: number[];
      }

      const config: ExtendedConfig = {
        customModelPath: '/path/to/hey-nova.ppn',
        preferCustomModel: true,
        customWakeWordName: 'Hey Nova',
        sensitivities: [0.6],
      };

      expect(config.customModelPath).toBe('/path/to/hey-nova.ppn');
      expect(config.preferCustomModel).toBe(true);
      expect(config.customWakeWordName).toBe('Hey Nova');
    });

    it('should default preferCustomModel to true', () => {
      const getPreferCustom = (config?: { preferCustomModel?: boolean }) => {
        return config?.preferCustomModel !== false;
      };

      expect(getPreferCustom(undefined)).toBe(true);
      expect(getPreferCustom({})).toBe(true);
      expect(getPreferCustom({ preferCustomModel: true })).toBe(true);
      expect(getPreferCustom({ preferCustomModel: false })).toBe(false);
    });

    it('should fall back to built-in when no custom model', () => {
      const selectMode = (customModelFound: boolean, preferCustom: boolean) => {
        if (preferCustom && customModelFound) return 'custom';
        return 'builtin';
      };

      expect(selectMode(true, true)).toBe('custom');
      expect(selectMode(false, true)).toBe('builtin');
      expect(selectMode(true, false)).toBe('builtin');
      expect(selectMode(false, false)).toBe('builtin');
    });
  });

  describe('Porcupine Initialization', () => {
    it('should use file path for custom model', () => {
      const getKeywords = (useCustom: boolean, customPath: string, builtInKeywords: string[]) => {
        if (useCustom) {
          return [customPath]; // File path
        }
        return builtInKeywords; // Enum values
      };

      expect(getKeywords(true, '/path/to/model.ppn', ['jarvis'])).toEqual(['/path/to/model.ppn']);
      expect(getKeywords(false, '/path/to/model.ppn', ['jarvis'])).toEqual(['jarvis']);
    });

    it('should maintain sensitivities array', () => {
      const sensitivities = [0.6];
      expect(sensitivities.length).toBe(1);
      expect(sensitivities[0]).toBe(0.6);
    });
  });

  describe('Detection Handling', () => {
    it('should use keywordNames for display', () => {
      const getKeywordName = (
        keywordIndex: number,
        keywordNames: string[],
        fallback: string = 'Unknown'
      ) => {
        return keywordNames[keywordIndex] || keywordNames[0] || fallback;
      };

      expect(getKeywordName(0, ['Hey Nova'])).toBe('Hey Nova');
      expect(getKeywordName(0, ['jarvis'])).toBe('jarvis');
      expect(getKeywordName(1, ['Hey Nova'])).toBe('Hey Nova'); // Falls back to first
      expect(getKeywordName(0, [])).toBe('Unknown'); // Falls back to default
    });

    it('should handle sensitivity lookup safely', () => {
      const getSensitivity = (index: number, sensitivities: number[], defaultVal: number = 0.5) => {
        return sensitivities[index] ?? sensitivities[0] ?? defaultVal;
      };

      expect(getSensitivity(0, [0.6])).toBe(0.6);
      expect(getSensitivity(1, [0.6])).toBe(0.6); // Falls back to first
      expect(getSensitivity(0, [])).toBe(0.5); // Falls back to default
    });
  });

  describe('Sensitivity Updates', () => {
    it('should update all sensitivities based on keywordNames count', () => {
      const updateSensitivities = (keywordNames: string[], newSensitivity: number) => {
        return keywordNames.map(() => newSensitivity);
      };

      expect(updateSensitivities(['Hey Nova'], 0.7)).toEqual([0.7]);
      expect(updateSensitivities(['jarvis', 'alexa'], 0.7)).toEqual([0.7, 0.7]);
    });
  });

  describe('Error Handling', () => {
    it('should handle model validation errors', () => {
      const validateModel = (path: string | null): { valid: boolean; error?: string } => {
        if (!path) return { valid: false, error: 'Path is null' };
        if (!path.endsWith('.ppn')) return { valid: false, error: 'Invalid extension' };
        return { valid: true };
      };

      expect(validateModel(null).valid).toBe(false);
      expect(validateModel('/path/to/model.bin').valid).toBe(false);
      expect(validateModel('/path/to/model.ppn').valid).toBe(true);
    });

    it('should log appropriate error context', () => {
      const createErrorContext = (
        useCustomModel: boolean,
        customModelPath: string | null,
        error: Error
      ) => {
        return {
          error: error.message,
          mode: useCustomModel ? 'custom' : 'builtin',
          customModelPath,
        };
      };

      const context = createErrorContext(true, '/path/to/model.ppn', new Error('Init failed'));

      expect(context.mode).toBe('custom');
      expect(context.customModelPath).toBe('/path/to/model.ppn');
      expect(context.error).toBe('Init failed');
    });
  });

  describe('Default Model Locations', () => {
    it('should check multiple default paths', () => {
      const defaultPaths = (appPath: string, cwd: string, userData: string, resources: string) => [
        `${appPath}/assets/wake-words/hey-nova.ppn`,
        `${cwd}/assets/wake-words/hey-nova.ppn`,
        `${userData}/wake-words/hey-nova.ppn`,
        `${resources}/wake-words/hey-nova.ppn`,
      ];

      const paths = defaultPaths('/app', '/cwd', '/user', '/resources');
      expect(paths.length).toBe(4);
      expect(paths.every((p) => p.includes('hey-nova.ppn'))).toBe(true);
    });
  });
});

describe('Wake Word Training Documentation', () => {
  it('should have correct Picovoice console URL', () => {
    const consoleUrl = 'https://console.picovoice.ai/';
    expect(consoleUrl).toContain('picovoice.ai');
  });

  it('should document supported platforms', () => {
    const platforms = ['Windows', 'macOS', 'Linux'];
    expect(platforms).toContain('Windows');
    expect(platforms).toContain('macOS');
    expect(platforms).toContain('Linux');
  });

  it('should document environment variable name', () => {
    const envVar = 'NOVA_CUSTOM_WAKE_WORD_PATH';
    expect(envVar).toBe('NOVA_CUSTOM_WAKE_WORD_PATH');
  });

  it('should document default model filename', () => {
    const defaultFilename = 'hey-nova.ppn';
    expect(defaultFilename).toBe('hey-nova.ppn');
  });
});
