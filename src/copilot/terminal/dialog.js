// @ts-check
/**
 * src/copilot/terminal/dialog.js
 *
 * Motor de diálogo do Terminal Permanente LLM-B.
 *
 * Responsável por:
 *
 * - Garantir que o dialog loop está ativo (`ensureDialogLoop`)
 * - Enviar turnos de diálogo e exibir respostas (`sendTurn`)
 * - Serializar chamadas concorrentes a `sendTurn` via fila Promise (TERM-01)
 * - Transmitir eventos via dual-emit SSE + Socket.io /copilot namespace (`broadcastSse`)
 * - Renderizar output no stdout (`println`, `printExchange`)
 *
 * @module copilot/terminal/dialog
 * @see module:copilot/terminal/repl
 * @see module:copilot/channel/client
 */

import { log } from '#copilot/observability/logger';
import { alwaysAliveAgent } from '../agent/always-alive.js';
import { eventFanout } from '../api/event-fanout.js';
import { emitNerv } from '../bridges/nerv-bridge.js';
import { llmBridgeClient } from '../channel/client.js';
import { conversationHub } from '../conversation-hub/hub.js';
import { broadcastGlobal, broadcastToSession } from '../conversation-hub/socket-ns.js';
import { LLM_B_TURN_TIMEOUT_MS, MAX_SSE_CONTENT_CHARS } from '../core/constants.js';
import { embedMultiple, readFileContext } from './file-context.js';
import {
    clearAttachments,
    getAttachmentQueue,
    getHubSessionId,
    getPlanMode,
    getRl,
    getShowThinking,
    getShowUsage,
    getSseClients,
    getSseCriticalClients,
    getTerminalReplayBuffer,
    setBusy,
} from './state.js';

// ─── Eventos críticos para SSE ────────────────────────────────────────────────

/** Eventos considerados críticos para clientes em modo ?level=critical. */
export const CRITICAL_EVENTS = new Set(['dialog.stalled', 'fatal', 'system']);

// ─── F35.1: Queue local para notifyTerminalTurn em standalone ─────────────────

/**
 * @typedef {object} PendingTurnNotification
 * @property {string} hubSessionId
 * @property {{ turnId: number; role: 'user' | 'llm_a'; content: string; turnNumber: number }} userTurn
 * @property {{ turnId: number; content: string; turnNumber: number; durationMs: number }} llmBTurn
 */

/** @type {PendingTurnNotification[]} */
const _pendingNotifications = [];

/** F35.4: Counter de falhas de persistência (notifyTerminalTurn). */
let _persistenceFailureCount = 0;

/** Máximo de notificações pendentes na fila local. */
const MAX_PENDING_NOTIFICATIONS = 50;

/**
 * F35.1: Drena a fila de notificações pendentes quando o hub ficar disponível. Deve ser chamada após o hub ser
 * inicializado (initStandalone/init).
 */
export function drainPendingNotifications() {
    if (!conversationHub.isReady || _pendingNotifications.length === 0) return;
    const drained = _pendingNotifications.splice(0);
    let replayed = 0;
    for (const n of drained) {
        try {
            conversationHub.notifyTerminalTurn(n.hubSessionId, n.userTurn, n.llmBTurn);
            replayed++;
        } catch (/** @type {any} */ e) {
            log('WARN', `[dialog] F35.1: replay notifyTerminalTurn falhou: ${e.message}`);
            _persistenceFailureCount++;
        }
    }
    if (replayed > 0) {
        log('INFO', `[dialog] F35.1: ${replayed} notificações pendentes drenadas com sucesso.`);
    }
}

/**
 * F35.4: Retorna o counter de falhas de persistência.
 *
 * @returns {number}
 */
export function getPersistenceFailureCount() {
    return _persistenceFailureCount;
}

/**
 * Contador monotônico de IDs para eventos SSE do terminal. Permite reconexão com Last-Event-ID (RFC 8895 §9.2.4).
 *
 * @type {number}
 */
let _sseEventIdCounter = 0;

/**
 * Gera o próximo ID SSE monotônico.
 *
 * @returns {number}
 */
export function nextSseEventId() {
    return ++_sseEventIdCounter;
}

// ─── Fila de serialização de turnos (TERM-01) ─────────────────────────────────

/**
 * Limite máximo de turnos enfileirados aguardando LLM-B. Se excedido, novas chamadas são rejeitadas com 503
 * (backpressure). Evita acúmulo ilimitado de promessas em sessões de alta carga.
 */
const MAX_TURN_QUEUE_SIZE = 10;

/**
 * Número de turnos atualmente enfileirados aguardando execução (exclui o turno em execução).
 *
 * @type {number}
 */
let _turnQueueDepth = 0;

/**
 * Retorna a profundidade atual da fila de turnos.
 *
 * @returns {number}
 */
export function getTurnQueueDepth() {
    return _turnQueueDepth;
}

