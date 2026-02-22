import os from 'node:os';

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function parseNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function parseIntSafe(value, fallback) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value, fallback = true) {
    if (typeof value === 'boolean') return value;
    if (value === undefined || value === null || value === '') return fallback;
    return String(value).trim().toLowerCase() !== 'false';
}

function resolveMetricMode(value, fallback = 'auto') {
    const normalized = String(value || fallback)
        .trim()
        .toLowerCase();
    if (normalized === 'system' || normalized === 'process') return normalized;
    return 'auto';
}

function sumCpuTimes(cpus) {
    if (!Array.isArray(cpus) || cpus.length === 0) return null;
    let idle = 0;
    let total = 0;
    for (const cpu of cpus) {
        const t = cpu?.times;
        if (!t) continue;
        const cpuIdle = Number(t.idle || 0);
        const cpuTotal =
            Number(t.user || 0) + Number(t.nice || 0) + Number(t.sys || 0) + Number(t.idle || 0) + Number(t.irq || 0);
        idle += cpuIdle;
        total += cpuTotal;
    }
    if (total <= 0) return null;
    return { idle, total };
}

/**
 * Adaptive CPU-based throttler for RAG indexing.
 * Focuses on machine-wide stability while preserving throughput.
 */
export class AdaptiveThrottler {
    constructor(options = {}) {
        this.enabled = parseBoolean(options.enabled, true);
        this.metric = resolveMetricMode(options.metric, 'auto');
        this.targetCPU = clamp(parseNumber(options.targetCPU, 70), 20, 95);
        this.minDelay = clamp(parseNumber(options.minDelay, 60), 0, 30_000);
        this.maxDelay = clamp(parseNumber(options.maxDelay, 5000), Math.max(100, this.minDelay), 60_000);
        this.currentDelay = clamp(parseNumber(options.initialDelay, 260), this.minDelay, this.maxDelay);
        this.sampleSize = clamp(parseIntSafe(options.sampleSize, 8), 3, 64);
        this.sampleIntervalMs = clamp(parseIntSafe(options.sampleIntervalMs, 1000), 100, 30_000);
        this.highWatermark = clamp(parseNumber(options.highWatermark, 8), 1, 40);
        this.lowWatermark = clamp(parseNumber(options.lowWatermark, 15), 1, 40);
        this.slowdownFactor = clamp(parseNumber(options.slowdownFactor, 1.28), 1.01, 3.0);
        this.speedupFactor = clamp(parseNumber(options.speedupFactor, 0.92), 0.2, 0.99);
        this.logCooldownMs = clamp(parseIntSafe(options.logCooldownMs, 4000), 500, 120_000);

        this.samples = [];
        this.consecutiveHighCPU = 0;
        this.lastSampleAtMs = 0;
        this.lastLoggedAtMs = 0;
        this.lastCpuSource = 'none';
        this.lastMeasuredCPU = null;

        this.prevProcessUsage = process.cpuUsage();
        this.prevProcessTimeNs = process.hrtime.bigint();
        this.prevSystemTimes = sumCpuTimes(os.cpus());
    }

    estimateFromLoadAvg() {
        const load = os.loadavg?.();
        const load1 = Array.isArray(load) ? load[0] : 0;
        const cores = Math.max(1, os.cpus()?.length || 1);
        if (!Number.isFinite(load1) || load1 < 0) return null;
        return clamp((load1 / cores) * 100, 0, 100);
    }

    measureSystemCPU() {
        const current = sumCpuTimes(os.cpus());
        const previous = this.prevSystemTimes;
        this.prevSystemTimes = current;
        if (!current || !previous) {
            return this.estimateFromLoadAvg();
        }

        const totalDelta = current.total - previous.total;
        const idleDelta = current.idle - previous.idle;
        if (!Number.isFinite(totalDelta) || totalDelta <= 0) {
            return this.estimateFromLoadAvg();
        }

        const activeDelta = Math.max(0, totalDelta - Math.max(0, idleDelta));
        return clamp((activeDelta / totalDelta) * 100, 0, 100);
    }

    measureProcessCPU() {
        const nowUsage = process.cpuUsage();
        const nowNs = process.hrtime.bigint();
        const elapsedUs = Number(nowNs - this.prevProcessTimeNs) / 1000;
        const usedUs = nowUsage.user - this.prevProcessUsage.user + (nowUsage.system - this.prevProcessUsage.system);

        this.prevProcessUsage = nowUsage;
        this.prevProcessTimeNs = nowNs;

        if (!Number.isFinite(elapsedUs) || elapsedUs <= 0) {
            return null;
        }
        return clamp((usedUs / elapsedUs) * 100, 0, 100);
    }

    measureCpuNow() {
        if (this.metric === 'system') {
            const cpu = this.measureSystemCPU();
            return { cpu, source: 'system' };
        }
        if (this.metric === 'process') {
            const cpu = this.measureProcessCPU();
            return { cpu, source: 'process' };
        }

        const systemCpu = this.measureSystemCPU();
        if (Number.isFinite(systemCpu)) {
            return { cpu: systemCpu, source: 'system' };
        }
        return { cpu: this.measureProcessCPU(), source: 'process' };
    }

    getCPUUsage() {
        const now = Date.now();
        if (this.lastMeasuredCPU !== null && now - this.lastSampleAtMs < this.sampleIntervalMs) {
            return this.lastMeasuredCPU;
        }

        const { cpu, source } = this.measureCpuNow();
        const resolved = Number.isFinite(cpu) ? cpu : (this.lastMeasuredCPU ?? 0);
        this.lastMeasuredCPU = clamp(resolved, 0, 100);
        this.lastCpuSource = source || this.lastCpuSource;
        this.lastSampleAtMs = now;
        return this.lastMeasuredCPU;
    }

