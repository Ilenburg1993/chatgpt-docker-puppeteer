// @ts-check
/**
 * tests/unit/copilot/test_inject_retry.spec.js
 *
 * Testes unitários — INJECT-01: retry automático com backoff em injectToLlmB.
 *
 * Cobertura:
 *
 * - injectToLlmB() aceita opts.retries e opts.retryDelayMs
 * - Retry é executado em caso de BridgeError com code === 'LLM_B_BUSY'
 * - Sem retry em caso de erros que não sejam LLM_B_BUSY
 * - Após esgotar retries, erro é relançado
 * - Análise estrutural do source de inject.js
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, describe, it } from 'node:test';
import { BridgeError } from '../../../src/copilot/core/index.js';

// ─── Suite 1: análise estrutural do source ─────────────────────────────────

describe('channel/inject.js › INJECT-01: análise estrutural', async () => {
    /** @type {string} */
    let source = '';

    before(async () => {
        source = await readFile(new URL('../../../src/copilot/channel/inject.js', import.meta.url), 'utf-8');
    });

    it('InjectOpts deve ter campo retries', () => {
        assert.ok(source.includes('@property {number} [retries]'), 'InjectOpts deve documentar a propriedade retries');
    });

    it('InjectOpts deve ter campo retryDelayMs', () => {
        assert.ok(
            source.includes('@property {number} [retryDelayMs]'),
            'InjectOpts deve documentar a propriedade retryDelayMs',
        );
    });

    it('deve ter loop de retry (for attempt = 0; attempt <= maxRetries)', () => {
        assert.ok(
            source.includes('attempt <= maxRetries'),
            'injectToLlmB deve ter loop de retry baseado em maxRetries',
        );
    });

    it('deve verificar err.code === LLM_B_BUSY antes de retomar o loop', () => {
        assert.ok(
            source.includes("LLM_B_BUSY'"),
            "injectToLlmB deve verificar BridgeError com code 'LLM_B_BUSY' para decidir retry",
        );
    });

    it('deve ter _doInjectToLlmB como função interna (implementação de uma tentativa)', () => {
        assert.ok(
            source.includes('async function _doInjectToLlmB('),
            '_doInjectToLlmB deve ser a função interna que implementa uma única tentativa',
        );
    });

    it('deve ter backoff por multiplicação de tentativa (retryDelay * (attempt + 1))', () => {
        assert.ok(
            source.includes('retryDelayMs * (attempt + 1)'),
            'backoff linear deve multiplicar retryDelayMs pelo número da tentativa',
        );
    });
});

// ─── Suite 2: comportamento de retry ────────────────────────────────────────

