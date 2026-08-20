// @ts-check
/**
 * Política canônica de admissão BYOK no terminal.
 *
 * Catálogo, probes e turno live precisam olhar para o mesmo contrato de limite do provider. O turno estima o contexto
 * vivo; probes usam um piso conservador do envelope SDK observado no preflight agente, porque até uma sessão
 * descartável carrega metadados de runtime antes de o provider responder.
 *
 * @module copilot/terminal/byok/admission
 */

import { utf8ByteLength } from '#copilot/infra/public/buffer';

export const TERMINAL_BYOK_ADMISSION_MODE_ENV = 'COPILOT_BYOK_ADMISSION_MODE';
export const TERMINAL_BYOK_LOW_REQUEST_TOKEN_LIMIT = 8_000;
export const TERMINAL_BYOK_RESPONSE_RESERVE_TOKENS = 1_024;
export const TERMINAL_BYOK_REQUEST_FLOOR_TOKENS = 16_384;

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function finitePositiveNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * @param {string} message
 * @returns {number}
 */
function estimateMessageTokens(message) {
    return Math.ceil(utf8ByteLength(message, 'terminal byok budget estimate') / 4);
}

/**
 * @param {ReturnType<typeof import('#copilot/config').readConfiguredByokSummary>} byok
 * @returns {number | null}
 */
function readByokRequestLimit(byok) {
    return byok.limits?.maxRequestTokens ?? byok.limits?.tokensPerMinute ?? null;
}

/**
 * @param {ReturnType<typeof import('#copilot/config').readConfiguredByokSummary>} byok
 * @param {number} estimatedRequestTokens
 * @param {number | null} utilization
 * @param {{ subject: string; lowLimitBlocks?: boolean }} options
 * @returns {{
 *     shouldWarn: boolean;
 *     shouldBlock: boolean;
 *     severity: 'none' | 'warn' | 'block';
 *     label: string;
 *     estimatedRequestTokens: number;
 *     limit: number | null;
 *     utilization: number | null;
 * }}
 */
function classifyByokEstimate(byok, estimatedRequestTokens, utilization, options) {
    const limit = readByokRequestLimit(byok);
    if (!byok.enabled || !byok.ready || limit === null) {
        return {
            shouldWarn: false,
            shouldBlock: false,
            severity: 'none',
            label: 'sem limite BYOK declarado',
            estimatedRequestTokens,
            limit,
            utilization,
        };
    }
    if (estimatedRequestTokens > limit) {
        return {
            shouldWarn: true,
            shouldBlock: true,
            severity: 'block',
            label: `${options.subject} estimada ${estimatedRequestTokens} tokens > limite BYOK ${limit}; o provider pode recusar antes do streaming`,
            estimatedRequestTokens,
            limit,
            utilization,
        };
    }
    if (limit < TERMINAL_BYOK_LOW_REQUEST_TOKEN_LIMIT) {
        return {
            shouldWarn: true,
            shouldBlock: options.lowLimitBlocks === true,
            severity: options.lowLimitBlocks === true ? 'block' : 'warn',
            label: `limite BYOK baixo (${limit} tokens); prefira sessão fresca, prompt mínimo ou /byok recommend safe`,
            estimatedRequestTokens,
            limit,
            utilization,
        };
    }
    if (estimatedRequestTokens > limit * 0.85) {
        return {
            shouldWarn: true,
            shouldBlock: false,
            severity: 'warn',
            label: `${options.subject} estimada em ${estimatedRequestTokens}/${limit} tokens; margem BYOK estreita`,
            estimatedRequestTokens,
            limit,
            utilization,
        };
    }
    return {
        shouldWarn: false,
        shouldBlock: false,
        severity: 'none',
        label: 'orçamento BYOK suficiente para a estimativa atual',
        estimatedRequestTokens,
        limit,
        utilization,
    };
}

/**
 * @param {ReturnType<typeof import('#copilot/config').readConfiguredByokSummary>} byok
 * @param {ReturnType<typeof import('../frontend/index.js').readTerminalRuntimeState>} runtimeState
 * @param {string} message
 * @returns {ReturnType<typeof classifyByokEstimate>}
 */
export function evaluateTerminalByokTurnBudget(byok, runtimeState, message) {
    const contextState = runtimeState.contextWindow;
    const tokenLimit =
        finitePositiveNumber(/** @type {{ tokenLimit?: unknown }} */ (contextState ?? {}).tokenLimit) ??
        finitePositiveNumber(byok.capabilities?.contextWindowTokens) ??
        null;
    const directTokens = finitePositiveNumber(/** @type {{ tokens?: unknown }} */ (contextState ?? {}).tokens);
    const utilization = finitePositiveNumber(/** @type {{ utilization?: unknown }} */ (contextState ?? {}).utilization);
    const estimatedContextTokens =
        directTokens ?? (tokenLimit !== null && utilization !== null ? Math.ceil(tokenLimit * utilization) : 0);
    return classifyByokEstimate(
        byok,
        Math.max(
            TERMINAL_BYOK_REQUEST_FLOOR_TOKENS,
            estimatedContextTokens + estimateMessageTokens(message) + TERMINAL_BYOK_RESPONSE_RESERVE_TOKENS,
        ),
        utilization,
        { subject: 'requisição' },
    );
}

/**
 * @param {ReturnType<typeof import('#copilot/config').readConfiguredByokSummary>} byok
 * @param {'chat' | 'agent'} mode
 * @param {string} prompt
 * @returns {ReturnType<typeof classifyByokEstimate>}
 */
export function evaluateTerminalByokProbeBudget(byok, mode, prompt) {
    const estimatedRequestTokens = Math.max(
        TERMINAL_BYOK_REQUEST_FLOOR_TOKENS,
        estimateMessageTokens(prompt) + TERMINAL_BYOK_RESPONSE_RESERVE_TOKENS,
    );
    const budget = classifyByokEstimate(byok, estimatedRequestTokens, null, {
        subject: `probe ${mode}`,
        lowLimitBlocks: true,
    });
    if (budget.shouldBlock && budget.limit !== null) {
        return {
            ...budget,
            label: `${budget.label}; o envelope SDK do terminal precisa de headroom >= ${TERMINAL_BYOK_REQUEST_FLOOR_TOKENS} tokens`,
        };
    }
    return budget;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {'block' | 'warn' | 'off'}
 */
export function readTerminalByokAdmissionMode(env = process.env) {
    const raw = String(env[TERMINAL_BYOK_ADMISSION_MODE_ENV] ?? 'block')
        .trim()
        .toLowerCase();
    if (raw === 'off' || raw === 'disabled' || raw === 'false' || raw === '0') {
        return 'off';
    }
    if (raw === 'warn' || raw === 'warning' || raw === 'warn-only') {
        return 'warn';
    }
    return 'block';
}
