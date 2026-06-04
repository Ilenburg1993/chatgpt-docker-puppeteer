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
import { recordTerminalActivity } from '../state/activity-state.js';

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
 * @returns {string}
 */
function renderLiveModelSwitchRequestDetail(previousModel, currentModel, reason) {
    const transition = previousModel && previousModel !== currentModel ? `${previousModel} → ${currentModel}` : currentModel;
    const reasonText = reason ? ` · ${reason}` : '';
    return `${transition}${reasonText} · aguardando confirmação session.model_changed ou próximo uso observado`;
}

/**
 * Solicita uma troca de modelo no runtime vivo e registra a intenção para `/activity`.
 *
 * @param {string} model
 * @param {{
 *     runtimeId?: string | null;
 *     source?: string;
 *     reason?: string | null;
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
    const detail = renderLiveModelSwitchRequestDetail(previousModel, currentModel, optionalText(options.reason));
    recordTerminalActivity('system', 'Troca de modelo solicitada', {
        detail,
        source: options.source ?? 'terminal.byok_model',
        severity: 'info',
        recordHistory: true,
        updateCurrent: false,
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
    return recordTerminalActivity('system', 'Troca de modelo adiada', {
        detail: `${input.model} · ${input.reason}`,
        source: input.source ?? 'terminal.byok_model',
        severity: input.severity ?? 'warn',
        recordHistory: true,
        updateCurrent: false,
    });
}