    maybeLogAdjustment(action, avgCPU, oldDelay) {
        const now = Date.now();
        if (action === 'stable') return;
        if (now - this.lastLoggedAtMs < this.logCooldownMs) return;
        this.lastLoggedAtMs = now;
        console.log(
            `[RAG][Adaptive] metric=${this.lastCpuSource} cpu=${avgCPU.toFixed(1)}% target=${this.targetCPU}% ` +
                `delay ${oldDelay.toFixed(0)}ms -> ${this.currentDelay.toFixed(0)}ms (${action})`
        );
    }

    /**
     * Adaptive throttle: samples CPU and adjusts delay dynamically.
     * Returns { cpu, delay, action, metric } for diagnostics.
     */
    async throttle() {
        if (!this.enabled) {
            await new Promise(resolve => setTimeout(resolve, this.currentDelay));
            return { cpu: null, delay: this.currentDelay, action: 'disabled', metric: this.lastCpuSource };
        }

        const cpu = this.getCPUUsage();
        this.samples.push(cpu);
        if (this.samples.length > this.sampleSize) this.samples.shift();

        const avgCPU = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
        const highThreshold = this.targetCPU + this.highWatermark;
        const lowThreshold = Math.max(0, this.targetCPU - this.lowWatermark);
        const oldDelay = this.currentDelay;
        let action = 'stable';

        if (avgCPU >= highThreshold) {
            this.consecutiveHighCPU++;
            this.currentDelay = Math.min(
                Math.max(this.currentDelay * this.slowdownFactor, this.currentDelay + 20),
                this.maxDelay
            );
            action = 'slowdown';
        } else if (avgCPU <= lowThreshold && this.consecutiveHighCPU === 0) {
            this.currentDelay = Math.max(
                Math.min(this.currentDelay * this.speedupFactor, this.currentDelay - 10),
                this.minDelay
            );
            action = 'speedup';
        } else {
            this.consecutiveHighCPU = 0;
        }

        if (action !== 'slowdown') {
            this.consecutiveHighCPU = 0;
        }
        this.currentDelay = clamp(this.currentDelay, this.minDelay, this.maxDelay);
        this.maybeLogAdjustment(action, avgCPU, oldDelay);

        await new Promise(resolve => setTimeout(resolve, this.currentDelay));
        return { cpu: avgCPU, delay: this.currentDelay, action, metric: this.lastCpuSource };
    }

    /**
     * Get current stats for reporting.
     */
    getStats() {
        const avgCPU = this.samples.length > 0 ? this.samples.reduce((a, b) => a + b, 0) / this.samples.length : 0;

        return {
            enabled: this.enabled,
            metric: this.metric,
            cpu_source: this.lastCpuSource,
            targetCPU: this.targetCPU,
            currentCPU: avgCPU,
            currentDelay: this.currentDelay,
            minDelay: this.minDelay,
            maxDelay: this.maxDelay,
            sampleSize: this.sampleSize,
            sampleIntervalMs: this.sampleIntervalMs,
            samples: this.samples.length,
        };
    }
}

export function createRagAdaptiveThrottler(options = {}) {
    const mode = String(options.mode || 'full') === 'incremental' ? 'incremental' : 'full';
    const defaults =
        mode === 'incremental'
            ? {
                  targetCPU: 72,
                  minDelay: 40,
                  maxDelay: 4000,
                  initialDelay: 180,
              }
            : {
                  targetCPU: 72,
                  minDelay: 60,
                  maxDelay: 5000,
                  initialDelay: 260,
              };

    const metric = resolveMetricMode(process.env.RAG_THROTTLE_METRIC, 'auto');
    const enabled = parseBoolean(process.env.RAG_THROTTLE_ENABLED, true);

    return new AdaptiveThrottler({
        enabled,
        metric,
        targetCPU: parseNumber(process.env.RAG_THROTTLE_TARGET_CPU, defaults.targetCPU),
        minDelay: parseNumber(process.env.RAG_THROTTLE_MIN_DELAY_MS, defaults.minDelay),
        maxDelay: parseNumber(process.env.RAG_THROTTLE_MAX_DELAY_MS, defaults.maxDelay),
        initialDelay: parseNumber(process.env.RAG_THROTTLE_INITIAL_DELAY_MS, defaults.initialDelay),
        sampleIntervalMs: parseIntSafe(process.env.RAG_THROTTLE_SAMPLE_INTERVAL_MS, 1000),
        sampleSize: parseIntSafe(process.env.RAG_THROTTLE_SAMPLE_SIZE, 8),
        slowdownFactor: parseNumber(process.env.RAG_THROTTLE_SLOWDOWN_FACTOR, 1.28),
        speedupFactor: parseNumber(process.env.RAG_THROTTLE_SPEEDUP_FACTOR, 0.92),
        highWatermark: parseNumber(process.env.RAG_THROTTLE_HIGH_WATERMARK_PCT, 8),
        lowWatermark: parseNumber(process.env.RAG_THROTTLE_LOW_WATERMARK_PCT, 15),
        logCooldownMs: parseIntSafe(process.env.RAG_THROTTLE_LOG_COOLDOWN_MS, 4000),
        ...options,
    });
}
