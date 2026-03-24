// @ts-check
/**
 * src/copilot/inject-llmb.js
 *
 * Canal oficial LLM-A → LLM-B — API de injeção de mensagens no terminal permanente.
 *
 * Usa o endpoint `POST /inject` do terminal-server.js ativo em `LLM_B_TERMINAL_PORT` (padrão: 3009). Este módulo é o
 * meio OFICIAL e recomendado para comunicação programática de LLM-A com LLM-B.
 *
 * @module copilot/inject-llmb
 *
 * @example
 *     ```js
 *     import { injectToLlmB, checkLlmBHealth } from '#copilot/inject-llmb';
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

import http from 'node:http';

/** Porta padrão do terminal LLM-B. */
const DEFAULT_PORT = Number(process.env.LLM_B_TERMINAL_PORT ?? 3009);

/** Timeout padrão para aguardar resposta (ms). */
const DEFAULT_TIMEOUT_MS = Number(process.env.LLM_B_TURN_TIMEOUT ?? 130_000);

/**
 * @typedef {Object} InjectOpts
 * @property {string} [from] - ator remetente (default: 'llm-a')
 * @property {number} [timeoutMs] - timeout em ms (default: 130000)
 * @property {number} [port] - porta do terminal (default: LLM_B_TERMINAL_PORT ?? 3009)
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
            req.destroy(new Error(`Timeout após ${timeoutMs}ms aguardando LLM-B`));
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

    const { statusCode, body } = await httpRequest('POST', '/inject', { message, from }, port, timeoutMs);

    let parsed;
    try {
        parsed = /** @type {any} */ (JSON.parse(body));
    } catch {
        throw new Error(`[inject-llmb] Resposta inválida do terminal (status ${statusCode}): ${body.slice(0, 200)}`);
    }

    if (statusCode === 409) {
        throw new Error('[inject-llmb] LLM-B está ocupada processando outra mensagem. Tente novamente em instantes.');
    }

    if (statusCode === 503) {
        throw new Error('[inject-llmb] Terminal LLM-B não está disponível. Inicie com: npm run terminal:llm-b');
    }

    if (!parsed.ok) {
        throw new Error(`[inject-llmb] Erro: ${parsed.error ?? 'desconhecido'}`);
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

    throw new Error(`[inject-llmb] Terminal LLM-B não ficou pronto em ${maxWaitMs}ms.`);
}
