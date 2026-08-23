// @ts-check
/**
 * @module copilot/channel/inject
 * @file Canal de injeção de mensagens para o terminal LLM-B via HTTP. Envia comandos, coleta respostas SSE e monitora
 *   health do bridge.
 *
 *   src/copilot/channel/inject.js
 * @see EventBus
 * @see module:copilot/channel/client
 * @see module:copilot/conversation-hub/orchestrator
 */

import { readCopilotBootConfig } from '#copilot/boot';
import { cancelApplicationTimer, registerApplicationInterval } from '#copilot/boot/process-runtime';
import { LLM_B_TURN_TIMEOUT_MS } from '#copilot/config';
import { resolveOptionalDialogTimeout, resolveOptionalTransportTimeout } from '#copilot/dialog/timeout-policy';
import { sleep } from '#copilot/infra/public/concurrency/resilience';
import { utf8ByteLength } from '#copilot/infra/public/platform/buffer';
import { toError } from '#copilot/infra/public/platform/error';
import { createBoundedProcessOutputCapture } from '#copilot/infra/public/platform/process-output';
import { log, recordToolCall } from '#copilot/observability';
import http from 'node:http';
import { z } from 'zod';
import { ChannelError } from './errors.js';
import { subscribeSse } from './sse-client.js';

const HealthResponseSchema = z.object({
    ok: z.boolean(),
    dialogLoopActive: z.boolean().optional(),
    busy: z.boolean().optional(),
    hubSessionId: z.string().nullable().optional(),
    agentStatus: z.string().optional(),
});

/** Porta padrão do terminal LLM-B via boot config (`LLM_B_TERMINAL_PORT`). GAP-CHAN-002: validação de range. */
const DEFAULT_PORT = (() => {
    const raw = readCopilotBootConfig().server.port;
    if (!Number.isInteger(raw) || raw < 1 || raw > 65535) {
        log('WARN', `[channel/inject] Porta de boot inválida (${raw}), usando 3009`);
        return 3009;
    }
    return raw;
})();

/** Timeout padrão para aguardar resposta (ms). */
const DEFAULT_TIMEOUT_MS = LLM_B_TURN_TIMEOUT_MS;
const INJECT_LATENCY_HISTORY_SIZE = 120;
const LLM_B_HTTP_RESPONSE_MAX_BYTES = 32 * 1024 * 1024;

/** @type {number[]} */
const _injectLatencyHistory = [];

/** @type {number[]} Timestamps das últimas injeções (sliding window). */
const _injectTimestamps = [];

/**
 * Índice lógico do início da janela dentro de `_injectTimestamps`. Evita `Array.prototype.shift()` O(n) em bursts de
 * injeção.
 *
 * @type {number}
 */
let _injectWindowStartIndex = 0;

/**
 * @param {number} durationMs
 * @returns {void}
 */
function _recordInjectLatency(durationMs) {
    if (!Number.isFinite(durationMs) || durationMs <= 0) return;
    _injectLatencyHistory.push(durationMs);
    if (_injectLatencyHistory.length > INJECT_LATENCY_HISTORY_SIZE) {
        _injectLatencyHistory.splice(0, _injectLatencyHistory.length - INJECT_LATENCY_HISTORY_SIZE);
    }
}

/**
 * @returns {number}
 */
function _estimateInjectP95() {
    if (_injectLatencyHistory.length === 0) return 0;
    const sorted = [..._injectLatencyHistory].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
    return sorted[idx] ?? 0;
}

/**
 * Registra telemetria local de volume sem bloquear a próxima injeção.
 *
 * @returns {boolean} Sempre true; limites de LLM-B são informativos.
 */