/**
 * Promise-chain mutex para serializar chamadas concorrentes a `sendTurn`.
 *
 * TERM-01: substitui a estratégia de rejeição imediata (`getBusy() === true → return null`) por uma fila que serializa
 * os callers na ordem de chegada. Isso garante que:
 *
 * - Mensagens de LLM-A e do usuário não são perdidas silenciosamente quando o terminal está ocupado.
 * - O diálogo (dialog loop) não sofre race condition em `#pendingQuestion`.
 * - A flag `_busy` permanece como indicador observável de estado, mas não é mais o gate de decisão.
 *
 * @type {Promise<string | null>}
 */
let _sendTurnMutex = Promise.resolve(null);

// ─── Configuração ─────────────────────────────────────────────────────────────

/** Timeout para aguardar resposta da LLM-B por turno (ms). */
const TURN_TIMEOUT_MS = LLM_B_TURN_TIMEOUT_MS;

const PROMPT_USER = '\x1b[32mvocê\x1b[0m\x1b[90m›\x1b[0m ';
const PROMPT_WAITING = '     ';

/** Separador visual entre turnos — 72 colunas. */
const SEPARATOR = '\x1b[90m  ' + '─'.repeat(70) + '\x1b[0m';

/** Prefácio injetado antes das mensagens quando /plan mode está ativo. */
const PLAN_PREFIX =
    '[MODO PLANEJAMENTO] Antes de responder, elabore um plano detalhado passo-a-passo. ' +
    'Não pule para a resposta diretamente. Liste dependências, riscos e alternativas.\n\n';

/**
 * Boot prompt padrão enviado à LLM-B ao iniciar o dialog loop. Pode ser sobrescrito pela variável de ambiente
 * `LLM_B_BOOT_PROMPT`.
 *
 * DL-PERM-03: não há instrução de encerramento (STOP_DIALOG) — o loop é eterno por design. Se o modelo emitir STOPPED
 * por iniciativa própria, o sistema reinicia automaticamente.
 */
const DEFAULT_BOOT_PROMPT = `Você é a LLM-B — assistente técnico interno do projeto chatgpt-docker-puppeteer.

Contexto do projeto:
- Node.js 24+ ESM; arquitetura orientada a eventos via barramento NERV
- Camadas principais: kernel, driver, orchestrator, agent, infra, server, missions
- Você opera como agente contínuo de longa duração, nunca encerra sessões

Seu papel:
- Responder perguntas técnicas sobre o codebase, arquitetura e decisões de design
- Ajudar na análise de bugs, código e logs quando solicitado
- Colaborar criticamente com o desenvolvedor e com a LLM-A (seu parceiro de raciocínio)

Protocolo OBRIGATÓRIO de comunicação via ask_user:
1. Chame ask_user("READY: aguardando próxima mensagem") para sinalizar prontidão.
2. Ao receber uma mensagem, processe-a e formule uma resposta completa.
3. Chame ask_user("REPLY: " + sua_resposta) para enviar a resposta.
4. Retorne ao passo 1.

IMPORTANTE: NUNCA encerre o loop. Não use ask_user("STOPPED") nem qualquer variante
de encerramento — o sistema é projetado para funcionar de forma contínua e permanente.
O loop deve continuar mesmo quando não há mensagens pendentes.`;

/** Boot prompt efetivo: env var sobrescreve o padrão. @type {string} */
export const BOOT_PROMPT = process.env['LLM_B_BOOT_PROMPT'] ?? DEFAULT_BOOT_PROMPT;

// ─── Output helpers ───────────────────────────────────────────────────────────

/**
 * Escreve linha no stdout preservando o estado do prompt.
 *
 * @param {string} text - Texto a exibir
 * @returns {void}
 */
export function println(text) {
    process.stdout.write(`\r${text}\n`);
}

/**
 * Exibe um turno completo (mensagem + resposta) com formatação visual limpa.
 *
 * Formato:
 *
 *     ── [14:22:10] você ──────────────────────────────────────────────────────
 *       <mensagem>
 *
 *     ── [14:22:11] 🧠 LLM-B · gpt-4.1 · high · 3.2s ─────────────────────
 *       <resposta linha a linha>
 *
 * @param {string} actor - Ator que enviou ('user' | 'llm-a')
 * @param {string} message - Mensagem enviada
 * @param {string} reply - Resposta da LLM-B
 * @param {number} durationMs - Duração da chamada em ms
 * @returns {void}
 */
