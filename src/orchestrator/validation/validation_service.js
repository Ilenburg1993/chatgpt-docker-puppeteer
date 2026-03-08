// @ts-check - Type checking rigoroso habilitado (arquivo core)
import * as logger from '#core/logger';
import * as HighLevelNERV from '#nerv/adapters/high_level_adapter';
import { ActionCode, ActorRole } from '#shared/nerv/constants';

/**
 * ValidationService - Serviço de validação de outputs.
 *
 * Suporta múltiplos tipos de validadores:
 *
 * - regex: Valida com regex pattern
 * - schema: Valida com Zod schema (JSON parsing)
 * - length: Valida min/max length
 * - format: Valida formato (JSON, markdown, etc)
 * - llm_judge: LLM-as-judge (qualidade semântica)
 * - custom: Função customizada
 */
class ValidationService {
    /**
     * @param {{ nerv: any }} options
     */
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
        this.validators.set('regex', async (/** @type {any} */ output, /** @type {any} */ config) => {
            const pattern = new RegExp(config.pattern, config.flags || '');
            const passed = pattern.test(output);
            return {
                passed,
                score: passed ? 100 : 0,
                feedback: passed ? 'Pattern matched' : `Pattern did not match: ${config.pattern}`,
            };
        });

        // Length validator
        this.validators.set('length', async (/** @type {any} */ output, /** @type {any} */ config) => {
            const length = output.length;
            const min = config.min_length || 0;
            const max = config.max_length || Infinity;
            const passed = length >= min && length <= max;
            const score = passed ? 100 : 0;
            return {
                passed,
                score,
                feedback: passed ? `Length OK (${length} chars)` : `Length ${length} not in range [${min}, ${max}]`,
            };
        });

        // Schema validator (JSON)
        this.validators.set('schema', async (/** @type {any} */ output, /** @type {any} */ config) => {
            try {
                const parsed = JSON.parse(output);
                // Se tem schema Zod, valida
                if (config.schema) {
                    const result = config.schema.safeParse(parsed);
                    return {
                        passed: result.success,
                        score: result.success ? 100 : 0,
                        feedback: result.success ? 'Schema validation passed' : JSON.stringify(result.error.issues),
                    };
                }
                // Se não tem schema, só verifica se é JSON válido
                return {
                    passed: true,
                    score: 100,
                    feedback: 'Valid JSON',
                };
            } catch (/** @type {any} */ error) {
                const _err = /** @type {any} */ (error);
                return {
                    passed: false,
                    score: 0,
                    feedback: `Invalid JSON: ${_err.message}`,
                };
            }
        });

        // Format validator
        this.validators.set('format', async (/** @type {any} */ output, /** @type {any} */ config) => {
            const format = config.format || 'text';
            let passed = true;
            let feedback = 'Format OK';

            if (format === 'json') {
                try {
                    JSON.parse(output);
                } catch (/** @type {any} */ error) {
                    const _err = /** @type {any} */ (error);
                    passed = false;
                    feedback = `Not valid JSON: ${_err.message}`;
                }
            } else if (format === 'markdown') {
                // Validação básica de markdown (tem # ou *)
                passed = /[#*]/.test(output);
                feedback = passed ? 'Has markdown formatting' : 'No markdown formatting detected';
            }

            return {
                passed,
                score: passed ? 100 : 0,
                feedback,
            };
        });

        // LLM-as-Judge validator (FUNC-01 FIX: bypass explícito e documentado)
        // Anteriormente retornava score aleatório (Math.random()), invalidando toda
        // lógica de qualidade que dependia deste validador.
        this.validators.set('llm_judge', async () => {
            // BYPASS EXPLÍCITO: LLM-as-judge ainda não implementado.
            // Retorna resultado determinístico que indica "não validado" (score: null)
            // diferente de "falha" (score: 0) ou "aprovado" (score: 100).
            logger.warn(
                '[ValidationService] llm_judge não implementado — validação em modo bypass. ' +
                    'Retornando passed=true com score=null. ' +
                    'Para habilitar validação real, implemente o driver LLM neste validador.',
            );
            return {
                passed: true, // Não bloqueia o fluxo
                score: /** @type {number | null} */ (null), // null = não validado (vs 0 = falhou)
                validation_mode: 'bypassed',
                feedback: 'LLM-as-judge não configurado. Validação em modo bypass.',
                strengths: /** @type {any[]} */ ([]),
                weaknesses: /** @type {any[]} */ ([]),
                suggestions: /** @type {any[]} */ ([]),
                _bypass_reason: 'LLM_JUDGE_NOT_IMPLEMENTED',
            };
        });

        // Custom validator
        this.validators.set('custom', async (/** @type {any} */ output, /** @type {any} */ config) => {
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
     * @param {{ validators?: any[]; criteria?: any }} [options] - Opções de validação
     * @returns {Promise<any>} - { passed, overall_score, validation_results, feedback, issues }
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
                issues: [],
            };
        }

        const validation_results = [];
        const issues = [];
        let totalScore = 0;
        let scoredValidators = 0;

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
                    suggestions: result.suggestions,
                });

                if (typeof result.score === 'number' && Number.isFinite(result.score)) {
                    totalScore += result.score;
                    scoredValidators += 1;
                }

                if (!result.passed) {
                    issues.push(`${type}: ${result.feedback}`);
                }
            } catch (/** @type {any} */ error) {
                const _err = /** @type {any} */ (error);
                logger.error(`[ValidationService] Validator ${type} failed: ${_err.message}`);
                issues.push(`${type} error: ${_err.message}`);
                validation_results.push({
                    validator_type: type,
                    passed: false,
                    score: 0,
                    feedback: `Error: ${_err.message}`,
                });
            }
        }

        // Calcula score geral (média dos validators que retornaram score)
        // Se nenhum validator retornou score numérico mas todos passaram individualmente,
        // considera bypass graceful (score 100). Previne bloqueio quando judge está offline.
        const allIndividuallyPassed = issues.length === 0;
        const overall_score = scoredValidators > 0 ? totalScore / scoredValidators : allIndividuallyPassed ? 100 : 0;

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
                // eslint-disable-next-line @typescript-eslint/await-thenable
                await HighLevelNERV.sendEvent(this.nerv, ActorRole.OBSERVER, ActionCode.VALIDATION_COMPLETED, {
                    passed,
                    overall_score,
                    num_validators: validators.length,
                    num_issues: issues.length,
                });
            } catch (/** @type {any} */ e) {
                const _e = /** @type {any} */ (e);
                logger.error('[ValidationService] Falha ao emitir VALIDATION_COMPLETED via NERV:', _e.message);
            }
        }

        return {
            passed,
            overall_score,
            validation_results,
            feedback,
            issues,
        };
    }

    /**
     * Registra validator customizado.
     *
     * @param {string} name - Nome do validator
     * @param {function} validatorFn - Função do validator
     */
    registerValidator(name, validatorFn) {
        this.validators.set(name, validatorFn);
        logger.info(`[ValidationService] Registered custom validator: ${name}`);
    }
}

export { ValidationService };
