import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import electronRenderer from 'vite-plugin-electron-renderer';
import { resolve } from 'path';

// Native modules that should not be bundled
const nativeModules = [
  'electron',
  '@picovoice/porcupine-node',
  '@picovoice/pvrecorder-node',
  '@ricky0123/vad-node',
  'onnxruntime-node',
  'vosk-koffi',
  'koffi',
  'playwright',
  'puppeteer-core',
  'lancedb',
  '@jitsi/robotjs',
  'node-window-manager',
  'screenshot-desktop',
  'active-win',
  'decimal.js',
  'keytar',
  'node-pty',
  // WebSocket for Node.js - must be external for Electron main process
  'ws',
  // Deepgram SDK - needs Node.js WebSocket, not browser stub
  '@deepgram/sdk',
  // CCXT and its dependencies
  'ccxt',
  'protobufjs',
  'protobufjs/minimal.js',
  'protobufjs/minimal',
  // Discord.js optional dependencies
  'discord.js',
  '@discordjs/ws',
  '@discordjs/rest',
  'zlib-sync',
  'erlpack',
  'bufferutil',
  'utf-8-validate',
  // Other optional native modules
  'cpu-features',
  'ssh2',
  // Problematic CommonJS modules
  'formidable',
  'superagent',
  // Banking/finance modules
  'plaid',
  // Native image processing and database modules
  'sharp',
  '@img/sharp-win32-x64',
  '@img/sharp-wasm32',
  'better-sqlite3',
  // OCR - tesseract.js uses Web Workers that crash in Electron main process
  'tesseract.js',
];

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'src/main/index.ts',
        onstart(options) {
          // 048-A: Enhanced HMR for main process
          // Send hot-reload signal to running process before restart
          if (options.args?.includes('--hot-reload')) {
            process.send?.('hot-reload');
          }
          options.startup(['--hot-reload']);
        },
        vite: {
          build: {
            outDir: 'dist/main',
            sourcemap: true, // Enable source maps for debugging
            rollupOptions: {
              external: nativeModules,
            },
          },
        },
      },
      {
        entry: 'src/main/preload.ts',
        onstart(options) {
          options.reload();
        },
        vite: {
          build: {
            outDir: 'dist/preload',
            sourcemap: true,
            rollupOptions: {
              external: nativeModules,
            },
          },
        },
      },
      // Worker files need to be compiled separately for worker_threads
      {
        entry: 'src/main/workers/audio-worker.ts',
        vite: {
          build: {
            outDir: 'dist/main/workers',
            sourcemap: true,
            rollupOptions: {
              external: [...nativeModules, 'worker_threads'],
              output: {
                entryFileNames: 'audio-worker.js',
              },
            },
          },
        },
      },
      {
        entry: 'src/main/workers/embedding-worker.ts',
        vite: {
          build: {
            outDir: 'dist/main/workers',
            sourcemap: true,
            rollupOptions: {
              external: [...nativeModules, 'worker_threads'],
              output: {
                entryFileNames: 'embedding-worker.js',
              },
            },
          },
        },
      },
    ]),
    electronRenderer({
      // Polyfill Node.js built-ins for renderer process
      nodeIntegration: true,
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@main': resolve(__dirname, 'src/main'),
      '@renderer': resolve(__dirname, 'src/renderer'),
      '@shared': resolve(__dirname, 'src/shared'),
      // Polyfill Node.js events module for browser
      'events': 'events',
    },
  },
  // Optimize deps to pre-bundle events polyfill
  optimizeDeps: {
    include: ['events'],
  },
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // Ignore files that cause rebuild loops
      ignored: [
        '**/node_modules/**',
        '**/dist/**',
        '**/.git/**',
        '**/logs/**',
        '**/*.log',
        '**/*.jsonl',
        '**/memory/**',
        '**/models/**',
        // But watch the dev reload trigger
        '!**/.dev-reload-trigger',
      ],
    },
    // 048-A: Enable HMR WebSocket
    hmr: {
      overlay: true,
    },
  },
});
