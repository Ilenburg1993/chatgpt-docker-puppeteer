// src/orchestrator/validation/validation_service.js

class ValidationService {
    constructor({ nerv }) {
        this.nerv = nerv;

        // Built-in validators
        this.validators = {
            regex: new RegexValidator(),
            schema: new SchemaValidator(),
            length: new LengthValidator(),
            format: new FormatValidator(),
            llm_judge: new LLMJudgeValidator(),
            custom: new CustomValidator(),
        };
    }

    /**
     * Validate output against criteria
     */
    async validate(output, criteria) {
        const { validators, min_score } = criteria;
        const results = [];

        for (const validatorConfig of validators) {
            const validator = this.validators[validatorConfig.type];

            if (!validator) {
                throw new Error(`Unknown validator: ${validatorConfig.type}`);
            }

            const result = await validator.validate(output, validatorConfig.config);
            results.push(result);

            // Emit validation event
            this.nerv.emitEvent({
                actionCode: 'VALIDATION_EXECUTED',
                payload: {
                    validator_type: validatorConfig.type,
                    passed: result.passed,
                    score: result.score,
                },
            });
        }

        // Aggregate results
        const overallScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;
        const allPassed = results.every((r) => r.passed);
        const passed = allPassed && overallScore >= (min_score || 0);

        return {
            passed,
            overall_score: overallScore,
            results,
            feedback: this._generateFeedback(results),
            issues: results.filter((r) => !r.passed).map((r) => r.feedback),
        };
    }

    _generateFeedback(results) {
        const issues = results.filter((r) => !r.passed);
        if (issues.length === 0) {
            return 'All validations passed. Output meets quality criteria.';
        }

        return `Found ${issues.length} issue(s):\n` + issues.map((r) => `- ${r.feedback}`).join('\n');
    }
}

/**
 * LLM-as-Judge Validator
 * Uses an LLM to evaluate output quality
 */
class LLMJudgeValidator {
    async validate(output, config) {
        const { model, criteria, min_score } = config;

        // Construct judge prompt
        const judgePrompt = `
You are an expert quality evaluator. Evaluate the following output based on these criteria:
${Array.isArray(criteria) ? criteria.join(', ') : criteria}

Output to evaluate:
"""
${output}
"""

Provide your evaluation as JSON:
{
  "overall_score": 0-100,
  "criteria_scores": { "criterion": score, ... },
  "strengths": ["list of strengths"],
  "weaknesses": ["list of weaknesses"],
  "suggestions": ["list of improvement suggestions"]
}
`;

        // Call LLM (use driver)
        const driverFactory = require('../../driver/factory');
        const driver = await driverFactory.createDriver('chatgpt'); // Or specified model

        const result = await driver.execute({
            spec: {
                target: 'chatgpt',
                model: model || 'gpt-4o',
                payload: {
                    user_message: judgePrompt,
                },
                parameters: {
                    temperature: 0.2, // Lower temp for consistent evaluation
                    response_format: { type: 'json_object' },
                },
            },
        });

        const evaluation = JSON.parse(result.output);

        return {
            passed: evaluation.overall_score >= (min_score || 70),
            score: evaluation.overall_score,
            feedback: `Score: ${evaluation.overall_score}/100. Weaknesses: ${evaluation.weaknesses.join(', ')}`,
            details: evaluation,
        };
    }
}

module.exports = { ValidationService, LLMJudgeValidator };
