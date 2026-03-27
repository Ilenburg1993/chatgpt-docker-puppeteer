// @ts-check
/**
 * src/copilot/tools/session-rpc-tools.js
 *
 * Tools que expõem os RPCs do SDK (@github/copilot-sdk session.rpc.*) diretamente para a LLM-B. Permitem ao agente
 * mudar de modo (interactive/plan/autopilot), ler/atualizar o plan.md da sessão infinita, listar/selecionar sub-agentes
 * e acionar compaction manual.
 *
 * Ativação: chamar setSessionRpc(session.rpc) após a sessão ser criada no always-alive.js.
 *
 * @module copilot/tools/session-rpc-tools
 */

import { log } from '#core/logger';
import { defineTool } from '@github/copilot-sdk';
import { z } from 'zod';
import { withSkipPermission } from './tool-factory.js';

// ─── RPC handle injetado externamente ────────────────────────────────────────

/**
 * Handle RPC ativo da sessão corrente. Injetado via setSessionRpc() após inicialização.
 *
 * @type {any}
 */
let _rpc = null;

/**
 * Injeta o handle RPC de uma sessão SDK ativa. Deve ser chamado após `initOrResumeSession()` retornar, passando
 * `session.rpc`.
 *
 * @param {any} rpc - session.rpc retornado pelo SDK (ver @github/copilot-sdk Session.rpc)
 * @returns {void}
 */