export function printExchange(actor, message, reply, durationMs) {
    const ts = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const secs = (durationMs / 1000).toFixed(1);
    const model = alwaysAliveAgent.model;
    const effort = alwaysAliveAgent.reasoningEffort ?? 'high';

    // Duração colorida: verde <5s, amarelo <15s, vermelho >=15s
    const secsNum = durationMs / 1000;
    const secsColor =
        secsNum < 5 ? `\x1b[32m${secs}s\x1b[0m` : secsNum < 15 ? `\x1b[33m${secs}s\x1b[0m` : `\x1b[31m${secs}s\x1b[0m`;

    if (actor === 'llm-a') {
        println(SEPARATOR);
        println(`  \x1b[90m[${ts}]\x1b[0m  🤖  \x1b[34mLLM-A\x1b[0m`);
        println('');
        for (const line of message.split('\n')) {
            println(`  \x1b[34m│\x1b[0m  ${line}`);
        }
        println('');
    }

    println(SEPARATOR);
    println(
        `  \x1b[90m[${ts}]\x1b[0m  🧠  \x1b[32mLLM-B\x1b[0m  \x1b[90m·\x1b[0m  \x1b[36m${model}\x1b[0m  \x1b[90m·\x1b[0m  \x1b[35m${effort}\x1b[0m  \x1b[90m·\x1b[0m  ${secsColor}`,
    );
    println('');
    // F37.3: Syntax highlighting para code blocks (```...```)
    const replyLines = reply.split('\n');
    let inCodeBlock = false;
    for (const line of replyLines) {
        if (line.trimStart().startsWith('```')) {
            inCodeBlock = !inCodeBlock;
            // Exibir delimitador em dim
            println(`  \x1b[32m│\x1b[0m  \x1b[2m${line}\x1b[0m`);
        } else if (inCodeBlock) {
            // Código: fundo escuro + cyan para distinguir
            println(`  \x1b[32m│\x1b[0m  \x1b[48;5;236m\x1b[36m${line}\x1b[0m`);
        } else {
            println(`  \x1b[32m│\x1b[0m  ${line}`);
        }
    }
    println('');
}

// ─── SSE ──────────────────────────────────────────────────────────────────────

/**
 * Transmite um evento para todos os canais de saída conectados:
 *
 * 1. **SSE (raw node:http)** — escrita direta em `ServerResponse` dos clientes no endpoint GET /events. Clientes em modo
 *    `?level=critical` recebem apenas eventos listados em `CRITICAL_EVENTS`.
 * 2. **Socket.io** — emite via namespace `/copilot` se o namespace estiver montado (processo integrado). Quando o terminal
 *    corre como processo separado (PM2), o namespace é `null` e esta etapa é no-op.
 *
 * @param {string} event - Tipo do evento (ex: `'reply'` | `'ready'` | `'stalled'` | `'error'`)
 * @param {object} data - Payload JSON serializável
 * @returns {void}
 */
export function broadcastSse(event, data) {
    const _sseClients = getSseClients();
    const _sseCriticalClients = getSseCriticalClients();

    // BUG-N07 (fix): truncar conteúdo de reply para evitar SSE message gigante
    // T-29 fix: MAX_SSE_CONTENT_CHARS agora importada de core/constants.js (compartilhada)
    /** @type {object} */
    let safeData = data;
    if (
        data !== null &&
        typeof data === 'object' &&
        typeof (/** @type {Record<string, unknown>} */ (data)['content']) === 'string' &&
        /** @type {{ content: string }} */ (data).content.length > MAX_SSE_CONTENT_CHARS
    ) {
        safeData = {
            ...data,
            content:
                /** @type {{ content: string }} */ (data).content.slice(0, MAX_SSE_CONTENT_CHARS) + ' [\u2026truncado]',
        };
    }

    emitSse(_sseClients, _sseCriticalClients, event, safeData);
    emitSocket(event, safeData);

    // FASE-15.2: publicar no barramento de fanout para propagação inter-processo
    eventFanout.publish('terminal', event, safeData);
}

/**
 * FASE-12.1: Escreve um evento SSE formatado para um único client raw (node:http).
 *
 * Centraliza sanitização, event ID monotônico, hubSessionId injection e escrita. FASE-12.2: Armazena no replay buffer
 * para suporte a Last-Event-ID.
 *
 * @param {import('node:http').ServerResponse} client
 * @param {string} event - Nome do evento (será sanitizado)
 * @param {object} data - Payload JSON (já truncado se necessário)
 * @param {{ hubSessionId?: string | null; replayBuffer?: import('../api/sse-replay-buffer.js').SseReplayBuffer }} [ctx]
 * @returns {boolean} true se a escrita foi bem-sucedida
 */
function writeSseEvent(client, event, data, ctx = {}) {
    const safeEvent = String(event).replace(/[\r\n]/g, '_');
    const enrichedData = { ...data, hubSessionId: ctx.hubSessionId ?? null };
    // FASE-12.2: push no replay buffer e usar o ID retornado
    const eventId = ctx.replayBuffer ? ctx.replayBuffer.push(safeEvent, enrichedData) : nextSseEventId();
    const payload = `id: ${eventId}\nevent: ${safeEvent}\ndata: ${JSON.stringify(enrichedData)}\n\n`;
    try {
        client.write(payload);
        return true;
    } catch {
        return false;
    }
}

/**
 * Envia um evento SSE para clientes raw (node:http ServerResponse).
 *
 * @param {Set<import('node:http').ServerResponse>} clients - Clientes SSE gerais
 * @param {Set<import('node:http').ServerResponse>} criticalClients - Clientes SSE de eventos críticos
 * @param {string} event - Tipo do evento
 * @param {object} data - Payload já sanitizado/truncado
 * @returns {void}
 */
