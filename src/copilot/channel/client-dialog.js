// @ts-check
/**
 * src/copilot/channel/client-dialog.js
 *
 * Funções de dialog mode extraídas de LlmBridgeClient para reduzir o God Module. Cada função opera sobre a interface
 * BridgeAgentLike e retorna dados puros.
 *
 * @module copilot/channel/client-dialog
 * @see EventBus
 */

import { LLM_B_TURN_TIMEOUT_MS } from '#copilot/config';
import {
    EMITTER_DIALOG_DELTA,
    EMITTER_DIALOG_READY,
    EMITTER_DIALOG_REPLY,
    EMITTER_DIALOG_STOPPED,
    EMITTER_TASK_DELTA,
    EMITTER_TASK_REASONING,
} from '#copilot/events';
import { log } from '#copilot/observability';
import {
    sendRuntimeDialogTurnOnActiveLoop,
    startRuntimeDialogLoop,
    stopRuntimeDialogLoopAuthorized,
} from '#copilot/runtime';

const CROSS_CHANNEL_DELTA_SUPPRESSION_WINDOW_MS = 75;

/**
 * @param {unknown} value
 * @returns {string}
 */
function stringOrEmpty(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function scalarOrEmpty(value) {
    if (typeof value === 'string') return stringOrEmpty(value);
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return '';
}

/**
 * Identidade causal do delta. Quando presente, ela e mais forte que dedupe textual: dois chunks iguais com chaves
 * diferentes sao conteudo distinto; duas entregas com a mesma chave sao o mesmo evento reemitido por canais paralelos.
 *
 * @param {Record<string, unknown>} evt
 * @returns {string | null}
 */
function resolveDeltaCausalKey(evt) {
    const eventId = stringOrEmpty(evt['eventId']) || stringOrEmpty(evt['causationId']) || stringOrEmpty(evt['id']);
    if (eventId) return `event:${eventId}`;

    const streamId = stringOrEmpty(evt['streamId']) || stringOrEmpty(evt['messageId']) || stringOrEmpty(evt['responseId']);
    const chunkSeq = scalarOrEmpty(evt['chunkSeq']) || scalarOrEmpty(evt['sequence']) || scalarOrEmpty(evt['seq']);
    if (streamId && chunkSeq) return `stream:${streamId}:${chunkSeq}`;

    return null;
}

/**
 * Resultado canônico do transporte de um turno explícito no dialog loop.
 *
 * `replySource` descreve a origem imediata do texto entregue ao consumer:
 *
 * - `runtime_return`: o runtime devolveu o reply diretamente
 * - `transport_mirror`: o runtime/bridge usou o espelho canônico de transporte do evento `dialog.reply`
 * - `empty`: nenhum conteúdo textual foi materializado pelo transporte
 *
 * @typedef {{
 *     reply: string;
 *     replySource: 'runtime_return' | 'transport_mirror' | 'empty';
 *     hadReplyEvent: boolean;
 * }} DialogTurnTransportResult
 */

/**
 * @typedef {'accepted' | 'normalized' | 'suppressed'} DialogDeltaDiagnosticAction
 */

/**
 * @typedef {'raw'
 *     | 'causal_duplicate'
 *     | 'temporal_cross_channel'
 *     | 'cumulative_snapshot'
 *     | 'cumulative_prefix'
 *     | 'duplicate_suffix'
 *     | 'overlap_normalized'} DialogDeltaDiagnosticReason
 */

/**
 * @typedef {{
 *     action: DialogDeltaDiagnosticAction;
 *     reason: DialogDeltaDiagnosticReason;
 *     source: 'task.delta' | 'dialog.delta';
 *     causalKey: string | null;
 *     rawChunk: string;
 *     normalizedChunk: string;
 *     rawChars: number;
 *     normalizedChars: number;
 *     at: number;
 *     streamId?: unknown;
 *     chunkSeq?: unknown;
 *     eventId?: unknown;
 *     causationId?: unknown;
 * }} DialogDeltaDiagnosticEvent
 */

/**
 * Interface mínima do AlwaysAliveAgent usada pelas funções de dialog.
 *
 * @typedef {import('./client.js').BridgeAgentLike} BridgeAgentLike
 */

/**
 * Registra os event listeners de diálogo e retorna uma função de cleanup simétrica.
 *
 * @param {BridgeAgentLike} agent
 * @param {{ onReady?: () => void; onReply?: (reply: string) => void; onStopped?: () => void }} opts
 * @returns {{ replyHandler: ((evt: unknown) => void) | null; cleanupReady: () => void; cleanup: () => void }}
 */
export function registerDialogListeners(agent, opts) {
    const { onReady, onReply, onStopped } = opts;
    const replyHandler = onReply
        ? (/** @type {unknown} */ rawEvt) => {
              const evt = /** @type {{ reply?: string }} */ (rawEvt);
              onReply(evt.reply ?? '');
          }
        : null;

    if (onReady) agent.once(EMITTER_DIALOG_READY, onReady);
    if (replyHandler) agent.on(EMITTER_DIALOG_REPLY, replyHandler);
    if (onStopped) agent.once(EMITTER_DIALOG_STOPPED, onStopped);

    const cleanupReady = () => {
        if (onReady) agent.off('dialog.ready', onReady);
    };

    const cleanup = () => {
        cleanupReady();
        if (replyHandler) agent.off('dialog.reply', replyHandler);
        if (onStopped) agent.off('dialog.stopped', onStopped);
    };

    return { replyHandler, cleanupReady, cleanup };
}

/**
 * Inicia a LLM-B em modo de "diálogo direto" (Dialog Loop).
 *
 * @param {BridgeAgentLike} agent
 * @param {string} [bootPrompt]
 * @param {{
 *     onReady?: () => void;
 *     onReply?: (reply: string) => void;
 *     onStopped?: () => void;
 *     resumeSessionAttach?: boolean;
 * }} [opts]
 * @returns {Promise<void>}
 */
export async function startDialogMode(agent, bootPrompt, opts = {}) {
    const { cleanupReady, cleanup } = registerDialogListeners(agent, opts);

    try {
        const resumeSessionAttach = opts.resumeSessionAttach === true;
        await startRuntimeDialogLoop(bootPrompt, agent, { resumeSessionAttach });
        if (resumeSessionAttach) {
            opts.onReady?.();
            cleanupReady();
        }
        log(
            'INFO',
            resumeSessionAttach
                ? '[LlmBridgeClient] Modo diálogo reanexado à sessão retomada sem boot prompt.'
                : '[LlmBridgeClient] Modo diálogo ativo — LLM-B sinalizou READY.',
        );
    } catch (err) {
        cleanup();
        throw err;
    }
}

/**
 * Envia um turno de diálogo para a LLM-B no dialog loop retornando metadados canônicos de transporte.
 *
 * @param {BridgeAgentLike} agent
 * @param {string} message
 * @param {{
 *     timeout?: number | null;
 *     onDelta?: (chunk: string, envelope?: Record<string, unknown>) => void;
 *     onDeltaDiagnostic?: (event: DialogDeltaDiagnosticEvent) => void;
 *     onReasoning?: (chunk: string, reasoningId: string | null) => void;
 * }} [opts]
 * @returns {Promise<DialogTurnTransportResult>}
 */
export async function dialogTurnDetailed(agent, message, opts = {}) {
    const { timeout = LLM_B_TURN_TIMEOUT_MS, onDelta, onDeltaDiagnostic, onReasoning } = opts;
    /** @type {string} */
    let replyFromEvent = '';
    /** @type {boolean} */
    let hadReplyEvent = false;

    const onReplyTemp = (/** @type {unknown} */ rawEvt) => {
        const evt = /** @type {{ reply?: string }} */ (rawEvt);
        if (typeof evt.reply === 'string' && evt.reply.trim().length > 0) {
            hadReplyEvent = true;
            replyFromEvent = evt.reply;
        }
    };
    agent.on(EMITTER_DIALOG_REPLY, onReplyTemp);

    const createDeltaListener = onDelta || onDeltaDiagnostic
        ? (() => {
              /** @type {{ chunk: string; source: 'task.delta' | 'dialog.delta'; at: number; causalKey: string | null } | null} */
              let lastDelta = null;
              /** @type {Set<string>} */
              const seenCausalKeys = new Set();
              let emittedText = '';
              let sawCumulativeSnapshot = false;
              /** @type {'task.delta' | 'dialog.delta' | null} */
              let lastEmittedSource = null;
              /** @type {'dialog.delta' | null} */
              let canonicalDialogDeltaSource = null;
              /** @type {string | null} */
              let lastEmittedCausalKey = null;

              /**
               * @param {DialogDeltaDiagnosticEvent} event
               * @returns {void}
               */
              const emitDeltaDiagnostic = (event) => {
                  if (!onDeltaDiagnostic) return;
                  try {
                      onDeltaDiagnostic(event);
                  } catch (err) {
                      const message = err instanceof Error ? err.message : String(err);
                      log('WARN', `[LlmBridgeClient] onDeltaDiagnostic falhou: ${message}`);
                  }
              };

              /**
               * Alguns bridges entregam `deltaContent` incremental, outros ecoam snapshots cumulativos ou sufixos ja
               * cobertos por um snapshot anterior. Normalizar aqui evita que o renderer tenha de adivinhar.
               *
               * @param {string} rawChunk
               * @param {'task.delta' | 'dialog.delta'} source
               * @param {string | null} causalKey
               * @returns {{ chunk: string; reason: DialogDeltaDiagnosticReason }}
               */
              const normalizeAppendableChunk = (rawChunk, source, causalKey) => {
                  if (!emittedText) return { chunk: rawChunk, reason: 'raw' };

                  const hasDistinctCausalProgress =
                      Boolean(causalKey) && Boolean(lastEmittedCausalKey) && causalKey !== lastEmittedCausalKey;
                  const shouldTrustAsDuplicate =
                      sawCumulativeSnapshot || (source !== lastEmittedSource && !hasDistinctCausalProgress);

                  if (rawChunk === emittedText && shouldTrustAsDuplicate) {
                      sawCumulativeSnapshot = true;
                      return { chunk: '', reason: 'cumulative_snapshot' };
                  }

                  if (rawChunk !== emittedText && rawChunk.startsWith(emittedText)) {
                      sawCumulativeSnapshot = true;
                      return { chunk: rawChunk.slice(emittedText.length), reason: 'cumulative_snapshot' };
                  }

                  if (rawChunk !== emittedText && emittedText.startsWith(rawChunk) && shouldTrustAsDuplicate) {
                      sawCumulativeSnapshot = true;
                      return { chunk: '', reason: 'cumulative_prefix' };
                  }

                  if (emittedText.endsWith(rawChunk) && shouldTrustAsDuplicate) {
                      return { chunk: '', reason: 'duplicate_suffix' };
                  }

                  if (shouldTrustAsDuplicate) {
                      for (let overlap = Math.min(emittedText.length, rawChunk.length); overlap > 0; overlap -= 1) {
                          if (emittedText.endsWith(rawChunk.slice(0, overlap))) {
                              return { chunk: rawChunk.slice(overlap), reason: 'overlap_normalized' };
                          }
                      }
                  }

                  return { chunk: rawChunk, reason: 'raw' };
              };

              return (/** @type {'task.delta' | 'dialog.delta'} */ source) => (/** @type {unknown} */ rawEvt) => {
                  const evt = /** @type {{ chunk?: string } & Record<string, unknown>} */ (rawEvt);
                  if (!evt.chunk) return;
                  if (canonicalDialogDeltaSource === 'dialog.delta' && source === 'task.delta') {
                      return;
                  }
                  if (source === 'dialog.delta') {
                      canonicalDialogDeltaSource = 'dialog.delta';
                  }
                  const now = Date.now();
                  const causalKey = resolveDeltaCausalKey(evt);
                  if (causalKey) {
                      if (seenCausalKeys.has(causalKey)) {
                          lastDelta = { chunk: evt.chunk, source, at: now, causalKey };
                          emitDeltaDiagnostic({
                              action: 'suppressed',
                              reason: 'causal_duplicate',
                              source,
                              causalKey,
                              rawChunk: evt.chunk,
                              normalizedChunk: '',
                              rawChars: evt.chunk.length,
                              normalizedChars: 0,
                              at: now,
                              streamId: evt['streamId'],
                              chunkSeq: evt['chunkSeq'],
                              eventId: evt['eventId'],
                              causationId: evt['causationId'],
                          });
                          return;
                      }
                      seenCausalKeys.add(causalKey);
                  }
                  if (
                      !causalKey &&
                      !lastDelta?.causalKey &&
                      lastDelta &&
                      lastDelta.chunk === evt.chunk &&
                      lastDelta.source !== source &&
                      now - lastDelta.at <= CROSS_CHANNEL_DELTA_SUPPRESSION_WINDOW_MS
                  ) {
                      lastDelta = { chunk: evt.chunk, source, at: now, causalKey };
                      emitDeltaDiagnostic({
                          action: 'suppressed',
                          reason: 'temporal_cross_channel',
                          source,
                          causalKey,
                          rawChunk: evt.chunk,
                          normalizedChunk: '',
                          rawChars: evt.chunk.length,
                          normalizedChars: 0,
                          at: now,
                          streamId: evt['streamId'],
                          chunkSeq: evt['chunkSeq'],
                          eventId: evt['eventId'],
                          causationId: evt['causationId'],
                      });
                      return;
                  }
                  lastDelta = { chunk: evt.chunk, source, at: now, causalKey };
                  const normalized = normalizeAppendableChunk(evt.chunk, source, causalKey);
                  const appendableChunk = normalized.chunk;
                  if (!appendableChunk) {
                      emitDeltaDiagnostic({
                          action: 'suppressed',
                          reason: normalized.reason,
                          source,
                          causalKey,
                          rawChunk: evt.chunk,
                          normalizedChunk: '',
                          rawChars: evt.chunk.length,
                          normalizedChars: 0,
                          at: now,
                          streamId: evt['streamId'],
                          chunkSeq: evt['chunkSeq'],
                          eventId: evt['eventId'],
                          causationId: evt['causationId'],
                      });
                      return;
                  }
                  emittedText += appendableChunk;
                  lastEmittedSource = source;
                  lastEmittedCausalKey = causalKey;
                  emitDeltaDiagnostic({
                      action: normalized.reason === 'raw' ? 'accepted' : 'normalized',
                      reason: normalized.reason,
                      source,
                      causalKey,
                      rawChunk: evt.chunk,
                      normalizedChunk: appendableChunk,
                      rawChars: evt.chunk.length,
                      normalizedChars: appendableChunk.length,
                      at: now,
                      streamId: evt['streamId'],
                      chunkSeq: evt['chunkSeq'],
                      eventId: evt['eventId'],
                      causationId: evt['causationId'],
                  });
                  if (!onDelta) return;
                  if (onDelta.length >= 2) {
                      onDelta(appendableChunk, {
                          ...evt,
                          source,
                          rawChunk: evt.chunk,
                          normalizedChunk: appendableChunk,
                      });
                  } else {
                      onDelta(appendableChunk);
                  }
              };
          })()
        : null;
    const onTaskDeltaTemp = createDeltaListener ? createDeltaListener('task.delta') : null;
    const onDialogDeltaTemp = createDeltaListener ? createDeltaListener('dialog.delta') : null;
    if (onTaskDeltaTemp && onDialogDeltaTemp) {
        agent.on(EMITTER_TASK_DELTA, onTaskDeltaTemp);
        agent.on(EMITTER_DIALOG_DELTA, onDialogDeltaTemp);
    }

    const onReasoningTemp = onReasoning
        ? (/** @type {unknown} */ rawEvt) => {
              const evt = /** @type {{ chunk?: string; reasoningId?: string | null }} */ (rawEvt);
              if (evt.chunk) onReasoning(evt.chunk, evt.reasoningId ?? null);
          }
        : null;
    if (onReasoningTemp) agent.on(EMITTER_TASK_REASONING, onReasoningTemp);

    try {
        const reply = await sendRuntimeDialogTurnOnActiveLoop(message, { timeout }, agent);
        if (reply === null && replyFromEvent.trim().length === 0) {
            throw new Error('[LlmBridgeClient] sendDialogTurn retornou null.');
        }

        const directReply = typeof reply === 'string' ? reply : '';
        if (directReply.trim().length > 0) {
            /** @type {DialogTurnTransportResult} */
            const result = {
                reply: directReply,
                replySource: 'runtime_return',
                hadReplyEvent,
            };
            log(
                'INFO',
                `[LlmBridgeClient] dialogTurnDetailed resolved (source=${result.replySource}, replyLen=${result.reply.length}, hadReplyEvent=${result.hadReplyEvent}).`,
            );
            return result;
        }

        if (replyFromEvent.trim().length === 0) {
            await new Promise((resolve) => setImmediate(resolve));
        }
        if (replyFromEvent.trim().length > 0) {
            log(
                'INFO',
                '[LlmBridgeClient] sendDialogTurn retornou vazio; usando espelho canônico de transporte via dialog.reply.',
            );
            /** @type {DialogTurnTransportResult} */
            const result = {
                reply: replyFromEvent,
                replySource: 'transport_mirror',
                hadReplyEvent: true,
            };
            log(
                'INFO',
                `[LlmBridgeClient] dialogTurnDetailed resolved (source=${result.replySource}, replyLen=${result.reply.length}, hadReplyEvent=${result.hadReplyEvent}).`,
            );
            return result;
        }
        /** @type {DialogTurnTransportResult} */
        const result = {
            reply: directReply,
            replySource: 'empty',
            hadReplyEvent,
        };
        log(
            'WARN',
            `[LlmBridgeClient] dialogTurnDetailed resolved sem conteúdo textual (source=${result.replySource}, hadReplyEvent=${result.hadReplyEvent}).`,
        );
        return result;
    } finally {
        agent.off(EMITTER_DIALOG_REPLY, onReplyTemp);
        if (onTaskDeltaTemp && onDialogDeltaTemp) {
            agent.off(EMITTER_TASK_DELTA, onTaskDeltaTemp);
            agent.off(EMITTER_DIALOG_DELTA, onDialogDeltaTemp);
        }
        if (onReasoningTemp) agent.off('task.reasoning', onReasoningTemp);
    }
}

/**
 * Envia um turno de diálogo para a LLM-B no dialog loop.
 *
 * @param {BridgeAgentLike} agent
 * @param {string} message
 * @param {{
 *     timeout?: number | null;
 *     onDelta?: (chunk: string, envelope?: Record<string, unknown>) => void;
 *     onDeltaDiagnostic?: (event: DialogDeltaDiagnosticEvent) => void;
 *     onReasoning?: (chunk: string, reasoningId: string | null) => void;
 * }} [opts]
 * @returns {Promise<string>}
 */
export async function dialogTurn(agent, message, opts = {}) {
    const result = await dialogTurnDetailed(agent, message, opts);
    return result.reply;
}

/**
 * Encerra o modo de diálogo direto.
 *
 * @param {BridgeAgentLike} agent
 * @param {'watchdog_restart' | 'authorized_stop' | 'recovery_restart'} [reason='watchdog_restart'] Default is
 *   `'watchdog_restart'`
 * @returns {Promise<void>}
 */
export async function stopDialogMode(agent, reason = 'watchdog_restart') {
    await stopRuntimeDialogLoopAuthorized(agent, reason);
    log('INFO', `[LlmBridgeClient] Modo diálogo encerrado (reason=${reason}).`);
}
