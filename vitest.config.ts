/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    // Use node environment to avoid jsdom dependency issues
    // Tests mock window.nova directly where needed
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['node_modules', 'dist', 'release'],
    // Run tests sequentially to prevent memory issues with large test suite
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true, // Run all tests in a single fork to avoid memory fragmentation
      },
    },
    // Isolate tests to prevent memory leaks between test files
    isolate: true,
    // Increase test timeout for slower systems
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      exclude: [
        'node_modules/',
        'tests/',
        'dist/',
        'release/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/types/**',
        'scripts/',
      ],
      // Coverage thresholds - 80% target for Atlas Desktop
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 70,
      },
      // Include source files for coverage
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      // Skip files that are hard to test (native modules, etc.)
      skipFull: false,
    },
    deps: {
      // Inline three.js for proper test execution
      inline: ['three'],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@main': resolve(__dirname, 'src/main'),
      '@renderer': resolve(__dirname, 'src/renderer'),
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
});
