// src/driver/base_driver_v2.js

class BaseDriverV2 {
  /**
   * Get driver capabilities
   */
  getCapabilities() {
    return {
      models: [],              // Supported models
      max_tokens: 4096,        // Max output tokens
      supports_json: false,    // JSON mode support
      supports_vision: false,  // Image input support
      supports_function_calling: false,
      cost_per_1k_input: 0,    // Cost in USD
      cost_per_1k_output: 0
    };
  }

  /**
   * Execute task
   * @returns { output, cost_tracking }
   */
  async execute(task) {
    throw new Error('execute() must be implemented by subclass');
  }

  /**
   * Validate task can be executed by this driver
   */
  async validate(task) {
    return { valid: true, issues: [] };
  }

  /**
   * Estimate cost for task
   */
  estimateCost(task) {
    const capabilities = this.getCapabilities();
    const estimatedInputTokens = this._estimateTokens(task.spec.payload.user_message);
    const estimatedOutputTokens = task.spec.parameters.max_tokens || 1000;

    return {
      input_tokens: estimatedInputTokens,
      output_tokens: estimatedOutputTokens,
      cost_usd: (estimatedInputTokens / 1000) * capabilities.cost_per_1k_input +
                (estimatedOutputTokens / 1000) * capabilities.cost_per_1k_output
    };
  }

  _estimateTokens(text) {
    // Rough estimation: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }
}

module.exports = { BaseDriverV2 };
