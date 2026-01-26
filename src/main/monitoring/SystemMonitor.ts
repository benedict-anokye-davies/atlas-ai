/**
 * SystemMonitor.ts
 * 
 * Advanced JARVIS-style system monitoring with predictive analytics.
 * Monitors CPU, RAM, disk, network, battery, and provides intelligent alerts.
 */

import { EventEmitter } from 'events';
import * as os from 'os';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createModuleLogger } from '../utils/logger';

const execAsync = promisify(exec);
const logger = createModuleLogger('SystemMonitor');

export interface CPUMetrics {
  usage: number; // 0-100%
  temperature?: number; // Celsius
  cores: number;
  model: string;
  speed: number; // MHz
  loadAverage: number[];
}

export interface MemoryMetrics {
  total: number; // bytes
  used: number;
  free: number;
  usagePercent: number;
  swapTotal?: number;
  swapUsed?: number;
}

export interface DiskMetrics {
  total: number;
  used: number;
  free: number;
  usagePercent: number;
  drives: DriveInfo[];
}

export interface DriveInfo {
  mountpoint: string;
  total: number;
  used: number;
  free: number;
  usagePercent: number;
}

export interface NetworkMetrics {
  interfaces: NetworkInterface[];
  bytesReceived: number;
  bytesSent: number;
  rxSpeed: number; // bytes/sec
  txSpeed: number; // bytes/sec
  isConnected: boolean;
}

export interface NetworkInterface {
  name: string;
  ip: string;
  mac: string;
  type: string;
}

export interface BatteryMetrics {
  isCharging: boolean;
  level: number; // 0-100
  timeRemaining?: number; // minutes
  hasBattery: boolean;
  powerSource: 'battery' | 'ac' | 'unknown';
}

export interface ProcessMetrics {
  name: string;
  pid: number;
  cpu: number;
  memory: number;
  status: string;
}

export interface SystemHealth {
  overall: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
  score: number; // 0-100
  issues: SystemIssue[];
  predictions: SystemPrediction[];
}

export interface SystemIssue {
  type: 'cpu' | 'memory' | 'disk' | 'network' | 'battery' | 'temperature';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  value: number;
  threshold: number;
}

export interface SystemPrediction {
  type: string;
  prediction: string;
  confidence: number;
  timeframe: string;
  recommendation: string;
}

export interface MonitorConfig {
  enabled: boolean;
  interval: number; // ms
  cpuWarningThreshold: number;
  cpuCriticalThreshold: number;
  memoryWarningThreshold: number;
  memoryCriticalThreshold: number;
  diskWarningThreshold: number;
  diskCriticalThreshold: number;
  batteryWarningThreshold: number;
  batteryCriticalThreshold: number;
  tempWarningThreshold: number;
  tempCriticalThreshold: number;
  enablePredictions: boolean;
  historyLength: number; // Number of samples to keep
}

/**
 * JARVIS-style system monitoring with predictive analytics
 */
export class SystemMonitor extends EventEmitter {
  private config: MonitorConfig;
  private monitorInterval: NodeJS.Timeout | null = null;
  
  // Historical data for predictions
  private cpuHistory: number[] = [];
  private memoryHistory: number[] = [];
  private networkRxHistory: number[] = [];
  private networkTxHistory: number[] = [];
  
  // Last measurements for rate calculations
  private lastNetworkBytes = { rx: 0, tx: 0 };
  private lastMeasurementTime = 0;
  
  // Platform detection
  private readonly isWindows = process.platform === 'win32';
  private readonly isMac = process.platform === 'darwin';
  private readonly isLinux = process.platform === 'linux';
  
  constructor(config?: Partial<MonitorConfig>) {
    super();
    
    this.config = {
      enabled: true,
      interval: 5000, // 5 seconds
      cpuWarningThreshold: 80,
      cpuCriticalThreshold: 95,
      memoryWarningThreshold: 80,
      memoryCriticalThreshold: 95,
      diskWarningThreshold: 85,
      diskCriticalThreshold: 95,
      batteryWarningThreshold: 20,
      batteryCriticalThreshold: 10,
      tempWarningThreshold: 80,
      tempCriticalThreshold: 90,
      enablePredictions: true,
      historyLength: 60, // Keep 5 minutes at 5-second intervals
      ...config,
    };
  }
  
