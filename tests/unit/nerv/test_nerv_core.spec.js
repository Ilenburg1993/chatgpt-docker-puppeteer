/**
 * Testes Unitários: NERV Core
 * @module tests/unit/nerv/test_nerv_core.spec.js
 * @description Valida event bus, pub/sub, correlação de eventos
 * @audit-level 32
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { criarNERVMock } = require('../../mocks/mock_nerv');

describe('NERV Core - Event Bus Central', () => {
    describe('1. Criação e Inicialização', () => {
        it('deve criar instância do NERV', () => {
            const nerv = criarNERVMock();

            assert.ok(nerv, 'NERV deve ser criado');
            assert.ok(typeof nerv.emit === 'function', 'Deve ter método emit');
            assert.ok(typeof nerv.on === 'function', 'Deve ter método on');
        });

        it('deve inicializar sem erros', () => {
            assert.doesNotThrow(() => {
                const nerv = criarNERVMock();
                nerv.emit('TEST_EVENT', { data: 'test' });
            });
        });
    });

    describe('2. Publicação de Eventos (Emit)', () => {
        it('deve emitir evento simples', () => {
            const nerv = criarNERVMock();

            const emitido = nerv.emit('TASK_CREATED', { taskId: 'task-001' });

            assert.ok(emitido, 'Evento deve ser emitido');
            assert.ok(nerv.verificarEventoEmitido('TASK_CREATED'), 'Evento deve estar registrado');
        });

        it('deve emitir múltiplos eventos', () => {
            const nerv = criarNERVMock();

            nerv.emit('EVENT_1', { data: 1 });
            nerv.emit('EVENT_2', { data: 2 });
            nerv.emit('EVENT_3', { data: 3 });

            const eventos = nerv.obterEventosEmitidos();
            assert.strictEqual(eventos.length, 3, 'Deve ter 3 eventos emitidos');
        });

        it('deve passar dados corretos no evento', () => {
            const nerv = criarNERVMock();

            const dados = { taskId: 'task-002', status: 'RUNNING' };
            nerv.emit('TASK_STATE_CHANGE', dados);

            const emitidos = nerv.obterEventosEmitidos('TASK_STATE_CHANGE');
            assert.strictEqual(emitidos[0][0].taskId, 'task-002');
            assert.strictEqual(emitidos[0][0].status, 'RUNNING');
        });
    });

    describe('3. Assinatura de Eventos (On/Once)', () => {
        it('deve registrar listener com on()', () => {
            const nerv = criarNERVMock();

            const listener = data => {
                /* noop */
            };
            nerv.on('TEST_EVENT', listener);

            assert.strictEqual(nerv.obterInscricoes('TEST_EVENT'), 1, 'Deve ter 1 inscrição');
        });

        it('deve executar listener quando evento é emitido', async () => {
            const nerv = criarNERVMock();

            let executado = false;
            nerv.on('EXEC_TEST', () => {
                executado = true;
            });

            nerv.emit('EXEC_TEST', {});

            // Aguardar execução assíncrona
            await new Promise(resolve => setTimeout(resolve, 10));
            assert.ok(executado, 'Listener deve ser executado');
        });

        it('deve executar listener apenas uma vez com once()', async () => {
            const nerv = criarNERVMock();

            let contador = 0;
            nerv.once('ONCE_TEST', () => {
                contador++;
            });

            nerv.emit('ONCE_TEST', {});
            nerv.emit('ONCE_TEST', {});

            await new Promise(resolve => setTimeout(resolve, 10));
            assert.strictEqual(contador, 1, 'Listener deve executar apenas uma vez');
        });

        it('deve remover listener com off()', () => {
            const nerv = criarNERVMock();

            const listener = () => {};
            nerv.on('REMOVE_TEST', listener);

            assert.strictEqual(nerv.obterInscricoes('REMOVE_TEST'), 1);

            nerv.off('REMOVE_TEST', listener);

            assert.strictEqual(nerv.obterInscricoes('REMOVE_TEST'), 0, 'Listener deve ser removido');
        });
    });

    describe('4. Múltiplos Listeners', () => {
        it('deve executar todos os listeners registrados', async () => {
            const nerv = criarNERVMock();

            let contador1 = 0;
            let contador2 = 0;
            let contador3 = 0;

            nerv.on('MULTI_TEST', () => {
                contador1++;
            });
            nerv.on('MULTI_TEST', () => {
                contador2++;
            });
            nerv.on('MULTI_TEST', () => {
                contador3++;
            });

            nerv.emit('MULTI_TEST', {});

            await new Promise(resolve => setTimeout(resolve, 10));
            assert.strictEqual(contador1, 1, 'Listener 1 executado');
            assert.strictEqual(contador2, 1, 'Listener 2 executado');
            assert.strictEqual(contador3, 1, 'Listener 3 executado');
        });
    });

    describe('5. Correlação de Eventos', () => {
        it('deve aguardar evento específico', async () => {
            const nerv = criarNERVMock();

            setTimeout(() => {
                nerv.emit('DELAYED_EVENT', { resultado: 'sucesso' });
            }, 50);

            const dados = await nerv.aguardarEvento('DELAYED_EVENT', 1000);

            assert.ok(dados, 'Deve receber dados do evento');
            assert.strictEqual(dados[0].resultado, 'sucesso');
        });

        it('deve timeout se evento não chegar', async () => {
            const nerv = criarNERVMock();

            try {
                await nerv.aguardarEvento('NEVER_EMITTED', 100);
                assert.fail('Deveria ter dado timeout');
            } catch (error) {
                assert.match(error.message, /Timeout/, 'Deve dar timeout');
            }
        });
    });

    describe('6. Isolamento de Eventos', () => {
        it('deve isolar eventos diferentes', async () => {
            const nerv = criarNERVMock();

            let eventoA = false;
            let eventoB = false;

            nerv.on('EVENT_A', () => {
                eventoA = true;
            });
            nerv.on('EVENT_B', () => {
                eventoB = true;
            });

            nerv.emit('EVENT_A', {});

            await new Promise(resolve => setTimeout(resolve, 10));
            assert.ok(eventoA, 'Evento A deve ser disparado');
            assert.ok(!eventoB, 'Evento B não deve ser disparado');
        });
    });

    describe('7. Limpeza e Manutenção', () => {
        it('deve limpar histórico de eventos', () => {
            const nerv = criarNERVMock();

            nerv.emit('EVENT_1', {});
            nerv.emit('EVENT_2', {});

            assert.ok(nerv.obterEventosEmitidos().length > 0);

            nerv.limpar();

            assert.strictEqual(nerv.obterEventosEmitidos().length, 0, 'Histórico limpo');
        });

        it('deve remover todos os listeners', () => {
            const nerv = criarNERVMock();

            nerv.on('TEST_1', () => {});
            nerv.on('TEST_2', () => {});

            nerv.limpar();

            assert.strictEqual(nerv.obterInscricoes('TEST_1'), 0);
            assert.strictEqual(nerv.obterInscricoes('TEST_2'), 0);
        });
    });

    describe('8. Performance e Escalabilidade', () => {
        it('deve lidar com grande volume de eventos', () => {
            const nerv = criarNERVMock();

            assert.doesNotThrow(() => {
                for (let i = 0; i < 1000; i++) {
                    nerv.emit('PERF_TEST', { index: i });
                }
            });

            const eventos = nerv.obterEventosEmitidos('PERF_TEST');
            assert.strictEqual(eventos.length, 1000, 'Deve processar 1000 eventos');
        });
    });
});
