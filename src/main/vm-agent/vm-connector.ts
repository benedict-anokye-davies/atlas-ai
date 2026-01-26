/**
 * Atlas Desktop - VM Connector
 *
 * Handles connection to virtual machines via VNC, RDP, Hyper-V, VirtualBox, or VMware.
 * Provides a unified interface for screen capture and input injection.
 *
 * @module vm-agent/vm-connector
 */

import { EventEmitter } from 'events';
import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import * as net from 'net';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { createModuleLogger } from '../utils/logger';
import {
  VMConnectionConfig,
  VMConnectionState,
  VMConnectionStatus,
  VMAction,
  ActionResult,
} from './types';

const execAsync = promisify(exec);
const logger = createModuleLogger('VMConnector');

// =============================================================================
// VNC Protocol Constants
// =============================================================================

const VNC_HANDSHAKE = {
  PROTOCOL_VERSION_3_8: 'RFB 003.008\n',
  SECURITY_TYPE_NONE: 1,
  SECURITY_TYPE_VNC_AUTH: 2,
  CLIENT_INIT_SHARED: 1,
};

const VNC_MESSAGE_TYPES = {
  // Server to client
  FRAMEBUFFER_UPDATE: 0,
  SET_COLOUR_MAP_ENTRIES: 1,
  BELL: 2,
  SERVER_CUT_TEXT: 3,
  // Client to server
  SET_PIXEL_FORMAT: 0,
  SET_ENCODINGS: 2,
  FRAMEBUFFER_UPDATE_REQUEST: 3,
  KEY_EVENT: 4,
  POINTER_EVENT: 5,
  CLIENT_CUT_TEXT: 6,
};

// =============================================================================
// Key Code Mappings
// =============================================================================

const KEY_CODES: Record<string, number> = {
  // Special keys
  backspace: 0xff08,
  tab: 0xff09,
  enter: 0xff0d,
  return: 0xff0d,
  escape: 0xff1b,
  esc: 0xff1b,
  delete: 0xffff,
  
  // Modifiers
  shift: 0xffe1,
  control: 0xffe3,
  ctrl: 0xffe3,
  alt: 0xffe9,
  super: 0xffeb,
  win: 0xffeb,
  
  // Navigation
  home: 0xff50,
  left: 0xff51,
  up: 0xff52,
  right: 0xff53,
  down: 0xff54,
  pageup: 0xff55,
  pagedown: 0xff56,
  end: 0xff57,
  insert: 0xff63,
  
  // Function keys
  f1: 0xffbe,
  f2: 0xffbf,
  f3: 0xffc0,
  f4: 0xffc1,
  f5: 0xffc2,
  f6: 0xffc3,
  f7: 0xffc4,
  f8: 0xffc5,
  f9: 0xffc6,
  f10: 0xffc7,
  f11: 0xffc8,
  f12: 0xffc9,
  
  // Space
  space: 0x20,
  ' ': 0x20,
};

/**
 * Get VNC key code for a character or key name
 */
function getKeyCode(key: string): number {
  const lower = key.toLowerCase();
  if (KEY_CODES[lower]) {
    return KEY_CODES[lower];
  }
  // For regular characters, use ASCII code
  if (key.length === 1) {
    return key.charCodeAt(0);
  }
  return 0;
}

// =============================================================================
// VM Connector Class
// =============================================================================

/**
 * Manages connection to a virtual machine
 */
export class VMConnector extends EventEmitter {
  private config: VMConnectionConfig;
  private state: VMConnectionState = 'disconnected';
  private socket: net.Socket | null = null;
  private vncProcess: ChildProcess | null = null;
  private framebuffer: Buffer | null = null;
  private screenWidth = 0;
  private screenHeight = 0;
  private pixelFormat: {
    bitsPerPixel: number;
    depth: number;
    bigEndian: boolean;
    trueColour: boolean;
    redMax: number;
    greenMax: number;
    blueMax: number;
    redShift: number;
    greenShift: number;
    blueShift: number;
  } | null = null;
  private connectedAt: number | null = null;
  private lastActivity: number | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private screenshotBuffer: Buffer | null = null;

