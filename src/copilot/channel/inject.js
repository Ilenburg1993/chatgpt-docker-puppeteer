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
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
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
 * @param {string} message - Mensagem a enviar para LLM-B
 * @param {InjectOpts} [opts]
 * @returns {Promise<InjectResult>}
 * @throws {Error} Se o terminal não estiver ativo, LLM-B ocupada, ou timeout excedido
 */
export async function injectToLlmB(message, opts = {}) {
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
    const port = opts.port ?? DEFAULT_PORT;
    let destroyed = false;

    const req = http.request(
        {
            hostname: '127.0.0.1',
            port,
            path: '/events',
            method: 'GET',
            headers: { Accept: 'text/event-stream' },
        },
        (res) => {
            let buf = '';
            res.on('data', (/** @type {Buffer} */ chunk) => {
                buf += chunk.toString();
                const lines = buf.split('\n');
                buf = lines.pop() ?? '';

                let currentEvent = '';
                for (const line of lines) {
                    if (line.startsWith('event:')) {
                        currentEvent = line.slice(6).trim();
                    } else if (line.startsWith('data:')) {
                        try {
                            const data = JSON.parse(line.slice(5).trim());
                            onEvent({ type: currentEvent || 'message', data });
                        } catch {
                            /* ignora JSON inválido */
                        }
                        currentEvent = '';
                    }
                }
            });
            res.on('error', () => {
                /* silencia erros de rede */
            });
        },
    );

    req.on('error', () => {
        /* silencia falha de conexão — terminal pode não estar ativo */
    });
    req.end();

    return {
        unsubscribe() {
            if (!destroyed) {
                destroyed = true;
                req.destroy();
            }
        },
    };
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
    const port = opts.port ?? DEFAULT_PORT;
    let destroyed = false;

    const req = http.request(
        {
            hostname: '127.0.0.1',
            port,
            path: '/events?level=critical',
            method: 'GET',
            headers: { Accept: 'text/event-stream' },
        },
        (res) => {
            let buf = '';
            res.on('data', (/** @type {Buffer} */ chunk) => {
                buf += chunk.toString();
                const lines = buf.split('\n');
                buf = lines.pop() ?? '';

                let currentEvent = '';
                for (const line of lines) {
                    if (line.startsWith('event:')) {
                        currentEvent = line.slice(6).trim();
                    } else if (line.startsWith('data:')) {
                        try {
                            const data = JSON.parse(line.slice(5).trim());
                            onEvent({ type: currentEvent || 'message', data });
                        } catch {
                            /* ignora JSON inválido */
                        }
                        currentEvent = '';
                    }
                }
            });
            res.on('error', () => {
                /* silencia erros de rede */
            });
        },
    );

    req.on('error', () => {
        /* silencia falha — terminal pode não estar ativo */
    });
    req.end();

    return {
        unsubscribe() {
            if (!destroyed) {
                destroyed = true;
                req.destroy();
            }
        },
    };
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