function emitSse(clients, criticalClients, event, data) {
    if (clients.size === 0 && criticalClients.size === 0) return;

    const ctx = { hubSessionId: getHubSessionId(), replayBuffer: getTerminalReplayBuffer() };

    for (const client of clients) {
        if (!writeSseEvent(client, event, data, ctx)) {
            clients.delete(client);
        }
    }
    if (CRITICAL_EVENTS.has(event)) {
        for (const client of criticalClients) {
            if (!writeSseEvent(client, event, data, ctx)) {
                criticalClients.delete(client);
            }
        }
    }
}

/**
 * Emite um evento via Socket.io namespace `/copilot`.
 *
 * @param {import('socket.io').Namespace | null} ns - Namespace Socket.io (null = no-op)
 * @param {string | null} hubSessionId - ID da hub_session ativa
 * @param {string} event - Tipo do evento
 * @param {object} data - Payload já sanitizado/truncado
 * @returns {void}
 */
/**
 * Emite um evento via Socket.io namespace `/copilot` usando helpers centralizados de socket-ns.js.
 *
 * FASE-15.1: desacoplado de broadcastSse — usa broadcastToSession/broadcastGlobal em vez de manipulação direta do
 * namespace.
 *
 * @param {string} event - Tipo do evento
 * @param {object} data - Payload já sanitizado/truncado
 * @returns {void}
 */
function emitSocket(event, data) {
    const hubSessionId = getHubSessionId();
    if (hubSessionId) {
        // BUG-HIGH-02 fix: emitir apenas para a sala da hub_session ativa
        broadcastToSession(hubSessionId, event, { ...data, hubSessionId });
    } else {
        // Sem sessão ativa: emitir globalmente apenas eventos de sistema inócuos
        const SYSTEM_EVENTS = new Set(['dialog.ready', 'dialog.stalled', 'dialog.stopped', 'fatal', 'busy']);
        if (SYSTEM_EVENTS.has(event)) {
            broadcastGlobal(event, { ...data, hubSessionId: null });
        }
    }
}

// ─── Dialog loop ──────────────────────────────────────────────────────────────

/**
 * Promise em voo para proteger contra chamadas concorrentes a `ensureDialogLoop`.
 *
 * DL-PERM-02: se dois eventos (ex: `dialog.stalled` + `dialog.stopped`) dispararem `ensureDialogLoop()` ao mesmo tempo,
 * apenas o primeiro inicia o loop — os demais aguardam a conclusão do mesmo boot, evitando dois `startDialogMode()`
 * simultâneos.
 *
 * @type {Promise<void> | null}
 */
let _ensureDialogLoopInFlight = null;

/**
 * Garante que o dialog loop está ativo. Se não estiver, inicia-o.
 *
 * DL-PERM-02: chamadas concorrentes são coalesced — apenas uma inicialização corre por vez.
 *
 * @returns {Promise<void>}
 */
export function ensureDialogLoop() {
    if (alwaysAliveAgent.dialogLoopActive) {
        return Promise.resolve();
    }
    // NEW-PAUSE-04: não reiniciar automaticamente se o usuário pausou explicitamente
    if (alwaysAliveAgent.dialogPaused) {
        log('INFO', '[dialog] ensureDialogLoop() ignorado — dialogPaused=true (pausado pelo usuário)');
        return Promise.resolve();
    }
    // Coalescimento: se já há um boot em andamento, reutiliza a mesma Promise
    if (_ensureDialogLoopInFlight !== null) {
        return _ensureDialogLoopInFlight;
    }
    _ensureDialogLoopInFlight = _doEnsureDialogLoop().finally(() => {
        _ensureDialogLoopInFlight = null;
    });
    return _ensureDialogLoopInFlight;
}

/**
 * Implementação interna de ensureDialogLoop — nunca chamar diretamente.
 *
 * BUG-N05 (fix): retry com backoff exponencial (2s/4s/8s) em caso de falha.
 *
 * @returns {Promise<void>}
 */
async function _doEnsureDialogLoop() {
    const MAX_RETRIES = 3;
    let attempt = 0;

    while (attempt <= MAX_RETRIES) {
        try {
            await _tryStartDialogLoop();
            return;
        } catch (/** @type {any} */ err) {
            attempt++;
            if (attempt > MAX_RETRIES) {
                log('ERROR', `[dialog] ensureDialogLoop falhou após ${MAX_RETRIES} tentativas: ${err.message}`);
                // FLOW-UPG-05: emitir Nerv severity=error para alertar monitoramento
                emitNerv('copilot:dialog:boot_failed', {
                    error: err.message,
                    attempts: MAX_RETRIES,
                    severity: 'error',
                });
                throw err;
            }
            const delay = 2000 * 2 ** (attempt - 1); // 2s, 4s, 8s
            log(
                'WARN',
                `[dialog] ensureDialogLoop falhou (tentativa ${attempt}/${MAX_RETRIES}) — retry em ${delay}ms: ${err.message}`,
            );
            await new Promise((r) => setTimeout(r, delay));
        }
    }
}

