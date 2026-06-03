// @ts-check
/**
 * @module copilot/terminal/wiring/mailbox-drain
 * @file Lógica centralizada de drenagem da fila de intervenção do Terminal LLM-B.
 *
 *   A fila de intervenção usa `_runtimeInterventionMailbox` internamente para receber mensagens do operador enquanto o
 *   modelo está ocupado. Ela é drenada automaticamente em 3 gatilhos:
 *
 *   1. `onUserInputRequested` — quando `ask_user` dispara durante um turno ativo; a entrada é entregue diretamente à
 *        callback do SDK sem custar PR extra. → Tratado em `sdk-session-events.js` (fluxo distinto: entrega via SDK
 *        callback).
 *   2. `turn_end` — quando um turno termina sem ter disparado `ask_user`; a entrada ficaria stranded sem este drain. Usa
 *        `setImmediate` para defer pós `setBusy(false)`. → Trigger: `EMITTER_ASSISTANT_TURN_END` em
 *        `sdk-session-events.js`.
 *   3. `dialog_ready` — quando o dialog loop sinaliza prontidão (após restart ou abort pelo watchdog).
 *        `EMITTER_ASSISTANT_TURN_END` NÃO dispara após abort — este é o único caminho. → Trigger:
 *        `EMITTER_DIALOG_READY` em `terminal-agent-wiring.js`.
 *
 *   Este módulo expõe duas funções reutilizáveis por todos os triggers automáticos (2 e 3) e pelo comando manual
 *   `/mailbox consume`:
 *
 *   - `deliverEntryAsTurnIfIdle(entry, trigger)` — entrega uma entrada já consumida como turno se o modelo estiver ocioso,
 *       caso contrário recoloca na fila.
 *   - `drainMailboxToTurnIfIdle(trigger)` — consome a próxima entrada do mailbox e delega a `deliverEntryAsTurnIfIdle`.
 *       Retorna 'sent' | 'requeued' | 'empty'.
 *
 * @see module:copilot/terminal/events/sdk-session-events (triggers turn_end)
 * @see module:copilot/terminal/wiring/terminal-agent-wiring (trigger dialog_ready)
 * @see module:copilot/terminal/repl/repl-command-router (manual /mailbox consume)
 */

import { log } from '#copilot/observability';
import {
    consumeRuntimeInterventionMailbox,
    enqueueRuntimeInterventionMailbox,
    getBusy,
} from '../../presentation/state/index.js';
import { broadcastSse, getTurnQueueDepth, println, sendTurn } from '../dialog/index.js';
import { terminalThemeRow } from '../state/repl/index.js';
import { withTerminalTurnCorrelation } from '../state/events/index.js';

/**
 * Resultado de uma operação de drenagem da fila de intervenção.
 *
 * @typedef {'sent' | 'requeued' | 'empty'} MailboxDrainResult
 */

/**
 * @param {string | undefined | null} source
 * @returns {string}
 */
function renderInterventionSourceLabel(source) {
    switch (source) {
        case 'terminal':
            return 'terminal';
        case 'http':
            return 'HTTP local';
        case 'sdk':
            return 'SDK';
        case 'watchdog':
            return 'watchdog';
        default:
            return 'operador';
    }
}

/**
 * @param {string | undefined | null} mode
 * @returns {string}
 */
function renderInterventionModeLabel(mode) {
    switch (mode) {
        case 'queue':
            return 'fila';
        case 'interrupt':
            return 'substituição';
        case 'steer':
            return 'intervenção';
        case 'turn':
            return 'turno';
        default:
            return 'intervenção';
    }
}

/**
 * @param {string} trigger
 * @returns {string}
 */
function renderDrainTriggerLabel(trigger) {
    switch (trigger) {
        case 'turn_end':
            return 'fim do turno';
        case 'dialog_ready':
            return 'conversa pronta';
        case 'manual_consume':
            return 'consumo manual';
        default:
            return String(trigger).replace(/[._-]+/gu, ' ');
    }
}

/**
 * Entrega uma entrada da fila de intervenção já consumida como turno de usuário, se o modelo estiver ocioso.
 *
 * Se o modelo ainda estiver ocupado (turno em andamento ou fila não-vazia), recoloca a entrada na fila para ser drenada
 * na próxima oportunidade.
 *
 * @param {import('../../presentation/state/index.js').RuntimeInterventionMailboxEntry} entry Entrada
 *   previamente consumida (via `consumeRuntimeInterventionMailbox`).
 * @param {string} trigger Identificador do contexto que originou a drenagem (ex: `'turn_end'`, `'dialog_ready'`,
 *   `'manual_consume'`).
 * @returns {MailboxDrainResult} - `'sent'`: turno enfileirado com sucesso.
 *
 *   - `'requeued'`: modelo ocupado — entrada recolocada no mailbox.
 */
export function deliverEntryAsTurnIfIdle(entry, trigger) {
    if (!getBusy() && getTurnQueueDepth() === 0) {
        println(
            terminalThemeRow(
                'Fila de intervenção',
                `aplicada como novo turno · ${renderDrainTriggerLabel(trigger)} · origem ${renderInterventionSourceLabel(entry.source)} · ${renderInterventionModeLabel(entry.modeHint)}`,
            ),
        );
        broadcastSse(
            'intervention.mailbox.drained',
            withTerminalTurnCorrelation({
                entryId: entry.id,
                source: entry.source,
                eventSource: 'terminal-mailbox/intervention.mailbox.drained',
                modeHint: entry.modeHint,
                timestamp: Date.now(),
                trigger,
            }),
        );
        void sendTurn(entry.message, 'user').catch((e) => {
            log('WARN', `[mailbox.drain] Falha ao enfileirar turno (trigger=${trigger}): ${String(e?.message ?? e)}`);
        });
        return 'sent';
    }

    // Modelo ainda ocupado — recolocar na fila para próxima oportunidade.
    enqueueRuntimeInterventionMailbox({
        runtimeId: entry.runtimeId,
        source: entry.source,
        modeHint: entry.modeHint,
        message: entry.message,
    });
    return 'requeued';
}

/**
 * Consome uma entrada da fila de intervenção e, se o modelo estiver ocioso, enfileira como turno.
 *
 * Caso o modelo esteja ocupado, a entrada é recolocada na fila e será drenada no próximo gatilho de drenagem
 * (`turn_end` ou `dialog_ready`).
 *
 * Retorna `'empty'` se a fila não tiver entradas; caso contrário delega a `deliverEntryAsTurnIfIdle` e retorna seu
 * resultado.
 *
 * @param {string} trigger Identificador do contexto de drenagem (ex: `'turn_end'`, `'dialog_ready'`,
 *   `'manual_consume'`).
 * @param {string | null} [runtimeId] ID do runtime para filtrar entradas; `null` usa o default `'default'`.
 * @returns {MailboxDrainResult}
 */
export function drainMailboxToTurnIfIdle(trigger, runtimeId = null) {
    const entry = consumeRuntimeInterventionMailbox(runtimeId);
    if (!entry) return 'empty';
    return deliverEntryAsTurnIfIdle(entry, trigger);
}
