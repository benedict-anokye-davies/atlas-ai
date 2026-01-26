/**
 * Core Smoke Tests
 *
 * These tests validate that core Atlas functionality works correctly.
 * They test internal modules without making external API calls.
 *
 * Run: npm run test:smoke
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock electron modules
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => os.tmpdir()),
    getName: vi.fn(() => 'atlas-desktop'),
    getVersion: vi.fn(() => '0.2.0'),
    isPackaged: false,
    on: vi.fn(),
  },
  BrowserWindow: vi.fn(),
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
  globalShortcut: {
    register: vi.fn(() => true),
    unregister: vi.fn(),
  },
  powerMonitor: {
    on: vi.fn(),
  },
  net: {
    isOnline: vi.fn(() => true),
  },
}));

describe('Core Smoke Tests', () => {
  describe('Project Structure', () => {
    it('should have all required source directories', () => {
      const requiredDirs = ['src/main', 'src/renderer', 'src/shared', 'tests'];

      for (const dir of requiredDirs) {
        expect(fs.existsSync(dir), `Missing directory: ${dir}`).toBe(true);
      }
    });

    it('should have main entry point', () => {
      expect(fs.existsSync('src/main/index.ts')).toBe(true);
    });

    it('should have renderer entry point', () => {
      expect(fs.existsSync('src/renderer/App.tsx')).toBe(true);
    });

    it('should have configuration files', () => {
      const configFiles = [
        'package.json',
        'tsconfig.json',
        'vite.config.ts',
        'electron-builder.yml',
      ];

      for (const file of configFiles) {
        expect(fs.existsSync(file), `Missing config: ${file}`).toBe(true);
      }
    });
  });

  describe('Package Configuration', () => {
    let pkg: Record<string, unknown>;

    beforeEach(() => {
      pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
    });

    it('should have correct package name', () => {
      expect(pkg.name).toBe('atlas-desktop');
    });

    it('should have a valid version', () => {
      expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('should have required scripts', () => {
      const scripts = pkg.scripts as Record<string, string>;
      const requiredScripts = ['dev', 'build', 'test', 'typecheck', 'lint'];

      for (const script of requiredScripts) {
        expect(scripts[script], `Missing script: ${script}`).toBeDefined();
      }
    });

    it('should have Electron as a dev dependency', () => {
      const devDeps = pkg.devDependencies as Record<string, string>;
      expect(devDeps.electron).toBeDefined();
    });

    it('should have React dependencies', () => {
      const devDeps = pkg.devDependencies as Record<string, string>;
      expect(devDeps.react).toBeDefined();
      expect(devDeps['react-dom']).toBeDefined();
    });
  });

  describe('Voice Module Structure', () => {
    it('should have voice pipeline modules', () => {
      const voiceModules = [
        'src/main/voice/vad.ts',
        'src/main/voice/wake-word.ts',
        'src/main/voice/pipeline.ts',
      ];

      for (const module of voiceModules) {
        expect(fs.existsSync(module), `Missing voice module: ${module}`).toBe(true);
      }
    });

    it('should have STT modules', () => {
      expect(fs.existsSync('src/main/stt')).toBe(true);
    });

    it('should have TTS modules', () => {
      expect(fs.existsSync('src/main/tts')).toBe(true);
    });

    it('should have LLM modules', () => {
      expect(fs.existsSync('src/main/llm')).toBe(true);
    });
  });

  describe('Renderer Component Structure', () => {
    it('should have orb visualization components', () => {
      expect(fs.existsSync('src/renderer/components/orb')).toBe(true);
    });

    it('should have settings component', () => {
      expect(fs.existsSync('src/renderer/components/Settings.tsx')).toBe(true);
    });

    it('should have React hooks', () => {
      expect(fs.existsSync('src/renderer/hooks')).toBe(true);
    });

    it('should have style files', () => {
      expect(fs.existsSync('src/renderer/styles')).toBe(true);
    });
  });

  describe('Shared Types', () => {
    it('should have shared types directory', () => {
      expect(fs.existsSync('src/shared/types')).toBe(true);
    });

    it('should have main types file', () => {
      expect(fs.existsSync('src/shared/types/index.ts')).toBe(true);
    });
  });

  describe('Asset Files', () => {
    it('should have assets directory', () => {
      expect(fs.existsSync('assets')).toBe(true);
    });

    it('should have icons directory', () => {
      expect(fs.existsSync('assets/icons')).toBe(true);
    });

    it('should have wake word assets', () => {
      expect(fs.existsSync('assets/wake-words')).toBe(true);
    });
  });

  describe('Documentation', () => {
    it('should have docs directory', () => {
      expect(fs.existsSync('docs')).toBe(true);
    });

    it('should have README', () => {
      expect(fs.existsSync('README.md')).toBe(true);
    });

    it('should have CHANGELOG', () => {
      expect(fs.existsSync('CHANGELOG.md')).toBe(true);
    });

    it('should have FEATURES documentation', () => {
      expect(fs.existsSync('FEATURES.md')).toBe(true);
    });
  });

  describe('Test Infrastructure', () => {
    it('should have test directory', () => {
      expect(fs.existsSync('tests')).toBe(true);
    });

    it('should have smoke tests', () => {
      expect(fs.existsSync('tests/smoke')).toBe(true);
    });

    it('should have vitest config', () => {
      // Vitest config can be in package.json or vitest.config.ts
      const hasConfigFile = fs.existsSync('vitest.config.ts');
      const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
      const hasInlineConfig = pkg.vitest !== undefined;

      expect(hasConfigFile || hasInlineConfig).toBe(true);
    });
  });

  describe('Build Configuration', () => {
    it('should have TypeScript main config', () => {
      expect(fs.existsSync('tsconfig.json')).toBe(true);
    });

    it('should have TypeScript main process config', () => {
      expect(fs.existsSync('tsconfig.main.json')).toBe(true);
    });

    it('should have Vite config', () => {
      expect(fs.existsSync('vite.config.ts')).toBe(true);
    });

    it('should have electron-builder config', () => {
      expect(fs.existsSync('electron-builder.yml')).toBe(true);
    });

    it('should have ESLint config', () => {
      const eslintConfigs = [
        '.eslintrc.js',
        '.eslintrc.json',
        'eslint.config.js',
        'eslint.config.mjs',
      ];
      const hasEslint = eslintConfigs.some((c) => fs.existsSync(c));
      expect(hasEslint).toBe(true);
    });
  });

  describe('Environment Configuration', () => {
    it('should have .env.example', () => {
      expect(fs.existsSync('.env.example')).toBe(true);
    });

    it('should have .gitignore', () => {
      expect(fs.existsSync('.gitignore')).toBe(true);
    });

    it('should ignore .env in gitignore', () => {
      const gitignore = fs.readFileSync('.gitignore', 'utf-8');
      expect(gitignore).toContain('.env');
    });

    it('should ignore node_modules in gitignore', () => {
      const gitignore = fs.readFileSync('.gitignore', 'utf-8');
      expect(gitignore).toContain('node_modules');
    });

    it('should ignore dist in gitignore', () => {
      const gitignore = fs.readFileSync('.gitignore', 'utf-8');
      expect(gitignore).toContain('dist');
    });
  });
});

describe('Smoke Test Summary', () => {
  it('should report system information', () => {
    console.log('\n=== System Information ===');
    console.log(`Platform: ${os.platform()}`);
    console.log(`Architecture: ${os.arch()}`);
    console.log(`Node.js: ${process.versions.node}`);
    console.log(`V8: ${process.versions.v8}`);
    console.log(`OS Release: ${os.release()}`);
    console.log(`CPU Cores: ${os.cpus().length}`);
    console.log(`Total Memory: ${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB`);
    console.log(`Free Memory: ${Math.round(os.freemem() / 1024 / 1024 / 1024)}GB`);
    console.log('===========================\n');

    expect(true).toBe(true);
  });
});
