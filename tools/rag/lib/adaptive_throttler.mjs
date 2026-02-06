/**
 * Adaptive CPU-based throttler for RAG indexing
 * Automatically adjusts delay between embeddings based on CPU usage
 * to prevent system overload and crashes.
 */

export class AdaptiveThrottler {
    constructor(options = {}) {
        this.targetCPU = options.targetCPU || 40;        // Target 40% CPU avg
        this.minDelay = options.minDelay || 100;         // Min 100ms delay
        this.maxDelay = options.maxDelay || 5000;        // Max 5s delay
        this.currentDelay = options.initialDelay || 500; // Start at 500ms
        this.samples = [];
        this.sampleSize = 10;
        this.consecutiveHighCPU = 0;
        this.enabled = options.enabled !== false;
    }

    /**
     * Measure CPU usage over a 100ms window
     * Returns percentage (0-100)
     */
    async getCPUUsage() {
        const start = process.cpuUsage();
        await new Promise(resolve => setTimeout(resolve, 100));
        const end = process.cpuUsage(start);

        // Convert microseconds to percentage over 100ms window
        const totalMicros = end.user + end.system;
        const percentCPU = (totalMicros / 100000) * 100; // 100ms = 100,000μs

        return Math.min(percentCPU, 100);
    }

    /**
     * Adaptive throttle: measures CPU and adjusts delay dynamically
     * Returns { cpu, delay, action } for logging
     */
    async throttle() {
        if (!this.enabled) {
            await new Promise(resolve => setTimeout(resolve, this.currentDelay));
            return { cpu: null, delay: this.currentDelay, action: 'disabled' };
        }

        const cpu = await this.getCPUUsage();
        this.samples.push(cpu);
        if (this.samples.length > this.sampleSize) this.samples.shift();

        const avgCPU = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
        let action = 'stable';

        // CPU too high → SLOW DOWN (prevent crash)
        if (avgCPU > this.targetCPU * 1.3) {
            this.consecutiveHighCPU++;
            const oldDelay = this.currentDelay;
            this.currentDelay = Math.min(this.currentDelay * 1.4, this.maxDelay);
            action = 'slowdown';

            if (this.consecutiveHighCPU >= 3) {
                console.warn(`⚠️  [Adaptive] High CPU @ ${avgCPU.toFixed(1)}% → delay ${oldDelay}ms → ${this.currentDelay}ms`);
            }
        }
        // CPU acceptable → SPEED UP (optimize performance)
        else if (avgCPU < this.targetCPU * 0.6 && this.consecutiveHighCPU === 0) {
            const oldDelay = this.currentDelay;
            this.currentDelay = Math.max(this.currentDelay * 0.85, this.minDelay);
            if (oldDelay !== this.currentDelay) {
                action = 'speedup';
                console.log(`✅ [Adaptive] Low CPU @ ${avgCPU.toFixed(1)}% → delay ${oldDelay}ms → ${this.currentDelay}ms (faster!)`);
            }
        }
        // CPU in target range → reset consecutive counter
        else {
            this.consecutiveHighCPU = 0;
        }

        await new Promise(resolve => setTimeout(resolve, this.currentDelay));
        return { cpu: avgCPU, delay: this.currentDelay, action };
    }

    /**
     * Get current stats for reporting
     */
    getStats() {
        const avgCPU = this.samples.length > 0
            ? this.samples.reduce((a, b) => a + b, 0) / this.samples.length
            : 0;

        return {
            enabled: this.enabled,
            targetCPU: this.targetCPU,
            currentCPU: avgCPU,
            currentDelay: this.currentDelay,
            minDelay: this.minDelay,
            maxDelay: this.maxDelay,
            samples: this.samples.length
        };
    }
}
