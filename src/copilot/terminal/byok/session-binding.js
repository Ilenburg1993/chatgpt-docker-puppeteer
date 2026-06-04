// @ts-check
/**
 * Comparacao canônica entre a seleção BYOK preparada no processo e o provider binding da sessão SDK viva.
 *
 * O seletor BYOK vive em configuração/env; o binding persistido vive no contrato de criação/retomada da sessão SDK.
 * Esta unidade impede que cada cockpit invente sua própria leitura dessa fronteira.
 *
 * @module copilot/terminal/byok/session-binding
 */

/**
 * @typedef {ReturnType<import('../frontend/projections/config.js').readTerminalByokProjection>['summary']} TerminalByokSummary
 */

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function readBindingText(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {string | null | undefined} value
 * @returns {string}
 */
function valueOrDash(value) {
    return value && value.length > 0 ? value : '-';
}

/**
 * @param {TerminalByokSummary} summary
 * @returns {string}
 */
export function renderTerminalPreparedByokSelection(summary) {
    if (!summary.enabled) return 'SDK Copilot';
    const readiness = summary.ready ? 'BYOK' : 'BYOK incompleto';
    return `${readiness} · perfil ${valueOrDash(summary.profile)} · preset ${valueOrDash(summary.preset)} · provedor ${valueOrDash(summary.providerType)} · modelo ${valueOrDash(summary.model)}`;
}

/**
 * @param {Record<string, unknown> | null | undefined} binding
 * @returns {string}
 */
export function renderTerminalSdkProviderBinding(binding) {
    if (!binding || binding['enabled'] !== true) return 'SDK Copilot';
    return `BYOK · perfil ${valueOrDash(readBindingText(binding['profile']))} · preset ${valueOrDash(readBindingText(binding['preset']))} · provedor ${valueOrDash(readBindingText(binding['providerType']))} · modelo ${valueOrDash(readBindingText(binding['model']))}`;
}

/**
 * @param {TerminalByokSummary} summary
 * @param {Record<string, unknown> | null | undefined} binding
 * @returns {boolean}
 */
export function isSameTerminalByokProviderBoundary(summary, binding) {
    if (!summary.enabled || !summary.ready || !binding || binding['enabled'] !== true) return false;
    return (
        readBindingText(binding['profile']) === summary.profile &&
        readBindingText(binding['preset']) === summary.preset &&
        readBindingText(binding['providerType']) === summary.providerType &&
        readBindingText(binding['baseUrl']) === summary.baseUrl
    );
}

/**
 * @param {TerminalByokSummary} summary
 * @param {Record<string, unknown> | null | undefined} binding
 * @param {string | null | undefined} currentSessionId
 * @param {string | null | undefined} [currentRuntimeModel]
 * @returns {{
 *     state: 'no-live-session' | 'selection-incomplete' | 'aligned-sdk' | 'aligned-byok' | 'live-model-confirmed' | 'live-model-drift' | 'next-boot-required';
 *     preparedLabel: string;
 *     liveLabel: string;
 *     headline: string;
 *     action: string | null;
 *     sameProviderBoundary: boolean;
 * }}
 */
export function classifyTerminalByokSdkBinding(summary, binding, currentSessionId, currentRuntimeModel = null) {
    const preparedLabel = renderTerminalPreparedByokSelection(summary);
    const liveLabel = renderTerminalSdkProviderBinding(binding);
    if (!currentSessionId) {
        return {
            state: 'no-live-session',
            preparedLabel,
            liveLabel,
            headline: 'sem sessão SDK viva; a seleção preparada será usada quando a próxima sessão nascer',
            action: null,
            sameProviderBoundary: false,
        };
    }
    if (summary.enabled && !summary.ready) {
        return {
            state: 'selection-incomplete',
            preparedLabel,
            liveLabel,
            headline: 'seleção BYOK preparada está incompleta; a sessão atual continua no vínculo existente',
            action: '/byok env e /byok profiles mostram o que falta antes de novo boot',
            sameProviderBoundary: false,
        };
    }
    if (!summary.enabled && liveLabel === 'SDK Copilot') {
        return {
            state: 'aligned-sdk',
            preparedLabel,
            liveLabel,
            headline: 'seleção preparada e sessão viva estão em SDK Copilot',
            action: null,
            sameProviderBoundary: false,
        };
    }
    const sameProviderBoundary = isSameTerminalByokProviderBoundary(summary, binding);
    if (sameProviderBoundary) {
        const boundModel = readBindingText(binding?.['model']);
        if (boundModel && boundModel !== summary.model) {
            if (currentRuntimeModel === summary.model) {
                return {
                    state: 'live-model-confirmed',
                    preparedLabel,
                    liveLabel,
                    headline: 'modelo BYOK já confirmado na sessão atual',
                    action: null,
                    sameProviderBoundary,
                };
            }
            return {
                state: 'live-model-drift',
                preparedLabel,
                liveLabel,
                headline: 'provedor BYOK da sessão atual coincide; o modelo preparado ainda precisa de confirmação',
                action: '/byok model <id> pede a troca na sessão atual; confirme pelo próximo uso registrado ou por evento de modelo confirmado',
                sameProviderBoundary,
            };
        }
        return {
            state: 'aligned-byok',
            preparedLabel,
            liveLabel,
            headline: 'seleção preparada e sessão BYOK atual estão alinhadas',
            action: null,
            sameProviderBoundary,
        };
    }
    return {
        state: 'next-boot-required',
        preparedLabel,
        liveLabel,
        headline: 'seleção preparada cruza provedor ou perfil da sessão atual',
        action: '/session sdk next new e reinício da task aplicam o novo vínculo; /restart só reinicia a conversa',
        sameProviderBoundary,
    };
}