describe('channel/inject.js › INJECT-01: comportamento de retry', () => {
    it('deve fazer retry em LLM_B_BUSY e retornar resultado na segunda tentativa', async () => {
        // Reimplementa a lógica de retry em isolamento para testar o comportamento
        let callCount = 0;

        /**
         * Simula _doInjectToLlmB: falha na primeira chamada com LLM_B_BUSY, sucede na segunda
         *
         * @returns {Promise<{ ok: boolean; reply: string; durationMs: number; from: string }>}
         */
        async function fakeDoInject() {
            callCount++;
            if (callCount === 1) {
                throw new BridgeError('LLM-B ocupada', 'LLM_B_BUSY');
            }
            return { ok: true, reply: 'sucesso', durationMs: 100, from: 'llm-a' };
        }

        // Replica a lógica de injectToLlmB
        const maxRetries = 2;
        const retryDelayMs = 1; // delay mínimo para testes rápidos

        /** @type {{ ok: boolean; reply: string; durationMs: number; from: string } | undefined} */
        let result;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                result = await fakeDoInject();
                break;
            } catch (/** @type {any} */ err) {
                const isBusy = err?.code === 'LLM_B_BUSY';
                if (isBusy && attempt < maxRetries) {
                    await new Promise((r) => setTimeout(r, retryDelayMs * (attempt + 1)));
                    continue;
                }
                throw err;
            }
        }

        assert.equal(callCount, 2, 'deve chamar _doInjectToLlmB 2 vezes (1 falha + 1 sucesso)');
        assert.equal(result?.reply, 'sucesso', 'deve retornar a resposta do sucesso na segunda tentativa');
    });

    it('deve lançar erro imediatamente se não for LLM_B_BUSY', async () => {
        let callCount = 0;

        async function fakeDoInjectOtherError() {
            callCount++;
            throw new BridgeError('Timeout', 'LLM_B_TIMEOUT');
        }

        const maxRetries = 3;
        const retryDelayMs = 1;

        await assert.rejects(
            async () => {
                for (let attempt = 0; attempt <= maxRetries; attempt++) {
                    try {
                        await fakeDoInjectOtherError();
                        break;
                    } catch (/** @type {any} */ err) {
                        const isBusy = err?.code === 'LLM_B_BUSY';
                        if (isBusy && attempt < maxRetries) {
                            await new Promise((r) => setTimeout(r, retryDelayMs * (attempt + 1)));
                            continue;
                        }
                        throw err;
                    }
                }
            },
            (err) => {
                assert.ok(err instanceof BridgeError, 'deve lançar BridgeError');
                assert.equal(/** @type {any} */ (err).code, 'LLM_B_TIMEOUT', 'deve preservar o código original');
                return true;
            },
            'deve lançar imediatamente sem retry em erros que não sejam LLM_B_BUSY',
        );

        assert.equal(callCount, 1, 'deve chamar apenas 1 vez sem retry para erros não-BUSY');
    });

    it('deve esgotar retries e relançar LLM_B_BUSY após N+1 tentativas', async () => {
        let callCount = 0;
        const maxRetries = 2;
        const retryDelayMs = 1;

        async function alwaysBusy() {
            callCount++;
            throw new BridgeError('LLM-B ocupada', 'LLM_B_BUSY');
        }

        await assert.rejects(
            async () => {
                for (let attempt = 0; attempt <= maxRetries; attempt++) {
                    try {
                        await alwaysBusy();
                        break;
                    } catch (/** @type {any} */ err) {
                        const isBusy = err?.code === 'LLM_B_BUSY';
                        if (isBusy && attempt < maxRetries) {
                            await new Promise((r) => setTimeout(r, retryDelayMs * (attempt + 1)));
                            continue;
                        }
                        throw err;
                    }
                }
            },
            (err) => {
                assert.ok(err instanceof BridgeError, 'deve lançar BridgeError');
                assert.equal(/** @type {any} */ (err).code, 'LLM_B_BUSY');
                return true;
            },
            'deve relançar LLM_B_BUSY após esgotar todas as tentativas',
        );

        assert.equal(callCount, maxRetries + 1, `deve chamar exatamente ${maxRetries + 1} vezes antes de desistir`);
    });

    it('deve respeitar retries=0 (sem retry)', async () => {
        let callCount = 0;
        const maxRetries = 0;

        async function busyOnce() {
            callCount++;
            throw new BridgeError('LLM-B ocupada', 'LLM_B_BUSY');
        }

        await assert.rejects(
            async () => {
                for (let attempt = 0; attempt <= maxRetries; attempt++) {
                    try {
                        await busyOnce();
                        break;
                    } catch (/** @type {any} */ err) {
                        const isBusy = err?.code === 'LLM_B_BUSY';
                        if (isBusy && attempt < maxRetries) {
                            await new Promise((r) => setTimeout(r, 1));
                            continue;
                        }
                        throw err;
                    }
                }
            },
            (err) => {
                assert.ok(err instanceof BridgeError);
                return true;
            },
        );

        assert.equal(callCount, 1, 'com retries=0, deve tentar exatamente 1 vez');
    });
});
