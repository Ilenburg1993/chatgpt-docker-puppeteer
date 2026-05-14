// @ts-check
/**
 * src/copilot/tools/session/session-rpc-tools.js
 *
 * Tools que expõem operações avançadas de RPC de sessão do SDK para a LLM-B. Permitem ao agente mudar de modo
 * (interactive/plan/autopilot), ler/atualizar o plan.md da sessão infinita, listar/selecionar sub-agentes e acionar
 * compaction manual.
 *
 * Ativação: chamar setSessionRpc(createSessionRpcFacade(session)) após a sessão ser criada no always-alive.js.
 *
 * @module copilot/tools/session/session-rpc-tools
 * @see EventBus
 * @see module:copilot/lib/session
 * @see module:copilot/always-alive
 *
 * **SDK-05 (F6.13)**: estas APIs são RPCs JSON-RPC internos do CLI sem tipagem pública garantida.
 * Todas as chamadas são encapsuladas em `wrapRpc()` com try/catch e fallback gracioso (retorna `{ error }` em falha).
 * Em versões futuras do SDK, verificar se novos métodos públicos estão disponíveis como substitutos.
 */

import { COPILOT_RPC_TIMEOUT_MS, MAESTRO_AGENT_NAME } from '#copilot/config';
import { toError } from '#copilot/core';
import { z } from 'zod';
import { log } from '../infra/logger.js';
import { buildTool, withSkipPermission } from '../infra/tool-factory.js';

// ─── RPC handle injetado externamente ────────────────────────────────────────

/**
 * Handle RPC ativo da sessão corrente. Injetado via setSessionRpc() após inicialização.
 *
 * @type {ReturnType<typeof import('#copilot/sdk/rpc-facade').createSessionRpcFacade> | null}
 */
let _rpc = null;

/**
 * Injeta o handle RPC de uma sessão SDK ativa. Deve ser chamado após `initOrResumeSession()` retornar, passando a
 * façade criada por `createSessionRpcFacade(session)`.
 *
 * @param {unknown} rpc - façade RPC retornada por `createSessionRpcFacade(session)`
 * @returns {void}
 */
export function setSessionRpc(rpc) {
    _rpc = /** @type {ReturnType<typeof import('#copilot/sdk/rpc-facade').createSessionRpcFacade> | null} */ (rpc);
    log('DEBUG', `[session-rpc-tools] RPC ${rpc ? 'registrado' : 'removido'}.`);
}

/**
 * Reseta o estado do RPC para isolamento de testes.
 *
 * @returns {void}
 */
export function resetSessionRpcForTests() {
    _rpc = null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Verifica se o RPC está disponível ou retorna um erro padronizado.
 *
 * @returns {{ ok: true; rpc: ReturnType<typeof import('#copilot/sdk/rpc-facade').createSessionRpcFacade> }
 *     | { ok: false; error: string }}
 */
function getRpc() {
    if (!_rpc) return { ok: false, error: 'Sessão SDK não disponível. Agent não inicializado ou em reconexão.' };
    return { ok: true, rpc: _rpc };
}

/**
 * Timeout padrão para chamadas RPC (ms). GAP-TOOLS-003.
 *
 * @type {number}
 */
const RPC_TIMEOUT_MS = COPILOT_RPC_TIMEOUT_MS;

/**
 * Resolve timeout advisory efetivo para logging de chamadas RPC.
 *
 * Não impõe cancelamento de execução por tempo. O valor é utilizado apenas para telemetria e diagnósticos, preservando
 * a liberdade operacional da LLM-B.
 *
 * @param {number | null | undefined} timeoutMs
 * @returns {number | null}
 */
function resolveRpcTimeoutMs(timeoutMs) {
    if (timeoutMs === null) return null;
    if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0) {
        return timeoutMs;
    }
    return RPC_TIMEOUT_MS;
}

/**
 * Executa uma operação RPC com checagem de disponibilidade e tratamento de erros padronizado.
 *
 * @template T
 * @param {string} toolName - Nome do tool para logging
 * @param {(rpc: ReturnType<typeof import('#copilot/sdk/rpc-facade').createSessionRpcFacade>) => Promise<T>} fn - Função
 *   que recebe o handle RPC e executa a operação
 * @param {{ timeoutMs?: number | null }} [opts]
 * @returns {Promise<T | { error: string }>}
 */
async function wrapRpc(toolName, fn, opts = {}) {
    const r = getRpc();
    if (!r.ok) return { error: r.error };
    const advisoryTimeoutMs = resolveRpcTimeoutMs(opts.timeoutMs);
    try {
        const advisoryLabel = advisoryTimeoutMs === null ? 'none' : `${advisoryTimeoutMs}ms`;
        log('DEBUG', `[${toolName}] rpcTimeout=disabled advisory=${advisoryLabel}`);
        const result = await fn(r.rpc);
        return /** @type {T} */ (result);
    } catch (e) {
        log('ERROR', `[${toolName}] ${toError(e).message}`);
        return { error: toError(e).message };
    }
}

// ─── session_mode_get ─────────────────────────────────────────────────────────

