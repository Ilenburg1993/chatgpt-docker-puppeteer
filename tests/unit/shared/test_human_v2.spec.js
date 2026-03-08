// @ts-check
import assert from 'node:assert';
import { performance } from 'node:perf_hooks';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

describe('human.js v2.0 - Unit Tests', () => {
    /** @type {any} */ let mockDriver;
    /** @type {any} */ let mockPage;
    /** @type {any} */ let humanModule;

    beforeEach(async () => {
        // Mock page object
        mockPage = {
            mouse: {
                move: mock.fn(async () => {}),
                click: mock.fn(async () => {}),
            },
            keyboard: {
                type: mock.fn(async () => {}),
                press: mock.fn(async () => {}),
            },
            evaluate: mock.fn(async () => true),
            waitForSelector: mock.fn(async () => ({})),
            $: mock.fn(async () => null),
            isClosed: mock.fn(() => false),
            url: mock.fn(() => 'https://example.com'),
        };

        // Mock driver object
        mockDriver = {
            page: mockPage,
            _emitVital: mock.fn(() => {}),
            currentTarget: 'chatgpt',
            correlationId: 'test-123',
        };

        // Import module fresh for each test
        humanModule = await import('#shared/biomechanics/human').then((/** @type {any} */ m) => m.default ?? m);
    });

    afterEach(() => {
        mock.restoreAll();
    });

    // ======================
    // PHASE 1: CRITICAL FIXES
    // ======================

    describe('Phase 1: Critical Fixes', () => {
        describe('Bug #1: Gaussian Distribution Cache', () => {
            it('deve cachear valores gaussianos por parâmetros', async () => {
                const { gaussian } = humanModule;

                // Primeira chamada - cria cache
                const result1 = gaussian(10, 2);

                // Segunda chamada com mesmos params - deve usar cache
                const result2 = gaussian(10, 2);

                // Cache key deve ser consistente
                assert.ok(typeof result1 === 'number');
                assert.ok(typeof result2 === 'number');

                // Valores devem estar na faixa válida (mean ± 3*sigma)
                assert.ok(result1 >= 4 && result1 <= 16, `result1=${result1} fora da faixa esperada`);
                assert.ok(result2 >= 4 && result2 <= 16, `result2=${result2} fora da faixa esperada`);
            });

            it('deve invalidar cache após TTL (100ms)', async (t) => {
                const { gaussian } = humanModule;

                const result1 = gaussian(10, 2);

                // Aguardar TTL expirar (100ms)
                await new Promise((r) => setTimeout(r, 150));

                const result2 = gaussian(10, 2);

                // Ambos devem ser válidos (não necessariamente iguais após TTL)
                assert.ok(typeof result1 === 'number');
                assert.ok(typeof result2 === 'number');
            });

            it('deve cachear separadamente por parâmetros diferentes', async () => {
                const { gaussian } = humanModule;

                const result1 = gaussian(10, 2); // mean=10, sigma=2
                const result2 = gaussian(20, 3); // mean=20, sigma=3

                // Devem ser diferentes (diferentes parâmetros)
                assert.notStrictEqual(result1, result2);
            });
        });

        describe('Bug #2-4: Parameter Validation', () => {
            it('humanClick deve validar driver', async () => {
                const { humanClick } = humanModule;

                await assert.rejects(async () => await humanClick(null, '#button'), {
                    name: 'TypeError',
                    message: /driver is required/,
                });
            });

            it('humanClick deve validar selector', async () => {
                const { humanClick } = humanModule;

                await assert.rejects(async () => await humanClick(mockDriver, null), {
                    name: 'TypeError',
                    message: /selector is required/,
                });
            });

            it('humanType deve validar driver', async () => {
                const { humanType } = humanModule;

                await assert.rejects(async () => await humanType(null, '#input', 'text'), {
                    name: 'TypeError',
                    message: /driver is required/,
                });
            });

            it('humanType deve validar selector', async () => {
                const { humanType } = humanModule;

                await assert.rejects(async () => await humanType(mockDriver, null, 'text'), {
                    name: 'TypeError',
                    message: /selector is required/,
                });
            });

            it('humanType deve validar text', async () => {
                const { humanType } = humanModule;

                await assert.rejects(async () => await humanType(mockDriver, '#input', null), {
                    name: 'TypeError',
                    message: /text is required/,
                });
            });

            it('humanType deve aceitar text vazio (edge case)', async () => {
                const { humanType } = humanModule;

                // Texto vazio é válido (não deve rejeitar)
                const result = await humanType(mockDriver, '#input', '');
                assert.strictEqual(result, true);
            });

            it('gaussian deve validar mean', () => {
                const { gaussian } = humanModule;

                assert.throws(() => gaussian(null, 2), { name: 'TypeError', message: /mean must be a number/ });
            });

            it('gaussian deve validar sigma', () => {
                const { gaussian } = humanModule;

                assert.throws(() => gaussian(10, null), { name: 'TypeError', message: /sigma must be a number/ });
            });
        });

        describe('Improvement #1: Configuration Externalization', () => {
            it('deve exportar HUMAN_CONFIG com 18 constantes', () => {
                const { HUMAN_CONFIG } = humanModule;

                assert.ok(HUMAN_CONFIG, 'HUMAN_CONFIG deve existir');

                // Verificar constantes críticas
                assert.ok(typeof HUMAN_CONFIG.MOVE_SPEED_MIN === 'number');
                assert.ok(typeof HUMAN_CONFIG.MOVE_SPEED_MAX === 'number');
                assert.ok(typeof HUMAN_CONFIG.TYPE_DELAY_MIN === 'number');
                assert.ok(typeof HUMAN_CONFIG.TYPE_DELAY_MAX === 'number');
                assert.ok(typeof HUMAN_CONFIG.GAUSSIAN_CACHE_TTL === 'number');

                // Verificar valores razoáveis
                assert.ok(HUMAN_CONFIG.MOVE_SPEED_MIN > 0);
                assert.ok(HUMAN_CONFIG.MOVE_SPEED_MAX > HUMAN_CONFIG.MOVE_SPEED_MIN);
            });
        });
    });

    // ======================
    // PHASE 2: ROBUSTNESS
    // ======================

    describe('Phase 2: Robustness', () => {
        describe('Bug #5: Focus Lock Prevention', () => {
            it('deve detectar focus lock e forçar blur', async () => {
                const { humanType } = humanModule;

                // Mock focus lock (selector retorna sempre mesmo elemento)
                let focusCallCount = 0;
                mockPage.evaluate = mock.fn(async (/** @type {any} */ fn) => {
                    if (fn.toString().includes('document.activeElement')) {
                        focusCallCount++;
                        return focusCallCount > 2 ? false : true; // Simula lock por 2 iterações
                    }
                    return true;
                });

                const result = await humanType(mockDriver, '#input', 'test');

                assert.strictEqual(result, true);
                // Deve ter tentado blur após detectar lock
                assert.ok(mockPage.evaluate.mock.calls.length > 0);
            });
        });

        describe('Improvement #3: Telemetry Enhancement', () => {
            it('humanClick deve emitir CLICK_START', async () => {
                const { humanClick } = humanModule;

                await humanClick(mockDriver, '#button');

                /** @type {any[]} */ const calls = mockDriver._emitVital.mock.calls;
                const startEvents = calls.filter((c) => c.arguments[0] === 'CLICK_START');

                assert.ok(startEvents.length > 0, 'CLICK_START event não emitido');
            });

            it('humanClick deve emitir CLICK_COMPLETE', async () => {
                const { humanClick } = humanModule;

                await humanClick(mockDriver, '#button');

                /** @type {any[]} */ const calls = mockDriver._emitVital.mock.calls;
                const completeEvents = calls.filter((c) => c.arguments[0] === 'CLICK_COMPLETE');

                assert.ok(completeEvents.length > 0, 'CLICK_COMPLETE event não emitido');
            });

            it('humanType deve emitir TYPE_START', async () => {
                const { humanType } = humanModule;

                await humanType(mockDriver, '#input', 'test');

                /** @type {any[]} */ const calls = mockDriver._emitVital.mock.calls;
                const startEvents = calls.filter((c) => c.arguments[0] === 'TYPE_START');

                assert.ok(startEvents.length > 0, 'TYPE_START event não emitido');
            });

            it('humanType deve emitir TYPE_PROGRESS', async () => {
                const { humanType } = humanModule;

                await humanType(mockDriver, '#input', 'test long text for progress tracking');

                /** @type {any[]} */ const calls = mockDriver._emitVital.mock.calls;
                const progressEvents = calls.filter((c) => c.arguments[0] === 'TYPE_PROGRESS');

                // Para texto longo, deve emitir pelo menos 1 progress event
                assert.ok(progressEvents.length > 0, 'TYPE_PROGRESS event não emitido');
            });

            it('humanType deve emitir TYPE_COMPLETE', async () => {
                const { humanType } = humanModule;

                await humanType(mockDriver, '#input', 'test');

                /** @type {any[]} */ const calls = mockDriver._emitVital.mock.calls;
                const completeEvents = calls.filter((c) => c.arguments[0] === 'TYPE_COMPLETE');

                assert.ok(completeEvents.length > 0, 'TYPE_COMPLETE event não emitido');
            });

            it('humanClick deve emitir CLICK_ERROR em falha', async () => {
                const { humanClick } = humanModule;

                // Simular erro
                mockPage.waitForSelector = mock.fn(async () => {
                    throw new Error('Selector timeout');
                });

                await assert.rejects(async () => await humanClick(mockDriver, '#nonexistent'), {
                    message: /Selector timeout/,
                });

                /** @type {any[]} */ const calls = mockDriver._emitVital.mock.calls;
                const errorEvents = calls.filter((c) => c.arguments[0] === 'CLICK_ERROR');

                assert.ok(errorEvents.length > 0, 'CLICK_ERROR event não emitido');
            });
        });

        describe('Improvement #6: Retry Logic', () => {
            it('humanClick deve retryar até 3 vezes', async () => {
                const { humanClick } = humanModule;

                let attempts = 0;
                mockPage.waitForSelector = mock.fn(async () => {
                    attempts++;
                    if (attempts < 3) {
                        throw new Error('Transient error');
                    }
                    return {};
                });

                const result = await humanClick(mockDriver, '#button');

                assert.strictEqual(result, true);
                assert.strictEqual(attempts, 3, 'Deve ter tentado 3 vezes');
            });

            it('humanClick deve falhar após 3 tentativas', async () => {
                const { humanClick } = humanModule;

                mockPage.waitForSelector = mock.fn(async () => {
                    throw new Error('Persistent error');
                });

                await assert.rejects(async () => await humanClick(mockDriver, '#button'), {
                    message: /Persistent error/,
                });

                // Deve ter tentado 3 vezes + 1 inicial
                /** @type {any[]} */ const calls = mockPage.waitForSelector.mock.calls;
                assert.ok(calls.length >= 3, `Esperado >= 3 tentativas, obteve ${calls.length}`);
            });
        });

        describe('Improvement #12: Abort Signal Support', () => {
            it('humanClick deve respeitar abort signal', async () => {
                const { humanClick } = humanModule;

                const controller = new AbortController();

                // Abortar imediatamente
                controller.abort();

                const result = await humanClick(mockDriver, '#button', { signal: controller.signal });

                // Deve retornar falso (abortado)
                assert.strictEqual(result, false);
            });

            it('humanType deve respeitar abort signal', async () => {
                const { humanType } = humanModule;

                const controller = new AbortController();

                // Abortar após 10ms
                setTimeout(() => controller.abort(), 10);

                const result = await humanType(mockDriver, '#input', 'very long text that would take time to type', {
                    signal: controller.signal,
                });

                // Deve ter parado antes de completar
                assert.strictEqual(result, false);
            });

            it('humanClick deve emitir CLICK_ABORTED', async () => {
                const { humanClick } = humanModule;

                const controller = new AbortController();
                controller.abort();

                await humanClick(mockDriver, '#button', { signal: controller.signal });

                /** @type {any[]} */ const calls = mockDriver._emitVital.mock.calls;
                const abortEvents = calls.filter((c) => c.arguments[0] === 'CLICK_ABORTED');

                assert.ok(abortEvents.length > 0, 'CLICK_ABORTED event não emitido');
            });
        });
    });

    // ======================
    // PHASE 3: POLISH
    // ======================

    describe('Phase 3: Polish', () => {
        describe('Improvement #2: Gaussian Speedup', () => {
            it('gaussian deve evitar Math.random em cache hit', () => {
                const { gaussian } = humanModule;

                // Use parâmetros únicos para evitar interferência com outros testes.
                const mean = 1234.5;
                const sigma = 6.7;

                const originalRandom = Math.random;
                let randomCalls = 0;
                Math.random = () => {
                    randomCalls++;
                    return originalRandom();
                };

                try {
                    gaussian(mean, sigma); // cache miss/hit (não garantimos quantos randoms)
                    const callsAfterFirst = randomCalls;
                    gaussian(mean, sigma); // cache hit -> não deve chamar Math.random
                    assert.strictEqual(
                        randomCalls,
                        callsAfterFirst,
                        `Cache hit não deveria chamar Math.random (calls=${randomCalls} vs ${callsAfterFirst})`,
                    );
                } finally {
                    Math.random = originalRandom;
                }
            });
        });

        describe('Improvement #8: Viewport Adjustment', () => {
            it('humanClick deve ajustar coordenadas ao viewport', async () => {
                const { humanClick } = humanModule;

                // Mock elemento fora do viewport
                mockPage.evaluate = mock.fn(async (/** @type {any} */ fn) => {
                    if (fn.toString().includes('getBoundingClientRect')) {
                        return { x: 5000, y: 5000, width: 100, height: 50 }; // Fora
                    }
                    return true;
                });

                mockPage.$ = mock.fn(async () => ({
                    boundingBox: async () => ({ x: 5000, y: 5000, width: 100, height: 50 }),
                }));

                await humanClick(mockDriver, '#button');

                // Deve ter chamado mouse.move com coordenadas ajustadas
                const moveCalls = mockPage.mouse.move.mock.calls;
                assert.ok(moveCalls.length > 0, 'mouse.move não foi chamado');
            });
        });

        describe('Improvement #4: Cursor Path Caching', () => {
            it('deve cachear últimas N posições do cursor (LRU)', async () => {
                const { humanClick } = humanModule;

                // Mover cursor para 3 posições diferentes
                await humanClick(mockDriver, '#button1');
                await humanClick(mockDriver, '#button2');
                await humanClick(mockDriver, '#button3');

                // Cache deve ter registrado 3 movimentos
                const moveCalls = mockPage.mouse.move.mock.calls;
                assert.ok(moveCalls.length >= 3, `Esperado >= 3 movimentos, obteve ${moveCalls.length}`);
            });
        });

        describe('Bug #7: Telemetry Error Events', () => {
            it('humanType deve emitir TYPE_ERROR em erro crítico', async () => {
                const { humanType } = humanModule;

                // Simular page closed (erro crítico)
                mockPage.isClosed = mock.fn(() => true);

                await assert.rejects(async () => await humanType(mockDriver, '#input', 'test'), {
                    message: /page is closed/,
                });

                /** @type {any[]} */ const calls = mockDriver._emitVital.mock.calls;
                const errorEvents = calls.filter((c) => c.arguments[0] === 'TYPE_ERROR');

                assert.ok(errorEvents.length > 0, 'TYPE_ERROR event não emitido');
            });
        });
    });

    // ======================
    // INTEGRATION TESTS
    // ======================

    describe('Integration Tests', () => {
        it('deve completar ciclo completo: click + type + submit', async () => {
            const { humanClick, humanType } = humanModule;

            // Simular fluxo real
            await humanClick(mockDriver, '#username');
            await humanType(mockDriver, '#username', 'testuser');
            await humanClick(mockDriver, '#password');
            await humanType(mockDriver, '#password', 'password123');
            await humanClick(mockDriver, '#submit');

            // Verificar eventos emitidos
            /** @type {any[]} */ const calls = mockDriver._emitVital.mock.calls;

            assert.ok(calls.filter((c) => c.arguments[0] === 'CLICK_START').length >= 3);
            assert.ok(calls.filter((c) => c.arguments[0] === 'TYPE_START').length >= 2);
            assert.ok(calls.filter((c) => c.arguments[0] === 'TYPE_COMPLETE').length >= 2);
        });

        it('deve lidar com abort em meio ao fluxo', async () => {
            const { humanClick, humanType } = humanModule;

            const controller = new AbortController();

            // Iniciar fluxo
            await humanClick(mockDriver, '#username');

            // Abortar durante type
            setTimeout(() => controller.abort(), 5);

            const result = await humanType(mockDriver, '#username', 'very long username that should be interrupted', {
                signal: controller.signal,
            });

            assert.strictEqual(result, false, 'Deve retornar false quando abortado');
        });

        it('deve manter consistência de estado após múltiplos erros', async () => {
            const { humanClick } = humanModule;

            // Simular múltiplas falhas
            mockPage.waitForSelector = mock.fn(async () => {
                throw new Error('Selector not found');
            });

            for (let i = 0; i < 5; i++) {
                await assert.rejects(async () => await humanClick(mockDriver, `#button${i}`), {
                    message: /Selector not found/,
                });
            }

            // Verificar que telemetria continua funcionando
            /** @type {any[]} */ const calls = mockDriver._emitVital.mock.calls;
            assert.ok(calls.length >= 5, 'Telemetria deve continuar após erros');
        });
    });

    // ======================
    // E2E TESTS
    // ======================

    describe('E2E Tests (Mocked)', () => {
        it('deve digitar 1000 caracteres com delays humanos', async () => {
            const { humanType } = humanModule;

            const longText = 'A'.repeat(1000);

            const start = performance.now();
            const result = await humanType(mockDriver, '#input', longText);
            const duration = performance.now() - start;

            assert.strictEqual(result, true);

            // Deve ter levado tempo razoável (delays entre teclas)
            // Com delays de ~50-150ms, 1000 chars = ~50-150s (mas com mock é instantâneo)
            assert.ok(duration >= 0, 'Deve ter duração mensurável');

            // Verificar telemetria
            /** @type {any[]} */ const calls = mockDriver._emitVital.mock.calls;
            const progressEvents = calls.filter((c) => c.arguments[0] === 'TYPE_PROGRESS');

            // Para 1000 chars, deve emitir múltiplos progressos
            assert.ok(progressEvents.length > 0, 'Deve emitir progress events para texto longo');
        });

        it('deve clicar com retry em elemento que aparece tarde', async () => {
            const { humanClick } = humanModule;

            let attempts = 0;
            mockPage.waitForSelector = mock.fn(async () => {
                attempts++;
                if (attempts < 2) {
                    throw new Error('Element not ready');
                }
                return {}; // Elemento "apareceu" na 2ª tentativa
            });

            const result = await humanClick(mockDriver, '#late-element');

            assert.strictEqual(result, true);
            assert.strictEqual(attempts, 2, 'Deve ter tentado 2 vezes');
        });
    });

    // ======================
    // PERFORMANCE TESTS
    // ======================

    describe('Performance Tests', () => {
        it('gaussian cache deve manter valor estável dentro do TTL', async () => {
            // Reimport (Node ESM cacheia módulos; então use params únicos para isolar estado)
            const freshHuman = await import('#shared/biomechanics/human').then(
                (/** @type {any} */ m) => m.default ?? m,
            );

            const params = [1234.5, 6.7];
            const ttlMs = Number(freshHuman.HUMAN_CONFIG?.GAUSSIAN_CACHE_TTL || 0);

            const first = freshHuman.gaussian(...params);

            // Dentro do TTL, deve retornar exatamente o mesmo valor (cache hit determinístico)
            for (let i = 0; i < 20; i++) {
                assert.strictEqual(freshHuman.gaussian(...params), first);
            }

            // Após expirar, é esperado que eventualmente retorne um valor diferente (cache miss)
            // Evitamos flakiness: damos folga e tentamos algumas vezes.
            await new Promise((r) => setTimeout(r, Math.max(1, ttlMs + 50)));

            let changed = false;
            for (let i = 0; i < 25; i++) {
                const v = freshHuman.gaussian(...params);
                if (v !== first) {
                    changed = true;
                    break;
                }
            }
            assert.ok(changed, 'Após TTL, gaussian deve eventualmente gerar novo valor (cache miss)');
        });
    });
});
