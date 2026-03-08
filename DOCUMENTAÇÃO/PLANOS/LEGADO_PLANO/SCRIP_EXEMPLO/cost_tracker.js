// src/orchestrator/cost_tracker.js

class CostTracker {
    constructor({ storage }) {
        this.storage = storage;

        // In-memory cache
        this.costRecords = []; // [ { task_id, timestamp, model, tokens, cost_usd } ]
    }

    /**
     * Record cost for task execution
     */
    async record(taskId, costData) {
        const record = {
            task_id: taskId,
            timestamp: Date.now(),
            model: costData.model_used,
            input_tokens: costData.input_tokens,
            output_tokens: costData.output_tokens,
            total_tokens: costData.total_tokens,
            cost_usd: costData.cost_usd,
        };

        // Add to cache
        this.costRecords.push(record);

        // Persist to disk (async)
        await this.storage.appendCostRecord(record);

        return record;
    }

    /**
     * Get costs by date range
     */
    async getCostsByDateRange(startTimestamp, endTimestamp) {
        const filtered = this.costRecords.filter((r) => r.timestamp >= startTimestamp && r.timestamp <= endTimestamp);

        return {
            total: filtered.reduce((sum, r) => sum + r.cost_usd, 0),
            tokens: filtered.reduce((sum, r) => sum + r.total_tokens, 0),
            input_tokens: filtered.reduce((sum, r) => sum + r.input_tokens, 0),
            output_tokens: filtered.reduce((sum, r) => sum + r.output_tokens, 0),
            task_count: filtered.length,
            by_task: this._groupBy(filtered, 'task_id'),
            by_model: this._groupBy(filtered, 'model'),
        };
    }

    /**
     * Get today's costs
     */
    async getTodayCosts() {
        const today = new Date().setHours(0, 0, 0, 0);
        return await this.getCostsByDateRange(today, Date.now());
    }

    _groupBy(arr, key) {
        return arr.reduce((acc, obj) => {
            const groupKey = obj[key];
            if (!acc[groupKey]) {
                acc[groupKey] = { count: 0, total_cost: 0, total_tokens: 0 };
            }
            acc[groupKey].count++;
            acc[groupKey].total_cost += obj.cost_usd;
            acc[groupKey].total_tokens += obj.total_tokens;
            return acc;
        }, {});
    }
}

module.exports = { CostTracker };
