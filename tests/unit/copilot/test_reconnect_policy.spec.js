// @ts-check
/**
 * tests/unit/copilot/test_reconnect_policy.spec.js
 *
 * Testes unitários comportamentais para src/copilot/agent/reconnect-policy.js.
 *
 * Cobre (G1-DX-03):
 *
 * - backoff determinístico via jitterFn injetável
 * - reconexão bem-sucedida na primeira tentativa
 * - reconexão após N falhas
 * - esgotamento de tentativas emite session.fatal
 * - status `reconnecting:N/M` emitido em cada tentativa
 * - retorno false quando status é 'stopped'
 * - retorno false quando client é null
 * - dialog loop ativo: notifyReconnect + dialog.stopped emitidos após reconexão
 */

import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { tryReconnect as importedTryReconnect } from '../../../src/copilot/agent/lifecycle/reconnect-policy.js';

const tryReconnect = /** @type {any} */ (importedTryReconnect);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Cria callbacks mock para tryReconnect.
 *
 * @param {object} [overrides]
 */
function makeCallbacks(overrides = {}) {
    const emitted = /** @type {[string, any][]} */ ([]);
    /** @type {any} */
    const cbs = {
        /** @param {string} event @param {any} [payload] */
        emit: (event, payload) => emitted.push([event, payload]),
        initSession: async () => ({ session: { sessionId: 'sess-ok' }, isResumed: false }),
        dialogLoop: { active: false, notifyReconnect: () => {} },
        /** @param {(() => void)[]} _unsubs */
        clearSessionEventUnsubs: (_unsubs) => {},
        _emitted: emitted,
        ...overrides,
    };
    return cbs;
}

/**
 * Filtra eventos emitidos por nome.
 *
 * @param {[string, any][]} emitted
 * @param {string} name
 * @returns {[string, any][]}
 */
function filterEvents(emitted, name) {
    return emitted.filter((/** @type {[string, any]} */ [e]) => e === name);
}

/**
 * Localiza o primeiro evento emitido por nome.
 *
 * @param {[string, any][]} emitted
 * @param {string} name
 * @returns {[string, any] | undefined}
 */
function firstEvent(emitted, name) {
    return emitted.find((/** @type {[string, any]} */ [e]) => e === name);
}

/**
 * Opções comuns para testes determinísticos com delay mínimo.
 */
const FAST_OPTS = {
    baseDelayMs: 1,
    jitterFn: () => 0,
};

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('reconnect-policy › retorno imediato sem tentativas', () => {
    it('deve retornar false quando status é "stopped" sem tentar reconectar', async () => {
        const cbs = makeCallbacks();
        const result = await tryReconnect(new Error('err'), {}, 'stopped', cbs, FAST_OPTS);
        assert.strictEqual(result, false);
        assert.strictEqual(cbs._emitted.length, 0, 'Nenhum evento deve ser emitido se stopped');
    });

    it('deve retornar false quando client é null/falsy', async () => {
        const cbs = makeCallbacks();
        const result = await tryReconnect(new Error('err'), null, 'processing', cbs, FAST_OPTS);
        assert.strictEqual(result, false);
        assert.strictEqual(cbs._emitted.length, 0, 'Nenhum evento deve ser emitido se client nulo');
    });
});

describe('reconnect-policy › reconexão bem-sucedida', () => {
    it('deve retornar true na primeira tentativa bem-sucedida', async () => {
        const cbs = makeCallbacks();
        const result = await tryReconnect(new Error('rede caiu'), {}, 'idle', cbs, FAST_OPTS);
        assert.strictEqual(result, true);
    });

    it('deve emitir "ready" após reconexão bem-sucedida', async () => {
        const cbs = makeCallbacks();
        await tryReconnect(new Error('err'), {}, 'idle', cbs, FAST_OPTS);
        const ready = firstEvent(cbs._emitted, 'ready');
        assert.ok(ready, '"ready" deve ser emitido após reconexão bem-sucedida');
        assert.strictEqual(ready[1].sessionId, 'sess-ok');
    });

    it('chama onSessionReady antes de emitir ready para refazer boot wiring da sessão nova', async () => {
        /** @type {string[]} */
        const order = [];
        const cbs = makeCallbacks({
            emit: (/** @type {string} */ event, /** @type {any} */ payload) => {
                if (event === 'ready') order.push('ready');
                cbs._emitted.push([event, payload]);
            },
            onSessionReady: async () => {
                order.push('wire');
            },
        });

        await tryReconnect(new Error('err'), {}, 'idle', cbs, FAST_OPTS);

        assert.deepStrictEqual(order, ['wire', 'ready']);
    });

    it('deve emitir "status" com reconnecting:1/N na primeira tentativa', async () => {
        const cbs = makeCallbacks();
        await tryReconnect(new Error('err'), {}, 'idle', cbs, { ...FAST_OPTS, maxAttempts: 3 });
        const statuses = filterEvents(cbs._emitted, 'status').map((/** @type {[string, any]} */ [, p]) => p);
        assert.ok(
            statuses.includes('reconnecting:1/3'),
            `Status reconnecting:1/3 deve ter sido emitido. Emitidos: ${JSON.stringify(statuses)}`,
        );
    });

    it('deve criar novo client e chamar updateClient quando createClient é fornecido', async () => {
        /** @type {any[]} */
        const updatedClients = [];
        const originalClient = {
            stop: async () => {},
            ping: async () => {},
        };
        const replacementClient = {
            stop: async () => {},
            ping: async () => {},
            marker: 'replacement',
        };

        const cbs = makeCallbacks({
            createClient: () => replacementClient,
            updateClient: (/** @type {any} */ client) => updatedClients.push(client),
            initSession: async (/** @type {any} */ client) => {
                assert.strictEqual(client, replacementClient, 'initSession deve receber o client recém-criado');
                return { session: { sessionId: 'sess-new' }, isResumed: false };
            },
        });

        const result = await tryReconnect(new Error('err'), originalClient, 'idle', cbs, FAST_OPTS);

        assert.strictEqual(result, true);
        assert.deepEqual(updatedClients, [replacementClient]);
    });
});