/**
 * Tenta iniciar o dialog loop uma vez.
 *
 * @returns {Promise<void>}
 */
async function _tryStartDialogLoop() {
    const status = alwaysAliveAgent.status;
    if (status === 'stopped') {
        println('\x1b[90m  Iniciando AlwaysAliveAgent…\x1b[0m');
        await alwaysAliveAgent.start();
        // Aguarda idle
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Timeout aguardando idle')), 30_000);
            const check = () => {
                if (alwaysAliveAgent.status === 'idle') {
                    clearTimeout(timeout);
                    resolve(undefined);
                } else {
                    setTimeout(check, 500);
                }
            };
            check();
        });
    }

    // MR-05 (fix): se o agente está em 'processing', startDialogMode falharia com INVALID_STATE.
    // Aguardar até 30s para o agente terminar a tarefa em andamento e voltar para 'idle'.
    if (alwaysAliveAgent.status === 'processing') {
        println('\x1b[90m  Aguardando agente concluir tarefa em andamento…\x1b[0m');
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(
                () => reject(new Error('Timeout aguardando idle após processing (30s)')),
                30_000,
            );
            const check = () => {
                const s = alwaysAliveAgent.status;
                if (s === 'idle') {
                    clearTimeout(timeout);
                    resolve(undefined);
                } else if (s === 'stopped') {
                    clearTimeout(timeout);
                    reject(new Error(`Agente parado inesperadamente antes de dialog loop`));
                } else {
                    setTimeout(check, 500);
                }
            };
            check();
        });
    }

    println('\x1b[90m  Conectando ao agente…\x1b[0m');
    await llmBridgeClient.startDialogMode(BOOT_PROMPT ?? undefined, {
        onReady: () => println('\n  \x1b[32m●\x1b[0m  LLM-B pronta — pode começar\n'),
    });
}

/**
 * Envia um turno de diálogo para a LLM-B e exibe a resposta.
 *
 * TERM-01: chamadas concorrentes são enfileiradas em ordem de chegada (Promise-chain mutex). O terminal nunca mais
 * rejeita uma mensagem com `null` apenas por estar ocupado — a mensagem é colocada na fila e processada quando o turno
 * anterior terminar. Backpressure ativo quando a fila supera `MAX_TURN_QUEUE_SIZE`.
 *
 * ATT-04 (arquitetura zero-PR): todos os attachments são convertidos em texto embeddado pelo chamador (`handleInject`)
 * antes de chegar aqui. `sendTurn` sempre usa o dialog loop (`dialogTurn`) — nunca cria nova PR via `sendMessage()`.
 *
 * @param {string} message - Mensagem a enviar (pode conter blocos markdown de attachments)
 * @param {string} [actor] - Quem está enviando ('user' | 'llm-a')
 * @returns {Promise<string | null>} Resposta da LLM-B, ou null em erro irrecuperável
 */
export function sendTurn(message, actor = 'user') {
    // TERM-01: backpressure — rejeita se a fila está cheia
    if (_turnQueueDepth >= MAX_TURN_QUEUE_SIZE) {
        log(
            'WARN',
            `[TerminalServer] Fila de turnos cheia (${_turnQueueDepth}/${MAX_TURN_QUEUE_SIZE}) — rejeitando mensagem de ${actor}.`,
        );
        return Promise.resolve(null);
    }

    _turnQueueDepth++;
    const next = _sendTurnMutex.then(() => _executeTurn(message, actor)).catch(() => null);
    // A cauda ignora rejeição para não travar a fila
    _sendTurnMutex = next.then(
        () => null,
        () => null,
    );
    void next.finally(() => {
        _turnQueueDepth--;
        // PERF-N06 (fix): resetar a cadeia do mutex quando a fila estiver vazia
        // Impede que a cadeia de .then() cresça indefinidamente ao longo de milhões de turnos.
        if (_turnQueueDepth === 0) {
            _sendTurnMutex = Promise.resolve(null);
        }
    });
    return next;
}

/**
 * Implementação interna do turno — executa após obter o mutex. Não deve ser chamada diretamente.
 *
 * ATT-04 (arquitetura zero-PR): usa exclusivamente `llmBridgeClient.dialogTurn()` (protocolo ask_user, zero PRs
 * extras). Todos os attachments já foram convertidos em texto embeddado pelo chamador antes de chegar aqui.
 *
 * @param {string} message
 * @param {string} actor
 * @returns {Promise<string | null>}
 */