function _checkClientRateLimit() {
    const now = Date.now();
    const windowStart = now - 1_000;
    while (
        _injectWindowStartIndex < _injectTimestamps.length &&
        (_injectTimestamps[_injectWindowStartIndex] ?? 0) < windowStart
    ) {
        _injectWindowStartIndex++;
    }

    _injectTimestamps.push(now);

    if (_injectWindowStartIndex > 64 && _injectWindowStartIndex * 2 >= _injectTimestamps.length) {
        _injectTimestamps.splice(0, _injectWindowStartIndex);
        _injectWindowStartIndex = 0;
    }

    return true;
}
/**
 * @typedef {Object} InjectOpts
 * @property {string} [from] - ator remetente (default: 'llm-a')
 * @property {'queue'
 *     | 'mailbox'
 *     | 'defer'
 *     | 'deferred'
 *     | 'turn'
 *     | 'dialog'
 *     | 'auto'
 *     | 'steer'
 *     | 'immediate'
 *     | 'intervene'
 *     | 'interrupt'
 *     | 'abort'
 *     | 'abort-and-queue'
 *     | 'abort_and_queue'} [mode]
 *   - modo de entrega: `queue`/`mailbox` enfileira no mailbox zero-PR para a próxima ask_user; `turn`/`dialog` abre turno
 *       canônico e pode consumir PR; `steer`/`immediate` usa SDK immediate quando política permitir; `interrupt` aborta
 *       o turno ativo e, por padrão, guarda substituição no mailbox; `abort` apenas aborta o turno ativo.
 *
 * @property {number | null} [timeoutMs] - timeout semântico do turno em ms (padrão adaptativo). Use 0/null para
 *   watchdog-only (sem timeout absoluto)
 * @property {number | null} [transportTimeoutMs] - timeout de transporte HTTP informativo; null desabilita bloqueio
 * @property {number} [port] - porta do terminal (default: porta canônica do boot)
 * @property {import('#copilot/sdk/types').MessageOptions['attachments']} [attachments] - Anexos (arquivos, imagens) a
 *   enviar junto com a mensagem
 * @property {number} [retries] - Tentativas automáticas em caso de 409 LLM_B_BUSY (default: 3; 0 = sem retry)
 * @property {number} [retryDelayMs] - Delay base entre tentativas em ms; duplicado por tentativa (backoff exponencial,
 *   default: 1500)
 * @property {boolean} [retryOn503] - Se true, faz retry em 503 (dialog loop iniciando). útil no boot do terminal
 *   (default: false)
 *
 * @typedef {Object} InjectResult
 * @property {boolean} ok - true se a resposta foi obtida com sucesso
 * @property {string | null} reply - Resposta de LLM-B; null em modos zero-PR assíncronos/mailbox
 * @property {'queue' | 'mailbox_queue' | 'deferred_mailbox' | 'steer' | 'interrupt' | 'abort' | string | undefined} [mode]
 *   - modo efetivo retornado pela borda
 *
 * @property {string | undefined} [messageId] - id SDK retornado por modo `steer`
 * @property {number} durationMs - Duração da chamada em ms
 * @property {string} from - Ator remetente
 * @property {string | undefined} [traceId] - traceId retornado pela borda canônica do terminal
 * @property {number | null | undefined} [timeoutMs] - timeout semântico efetivo usado pelo servidor
 * @property {'explicit' | 'adaptive' | 'disabled' | undefined} [timeoutStrategy] - estratégia do timeout semântico
 * @property {string[] | undefined} [timeoutReasons] - razões do timeout semântico
 * @property {number | null | undefined} [transportTimeoutMs] - timeout HTTP efetivo do client/channel
 * @property {'explicit' | 'adaptive' | 'disabled' | undefined} [transportTimeoutStrategy] - estratégia do timeout HTTP
 * @property {string[] | undefined} [transportTimeoutReasons] - razões do timeout HTTP
 * @property {string | null | undefined} [promptDigest] - digest do prompt associado ao inject
 * @property {Record<string, unknown> | null | undefined} [promptFreshness] - freshness do prompt associado ao inject
 * @property {Record<string, unknown> | null | undefined} [diagnostics] - diagnóstico estrutural do inject retornado
 *   pelo servidor
 *
 * @typedef {Object} HealthResult
 * @property {boolean} ok - true se o servidor está acessível
 * @property {boolean} ready - true se o dialog loop está ativo
 * @property {boolean} busy - true se há turno em andamento
 * @property {string | null} hubSessionId - ID da hub_session ativa
 * @property {string} agentStatus - status do agente ('idle' | 'running' | 'stopped')
 */

