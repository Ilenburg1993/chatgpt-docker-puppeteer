// @ts-check
/**
 * @module copilot/agent/facades/permission-tools-facade
 * @file Façade para delegação de permissões e gerenciamento de tools/webhooks.
 *
 *   Extração de 11 métodos do AlwaysAliveAgent para reduzir complexidade.
 */

import {
    listWebhooks,
    readRuntimeContextFactoryCapabilities,
    readRuntimePermissionCapability,
    readRuntimePermissionMode,
    readRuntimePermissionPolicySnapshot,
    readRuntimeToolRegistry,
    readRuntimeToolRegistryEntries,
    readRuntimeToolSessionContext,
    registerWebhook,
    setRuntimePermissionMode,
    unregisterWebhook,
} from '../runtime/root-surface/index.js';

/**
 * Façade para Permissões e Tools Registry.
 *
 * Agrupa:
 *
 * - getPermissionMode / setPermissionMode + policy/capability snapshots
 * - Tool session context + registry snapshots
 * - Webhook management (register/unregister/list)
 *
 * Todas as operações são delegações puras para runtime/root-surface/.
 *
 * @see module:copilot/agent/always-alive
 */
export class PermissionToolsFacade {
    /**
     * @param {import('../agent-context.js').AgentContext} ctx
     */
    constructor(ctx) {
        this.ctx = ctx;
    }

    /**
     * Retorna o modo de permissão ativo como string legível.
     *
     * Modos disponíveis:
     *
     * - `"approve_all"` — aprova tudo automaticamente (comportamento padrão, SDK approveAll)
     * - `"audit_only"` — aprova tudo mas loga cada decisão
     * - `"selective"` — whitelist/blacklist/callback customizado
     *
     * @returns {'approve_all' | 'audit_only' | 'selective'}
     */
    getPermissionMode() {
        return readRuntimePermissionMode(this.ctx);
    }

    /**
     * Altera o modo de aprovação de tools em runtime — sem reiniciar o agente.
     *
     * A mudança afeta as próximas requisições de permissão da sessão viva. O agent entrega ao SDK um handler estável e
     * troca apenas a policy delegada por ele.
     *
     * O dialog loop não é uma tool e não passa por este handler. Não é possível bloquear o encerramento do dialog loop
     * via configuração de permissão.
     *
     * @param {'approve_all' | 'audit_only' | 'selective'} mode - Modo de aprovação
     * @param {{ allowTools?: string[]; denyTools?: string[]; denyShell?: boolean }} [opts] - Opções para modo selective
     * @returns {void}
     */
    setPermissionMode(mode, opts = {}) {
        setRuntimePermissionMode(this.ctx, mode, opts);
    }

    /**
     * Retorna readiness e metadata da capability de permissões governada pelo agent.
     *
     * @returns {{ mode: 'approve_all' | 'audit_only' | 'selective'; handlerAvailable: boolean }}
     */
    getPermissionCapabilitySnapshot() {
        return readRuntimePermissionCapability(this.ctx);
    }

    /**
     * Retorna snapshot detalhado da policy de permissões ativa (modo, allow/deny lists, denyShell, defaultDecision).
     *
     * @returns {ReturnType<typeof readRuntimePermissionPolicySnapshot>}
     */
    getPermissionPolicySnapshot() {
        return readRuntimePermissionPolicySnapshot(this.ctx);
    }

    /**
     * Retorna o `ToolSessionContext` desta sessão — encapsula estado por sessão (input pendente, broadcast SSE).
     *
     * @returns {import('#copilot/sdk/types').ToolSessionContext}
     */
    getToolSessionContext() {
        return readRuntimeToolSessionContext(this.ctx);
    }

    /**
     * Retorna metadata do conjunto de factories que materializou managers/capabilities vivos do contexto.
     *
     * @returns {Record<string, Record<string, unknown>>}
     */
    getContextFactoryCapabilitiesSnapshot() {
        return readRuntimeContextFactoryCapabilities(this.ctx);
    }

    /**
     * Retorna o registry ativo de tools sem expor o manager como contrato preferencial.
     *
     * @returns {import('#copilot/sdk/types').ToolRegistry}
     */
    getToolRegistrySnapshot() {
        return readRuntimeToolRegistry(this.ctx);
    }

    /**
     * Retorna uma projeção serializável das tools registradas no runtime.
     *
     * @returns {{
     *     name: string;
     *     description: string | null;
     *     category: string;
     *     tags: string[];
     *     readOnly: boolean;
     *     skipPermission: boolean;
     * }[]}
     */
    getToolRegistryEntriesSnapshot() {
        return readRuntimeToolRegistryEntries(this.ctx);
    }

    /**
     * Registra uma URL de webhook para notificações de sessão.
     *
     * @param {string} url - URL HTTP(S) que receberá POST com payload de evento
     * @returns {{ id: string; url: string }} Identificador do webhook registrado
     */
    registerWebhook(url) {
        return registerWebhook(this.ctx, url);
    }

    /**
     * Remove um webhook previamente registrado.
     *
     * @param {string} id - ID do webhook a remover
     * @returns {boolean} true se removido, false se não encontrado
     */
    unregisterWebhook(id) {
        return unregisterWebhook(this.ctx, id);
    }

    /**
     * Lista todos os webhooks registrados.
     *
     * @returns {{ id: string; url: string }[]}
     */
    listWebhooks() {
        return listWebhooks(this.ctx);
    }
}