  constructor(config: VMConnectionConfig) {
    super();
    this.config = config;
  }

  /**
   * Get current connection status
   */
  getStatus(): VMConnectionStatus {
    return {
      connected: this.state === 'connected',
      type: this.config.type,
      vmName: this.config.vmName,
      state: this.state,
      connectedAt: this.connectedAt ?? undefined,
      lastActivity: this.lastActivity ?? undefined,
      resolution: this.screenWidth > 0 ? { width: this.screenWidth, height: this.screenHeight } : undefined,
      latencyMs: undefined, // TODO: measure
    };
  }

  /**
   * Connect to the VM
   */
  async connect(): Promise<boolean> {
    if (this.state === 'connected') {
      logger.info('Already connected to VM');
      return true;
    }

    this.setState('connecting');

    try {
      switch (this.config.type) {
        case 'vnc':
          await this.connectVNC();
          break;
        case 'hyperv':
          await this.connectHyperV();
          break;
        case 'virtualbox':
          await this.connectVirtualBox();
          break;
        case 'vmware':
          await this.connectVMware();
          break;
        case 'rdp':
          await this.connectRDP();
          break;
        default:
          throw new Error(`Unsupported connection type: ${this.config.type}`);
      }

      this.setState('connected');
      this.connectedAt = Date.now();
      this.lastActivity = Date.now();
      logger.info('Connected to VM', { type: this.config.type, host: this.config.host });
      return true;
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to connect to VM', { error: err.message });
      this.setState('error');
      this.emit('error', err);
      return false;
    }
  }