/**
 * Faz um request HTTP simples (sem fetch para compatibilidade total com Node.js 24 sem --experimental-fetch).
 *
 * @param {'GET' | 'POST'} method
 * @param {string} path
 * @param {object | null} body
 * @param {number} port
 * @param {number | null | undefined} timeoutMs
 * @returns {Promise<{ statusCode: number; body: string }>}
 */
function httpRequest(method, path, body, port, timeoutMs) {
    return new Promise((resolve, reject) => {
        const bodyStr = body !== null ? JSON.stringify(body) : '';
        const headers = /** @type {Record<string, string>} */ ({
            'Content-Type': 'application/json',
        });
        if (bodyStr) headers['Content-Length'] = String(utf8ByteLength(bodyStr, 'channel inject body'));

        const req = http.request(
            {
                hostname: '127.0.0.1',
                port,
                path,
                method,
                headers,
            },
            (res) => {
                const capture = createBoundedProcessOutputCapture({
                    maxBytes: LLM_B_HTTP_RESPONSE_MAX_BYTES,
                });
                const contentLength = Number(res.headers['content-length'] ?? 0);
                if (Number.isFinite(contentLength) && contentLength > LLM_B_HTTP_RESPONSE_MAX_BYTES) {
                    req.destroy(
                        new ChannelError(
                            `Resposta da LLM-B excede ${LLM_B_HTTP_RESPONSE_MAX_BYTES} bytes`,
                            'LLM_B_RESPONSE_TOO_LARGE',
                        ),
                    );
                    return;
                }
                res.on('data', (/** @type {Buffer} */ chunk) => {
                    if (capture.append(chunk).truncated) {
                        req.destroy(
                            new ChannelError(
                                `Resposta da LLM-B excede ${LLM_B_HTTP_RESPONSE_MAX_BYTES} bytes`,
                                'LLM_B_RESPONSE_TOO_LARGE',
                            ),
                        );
                    }
                });
                res.on('end', () => {
                    try {
                        resolve({
                            statusCode: res.statusCode ?? 0,
                            body: capture.toString({ fatal: true, label: 'LLM-B response' }),
                        });
                    } catch {
                        reject(new ChannelError('Resposta da LLM-B contém UTF-8 inválido', 'LLM_B_INVALID_RESPONSE'));
                    }
                });
            },
        );

        if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0) {
            req.setTimeout(timeoutMs, () => {
                req.destroy(new ChannelError(`Timeout após ${timeoutMs}ms aguardando LLM-B`, 'LLM_B_TIMEOUT'));
            });
        }

        req.on('error', reject);

        if (bodyStr) req.write(bodyStr);
        req.end();
    });
}
/**
 * Verifica se o terminal LLM-B está ativo e com dialog loop pronto.
 *
 * @param {{ port?: number }} [opts]
 * @returns {Promise<HealthResult>}
 */
