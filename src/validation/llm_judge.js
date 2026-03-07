// @ts-check - Type checking rigoroso habilitado (arquivo core)
import * as logger from '#core/logger';

/**
 * LLMJudge - Valida qualidade de resposta usando LLM como juiz.
 *
 * **Side-effects:** Executa chamada adicional ao LLM para avaliação.
 * **Semântica:** Usa modelo de linguagem para avaliar resposta em completude, relevância e qualidade.
 * **Unidades:** Scores de 0-100, thresholds configuráveis para decisão automática.
 *
 * @typedef {object} LLMJudgeResult
 * @property {number} score - Score de 0-100
 * @property {string} reasoning - Justificativa do score
 */

/**
 * @class
 */
class LLMJudge {
    /**
     * @param {Record<string, unknown>} [options]
     */
    constructor(options) {
        options = options || {};

        this.enabled = options.enabled !== false; // Habilitado por padrão
        this.driver =
            /** @type {{ sendPrompt: (prompt: string, opts: Record<string, unknown>) => Promise<string> } | null} */ (
                options.driver || null
            ); // Driver para chamar LLM
        this.model = /** @type {string} */ (options.model) || 'gpt-5-mini'; // Model para validação (GPT-5-mini é rápido e eficiente)
        this.timeout = /** @type {number} */ (options.timeout) || 15000; // 15s timeout

        // Thresholds de score
        this.thresholds = {
            accept: /** @type {number} */ (options.acceptThreshold) || 70, // >= 70 = ACCEPT
            retry: /** @type {number} */ (options.retryThreshold) || 50, // < 50 = RETRY
            manualReview: /** @type {number} */ (options.manualReviewThreshold) || 70, // 50-70 = MANUAL_REVIEW
        };
    }

    /**
     * Valida resposta em 3 dimensões
     *
     * @param {string} prompt - Prompt original do usuário
     * @param {string} response - Resposta da LLM
     * @param {AbortSignal} signal - Abort signal
     * @returns {Promise<object|null>} - { completeness, relevance, quality, recommendation }
     */
    async validate(prompt, response, signal) {
        if (!this.enabled) {
            logger.debug('[LLM_JUDGE] Validação desabilitada, retornando null');
            return null;
        }

        if (!this.driver) {
            logger.warn('[LLM_JUDGE] Driver não configurado, pulando validação');
            return null;
        }

        try {
            logger.debug(
                /** @type {Record<string, unknown>} */ ({
                    msg: '[LLM_JUDGE] Iniciando validação de resposta',
                    promptLength: prompt.length,
                    responseLength: response.length,
                })
            );

            // Validação paralela (3 prompts independentes)
            const [completeness, relevance, quality] = await Promise.all([
                this._checkCompleteness(prompt, response, signal),
                this._checkRelevance(prompt, response, signal),
                this._checkQuality(response, signal),
            ]);

            // Score geral (média ponderada)
            const overallScore = Math.round(completeness.score * 0.4 + relevance.score * 0.3 + quality.score * 0.3);

            // Recomendação baseada em score
            let recommendation = 'ACCEPT';
            if (overallScore < this.thresholds.retry) {
                recommendation = 'RETRY';
            } else if (overallScore < this.thresholds.accept) {
                recommendation = 'MANUAL_REVIEW';
            }

            const validation = {
                completeness,
                relevance,
                quality: { ...quality, overallScore },
                recommendation,
            };

            logger.info(
                /** @type {Record<string, unknown>} */ ({
                    msg: '[LLM_JUDGE] Validação completa',
                    overallScore,
                    recommendation,
                    completeness: completeness.score,
                    relevance: relevance.score,
                    quality: quality.score,
                })
            );

            return validation;
        } catch (/** @type {any} */ error) {
            logger.error(
                `[LLM_JUDGE] Erro ao validar resposta: ${error instanceof Error ? error.message : String(error)}`,
                String(error instanceof Error ? (error.stack ?? '-') : '-')
            );
            // Retorna null ao invés de falhar (validação é opcional)
            return null;
        }
    }

