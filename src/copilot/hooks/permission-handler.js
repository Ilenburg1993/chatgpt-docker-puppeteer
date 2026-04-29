// @ts-check
/**
 * src/copilot/hooks/permission-handler.js
 *
 * Factory para PermissionHandler do Copilot SDK. Migrado de src/copilot/lib/permissions.js — esse arquivo é mantido
 * como re-export.
 *
 * Suporta whitelist/blacklist de tools, deny por `request.kind` do SDK, audit mode e callbacks custom.
 *
 * Contratos do SDK — PermissionRequestResult union:
 *
 * - `{ kind: "approve-once" }`
 * - `{ kind: "approve-for-session"; approval: ... }`
 * - `{ kind: "approve-for-location"; approval: ...; locationKey: string }`
 * - `{ kind: "reject"; feedback?: string }`
 * - `{ kind: "user-not-available" }`
 * - `{ kind: "no-result" }` (somente protocolo v1; protocolo v2 rejeita)
 *
 * Os eventos `permission.completed` usam uma taxonomia diferente (`approved`, `denied-by-rules`,
 * `denied-interactively-by-user`, etc.). Handlers de permissão devem retornar a union de decisão do SDK.
 *
 * @module copilot/hooks/permission-handler
 * @see EventBus
 * @see module:copilot/hooks/types
 */

import { approveAll } from '#copilot/sdk';
import { log } from './logger.js';

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
    return /** @type {PermissionRequestResult} */ ({ kind: 'approve-once' });
}

/**
 * @returns {PermissionRequestResult}
 */
function makeDenied() {
    return /** @type {PermissionRequestResult} */ ({ kind: 'reject' });
}

/**
 * @param {unknown} value
 * @returns {value is PermissionRequestResult}
 */
function isPermissionResult(value) {
    return Boolean(value && typeof value === 'object' && typeof Reflect.get(value, 'kind') === 'string');
}

/**
 * @param {boolean | 'deny' | PermissionRequestResult} value
 * @returns {PermissionRequestResult}
 */
function normalizeCustomDecision(value) {
    if (value === true) return makeApproved();
    if (value === false || value === 'deny') return makeDenied();
    if (isPermissionResult(value)) return value;
    return makeDenied();
}

/**
 * Extrai o nome de tool quando o request SDK tiver essa dimensão. `request.kind` continua sendo a dimensão primária de
 * policy; o nome é usado para allow/deny lists finas de custom tools/MCP.
 *
 * @param {PermissionRequest} request
 * @returns {string}
 */
function extractToolName(request) {
    return (
        /** @type {{ toolName?: string; tool?: string; name?: string }} */ (request)?.toolName ??
        /** @type {{ toolName?: string; tool?: string; name?: string }} */ (request)?.tool ??
        /** @type {{ toolName?: string; tool?: string; name?: string }} */ (request)?.name ??
        'unknown'
    );
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Cria um PermissionHandler configurável baseado nas opções fornecidas.
 *
 * Ordem de avaliação:
 *
 * 1. onRequest(req) — se definido e retorna valor não-undefined, usa esse resultado
 * 2. denyKinds — nega por `PermissionRequest.kind` do SDK
 * 3. denyPatterns/denyTools — denylist nominal para tools/MCP/custom tools
 * 4. allowAll: true — aprova tudo (semântica do approveAll), salvo denies explícitos acima
 * 5. allowTools — whitelist: somente tools listadas são aprovadas
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
    const denyKinds = cfg.denyKinds ?? [];
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

    const handlerFn = async (
        /** @type {PermissionRequest} */ request,
        /** @type {{ sessionId: string }} */ invocation,
    ) => {
        const kind = /** @type {{ kind?: string }} */ (request)?.kind ?? 'unknown';
        const toolName = extractToolName(request);

        // Tratar content-exclusion-policy — não aprovar automaticamente
        if (kind === 'content-exclusion-check') {
            const path = /** @type {{ path?: string }} */ (request)?.path ?? 'desconhecido';
            log('WARN', `[hooks/permission] NEGADO (content-exclusion-policy): path='${path}'`);
            return /** @type {PermissionRequestResult} */ ({
                kind: 'reject',
                feedback: `Arquivo bloqueado pela política de exclusão de conteúdo: ${path}`,
            });
        }

        // 1. Callback custom tem precedência total
        if (onRequest) {
            try {
                const customResult = await onRequest(request, invocation);
                if (customResult !== undefined) {
                    const result = normalizeCustomDecision(customResult);
                    if (auditMode || result.kind !== 'approve-once') {
                        log(
                            'INFO',
                            `[hooks/permission] onRequest: kind='${kind}', tool='${toolName}' → ${result.kind}`,
                        );
                    }
                    return result;
                }
            } catch (error) {
                log(
                    'WARN',
                    `[hooks/permission] onRequest falhou; negando por segurança: kind='${kind}', tool='${toolName}' error='${error instanceof Error ? error.message : String(error)}'`,
                );
                return makeDenied();
            }
        }

        if (denyKinds.includes(/** @type {PermissionRequest['kind']} */ (kind))) {
            log('WARN', `[hooks/permission] NEGADO (denyKinds): kind='${kind}', tool='${toolName}'`);
            return makeDenied();
        }

        const deniedByPattern = denyPatterns.length > 0 ? denyPatterns.find((p) => p.test(toolName)) : null;
        if (deniedByPattern) {
            log(
                'WARN',
                `[hooks/permission] NEGADO (denyPattern ${String(deniedByPattern)}): kind='${kind}', tool='${toolName}'`,
            );
            return makeDenied();
        }

        if (denyTools.length > 0 && denyTools.includes(toolName)) {
            log('WARN', `[hooks/permission] NEGADO (denyTools): kind='${kind}', tool='${toolName}'`);
            return makeDenied();
        }

        // 2. allowAll — aprova tudo após os denies explícitos acima
        if (allowAll) {
            if (auditMode) {
                log('INFO', `[hooks/permission] APROVADO (allowAll): kind='${kind}', tool='${toolName}'`);
            }
            return makeApproved();
        }

        // 3. Whitelist
        if (allowTools && allowTools.length > 0) {
            const approved = allowTools.includes(toolName);
            if (auditMode || !approved) {
                log(
                    approved ? 'INFO' : 'WARN',
                    `[hooks/permission] ${approved ? 'APROVADO' : 'NEGADO'} (whitelist): kind='${kind}', tool='${toolName}'`,
                );
            }
            return approved ? makeApproved() : makeDenied();
        }

        // 6. Default: aprova
        if (auditMode) {
            log('INFO', `[hooks/permission] APROVADO (default): kind='${kind}', tool='${toolName}'`);
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
        denyKinds: ['shell'],
        denyTools: ['run_shell_command', 'run_npm_script', 'run_node_script', ...(additionalDenyTools ?? [])],
    });
}
