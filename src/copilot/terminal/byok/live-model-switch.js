// @ts-check
/**
 * Registro canônico de solicitações de troca de modelo vivo BYOK no terminal.
 *
 * A solicitação local (`setModel`) e a confirmação observada (`session.model_changed`) são eventos
 * diferentes. Esta unidade registra a intenção humana/automática sem disputar a confirmação do SDK.
 *
 * @module copilot/terminal/byok/live-model-switch
 */

import { setTerminalModelProjection } from '../frontend/index.js';
import { buildTerminalModelTransitionPresentation } from '../events/model-transition-presentation.js';
import { recordTerminalActivity } from '../state/activity-state.js';

const MODEL_SWITCH_REQUEST_TTL_MS = 10 * 60_000;

/** @type {{ model: string; previousModel: string | null; source: string; reason: string | null; requestedAt: number; detail: string } | null} */
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
 * @returns {string}
 */
function renderLiveModelSwitchRequestDetail(previousModel, currentModel, reason, source) {
    const presentation = buildTerminalModelTransitionPresentation({
        from: previousModel,
        to: currentModel,
        kind: 'requested',
        reason,
        source,
    });
    return `${presentation.detail} · aguardando confirmação session.model_changed ou próximo uso observado`;
}

/**
 * Solicita uma troca de modelo no runtime vivo e registra a intenção para `/activity`.
 *
 * @param {string} model
 * @param {{
 *     runtimeId?: string | null;
 *     source?: string;
 *     reason?: string | null;
 *     updateCurrent?: boolean;
 * }} [options]
 * @returns {{
 *     previousModel: string | null;
 *     currentModel: string;
 *     currentReasoningEffort: string | null;
 *     reasoningAdjusted: boolean;
 *     runtimeId: string | null;
 *     projection: ReturnType<typeof setTerminalModelProjection>;
 *     detail: string;
 * }}
 */
export function requestTerminalLiveByokModelSwitch(model, options = {}) {
    const projection = options.runtimeId
        ? setTerminalModelProjection(model, options.runtimeId)
        : setTerminalModelProjection(model);
    const projected = /** @type {Record<string, unknown>} */ (projection ?? {});
    const previousModel = optionalText(projected['previousModel']);
    const currentModel = optionalText(projected['currentModel']) ?? model;
    const currentReasoningEffort = optionalText(projected['currentReasoningEffort']);
    const runtimeId = optionalText(projected['runtimeId']);
    const reasoningAdjusted = projected['reasoningAdjusted'] === true;
    const source = options.source ?? 'terminal.byok_model';
    const reason = optionalText(options.reason);
    const detail = renderLiveModelSwitchRequestDetail(previousModel, currentModel, reason, source);
    latestLiveByokModelSwitchRequest = {
        model: currentModel,
        previousModel,
        source,
        reason,
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
 * @returns {{ model: string; previousModel: string | null; source: string; reason: string | null; requestedAt: number; detail: string } | null}
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
 * @returns {{ model: string; previousModel: string | null; source: string; reason: string | null; requestedAt: number; detail: string } | null}
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
 *     source?: string;
 *     severity?: 'info' | 'warn' | 'error';
 * }} input
 * @returns {ReturnType<typeof recordTerminalActivity>}
 */
export function recordTerminalLiveByokModelSwitchDeferred(input) {
    const detail = renderLiveModelSwitchRequestDetail(null, input.model, input.reason, input.source ?? 'terminal.byok_model');
    return recordTerminalActivity('model', 'Troca de modelo adiada', {
        detail,
        source: input.source ?? 'terminal.byok_model',
        severity: input.severity ?? 'warn',
        recordHistory: true,
        updateCurrent: false,
    });
}
