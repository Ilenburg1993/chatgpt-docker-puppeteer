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
import { LLM_B_TURN_TIMEOUT_MS } from '#copilot/config';
import { BridgeError, toError } from '#copilot/core';
import { log, recordToolCall } from '#copilot/observability';
import http from 'node:http';
import { HealthResponseSchema } from '../core/schemas.js';
import { subscribeSse } from './sse-client.js';

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

/**
 * Limite de injeções por segundo (client-side). Configurável via INJECT_RATE_LIMIT_PER_SEC. Default: 30 req/s. Protege
 * contra flood acidental.
 */
const INJECT_RATE_PER_SEC = (() => {
    const raw = parseInt(process.env['INJECT_RATE_LIMIT_PER_SEC'] ?? '', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 30;
})();

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
 * Verifica se a próxima injeção é permitida pelo rate limiter client-side. Usa sliding window de 1s.
 *
 * @returns {boolean} true se permitido
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

    const activeCount = _injectTimestamps.length - _injectWindowStartIndex;
    if (activeCount >= INJECT_RATE_PER_SEC) {
        return false;
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
 * @property {number} [timeoutMs] - timeout em ms (default: 130000)
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
 * @property {string} reply - Resposta de LLM-B
 * @property {number} durationMs - Duração da chamada em ms
 * @property {string} from - Ator remetente
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
 * @param {number} timeoutMs
 * @returns {Promise<{ statusCode: number; body: string }>}
 */
function httpRequest(method, path, body, port, timeoutMs) {
    return new Promise((resolve, reject) => {
        const bodyStr = body !== null ? JSON.stringify(body) : '';
        const headers = /** @type {Record<string, string>} */ ({
            'Content-Type': 'application/json',
        });
        if (bodyStr) headers['Content-Length'] = String(Buffer.byteLength(bodyStr));

        const req = http.request(
            {
                hostname: '127.0.0.1',
                port,
                path,
                method,
                headers,
            },
            (res) => {
                // BUG-N06 (fix): limitar corpo da resposta a 2 MB para evitar acúmulo irrestrito
                const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
                let data = '';
                let received = 0;
                res.on('data', (/** @type {Buffer} */ chunk) => {
                    received += chunk.length;
                    if (received > MAX_RESPONSE_BYTES) {
                        req.destroy(
                            new BridgeError('Resposta do terminal excede limite de 2 MB', 'LLM_B_RESPONSE_TOO_LARGE'),
                        );
                        return;
                    }
                    data += chunk.toString('utf8');
                });
                res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body: data }));
            },
        );

        req.setTimeout(timeoutMs, () => {
            req.destroy(new BridgeError(`Timeout após ${timeoutMs}ms aguardando LLM-B`, 'LLM_B_TIMEOUT'));
        });

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
 * @throws {BridgeError} Se o terminal não estiver ativo, LLM-B ocupada após todas as tentativas, ou timeout excedido
 */
export async function injectToLlmB(message, opts = {}) {
    const maxRetries = opts.retries ?? 3;
    const retryDelayMs = opts.retryDelayMs ?? 1_500;
    const retryOn503 = opts.retryOn503 ?? false;

    // F96: client-side rate limiting — rejeitar antes de enviar ao servidor
    if (!_checkClientRateLimit()) {
        throw new BridgeError(
            `[inject-llmb] Rate limit client-side excedido (${INJECT_RATE_PER_SEC} req/s). Aguarde antes de reenviar.`,
            'LLM_B_RATE_LIMITED',
        );
    }

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
                await new Promise((r) => setTimeout(r, waitMs));
                continue;
            }
            throw err;
        }
    }
    // TypeScript safety — loop acima sempre retorna ou lança
    /* c8 ignore next */
    throw new BridgeError('[inject-llmb] Falha inesperada após retries', 'LLM_B_BUSY');
}
/**
 * Implementação interna de uma única tentativa de injeção. Não deve ser chamada diretamente.
 *
 * @param {string} message
 * @param {InjectOpts} opts
 * @returns {Promise<InjectResult>}
 * @throws {BridgeError} Se a resposta for inválida, LLM-B ocupada, indisponível ou retornar erro
 */
