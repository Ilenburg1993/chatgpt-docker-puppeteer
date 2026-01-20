/**
 * Testes Unitários: NERV Envelope
 * @module tests/unit/nerv/test_envelope.spec.js
 * @description Valida criação, validação e serialização de envelopes NERV
 * @audit-level 510
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const { createEnvelope } = require('../../../src/shared/nerv/envelope');
const { MessageType, ActionCode, ActorRole } = require('../../../src/shared/nerv/constants');

describe('NERV Envelope - Protocolo Universal', () => {
    describe('1. Criação Básica de Envelope', () => {
        it('deve criar envelope válido com campos obrigatórios', () => {
            const envelope = createEnvelope({
                actor: ActorRole.KERNEL,
                messageType: MessageType.COMMAND,
                actionCode: ActionCode.EXECUTE_TASK,
                payload: { taskId: 'task-001' }
            });

            assert.ok(envelope, 'Envelope deve ser criado');
            assert.strictEqual(envelope.actor, ActorRole.KERNEL);
            assert.strictEqual(envelope.messageType, MessageType.COMMAND);
        });

        it('deve gerar ID único para cada envelope', () => {
            const env1 = createEnvelope({
                actor: ActorRole.DRIVER,
                messageType: MessageType.EVENT,
                actionCode: ActionCode.TASK_COMPLETED
            });

            const env2 = createEnvelope({
                actor: ActorRole.DRIVER,
                messageType: MessageType.EVENT,
                actionCode: ActionCode.TASK_COMPLETED
            });

            assert.notStrictEqual(env1.id, env2.id, 'IDs devem ser únicos');
        });

        it('deve incluir timestamp automático', () => {
            const antes = Date.now();

            const envelope = createEnvelope({
                actor: ActorRole.SERVER,
                messageType: MessageType.QUERY,
                actionCode: ActionCode.GET_STATUS
            });

            const depois = Date.now();

            assert.ok(envelope.timestamp, 'Deve ter timestamp');
            const ts = new Date(envelope.timestamp).getTime();
            assert.ok(ts >= antes && ts <= depois, 'Timestamp deve estar no intervalo');
        });
    });

    describe('2. Validação de Atores', () => {
        it('deve aceitar atores válidos', () => {
            const atoresValidos = [ActorRole.KERNEL, ActorRole.DRIVER, ActorRole.SERVER, ActorRole.NERV];

            atoresValidos.forEach(actor => {
                assert.doesNotThrow(() => {
                    createEnvelope({
                        actor,
                        messageType: MessageType.EVENT,
                        actionCode: ActionCode.HEARTBEAT
                    });
                });
            });
        });

        it('deve rejeitar ator inválido', () => {
            assert.throws(() => {
                createEnvelope({
                    actor: 'INVALID_ACTOR',
                    messageType: MessageType.EVENT,
                    actionCode: ActionCode.HEARTBEAT
                });
            }, /Invalid actor/);
        });
    });

    describe('3. Tipos de Mensagem', () => {
        it('deve aceitar tipo COMMAND', () => {
            const envelope = createEnvelope({
                actor: ActorRole.KERNEL,
                messageType: MessageType.COMMAND,
                actionCode: ActionCode.EXECUTE_TASK
            });

            assert.strictEqual(envelope.messageType, MessageType.COMMAND);
        });

        it('deve aceitar tipo EVENT', () => {
            const envelope = createEnvelope({
                actor: ActorRole.DRIVER,
                messageType: MessageType.EVENT,
                actionCode: ActionCode.TASK_COMPLETED
            });

            assert.strictEqual(envelope.messageType, MessageType.EVENT);
        });

        it('deve aceitar tipo QUERY', () => {
            const envelope = createEnvelope({
                actor: ActorRole.SERVER,
                messageType: MessageType.QUERY,
                actionCode: ActionCode.GET_STATUS
            });

            assert.strictEqual(envelope.messageType, MessageType.QUERY);
        });
    });

    describe('4. Payload e Dados', () => {
        it('deve aceitar payload vazio', () => {
            const envelope = createEnvelope({
                actor: ActorRole.NERV,
                messageType: MessageType.EVENT,
                actionCode: ActionCode.HEARTBEAT,
                payload: {}
            });

            assert.deepStrictEqual(envelope.payload, {});
        });

        it('deve aceitar payload com dados', () => {
            const payload = {
                taskId: 'task-123',
                status: 'RUNNING',
                progress: 0.5
            };

            const envelope = createEnvelope({
                actor: ActorRole.KERNEL,
                messageType: MessageType.EVENT,
                actionCode: ActionCode.TASK_STATE_CHANGE,
                payload
            });

            assert.strictEqual(envelope.payload.taskId, 'task-123');
            assert.strictEqual(envelope.payload.status, 'RUNNING');
        });

        it('deve preservar estruturas complexas no payload', () => {
            const payload = {
                nested: {
                    array: [1, 2, 3],
                    object: { key: 'value' }
                }
            };

            const envelope = createEnvelope({
                actor: ActorRole.DRIVER,
                messageType: MessageType.EVENT,
                actionCode: ActionCode.DRIVER_RESPONSE,
                payload
            });

            assert.deepStrictEqual(envelope.payload.nested.array, [1, 2, 3]);
        });
    });

    describe('5. Correlação de Mensagens', () => {
        it('deve aceitar correlationId opcional', () => {
            const correlationId = 'corr-001';

            const envelope = createEnvelope({
                actor: ActorRole.KERNEL,
                messageType: MessageType.COMMAND,
                actionCode: ActionCode.EXECUTE_TASK,
                correlationId
            });

            assert.strictEqual(envelope.correlationId, correlationId);
        });

        it('deve permitir correlationId null', () => {
            const envelope = createEnvelope({
                actor: ActorRole.SERVER,
                messageType: MessageType.QUERY,
                actionCode: ActionCode.GET_STATUS,
                correlationId: null
            });

            assert.strictEqual(envelope.correlationId, null);
        });
    });

    describe('6. Target Actor (Destinatário)', () => {
        it('deve aceitar target opcional', () => {
            const envelope = createEnvelope({
                actor: ActorRole.KERNEL,
                messageType: MessageType.COMMAND,
                actionCode: ActionCode.EXECUTE_TASK,
                target: ActorRole.DRIVER
            });

            assert.strictEqual(envelope.target, ActorRole.DRIVER);
        });

        it('deve validar target se fornecido', () => {
            assert.throws(() => {
                createEnvelope({
                    actor: ActorRole.KERNEL,
                    messageType: MessageType.COMMAND,
                    actionCode: ActionCode.EXECUTE_TASK,
                    target: 'INVALID_TARGET'
                });
            }, /Invalid target/);
        });
    });

    describe('7. Imutabilidade', () => {
        it('deve ser imutável após criação', () => {
            const envelope = createEnvelope({
                actor: ActorRole.KERNEL,
                messageType: MessageType.EVENT,
                actionCode: ActionCode.TASK_COMPLETED
            });

            // Tentar modificar (deve falhar silenciosamente ou throw em strict mode)
            assert.throws(() => {
                envelope.actor = ActorRole.DRIVER;
            }, /Cannot/);
        });
    });

    describe('8. Serialização', () => {
        it('deve ser serializável para JSON', () => {
            const envelope = createEnvelope({
                actor: ActorRole.KERNEL,
                messageType: MessageType.COMMAND,
                actionCode: ActionCode.EXECUTE_TASK,
                payload: { taskId: 'task-001' }
            });

            assert.doesNotThrow(() => {
                const json = JSON.stringify(envelope);
                const parsed = JSON.parse(json);

                assert.strictEqual(parsed.actor, ActorRole.KERNEL);
                assert.strictEqual(parsed.payload.taskId, 'task-001');
            });
        });
    });
});