/**
 * Tool: session_mode_get — retorna o modo atual da sessão SDK.
 */
const sessionModeGetTool = buildTool({
    name: 'session_mode_get',
    description:
        'Retorna o modo atual da sessão (interactive | plan | autopilot). ' +
        'Use para verificar em que modo o agente está antes de mudar.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<Record<string, never>>} */ (
        /** @type {unknown} */ (z.object({}))
    ),
    handler: async () =>
        wrapRpc('session_mode_get', async (rpc) => {
            // SDK-05: rpc.mode.get() é API interna — sem equivalente público no SDK v0.2.0
            const result = await rpc.mode.get();
            log('INFO', `[session_mode_get] mode=${result.mode}`);
            return result;
        }),
});

// ─── session_mode_set ─────────────────────────────────────────────────────────

/**
 * Tool: session_mode_set — muda o modo da sessão SDK.
 */
const sessionModeSetTool = buildTool({
    name: 'session_mode_set',
    description:
        'Muda o modo da sessão: "interactive" (responde imediatamente), "plan" (cria plan.md antes de agir) ' +
        'ou "autopilot" (age continuamente sem confirmação). Use "plan" para tarefas complexas que exigem ' +
        'planejamento estruturado antes da execução.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<{ mode: 'interactive' | 'plan' | 'autopilot' }>} */ (
        /** @type {unknown} */ (
            z.object({
                mode: z
                    .enum(['interactive', 'plan', 'autopilot'])
                    .describe('Novo modo: "interactive" | "plan" | "autopilot"'),
            })
        )
    ),
    handler: async (/** @type {{ mode: 'interactive' | 'plan' | 'autopilot' }} */ { mode }) =>
        wrapRpc('session_mode_set', async (rpc) => {
            const result = await rpc.mode.set(mode);
            log('INFO', `[session_mode_set] mode→${result.mode}`);
            return result;
        }),
});

// ─── session_plan_read ────────────────────────────────────────────────────────

/**
 * Tool: session_plan_read — lê o plan.md da sessão infinita.
 */
const sessionPlanReadTool = buildTool({
    name: 'session_plan_read',
    description:
        'Lê o conteúdo do plan.md da sessão infinita (infiniteSessions). Retorna null se o plano não existe ' +
        'ou a sessão não tiver workspace habilitado. Use para inspecionar o plano estruturado atual da sessão.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<Record<string, never>>} */ (
        /** @type {unknown} */ (z.object({}))
    ),
    handler: async () =>
        wrapRpc('session_plan_read', async (rpc) => {
            const result = await rpc.plan.read();
            log('INFO', `[session_plan_read] exists=${result.exists} path=${result.path ?? 'null'}`);
            return result;
        }),
});

// ─── session_plan_update ──────────────────────────────────────────────────────

/**
 * Tool: session_plan_update — atualiza/cria o plan.md da sessão infinita.
 */
const sessionPlanUpdateTool = buildTool({
    name: 'session_plan_update',
    description:
        'Atualiza ou cria o plan.md da sessão infinita com o conteúdo fornecido (Markdown). ' +
        'Use no modo "plan" para escrever o plano estruturado antes da execução. ' +
        'O plan.md persiste entre compactions da sessão infinita.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<{ content: string }>} */ (
        /** @type {unknown} */ (
            z.object({
                content: z.string().describe('Conteúdo Markdown do plano a ser gravado no plan.md'),
            })
        )
    ),
    handler: async (/** @type {{ content: string }} */ { content }) =>
        wrapRpc('session_plan_update', async (rpc) => {
            const result = await rpc.plan.update(content);
            log('INFO', `[session_plan_update] atualizado (${content.length} chars)`);
            return result;
        }),
});

// ─── session_plan_delete ──────────────────────────────────────────────────────

/**
 * Tool: session_plan_delete — remove o plan.md da sessão infinita.
 */
const sessionPlanDeleteTool = buildTool({
    name: 'session_plan_delete',
    description:
        'Remove o plan.md da sessão infinita. Use quando o plano foi concluído ou for reiniciado do zero. ' +
        'Idempotente: não retorna erro se o plan.md não existir.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<Record<string, never>>} */ (
        /** @type {unknown} */ (z.object({}))
    ),
    handler: async () =>
        wrapRpc('session_plan_delete', async (rpc) => {
            const result = await rpc.plan.delete();
            log('INFO', '[session_plan_delete] plan.md removido');
            return result;
        }),
});

// ─── session_agent_list ───────────────────────────────────────────────────────

/**
 * Tool: session_agent_list — lista os agentes disponíveis na sessão.
 */
const sessionAgentListTool = buildTool({
    name: 'session_agent_list',
    description:
        'Lista todos os agentes customizados disponíveis na sessão atual (auditor, docs, reviewer, etc.). ' +
        'Retorna nome, displayName e descrição de cada agente. Use para descobrir quais sub-agentes estão disponíveis.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<Record<string, never>>} */ (
        /** @type {unknown} */ (z.object({}))
    ),
    handler: async () =>
        wrapRpc('session_agent_list', async (rpc) => {
            const result = await rpc.agent.list();
            log('INFO', `[session_agent_list] ${result.agents.length} agentes disponíveis`);
            return result;
        }),
});