  /**
   * Start monitoring
   */
  start(): void {
    if (this.monitorInterval) return;
    
    this.lastMeasurementTime = Date.now();
    
    // Initial measurement
    this.measure();
    
    // Start interval
    this.monitorInterval = setInterval(() => {
      this.measure();
    }, this.config.interval);
    
    logger.info('Started monitoring');
  }
  
  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    logger.info('Stopped monitoring');
  }
  
  /**
   * Perform a measurement cycle
   */
  private async measure(): Promise<void> {
    const now = Date.now();
    const elapsed = (now - this.lastMeasurementTime) / 1000;
    this.lastMeasurementTime = now;
    
    try {
      const [cpu, memory, disk, network, battery] = await Promise.all([
        this.getCPUMetrics(),
        this.getMemoryMetrics(),
        this.getDiskMetrics(),
        this.getNetworkMetrics(elapsed),
        this.getBatteryMetrics(),
      ]);
      
      // Update history
      this.cpuHistory.push(cpu.usage);
      this.memoryHistory.push(memory.usagePercent);
      
      // Trim history
      while (this.cpuHistory.length > this.config.historyLength) {
        this.cpuHistory.shift();
      }
      while (this.memoryHistory.length > this.config.historyLength) {
        this.memoryHistory.shift();
      }
      
      // Calculate health
      const health = this.calculateHealth(cpu, memory, disk, network, battery);
      
      // Emit metrics
      this.emit('metrics', { cpu, memory, disk, network, battery, health, timestamp: now });
      
      // Check for issues
      this.checkThresholds(cpu, memory, disk, battery);
      
    } catch (error) {
      logger.error('Measurement error', { error: (error as Error).message });
    }
  }
  
  /**
   * Get CPU metrics
   */
  async getCPUMetrics(): Promise<CPUMetrics> {
    const cpus = os.cpus();
    const loadAvg = os.loadavg();
    
    // Calculate CPU usage
    let totalIdle = 0;
    let totalTick = 0;
    
    for (const cpu of cpus) {
      for (const type in cpu.times) {
        totalTick += cpu.times[type as keyof typeof cpu.times];
      }
      totalIdle += cpu.times.idle;
    }
    
    const usage = 100 - (totalIdle / totalTick) * 100;
    
    // Get temperature (platform-specific)
    let temperature: number | undefined;
    try {
      temperature = await this.getCPUTemperature();
    } catch {
      // Temperature not available
    }
    
    return {
      usage: Math.round(usage * 10) / 10,
      temperature,
      cores: cpus.length,
      model: cpus[0]?.model || 'Unknown',
      speed: cpus[0]?.speed || 0,
      loadAverage: loadAvg,
    };
  }
  
  /**
   * Get CPU temperature (platform-specific)
   */
  private async getCPUTemperature(): Promise<number | undefined> {
    try {
      if (this.isWindows) {
        // Windows: Use WMIC
        const { stdout } = await execAsync('wmic /namespace:\\\\root\\wmi PATH MSAcpi_ThermalZoneTemperature get CurrentTemperature');
        const match = stdout.match(/\d+/);
        if (match) {
          // Convert from decikelvin to celsius
          return (parseInt(match[0]) / 10) - 273.15;
        }
      } else if (this.isLinux) {
        // Linux: Read from thermal zone
        const { stdout } = await execAsync('cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo 0');
        const temp = parseInt(stdout.trim());
        if (temp > 0) {
          return temp / 1000;
        }
      } else if (this.isMac) {
        // macOS: Would need native module or powermetrics
        return undefined;
      }
    } catch {
      // Temperature reading failed
    }
    return undefined;
  }
  
  /**
   * Get memory metrics
   */
  async getMemoryMetrics(): Promise<MemoryMetrics> {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    
    return {
      total,
      used,
      free,
      usagePercent: Math.round((used / total) * 1000) / 10,
    };
  }
  
  /**
   * Get disk metrics
   */
  async getDiskMetrics(): Promise<DiskMetrics> {
    const drives: DriveInfo[] = [];
    
    try {
      if (this.isWindows) {
        // Windows: Use WMIC
        const { stdout } = await execAsync('wmic logicaldisk get size,freespace,caption');
        const lines = stdout.trim().split('\n').slice(1);
        
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 3 && parts[1] && parts[2]) {
            const mountpoint = parts[0];
            const free = parseInt(parts[1]) || 0;
            const total = parseInt(parts[2]) || 0;
            const used = total - free;
            
            if (total > 0) {
              drives.push({
                mountpoint,
                total,
                used,
                free,
                usagePercent: Math.round((used / total) * 1000) / 10,
              });
            }
          }
        }
      } else {
        // Unix: Use df command
        const { stdout } = await execAsync("df -k 2>/dev/null | grep -E '^/dev' || echo ''");
        const lines = stdout.trim().split('\n');
        
        for (const line of lines) {
          if (!line) continue;
          const parts = line.split(/\s+/);
          if (parts.length >= 6) {
            const total = parseInt(parts[1]) * 1024;
            const used = parseInt(parts[2]) * 1024;
            const free = parseInt(parts[3]) * 1024;
            const mountpoint = parts[5];
            
            drives.push({
              mountpoint,
              total,
              used,
              free,
              usagePercent: Math.round((used / total) * 1000) / 10,
            });
          }
        }
      }
    } catch (error) {
      logger.error('Disk metrics error', { error: (error as Error).message });
    }
    
    // Aggregate totals
    const totalDisk = drives.reduce((sum, d) => sum + d.total, 0);
    const usedDisk = drives.reduce((sum, d) => sum + d.used, 0);
    const freeDisk = drives.reduce((sum, d) => sum + d.free, 0);
    
    return {
      total: totalDisk,
      used: usedDisk,
      free: freeDisk,
      usagePercent: totalDisk > 0 ? Math.round((usedDisk / totalDisk) * 1000) / 10 : 0,
      drives,
    };
  }
  
  /**
   * Get network metrics
   */
  async getNetworkMetrics(elapsed: number): Promise<NetworkMetrics> {
    const interfaces: NetworkInterface[] = [];
    const networkInterfaces = os.networkInterfaces();
    
    let isConnected = false;
    
    for (const [name, addrs] of Object.entries(networkInterfaces)) {
      if (!addrs) continue;
      
      for (const addr of addrs) {
        if (!addr.internal && addr.family === 'IPv4') {
          interfaces.push({
            name,
            ip: addr.address,
            mac: addr.mac,
            type: name.toLowerCase().includes('wi') ? 'wifi' : 'ethernet',
          });
          isConnected = true;
        }
      }
    }
    
    // Get network bytes (platform-specific)
    let bytesReceived = 0;
    let bytesSent = 0;
    
    try {
      if (this.isWindows) {
        const { stdout } = await execAsync('netstat -e');
        const match = stdout.match(/Bytes\s+(\d+)\s+(\d+)/);
        if (match) {
          bytesReceived = parseInt(match[1]);
          bytesSent = parseInt(match[2]);
        }
      } else {
        // Unix: Read from /proc/net/dev or netstat
        const { stdout } = await execAsync("cat /proc/net/dev 2>/dev/null | grep -E '(eth|wlan|en)' || echo ''");
        const lines = stdout.trim().split('\n');
        
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 10) {
            bytesReceived += parseInt(parts[1]) || 0;
            bytesSent += parseInt(parts[9]) || 0;
          }
        }
      }
    } catch {
      // Network stats not available
    }
    
    // Calculate speeds
    const rxDiff = bytesReceived - this.lastNetworkBytes.rx;
    const txDiff = bytesSent - this.lastNetworkBytes.tx;
    
    const rxSpeed = elapsed > 0 && this.lastNetworkBytes.rx > 0 ? rxDiff / elapsed : 0;
    const txSpeed = elapsed > 0 && this.lastNetworkBytes.tx > 0 ? txDiff / elapsed : 0;
    
    this.lastNetworkBytes = { rx: bytesReceived, tx: bytesSent };
    
    // Update history
    this.networkRxHistory.push(rxSpeed);
    this.networkTxHistory.push(txSpeed);
    while (this.networkRxHistory.length > this.config.historyLength) {
      this.networkRxHistory.shift();
    }
    while (this.networkTxHistory.length > this.config.historyLength) {
      this.networkTxHistory.shift();
    }
    
    return {
      interfaces,
      bytesReceived,
      bytesSent,
      rxSpeed: Math.max(0, rxSpeed),
      txSpeed: Math.max(0, txSpeed),
      isConnected,
    };
  }
  
  /**
   * Get battery metrics
   */
  async getBatteryMetrics(): Promise<BatteryMetrics> {
    try {
      if (this.isWindows) {
        const { stdout } = await execAsync('WMIC Path Win32_Battery Get EstimatedChargeRemaining,BatteryStatus');
        const lines = stdout.trim().split('\n').slice(1);
        
        if (lines.length > 0) {
          const parts = lines[0].trim().split(/\s+/);
          if (parts.length >= 2) {
            const status = parseInt(parts[0]);
            const level = parseInt(parts[1]) || 0;
            
            return {
              hasBattery: true,
              level,
              isCharging: status === 2,
              powerSource: status === 2 ? 'ac' : 'battery',
            };
          }
        }
      } else if (this.isLinux) {
        try {
          const { stdout: capacity } = await execAsync('cat /sys/class/power_supply/BAT0/capacity 2>/dev/null || echo -1');
          const { stdout: status } = await execAsync('cat /sys/class/power_supply/BAT0/status 2>/dev/null || echo Unknown');
          
          const level = parseInt(capacity.trim());
          const charging = status.trim().toLowerCase();
          
          if (level >= 0) {
            return {
              hasBattery: true,
              level,
              isCharging: charging === 'charging',
              powerSource: charging === 'charging' ? 'ac' : 'battery',
            };
          }
        } catch {
          // No battery
        }
      } else if (this.isMac) {
        const { stdout } = await execAsync('pmset -g batt');
        const match = stdout.match(/(\d+)%/);
        const charging = stdout.includes('charging') || stdout.includes('AC Power');
        
        if (match) {
          return {
            hasBattery: true,
            level: parseInt(match[1]),
            isCharging: charging,
            powerSource: charging ? 'ac' : 'battery',
          };
        }
      }
    } catch {
      // Battery detection failed
    }
    
    return {
      hasBattery: false,
      level: 100,
      isCharging: false,
      powerSource: 'unknown',
    };
  }
  
  /**
   * Calculate overall system health
   */
  private calculateHealth(
    cpu: CPUMetrics,
    memory: MemoryMetrics,
    disk: DiskMetrics,
    network: NetworkMetrics,
    battery: BatteryMetrics
  ): SystemHealth {
    const issues: SystemIssue[] = [];
    const predictions: SystemPrediction[] = [];
    let score = 100;
    
    // CPU health
    if (cpu.usage > this.config.cpuCriticalThreshold) {
      issues.push({
        type: 'cpu',
        severity: 'critical',
        message: 'CPU usage critically high',
        value: cpu.usage,
        threshold: this.config.cpuCriticalThreshold,
      });
      score -= 30;
    } else if (cpu.usage > this.config.cpuWarningThreshold) {
      issues.push({
        type: 'cpu',
        severity: 'warning',
        message: 'CPU usage elevated',
        value: cpu.usage,
        threshold: this.config.cpuWarningThreshold,
      });
      score -= 10;
    }
    
    // Memory health
    if (memory.usagePercent > this.config.memoryCriticalThreshold) {
      issues.push({
        type: 'memory',
        severity: 'critical',
        message: 'Memory usage critically high',
        value: memory.usagePercent,
        threshold: this.config.memoryCriticalThreshold,
      });
      score -= 30;
    } else if (memory.usagePercent > this.config.memoryWarningThreshold) {
      issues.push({
        type: 'memory',
        severity: 'warning',
        message: 'Memory usage elevated',
        value: memory.usagePercent,
        threshold: this.config.memoryWarningThreshold,
      });
      score -= 10;
    }
    
    // Disk health
    if (disk.usagePercent > this.config.diskCriticalThreshold) {
      issues.push({
        type: 'disk',
        severity: 'critical',
        message: 'Disk space critically low',
        value: disk.usagePercent,
        threshold: this.config.diskCriticalThreshold,
      });
      score -= 25;
    } else if (disk.usagePercent > this.config.diskWarningThreshold) {
      issues.push({
        type: 'disk',
        severity: 'warning',
        message: 'Disk space running low',
        value: disk.usagePercent,
        threshold: this.config.diskWarningThreshold,
      });
      score -= 10;
    }
    
    // Battery health
    if (battery.hasBattery && !battery.isCharging) {
      if (battery.level < this.config.batteryCriticalThreshold) {
        issues.push({
          type: 'battery',
          severity: 'critical',
          message: 'Battery critically low',
          value: battery.level,
          threshold: this.config.batteryCriticalThreshold,
        });
        score -= 20;
      } else if (battery.level < this.config.batteryWarningThreshold) {
        issues.push({
          type: 'battery',
          severity: 'warning',
          message: 'Battery running low',
          value: battery.level,
          threshold: this.config.batteryWarningThreshold,
        });
        score -= 5;
      }
    }
    
    // Temperature health
    if (cpu.temperature) {
      if (cpu.temperature > this.config.tempCriticalThreshold) {
        issues.push({
          type: 'temperature',
          severity: 'critical',
          message: 'CPU temperature critically high',
          value: cpu.temperature,
          threshold: this.config.tempCriticalThreshold,
        });
        score -= 25;
      } else if (cpu.temperature > this.config.tempWarningThreshold) {
        issues.push({
          type: 'temperature',
          severity: 'warning',
          message: 'CPU temperature elevated',
          value: cpu.temperature,
          threshold: this.config.tempWarningThreshold,
        });
        score -= 10;
      }
    }
    
    // Network health
    if (!network.isConnected) {
      issues.push({
        type: 'network',
        severity: 'warning',
        message: 'No network connection detected',
        value: 0,
        threshold: 1,
      });
      score -= 15;
    }
    
    // Generate predictions
    if (this.config.enablePredictions) {
      predictions.push(...this.generatePredictions(cpu, memory, disk));
    }
    
    // Determine overall status
    score = Math.max(0, score);
    let overall: SystemHealth['overall'];
    
    if (score >= 90) overall = 'excellent';
    else if (score >= 70) overall = 'good';
    else if (score >= 50) overall = 'fair';
    else if (score >= 25) overall = 'poor';
    else overall = 'critical';
    
    return { overall, score, issues, predictions };
  }
  
  /**
   * Generate predictive insights
   */
  private generatePredictions(
    cpu: CPUMetrics,
    memory: MemoryMetrics,
    disk: DiskMetrics
  ): SystemPrediction[] {
    const predictions: SystemPrediction[] = [];
    
    // CPU trend prediction
    if (this.cpuHistory.length >= 10) {
      const trend = this.calculateTrend(this.cpuHistory);
      
      if (trend > 2) {
        predictions.push({
          type: 'cpu_trend',
          prediction: 'CPU usage is trending upward',
          confidence: Math.min(0.9, Math.abs(trend) / 5),
          timeframe: '5-10 minutes',
          recommendation: 'Consider closing unused applications if this continues.',
        });
      }
    }
    
    // Memory trend prediction
    if (this.memoryHistory.length >= 10) {
      const trend = this.calculateTrend(this.memoryHistory);
      
      if (trend > 1 && memory.usagePercent > 60) {
        const timeToFull = (100 - memory.usagePercent) / (trend / (this.config.interval / 1000 / 60));
        
        predictions.push({
          type: 'memory_trend',
          prediction: 'Memory usage is steadily increasing',
          confidence: Math.min(0.85, Math.abs(trend) / 3),
          timeframe: `~${Math.round(timeToFull)} minutes`,
          recommendation: 'Memory may become constrained. Consider restarting memory-intensive applications.',
        });
      }
    }
    
    // Disk space prediction (if we had historical data)
    if (disk.usagePercent > 70) {
      predictions.push({
        type: 'disk_space',
        prediction: 'Disk space is becoming limited',
        confidence: 0.8,
        timeframe: 'ongoing',
        recommendation: 'Consider running disk cleanup or removing unused files.',
      });
    }
    
    return predictions;
  }
  
  /**
   * Calculate trend from historical data
   * Returns rate of change per sample
   */
  private calculateTrend(data: number[]): number {
    if (data.length < 2) return 0;
    
    // Simple linear regression
    const n = data.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += data[i];
      sumXY += i * data[i];
      sumXX += i * i;
    }
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    return slope;
  }
  
  /**
   * Check thresholds and emit alerts
   */
  private checkThresholds(
    cpu: CPUMetrics,
    memory: MemoryMetrics,
    disk: DiskMetrics,
    battery: BatteryMetrics
  ): void {
    // CPU alerts
    if (cpu.usage > this.config.cpuCriticalThreshold) {
      this.emit('alert', {
        type: 'cpu',
        severity: 'critical',
        message: `CPU usage at ${cpu.usage}%`,
        value: cpu.usage,
      });
    }
    
    // Memory alerts
    if (memory.usagePercent > this.config.memoryCriticalThreshold) {
      this.emit('alert', {
        type: 'memory',
        severity: 'critical',
        message: `Memory usage at ${memory.usagePercent}%`,
        value: memory.usagePercent,
      });
    }
    
    // Battery alerts
    if (battery.hasBattery && !battery.isCharging && battery.level <= this.config.batteryCriticalThreshold) {
      this.emit('alert', {
        type: 'battery',
        severity: 'critical',
        message: `Battery at ${battery.level}%`,
        value: battery.level,
      });
    }
  }
  
  /**
   * Get formatted status report (JARVIS-style)
   */
  async getStatusReport(): Promise<string> {
    const [cpu, memory, disk, network, battery] = await Promise.all([
      this.getCPUMetrics(),
      this.getMemoryMetrics(),
      this.getDiskMetrics(),
      this.getNetworkMetrics(0),
      this.getBatteryMetrics(),
    ]);
    
    const health = this.calculateHealth(cpu, memory, disk, network, battery);
    
    const lines: string[] = [
      `System Status: ${health.overall.toUpperCase()} (${health.score}/100)`,
      '',
      `CPU: ${cpu.usage.toFixed(1)}% utilization${cpu.temperature ? `, ${cpu.temperature.toFixed(0)}°C` : ''}`,
      `Memory: ${memory.usagePercent.toFixed(1)}% used (${this.formatBytes(memory.used)} / ${this.formatBytes(memory.total)})`,
      `Disk: ${disk.usagePercent.toFixed(1)}% used (${this.formatBytes(disk.free)} free)`,
      `Network: ${network.isConnected ? 'Connected' : 'Disconnected'}`,
    ];
    
    if (battery.hasBattery) {
      lines.push(`Battery: ${battery.level}% (${battery.isCharging ? 'Charging' : 'On Battery'})`);
    }
    
    if (health.issues.length > 0) {
      lines.push('', 'Active Issues:');
      for (const issue of health.issues) {
        lines.push(`  • [${issue.severity.toUpperCase()}] ${issue.message}`);
      }
    }
    
    if (health.predictions.length > 0) {
      lines.push('', 'Predictions:');
      for (const pred of health.predictions) {
        lines.push(`  • ${pred.prediction} (${Math.round(pred.confidence * 100)}% confidence)`);
      }
    }
    
    return lines.join('\n');
  }
  
  /**
   * Get speech-friendly status (for JARVIS voice)
   */
  async getSpeechStatus(): Promise<string> {
    const [cpu, memory, disk, battery] = await Promise.all([
      this.getCPUMetrics(),
      this.getMemoryMetrics(),
      this.getDiskMetrics(),
      this.getBatteryMetrics(),
    ]);
    
    const parts: string[] = [];
    
    // CPU status
    if (cpu.usage > this.config.cpuWarningThreshold) {
      parts.push(`CPU is running at ${Math.round(cpu.usage)} percent`);
    } else {
      parts.push(`CPU nominal at ${Math.round(cpu.usage)} percent`);
    }
    
    // Memory status
    if (memory.usagePercent > this.config.memoryWarningThreshold) {
      parts.push(`Memory usage is elevated at ${Math.round(memory.usagePercent)} percent`);
    }
    
    // Disk status
    if (disk.usagePercent > this.config.diskWarningThreshold) {
      parts.push(`Disk space is limited with only ${Math.round(100 - disk.usagePercent)} percent remaining`);
    }
    
    // Battery status
    if (battery.hasBattery && !battery.isCharging && battery.level < 30) {
      parts.push(`Battery at ${battery.level} percent and discharging`);
    }
    
    if (parts.length === 1) {
      return `All systems operational. ${parts[0]}.`;
    }
    
    return parts.join('. ') + '.';
  }
  
  /**
   * Format bytes to human readable
   */
  private formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) {
      bytes /= 1024;
      i++;
    }
    return `${bytes.toFixed(1)} ${units[i]}`;
  }
  
  /**
   * Update configuration
   */
  updateConfig(config: Partial<MonitorConfig>): void {
    this.config = { ...this.config, ...config };
    
    // Restart if interval changed
    if (config.interval && this.monitorInterval) {
      this.stop();
      this.start();
    }
  }
  
  /**
   * Get current configuration
   */
  getConfig(): MonitorConfig {
    return { ...this.config };
  }
}

// Singleton instance
let systemMonitor: SystemMonitor | null = null;

export function getSystemMonitor(config?: Partial<MonitorConfig>): SystemMonitor {
  if (!systemMonitor) {
    systemMonitor = new SystemMonitor(config);
  }
  return systemMonitor;
}

export default SystemMonitor;