    /**
     * Verifica completude da resposta
     *
     * @param {string} prompt - Prompt original
     * @param {string} response - Resposta
     * @param {AbortSignal} signal - Abort signal
     * @returns {Promise<{score: number, reasoning: string, isComplete: boolean}>} - { score, reasoning, isComplete }
     * @private
     */
    async _checkCompleteness(prompt, response, signal) {
        const judgePrompt = this._buildCompletenessPrompt(prompt, response);

        try {
            const result = await this._callLLM(judgePrompt, signal);
            const parsed = /** @type {LLMJudgeResult} */ (this._parseJudgmentResult(result));

            return {
                score: parsed.score,
                reasoning: parsed.reasoning,
                isComplete: parsed.score >= 70,
            };
        } catch (/** @type {any} */ error) {
            logger.warn(
                `[LLM_JUDGE] Erro ao verificar completeness, usando fallback: ${error instanceof Error ? error.message : String(error)}`
            );
            return { score: 50, reasoning: 'Validation failed', isComplete: false };
        }
    }

    /**
     * Verifica relevância da resposta
     *
     * @param {string} prompt - Prompt original
     * @param {string} response - Resposta
     * @param {AbortSignal} signal - Abort signal
     * @returns {Promise<{score: number, reasoning: string, isRelevant: boolean}>} - { score, reasoning, isRelevant }
     * @private
     */
    async _checkRelevance(prompt, response, signal) {
        const judgePrompt = this._buildRelevancePrompt(prompt, response);

        try {
            const result = await this._callLLM(judgePrompt, signal);
            const parsed = /** @type {LLMJudgeResult} */ (this._parseJudgmentResult(result));

            return {
                score: parsed.score,
                reasoning: parsed.reasoning,
                isRelevant: parsed.score >= 70,
            };
        } catch (/** @type {any} */ error) {
            logger.warn(
                `[LLM_JUDGE] Erro ao verificar relevance, usando fallback: ${error instanceof Error ? error.message : String(error)}`
            );
            return { score: 50, reasoning: 'Validation failed', isRelevant: false };
        }
    }

    /**
     * Verifica qualidade da resposta
     *
     * @param {string} response - Resposta
     * @param {AbortSignal} signal - Abort signal
     * @returns {Promise<{score: number, reasoning: string}>} - { score, reasoning }
     * @private
     */
    async _checkQuality(response, signal) {
        const judgePrompt = this._buildQualityPrompt(response);

        try {
            const result = await this._callLLM(judgePrompt, signal);
            const parsed = /** @type {LLMJudgeResult} */ (this._parseJudgmentResult(result));

            return {
                score: parsed.score,
                reasoning: parsed.reasoning,
            };
        } catch (/** @type {any} */ error) {
            logger.warn(
                `[LLM_JUDGE] Erro ao verificar quality, usando fallback: ${error instanceof Error ? error.message : String(error)}`
            );
            return { score: 50, reasoning: 'Validation failed' };
        }
    }

    /**
     * Constrói prompt para validar completude
     *
     * @param {string} prompt - Prompt original
     * @param {string} response - Resposta
     * @returns {string} - Judge prompt
     * @private
     */
    _buildCompletenessPrompt(prompt, response) {
        // Trunca resposta se muito longa (economizar tokens)
        const responsePreview =
            response.length > 2000 ? response.slice(0, 2000) + '\n\n[... resposta truncada ...]' : response;

        return `You are a quality judge evaluating if an AI response FULLY answers the user's question.

USER QUESTION:
"${prompt}"

AI RESPONSE:
"${responsePreview}"

Analyze if the response is COMPLETE. Consider:
- Does it address ALL aspects of the question?
- Are there missing parts or incomplete explanations?
- Would the user need to ask follow-up questions?

Rate from 0-100:
- 100: Completely answers all aspects
- 70-99: Mostly complete, minor gaps
- 50-69: Partially answers, significant gaps
- 0-49: Incomplete or doesn't answer

Respond ONLY in JSON format:
{
  "score": <number 0-100>,
  "reasoning": "<brief explanation>"
}`;
    }

    /**
     * Constrói prompt para validar relevância
     *
     * @param {string} prompt - Prompt original
     * @param {string} response - Resposta
     * @returns {string} - Judge prompt
     * @private
     */
    _buildRelevancePrompt(prompt, response) {
        const responsePreview =
            response.length > 2000 ? response.slice(0, 2000) + '\n\n[... resposta truncada ...]' : response;

        return `You are a quality judge evaluating if an AI response is RELEVANT to the user's question.

USER QUESTION:
"${prompt}"

AI RESPONSE:
"${responsePreview}"

Analyze if the response is ON-TOPIC. Consider:
- Does it directly address the question?
- Is there irrelevant information?
- Did the AI go off-topic or hallucinate?

Rate from 0-100:
- 100: Perfectly relevant, no off-topic content
- 70-99: Mostly relevant, minor tangents
- 50-69: Partially relevant, some off-topic content
- 0-49: Not relevant or mostly off-topic

Respond ONLY in JSON format:
{
  "score": <number 0-100>,
  "reasoning": "<brief explanation>"
}`;
    }