// ─── session_agent_current ────────────────────────────────────────────────────

/**
 * Tool: session_agent_current — retorna o agente ativo e reforça o maestro quando necessário.
 */
const sessionAgentCurrentTool = buildTool({
    name: 'session_agent_current',
    description:
        'Retorna o agente customizado ativo na sessão. Se o SDK informar outro agente ou nenhum agente, reforça agent-full como maestro.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<Record<string, never>>} */ (
        /** @type {unknown} */ (z.object({}))
    ),
    handler: async () =>
        wrapRpc('session_agent_current', async (rpc) => {
            const current = await rpc.agent.getCurrent();
            if (current.agent?.name === MAESTRO_AGENT_NAME) {
                return { agent: current.agent, enforced: false };
            }
            const selected = await rpc.agent.select(MAESTRO_AGENT_NAME);
            log('INFO', `[session_agent_current] maestro reforçado: ${selected.agent.name}`);
            return { agent: selected.agent, previousAgent: current.agent ?? null, enforced: true };
        }),
});

// ─── session_agent_select ─────────────────────────────────────────────────────

/**
 * Tool: session_agent_select — seleciona um agente customizado para o turno atual.
 */
const sessionAgentSelectTool = buildTool({
    name: 'session_agent_select',
    description:
        'Reforça o agente maestro agent-full na sessão atual. Selecionar outro agente diretamente é bloqueado; especialistas devem ser usados por delegação do maestro.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<{ name: string }>} */ (
        /** @type {unknown} */ (
            z.object({
                name: z.string().describe('Nome do agente a selecionar. Use "" para voltar ao agente padrão.'),
            })
        )
    ),
    handler: async (/** @type {{ name: string }} */ { name }) =>
        wrapRpc('session_agent_select', async (rpc) => {
            if (name && name !== MAESTRO_AGENT_NAME) {
                return {
                    error: `Seleção direta de "${name}" bloqueada. O agente ativo obrigatório é "${MAESTRO_AGENT_NAME}".`,
                    enforcedAgent: MAESTRO_AGENT_NAME,
                };
            }
            const result = await rpc.agent.select(MAESTRO_AGENT_NAME);
            log('INFO', `[session_agent_select] selecionado: ${result.agent.name}`);
            return result;
        }),
});

// ─── session_agent_reload ─────────────────────────────────────────────────────

/**
 * Tool: session_agent_reload — recarrega agentes SDK e reativa o maestro.
 */
const sessionAgentReloadTool = buildTool({
    name: 'session_agent_reload',
    description: 'Recarrega a lista de agentes customizados do SDK e reativa agent-full como maestro obrigatório.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<Record<string, never>>} */ (
        /** @type {unknown} */ (z.object({}))
    ),
    handler: async () =>
        wrapRpc('session_agent_reload', async (rpc) => {
            const reloaded = await rpc.agent.reload();
            const selected = await rpc.agent.select(MAESTRO_AGENT_NAME);
            log('INFO', `[session_agent_reload] ${reloaded.agents.length} agentes recarregados; maestro ativo.`);
            return { ...reloaded, selectedAgent: selected.agent };
        }),
});

// ─── session_compact ──────────────────────────────────────────────────────────

/**
 * Tool: session_compact — aciona compaction manual da sessão infinita.
 */
const sessionCompactTool = buildTool({
    name: 'session_compact',
    description:
        'Aciona compaction manual da sessão infinita para liberar tokens de contexto. ' +
        'Use quando o budget de tokens estiver alto (>75%) e a sessão precisar continuar operando. ' +
        'Retorna quantos tokens foram liberados e quantas mensagens foram removidas.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<Record<string, never>>} */ (
        /** @type {unknown} */ (z.object({}))
    ),
    handler: async () =>
        // Compaction pode ser legítima e naturalmente longa em sessões extensas; evitar timeout absoluto aqui.
        wrapRpc(
            'session_compact',
            async (rpc) => {
                const result = await rpc.compaction.compact();
                log(
                    'INFO',
                    `[session_compact] success=${result.success} freed=${result.tokensRemoved ?? 0} msgs=${result.messagesRemoved ?? 0}`,
                );
                return result;
            },
            { timeoutMs: null },
        ),
});

// ─── Export ───────────────────────────────────────────────────────────────────

/**
 * Tools de RPC de sessão SDK — mode, plan, agent, compaction.
 *
 * @type {import('#copilot/sdk/types').Tool<any>[]}
 */
export const sessionRpcTools = [
    withSkipPermission(sessionModeGetTool),
    sessionModeSetTool,
    withSkipPermission(sessionPlanReadTool),
    sessionPlanUpdateTool,
    sessionPlanDeleteTool,
    withSkipPermission(sessionAgentListTool),
    withSkipPermission(sessionAgentCurrentTool),
    sessionAgentSelectTool,
    sessionAgentReloadTool,
    sessionCompactTool,
];
