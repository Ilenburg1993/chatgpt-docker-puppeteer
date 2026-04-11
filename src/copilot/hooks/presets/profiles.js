// @ts-check
/**
 * src/copilot/hooks/presets/profiles.js — [L3] Profile builders de SessionConfig.
 *
 * Movidos de `config/session-config.js` (L2) pois dependem de hooks (L3). Cada builder retorna um SessionConfig
 * pré-configurado para um padrão de uso específico (always-alive, read-only, full-access, diagnostic).
 *
 * @module copilot/hooks/presets/profiles
 * @see EventBus
 * @see module:copilot/config/session-config
 */

import { buildHookContextAppendMessage } from '#copilot/config';
import { approveAll } from '#copilot/sdk';
import { createHooks } from '../factory.js';
import { createApproveAllPermission, createAuditOnlyPermission, createSafePermission } from '../permission-handler.js';

/**
 * @typedef {import('#copilot/sdk/types').SessionConfig} SessionConfig
 *
 * @typedef {import('#copilot/sdk/types').Tool} Tool
 *
 * @typedef {import('#copilot/sdk/types').PermissionHandler} PermissionHandler
 */

/**
 * Configuração base compartilhada por todos os perfis de sessão.
 *
 * @type {Partial<SessionConfig>}
 */
const BASE_CONFIG = {
    streaming: true,
    infiniteSessions: { enabled: true, backgroundCompactionThreshold: 0.75 },
};

/**
 * Cria uma configuração de sessão para o Always-Alive Agent.
 *
 * Características:
 *
 * - approve-all para permissões de escrita (agente autônomo)
 * - infiniteSessions habilitado
 * - hooks de auditoria incluídos
 * - context hook injetado no systemMessage
 *
 * @param {object} options
 * @param {string} [options.model='gpt-4.1'] - Modelo a usar. Default is `'gpt-4.1'`
 * @param {Tool[]} [options.tools=[]] - Custom tools a registrar. Default is `[]`
 * @param {PermissionHandler} [options.onPermissionRequest] - Override do handler de permissões (default: approveAll)
 * @param {Function} [options.onUserInputRequest] - Handler para perguntas do modelo
 * @param {string} [options.hookContextContent] - Conteúdo do Hook System para injetar no systemMessage
 * @returns {SessionConfig}
 */
export function buildAlwaysAliveConfig(options = {}) {
    const {
        model = 'gpt-4.1',
        tools = [],
        onPermissionRequest = approveAll,
        onUserInputRequest,
        hookContextContent,
    } = options;

    /** @type {Record<string, unknown>} */
    const hooks = createHooks({
        onSessionStart: (/** @type {Record<string, unknown>} */ ev) => {
            void ev; // handled by AlwaysAliveAgent
        },
        onSessionEnd: (/** @type {Record<string, unknown>} */ ev) => {
            void ev; // handled by AlwaysAliveAgent
        },
    });

    /** @type {SessionConfig} */
    const config = /** @type {SessionConfig} */ (
        /** @type {unknown} */ ({
            ...BASE_CONFIG,
            model,
            tools,
            onPermissionRequest,
            ...(onUserInputRequest !== undefined ? { onUserInputRequest } : {}),
            hooks,
            ...(hookContextContent
                ? {
                      systemMessage: buildHookContextAppendMessage(hookContextContent),
                  }
                : {}),
        })
    );

    return config;
}

/**
 * Cria uma configuração de sessão read-only (sem aprovação automática de permissões de escrita).
 *
 * Características:
 *
 * - audit-only para permissões (rejeita modificações)
 * - Adequado para análise/exploração sem side-effects
 *
 * @param {object} [options={}] Default is `{}`
 * @param {string} [options.model='gpt-4.1'] - Modelo a usar. Default is `'gpt-4.1'`
 * @param {Tool[]} [options.tools=[]] - Custom tools (readonly) a registrar. Default is `[]`
 * @returns {SessionConfig}
 */
export function buildReadOnlyConfig(options = {}) {
    const { model = 'gpt-4.1', tools = [] } = options;

    return /** @type {SessionConfig} */ ({
        ...BASE_CONFIG,
        model,
        tools,
        onPermissionRequest: createAuditOnlyPermission(),
    });
}

/**
 * Cria uma configuração de sessão full-access com aprovação seletiva via prompt.
 *
 * Características:
 *
 * - safe-permission (aprova leitura, pergunta ao usuário para escrita)
 * - Adequado para agentes que precisam de validação humana em modificações
 *
 * @param {object} [options={}] Default is `{}`
 * @param {string} [options.model='gpt-4.1'] - Modelo a usar. Default is `'gpt-4.1'`
 * @param {Tool[]} [options.tools=[]] - Custom tools a registrar. Default is `[]`
 * @param {string[]} [options.denyTools=[]] - Nomes de tools que devem ser bloqueadas (restante aprovado). Default is
 *   `[]`
 * @returns {SessionConfig}
 */
export function buildFullAccessConfig(options = {}) {
    const { model = 'gpt-4.1', tools = [], denyTools = [] } = options;

    return /** @type {SessionConfig} */ ({
        ...BASE_CONFIG,
        model,
        tools,
        onPermissionRequest: createSafePermission(denyTools),
    });
}

/**
 * Cria uma configuração mínima para testes e diagnósticos.
 *
 * Características:
 *
 * - approve-all
 * - infiniteSessions desabilitado
 * - streaming desabilitado
 *
 * @param {object} [options={}] Default is `{}`
 * @param {string} [options.model='gpt-4.1-mini'] - Modelo a usar (default: mini para baixo custo). Default is
 *   `'gpt-4.1-mini'`
 * @param {Tool[]} [options.tools=[]] - Custom tools a registrar. Default is `[]`
 * @returns {SessionConfig}
 */
export function buildDiagnosticConfig(options = {}) {
    const { model = 'gpt-4.1-mini', tools = [] } = options;

    return /** @type {SessionConfig} */ ({
        model,
        tools,
        streaming: false,
        onPermissionRequest: createApproveAllPermission(),
    });
}
