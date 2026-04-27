// @ts-check
/**
 * src/copilot/sdk/permissions.js
 *
 * Faixa 2 / F7-F9 — Wrapper centralizado para permissões do `@github/copilot-sdk`. Ponto único de acesso a `approveAll`
 * e factories de PermissionHandler.
 *
 * Consumers **não** devem importar `approveAll` diretamente do `@github/copilot-sdk`.
 *
 * @module copilot/sdk/permissions
 * @see EventBus
 * @see module:copilot/hooks/permission-handler
 */

import { approveAll } from '@github/copilot-sdk';
import { log } from '../logger.js';

// Re-export canônico do SDK
export { approveAll };

/**
 * @typedef {import('@github/copilot-sdk').PermissionHandler} PermissionHandler
 *
 * @typedef {import('@github/copilot-sdk').PermissionRequest} PermissionRequest
 *
 * @typedef {import('@github/copilot-sdk').PermissionRequestResult} PermissionRequestResult
 */

/**
 * @typedef {object} PermissionHandlerConfig
 * @property {boolean} [allowAll=false] - Aprovar tudo (semântica approveAll). Default is `false`
 * @property {string[]} [allowTools] - Whitelist de nomes de tools permitidas
 * @property {PermissionRequest['kind'][]} [denyKinds] - Blacklist por tipo canônico do SDK
 * @property {string[]} [denyTools] - Blacklist de nomes de tools negadas
 * @property {RegExp[]} [denyPatterns] - Regex patterns para negar tools por nome
 * @property {boolean} [auditMode=false] - Logar todas as decisões sem negar. Default is `false`
 * @property {(request: PermissionRequest) => PermissionRequestResult | undefined} [onRequest] - Handler custom
 *   pré-avaliação
 */

// ─── Helpers internos ─────────────────────────────────────────────────────────

/** @returns {PermissionRequestResult} */
function approved() {
    return /** @type {PermissionRequestResult} */ ({ kind: 'approve-once' });
}

/** @returns {PermissionRequestResult} */
function denied() {
    return /** @type {PermissionRequestResult} */ ({ kind: 'reject' });
}

/**
 * @param {PermissionRequest} request
 * @returns {string}
 */
function extractKind(request) {
    return /** @type {{ kind?: string }} */ (request)?.kind ?? 'unknown';
}

/**
 * Extrai o nome da tool de um PermissionRequest.
 *
 * @param {PermissionRequest} request
 * @returns {string}
 */
function extractToolName(request) {
    return (
        /** @type {{ toolName?: string; tool?: string }} */ (request)?.toolName ??
        /** @type {{ toolName?: string; tool?: string }} */ (request)?.tool ??
        /** @type {{ name?: string }} */ (request)?.name ??
        'unknown'
    );
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Cria um PermissionHandler configurável.
 *
 * Ordem de avaliação:
 *
 * 1. `onRequest(req)` — retorno não-undefined prevalece
 * 2. `denyKinds` — nega por `PermissionRequest.kind`, a dimensão primária do SDK
 * 3. `denyPatterns`/`denyTools` — denies finos para custom tools/MCP
 * 4. `allowAll: true` → aprova tudo após denies explícitos
 * 5. `allowTools` (whitelist) — se definida, apenas tools na lista são aprovadas
 * 6. Default: aprova
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

    // Fail-fast: validar denyPatterns
    for (const p of denyPatterns) {
        if (!(p instanceof RegExp)) {
            throw new TypeError(`[sdk/permissions] denyPatterns deve conter RegExp, recebido: ${typeof p}`);
        }
    }

    return /** @type {PermissionHandler} */ (
        async (request) => {
            const kind = extractKind(request);
            const toolName = extractToolName(request);

            // 1. Custom handler pré-avaliação
            if (onRequest) {
                const custom = onRequest(request);
                if (custom !== undefined) {
                    log('DEBUG', `[sdk/permissions] onRequest override para '${toolName}': ${custom.kind}`);
                    return custom;
                }
            }

            if (denyKinds.includes(/** @type {PermissionRequest['kind']} */ (kind))) {
                log('DEBUG', `[sdk/permissions] NEGADO kind='${kind}' tool='${toolName}' (denyKinds)`);
                return denied();
            }

            for (const pattern of denyPatterns) {
                if (pattern.test(toolName)) {
                    log(
                        'DEBUG',
                        `[sdk/permissions] NEGADO kind='${kind}' tool='${toolName}' (denyPattern: ${pattern})`,
                    );
                    return denied();
                }
            }

            if (denyTools.includes(toolName)) {
                log('DEBUG', `[sdk/permissions] NEGADO kind='${kind}' tool='${toolName}' (denyTools)`);
                return denied();
            }

            // 2. Allow all
            if (allowAll) {
                if (auditMode) {
                    log('INFO', `[sdk/permissions] AUDIT: aprovando kind='${kind}' tool='${toolName}' (allowAll)`);
                }
                return approved();
            }

            // 3. Whitelist
            if (allowTools) {
                const result = allowTools.includes(toolName) ? approved() : denied();
                if (auditMode) {
                    log(
                        'INFO',
                        `[sdk/permissions] AUDIT: kind='${kind}' tool='${toolName}' → ${result.kind} (allowTools)`,
                    );
                }
                return result;
            }

            // 6. Default: aprovar
            if (auditMode)
                log('INFO', `[sdk/permissions] AUDIT: aprovando kind='${kind}' tool='${toolName}' (default)`);
            return approved();
        }
    );
}

/**
 * Cria um PermissionHandler que aprova apenas tools na allowlist fornecida. Atalho para `createPermissionHandler({
 * allowTools })`.
 *
 * @param {string[]} allowedTools - Nomes exatos das tools permitidas
 * @param {object} [options]
 * @param {boolean} [options.auditMode=false] - Logar decisões. Default is `false`
 * @returns {PermissionHandler}
 */
export function createAllowlistPermissionHandler(allowedTools, options) {
    if (!Array.isArray(allowedTools)) {
        throw new TypeError('[sdk/permissions] allowedTools deve ser um array de strings');
    }
    return createPermissionHandler({
        allowTools: allowedTools,
        auditMode: options?.auditMode ?? false,
    });
}
