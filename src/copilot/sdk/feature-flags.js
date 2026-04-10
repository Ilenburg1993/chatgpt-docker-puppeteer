// @ts-check
/**
 * src/copilot/sdk/feature-flags.js
 *
 * Faixa 22 — Configuração de feature flags para APIs experimentais do Copilot SDK.
 *
 * As APIs experimentais são gated por feature flags — desabilitadas por padrão. Para habilitar, use
 * `setExperimentalFlag(name, true)` ou configure via variáveis de ambiente `COPILOT_EXPERIMENTAL_<NAME>=1`.
 *
 * @module copilot/sdk/feature-flags
 */

// ─── Tipos ────────────────────────────────────────────────────────────────────

/**
 * @typedef {'fleet' | 'agents' | 'skills' | 'mcp' | 'plugins' | 'extensions'} ExperimentalFeature
 */

/**
 * @typedef {Record<ExperimentalFeature, boolean>} ExperimentalFlags
 */

// ─── Estado ───────────────────────────────────────────────────────────────────

/** Nomes canônicos das features experimentais suportadas. */
export const EXPERIMENTAL_FEATURES = /** @type {readonly ExperimentalFeature[]} */ (
    Object.freeze(['fleet', 'agents', 'skills', 'mcp', 'plugins', 'extensions'])
);

/** @type {ExperimentalFlags} */
const _flags = {
    fleet: false,
    agents: false,
    skills: false,
    mcp: false,
    plugins: false,
    extensions: false,
};

// Lê variáveis de ambiente na inicialização do módulo
for (const name of EXPERIMENTAL_FEATURES) {
    const envKey = `COPILOT_EXPERIMENTAL_${name.toUpperCase()}`;
    if (process.env[envKey] === '1' || process.env[envKey] === 'true') {
        _flags[name] = true;
    }
}

// ─── API ──────────────────────────────────────────────────────────────────────

/**
 * Retorna se uma feature experimental está habilitada.
 *
 * @param {ExperimentalFeature} name — nome da feature
 * @returns {boolean}
 */
export function isExperimentalEnabled(name) {
    return _flags[name] === true;
}

/**
 * Habilita ou desabilita uma feature experimental em tempo de execução (útil em testes e configurações dinâmicas).
 *
 * @param {ExperimentalFeature} name — nome da feature
 * @param {boolean} enabled — true para habilitar, false para desabilitar
 * @returns {void}
 */
export function setExperimentalFlag(name, enabled) {
    if (!EXPERIMENTAL_FEATURES.includes(name)) {
        throw new RangeError(
            `[sdk/feature-flags] Feature desconhecida: '${name}'. Válidas: ${EXPERIMENTAL_FEATURES.join(', ')}`,
        );
    }
    _flags[name] = enabled;
}

/**
 * Retorna snapshot imutável de todos os flags.
 *
 * @returns {Readonly<ExperimentalFlags>}
 */
export function getExperimentalFlags() {
    return Object.freeze({ ..._flags });
}

/**
 * Reseta todos os flags para o estado padrão (false). Útil em teardown de testes.
 *
 * @returns {void}
 */
export function resetExperimentalFlags() {
    for (const name of EXPERIMENTAL_FEATURES) {
        _flags[name] = false;
    }
}