export async function checkLlmBHealth(opts = {}) {
    const port = opts.port ?? DEFAULT_PORT;
    try {
        const { body } = await httpRequest('GET', '/health', null, port, 5_000);
        const raw = JSON.parse(body);
        const result = HealthResponseSchema.safeParse(raw);
        const parsed = result.success && result.data ? result.data : /** @type {Record<string, unknown>} */ (raw);
        return {
            ok: parsed['ok'] === true,
            ready: parsed['dialogLoopActive'] === true,
            busy: parsed['busy'] === true,
            hubSessionId: /** @type {string | null} */ (parsed['hubSessionId'] ?? null),
            agentStatus: /** @type {string} */ (parsed['agentStatus'] ?? 'unknown'),
        };
    } catch {
        return { ok: false, ready: false, busy: false, hubSessionId: null, agentStatus: 'unknown' };
    }
}
/**
 * Envia uma mensagem de LLM-A para LLM-B via terminal permanente.
 *
 * O terminal deve estar ativo (`npm run terminal:llm-b`) antes de chamar esta função. Use `checkLlmBHealth()` para
 * verificar disponibilidade antes de chamar.
 *
 * Latência esperada: 15-25 segundos por turno (round-trip ao modelo).
 *
 * INJECT-01: Em caso de 409 (LLM_B_BUSY) ou 503 com `retryOn503=true` (dialog loop iniciando), tenta automaticamente
 * até `retries` vezes com backoff exponencial (default: 3 tentativas, base 1.5s → 1.5s, 3s, 6s). O comportamento é
 * configurável via `opts.retries`, `opts.retryDelayMs` e `opts.retryOn503`.
 *
 * @param {string} message - Mensagem a enviar para LLM-B
 * @param {InjectOpts} [opts]
 * @returns {Promise<InjectResult>}
 * @throws {ChannelError} Se o terminal não estiver ativo, LLM-B ocupada após todas as tentativas, ou timeout excedido
 */
export async function injectToLlmB(message, opts = {}) {
    const maxRetries = opts.retries ?? 3;
    const retryDelayMs = opts.retryDelayMs ?? 1_500;
    const retryOn503 = opts.retryOn503 ?? false;

    _checkClientRateLimit();

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await _doInjectToLlmB(message, opts);
        } catch (err) {
            const isBusy = toError(err).code === 'LLM_B_BUSY';
            const isBootingUp = retryOn503 && toError(err).code === 'LLM_B_UNAVAILABLE';
            if ((isBusy || isBootingUp) && attempt < maxRetries) {
                // F11.2: backoff exponencial (base, 2×, 4×, ...) em vez de linear
                const waitMs = retryDelayMs * Math.pow(2, attempt);
                log(
                    'INFO',
                    `[inject-llmb] Tentativa ${attempt + 1}/${maxRetries} (${isBusy ? 'BUSY' : 'BOOTING'}) — aguardando ${waitMs}ms...`,
                );
                await sleep(waitMs);
                continue;
            }
            throw err;
        }
    }
    // TypeScript safety — loop acima sempre retorna ou lança
    /* c8 ignore next */
    throw new ChannelError('[inject-llmb] Falha inesperada após retries', 'LLM_B_BUSY');
}
/**
 * Implementação interna de uma única tentativa de injeção. Não deve ser chamada diretamente.
 *
 * @param {string} message
 * @param {InjectOpts} opts
 * @returns {Promise<InjectResult>}
 * @throws {ChannelError} Se a resposta for inválida, LLM-B ocupada, indisponível ou retornar erro
 */
