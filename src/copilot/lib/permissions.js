// @ts-check
/**
 * src/copilot/lib/permissions.js
 *
 * Camada de lib pura para PermissionHandler — substitui o `approveAll` hardcoded por uma abstração configurável que
 * suporta whitelist/blacklist de tools, audit mode e callbacks custom.
 *
 * **Contratos do SDK (v0.1.32):** `PermissionRequestResult` union:
 *
 * - `{ kind: "approved" }`
 * - `{ kind: "denied-by-rules"; rules: unknown[] }`
 * - `{ kind: "denied-no-approval-rule-and-could-not-request-from-user" }`
 * - `{ kind: "denied-interactively-by-user"; feedback?: string }`
 * - `{ kind: "denied-by-content-exclusion-policy"; path: string; message: string }`
 *
 * **Regras arquiteturais:**
 *
 * - Sem side effects no import.
 * - Funções puras que retornam `PermissionHandler` tipado do SDK.
 *
 * @module copilot/lib/permissions
 * @see module:copilot/agent/permission-controller
 * @see module:copilot/tools/permission-tools
 */

import { log } from '#core/logger';
import { approveAll } from '@github/copilot-sdk';

/**
 * @typedef {import('@github/copilot-sdk').PermissionHandler} PermissionHandler
 *
 * @typedef {import('@github/copilot-sdk').PermissionRequest} PermissionRequest
 *
 * @typedef {import('@github/copilot-sdk').PermissionRequestResult} PermissionRequestResult
 */

/**
 * Valor de decisão retornado pelo callback onRequest:
 *
 * - `true` - aprovado
 * - `false` ou `'deny'` - negado (denied-by-rules)
 * - `undefined` - delega a logica padrao do createPermissionHandler
 *
 * @callback OnPermissionRequestCallback
 * @param {PermissionRequest} request
 * @returns {Promise<boolean | 'deny' | undefined> | boolean | 'deny' | undefined}
 */

/**
 * @typedef {Object} PermissionHandlerConfig
 * @property {boolean} [allowAll] - Aprovar todas as requisicoes
 * @property {string[]} [allowTools] - Whitelist: apenas estas tools sao aprovadas
 * @property {string[]} [denyTools] - Blacklist de tools negadas (ignorado se allowTools definido)
 * @property {RegExp[]} [denyPatterns] - Regex: tools cujo nome corresponder sao negadas
 * @property {boolean} [auditMode] - Loga cada decisao sem alterar o resultado
 * @property {OnPermissionRequestCallback} [onRequest] - Callback com precedencia total
 */

/**
 * Retorna resultado "approved" no formato do SDK.
 *
 * @returns {PermissionRequestResult}
 */
function makeApproved() {
    return /** @type {PermissionRequestResult} */ ({ kind: 'approved' });
}

/**
 * Retorna resultado "denied-by-rules" no formato do SDK.
 *
 * @returns {PermissionRequestResult}
 */
function makeDenied() {
    return /** @type {PermissionRequestResult} */ ({ kind: 'denied-by-rules', rules: [] });
}

/**
 * Cria um PermissionHandler configuravel baseado nas opcoes fornecidas.
 *
 * Ordem de avaliacao:
 *
 * 1. onRequest(req) - se definido e retorna valor nao-undefined, usa esse resultado
 * 2. allowAll: true - aprova tudo (semantica do approveAll)
 * 3. allowTools - whitelist: somente tools listadas sao aprovadas
 * 4. denyPatterns - regex: tools com nome correspondente sao negadas
 * 5. denyTools - blacklist nominal
 * 6. Default: aprova tudo
 *
 * @example
 *     const handler = createPermissionHandler({ allowAll: false, denyTools: ['shell'] });
 *
 * @param {PermissionHandlerConfig} [config]
 * @returns {PermissionHandler}
 */
