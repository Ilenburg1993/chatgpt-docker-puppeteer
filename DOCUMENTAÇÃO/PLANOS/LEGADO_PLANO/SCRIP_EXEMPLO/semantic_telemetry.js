// src/orchestrator/semantic_telemetry.js

class SemanticTelemetry {
    constructor({ nerv }) {
        this.nerv = nerv;

        // Aggregate metrics by task
        this.taskMetrics = new Map(); // task_id → Metrics

        // Listen to semantic events
        this._setupListeners();
    }

    _setupListeners() {
        // Quality events
        this.nerv.on('QUALITY_ASSESSED', envelope => {
            const { task_id, overall_score, criteria_scores } = envelope.payload;

            const metrics = this._getOrCreateMetrics(task_id);
            metrics.quality = {
                overall_score,
                criteria_scores,
                assessed_at: Date.now(),
            };
        });

        // Iteration events
        this.nerv.on('ITERATION_COMPLETED', envelope => {
            const { task_id, iteration, quality_score } = envelope.payload;

            const metrics = this._getOrCreateMetrics(task_id);
            if (!metrics.iterations) metrics.iterations = [];

            metrics.iterations.push({
                iteration,
                quality_score,
                completed_at: Date.now(),
            });
        });

        // Cost events
        this.nerv.on('TOKEN_USAGE_RECORDED', envelope => {
            const { task_id, input_tokens, output_tokens, cost_usd, model } = envelope.payload;

            const metrics = this._getOrCreateMetrics(task_id);
            metrics.cost = {
                input_tokens: (metrics.cost?.input_tokens || 0) + input_tokens,
                output_tokens: (metrics.cost?.output_tokens || 0) + output_tokens,
                total_cost_usd: (metrics.cost?.total_cost_usd || 0) + cost_usd,
                model,
            };
        });

        // Progress events
        this.nerv.on('PROGRESS_MILESTONE', envelope => {
            const { task_id, milestone, progress_percent } = envelope.payload;

            const metrics = this._getOrCreateMetrics(task_id);
            if (!metrics.milestones) metrics.milestones = [];

            metrics.milestones.push({
                milestone,
                progress_percent,
                reached_at: Date.now(),
            });
        });
    }

    _getOrCreateMetrics(taskId) {
        if (!this.taskMetrics.has(taskId)) {
            this.taskMetrics.set(taskId, {
                task_id: taskId,
                created_at: Date.now(),
            });
        }
        return this.taskMetrics.get(taskId);
    }

    /**
     * Get metrics for specific task
     */
    getTaskMetrics(taskId) {
        return this.taskMetrics.get(taskId) || null;
    }

    /**
     * Get aggregated metrics across all tasks
     */
    getAggregatedMetrics() {
        const allMetrics = Array.from(this.taskMetrics.values());

        return {
            total_tasks: allMetrics.length,
            avg_quality_score: this._average(allMetrics.map(m => m.quality?.overall_score).filter(Boolean)),
            avg_iterations: this._average(allMetrics.map(m => m.iterations?.length).filter(Boolean)),
            total_cost_usd: allMetrics.reduce((sum, m) => sum + (m.cost?.total_cost_usd || 0), 0),
            total_tokens: allMetrics.reduce(
                (sum, m) => sum + (m.cost?.input_tokens || 0) + (m.cost?.output_tokens || 0),
                0
            ),
        };
    }

    _average(arr) {
        return arr.length > 0 ? arr.reduce((sum, val) => sum + val, 0) / arr.length : 0;
    }
}

module.exports = { SemanticTelemetry };