async function _executeTurn(message, actor) {
    const ctxState = alwaysAliveAgent.getStatusSnapshot().contextWindow;
    if (ctxState) {
        const u = ctxState.utilization;
        if (u >= 0.95) {
            println(
                `\x1b[31m  ⛔ Context window em ${(u * 100).toFixed(0)}% — risco de perda de contexto. Use /compact antes de continuar.\x1b[0m`,
            );
        } else if (u >= 0.85) {
            println(
                `\x1b[33m  ⚠️  Context window em ${(u * 100).toFixed(0)}% — considere usar /compact em breve.\x1b[0m`,
            );
        }
    }

    setBusy(true);
    // GAP-4: notifica clientes SSE sobre início de processamento
    broadcastSse('busy', { busy: true, actor });
    const rl = getRl();
    if (rl) {
        const model = alwaysAliveAgent.model;
        const effort = alwaysAliveAgent.reasoningEffort ?? 'high';
        process.stdout.write(`  \x1b[90m⏳ aguardando \x1b[36m${model}\x1b[90m · \x1b[35m${effort}\x1b[90m…\x1b[0m`);
        rl.setPrompt(PROMPT_WAITING);
    }

    // ── Enriquecimento da mensagem: fila de attachments e plan mode ──────────
    let enrichedMessage = message;

    // 1. Embed de arquivos da fila
    const queue = getAttachmentQueue();
    if (queue.length > 0) {
        clearAttachments();
        try {
            const ctxs = await Promise.all(queue.map(readFileContext));
            enrichedMessage = embedMultiple(ctxs, enrichedMessage);
            println(`\x1b[90m  📎 ${ctxs.length} arquivo(s) embutido(s): ${ctxs.map((c) => c.path).join(', ')}\x1b[0m`);
        } catch (/** @type {any} */ embedErr) {
            println(`\x1b[33m  ⚠️  Falha ao embutir arquivo(s): ${embedErr.message}\x1b[0m`);
        }
    }

    // 2. Prefácio de planejamento
    if (getPlanMode()) {
        enrichedMessage = PLAN_PREFIX + enrichedMessage;
    }

    const t0 = Date.now();
    try {
        await ensureDialogLoop();

        // F19.1: exibir mensagem do ator (user/llm-a) ANTES de iniciar o streaming
        //        (no fallback batch mode, printExchange cuida de tudo)
        if (actor === 'llm-a') {
            const tsNow = new Date().toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
            });
            println(SEPARATOR);
            println(`  \x1b[90m[${tsNow}]\x1b[0m  🤖  \x1b[34mLLM-A\x1b[0m`);
            println('');
            for (const line of message.split('\n')) {
                println(`  \x1b[34m│\x1b[0m  ${line}`);
            }
            println('');
        }

        // ── F18.2: Thinking display (reasoning deltas) ──────────────────────
        const showThinking = getShowThinking();
        let _reasoningStarted = false;
        let _reasoningChars = 0;
        let _reasoningContent = '';
        let _reasoningId = /** @type {string | null} */ (null);
        const tThinkingStart = Date.now();

        /** @type {((chunk: string, reasoningId: string | null) => void) | undefined} */
        const onReasoning = showThinking
            ? (chunk, rId) => {
                  if (!_reasoningStarted) {
                      _reasoningStarted = true;
                      _reasoningId = rId;
                      // Limpar a linha "⏳ aguardando…"
                      process.stdout.write('\r\x1b[K');
                      const tsNow = new Date().toLocaleTimeString('pt-BR', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                      });
                      println(SEPARATOR);
                      println(`  \x1b[90m[${tsNow}]\x1b[0m  💭  \x1b[2m\x1b[35mpensando…\x1b[0m`);
                      println('');
                      process.stdout.write('  \x1b[2m\x1b[90m│\x1b[0m  \x1b[2m\x1b[37m');
                  }
                  _reasoningChars += chunk.length;
                  _reasoningContent += chunk;
                  // Renderizar chunk inline com word wrap a cada ~100 chars por linha
                  const lines = chunk.split('\n');
                  for (let i = 0; i < lines.length; i++) {
                      if (i > 0) process.stdout.write('\n  \x1b[2m\x1b[90m│\x1b[0m  \x1b[2m\x1b[37m');
                      process.stdout.write(/** @type {string} */ (lines[i]));
                  }
                  // F18.3: SSE reasoning event para clientes externos
                  broadcastSse('reasoning', { chunk, reasoningId: rId });
              }
            : undefined;

        // ── F19.1: Streaming response (message deltas) ──────────────────────
        let _streamingStarted = false;
        let _streamingChars = 0;
        let _firstChunkTime = 0;

        /** @type {((chunk: string) => void) | undefined} */
        const onDelta = (chunk) => {
            if (!_streamingStarted) {
                _streamingStarted = true;
                _firstChunkTime = Date.now();
                // Se thinking estava ativo, fechar o bloco de thinking
                if (_reasoningStarted) {
                    process.stdout.write('\x1b[0m\n');
                    const thinkSecs = ((Date.now() - tThinkingStart) / 1000).toFixed(1);
                    println(`  \x1b[90m└── pensamento completo (${thinkSecs}s · ${_reasoningChars} chars)\x1b[0m`);
                    println('');
                    // F18.3: SSE evento de reasoning completo
                    broadcastSse('reasoning.complete', {
                        content: _reasoningContent,
                        reasoningId: _reasoningId,
                        durationMs: Date.now() - tThinkingStart,
                        chars: _reasoningChars,
                    });
                } else {
                    // Limpar a linha "⏳ aguardando…"
                    process.stdout.write('\r\x1b[K');
                }
                // Imprimir header da resposta
                const tsNow = new Date().toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                });
                const model = alwaysAliveAgent.model;
                const effort = alwaysAliveAgent.reasoningEffort ?? 'high';
                println(SEPARATOR);
                println(
                    `  \x1b[90m[${tsNow}]\x1b[0m  🧠  \x1b[32mLLM-B\x1b[0m  \x1b[90m·\x1b[0m  \x1b[36m${model}\x1b[0m  \x1b[90m·\x1b[0m  \x1b[35m${effort}\x1b[0m`,
                );
                println('');
                process.stdout.write('  \x1b[32m│\x1b[0m  ');
            }
            _streamingChars += chunk.length;
            // Renderizar chunk inline
            const lines = chunk.split('\n');
            for (let i = 0; i < lines.length; i++) {
                if (i > 0) process.stdout.write('\n  \x1b[32m│\x1b[0m  ');
                process.stdout.write(/** @type {string} */ (lines[i]));
            }
            // F19.3: SSE delta event para clientes externos
            broadcastSse('delta', { chunk });
        };

        const reply = await llmBridgeClient.dialogTurn(enrichedMessage, {
            timeout: TURN_TIMEOUT_MS,
            onDelta,
            ...(onReasoning && { onReasoning }),
        });
        const durationMs = Date.now() - t0;

        if (_streamingStarted) {
            // Fechar bloco de streaming e imprimir duração
            const secs = (durationMs / 1000).toFixed(1);
            const secsNum = durationMs / 1000;
            const secsColor =
                secsNum < 5
                    ? `\x1b[32m${secs}s\x1b[0m`
                    : secsNum < 15
                      ? `\x1b[33m${secs}s\x1b[0m`
                      : `\x1b[31m${secs}s\x1b[0m`;
            const ttft = _firstChunkTime > 0 ? ((_firstChunkTime - t0) / 1000).toFixed(1) + 's TTFT' : '';
            process.stdout.write('\n');
            println(`  \x1b[90m└── ${secsColor}${ttft ? `  \x1b[90m·\x1b[0m  \x1b[90m${ttft}\x1b[0m` : ''}\x1b[0m`);
            println('');
        } else {
            // Fallback: sem streaming — exibir resposta completa (batch mode)
            printExchange(actor, message, reply, durationMs);
        }

        // Se thinking não foi fechado (modelo não produziu message deltas), fechar aqui
        if (_reasoningStarted && !_streamingStarted) {
            process.stdout.write('\x1b[0m\n');
            const thinkSecs = ((Date.now() - tThinkingStart) / 1000).toFixed(1);
            println(`  \x1b[90m└── pensamento completo (${thinkSecs}s · ${_reasoningChars} chars)\x1b[0m`);
            println('');
            broadcastSse('reasoning.complete', {
                content: _reasoningContent,
                reasoningId: _reasoningId,
                durationMs: Date.now() - tThinkingStart,
                chars: _reasoningChars,
            });
        }

        // F19.2: TTFT e throughput metrics
        if (_firstChunkTime > 0) {
            const ttftMs = _firstChunkTime - t0;
            emitNerv('copilot:turn:streaming_metrics', {
                timeToFirstTokenMs: ttftMs,
                totalDurationMs: durationMs,
                streamedChars: _streamingChars,
                reasoningChars: _reasoningChars,
            });
        }

        log('INFO', `[TerminalServer] Turno ${actor} concluído em ${durationMs}ms`);

        // F20.2: Usage summary pós-turno
        if (getShowUsage()) {
            const snap = alwaysAliveAgent.getStatusSnapshot();
            const ctxWin = snap?.contextWindow;
            const prInfo = alwaysAliveAgent.lastPrInfo;
            if (ctxWin || prInfo) {
                const parts = [];
                if (prInfo) {
                    if (prInfo.model) parts.push(`modelo=\x1b[36m${prInfo.model}\x1b[0m`);
                    if (typeof prInfo.cost === 'number') parts.push(`custo=\x1b[33m${prInfo.cost.toFixed(4)}\x1b[0m`);
                }
                if (ctxWin) {
                    parts.push(`ctx=${(ctxWin.utilization * 100).toFixed(0)}%`);
                    parts.push(
                        `${ctxWin.tokens.toLocaleString('pt-BR')}/${ctxWin.tokenLimit.toLocaleString('pt-BR')} tokens`,
                    );
                }
                println(`  \x1b[90m📊 ${parts.join(' · ')}\x1b[0m`);
            }
        }

        const _hubSessionId = getHubSessionId();
        if (_hubSessionId) {
            try {
                /** @type {'user' | 'llm_a'} */
                const senderRole = actor === 'llm-a' ? 'llm_a' : 'user';
                const msgTurnId = await conversationHub.store.writeTurn(_hubSessionId, {
                    role: senderRole,
                    content: message,
                });
                const replyTurnId = await conversationHub.store.writeTurn(_hubSessionId, {
                    role: 'llm_b',
                    content: reply,
                    durationMs,
                });
                // FLOW-UPG-01: notificar Orchestrator para que LLM-A e listeners SSE vejam a
                // mensagem do terminal. Usa turn_number do store para consistência de sequência.
                // Guard: hub inicializado via initStandalone() (standalone) ou init() (main-server).
                if (conversationHub.isReady) {
                    try {
                        const msgTurn = conversationHub.store.getTurn(msgTurnId);
                        const replyTurn = conversationHub.store.getTurn(replyTurnId);
                        conversationHub.notifyTerminalTurn(
                            _hubSessionId,
                            {
                                turnId: msgTurnId,
                                role: senderRole,
                                content: message,
                                turnNumber: msgTurn?.turn_number ?? 0,
                            },
                            {
                                turnId: replyTurnId,
                                content: reply,
                                turnNumber: replyTurn?.turn_number ?? 0,
                                durationMs,
                            },
                        );
                    } catch (/** @type {any} */ hubErr) {
                        // F33/F35.1: enfileirar para replay quando hub reconectar
                        _persistenceFailureCount++;
                        log('DEBUG', `[dialog] notifyTerminalTurn falhou (enfileirado): ${hubErr.message}`);
                        if (_pendingNotifications.length < MAX_PENDING_NOTIFICATIONS) {
                            const msgTurn = conversationHub.store.getTurn(msgTurnId);
                            const replyTurn = conversationHub.store.getTurn(replyTurnId);
                            _pendingNotifications.push({
                                hubSessionId: _hubSessionId,
                                userTurn: {
                                    turnId: msgTurnId,
                                    role: senderRole,
                                    content: message,
                                    turnNumber: msgTurn?.turn_number ?? 0,
                                },
                                llmBTurn: {
                                    turnId: replyTurnId,
                                    content: reply,
                                    turnNumber: replyTurn?.turn_number ?? 0,
                                    durationMs,
                                },
                            });
                        }
                    }
                } else if (_pendingNotifications.length < MAX_PENDING_NOTIFICATIONS) {
                    // F35.1: hub offline — enfileirar notificação para replay futuro
                    const msgTurn = conversationHub.store.getTurn(msgTurnId);
                    const replyTurn = conversationHub.store.getTurn(replyTurnId);
                    _pendingNotifications.push({
                        hubSessionId: _hubSessionId,
                        userTurn: {
                            turnId: msgTurnId,
                            role: senderRole,
                            content: message,
                            turnNumber: msgTurn?.turn_number ?? 0,
                        },
                        llmBTurn: {
                            turnId: replyTurnId,
                            content: reply,
                            turnNumber: replyTurn?.turn_number ?? 0,
                            durationMs,
                        },
                    });
                }
                emitNerv('copilot:turn:sent', {
                    hubSessionId: _hubSessionId,
                    turnId: msgTurnId,
                    role: senderRole,
                    // SEC-03 (fix): não expor conteúdo completo no payload NERV — usar apenas metadados
                    // O conteúdo completo fica exclusivamente no banco (conversation-hub/store.js)
                    contentLen: message.length,
                });
                emitNerv('copilot:turn:complete', {
                    hubSessionId: _hubSessionId,
                    turnId: replyTurnId,
                    role: 'llm_b',
                    // SEC-03: idem — contentLen para observabilidade, sem vazar texto ao bus de eventos
                    contentLen: reply.length,
                    durationMs,
                });
            } catch (/** @type {any} */ hubErr) {
                log('WARN', `[TerminalServer] Hub writeTurn falhou: ${hubErr.message}`);
            }
        }

        return reply;
    } catch (/** @type {any} */ e) {
        println(`[erro] ${e.message}`);
        log('ERROR', `[TerminalServer] Erro no turno ${actor}: ${e.message}`);
        // BUG-N11 (fix): se o agente parou durante o turno, restabelecer o loop de forma assíncrona
        if (!alwaysAliveAgent.dialogLoopActive) {
            log('WARN', '[TerminalServer] Dialog loop inativo após erro — reagendando ensureDialogLoop');
            setTimeout(() => {
                ensureDialogLoop().catch((/** @type {any} */ restartErr) => {
                    log('ERROR', `[TerminalServer] Falha ao reiniciar dialog loop: ${restartErr.message}`);
                });
            }, 2_000);
        }
        return null;
    } finally {
        setBusy(false);
        // GAP-4: notifica clientes SSE que LLM-B ficou livre
        broadcastSse('busy', { busy: false });
        const rl = getRl();
        if (rl) {
            rl.setPrompt(PROMPT_USER);
            rl.prompt();
        }
    }
}
