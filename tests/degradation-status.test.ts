/**
 * Degradation Status Manager Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DegradationStatusManager,
  createDegradationStatusManager,
  DegradableService,
} from '../src/main/utils/degradation-status';

// Mock logger
vi.mock('../src/main/utils/logger', () => ({
  createModuleLogger: vi.fn().mockReturnValue({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('DegradationStatusManager', () => {
  let manager: DegradationStatusManager;

  beforeEach(() => {
    manager = createDegradationStatusManager();
  });

  describe('initialization', () => {
    it('should initialize with all services healthy', () => {
      const status = manager.getStatus();
      expect(status.isDegraded).toBe(false);
      expect(status.healthyServices).toHaveLength(3);
      expect(status.degradedServices).toHaveLength(0);
    });

    it('should have correct service names', () => {
      const services: DegradableService[] = ['stt', 'llm', 'tts'];
      services.forEach((service) => {
        const status = manager.getServiceStatus(service);
        expect(status).toBeDefined();
        expect(status?.service).toBe(service);
        expect(status?.primary).toBeDefined();
        expect(status?.fallback).toBeDefined();
      });
    });
  });

  describe('markDegraded', () => {
    it('should mark a service as degraded', () => {
      manager.markDegraded('stt', 'API timeout');

      expect(manager.isServiceDegraded('stt')).toBe(true);
      expect(manager.isAnyDegraded()).toBe(true);

      const status = manager.getServiceStatus('stt');
      expect(status?.isDegraded).toBe(true);
      expect(status?.reason).toBe('API timeout');
      expect(status?.degradedSince).toBeGreaterThan(0);
    });

    it('should emit service-degraded event', () => {
      const handler = vi.fn();
      manager.on('service-degraded', handler);

      manager.markDegraded('llm', 'Rate limited');

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0].service).toBe('llm');
      expect(handler.mock.calls[0][0].type).toBe('degraded');
    });

    it('should emit status-changed event', () => {
      const handler = vi.fn();
      manager.on('status-changed', handler);

      manager.markDegraded('tts', 'Network error');

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0].isDegraded).toBe(true);
    });

    it('should not emit duplicate events for already degraded service', () => {
      const handler = vi.fn();
      manager.on('service-degraded', handler);

      manager.markDegraded('stt', 'First failure');
      manager.markDegraded('stt', 'Second failure');

      expect(handler).toHaveBeenCalledOnce();
    });
  });

  describe('markRestored', () => {
    it('should mark a service as restored', () => {
      manager.markDegraded('stt', 'Test');
      expect(manager.isServiceDegraded('stt')).toBe(true);

      manager.markRestored('stt');

      expect(manager.isServiceDegraded('stt')).toBe(false);
      expect(manager.isAnyDegraded()).toBe(false);

      const status = manager.getServiceStatus('stt');
      expect(status?.isDegraded).toBe(false);
      expect(status?.degradedSince).toBeNull();
      expect(status?.reason).toBeNull();
    });

    it('should emit service-restored event', () => {
      const handler = vi.fn();
      manager.on('service-restored', handler);

      manager.markDegraded('llm', 'Test');
      manager.markRestored('llm');

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0].service).toBe('llm');
      expect(handler.mock.calls[0][0].type).toBe('restored');
    });

    it('should not emit event for non-degraded service', () => {
      const handler = vi.fn();
      manager.on('service-restored', handler);

      manager.markRestored('tts'); // Was never degraded

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('warn', () => {
    it('should emit warning event', () => {
      const handler = vi.fn();
      manager.on('warning', handler);

      manager.warn('stt', 'High latency detected');

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0].type).toBe('warning');
      expect(handler.mock.calls[0][0].message).toBe('High latency detected');
    });
  });

  describe('getStatus', () => {
    it('should return correct status when all healthy', () => {
      const status = manager.getStatus();

      expect(status.isDegraded).toBe(false);
      expect(status.degradedServices).toHaveLength(0);
      expect(status.healthyServices).toContain('stt');
      expect(status.healthyServices).toContain('llm');
      expect(status.healthyServices).toContain('tts');
    });

    it('should return correct status when some degraded', () => {
      manager.markDegraded('stt', 'Test');
      manager.markDegraded('tts', 'Test');

      const status = manager.getStatus();

      expect(status.isDegraded).toBe(true);
      expect(status.degradedServices).toHaveLength(2);
      expect(status.healthyServices).toHaveLength(1);
      expect(status.healthyServices).toContain('llm');
    });

    it('should include timestamp', () => {
      const before = Date.now();
      const status = manager.getStatus();
      const after = Date.now();

      expect(status.timestamp).toBeGreaterThanOrEqual(before);
      expect(status.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('isAnyDegraded', () => {
    it('should return false when all healthy', () => {
      expect(manager.isAnyDegraded()).toBe(false);
    });

    it('should return true when any service degraded', () => {
      manager.markDegraded('llm', 'Test');
      expect(manager.isAnyDegraded()).toBe(true);
    });
  });

  describe('getSummary', () => {
    it('should return healthy message when all normal', () => {
      expect(manager.getSummary()).toBe('All services operating normally');
    });

    it('should return degraded summary', () => {
      manager.markDegraded('stt', 'Test');
      const summary = manager.getSummary();
      expect(summary).toContain('Degraded mode');
      expect(summary).toContain('STT');
    });
  });

  describe('getNotificationForRenderer', () => {
    it('should return correct structure when healthy', () => {
      const notification = manager.getNotificationForRenderer();

      expect(notification.show).toBe(false);
      expect(notification.type).toBe('info');
      expect(notification.message).toBe('All services normal');
      expect(notification.services).toHaveLength(3);
    });

    it('should return correct structure when degraded', () => {
      manager.markDegraded('tts', 'Test');
      const notification = manager.getNotificationForRenderer();

      expect(notification.show).toBe(true);
      expect(notification.type).toBe('warning');
      expect(notification.message).toContain('fallback');

      const ttsService = notification.services.find((s) => s.name === 'TTS');
      expect(ttsService?.status).toBe('fallback');
    });
  });

  describe('multiple service degradation', () => {
    it('should handle multiple services degraded', () => {
      manager.markDegraded('stt', 'Reason 1');
      manager.markDegraded('llm', 'Reason 2');
      manager.markDegraded('tts', 'Reason 3');

      const status = manager.getStatus();
      expect(status.degradedServices).toHaveLength(3);
      expect(status.healthyServices).toHaveLength(0);
    });

    it('should restore services independently', () => {
      manager.markDegraded('stt', 'Test');
      manager.markDegraded('llm', 'Test');

      manager.markRestored('stt');

      expect(manager.isServiceDegraded('stt')).toBe(false);
      expect(manager.isServiceDegraded('llm')).toBe(true);
      expect(manager.isAnyDegraded()).toBe(true);
    });
  });
});
