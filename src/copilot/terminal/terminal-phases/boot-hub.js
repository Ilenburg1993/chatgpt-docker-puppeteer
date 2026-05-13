// @ts-check
/**
 * @module copilot/terminal/terminal-phases/boot-hub
 * @file Fase de boot: ConversationHub.
 *
 *   Inicializa o hub conversacional e cria a hub_session do terminal permanente. Failure é best-effort — o terminal
 *   continua funcional sem persistência.
 */

import { getSharedSdkSessionId, toError } from '#copilot/core';
import { log } from '#copilot/observability';
import { setHubSessionId } from '../../presentation/state/index.js';
import { createTerminalHubSession, initTerminalConversationHub } from '../frontend/gateways/index.js';
import { recordTerminalActivity } from '../state/boot/index.js';

/**
 * @param {import('../runtime-root.js').TerminalBootContext} ctx
 * @returns {Promise<void>}
 */
export async function runTerminalConversationHubPhase(ctx) {
    try {
        recordTerminalActivity('boot', 'Inicializando conversation hub', { source: 'terminal', recordHistory: false });
        await initTerminalConversationHub();
        const sdkSessionId = getSharedSdkSessionId();
        const hubSessionId = createTerminalHubSession({
            title: 'Terminal Permanente LLM-B',
            ...(sdkSessionId ? { sdkSessionId } : {}),
            metadata: { source: 'terminal-server', startedAt: new Date().toISOString() },
        });
        setHubSessionId(hubSessionId);
        log('INFO', `[TerminalServer] Hub session criada: ${hubSessionId}`);
    } catch (e) {
        recordTerminalActivity('system', 'Hub storage indisponível', {
            detail: toError(e).message,
            severity: 'warn',
            source: 'terminal',
        });
        log('WARN', `[TerminalServer] Hub storage indisponível, continua sem persistência: ${toError(e).message}`);
    }
    void ctx;
}
