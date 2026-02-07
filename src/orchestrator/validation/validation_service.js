// @ts-check - Type checking rigoroso habilitado (arquivo core)
import * as logger from '#core/logger';
import { ActionCode, ActorRole } from '#shared/nerv/constants';
import * as HighLevelNERV from '#nerv/adapters/high_level_adapter';

/**
 * ValidationService - Serviço de validação de outputs.
 *
 * Suporta múltiplos tipos de validadores:
 * - regex: Valida com regex pattern
 * - schema: Valida com Zod schema (JSON parsing)
 * - length: Valida min/max length
 * - format: Valida formato (JSON, markdown, etc)
 * - llm_judge: LLM-as-judge (qualidade semântica)
 * - custom: Função customizada
 */
class ValidationService {
    constructor({ nerv }) {
        this.nerv = nerv;
        this.validators = new Map();

        // Registra validadores built-in
        this._registerBuiltinValidators();
    }

    /**
     * Registra validadores built-in.
     */
    _registerBuiltinValidators() {
        // Regex validator
        this.validators.set('regex', async (output, config) => {
            const pattern = new RegExp(config.pattern, config.flags || '');
            const passed = pattern.test(output);
            return {
                passed,
                score: passed ? 100 : 0,
                feedback: passed ? 'Pattern matched' : `Pattern did not match: ${config.pattern}`
            };
        });

        // Length validator
        this.validators.set('length', async (output, config) => {
            const length = output.length;
            const min = config.min_length || 0;
            const max = config.max_length || Infinity;
            const passed = length >= min && length <= max;
            const score = passed ? 100 : 0;
            return {
                passed,
                score,
                feedback: passed
                    ? `Length OK (${length} chars)`
                    : `Length ${length} not in range [${min}, ${max}]`
            };
        });

        // Schema validator (JSON)
        this.validators.set('schema', async (output, config) => {
            try {
                const parsed = JSON.parse(output);
                // Se tem schema Zod, valida
                if (config.schema) {
                    const result = config.schema.safeParse(parsed);
                    return {
                        passed: result.success,
                        score: result.success ? 100 : 0,
                        feedback: result.success ? 'Schema validation passed' : JSON.stringify(result.error.issues)
                    };
                }
                // Se não tem schema, só verifica se é JSON válido
                return {
                    passed: true,
                    score: 100,
                    feedback: 'Valid JSON'
                };
            } catch (error) {
                return {
                    passed: false,
                    score: 0,
                    feedback: `Invalid JSON: ${error.message}`
                };
            }
        });

        // Format validator
        this.validators.set('format', async (output, config) => {
            const format = config.format || 'text';
            let passed = true;
            let feedback = 'Format OK';

            if (format === 'json') {
                try {
                    JSON.parse(output);
                } catch (error) {
                    passed = false;
                    feedback = `Not valid JSON: ${error.message}`;
                }
            } else if (format === 'markdown') {
                // Validação básica de markdown (tem # ou *)
                passed = /[#*]/.test(output);
                feedback = passed ? 'Has markdown formatting' : 'No markdown formatting detected';
            }

            return {
                passed,
                score: passed ? 100 : 0,
                feedback
            };
        });

        // LLM-as-Judge validator (stub - será implementado completamente depois)
        this.validators.set('llm_judge', async (output, config) => {
            // STUB: Por enquanto retorna score aleatório simulado
            // TODO: Implementar LLM-as-judge real chamando driver
            logger.warn(
                '[ValidationService] llm_judge validator ainda é stub - retornando score simulado'
            );

            const simulatedScore = 75 + Math.random() * 20; // 75-95
            return {
                passed: simulatedScore >= (config.min_quality_score || 70),
                score: simulatedScore,
                feedback: `Simulated LLM judge score: ${simulatedScore.toFixed(1)}/100`,
                strengths: ['coherence', 'accuracy'],
                weaknesses: ['depth'],
                suggestions: ['Add more examples']
            };
        });

        // Custom validator
        this.validators.set('custom', async (output, config) => {
            if (typeof config.validator !== 'function') {
                throw new Error('Custom validator must be a function');
            }
            return await config.validator(output);
        });
    }

    /**
     * Valida output usando múltiplos validadores.
     *
     * @param {string} output - Output do LLM
     * @param {{ validators?: Array, criteria?: object }} [options] - Opções de validação
     * @returns {Promise<object>} - { passed, overall_score, validation_results, feedback, issues }
     */
    async validate(output, options = {}) {
        const { validators = [], criteria = {} } = options;

        // Se não tem validadores, passa direto
        if (validators.length === 0) {
            return {
                passed: true,
                overall_score: 100,
                validation_results: [],
                feedback: 'No validators configured',
                issues: []
            };
        }

        const validation_results = [];
        const issues = [];
        let totalScore = 0;

        // Executa cada validator
        for (const validator of validators) {
            const { type, config = {} } = validator;

            try {
                const validatorFn = this.validators.get(type);
                if (!validatorFn) {
                    logger.error(`[ValidationService] Unknown validator type: ${type}`);
                    issues.push(`Unknown validator: ${type}`);
                    continue;
                }

                const result = await validatorFn(output, config);

                validation_results.push({
                    validator_type: type,
                    passed: result.passed,
                    score: result.score,
                    feedback: result.feedback,
                    strengths: result.strengths,
                    weaknesses: result.weaknesses,
                    suggestions: result.suggestions
                });

                totalScore += result.score;

                if (!result.passed) {
                    issues.push(`${type}: ${result.feedback}`);
                }
            } catch (error) {
                logger.error(`[ValidationService] Validator ${type} failed: ${error.message}`, { error });
                issues.push(`${type} error: ${error.message}`);
                validation_results.push({
                    validator_type: type,
                    passed: false,
                    score: 0,
                    feedback: `Error: ${error.message}`
                });
            }
        }

        // Calcula score geral (média)
        const overall_score = validators.length > 0 ? totalScore / validators.length : 0;

        // Verifica se passou baseado no score mínimo
        const min_quality_score = criteria.min_quality_score || 70;
        const passed = overall_score >= min_quality_score && issues.length === 0;

        // Gera feedback consolidado
        const feedback = passed
            ? `Validation passed (score: ${overall_score.toFixed(1)}/100)`
            : `Validation failed (score: ${overall_score.toFixed(1)}/100). Issues: ${issues.join('; ')}`;

        // Emite evento NERV
        if (this.nerv) {
            try {
                HighLevelNERV.sendEvent(this.nerv, ActorRole.OBSERVER, ActionCode.VALIDATION_COMPLETED, {
                    passed,
                    overall_score,
                    num_validators: validators.length,
                    num_issues: issues.length
                });
            } catch (e) {
                logger.error('[ValidationService] Falha ao emitir VALIDATION_COMPLETED via NERV:', e.message);
            }
        }

        return {
            passed,
            overall_score,
            validation_results,
            feedback,
            issues
        };
    }

    /**
     * Registra validator customizado.
     * @param {string} name - Nome do validator
     * @param {function} validatorFn - Função do validator
     */
    registerValidator(name, validatorFn) {
        this.validators.set(name, validatorFn);
        logger.info(`[ValidationService] Registered custom validator: ${name}`);
    }
}

export { ValidationService };
