// @ts-check
/**
 * src/copilot/terminal/commands/config.js
 *
 * Comandos de configuração em runtime do REPL terminal LLM-B: /model, /reasoning.
 *
 * Permitem trocar o modelo e o nível de raciocínio sem reiniciar a sessão.
 *
 * @module copilot/terminal/commands/config
 */

import { alwaysAliveAgent } from '#copilot/agent';
import { modelRegistry, modelStatsTracker } from '#copilot/sdk/models/registry';
import { listModels } from '#copilot/sdk/models/helpers';

/** @typedef {'low' | 'medium' | 'high' | 'xhigh'} ReasoningEffort */

/** Esforços de raciocínio válidos. @type {readonly ReasoningEffort[]} */
const VALID_EFFORTS = /** @type {const} */ (['low', 'medium', 'high', 'xhigh']);

/**
 * @typedef {object} ConfigContext
 * @property {(text: string) => void} println - Função de output do terminal
 */

// ─── /model ──────────────────────────────────────────────────────────────────

/**
 * Comando `/model [id|list]`.
 *
 * - Sem argumento: exibe o modelo atual.
 * - `list`: lista modelos disponíveis via SDK.
 * - `<id>`: troca para o modelo indicado (sem validação remota — troca imediata).
 *
 * @param {ConfigContext} ctx
 * @param {string} [arg] - Argumento fornecido pelo usuário
 * @returns {Promise<void>}
 */
export async function cmdModel({ println }, arg) {
    const current = alwaysAliveAgent.model;

    if (!arg || arg.trim() === '') {
        println(`\n  🤖  Modelo ativo: \x1b[36m${current}\x1b[0m`);
        const meta = modelRegistry.get(current);
        if (meta) {
            println(
                `  \x1b[90m    cost=${meta.costTier}  speed=${meta.speedTier}  ctx=${meta.contextWindow.toLocaleString()}\x1b[0m`,
            );
        }
        println(`  \x1b[90mUso: /model list | stats | <id>\x1b[0m\n`);
        return;
    }

    const trimmed = arg.trim().toLowerCase();

    if (trimmed === 'stats') {
        const stats = modelStatsTracker.allStats();
        if (stats.length === 0) {
            println('  \x1b[33mSem estatísticas coletadas ainda.\x1b[0m\n');
            return;
        }
        println(`\n  \x1b[36mEstatísticas por modelo:\x1b[0m\n`);
        for (const s of stats) {
            const isActive = s.modelId === current;
            const marker = isActive ? ' \x1b[32m← ativo\x1b[0m' : '';
            const rate = (s.successRate * 100).toFixed(0);
            println(`    \x1b[33m${s.modelId}\x1b[0m${marker}`);
            println(
                `      calls=${s.totalCalls}  avg_latency=${s.avgLatencyMs}ms  success=${rate}%  tokens=${s.totalTokens}`,
            );
        }
        println('');
        return;
    }

    if (trimmed === 'list') {
        println('\x1b[90m  Consultando modelos disponíveis…\x1b[0m');
        try {
            const models = await listModels();
            if (models.length === 0) {
                println('  \x1b[33mNenhum modelo retornado pelo SDK.\x1b[0m\n');
                return;
            }
            println(`\n  \x1b[36m${models.length} modelo(s) disponível(is):\x1b[0m\n`);
            for (const m of models) {
                const isActive = m.id === current;
                const activeMarker = isActive ? ' \x1b[32m← ativo\x1b[0m' : '';
                const reasoning = m.capabilities?.supports?.reasoningEffort ? ' \x1b[90m[reasoning]\x1b[0m' : '';
                const vision = m.capabilities?.supports?.vision ? ' \x1b[90m[vision]\x1b[0m' : '';
                println(`    \x1b[33m${m.id}\x1b[0m${activeMarker}${reasoning}${vision}`);
            }
            println('');
        } catch (/** @type {any} */ e) {
            println(`  \x1b[31m[erro] Não foi possível listar modelos: ${e.message}\x1b[0m\n`);
        }
        return;
    }

    // Troca de modelo
    const previous = current;
    alwaysAliveAgent.setModel(trimmed);
    println(`\n  🔄  Modelo trocado: \x1b[90m${previous}\x1b[0m → \x1b[36m${trimmed}\x1b[0m`);
    println('  \x1b[90mEfetivo no próximo turno. Use /restart para reiniciar o loop com o novo modelo.\x1b[0m\n');
}

// ─── /reasoning ──────────────────────────────────────────────────────────────

/**
 * Comando `/reasoning [level]`.
 *
 * - Sem argumento: exibe o nível atual.
 * - `<level>`: troca para `low`, `medium`, `high` ou `xhigh`.
 * - `off` / `none`: desativa raciocínio extendido (undefined).
 *
 * @param {ConfigContext} ctx
 * @param {string} [arg] - Argumento fornecido pelo usuário
 * @returns {void}
 */
export function cmdReasoning({ println }, arg) {
    const current = alwaysAliveAgent.reasoningEffort ?? 'off';

    if (!arg || arg.trim() === '') {
        println(`\n  🧠  Reasoning effort: \x1b[36m${current}\x1b[0m`);
        println(`  \x1b[90mUso: /reasoning low | medium | high | xhigh | off\x1b[0m\n`);
        return;
    }

    const trimmed = arg.trim().toLowerCase();

    if (trimmed === 'off' || trimmed === 'none') {
        alwaysAliveAgent.setReasoningEffort(undefined);
        println(`\n  🧠  Raciocínio extendido \x1b[33mdesativado\x1b[0m (modelo decide autonomamente)\n`);
        return;
    }

    if (!VALID_EFFORTS.includes(/** @type {ReasoningEffort} */ (trimmed))) {
        println(`\n  \x1b[31m[erro]\x1b[0m Nível inválido: "${trimmed}". Use: ${VALID_EFFORTS.join(' | ')} | off\n`);
        return;
    }

    const previous = current;
    alwaysAliveAgent.setReasoningEffort(/** @type {ReasoningEffort} */ (trimmed));
    println(`\n  🧠  Reasoning trocado: \x1b[90m${previous}\x1b[0m → \x1b[36m${trimmed}\x1b[0m`);
    println('  \x1b[90mEfetivo no próximo turno.\x1b[0m\n');
}
