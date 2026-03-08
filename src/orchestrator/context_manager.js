// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { log } from '#core/logger';
import MemoryStore from './memory_store.js';

/**
 * Estratégias de chunking disponíveis
 */
const CHUNKING_STRATEGY = {
    NONE: 'none', // Sem chunking
    SLIDING_WINDOW: 'sliding_window', // Janela deslizante (últimos N steps)
    HIERARCHICAL: 'hierarchical', // Hierárquico (summarize old, keep recent)
    TOKEN_LIMIT: 'token_limit', // Limite de tokens (truncate ou summarize)
};

/**
 * Políticas de summarization
 */
const SUMMARIZATION_POLICY = {
    DISABLED: 'disabled', // Nunca resumir
    ON_OVERFLOW: 'on_overflow', // Resumir apenas quando ultrapassar limite
    PERIODIC: 'periodic', // Resumir periodicamente (ex: a cada 10 steps)
    ADAPTIVE: 'adaptive', // Decidir adaptativamente baseado em uso de tokens
};

/** Classe exportada: ContextManager. */
class ContextManager {
    constructor(options = /** @type {any} */ ({})) {
        this.config = {
            maxTokens: options.maxTokens || 100000, // Max tokens no contexto
            chunkingStrategy: options.chunkingStrategy || CHUNKING_STRATEGY.SLIDING_WINDOW,
            windowSize: options.windowSize || 10, // Para sliding window
            summarizationPolicy: options.summarizationPolicy || SUMMARIZATION_POLICY.ON_OVERFLOW,
            summarizationInterval: options.summarizationInterval || 10, // Para periodic
            enableMemory: options.enableMemory !== false, // Memory store habilitado por padrão
            memoryRetention: options.memoryRetention || 1000, // Quantos patterns manter
        };

        // Cache de contextos ativos (por mission_id)
        this.contextCache = new Map();

        // Memory store (patterns aprendidos)
        this.memoryStore = this.config.enableMemory ? new MemoryStore({ maxSize: this.config.memoryRetention }) : null;

        log(
            'INFO',
            `[ContextManager] Inicializado com strategy=${this.config.chunkingStrategy}, maxTokens=${this.config.maxTokens}`,
        );
    }

    /**
     * Inicializa contexto para uma missão
     */
    initializeContext(/** @type {any} */ missionId, /** @type {any} */ initialContext = {}) {
        if (this.contextCache.has(missionId)) {
            log('WARN', `[ContextManager] Contexto para mission ${missionId} já existe, sobrescrevendo`);
        }

        const context = {
            mission_id: missionId,
            steps: /** @type {any[]} */ ([]), // Array de { step_id, output, timestamp }
            summary: initialContext.summary || null, // Summary acumulado (se houver)
            metadata: initialContext.metadata || {},
            created_at: Date.now(),
            updated_at: Date.now(),
            token_count: 0, // Estimativa de tokens
        };

        this.contextCache.set(missionId, context);

        log('INFO', `[ContextManager] Contexto inicializado para mission ${missionId}`);
        return context;
    }

    /**
     * Adiciona output de um step ao contexto
     */
    async addStepOutput(/** @type {any} */ missionId, /** @type {any} */ stepId, /** @type {any} */ output) {
        let context = this.contextCache.get(missionId);

        if (!context) {
            log('WARN', `[ContextManager] Contexto não existe para mission ${missionId}, criando novo`);
            context = this.initializeContext(missionId);
        }

        // Adiciona step ao histórico
        const stepData = {
            step_id: stepId,
            output,
            timestamp: Date.now(),
            tokens: this._estimateTokens(output),
        };

        context.steps.push(stepData);
        context.updated_at = Date.now();
        context.token_count += stepData.tokens;

        log(
            'DEBUG',
            `[ContextManager] Step ${stepId} adicionado ao contexto (${stepData.tokens} tokens, total: ${context.token_count})`,
        );

        // Verifica se precisa fazer chunking/summarization
        await this._maybeOptimizeContext(context);

        return context;
    }

