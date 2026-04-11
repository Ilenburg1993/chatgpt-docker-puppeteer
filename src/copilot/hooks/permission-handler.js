// @ts-check
/**
 * src/copilot/hooks/permission-handler.js
 *
 * Factory para PermissionHandler do Copilot SDK. Migrado de src/copilot/lib/permissions.js — esse arquivo é mantido
 * como re-export.
 *
 * Suporta whitelist/blacklist de tools, audit mode e callbacks custom.
 *
 * Contratos do SDK — PermissionRequestResult union:
 *
 * - `{ kind: "approved" }`
 * - `{ kind: "denied-by-rules"; rules: unknown[] }`
 * - `{ kind: "denied-no-approval-rule-and-could-not-request-from-user" }`
 * - `{ kind: "denied-interactively-by-user"; feedback?: string }`
 * - `{ kind: "denied-by-content-exclusion-policy"; path: string; message: string }`
 *
 * @module copilot/hooks/permission-handler
 * @see EventBus
 * @see module:copilot/hooks/types
 */

import { log } from '#copilot/observability';
import { approveAll } from '#copilot/sdk';

/**
 * @typedef {import('./types.js').PermissionHandler} PermissionHandler
 *
 * @typedef {import('./types.js').PermissionRequest} PermissionRequest
 *
 * @typedef {import('./types.js').PermissionRequestResult} PermissionRequestResult
 *
 * @typedef {import('./types.js').PermissionHandlerConfig} PermissionHandlerConfig
 */

// ─── Helpers internos ─────────────────────────────────────────────────────────

/**
 * @returns {PermissionRequestResult}
 */
function makeApproved() {
    return /** @type {PermissionRequestResult} */ ({ kind: 'approved' });
}

/**
 * @returns {PermissionRequestResult}
 */
function makeDenied() {
    return /** @type {PermissionRequestResult} */ ({ kind: 'denied-by-rules', rules: [] });
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Cria um PermissionHandler configurável baseado nas opções fornecidas.
 *
 * Ordem de avaliação:
 *
 * 1. onRequest(req) — se definido e retorna valor não-undefined, usa esse resultado
 * 2. allowAll: true — aprova tudo (semântica do approveAll)
 * 3. allowTools — whitelist: somente tools listadas são aprovadas
 * 4. denyPatterns — regex: tools com nome correspondente são negadas
 * 5. denyTools — blacklist nominal
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

    // UPG-PERM-001: validar denyPatterns em tempo de construção (fail-fast)
    for (const p of denyPatterns) {
        if (!(p instanceof RegExp)) {
            throw new TypeError(
                `[hooks/permission] createPermissionHandler: denyPatterns deve conter instâncias de RegExp, recebido: ${typeof p}`,
            );
        }
    }

    const handlerFn = async (/** @type {PermissionRequest} */ request) => {
        const toolName =
            /** @type {{ toolName?: string; tool?: string }} */ (request)?.toolName ??
            /** @type {{ toolName?: string; tool?: string }} */ (request)?.tool ??
            'unknown';

        // Tratar content-exclusion-policy — não aprovar automaticamente
        if (/** @type {{ kind?: string }} */ (request)?.kind === 'content-exclusion-check') {
            const path = /** @type {{ path?: string }} */ (request)?.path ?? 'desconhecido';
            log('WARN', `[hooks/permission] NEGADO (content-exclusion-policy): path='${path}'`);
            return /** @type {PermissionRequestResult} */ ({
                kind: 'denied-by-content-exclusion-policy',
                path,
                message: 'Arquivo bloqueado pela política de exclusão de conteúdo.',
            });
        }

        // 1. Callback custom tem precedência total
        if (onRequest) {
            const customResult = await onRequest(request);
            if (customResult !== undefined) {
                const approved = customResult === true;
                if (auditMode || !approved) {
                    log(
                        approved ? 'INFO' : 'WARN',
                        `[hooks/permission] ${approved ? 'APROVADO' : 'NEGADO'} via onRequest: tool='${toolName}'`,
                    );
                }
                return approved ? makeApproved() : makeDenied();
            }
        }

        // 2. allowAll — aprova tudo, mas denyTools/denyPatterns ainda têm precedência
        if (allowAll) {
            // Verificar deny explícita antes de aprovar
            if (denyTools.length > 0 && denyTools.includes(toolName)) {
                log('WARN', `[hooks/permission] NEGADO (denyTools override allowAll): tool='${toolName}'`);
                return makeDenied();
            }
            const deniedByPattern = denyPatterns.length > 0 ? denyPatterns.find((p) => p.test(toolName)) : null;
            if (deniedByPattern) {
                log(
                    'WARN',
                    `[hooks/permission] NEGADO (denyPattern override allowAll ${String(deniedByPattern)}): tool='${toolName}'`,
                );
                return makeDenied();
            }
            if (auditMode) {
                log('INFO', `[hooks/permission] APROVADO (allowAll): tool='${toolName}'`);
            }
            return makeApproved();
        }

        // 3. Whitelist
        if (allowTools && allowTools.length > 0) {
            const approved = allowTools.includes(toolName);
            if (auditMode || !approved) {
                log(
                    approved ? 'INFO' : 'WARN',
                    `[hooks/permission] ${approved ? 'APROVADO' : 'NEGADO'} (whitelist): tool='${toolName}'`,
                );
            }
            return approved ? makeApproved() : makeDenied();
        }

        // 4. Regex deny patterns
        if (denyPatterns.length > 0) {
            const matched = denyPatterns.find((p) => p.test(toolName));
            if (matched) {
                log('WARN', `[hooks/permission] NEGADO (denyPattern ${String(matched)}): tool='${toolName}'`);
                return makeDenied();
            }
        }

        // 5. Blacklist nominal
        if (denyTools.length > 0 && denyTools.includes(toolName)) {
            log('WARN', `[hooks/permission] NEGADO (denyTools): tool='${toolName}'`);
            return makeDenied();
        }

        // 6. Default: aprova
        if (auditMode) {
            log('INFO', `[hooks/permission] APROVADO (default): tool='${toolName}'`);
        }
        return makeApproved();
    };

    return /** @type {PermissionHandler} */ (handlerFn);
}

/**
 * Retorna o approveAll oficial do SDK.
 *
 * @returns {PermissionHandler}
 */
export function createApproveAllPermission() {
    return approveAll;
}

/**
 * Cria um handler que aprova tudo mas loga cada decisão.
 *
 * @returns {PermissionHandler}
 */
export function createAuditOnlyPermission() {
    return createPermissionHandler({ auditMode: true });
}

/**
 * Cria um handler com whitelist rígida.
 *
 * @param {string[]} allowedTools - Nomes de tools permitidas
 * @returns {PermissionHandler}
 */
export function createRestrictedPermission(allowedTools) {
    return createPermissionHandler({ allowTools: allowedTools });
}

/**
 * Cria um handler que nega tools de execução shell arbitrária e aprova o restante.
 *
 * @param {string[]} [additionalDenyTools] - Tools adicionais a negar
 * @returns {PermissionHandler}
 */
export function createSafePermission(additionalDenyTools) {
    return createPermissionHandler({
        denyTools: ['run_shell_command', 'run_npm_script', 'run_node_script', ...(additionalDenyTools ?? [])],
    });
}
