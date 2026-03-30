// @ts-check
/**
 * src/copilot/channel/inject.js
 *
 * Canal oficial LLM-A → LLM-B — API de injeção de mensagens no terminal permanente.
 *
 * Usa o endpoint `POST /inject` do terminal-server.js ativo em `LLM_B_TERMINAL_PORT` (padrão: 3009). Este módulo é o
 * meio OFICIAL e recomendado para comunicação programática de LLM-A com LLM-B.
 *
 * @module copilot/channel/inject
 *
 * @example
 *     ```js
 *     import { injectToLlmB, checkLlmBHealth } from '#copilot/channel';
 *
 *     // Verificar se o terminal está ativo
 *     const { ok, ready } = await checkLlmBHealth();
 *     if (!ready) throw new Error('Terminal LLM-B não está pronto');
 *
 *     // Enviar mensagem e aguardar resposta
 *     const { reply, durationMs } = await injectToLlmB('Olá LLM-B!');
 *     console.log('Resposta:', reply); // ~15-20s
 *     ```;
 */

import { BridgeError } from '#copilot/core';
import { log } from '#core/logger';
import http from 'node:http';
import { LLM_B_TURN_TIMEOUT_MS } from '../core/constants.js';

/** Porta padrão do terminal LLM-B. */
const DEFAULT_PORT = Number(process.env.LLM_B_TERMINAL_PORT ?? 3009);

/** Timeout padrão para aguardar resposta (ms). */
const DEFAULT_TIMEOUT_MS = LLM_B_TURN_TIMEOUT_MS;

/**
 * @typedef {Object} InjectOpts
 * @property {string} [from] - ator remetente (default: 'llm-a')
 * @property {number} [timeoutMs] - timeout em ms (default: 130000)
 * @property {number} [port] - porta do terminal (default: LLM_B_TERMINAL_PORT ?? 3009)
 * @property {import('@github/copilot-sdk').MessageOptions['attachments']} [attachments] - Anexos (arquivos, imagens) a
 *   enviar junto com a mensagem
 * @property {number} [retries] - Tentativas automáticas em caso de 409 LLM_B_BUSY (default: 3; 0 = sem retry)
 * @property {number} [retryDelayMs] - Delay base entre tentativas em ms; multiplicado pelo número da tentativa (backoff
 *   linear, default: 1500)
 */

/**
 * @typedef {Object} InjectResult
 * @property {boolean} ok - true se a resposta foi obtida com sucesso
 * @property {string} reply - Resposta de LLM-B
 * @property {number} durationMs - Duração da chamada em ms
 * @property {string} from - Ator remetente
 */

/**
 * @typedef {Object} HealthResult
 * @property {boolean} ok - true se o servidor está acessível
 * @property {boolean} ready - true se o dialog loop está ativo
 * @property {boolean} busy - true se há turno em andamento
 * @property {string | null} hubSessionId - ID da hub_session ativa
 * @property {string} agentStatus - status do agente ('idle' | 'running' | 'stopped')
 */