    /**
     * Obtém contexto para um step (usado para gerar prompt)
     */
    getContextForStep(/** @type {any} */ missionId, /** @type {any} */ stepId) {
        const context = this.contextCache.get(missionId);

        if (!context) {
            log('WARN', `[ContextManager] Contexto não encontrado para mission ${missionId}`);
            return null;
        }

        // Aplica estratégia de chunking
        const relevantContext = this._applyChunkingStrategy(context, stepId);

        return relevantContext;
    }

    /**
     * Compatibilidade retroativa: APIs legadas esperam `getContext`. Mantém contrato estável delegando para
     * `getContextForStep`.
     *
     * @param {string} missionId
     * @param {string} [stepId]
     * @returns {object | null}
     */
    getContext(missionId, stepId = 'current') {
        return this.getContextForStep(missionId, stepId);
    }

    /**
     * Aplica estratégia de chunking
     */
    _applyChunkingStrategy(/** @type {any} */ context, /** @type {any} */ _) {
        switch (this.config.chunkingStrategy) {
            case CHUNKING_STRATEGY.NONE:
                return this._buildFullContext(context);

            case CHUNKING_STRATEGY.SLIDING_WINDOW:
                return this._buildSlidingWindowContext(context);

            case CHUNKING_STRATEGY.HIERARCHICAL:
                return this._buildHierarchicalContext(context);

            case CHUNKING_STRATEGY.TOKEN_LIMIT:
                return this._buildTokenLimitContext(context);

            default:
                log('WARN', `[ContextManager] Estratégia desconhecida: ${this.config.chunkingStrategy}, usando NONE`);
                return this._buildFullContext(context);
        }
    }

    /**
     * Contexto completo (sem chunking)
     */
    _buildFullContext(/** @type {any} */ context) {
        return {
            summary: context.summary,
            steps: context.steps,
            metadata: context.metadata,
        };
    }

    /**
     * Sliding window (últimos N steps)
     */
    _buildSlidingWindowContext(/** @type {any} */ context) {
        const recentSteps = context.steps.slice(-this.config.windowSize);

        return {
            summary: context.summary,
            steps: recentSteps,
            metadata: {
                ...context.metadata,
                total_steps: context.steps.length,
                showing_last: recentSteps.length,
            },
        };
    }

    /**
     * Hierárquico (summary + recent steps)
     */
    _buildHierarchicalContext(/** @type {any} */ context) {
        const recentSteps = context.steps.slice(-this.config.windowSize);

        return {
            summary: context.summary,
            steps: recentSteps,
            metadata: {
                ...context.metadata,
                total_steps: context.steps.length,
                summarized_steps: context.steps.length - recentSteps.length,
            },
        };
    }

    /**
     * Token limit (trunca ou resume para caber no limite)
     */
    _buildTokenLimitContext(/** @type {any} */ context) {
        let totalTokens = 0;
        const selectedSteps = [];

        // Pega steps de trás pra frente até atingir limite
        for (let i = context.steps.length - 1; i >= 0; i--) {
            const step = context.steps[i];

            if (totalTokens + step.tokens > this.config.maxTokens) {
                break;
            }

            selectedSteps.unshift(step);
            totalTokens += step.tokens;
        }

        return {
            summary: context.summary,
            steps: selectedSteps,
            metadata: {
                ...context.metadata,
                total_steps: context.steps.length,
                token_count: totalTokens,
            },
        };
    }

    /**
     * Verifica se precisa otimizar contexto (summarize, truncate)
     */
    async _maybeOptimizeContext(/** @type {any} */ context) {
        // Se desabilitado, não faz nada
        if (this.config.summarizationPolicy === SUMMARIZATION_POLICY.DISABLED) {
            return;
        }

        const shouldSummarize = this._shouldSummarize(context);

        if (shouldSummarize) {
            log(
                'INFO',
                `[ContextManager] Otimizando contexto para mission ${context.mission_id} (${context.token_count} tokens)`,
            );
            await this._summarizeContext(context);
        }
    }

