// src/utils/resourceMonitor.js
// Resource-aware agent spawning and monitoring

import os from 'node:os';
import { logger } from './logger.js';

export class ResourceMonitor {
  constructor(config = {}) {
    this.maxMemoryPercent = Number(config.maxMemoryPercent || 85);
    this.maxCpuPercent = Number(config.maxCpuPercent || 80);
    this.checkIntervalMs = Number(config.checkIntervalMs || 30000); // 30 seconds
    
    this.metrics = {
      memoryUsage: 0,
      cpuUsage: 0,
      lastCheck: 0,
      canSpawnAgent: true
    };

    this._cpuUsage = { idle: 0, total: 0 };
    this._updateCpuUsage();
  }

  _updateCpuUsage() {
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;

    for (const cpu of cpus) {
      for (const type in cpu.times) {
        total += cpu.times[type];
      }
      idle += cpu.times.idle;
    }

    const idleDiff = idle - this._cpuUsage.idle;
    const totalDiff = total - this._cpuUsage.total;
    const cpuPercent = 100 - ~~(100 * idleDiff / totalDiff);

    this._cpuUsage = { idle, total };
    this.metrics.cpuUsage = Math.max(0, Math.min(100, cpuPercent));
  }

  checkResources() {
    const now = Date.now();
    
    // Throttle checks
    if (now - this.metrics.lastCheck < this.checkIntervalMs) {
      return this.metrics;
    }

    // Update CPU
    this._updateCpuUsage();

    // Update memory
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    this.metrics.memoryUsage = Math.round((usedMem / totalMem) * 100);

    // Process memory
    const processMemory = process.memoryUsage();
    this.metrics.processHeapUsed = Math.round(processMemory.heapUsed / 1024 / 1024);
    this.metrics.processHeapTotal = Math.round(processMemory.heapTotal / 1024 / 1024);
    this.metrics.processRSS = Math.round(processMemory.rss / 1024 / 1024);

    // Determine if we can spawn agents
    const memoryOk = this.metrics.memoryUsage < this.maxMemoryPercent;
    const cpuOk = this.metrics.cpuUsage < this.maxCpuPercent;
    this.metrics.canSpawnAgent = memoryOk && cpuOk;

    this.metrics.lastCheck = now;

    if (!this.metrics.canSpawnAgent) {
      logger.warn('[ResourceMonitor] Resources constrained', {
        cpu: this.metrics.cpuUsage,
        memory: this.metrics.memoryUsage,
        thresholds: { cpu: this.maxCpuPercent, memory: this.maxMemoryPercent }
      });
    }

    return this.metrics;
  }

  canSpawnAgent() {
    const metrics = this.checkResources();
    return metrics.canSpawnAgent;
  }

  getMetrics() {
    return { ...this.metrics };
  }

  getResourceSummary() {
    const metrics = this.checkResources();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    
    return {
      cpu: {
        usage: metrics.cpuUsage,
        cores: os.cpus().length,
        model: os.cpus()[0]?.model || 'unknown'
      },
      memory: {
        total: Math.round(totalMem / 1024 / 1024),
        free: Math.round(freeMem / 1024 / 1024),
        used: Math.round((totalMem - freeMem) / 1024 / 1024),
        usagePercent: metrics.memoryUsage
      },
      process: {
        heapUsed: metrics.processHeapUsed,
        heapTotal: metrics.processHeapTotal,
        rss: metrics.processRSS,
        uptime: Math.round(process.uptime())
      },
      canSpawnAgent: metrics.canSpawnAgent
    };
  }
}

// Singleton instance
let resourceMonitor = null;

export function getResourceMonitor(config) {
  if (!resourceMonitor) {
    resourceMonitor = new ResourceMonitor(config);
  }
  return resourceMonitor;
}
