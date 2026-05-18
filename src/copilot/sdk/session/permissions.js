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
 * Este módulo é o núcleo canônico de policy de permissões na arquitetura 2.x. Camadas de hooks delegam para cá quando
 * precisam compor permissões com policy de produto.
 */

import { toError } from '#copilot/core/error-handlers';
import { approveAll } from '@github/copilot-sdk';
import { PERMISSION_REQUEST_KINDS } from '../constants.js';
import { log } from '../logger.js';
import { extractPermissionToolName } from './permission-runtime.js';

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
 * @property {PermissionRequest['kind'][]} [denyKinds] - Blacklist por tipo canônico do SDK (`shell`, `write`, `read`,
 *   `mcp`, `url`, `custom-tool`, `memory`, `hook`)
 * @property {string[]} [denyTools] - Blacklist de nomes de tools negadas
 * @property {RegExp[]} [denyPatterns] - Regex patterns para negar tools por nome
 * @property {boolean} [auditMode=false] - Logar todas as decisões sem negar. Default is `false`
 * @property {'allow' | 'deny'} [defaultDecision='allow'] - Decisão padrão quando nenhuma regra explícita (allow/deny).
 *   Default is `'allow'`
 * @property {(
 *     request: PermissionRequest,
 *     invocation: { sessionId: string },
 * ) =>
 *     | boolean
 *     | 'deny'
 *     | PermissionRequestResult
 *     | undefined
 *     | Promise<boolean | 'deny' | PermissionRequestResult | undefined>} [onRequest]
 *   - Handler custom pré-avaliação
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
    if (value === true) return approved();
    if (value === false || value === 'deny') return denied();
    if (isPermissionResult(value)) return value;
    return denied();
}

/**
 * @param {unknown} value
 * @param {string} fieldName
 */
function assertOptionalStringArray(value, fieldName) {
    if (value === undefined) return;
    if (!Array.isArray(value)) {
        throw new TypeError(`[sdk/permissions] ${fieldName} deve ser um array de strings`);
    }
    for (const item of value) {
        if (typeof item !== 'string') {
            throw new TypeError(`[sdk/permissions] ${fieldName} deve conter apenas strings`);
        }
    }
}

/**
 * @param {PermissionRequest} request
 * @returns {string}
 */
function extractKind(request) {
    return /** @type {{ kind?: string }} */ (request)?.kind ?? 'unknown';
}

/**
 * @param {PermissionRequest} request
 * @returns {string}
 */
function extractPath(request) {
    return /** @type {{ path?: string }} */ (request)?.path ?? 'desconhecido';
}

/**
 * Extrai o nome da tool de um PermissionRequest.
 *
 * @param {PermissionRequest} request
 * @returns {string}
 */
function extractToolName(request) {
    return extractPermissionToolName(request);
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
    const defaultDecision = cfg.defaultDecision === 'deny' ? 'deny' : 'allow';
    const onRequest = cfg.onRequest;

    assertOptionalStringArray(allowTools, 'allowTools');
    assertOptionalStringArray(denyTools, 'denyTools');
    assertOptionalStringArray(denyKinds, 'denyKinds');

    // Fail-fast: validar denyPatterns
    for (const p of denyPatterns) {
        if (!(p instanceof RegExp)) {
            throw new TypeError(`[sdk/permissions] denyPatterns deve conter RegExp, recebido: ${typeof p}`);
        }
    }

    return /** @type {PermissionHandler} */ (
        async (request, invocation) => {
            const kind = extractKind(request);
            const toolName = extractToolName(request);
            const sessionId = invocation?.sessionId ?? 'unknown';

            // Política canônica: content-exclusion-check nunca é auto-aprovado.
            if (kind === PERMISSION_REQUEST_KINDS.CONTENT_EXCLUSION_CHECK) {
                const path = extractPath(request);
                log(
                    'WARN',
                    `[sdk/permissions] NEGADO sessionId='${sessionId}' kind='${kind}' path='${path}' (content-exclusion-policy)`,
                );
                return /** @type {PermissionRequestResult} */ ({
                    kind: 'reject',
                    feedback: `Arquivo bloqueado pela política de exclusão de conteúdo: ${path}`,
                });
            }

            // 1. Custom handler pré-avaliação
            if (onRequest) {
                try {
                    const custom = await onRequest(request, invocation);
                    if (custom !== undefined) {
                        const result = normalizeCustomDecision(custom);
                        log(
                            'DEBUG',
                            `[sdk/permissions] onRequest override: sessionId='${sessionId}' kind='${kind}' tool='${toolName}' → ${result.kind}`,
                        );
                        return result;
                    }
                } catch (err) {
                    log(
                        'WARN',
                        `[sdk/permissions] onRequest falhou; negando por segurança: sessionId='${sessionId}' kind='${kind}' tool='${toolName}' error='${toError(err).message}'`,
                    );
                    return denied();
                }
            }

            if (denyKinds.includes(/** @type {PermissionRequest['kind']} */ (kind))) {
                log(
                    'DEBUG',
                    `[sdk/permissions] NEGADO sessionId='${sessionId}' kind='${kind}' tool='${toolName}' (denyKinds)`,
                );
                return denied();
            }

            for (const pattern of denyPatterns) {
                if (pattern.test(toolName)) {
                    log(
                        'DEBUG',
                        `[sdk/permissions] NEGADO sessionId='${sessionId}' kind='${kind}' tool='${toolName}' (denyPattern: ${pattern})`,
                    );
                    return denied();
                }
            }

            if (denyTools.includes(toolName)) {
                log(
                    'DEBUG',
                    `[sdk/permissions] NEGADO sessionId='${sessionId}' kind='${kind}' tool='${toolName}' (denyTools)`,
                );
                return denied();
            }

            // 2. Allow all
            if (allowAll) {
                if (auditMode) {
                    log(
                        'INFO',
                        `[sdk/permissions] AUDIT: sessionId='${sessionId}' aprovando kind='${kind}' tool='${toolName}' (allowAll)`,
                    );
                }
                return approved();
            }

            // 3. Whitelist
            if (allowTools) {
                const result = allowTools.includes(toolName) ? approved() : denied();
                if (auditMode) {
                    log(
                        'INFO',
                        `[sdk/permissions] AUDIT: sessionId='${sessionId}' kind='${kind}' tool='${toolName}' → ${result.kind} (allowTools)`,
                    );
                }
                return result;
            }

            // 6. Default: allow/deny configurável
            if (auditMode)
                log(
                    'INFO',
                    `[sdk/permissions] AUDIT: sessionId='${sessionId}' kind='${kind}' tool='${toolName}' (defaultDecision=${defaultDecision})`,
                );
            return defaultDecision === 'deny' ? denied() : approved();
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