describe('reconnect-policy › falhas parciais antes do sucesso', () => {
    it('deve tentar novamente após falha na primeira tentativa e ter sucesso na segunda', async () => {
        let attempts = 0;
        const cbs = makeCallbacks({
            initSession: async () => {
                attempts++;
                if (attempts < 2) throw new Error('tentativa 1 falhou');
                return { session: { sessionId: 'sess-2' }, isResumed: true };
            },
        });
        const result = await tryReconnect(new Error('inicial'), {}, 'idle', cbs, FAST_OPTS);
        assert.strictEqual(result, true);
        assert.strictEqual(attempts, 2, 'Deve ter tentado 2 vezes');

        const ready = firstEvent(cbs._emitted, 'ready');
        assert.ok(ready, '"ready" deve ser emitido após 2ª tentativa');
        assert.strictEqual(ready[1].sessionId, 'sess-2');
    });

    it('deve emitir status reconnecting:1/M e reconnecting:2/M quando 2 tentativas necessárias', async () => {
        let attempts = 0;
        const cbs = makeCallbacks({
            initSession: async () => {
                attempts++;
                if (attempts < 2) throw new Error('err');
                return { session: { sessionId: 's' }, isResumed: false };
            },
        });
        await tryReconnect(new Error('initial'), {}, 'idle', cbs, { ...FAST_OPTS, maxAttempts: 5 });
        const statuses = filterEvents(cbs._emitted, 'status').map((/** @type {[string, any]} */ [, p]) => p);
        assert.ok(statuses.includes('reconnecting:1/5'), 'Status 1/5 deve estar presente');
        assert.ok(statuses.includes('reconnecting:2/5'), 'Status 2/5 deve estar presente');
    });
});

describe('reconnect-policy › esgotamento de tentativas', () => {
    it('deve retornar false quando todas as tentativas falham', async () => {
        const cbs = makeCallbacks({
            initSession: async () => {
                throw new Error('sem rede');
            },
        });
        const result = await tryReconnect(new Error('initial'), {}, 'idle', cbs, { ...FAST_OPTS, maxAttempts: 2 });
        assert.strictEqual(result, false);
    });

    it('deve emitir "session.fatal" após esgotar tentativas', async () => {
        const cbs = makeCallbacks({
            initSession: async () => {
                throw new Error('falha permanente');
            },
        });
        await tryReconnect(new Error('original error'), {}, 'idle', cbs, { ...FAST_OPTS, maxAttempts: 2 });
        const fatal = firstEvent(cbs._emitted, 'session.fatal');
        assert.ok(fatal, '"session.fatal" deve ser emitido');
        assert.ok(
            fatal[1].originalError.includes('original error'),
            `originalError deve incluir a mensagem do erro inicial: "${fatal[1].originalError}"`,
        );
        assert.strictEqual(fatal[1].attempts, 2);
    });

    it('deve emitir status reconnecting:N/M para todas as N tentativas', async () => {
        const cbs = makeCallbacks({
            initSession: async () => {
                throw new Error('err');
            },
        });
        await tryReconnect(new Error('e'), {}, 'idle', cbs, { ...FAST_OPTS, maxAttempts: 3 });
        const statuses = filterEvents(cbs._emitted, 'status').map((/** @type {[string, any]} */ [, p]) => p);
        assert.ok(statuses.includes('reconnecting:1/3'));
        assert.ok(statuses.includes('reconnecting:2/3'));
        assert.ok(statuses.includes('reconnecting:3/3'));
        assert.strictEqual(statuses.length, 3, 'Deve ter exatamente 3 emissões de status');
    });
});