// ─── Implementação ─────────────────────────────────────────────────────────────

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
        const parsed = /** @type {any} */ (JSON.parse(body));
        return {
            ok: parsed.ok === true,
            ready: parsed.dialogLoopActive === true,
            busy: parsed.busy === true,
            hubSessionId: parsed.hubSessionId ?? null,
            agentStatus: parsed.agentStatus ?? 'unknown',
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
 * INJECT-01: Em caso de 409 (LLM_B_BUSY), tenta automaticamente até `retries` vezes com backoff linear (default: 3
 * tentativas, 1.5s / 3s / 4.5s de espera). O comportamento é configurável via `opts.retries` e `opts.retryDelayMs`.
 *
 * @param {string} message - Mensagem a enviar para LLM-B
 * @param {InjectOpts} [opts]
 * @returns {Promise<InjectResult>}
 * @throws {Error} Se o terminal não estiver ativo, LLM-B ocupada após todas as tentativas, ou timeout excedido
 */
export async function injectToLlmB(message, opts = {}) {
    const maxRetries = opts.retries ?? 3;
    const retryDelayMs = opts.retryDelayMs ?? 1_500;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await _doInjectToLlmB(message, opts);
        } catch (/** @type {any} */ err) {
            const isBusy = err?.code === 'LLM_B_BUSY';
            if (isBusy && attempt < maxRetries) {
                const waitMs = retryDelayMs * (attempt + 1);
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
 */
async function _doInjectToLlmB(message, opts) {
    const port = opts.port ?? DEFAULT_PORT;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const from = opts.from ?? 'llm-a';
    const attachments = opts.attachments;

    const payload = { message, from, ...(attachments !== undefined ? { attachments } : {}) };
    const { statusCode, body } = await httpRequest('POST', '/inject', payload, port, timeoutMs);

    let parsed;
    try {
        parsed = /** @type {any} */ (JSON.parse(body));
    } catch {
        throw new BridgeError(
            `[inject-llmb] Resposta inválida do terminal (status ${statusCode}): ${body.slice(0, 200)}`,
            'LLM_B_INVALID_RESPONSE',
        );
    }

    if (statusCode === 409) {
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

    if (!parsed.ok) {
        throw new BridgeError(`[inject-llmb] Erro: ${parsed.error ?? 'desconhecido'}`, 'LLM_B_ERROR');
    }

    return {
        ok: true,
        reply: parsed.reply ?? '',
        durationMs: parsed.durationMs ?? 0,
        from: parsed.from ?? from,
    };
}

/**
 * Aguarda até o terminal LLM-B estar pronto, com polling periódico.
 *
 * @param {{ maxWaitMs?: number; pollIntervalMs?: number; port?: number }} [opts]
 * @returns {Promise<void>}
 * @throws {Error} Se o terminal não ficar pronto dentro do tempo máximo
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

/**
 * @typedef {Object} SseEvent
 * @property {string} type - tipo do evento SSE ('reply' | 'ready' | 'stalled')
 * @property {any} data - payload JSON do evento
 */

/**
 * @callback SseHandler
 * @param {SseEvent} event
 * @returns {void}
 */

/**
 * Helper interno: conecta ao endpoint SSE do terminal-server e entrega eventos ao callback. MR-09 (fix): reconecta
 * automaticamente com backoff exponencial quando a conexão cai.
 *
 * @param {string} path - Path do endpoint, ex: '/events' ou '/events?level=critical'
 * @param {number} port
 * @param {SseHandler} onEvent
 * @returns {{ unsubscribe: () => void }}
 */
function _subscribeSse(path, port, onEvent) {
    let destroyed = false;
    // MR-09: controle de reconexão — backoff exponencial entre 1s e 30s
    let reconnectMs = 1_000;
    const MAX_RECONNECT_MS = 30_000;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let reconnectTimer = null;
    /** @type {ReturnType<typeof http.request> | null} */
    let currentReq = null;

    function connect() {
        if (destroyed) return;

        const req = http.request(
            {
                hostname: '127.0.0.1',
                port,
                path,
                method: 'GET',
                headers: { Accept: 'text/event-stream' },
            },
            (res) => {
                // Reconexão bem-sucedida — resetar backoff
                reconnectMs = 1_000;
                let buf = '';
                res.on('data', (/** @type {Buffer} */ chunk) => {
                    buf += chunk.toString();
                    // SSE-INJECT-01 (fix): parsear por blocos delimitados por linha vazia (RFC 8895).
                    // Múltiplas linhas data: num mesmo bloco são acumuladas e concatenadas com \n.
                    const blocks = buf.split(/\r?\n\r?\n/);
                    buf = blocks.pop() ?? '';

                    for (const block of blocks) {
                        if (!block.trim()) continue;
                        let currentEvent = '';
                        const dataLines = /** @type {string[]} */ ([]);
                        for (const line of block.split(/\r?\n/)) {
                            if (line.startsWith('event:')) {
                                currentEvent = line.slice(6).trim();
                            } else if (line.startsWith('data:')) {
                                dataLines.push(line.slice(5).trimStart());
                            }
                            // ignorar linhas 'id:' e 'retry:' — não usadas por este parser
                        }
                        if (dataLines.length > 0) {
                            try {
                                const data = JSON.parse(dataLines.join('\n'));
                                onEvent({ type: currentEvent || 'message', data });
                            } catch {
                                /* ignora JSON inválido */
                            }
                        }
                    }
                });
                res.on('close', () => {
                    if (!destroyed) scheduleReconnect();
                });
                res.on('error', () => {
                    if (!destroyed) scheduleReconnect();
                });
            },
        );
        currentReq = req;

        req.on('error', () => {
            if (!destroyed) scheduleReconnect();
        });
        req.end();
    }

    function scheduleReconnect() {
        if (destroyed || reconnectTimer !== null) return;
        log('DEBUG', `[inject] SSE desconectado (${path}) — reconectando em ${reconnectMs}ms`);
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            connect();
        }, reconnectMs);
        // Backoff exponencial: 1s → 2s → 4s → ... → 30s (teto)
        reconnectMs = Math.min(reconnectMs * 2, MAX_RECONNECT_MS);
    }

    // Conectar imediatamente
    connect();

    return {
        unsubscribe() {
            if (!destroyed) {
                destroyed = true;
                if (reconnectTimer !== null) {
                    clearTimeout(reconnectTimer);
                    reconnectTimer = null;
                }
                currentReq?.destroy();
                currentReq = null;
            }
        },
    };
}

/**
 * Subscreve ao canal SSE de eventos da LLM-B (canal P3: LLM-A observa LLM-B em tempo real).
 *
 * Conecta ao endpoint `GET /events` do terminal-server. Chame `unsubscribe()` no objeto retornado para desconectar.
 *
 * @example
 *     ```js
 *     const sub = subscribeLlmB((evt) => {
 *         if (evt.type === 'reply') console.log('LLM-B respondeu:', evt.data.content);
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
    return _subscribeSse('/events', opts.port ?? DEFAULT_PORT, onEvent);
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
    return _subscribeSse('/events?level=critical', opts.port ?? DEFAULT_PORT, onEvent);
}

/**
 * @typedef {Object} PipelineStep
 * @property {string} prompt - Mensagem a enviar neste step
 * @property {number} [waitMs] - Espera em ms antes de enviar (padrão: 0)
 * @property {string} [from] - Ator override para este step
 */

/**
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
 * @throws {Error} Se o terminal não estiver ativo ou timeout excedido
 */
export async function injectPipeline(steps, opts = {}) {
    const port = opts.port ?? DEFAULT_PORT;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS * steps.length;
    const from = opts.from ?? 'llm-a';

    const { statusCode, body } = await httpRequest('POST', '/pipeline', { steps, from }, port, timeoutMs);

    let parsed;
    try {
        parsed = /** @type {any} */ (JSON.parse(body));
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
        ok: parsed.ok === true,
        results: parsed.results ?? [],
    };
}
