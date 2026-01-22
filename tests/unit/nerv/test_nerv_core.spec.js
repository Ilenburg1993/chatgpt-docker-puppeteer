/**
 * Testes Unitários: NERV Core
 * @module tests/unit/nerv/test_nerv_core.spec.js
 * @description Valida event bus, pub/sub, correlação de eventos
 * @audit-level 32
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { criarNERVMock } = require('../../mocks/mock_nerv');
const { ActorRole, MessageType, ActionCode } = require('../../../src/shared/nerv/constants');

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
                nerv.emit({
                    actor: ActorRole.KERNEL,
                    messageType: MessageType.EVENT,
                    actionCode: 'TEST_EVENT',
                    payload: { data: 'test' }
                });
            });
        });
    });

    describe('2. Publicação de Eventos (Emit)', () => {
        it('deve emitir evento simples', () => {
            const nerv = criarNERVMock();

            nerv.emit({
                actor: ActorRole.KERNEL,
                messageType: MessageType.EVENT,
                actionCode: 'TASK_CREATED', // String direta, ActionCode não tem TASK_CREATED
                payload: { taskId: 'task-001' }
            });

            assert.ok(nerv.verificarEventoEmitido('TASK_CREATED'), 'Evento deve estar registrado');
        });

        it('deve emitir múltiplos eventos', () => {
            const nerv = criarNERVMock();

            nerv.emit({
                actor: ActorRole.KERNEL,
                messageType: MessageType.EVENT,
                actionCode: 'EVENT_1',
                payload: { data: 1 }
            });
            nerv.emit({
                actor: ActorRole.KERNEL,
                messageType: MessageType.EVENT,
                actionCode: 'EVENT_2',
                payload: { data: 2 }
            });
            nerv.emit({
                actor: ActorRole.KERNEL,
                messageType: MessageType.EVENT,
                actionCode: 'EVENT_3',
                payload: { data: 3 }
            });

            const eventos = nerv.obterEventosEmitidos();
            assert.strictEqual(eventos.length, 3, 'Deve ter 3 eventos emitidos');
        });

        it('deve passar dados corretos no evento', () => {
            const nerv = criarNERVMock();

            const payload = { taskId: 'task-002', status: 'RUNNING' };
            nerv.emit({
                actor: ActorRole.KERNEL,
                messageType: MessageType.EVENT,
                actionCode: 'TASK_STATE_CHANGE',
                payload
            });

            const envelopes = nerv.obterEventosEmitidos('TASK_STATE_CHANGE');
            assert.strictEqual(envelopes[0].payload.taskId, 'task-002');
            assert.strictEqual(envelopes[0].payload.status, 'RUNNING');
        });
    });

    describe('3. Assinatura de Eventos (On/Once)', () => {
        it('deve registrar listener com on()', () => {
            const nerv = criarNERVMock();

            const listener = _data => {
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

            nerv.emit({
                actor: ActorRole.KERNEL,
                messageType: MessageType.EVENT,
                actionCode: 'EXEC_TEST',
                payload: {}
            });

            // Aguardar execução assíncrona
            await new Promise(resolve => {
                setTimeout(resolve, 10);
            });
            assert.ok(executado, 'Listener deve ser executado');
        });

        it('deve executar listener apenas uma vez com once()', async () => {
            const nerv = criarNERVMock();

            let contador = 0;
            nerv.once('ONCE_TEST', () => {
                contador++;
            });

            const envelope = {
                actor: ActorRole.KERNEL,
                messageType: MessageType.EVENT,
                actionCode: 'ONCE_TEST',
                payload: {}
            };

            nerv.emit(envelope);
            nerv.emit(envelope);

            await new Promise(resolve => {
                setTimeout(resolve, 10);
            });
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

            nerv.emit({
                actor: ActorRole.KERNEL,
                messageType: MessageType.EVENT,
                actionCode: 'MULTI_TEST',
                payload: {}
            });

            await new Promise(resolve => {
                setTimeout(resolve, 10);
            });
            assert.strictEqual(contador1, 1, 'Listener 1 executado');
            assert.strictEqual(contador2, 1, 'Listener 2 executado');
            assert.strictEqual(contador3, 1, 'Listener 3 executado');
        });
    });

    describe('5. Correlação de Eventos', () => {
        it('deve aguardar evento específico', async () => {
            const nerv = criarNERVMock();

            setTimeout(() => {
                nerv.emit({
                    actor: ActorRole.KERNEL,
                    messageType: MessageType.EVENT,
                    actionCode: 'DELAYED_EVENT',
                    payload: { resultado: 'sucesso' }
                });
            }, 50);

            const envelope = await nerv.aguardarEvento('DELAYED_EVENT', 1000);

            assert.ok(envelope, 'Deve receber envelope do evento');
            assert.strictEqual(envelope.payload.resultado, 'sucesso');
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

            nerv.emit({
                actor: ActorRole.KERNEL,
                messageType: MessageType.EVENT,
                actionCode: 'EVENT_A',
                payload: {}
            });

            await new Promise(resolve => {
                setTimeout(resolve, 10);
            });
            assert.ok(eventoA, 'Evento A deve ser disparado');
            assert.ok(!eventoB, 'Evento B não deve ser disparado');
        });
    });

    describe('7. Limpeza e Manutenção', () => {
        it('deve limpar histórico de eventos', () => {
            const nerv = criarNERVMock();

            nerv.emit({ actor: ActorRole.KERNEL, messageType: MessageType.EVENT, actionCode: 'EVENT_1', payload: {} });
            nerv.emit({ actor: ActorRole.KERNEL, messageType: MessageType.EVENT, actionCode: 'EVENT_2', payload: {} });

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
                    nerv.emit({
                        actor: ActorRole.KERNEL,
                        messageType: MessageType.EVENT,
                        actionCode: 'PERF_TEST',
                        payload: { index: i }
                    });
                }
            });

            const eventos = nerv.obterEventosEmitidos('PERF_TEST');
            assert.strictEqual(eventos.length, 1000, 'Deve processar 1000 eventos');
        });
    });
});