async function _doInjectToLlmB(message, opts) {
    const port = opts.port ?? DEFAULT_PORT;
    const recentP95Ms = _estimateInjectP95();
    const timeoutDecision = resolveOptionalDialogTimeout({
        explicitTimeoutMs: opts.timeoutMs,
        defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
        recentP95Ms,
        payloadChars: message.length,
        phase: 'inject',
        allowDisabled: true,
    });
    const timeoutMs = timeoutDecision.timeoutMs;
    const transportDecision = resolveOptionalTransportTimeout({
        turnTimeoutMs: timeoutMs ?? DEFAULT_TIMEOUT_MS,
        explicitTransportTimeoutMs: opts.transportTimeoutMs,
        recentP95Ms,
        phase: 'inject',
        allowDisabled: true,
    });
    const transportTimeoutMs = transportDecision.timeoutMs;
    const from = opts.from ?? 'llm-a';
    const attachments = opts.attachments;
    const _startMs = Date.now();
    const effectiveMode = typeof opts.mode === 'string' ? opts.mode : undefined;

    const payload = {
        message,
        from,
        timeout: timeoutMs,
        ...(typeof effectiveMode === 'string' ? { mode: effectiveMode } : {}),
        ...(attachments !== undefined ? { attachments } : {}),
    };
    let statusCode;
    let body;
    try {
        ({ statusCode, body } = await httpRequest('POST', '/inject', payload, port, transportTimeoutMs));
    } catch (e) {
        // F11.3: registrar erro de transporte no tool-stats
        recordToolCall('channel.inject', Date.now() - _startMs, false);
        throw e;
    }

    const trimmedBody = body.trim();

    if (statusCode === 408 || statusCode === 504) {
        const e = new ChannelError(
            `[inject-llmb] Timeout aguardando resposta da LLM-B (HTTP ${statusCode})`,
            'LLM_B_TIMEOUT',
        );
        recordToolCall('channel.inject', Date.now() - _startMs, false);
        throw e;
    }

    if (!trimmedBody) {
        if (statusCode === 409) {
            throw new ChannelError(
                '[inject-llmb] LLM-B está ocupada processando outra mensagem. Tente novamente em instantes.',
                'LLM_B_BUSY',
            );
        }

        if (statusCode === 503) {
            throw new ChannelError(
                '[inject-llmb] Terminal LLM-B não está disponível. Inicie com: npm run terminal:llm-b',
                'LLM_B_UNAVAILABLE',
            );
        }

        if (statusCode >= 500) {
            const e = new ChannelError(
                `[inject-llmb] Terminal respondeu HTTP ${statusCode} sem corpo JSON`,
                'LLM_B_ERROR',
            );
            recordToolCall('channel.inject', Date.now() - _startMs, false);
            throw e;
        }
    }

    let parsed;
    try {
        parsed = /** @type {Record<string, unknown>} */ (JSON.parse(body));
    } catch {
        if (statusCode === 408 || statusCode === 504) {
            const e = new ChannelError(
                `[inject-llmb] Timeout aguardando resposta da LLM-B (HTTP ${statusCode})`,
                'LLM_B_TIMEOUT',
            );
            recordToolCall('channel.inject', Date.now() - _startMs, false);
            throw e;
        }
        const e = new ChannelError(
            `[inject-llmb] Resposta inválida do terminal (status ${statusCode}): ${body.slice(0, 200)}`,
            'LLM_B_INVALID_RESPONSE',
        );
        recordToolCall('channel.inject', Date.now() - _startMs, false);
        throw e;
    }

    if (statusCode === 409) {
        // Não registrar 409 como erro — é condição esperada de backpressure
        throw new ChannelError(
            '[inject-llmb] LLM-B está ocupada processando outra mensagem. Tente novamente em instantes.',
            'LLM_B_BUSY',
        );
    }

    if (statusCode === 503) {
        throw new ChannelError(
            '[inject-llmb] Terminal LLM-B não está disponível. Inicie com: npm run terminal:llm-b',
            'LLM_B_UNAVAILABLE',
        );
    }

    if (!parsed['ok']) {
        const e = new ChannelError(`[inject-llmb] Erro: ${parsed['error'] ?? 'desconhecido'}`, 'LLM_B_ERROR');
        recordToolCall('channel.inject', Date.now() - _startMs, false);
        throw e;
    }

    // F11.3: registrar latência por chamada bem-sucedida
    const durationMs = Date.now() - _startMs;
    _recordInjectLatency(durationMs);
    recordToolCall('channel.inject', durationMs);

    log(
        'INFO',
        `[inject-llmb] timeout(turn=${timeoutMs === null ? 'watchdog-only' : `${timeoutMs}ms`}/${timeoutDecision.strategy}, transport=${transportTimeoutMs ?? 'disabled'}/${transportDecision.strategy})` +
            ` reasons(turn=${timeoutDecision.reasons.join('+')}; transport=${transportDecision.reasons.join('+')})`,
    );

    return {
        ok: true,
        reply: parsed['reply'] === null ? null : /** @type {string} */ (parsed['reply'] ?? ''),
        ...(typeof parsed['mode'] === 'string' ? { mode: parsed['mode'] } : {}),
        ...(typeof parsed['messageId'] === 'string' ? { messageId: parsed['messageId'] } : {}),
        durationMs: /** @type {number} */ (parsed['durationMs'] ?? durationMs),
        from: /** @type {string} */ (parsed['from'] ?? from),
        ...(typeof parsed['traceId'] === 'string' ? { traceId: parsed['traceId'] } : {}),
        timeoutMs,
        timeoutStrategy: timeoutDecision.strategy,
        timeoutReasons: timeoutDecision.reasons,
        transportTimeoutMs,
        transportTimeoutStrategy: transportDecision.strategy,
        transportTimeoutReasons: transportDecision.reasons,
        ...(typeof parsed['promptDigest'] === 'string' || parsed['promptDigest'] === null
            ? { promptDigest: /** @type {string | null} */ (parsed['promptDigest'] ?? null) }
            : {}),
        ...(parsed['promptFreshness'] && typeof parsed['promptFreshness'] === 'object'
            ? { promptFreshness: /** @type {Record<string, unknown>} */ (parsed['promptFreshness']) }
            : {}),
        ...(parsed['diagnostics'] && typeof parsed['diagnostics'] === 'object'
            ? { diagnostics: /** @type {Record<string, unknown>} */ (parsed['diagnostics']) }
            : {}),
    };
}
/**
 * Aguarda até o terminal LLM-B estar pronto, com polling periódico.
 *
 * @param {{ maxWaitMs?: number | null; pollIntervalMs?: number; port?: number }} [opts]
 * @returns {Promise<void>}
 * @throws {ChannelError} Se o terminal não ficar pronto dentro do tempo máximo
 */
