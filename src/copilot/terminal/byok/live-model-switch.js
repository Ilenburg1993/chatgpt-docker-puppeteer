// @ts-check
/**
 * Registro canônico de solicitações de troca de modelo vivo BYOK no terminal.
 *
 * A solicitação local (`setModel`) e a confirmação observada (`session.model_changed`) são eventos
 * diferentes. Esta unidade registra a intenção humana/automática sem disputar a confirmação do SDK.
 *
 * @module copilot/terminal/byok/live-model-switch
 */

import * as modelSelectionProjection from '../frontend/projections/model-selection/index.js';
import { buildTerminalModelTransitionPresentation } from '../events/presenters/model/index.js';
import { recordTerminalActivity } from '../state/index.js';

const MODEL_SWITCH_REQUEST_TTL_MS = 10 * 60_000;

/** @type {{ model: string; previousModel: string | null; source: string; reason: string | null; confidence: string | null; requestedAt: number; detail: string } | null} */
let latestLiveByokModelSwitchRequest = null;

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function optionalText(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {string | null} previousModel
 * @param {string} currentModel
 * @param {string | null} reason
 * @param {string} source
 * @param {string | null} confidence
 * @returns {string}
 */
function renderLiveModelSwitchRequestDetail(previousModel, currentModel, reason, source, confidence) {
    const presentation = buildTerminalModelTransitionPresentation({
        from: previousModel,
        to: currentModel,
        kind: 'requested',
        reason,
        confidence,
        source,
    });
    return `${presentation.detail} · aguardando confirmação do SDK ou próximo uso observado`;
}

/**
 * Solicita uma troca de modelo no runtime vivo e registra a intenção para `/activity`.
 *
 * @param {string} model
 * @param {{
 *     runtimeId?: string | null;
 *     source?: string;
 *     reason?: string | null;
 *     confidence?: string | null;
 *     updateCurrent?: boolean;
 * }} [options]
 * @returns {Promise<{
 *     previousModel: string | null;
 *     currentModel: string;
 *     currentReasoningEffort: string | null;
 *     reasoningAdjusted: boolean;
 *     runtimeId: string | null;
 *     projection: Awaited<ReturnType<typeof modelSelectionProjection.switchTerminalModelProjection>>
 *       | ReturnType<typeof modelSelectionProjection.setTerminalModelProjection>;
 *     detail: string;
 * }>}
 */
export async function requestTerminalLiveByokModelSwitch(model, options = {}) {
    const idempotencyKey = `terminal-model-switch:${options.runtimeId ?? 'default'}:${model}:${Date.now()}`;
    const hasTransactionalProjection = Object.prototype.hasOwnProperty.call(
        modelSelectionProjection,
        'switchTerminalModelProjection',
    );
    const projection =
        hasTransactionalProjection && typeof modelSelectionProjection.switchTerminalModelProjection === 'function'
            ? await modelSelectionProjection.switchTerminalModelProjection(model, options.runtimeId, {
                  idempotencyKey,
                  source: options.source ?? 'terminal.byok_model',
              })
            : await Promise.resolve(
                  options.runtimeId
                      ? modelSelectionProjection.setTerminalModelProjection(model, options.runtimeId)
                      : modelSelectionProjection.setTerminalModelProjection(model),
              );
    const projected = /** @type {Record<string, unknown>} */ (projection ?? {});
    const previousModel = optionalText(projected['previousModel']);
    const currentModel = optionalText(projected['currentModel']) ?? model;
    const currentReasoningEffort = optionalText(projected['currentReasoningEffort']);
    const runtimeId = optionalText(projected['runtimeId']);
    const reasoningAdjusted = projected['reasoningAdjusted'] === true;
    const operation = isRecord(projected['operation']) ? projected['operation'] : null;
    if (operation && operation['state'] !== 'committed') {
        throw new Error(
            `MODEL_SWITCH_NOT_COMMITTED: state=${String(operation['state'] ?? 'unknown')} error=${String(operation['error'] ?? 'unknown')}`,
        );
    }
    const source = options.source ?? 'terminal.byok_model';
    const reason = optionalText(options.reason);
    const confidence = optionalText(options.confidence);
    const detail = renderLiveModelSwitchRequestDetail(previousModel, currentModel, reason, source, confidence);
    latestLiveByokModelSwitchRequest = {
        model: currentModel,
        previousModel,
        source,
        reason,
        confidence,
        requestedAt: Date.now(),
        detail,
    };
    recordTerminalActivity('model', 'Troca de modelo solicitada', {
        detail,
        source,
        severity: 'info',
        recordHistory: true,
        updateCurrent: options.updateCurrent ?? true,
    });
    return {
        previousModel,
        currentModel,
        currentReasoningEffort,
        reasoningAdjusted,
        runtimeId,
        projection,
        detail,
    };
}

/**
 * Solicita troca de provider/rota preservando o mesmo sessionId.
 *
 * @param {Record<string, unknown>} route
 * @param {{
 *     runtimeId?: string | null;
 *     source?: string;
 *     reason?: string | null;
 *     timeoutMs?: number;
 *     idempotencyKey?: string;
 *     forceApplyDeferred?: boolean;
 * }} [options]
 */
export async function requestTerminalLiveByokRouteSwitch(route, options = {}) {
    const providerId = optionalText(route['providerId']);
    const providerModel = optionalText(route['providerModel']) ?? optionalText(route['selectorSyntax']);
    if (!providerId || !providerModel) throw new Error('LIVE_ROUTE_SWITCH_TARGET_INVALID');
    const idempotencyKey =
        optionalText(options.idempotencyKey) ??
        `terminal-route-switch:${options.runtimeId ?? 'default'}:${providerId}:${providerModel}:${Date.now()}`;
    const projection = await modelSelectionProjection.switchTerminalRouteProjection(route, options.runtimeId, {
        idempotencyKey,
        ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
        allowActiveDialogLoopReattach: true,
        ...(options.forceApplyDeferred ? { forceApplyDeferred: true } : {}),
        source: options.source ?? 'terminal.byok_route',
    });
    const projected = /** @type {Record<string, unknown>} */ (projection ?? {});
    const operation = isRecord(projected['operation']) ? projected['operation'] : null;
    if (!operation || operation['state'] !== 'committed') {
        throw new Error(
            `SAME_SESSION_ROUTE_SWITCH_NOT_COMMITTED: state=${String(operation?.['state'] ?? 'unknown')} error=${String(operation?.['error'] ?? 'unknown')}`,
        );
    }
    const detail =
        `rota viva confirmada na mesma sessão: ${providerId}/${providerModel}` +
        (optionalText(options.reason) ? ` · ${optionalText(options.reason)}` : '');
    recordTerminalActivity('model', 'Troca de rota confirmada', {
        detail,
        source: options.source ?? 'terminal.byok_route',
        severity: 'info',
        recordHistory: true,
        updateCurrent: true,
    });
    return { projection, operation, detail };
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @returns {{ model: string; previousModel: string | null; source: string; reason: string | null; confidence: string | null; requestedAt: number; detail: string } | null}
 */
export function readTerminalLiveByokModelSwitchRequest() {
    if (!latestLiveByokModelSwitchRequest) return null;
    if (Date.now() - latestLiveByokModelSwitchRequest.requestedAt > MODEL_SWITCH_REQUEST_TTL_MS) {
        latestLiveByokModelSwitchRequest = null;
        return null;
    }
    return { ...latestLiveByokModelSwitchRequest };
}

/**
 * @param {{ previousModel?: string | null; newModel?: string | null; timestamp?: number }} confirmation
 * @returns {{ model: string; previousModel: string | null; source: string; reason: string | null; confidence: string | null; requestedAt: number; detail: string } | null}
 */
export function consumeTerminalLiveByokModelSwitchConfirmation(confirmation) {
    const pending = readTerminalLiveByokModelSwitchRequest();
    if (!pending) return null;
    const newModel = optionalText(confirmation.newModel);
    if (!newModel || newModel !== pending.model) return null;
    latestLiveByokModelSwitchRequest = null;
    return pending;
}

/**
 * Registra uma troca planejada que não pôde ser aplicada ao runtime vivo.
 *
 * @param {{
 *     model: string;
 *     reason: string;
 *     confidence?: string | null;
 *     source?: string;
 *     severity?: 'info' | 'warn' | 'error';
 * }} input
 * @returns {ReturnType<typeof recordTerminalActivity>}
 */
export function recordTerminalLiveByokModelSwitchDeferred(input) {
    const detail = renderLiveModelSwitchRequestDetail(
        null,
        input.model,
        input.reason,
        input.source ?? 'terminal.byok_model',
        optionalText(input.confidence),
    );
    return recordTerminalActivity('model', 'Troca de modelo adiada', {
        detail,
        source: input.source ?? 'terminal.byok_model',
        severity: input.severity ?? 'warn',
        recordHistory: true,
        updateCurrent: false,
    });
}