    /**
     * Decide se deve resumir baseado na política
     */
    _shouldSummarize(/** @type {any} */ context) {
        switch (this.config.summarizationPolicy) {
            case SUMMARIZATION_POLICY.DISABLED:
                return false;

            case SUMMARIZATION_POLICY.ON_OVERFLOW:
                return context.token_count > this.config.maxTokens;

            case SUMMARIZATION_POLICY.PERIODIC:
                return context.steps.length % this.config.summarizationInterval === 0;

            case SUMMARIZATION_POLICY.ADAPTIVE:
                // Heurística: se passou de 80% do limite, resume
                return context.token_count > this.config.maxTokens * 0.8;

            default:
                return false;
        }
    }

    /**
     * Resume contexto via LLM (placeholder - será implementado com LLM integration)
     */
    async _summarizeContext(/** @type {any} */ context) {
        // TODO: Integrar com LLM para gerar summary
        // Por ora, faz summary simples (concatena outputs)

        const oldSteps = context.steps.slice(0, -this.config.windowSize);

        if (oldSteps.length === 0) {
            return;
        }

        // Summary básico: concatena outputs
        const summaryText = oldSteps
            .map((/** @type {any} */ s) => `Step ${s.step_id}: ${s.output.substring(0, 200)}...`)
            .join('\n');

        // Atualiza context — cap summary to prevent unbounded growth
        const maxSummaryChars = this.config.maxTokens * 2; // ~50% do token budget em chars
        const combined = (context.summary || '') + '\n' + summaryText;
        context.summary = combined.length > maxSummaryChars ? combined.slice(-maxSummaryChars) : combined;
        context.steps = context.steps.slice(-this.config.windowSize); // Mantém apenas recentes
        context.token_count =
            this._estimateTokens(context.summary) +
            context.steps.reduce((/** @type {any} */ sum, /** @type {any} */ s) => sum + s.tokens, 0);

        log(
            'INFO',
            `[ContextManager] Contexto resumido: ${oldSteps.length} steps antigos, ${context.steps.length} recentes mantidos`,
        );
    }

    /**
     * Estima tokens aproximadamente. Usa heurística combinada: max(chars/4, words*1.3) para precisão em ambos texto
     * natural (word-heavy) e strings técnicas (char-heavy, sem espaços).
     */
    _estimateTokens(/** @type {any} */ text) {
        if (!text) return 0;
        const charEstimate = Math.ceil(text.length / 4);
        const wordEstimate = Math.ceil(text.split(/\s+/).length * 1.3);
        return Math.max(charEstimate, wordEstimate);
    }

    /**
     * Adiciona pattern ao memory store
     */
    addPattern(/** @type {any} */ pattern) {
        if (!this.memoryStore) {
            log('WARN', '[ContextManager] Memory store desabilitado, ignorando pattern');
            return;
        }

        this.memoryStore.addPattern(pattern);
    }

    /**
     * Busca patterns relevantes no memory store
     */
    getRelevantPatterns(/** @type {any} */ query, limit = 5) {
        if (!this.memoryStore) {
            return [];
        }

        return this.memoryStore.searchPatterns(query, limit);
    }

    /**
     * Limpa contexto de uma missão
     */
    clearContext(/** @type {any} */ missionId) {
        const deleted = this.contextCache.delete(missionId);

        if (deleted) {
            log('INFO', `[ContextManager] Contexto removido para mission ${missionId}`);
        }

        return deleted;
    }

    /**
     * Retorna estatísticas do ContextManager
     */
    getStats() {
        const activeMissions = this.contextCache.size;
        const totalTokens = Array.from(this.contextCache.values()).reduce((sum, ctx) => sum + ctx.token_count, 0);

        const memoryStats = this.memoryStore ? this.memoryStore.getStats() : null;

        return {
            active_missions: activeMissions,
            total_tokens: totalTokens,
            memory_store: memoryStats,
            config: this.config,
        };
    }

    /**
     * Cleanup (chamado no shutdown)
     */
    cleanup() {
        this.contextCache.clear();

        if (this.memoryStore) {
            this.memoryStore.cleanup();
        }

        log('INFO', '[ContextManager] Cleanup concluído');
    }
}

export { CHUNKING_STRATEGY, ContextManager, SUMMARIZATION_POLICY };