export async function waitForLlmBReady(opts = {}) {
    const maxWaitMs =
        typeof opts.maxWaitMs === 'number' && Number.isFinite(opts.maxWaitMs) && opts.maxWaitMs > 0
            ? opts.maxWaitMs
            : null;
    const pollIntervalMs = opts.pollIntervalMs ?? 2_000;
    const port = opts.port ?? DEFAULT_PORT;
    const deadline = maxWaitMs === null ? Number.POSITIVE_INFINITY : Date.now() + maxWaitMs;

    return await new Promise((resolve, reject) => {
        let settled = false;
        let running = false;
        const timerId = `channel.inject.waitForReady:${Date.now()}:${Math.random().toString(36).slice(2)}`;

        /** @param {unknown} [error] */
        const settle = (error) => {
            if (settled) return;
            settled = true;
            cancelApplicationTimer(timerId);
            if (error !== undefined) {
                reject(toError(error));
            } else {
                resolve();
            }
        };

        const tick = async () => {
            if (settled || running) return;
            running = true;
            try {
                const h = await checkLlmBHealth({ port });
                if (h.ready) {
                    settle();
                    return;
                }
                if (Date.now() >= deadline) {
                    settle(
                        new ChannelError(
                            `[inject-llmb] Terminal LLM-B não ficou pronto em ${maxWaitMs}ms.`,
                            'LLM_B_NOT_READY',
                        ),
                    );
                }
            } catch (error) {
                settle(error);
            } finally {
                running = false;
            }
        };

        void tick();
        const timer = registerApplicationInterval(
            timerId,
            () => {
                void tick();
            },
            pollIntervalMs,
        );
        timer.unref?.();
    });
}

/** @typedef {import('./sse-client.js').SseEvent} SseEvent */
/** @typedef {import('./sse-client.js').SseHandler} SseHandler */

/**
 * Subscreve ao canal SSE de eventos da LLM-B (canal P3: LLM-A observa LLM-B em tempo real).
 *
 * Conecta ao endpoint `GET /events` do terminal-server. Chame `unsubscribe()` no objeto retornado para desconectar.
 *
 * @example
 *     ```js
 *     const sub = subscribeLlmB((evt) => {
 *         if (evt.type === 'dialog.reply') console.log('LLM-B respondeu:', evt.data.content);
 *     });
 *     // ... depois:
 *     sub.unsubscribe();
 *     ```;
 *
 * @param {SseHandler} onEvent - Callback chamado a cada evento recebido
 * @param {{ port?: number }} [opts]
 * @returns {{ unsubscribe: () => void }} Controle de desconexão
 */