  /**
   * Disconnect from the VM
   */
  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }

    if (this.vncProcess) {
      this.vncProcess.kill();
      this.vncProcess = null;
    }

    this.setState('disconnected');
    this.connectedAt = null;
    logger.info('Disconnected from VM');
  }

  /**
   * Capture screenshot from VM
   */
  async captureScreen(): Promise<Buffer | null> {
    if (this.state !== 'connected') {
      logger.warn('Cannot capture screen - not connected');
      return null;
    }

    this.lastActivity = Date.now();

    try {
      switch (this.config.type) {
        case 'vnc':
          return await this.captureScreenVNC();
        case 'hyperv':
          return await this.captureScreenHyperV();
        case 'virtualbox':
          return await this.captureScreenVirtualBox();
        case 'vmware':
          return await this.captureScreenVMware();
        default:
          return null;
      }
    } catch (error) {
      logger.error('Failed to capture screen', { error: (error as Error).message });
      return null;
    }
  }

  /**
   * Execute an action on the VM
   */
  async executeAction(action: VMAction): Promise<ActionResult> {
    const startTime = Date.now();

    if (this.state !== 'connected') {
      return {
        success: false,
        action,
        executedAt: startTime,
        durationMs: 0,
        error: 'Not connected to VM',
      };
    }

    this.lastActivity = Date.now();

    try {
      switch (action.type) {
        case 'click':
          await this.sendMouseClick(action.x, action.y, action.button || 'left');
          break;
        case 'doubleClick':
          await this.sendMouseClick(action.x, action.y, 'left');
          await this.sleep(50);
          await this.sendMouseClick(action.x, action.y, 'left');
          break;
        case 'rightClick':
          await this.sendMouseClick(action.x, action.y, 'right');
          break;
        case 'move':
          await this.sendMouseMove(action.x, action.y);
          break;
        case 'drag':
          await this.sendMouseDrag(action.fromX, action.fromY, action.toX, action.toY);
          break;
        case 'scroll':
          await this.sendMouseScroll(action.x, action.y, action.deltaX, action.deltaY);
          break;
        case 'type':
          await this.sendText(action.text);
          break;
        case 'keyPress':
          await this.sendKeyPress(action.key, action.modifiers);
          break;
        case 'keyDown':
          await this.sendKeyDown(action.key);
          break;
        case 'keyUp':
          await this.sendKeyUp(action.key);
          break;
        case 'hotkey':
          await this.sendHotkey(action.keys);
          break;
        case 'wait':
          await this.sleep(action.ms);
          break;
        case 'waitForChange':
          await this.waitForScreenChange(action.timeoutMs, action.region);
          break;
        case 'screenshot':
          const screenshot = await this.captureScreen();
          return {
            success: !!screenshot,
            action,
            executedAt: startTime,
            durationMs: Date.now() - startTime,
            screenshotAfter: screenshot?.toString('base64'),
          };
        default:
          throw new Error(`Unknown action type: ${(action as VMAction).type}`);
      }

      return {
        success: true,
        action,
        executedAt: startTime,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        action,
        executedAt: startTime,
        durationMs: Date.now() - startTime,
        error: (error as Error).message,
      };
    }
  }

  // ===========================================================================
  // VNC Implementation
  // ===========================================================================

  private async connectVNC(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('VNC connection timeout'));
      }, this.config.timeout || 10000);

      this.socket = new net.Socket();

      this.socket.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      this.socket.on('close', () => {
        this.handleDisconnect();
      });

      this.socket.connect(this.config.port, this.config.host, async () => {
        try {
          await this.vncHandshake();
          clearTimeout(timeout);
          resolve();
        } catch (err) {
          clearTimeout(timeout);
          reject(err);
        }
      });
    });
  }

  private async vncHandshake(): Promise<void> {
    if (!this.socket) throw new Error('Socket not initialized');

    // Wait for server protocol version
    const serverVersion = await this.readSocket(12);
    logger.debug('VNC server version', { version: serverVersion.toString().trim() });

    // Send client protocol version
    this.socket.write(VNC_HANDSHAKE.PROTOCOL_VERSION_3_8);

    // Read security types
    const numSecTypes = (await this.readSocket(1))[0];
    if (numSecTypes === 0) {
      const reasonLen = (await this.readSocket(4)).readUInt32BE(0);
      const reason = (await this.readSocket(reasonLen)).toString();
      throw new Error(`VNC connection failed: ${reason}`);
    }

    const secTypes = await this.readSocket(numSecTypes);
    logger.debug('VNC security types', { types: Array.from(secTypes) });

    // Choose security type (prefer no auth, then VNC auth)
    let chosenType = VNC_HANDSHAKE.SECURITY_TYPE_NONE;
    if (!secTypes.includes(VNC_HANDSHAKE.SECURITY_TYPE_NONE)) {
      if (secTypes.includes(VNC_HANDSHAKE.SECURITY_TYPE_VNC_AUTH)) {
        chosenType = VNC_HANDSHAKE.SECURITY_TYPE_VNC_AUTH;
      } else {
        throw new Error('No supported security types');
      }
    }

    // Send chosen security type
    this.socket.write(Buffer.from([chosenType]));

    // Handle VNC authentication if needed
    if (chosenType === VNC_HANDSHAKE.SECURITY_TYPE_VNC_AUTH) {
      if (!this.config.password) {
        throw new Error('VNC authentication required but no password provided');
      }
      await this.vncAuthenticate();
    }

    // Read security result (for VNC 3.8+)
    const secResult = (await this.readSocket(4)).readUInt32BE(0);
    if (secResult !== 0) {
      throw new Error('VNC authentication failed');
    }

    // Send ClientInit (shared flag)
    this.socket.write(Buffer.from([VNC_HANDSHAKE.CLIENT_INIT_SHARED]));

    // Read ServerInit
    const serverInit = await this.readSocket(24);
    this.screenWidth = serverInit.readUInt16BE(0);
    this.screenHeight = serverInit.readUInt16BE(2);

    // Read pixel format
    this.pixelFormat = {
      bitsPerPixel: serverInit[4],
      depth: serverInit[5],
      bigEndian: serverInit[6] !== 0,
      trueColour: serverInit[7] !== 0,
      redMax: serverInit.readUInt16BE(8),
      greenMax: serverInit.readUInt16BE(10),
      blueMax: serverInit.readUInt16BE(12),
      redShift: serverInit[14],
      greenShift: serverInit[15],
      blueShift: serverInit[16],
    };

    // Read desktop name
    const nameLen = serverInit.readUInt32BE(20);
    const desktopName = (await this.readSocket(nameLen)).toString();
    logger.info('VNC connected', {
      resolution: `${this.screenWidth}x${this.screenHeight}`,
      desktopName,
    });

    // Request initial framebuffer update
    this.requestFramebufferUpdate(false);
  }

  private async vncAuthenticate(): Promise<void> {
    if (!this.socket || !this.config.password) return;

    // Read challenge
    const challenge = await this.readSocket(16);

    // DES encrypt with password (VNC uses a specific DES key format)
    // Note: This is a simplified implementation - production should use proper DES
    const response = this.vncDesEncrypt(challenge, this.config.password);
    this.socket.write(response);
  }

  private vncDesEncrypt(challenge: Buffer, password: string): Buffer {
    // VNC DES encryption - password is truncated/padded to 8 bytes
    // Each byte's bits are reversed, then DES encrypted
    // This is a placeholder - real implementation needs crypto module
    const key = Buffer.alloc(8);
    for (let i = 0; i < 8 && i < password.length; i++) {
      key[i] = this.reverseBits(password.charCodeAt(i));
    }
    
    // For now, return challenge XORed with key (NOT secure, just for testing)
    // TODO: Use proper DES encryption
    const response = Buffer.alloc(16);
    for (let i = 0; i < 16; i++) {
      response[i] = challenge[i] ^ key[i % 8];
    }
    return response;
  }

  private reverseBits(byte: number): number {
    let result = 0;
    for (let i = 0; i < 8; i++) {
      result = (result << 1) | ((byte >> i) & 1);
    }
    return result;
  }

  private requestFramebufferUpdate(incremental: boolean, x = 0, y = 0, width?: number, height?: number): void {
    if (!this.socket) return;

    const w = width ?? this.screenWidth;
    const h = height ?? this.screenHeight;

    const buf = Buffer.alloc(10);
    buf[0] = VNC_MESSAGE_TYPES.FRAMEBUFFER_UPDATE_REQUEST;
    buf[1] = incremental ? 1 : 0;
    buf.writeUInt16BE(x, 2);
    buf.writeUInt16BE(y, 4);
    buf.writeUInt16BE(w, 6);
    buf.writeUInt16BE(h, 8);
    this.socket.write(buf);
  }

  private async captureScreenVNC(): Promise<Buffer | null> {
    if (!this.socket) return null;

    // Request full framebuffer update
    this.requestFramebufferUpdate(false);

    // Wait for and process framebuffer update
    // This is simplified - real implementation needs to handle VNC encoding
    await this.sleep(100);

    // For now, return the cached screenshot buffer if available
    return this.screenshotBuffer;
  }

  private async sendMouseMove(x: number, y: number): Promise<void> {
    if (!this.socket) return;

    const buf = Buffer.alloc(6);
    buf[0] = VNC_MESSAGE_TYPES.POINTER_EVENT;
    buf[1] = 0; // No buttons pressed
    buf.writeUInt16BE(x, 2);
    buf.writeUInt16BE(y, 4);
    this.socket.write(buf);
  }

  private async sendMouseClick(x: number, y: number, button: 'left' | 'right' | 'middle'): Promise<void> {
    if (!this.socket) return;

    const buttonMask = button === 'left' ? 1 : button === 'right' ? 4 : 2;

    // Move and press
    const press = Buffer.alloc(6);
    press[0] = VNC_MESSAGE_TYPES.POINTER_EVENT;
    press[1] = buttonMask;
    press.writeUInt16BE(x, 2);
    press.writeUInt16BE(y, 4);
    this.socket.write(press);

    await this.sleep(50);

    // Release
    const release = Buffer.alloc(6);
    release[0] = VNC_MESSAGE_TYPES.POINTER_EVENT;
    release[1] = 0;
    release.writeUInt16BE(x, 2);
    release.writeUInt16BE(y, 4);
    this.socket.write(release);
  }

  private async sendMouseDrag(fromX: number, fromY: number, toX: number, toY: number): Promise<void> {
    if (!this.socket) return;

    // Move to start
    await this.sendMouseMove(fromX, fromY);
    await this.sleep(50);

    // Press left button
    const press = Buffer.alloc(6);
    press[0] = VNC_MESSAGE_TYPES.POINTER_EVENT;
    press[1] = 1; // Left button
    press.writeUInt16BE(fromX, 2);
    press.writeUInt16BE(fromY, 4);
    this.socket.write(press);

    // Move to end (with button held)
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const x = fromX + ((toX - fromX) * i) / steps;
      const y = fromY + ((toY - fromY) * i) / steps;

      const move = Buffer.alloc(6);
      move[0] = VNC_MESSAGE_TYPES.POINTER_EVENT;
      move[1] = 1; // Left button still pressed
      move.writeUInt16BE(Math.round(x), 2);
      move.writeUInt16BE(Math.round(y), 4);
      this.socket.write(move);

      await this.sleep(20);
    }

    // Release
    const release = Buffer.alloc(6);
    release[0] = VNC_MESSAGE_TYPES.POINTER_EVENT;
    release[1] = 0;
    release.writeUInt16BE(toX, 2);
    release.writeUInt16BE(toY, 4);
    this.socket.write(release);
  }

  private async sendMouseScroll(x: number, y: number, deltaX: number, deltaY: number): Promise<void> {
    if (!this.socket) return;

    // VNC scroll uses button 4/5 for vertical, 6/7 for horizontal
    const scrollSteps = Math.abs(deltaY) || Math.abs(deltaX);

    for (let i = 0; i < scrollSteps; i++) {
      let buttonMask = 0;
      if (deltaY < 0) buttonMask = 8;  // Scroll up (button 4)
      else if (deltaY > 0) buttonMask = 16; // Scroll down (button 5)
      else if (deltaX < 0) buttonMask = 32; // Scroll left (button 6)
      else if (deltaX > 0) buttonMask = 64; // Scroll right (button 7)

      const press = Buffer.alloc(6);
      press[0] = VNC_MESSAGE_TYPES.POINTER_EVENT;
      press[1] = buttonMask;
      press.writeUInt16BE(x, 2);
      press.writeUInt16BE(y, 4);
      this.socket.write(press);

      const release = Buffer.alloc(6);
      release[0] = VNC_MESSAGE_TYPES.POINTER_EVENT;
      release[1] = 0;
      release.writeUInt16BE(x, 2);
      release.writeUInt16BE(y, 4);
      this.socket.write(release);

      await this.sleep(20);
    }
  }

  private async sendKeyDown(key: string): Promise<void> {
    if (!this.socket) return;

    const keyCode = getKeyCode(key);
    if (keyCode === 0) return;

    const buf = Buffer.alloc(8);
    buf[0] = VNC_MESSAGE_TYPES.KEY_EVENT;
    buf[1] = 1; // Key down
    buf.writeUInt32BE(keyCode, 4);
    this.socket.write(buf);
  }

  private async sendKeyUp(key: string): Promise<void> {
    if (!this.socket) return;

    const keyCode = getKeyCode(key);
    if (keyCode === 0) return;

    const buf = Buffer.alloc(8);
    buf[0] = VNC_MESSAGE_TYPES.KEY_EVENT;
    buf[1] = 0; // Key up
    buf.writeUInt32BE(keyCode, 4);
    this.socket.write(buf);
  }

  private async sendKeyPress(key: string, modifiers?: string[]): Promise<void> {
    // Press modifiers
    if (modifiers) {
      for (const mod of modifiers) {
        await this.sendKeyDown(mod);
      }
    }

    // Press and release key
    await this.sendKeyDown(key);
    await this.sleep(30);
    await this.sendKeyUp(key);

    // Release modifiers
    if (modifiers) {
      for (const mod of modifiers.reverse()) {
        await this.sendKeyUp(mod);
      }
    }
  }

  private async sendHotkey(keys: string[]): Promise<void> {
    // Press all keys
    for (const key of keys) {
      await this.sendKeyDown(key);
      await this.sleep(20);
    }

    // Release all keys in reverse
    for (const key of keys.reverse()) {
      await this.sendKeyUp(key);
      await this.sleep(20);
    }
  }

  private async sendText(text: string): Promise<void> {
    for (const char of text) {
      await this.sendKeyPress(char);
      await this.sleep(30);
    }
  }

  // ===========================================================================
  // Hyper-V Implementation
  // ===========================================================================

  private async connectHyperV(): Promise<void> {
    if (!this.config.vmName) {
      throw new Error('VM name required for Hyper-V connection');
    }

    // Check if VM exists and is running
    const { stdout } = await execAsync(
      `powershell -Command "Get-VM -Name '${this.config.vmName}' | Select-Object -ExpandProperty State"`,
      { windowsHide: true }
    );

    if (!stdout.trim().includes('Running')) {
      throw new Error(`VM '${this.config.vmName}' is not running`);
    }

    // Use vmconnect.exe for enhanced session mode or built-in RDP
    logger.info('Hyper-V VM found and running', { vmName: this.config.vmName });
  }

  private async captureScreenHyperV(): Promise<Buffer | null> {
    if (!this.config.vmName) return null;

    try {
      // Use Hyper-V WMI to capture screenshot
      const tempFile = path.join(os.tmpdir(), `atlas_hyperv_${Date.now()}.bmp`);

      const script = `
        $vm = Get-VM -Name '${this.config.vmName}'
        $vmms = Get-WmiObject -Namespace root\\virtualization\\v2 -Class Msvm_VirtualSystemManagementService
        $vmSettings = Get-WmiObject -Namespace root\\virtualization\\v2 -Query "SELECT * FROM Msvm_VirtualSystemSettingData WHERE ElementName='${this.config.vmName}'"
        
        $thumbnail = $vmms.GetVirtualSystemThumbnailImage($vmSettings.__PATH, 1920, 1080)
        [System.IO.File]::WriteAllBytes('${tempFile.replace(/\\/g, '\\\\')}', $thumbnail.ImageData)
        Write-Output '${tempFile}'
      `;

      await execAsync(`powershell -Command "${script}"`, { windowsHide: true });

      const buffer = await fs.readFile(tempFile);
      await fs.unlink(tempFile).catch(() => {});

      return buffer;
    } catch (error) {
      logger.error('Hyper-V screenshot failed', { error: (error as Error).message });
      return null;
    }
  }

  // ===========================================================================
  // VirtualBox Implementation
  // ===========================================================================

  private async connectVirtualBox(): Promise<void> {
    if (!this.config.vmName) {
      throw new Error('VM name required for VirtualBox connection');
    }

    // Check if VM is running
    const { stdout } = await execAsync(`VBoxManage showvminfo "${this.config.vmName}" --machinereadable`, {
      windowsHide: true,
    });

    if (!stdout.includes('VMState="running"')) {
      throw new Error(`VM '${this.config.vmName}' is not running`);
    }

    // Get VRDE port for VNC-like connection
    const vrdeMatch = stdout.match(/vrdeport=(\d+)/);
    if (vrdeMatch) {
      logger.info('VirtualBox VRDE port found', { port: vrdeMatch[1] });
    }

    logger.info('VirtualBox VM found and running', { vmName: this.config.vmName });
  }

  private async captureScreenVirtualBox(): Promise<Buffer | null> {
    if (!this.config.vmName) return null;

    try {
      const tempFile = path.join(os.tmpdir(), `atlas_vbox_${Date.now()}.png`);

      await execAsync(`VBoxManage controlvm "${this.config.vmName}" screenshotpng "${tempFile}"`, {
        windowsHide: true,
      });

      const buffer = await fs.readFile(tempFile);
      await fs.unlink(tempFile).catch(() => {});

      return buffer;
    } catch (error) {
      logger.error('VirtualBox screenshot failed', { error: (error as Error).message });
      return null;
    }
  }

  // ===========================================================================
  // VMware Implementation
  // ===========================================================================

  private async connectVMware(): Promise<void> {
    if (!this.config.vmName) {
      throw new Error('VM path required for VMware connection');
    }

    // Check if vmrun is available
    try {
      await execAsync('vmrun list', { windowsHide: true });
    } catch {
      throw new Error('VMware vmrun not found in PATH');
    }

    logger.info('VMware connection established', { vmName: this.config.vmName });
  }

  private async captureScreenVMware(): Promise<Buffer | null> {
    if (!this.config.vmName) return null;

    try {
      const tempFile = path.join(os.tmpdir(), `atlas_vmware_${Date.now()}.png`);

      await execAsync(`vmrun captureScreen "${this.config.vmName}" "${tempFile}"`, {
        windowsHide: true,
      });

      const buffer = await fs.readFile(tempFile);
      await fs.unlink(tempFile).catch(() => {});

      return buffer;
    } catch (error) {
      logger.error('VMware screenshot failed', { error: (error as Error).message });
      return null;
    }
  }

  // ===========================================================================
  // RDP Implementation (using xfreerdp or similar)
  // ===========================================================================

  private async connectRDP(): Promise<void> {
    // RDP is more complex - typically need a separate RDP client library
    // For now, we'll use a subprocess approach
    logger.info('RDP connection requires external client');
    throw new Error('RDP not yet implemented - use VNC for now');
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  private setState(state: VMConnectionState): void {
    const previous = this.state;
    this.state = state;
    if (previous !== state) {
      this.emit('stateChange', state, previous);
    }
  }

  private handleDisconnect(): void {
    if (this.state === 'disconnected') return;

    logger.warn('VM connection lost');
    this.setState('disconnected');
    this.emit('disconnected');

    if (this.config.autoReconnect) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      logger.info('Attempting to reconnect to VM...');

      const success = await this.connect();
      if (!success && this.config.autoReconnect) {
        this.scheduleReconnect();
      }
    }, 5000);
  }

  private readSocket(length: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Socket not connected'));
        return;
      }

      const chunks: Buffer[] = [];
      let received = 0;

      const onData = (data: Buffer) => {
        chunks.push(data);
        received += data.length;

        if (received >= length) {
          this.socket?.off('data', onData);
          const buffer = Buffer.concat(chunks);
          resolve(buffer.slice(0, length));
          // Put excess data back (simplified - real impl should use a proper buffer)
        }
      };

      this.socket.on('data', onData);
    });
  }

  private async waitForScreenChange(timeoutMs = 5000, region?: { x: number; y: number; width: number; height: number }): Promise<void> {
    const startTime = Date.now();
    const initialScreenshot = await this.captureScreen();

    while (Date.now() - startTime < timeoutMs) {
      await this.sleep(200);
      const newScreenshot = await this.captureScreen();

      if (initialScreenshot && newScreenshot) {
        // Compare screenshots (simplified - real impl should use image diff)
        if (!initialScreenshot.equals(newScreenshot)) {
          return;
        }
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// =============================================================================
// Singleton & Exports
// =============================================================================

let connectorInstance: VMConnector | null = null;

/**
 * Get or create the VM connector instance
 */
export function getVMConnector(config?: VMConnectionConfig): VMConnector {
  if (config) {
    if (connectorInstance) {
      connectorInstance.disconnect();
    }
    connectorInstance = new VMConnector(config);
  }
  if (!connectorInstance) {
    throw new Error('VM connector not initialized - provide config first');
  }
  return connectorInstance;
}

/**
 * Check if VM connector is initialized
 */
export function isVMConnectorInitialized(): boolean {
  return connectorInstance !== null;
}

export default VMConnector;
