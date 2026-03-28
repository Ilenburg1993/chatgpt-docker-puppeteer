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
 */

import { log } from '#core/logger';
import { alwaysAliveAgent } from '../agent/always-alive.js';
import { emitNerv } from '../bridges/nerv-bridge.js';
import { llmBridgeClient } from '../channel/client.js';
import { conversationHub } from '../conversation-hub/hub.js';
import { getCopilotNamespace } from '../conversation-hub/socket-ns.js';
import { LLM_B_TURN_TIMEOUT_MS } from '../core/constants.js';
import { embedMultiple, readFileContext } from './file-context.js';
import {
    clearAttachments,
    getAttachmentQueue,
    getHubSessionId,
    getPlanMode,
    getRl,
    getSseClients,
    getSseCriticalClients,
    setBusy,
} from './state.js';

// ─── Eventos críticos para SSE ────────────────────────────────────────────────

/** Eventos considerados críticos para clientes em modo ?level=critical. */
export const CRITICAL_EVENTS = new Set(['stalled', 'fatal', 'system']);

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
export const BOOT_PROMPT = process.env.LLM_B_BOOT_PROMPT ?? DEFAULT_BOOT_PROMPT;

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
    for (const line of reply.split('\n')) {
        println(`  \x1b[32m│\x1b[0m  ${line}`);
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

    // ── SSE (raw node:http) ───────────────────────────────────────────────────
    if (_sseClients.size > 0 || _sseCriticalClients.size > 0) {
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        for (const client of _sseClients) {
            try {
                client.write(payload);
            } catch {
                _sseClients.delete(client);
            }
        }
        if (CRITICAL_EVENTS.has(event)) {
            for (const client of _sseCriticalClients) {
                try {
                    client.write(payload);
                } catch {
                    _sseCriticalClients.delete(client);
                }
            }
        }
    }

    // ── Socket.io dual-emit (no-op quando namespace não montado, ex: processo separado) ──
    const _ns = getCopilotNamespace();
    if (_ns) {
        _ns.emit(event, { ...data, hubSessionId: getHubSessionId() });
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
        const reply = await llmBridgeClient.dialogTurn(enrichedMessage, { timeout: TURN_TIMEOUT_MS });
        const durationMs = Date.now() - t0;
        printExchange(actor, message, reply, durationMs);
        log('INFO', `[TerminalServer] Turno ${actor} concluído em ${durationMs}ms`);

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