    /**
     * Constrói prompt para validar qualidade
     *
     * @param {string} response - Resposta
     * @returns {string} - Judge prompt
     * @private
     */
    _buildQualityPrompt(response) {
        const responsePreview =
            response.length > 2000 ? response.slice(0, 2000) + '\n\n[... resposta truncada ...]' : response;

        return `You are a quality judge evaluating the OVERALL QUALITY of an AI response.

AI RESPONSE:
"${responsePreview}"

Analyze the quality. Consider:
- Is it well-structured and organized?
- Is the language clear and professional?
- Are there grammatical errors or typos?
- Is the information accurate (to the best of your knowledge)?
- Is it helpful and actionable?

Rate from 0-100:
- 100: Excellent quality, no issues
- 70-99: Good quality, minor issues
- 50-69: Acceptable quality, some issues
- 0-49: Poor quality, major issues

Respond ONLY in JSON format:
{
  "score": <number 0-100>,
  "reasoning": "<brief explanation>"
}`;
    }

    /**
     * Chama LLM para obter julgamento
     *
     * @param {string} judgePrompt - Prompt para juiz
     * @param {AbortSignal} signal - Abort signal
     * @returns {Promise<string>} - Resposta do LLM (JSON)
     * @private
     */
    async _callLLM(judgePrompt, signal) {
        // Aqui chamamos o driver para executar o prompt
        // Usamos um modelo mais barato/rápido para validação

        if (!this.driver || typeof this.driver.sendPrompt !== 'function') {
            throw new Error('Driver não configurado ou inválido');
        }

        try {
            // Timeout wrapper com AbortController para cancelar promise órfã
            const abortCtrl = signal ? null : new AbortController();
            const effectiveSignal = signal || abortCtrl?.signal;
            let timeoutId;
            const timeoutPromise = new Promise((_, reject) => {
                timeoutId = setTimeout(() => {
                    if (abortCtrl) abortCtrl.abort();
                    reject(new Error('LLM Judge timeout'));
                }, this.timeout);
            });

            const responsePromise = this.driver.sendPrompt(judgePrompt, {
                model: this.model,
                temperature: 0.3, // Baixa temperature para validação consistente
                maxTokens: 500, // Resposta curta (JSON)
                signal: effectiveSignal,
            });

            let response;
            try {
                response = await Promise.race([responsePromise, timeoutPromise]);
            } finally {
                clearTimeout(timeoutId);
            }
            return response;
        } catch (/** @type {any} */ error) {
            logger.error(`[LLM_JUDGE] Erro ao chamar LLM: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    /**
     * Parseia resultado do julgamento (JSON)
     *
     * @param {string} result - Resposta do LLM
     * @returns {LLMJudgeResult} - { score, reasoning }
     * @private
     */
    _parseJudgmentResult(result) {
        try {
            // Tenta parsear JSON diretamente
            const parsed = JSON.parse(result);

            return {
                score: this._normalizeScore(parsed.score),
                reasoning: parsed.reasoning || 'No reasoning provided',
            };
        } catch (/** @type {any} */ error) {
            // Fallback: tenta extrair JSON de texto
            const jsonMatch = result.match(/\{[\s\S]*"score"[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    const parsed = JSON.parse(jsonMatch[0]);
                    return {
                        score: this._normalizeScore(parsed.score),
                        reasoning: parsed.reasoning || 'No reasoning provided',
                    };
                } catch (/** @type {any} */ e) {
                    // Ignora
                }
            }

            logger.warn(`[LLM_JUDGE] Erro ao parsear resultado, usando fallback: ${result.slice(0, 200)}`);

            // Fallback: score 50 (neutro)
            return {
                score: 50,
                reasoning: 'Failed to parse judgment result',
            };
        }
    }

    /**
     * Normaliza score (0-100)
     *
     * @param {number} score - Score bruto
     * @returns {number} - Score normalizado
     * @private
     */
    _normalizeScore(score) {
        const parsed = typeof score === 'string' ? Number(score) : score;
        if (typeof parsed !== 'number' || isNaN(parsed)) {
            return 50;
        }
        return Math.max(0, Math.min(100, Math.round(parsed)));
    }
}

export default LLMJudge;
