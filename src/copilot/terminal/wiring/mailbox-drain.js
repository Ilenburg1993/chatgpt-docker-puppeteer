// @ts-check
/**
 * @module copilot/terminal/wiring/mailbox-drain
 * @file Lógica centralizada de drenagem do mailbox zero-PR do Terminal LLM-B.
 *
 *   O sistema zero-PR usa um mailbox (`_runtimeInterventionMailbox`) para receber mensagens do operador enquanto o modelo
 *   está ocupado. O mailbox é drenado automaticamente em 3 triggers:
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
} from '../../presentation/runtime-ui-state-store.js';
import { broadcastSse, getTurnQueueDepth, println, sendTurn } from '../dialog/index.js';

/**
 * Resultado de uma operação de drenagem do mailbox.
 *
 * @typedef {'sent' | 'requeued' | 'empty'} MailboxDrainResult
 */

/**
 * Entrega uma entrada de mailbox já consumida como turno de usuário, se o modelo estiver ocioso.
 *
 * Se o modelo ainda estiver ocupado (turno em andamento ou fila não-vazia), recoloca a entrada no mailbox para ser
 * drenada na próxima oportunidade.
 *
 * @param {import('../../presentation/runtime-ui-state-store.js').RuntimeInterventionMailboxEntry} entry Entrada
 *   previamente consumida (via `consumeRuntimeInterventionMailbox`).
 * @param {string} trigger Identificador do contexto que originou a drenagem (ex: `'turn_end'`, `'dialog_ready'`,
 *   `'manual_consume'`).
 * @returns {MailboxDrainResult} - `'sent'`: turno enfileirado com sucesso.
 *
 *   - `'requeued'`: modelo ocupado — entrada recolocada no mailbox.
 */
export function deliverEntryAsTurnIfIdle(entry, trigger) {
    if (!getBusy() && getTurnQueueDepth() === 0) {
        println(`\x1b[90m  [mailbox→turn] Entrada drenada após ${trigger} (${entry.source}/${entry.modeHint}).\x1b[0m`);
        broadcastSse('intervention.mailbox.drained', {
            entryId: entry.id,
            source: entry.source,
            modeHint: entry.modeHint,
            timestamp: Date.now(),
            trigger,
        });
        void sendTurn(entry.message, 'user').catch((e) => {
            log('WARN', `[mailbox.drain] Falha ao enfileirar turno (trigger=${trigger}): ${String(e?.message ?? e)}`);
        });
        return 'sent';
    }

    // Modelo ainda ocupado — recolocar no mailbox para próxima oportunidade.
    enqueueRuntimeInterventionMailbox({
        runtimeId: entry.runtimeId,
        source: entry.source,
        modeHint: entry.modeHint,
        message: entry.message,
    });
    return 'requeued';
}

/**
 * Consome uma entrada do mailbox zero-PR e, se o modelo estiver ocioso, enfileira como turno.
 *
 * Caso o modelo esteja ocupado, a entrada é recolocada no mailbox e será drenada no próximo trigger de drenagem
 * (`turn_end` ou `dialog_ready`).
 *
 * Retorna `'empty'` se o mailbox não tiver entradas; caso contrário delega a `deliverEntryAsTurnIfIdle` e retorna seu
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
