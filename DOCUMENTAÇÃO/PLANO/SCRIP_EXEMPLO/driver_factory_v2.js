// src/driver/driver_factory_v2.js

const { ChatGPTDriverV2 } = require('./chatgpt_driver_v2');
const { GeminiDriverV2 } = require('./gemini_driver_v2');
const { ClaudeDriverV2 } = require('./claude_driver_v2');
const { OllamaDriverV2 } = require('./ollama_driver_v2');

class DriverFactoryV2 {
    constructor() {
        this.drivers = {
            chatgpt: ChatGPTDriverV2,
            gemini: GeminiDriverV2,
            claude: ClaudeDriverV2,
            ollama: OllamaDriverV2,
        };
    }

    /**
     * Create driver instance based on target
     * If target is 'auto', select best driver based on task requirements
     */
    async createDriver(target, task = null) {
        if (target === 'auto') {
            return await this._selectBestDriver(task);
        }

        const DriverClass = this.drivers[target];
        if (!DriverClass) {
            throw new Error(`Unknown driver target: ${target}`);
        }

        return new DriverClass();
    }

    /**
     * Select best driver based on task requirements
     */
    async _selectBestDriver(task) {
        const requirements = this._extractRequirements(task);

        // Score each driver
        const scores = await Promise.all(
            Object.entries(this.drivers).map(async ([name, DriverClass]) => {
                const driver = new DriverClass();
                const capabilities = driver.getCapabilities();
                const score = this._scoreDriver(capabilities, requirements);

                return { name, driver, score, capabilities };
            })
        );

        // Sort by score (descending)
        scores.sort((a, b) => b.score - a.score);

        // Return best driver
        const best = scores[0];
        console.log(`Auto-selected driver: ${best.name} (score: ${best.score})`);

        return best.driver;
    }

    /**
     * Extract requirements from task
     */
    _extractRequirements(task) {
        return {
            max_tokens: task.spec.parameters?.max_tokens || 4096,
            needs_json: task.spec.parameters?.response_format?.type === 'json_object',
            needs_vision: task.spec.payload.images?.length > 0,
            budget_limit: task.policy?.workflow_policy?.budget_limit_usd,
        };
    }

    /**
     * Score driver against requirements
     */
    _scoreDriver(capabilities, requirements) {
        let score = 100;

        // Check hard requirements
        if (requirements.needs_json && !capabilities.supports_json) {
            score -= 50;
        }

        if (requirements.needs_vision && !capabilities.supports_vision) {
            score -= 50;
        }

        if (requirements.max_tokens > capabilities.max_tokens) {
            score -= 30;
        }

        // Prefer cheaper models if budget limited
        if (requirements.budget_limit) {
            const costScore = Math.max(0, 20 - capabilities.cost_per_1k_output * 10);
            score += costScore;
        }

        return score;
    }

    /**
     * Create driver with fallback strategy
     * If primary fails, try secondary
     */
    async createDriverWithFallback(primaryTarget, fallbackTarget) {
        const primaryDriver = await this.createDriver(primaryTarget);
        const fallbackDriver = await this.createDriver(fallbackTarget);

        return new FallbackDriver(primaryDriver, fallbackDriver);
    }
}

/**
 * Fallback Driver Wrapper
 */
class FallbackDriver {
    constructor(primaryDriver, fallbackDriver) {
        this.primary = primaryDriver;
        this.fallback = fallbackDriver;
    }

    async execute(task) {
        try {
            return await this.primary.execute(task);
        } catch (error) {
            console.warn(`Primary driver failed: ${error.message}. Falling back...`);
            return await this.fallback.execute(task);
        }
    }

    getCapabilities() {
        return this.primary.getCapabilities();
    }
}

module.exports = { DriverFactoryV2, FallbackDriver };