export function createPermissionHandler(config) {
    const cfg = config ?? {};
    const allowAll = cfg.allowAll ?? false;
    const allowTools = cfg.allowTools;
    const denyTools = cfg.denyTools ?? [];
    const denyPatterns = cfg.denyPatterns ?? [];
    const auditMode = cfg.auditMode ?? false;
    const onRequest = cfg.onRequest;

    const handlerFn = async (/** @type {PermissionRequest} */ request) => {
        const toolName =
            /** @type {{ toolName?: string; tool?: string }} */ (request)?.toolName ??
            /** @type {{ toolName?: string; tool?: string }} */ (request)?.tool ??
            'unknown';

        // SDK-02 (fix): tratar content-exclusion-policy — não aprovar automaticamente
        // O SDK pode invocar o handler com kind='content-exclusion-check' para arquivos bloqueados por política
        if (/** @type {{ kind?: string }} */ (request)?.kind === 'content-exclusion-check') {
            const path = /** @type {{ path?: string }} */ (request)?.path ?? 'desconhecido';
            log('WARN', `[lib/permissions] NEGADO (content-exclusion-policy): path='${path}'`);
            return /** @type {PermissionRequestResult} */ ({
                kind: 'denied-by-content-exclusion-policy',
                path,
                message: 'Arquivo bloqueado pela política de exclusão de conteúdo.',
            });
        }

        // 1. Callback custom tem precedencia total
        if (onRequest) {
            const customResult = await onRequest(request);
            if (customResult !== undefined) {
                const approved = customResult === true;
                if (auditMode || !approved) {
                    log(
                        approved ? 'INFO' : 'WARN',
                        '[lib/permissions] ' +
                            (approved ? 'APROVADO' : 'NEGADO') +
                            " via onRequest: tool='" +
                            toolName +
                            "'",
                    );
                }
                return approved ? makeApproved() : makeDenied();
            }
        }

        // 2. allowAll - equivalente ao approveAll do SDK
        if (allowAll) {
            if (auditMode) {
                log('INFO', "[lib/permissions] APROVADO (allowAll): tool='" + toolName + "'");
            }
            return makeApproved();
        }

        // 3. Whitelist
        if (allowTools && allowTools.length > 0) {
            const approved = allowTools.includes(toolName);
            if (auditMode || !approved) {
                log(
                    approved ? 'INFO' : 'WARN',
                    '[lib/permissions] ' + (approved ? 'APROVADO' : 'NEGADO') + " (whitelist): tool='" + toolName + "'",
                );
            }
            return approved ? makeApproved() : makeDenied();
        }

        // 4. Regex deny patterns
        if (denyPatterns.length > 0) {
            const matched = denyPatterns.find((p) => p.test(toolName));
            if (matched) {
                log('WARN', '[lib/permissions] NEGADO (denyPattern ' + String(matched) + "): tool='" + toolName + "'");
                return makeDenied();
            }
        }

        // 5. Blacklist nominal
        if (denyTools.length > 0 && denyTools.includes(toolName)) {
            log('WARN', "[lib/permissions] NEGADO (denyTools): tool='" + toolName + "'");
            return makeDenied();
        }

        // 6. Default: aprova
        if (auditMode) {
            log('INFO', "[lib/permissions] APROVADO (default): tool='" + toolName + "'");
        }
        return makeApproved();
    };

    const handler = /** @type {PermissionHandler} */ (handlerFn);
    return handler;
}

/**
 * Retorna o approveAll oficial do SDK.
 *
 * @example
 *     const handler = createApproveAllPermission();
 *
 * @returns {PermissionHandler}
 */
export function createApproveAllPermission() {
    return approveAll;
}

/**
 * Cria um handler que aprova tudo mas loga cada decisao.
 *
 * @example
 *     const handler = createAuditOnlyPermission();
 *
 * @returns {PermissionHandler}
 */
export function createAuditOnlyPermission() {
    return createPermissionHandler({ auditMode: true });
}

/**
 * Cria um handler com whitelist rigida.
 *
 * @param {string[]} allowedTools - Nomes de tools permitidas
 * @returns {PermissionHandler}
 */
export function createRestrictedPermission(allowedTools) {
    return createPermissionHandler({ allowTools: allowedTools });
}

/**
 * Cria um handler que nega tools de execucao shell arbitraria e aprova o restante.
 *
 * @param {string[]} [additionalDenyTools] - Tools adicionais a negar
 * @returns {PermissionHandler}
 */
export function createSafePermission(additionalDenyTools) {
    return createPermissionHandler({
        // PERM-03-FIX: usar nomes reais das shell-tools do projeto (não nomes genéricos)
        denyTools: ['run_shell_command', 'run_npm_script', 'run_node_script', ...(additionalDenyTools ?? [])],
    });
}