export function setSessionRpc(rpc) {
    _rpc = rpc;
    log('DEBUG', `[session-rpc-tools] RPC ${rpc ? 'registrado' : 'removido'}.`);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Verifica se o RPC está disponível ou retorna um erro padronizado.
 *
 * @returns {{ ok: true; rpc: any } | { ok: false; error: string }}
 */
function getRpc() {
    if (!_rpc) return { ok: false, error: 'Sessão SDK não disponível. Agent não inicializado ou em reconexão.' };
    return { ok: true, rpc: _rpc };
}

// ─── session_mode_get ─────────────────────────────────────────────────────────

/**
 * Tool: session_mode_get — retorna o modo atual da sessão SDK.
 */
const sessionModeGetTool = defineTool('session_mode_get', {
    description:
        'Retorna o modo atual da sessão (interactive | plan | autopilot). ' +
        'Use para verificar em que modo o agente está antes de mudar.',
    parameters: /** @type {import('@github/copilot-sdk').ZodSchema<Record<string, never>>} */ (
        /** @type {unknown} */ (z.object({}))
    ),
    handler: async () => {
        const r = getRpc();
        if (!r.ok) return { error: r.error };
        try {
            const result = await r.rpc.mode.get();
            log('INFO', `[session_mode_get] mode=${result.mode}`);
            return result;
        } catch (/** @type {any} */ e) {
            log('ERROR', `[session_mode_get] ${e.message}`);
            return { error: e.message };
        }
    },
});

// ─── session_mode_set ─────────────────────────────────────────────────────────

/**
 * Tool: session_mode_set — muda o modo da sessão SDK.
 */
const sessionModeSetTool = defineTool('session_mode_set', {
    description:
        'Muda o modo da sessão: "interactive" (responde imediatamente), "plan" (cria plan.md antes de agir) ' +
        'ou "autopilot" (age continuamente sem confirmação). Use "plan" para tarefas complexas que exigem ' +
        'planejamento estruturado antes da execução.',
    parameters: /** @type {import('@github/copilot-sdk').ZodSchema<{ mode: 'interactive' | 'plan' | 'autopilot' }>} */ (
        /** @type {unknown} */ (
            z.object({
                mode: z
                    .enum(['interactive', 'plan', 'autopilot'])
                    .describe('Novo modo: "interactive" | "plan" | "autopilot"'),
            })
        )
    ),
    handler: async (/** @type {{ mode: 'interactive' | 'plan' | 'autopilot' }} */ { mode }) => {
        const r = getRpc();
        if (!r.ok) return { error: r.error };
        try {
            const result = await r.rpc.mode.set({ mode });
            log('INFO', `[session_mode_set] mode→${result.mode}`);
            return result;
        } catch (/** @type {any} */ e) {
            log('ERROR', `[session_mode_set] ${e.message}`);
            return { error: e.message };
        }
    },
});

// ─── session_plan_read ────────────────────────────────────────────────────────

/**
 * Tool: session_plan_read — lê o plan.md da sessão infinita.
 */
const sessionPlanReadTool = defineTool('session_plan_read', {
    description:
        'Lê o conteúdo do plan.md da sessão infinita (infiniteSessions). Retorna null se o plano não existe ' +
        'ou a sessão não tiver workspace habilitado. Use para inspecionar o plano estruturado atual da sessão.',
    parameters: /** @type {import('@github/copilot-sdk').ZodSchema<Record<string, never>>} */ (
        /** @type {unknown} */ (z.object({}))
    ),
    handler: async () => {
        const r = getRpc();
        if (!r.ok) return { error: r.error };
        try {
            const result = await r.rpc.plan.read();
            log('INFO', `[session_plan_read] exists=${result.exists} path=${result.filePath ?? 'null'}`);
            return result;
        } catch (/** @type {any} */ e) {
            log('ERROR', `[session_plan_read] ${e.message}`);
            return { error: e.message };
        }
    },
});

// ─── session_plan_update ──────────────────────────────────────────────────────

/**
 * Tool: session_plan_update — atualiza/cria o plan.md da sessão infinita.
 */
const sessionPlanUpdateTool = defineTool('session_plan_update', {
    description:
        'Atualiza ou cria o plan.md da sessão infinita com o conteúdo fornecido (Markdown). ' +
        'Use no modo "plan" para escrever o plano estruturado antes da execução. ' +
        'O plan.md persiste entre compactions da sessão infinita.',
    parameters: /** @type {import('@github/copilot-sdk').ZodSchema<{ content: string }>} */ (
        /** @type {unknown} */ (
            z.object({
                content: z.string().describe('Conteúdo Markdown do plano a ser gravado no plan.md'),
            })
        )
    ),
    handler: async (/** @type {{ content: string }} */ { content }) => {
        const r = getRpc();
        if (!r.ok) return { error: r.error };
        try {
            const result = await r.rpc.plan.update({ content });
            log('INFO', `[session_plan_update] atualizado (${content.length} chars)`);
            return result;
        } catch (/** @type {any} */ e) {
            log('ERROR', `[session_plan_update] ${e.message}`);
            return { error: e.message };
        }
    },
});

// ─── session_plan_delete ──────────────────────────────────────────────────────

/**
 * Tool: session_plan_delete — remove o plan.md da sessão infinita.
 */
const sessionPlanDeleteTool = defineTool('session_plan_delete', {
    description:
        'Remove o plan.md da sessão infinita. Use quando o plano foi concluído ou for reiniciado do zero. ' +
        'Idempotente: não retorna erro se o plan.md não existir.',
    parameters: /** @type {import('@github/copilot-sdk').ZodSchema<Record<string, never>>} */ (
        /** @type {unknown} */ (z.object({}))
    ),
    handler: async () => {
        const r = getRpc();
        if (!r.ok) return { error: r.error };
        try {
            const result = await r.rpc.plan.delete();
            log('INFO', '[session_plan_delete] plan.md removido');
            return result;
        } catch (/** @type {any} */ e) {
            log('ERROR', `[session_plan_delete] ${e.message}`);
            return { error: e.message };
        }
    },
});

// ─── session_agent_list ───────────────────────────────────────────────────────

/**
 * Tool: session_agent_list — lista os agentes disponíveis na sessão.
 */
const sessionAgentListTool = defineTool('session_agent_list', {
    description:
        'Lista todos os agentes customizados disponíveis na sessão atual (auditor, docs, reviewer, etc.). ' +
        'Retorna nome, displayName e descrição de cada agente. Use para descobrir quais sub-agentes estão disponíveis.',
    parameters: /** @type {import('@github/copilot-sdk').ZodSchema<Record<string, never>>} */ (
        /** @type {unknown} */ (z.object({}))
    ),
    handler: async () => {
        const r = getRpc();
        if (!r.ok) return { error: r.error };
        try {
            const result = await r.rpc.agent.list();
            log('INFO', `[session_agent_list] ${result.agents.length} agentes disponíveis`);
            return result;
        } catch (/** @type {any} */ e) {
            log('ERROR', `[session_agent_list] ${e.message}`);
            return { error: e.message };
        }
    },
});

// ─── session_agent_select ─────────────────────────────────────────────────────

/**
 * Tool: session_agent_select — seleciona um agente customizado para o turno atual.
 */
const sessionAgentSelectTool = defineTool('session_agent_select', {
    description:
        'Seleciona um sub-agente pelo nome para o turno atual (ex: "auditor", "docs", "reviewer"). ' +
        'Passe name="" ou null para voltar ao agente padrão. ' +
        'O agente selecionado tem suas próprias instruções e ferramentas disponíveis.',
    parameters: /** @type {import('@github/copilot-sdk').ZodSchema<{ name: string }>} */ (
        /** @type {unknown} */ (
            z.object({
                name: z.string().describe('Nome do agente a selecionar. Use "" para voltar ao agente padrão.'),
            })
        )
    ),
    handler: async (/** @type {{ name: string }} */ { name }) => {
        const r = getRpc();
        if (!r.ok) return { error: r.error };
        try {
            if (!name) {
                await r.rpc.agent.deselect();
                log('INFO', '[session_agent_select] agente deselecionado (padrão)');
                return { selected: null };
            }
            const result = await r.rpc.agent.select({ name });
            log('INFO', `[session_agent_select] selecionado: ${result.agent.name}`);
            return result;
        } catch (/** @type {any} */ e) {
            log('ERROR', `[session_agent_select] ${e.message}`);
            return { error: e.message };
        }
    },
});

// ─── session_compact ──────────────────────────────────────────────────────────

/**
 * Tool: session_compact — aciona compaction manual da sessão infinita.
 */
const sessionCompactTool = defineTool('session_compact', {
    description:
        'Aciona compaction manual da sessão infinita para liberar tokens de contexto. ' +
        'Use quando o budget de tokens estiver alto (>75%) e a sessão precisar continuar operando. ' +
        'Retorna quantos tokens foram liberados e quantas mensagens foram removidas.',
    parameters: /** @type {import('@github/copilot-sdk').ZodSchema<Record<string, never>>} */ (
        /** @type {unknown} */ (z.object({}))
    ),
    handler: async () => {
        const r = getRpc();
        if (!r.ok) return { error: r.error };
        try {
            const result = await r.rpc.compaction.compact();
            log(
                'INFO',
                `[session_compact] success=${result.success} freed=${result.tokensFreed ?? 0} msgs=${result.messagesRemoved ?? 0}`,
            );
            return result;
        } catch (/** @type {any} */ e) {
            log('ERROR', `[session_compact] ${e.message}`);
            return { error: e.message };
        }
    },
});

// ─── Export ───────────────────────────────────────────────────────────────────

/**
 * Tools de RPC de sessão SDK — mode, plan, agent, compaction.
 *
 * @type {import('@github/copilot-sdk').Tool[]}
 */
export const sessionRpcTools = [
    withSkipPermission(sessionModeGetTool),
    sessionModeSetTool,
    withSkipPermission(sessionPlanReadTool),
    sessionPlanUpdateTool,
    sessionPlanDeleteTool,
    withSkipPermission(sessionAgentListTool),
    sessionAgentSelectTool,
    sessionCompactTool,
];