async function _doInjectToLlmB(message, opts) {
    const port = opts.port ?? DEFAULT_PORT;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const from = opts.from ?? 'llm-a';
    const attachments = opts.attachments;
    const _startMs = Date.now();

    const payload = { message, from, ...(attachments !== undefined ? { attachments } : {}) };
    let statusCode;
    let body;
    try {
        ({ statusCode, body } = await httpRequest('POST', '/inject', payload, port, timeoutMs));
    } catch (e) {
        // F11.3: registrar erro de transporte no tool-stats
        recordToolCall('channel.inject', Date.now() - _startMs, false);
        throw e;
    }

    let parsed;
    try {
        parsed = /** @type {Record<string, unknown>} */ (JSON.parse(body));
    } catch {
        const e = new BridgeError(
            `[inject-llmb] Resposta inválida do terminal (status ${statusCode}): ${body.slice(0, 200)}`,
            'LLM_B_INVALID_RESPONSE',
        );
        recordToolCall('channel.inject', Date.now() - _startMs, false);
        throw e;
    }

    if (statusCode === 409) {
        // Não registrar 409 como erro — é condição esperada de backpressure
        throw new BridgeError(
            '[inject-llmb] LLM-B está ocupada processando outra mensagem. Tente novamente em instantes.',
            'LLM_B_BUSY',
        );
    }

    if (statusCode === 503) {
        throw new BridgeError(
            '[inject-llmb] Terminal LLM-B não está disponível. Inicie com: npm run terminal:llm-b',
            'LLM_B_UNAVAILABLE',
        );
    }

    if (!parsed['ok']) {
        const e = new BridgeError(`[inject-llmb] Erro: ${parsed['error'] ?? 'desconhecido'}`, 'LLM_B_ERROR');
        recordToolCall('channel.inject', Date.now() - _startMs, false);
        throw e;
    }

    // F11.3: registrar latência por chamada bem-sucedida
    recordToolCall('channel.inject', Date.now() - _startMs);

    return {
        ok: true,
        reply: /** @type {string} */ (parsed['reply'] ?? ''),
        durationMs: /** @type {number} */ (parsed['durationMs'] ?? 0),
        from: /** @type {string} */ (parsed['from'] ?? from),
    };
}
/**
 * Aguarda até o terminal LLM-B estar pronto, com polling periódico.
 *
 * @param {{ maxWaitMs?: number; pollIntervalMs?: number; port?: number }} [opts]
 * @returns {Promise<void>}
 * @throws {BridgeError} Se o terminal não ficar pronto dentro do tempo máximo
 */
export async function waitForLlmBReady(opts = {}) {
    const maxWaitMs = opts.maxWaitMs ?? 30_000;
    const pollIntervalMs = opts.pollIntervalMs ?? 2_000;
    const port = opts.port ?? DEFAULT_PORT;
    const deadline = Date.now() + maxWaitMs;

    while (Date.now() < deadline) {
        const h = await checkLlmBHealth({ port });
        if (h.ready) return;
        await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    throw new BridgeError(`[inject-llmb] Terminal LLM-B não ficou pronto em ${maxWaitMs}ms.`, 'LLM_B_NOT_READY');
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
 * @throws {BridgeError} Se a resposta for inválida, LLM-B ocupada ou terminal indisponível
 */
export async function injectPipeline(steps, opts = {}) {
    const port = opts.port ?? DEFAULT_PORT;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS * steps.length;
    const from = opts.from ?? 'llm-a';

    const { statusCode, body } = await httpRequest('POST', '/pipeline', { steps, from }, port, timeoutMs);

    let parsed;
    try {
        parsed = /** @type {Record<string, unknown>} */ (JSON.parse(body));
    } catch {
        throw new BridgeError(
            `[inject-llmb] Resposta inválida do pipeline (status ${statusCode}): ${body.slice(0, 200)}`,
            'LLM_B_INVALID_RESPONSE',
        );
    }

    if (statusCode === 409) {
        throw new BridgeError(
            '[inject-llmb] LLM-B ocupada — pipeline abortado. Resultados parciais em parsed.results.',
            'LLM_B_BUSY',
        );
    }

    if (statusCode === 503) {
        throw new BridgeError(
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