describe('reconnect-policy › dialog loop ativo durante reconexão', () => {
    it('deve chamar notifyReconnect se dialog loop estava ativo', async () => {
        let notified = false;
        const cbs = makeCallbacks({
            dialogLoop: {
                active: true,
                notifyReconnect: () => {
                    notified = true;
                },
            },
        });
        await tryReconnect(new Error('err'), {}, 'idle', cbs, FAST_OPTS);
        assert.ok(notified, 'notifyReconnect deve ser chamado se dialog loop estava ativo');
    });

    it('deve emitir "dialog.stopped" após reconexão com dialog loop ativo', async () => {
        const cbs = makeCallbacks({
            dialogLoop: { active: true, notifyReconnect: () => {} },
        });
        await tryReconnect(new Error('err'), {}, 'idle', cbs, FAST_OPTS);
        const dialogStopped = firstEvent(cbs._emitted, 'dialog.stopped');
        assert.ok(dialogStopped, '"dialog.stopped" deve ser emitido quando dialog loop estava ativo');
        assert.strictEqual(dialogStopped[1].reason, 'reconnect_restart');
        assert.strictEqual(dialogStopped[1].authorized, false);
    });

    it('não deve chamar notifyReconnect se dialog loop estava inativo', async () => {
        let notified = false;
        const cbs = makeCallbacks({
            dialogLoop: {
                active: false,
                notifyReconnect: () => {
                    notified = true;
                },
            },
        });
        await tryReconnect(new Error('err'), {}, 'idle', cbs, FAST_OPTS);
        assert.strictEqual(notified, false, 'notifyReconnect NÃO deve ser chamado se dialog loop inativo');
    });
});

describe('reconnect-policy › jitter determinístico (G1-DX-03)', () => {
    it('delay deve ser base * 2^(attempt-1) quando jitterFn retorna 0', async () => {
        const delays = /** @type {number[]} */ ([]);
        const origSetTimeout = globalThis.setTimeout;
        // Mock setTimeout para capturar delays sem aguardar
        globalThis.setTimeout = /** @type {any} */ (
            (/** @type {() => void} */ fn, /** @type {number} */ delay) => {
                delays.push(delay);
                return origSetTimeout(fn, 0); // executa imediatamente
            }
        );

        const cbs = makeCallbacks({
            initSession: async () => {
                if (delays.length === 0) throw new Error('still waiting for first timeout');
                return { session: { sessionId: 's' }, isResumed: false };
            },
        });

        try {
            await tryReconnect(new Error('e'), {}, 'idle', cbs, {
                baseDelayMs: 100,
                jitterFn: () => 0,
                maxAttempts: 3,
            });
        } finally {
            globalThis.setTimeout = origSetTimeout;
        }

        // delay da tentativa 1: 100 * 2^0 + 0 = 100ms
        assert.ok(delays.length >= 1, 'Pelo menos 1 setTimeout deve ter sido chamado');
        const firstDelay = delays[0];
        assert.ok(firstDelay !== undefined);
        assert.strictEqual(firstDelay, 100, `Delay da tentativa 1 deve ser 100ms, obtido: ${firstDelay}`);
    });
});

describe('reconnect-policy › M-01: ping health check pós-reconexão', () => {
    it('deve chamar client.ping() após initSession bem-sucedido', async () => {
        let pingCalled = false;
        const client = {
            stop: async () => {},
            ping: async () => {
                pingCalled = true;
            },
        };
        const cbs = makeCallbacks();
        await tryReconnect(new Error('err'), client, 'idle', cbs, FAST_OPTS);
        assert.ok(pingCalled, 'client.ping() deve ser chamado após reconexão');
    });

    it('deve descartar tentativa se ping() falhar e continuar tentando', async () => {
        let attempts = 0;
        let pingFails = 1; // falha na 1ª tentativa
        const client = {
            stop: async () => {},
            ping: async () => {
                if (pingFails > 0) {
                    pingFails--;
                    throw new Error('ping failed');
                }
            },
        };
        const cbs = makeCallbacks({
            initSession: async () => {
                attempts++;
                return { session: { sessionId: `sess-${attempts}` }, isResumed: false };
            },
        });
        const result = await tryReconnect(new Error('err'), client, 'idle', cbs, FAST_OPTS);
        assert.strictEqual(result, true);
        assert.strictEqual(attempts, 2, 'Deve tentar 2x pois ping falhou na 1ª');
    });

    it('deve funcionar normalmente se client não tem ping()', async () => {
        const client = { stop: async () => {} };
        const cbs = makeCallbacks();
        const result = await tryReconnect(new Error('err'), client, 'idle', cbs, FAST_OPTS);
        assert.strictEqual(result, true);
    });
});

describe('reconnect-policy › M-05: sessionLog callback', () => {
    it('deve chamar sessionLog após reconexão bem-sucedida', async () => {
        const logs = /** @type {string[]} */ ([]);
        const cbs = makeCallbacks();
        await tryReconnect(new Error('err'), {}, 'idle', cbs, {
            ...FAST_OPTS,
            sessionLog: async (/** @type {string} */ msg) => {
                logs.push(msg);
            },
        });
        assert.ok(logs.length > 0, 'sessionLog deve ter sido chamado');
        assert.ok(
            logs[0]?.includes('Reconexão bem-sucedida'),
            `Mensagem deve conter "Reconexão bem-sucedida": ${logs[0]}`,
        );
    });
});
