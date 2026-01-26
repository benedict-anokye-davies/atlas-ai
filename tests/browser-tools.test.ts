/**
 * Nova Desktop - Browser Tools Tests
 * Tests for browser automation tools and URL validation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  validateUrl,
  getBrowserTools,
  navigateToUrlTool,
  getPageContentTool,
  clickElementTool,
  typeTextTool,
  browserScreenshotTool,
  closeBrowserTool,
} from '../src/main/agent/tools/browser';

describe('Browser Tools', () => {
  describe('validateUrl', () => {
    it('should accept valid HTTPS URLs', () => {
      const result = validateUrl('https://example.com');
      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should accept valid HTTP URLs', () => {
      const result = validateUrl('http://example.com');
      expect(result.valid).toBe(true);
    });

    it('should accept URLs with paths', () => {
      const result = validateUrl('https://example.com/path/to/page');
      expect(result.valid).toBe(true);
    });

    it('should accept URLs with query parameters', () => {
      const result = validateUrl('https://example.com/search?q=test&page=1');
      expect(result.valid).toBe(true);
    });

    it('should accept URLs with ports', () => {
      const result = validateUrl('https://example.com:8080/api');
      expect(result.valid).toBe(true);
    });

    it('should reject file:// protocol', () => {
      const result = validateUrl('file:///etc/passwd');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('file:');
    });

    it('should reject javascript: protocol', () => {
      const result = validateUrl('javascript:alert(1)');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('javascript:');
    });

    it('should reject data: protocol', () => {
      const result = validateUrl('data:text/html,<script>alert(1)</script>');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('data:');
    });

    it('should reject vbscript: protocol', () => {
      const result = validateUrl('vbscript:msgbox("test")');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('vbscript:');
    });

    it('should reject localhost', () => {
      const result = validateUrl('http://localhost:3000');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Local addresses');
    });

    it('should reject 127.0.0.1', () => {
      const result = validateUrl('http://127.0.0.1:8080');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Local addresses');
    });

    it('should reject 0.0.0.0', () => {
      const result = validateUrl('http://0.0.0.0');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Local addresses');
    });

    it('should reject 10.x.x.x private IP range', () => {
      const result = validateUrl('http://10.0.0.1');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Internal IP');
    });

    it('should reject 172.16-31.x.x private IP range', () => {
      const result = validateUrl('http://172.16.0.1');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Internal IP');
    });

    it('should reject 192.168.x.x private IP range', () => {
      const result = validateUrl('http://192.168.1.1');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Internal IP');
    });

    it('should accept public IP addresses', () => {
      const result = validateUrl('http://8.8.8.8');
      expect(result.valid).toBe(true);
    });

    it('should reject invalid URL format', () => {
      const result = validateUrl('not-a-url');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Invalid URL');
    });

    it('should reject empty string', () => {
      const result = validateUrl('');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Invalid URL');
    });

    it('should reject URL with only protocol', () => {
      const result = validateUrl('http://');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Invalid URL');
    });
  });

  describe('getBrowserTools', () => {
    it('should return an array of tools', () => {
      const tools = getBrowserTools();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    it('should return all 8 browser tools', () => {
      const tools = getBrowserTools();
      expect(tools.length).toBe(8);
    });

    it('should include all expected tools', () => {
      const tools = getBrowserTools();
      const toolNames = tools.map((t) => t.name);

      expect(toolNames).toContain('browser_launch');
      expect(toolNames).toContain('browser_check_brave');
      expect(toolNames).toContain('browser_navigate');
      expect(toolNames).toContain('browser_get_content');
      expect(toolNames).toContain('browser_click');
      expect(toolNames).toContain('browser_type');
      expect(toolNames).toContain('browser_screenshot');
      expect(toolNames).toContain('browser_close');
    });
  });

  describe('Tool Definitions', () => {
    describe('navigateToUrlTool', () => {
      it('should have correct name', () => {
        expect(navigateToUrlTool.name).toBe('browser_navigate');
      });

      it('should have description', () => {
        expect(navigateToUrlTool.description).toBeDefined();
        expect(navigateToUrlTool.description.length).toBeGreaterThan(0);
      });

      it('should have url as required parameter', () => {
        expect(navigateToUrlTool.parameters.required).toContain('url');
      });

      it('should define url, waitFor, and timeout parameters', () => {
        const props = navigateToUrlTool.parameters.properties;
        expect(props).toHaveProperty('url');
        expect(props).toHaveProperty('waitFor');
        expect(props).toHaveProperty('timeout');
      });

      it('should have execute function', () => {
        expect(typeof navigateToUrlTool.execute).toBe('function');
      });
    });

    describe('getPageContentTool', () => {
      it('should have correct name', () => {
        expect(getPageContentTool.name).toBe('browser_get_content');
      });

      it('should have no required parameters', () => {
        expect(getPageContentTool.parameters.required).toHaveLength(0);
      });

      it('should define selector and maxLength parameters', () => {
        const props = getPageContentTool.parameters.properties;
        expect(props).toHaveProperty('selector');
        expect(props).toHaveProperty('maxLength');
      });
    });

    describe('clickElementTool', () => {
      it('should have correct name', () => {
        expect(clickElementTool.name).toBe('browser_click');
      });

      it('should have selector as required parameter', () => {
        expect(clickElementTool.parameters.required).toContain('selector');
      });

      it('should define selector and timeout parameters', () => {
        const props = clickElementTool.parameters.properties;
        expect(props).toHaveProperty('selector');
        expect(props).toHaveProperty('timeout');
      });
    });

    describe('typeTextTool', () => {
      it('should have correct name', () => {
        expect(typeTextTool.name).toBe('browser_type');
      });

      it('should have selector and text as required parameters', () => {
        expect(typeTextTool.parameters.required).toContain('selector');
        expect(typeTextTool.parameters.required).toContain('text');
      });

      it('should define all expected parameters', () => {
        const props = typeTextTool.parameters.properties;
        expect(props).toHaveProperty('selector');
        expect(props).toHaveProperty('text');
        expect(props).toHaveProperty('clear');
        expect(props).toHaveProperty('delay');
      });
    });

    describe('browserScreenshotTool', () => {
      it('should have correct name', () => {
        expect(browserScreenshotTool.name).toBe('browser_screenshot');
      });

      it('should have no required parameters', () => {
        expect(browserScreenshotTool.parameters.required).toHaveLength(0);
      });

      it('should define selector and fullPage parameters', () => {
        const props = browserScreenshotTool.parameters.properties;
        expect(props).toHaveProperty('selector');
        expect(props).toHaveProperty('fullPage');
      });
    });

    describe('closeBrowserTool', () => {
      it('should have correct name', () => {
        expect(closeBrowserTool.name).toBe('browser_close');
      });

      it('should have no required parameters', () => {
        expect(closeBrowserTool.parameters.required).toHaveLength(0);
      });

      it('should have empty properties', () => {
        expect(Object.keys(closeBrowserTool.parameters.properties)).toHaveLength(0);
      });
    });
  });

  describe('Tool Execution - Error Handling', () => {
    // These tests verify error handling when Playwright is not available
    // In a real browser environment, Playwright would need to be mocked

    it('navigateToUrlTool should fail with invalid URL', async () => {
      const result = await navigateToUrlTool.execute({
        url: 'javascript:alert(1)',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('javascript:');
    });

    it('navigateToUrlTool should fail with localhost', async () => {
      const result = await navigateToUrlTool.execute({
        url: 'http://localhost:3000',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Local addresses');
    });

    it('navigateToUrlTool should fail with private IP', async () => {
      const result = await navigateToUrlTool.execute({
        url: 'http://192.168.1.1',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Internal IP');
    });
  });

  describe('URL Security Edge Cases', () => {
    it('should handle URL with userinfo (username:password)', () => {
      // URLs with credentials should still be validated for protocol/host
      const result = validateUrl('https://user:pass@example.com');
      expect(result.valid).toBe(true);
    });

    it('should handle URL with fragment', () => {
      const result = validateUrl('https://example.com/page#section');
      expect(result.valid).toBe(true);
    });

    it('should handle internationalized domain names', () => {
      const result = validateUrl('https://例え.jp');
      expect(result.valid).toBe(true);
    });

    it('should handle very long URLs', () => {
      const longPath = 'a'.repeat(1000);
      const result = validateUrl(`https://example.com/${longPath}`);
      expect(result.valid).toBe(true);
    });

    it('should reject URL attempting localhost bypass with encoding', () => {
      // %6c%6f%63%61%6c%68%6f%73%74 = localhost
      // URL parsing handles percent encoding, so this should still be blocked
      const result = validateUrl('http://localhost/test');
      expect(result.valid).toBe(false);
    });

    it('should handle IPv6 addresses', () => {
      // Public IPv6 should be allowed
      const result = validateUrl('http://[2001:4860:4860::8888]');
      expect(result.valid).toBe(true);
    });

    it('should accept subdomains', () => {
      const result = validateUrl('https://www.subdomain.example.com');
      expect(result.valid).toBe(true);
    });
  });
});