export function subscribeLlmB(onEvent, opts = {}) {
    return subscribeSse('/events', opts.port ?? DEFAULT_PORT, onEvent);
}
/**
 * Subscreve apenas ao canal de eventos críticos da LLM-B (stalled, fatal, system).
 *
 * Usa o parâmetro `?level=critical` do endpoint SSE (P8). Ideal para alertas proativos sem overhead de receber todas as
 * respostas da LLM-B.
 *
 * @param {SseHandler} onEvent - Callback chamado a cada evento crítico
 * @param {{ port?: number }} [opts]
 * @returns {{ unsubscribe: () => void }}
 */
export function subscribeLlmBCritical(onEvent, opts = {}) {
    return subscribeSse('/events?level=critical', opts.port ?? DEFAULT_PORT, onEvent);
}
/**
 * @typedef {Object} PipelineStep
 * @property {string} prompt - Mensagem a enviar neste step
 * @property {number} [waitMs] - Espera em ms antes de enviar (padrão: 0)
 * @property {string} [from] - Ator override para este step
 *
 * @typedef {Object} PipelineResult
 * @property {boolean} ok - true se todos os steps completaram
 * @property {{ step: number; prompt: string; reply: string; durationMs: number }[]} results
 */

/**
 * Executa uma sequência ordenada de prompts na LLM-B via `POST /pipeline`.
 *
 * O pipeline é abortado se a LLM-B estiver ocupada em qualquer step. Cada step aguarda a resposta antes de enviar o
 * próximo.
 *
 * @example
 *     ```js
 *     const { ok, results } = await injectPipeline([
 *         { prompt: 'Você está disponível?' },
 *         { prompt: 'Analise src/copilot/ e liste bugs.', waitMs: 1000 },
 *         { prompt: 'Gere um resumo em 3 linhas.' },
 *     ]);
 *     ```;
 *
 * @param {PipelineStep[]} steps
 * @param {{ from?: string; port?: number; timeoutMs?: number }} [opts]
 * @returns {Promise<PipelineResult>}
 * @throws {ChannelError} Se a resposta for inválida, LLM-B ocupada ou terminal indisponível
 */
export async function injectPipeline(steps, opts = {}) {
    const port = opts.port ?? DEFAULT_PORT;
    const stepCount = Math.max(1, steps.length);
    const estimatedTurnMs = Math.min(DEFAULT_TIMEOUT_MS * Math.min(stepCount, 6), 15 * 60_000);
    const transportDecision = resolveOptionalTransportTimeout({
        turnTimeoutMs: estimatedTurnMs,
        explicitTransportTimeoutMs: opts.timeoutMs,
        recentP95Ms: _estimateInjectP95(),
        phase: 'pipeline',
        allowDisabled: true,
    });
    const timeoutMs = transportDecision.timeoutMs;
    const from = opts.from ?? 'llm-a';

    const { statusCode, body } = await httpRequest('POST', '/pipeline', { steps, from }, port, timeoutMs);

    let parsed;
    try {
        parsed = /** @type {Record<string, unknown>} */ (JSON.parse(body));
    } catch {
        throw new ChannelError(
            `[inject-llmb] Resposta inválida do pipeline (status ${statusCode}): ${body.slice(0, 200)}`,
            'LLM_B_INVALID_RESPONSE',
        );
    }

    if (statusCode === 409) {
        throw new ChannelError(
            '[inject-llmb] LLM-B ocupada — pipeline abortado. Resultados parciais em parsed.results.',
            'LLM_B_BUSY',
        );
    }

    if (statusCode === 503) {
        throw new ChannelError(
            '[inject-llmb] Terminal LLM-B não está disponível. Inicie com: npm run terminal:llm-b',
            'LLM_B_UNAVAILABLE',
        );
    }

    return {
        ok: parsed['ok'] === true,
        results: /** @type {{ step: number; prompt: string; reply: string; durationMs: number }[]} */ (
            parsed['results'] ?? []
        ),
    };
}
