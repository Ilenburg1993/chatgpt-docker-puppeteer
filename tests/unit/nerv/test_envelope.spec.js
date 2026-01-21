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
                actionCode: ActionCode.TASK_START,
                payload: { taskId: 'task-001' }
            });

            assert.ok(envelope, 'Envelope deve ser criado');
            assert.strictEqual(envelope.identity.actor, ActorRole.KERNEL);
            assert.strictEqual(envelope.type.message_type, MessageType.COMMAND);
            assert.strictEqual(envelope.type.action_code, ActionCode.TASK_START);
        });

        it('deve gerar ID único para cada envelope', () => {
            const env1 = createEnvelope({
                actor: ActorRole.INFRA,
                messageType: MessageType.EVENT,
                actionCode: ActionCode.TASK_OBSERVED
            });

            const env2 = createEnvelope({
                actor: ActorRole.INFRA,
                messageType: MessageType.EVENT,
                actionCode: ActionCode.TASK_OBSERVED
            });

            assert.notStrictEqual(env1.causality.msg_id, env2.causality.msg_id, 'IDs devem ser únicos');
        });

        it('deve incluir timestamp automático', () => {
            const antes = Date.now();

            const envelope = createEnvelope({
                actor: ActorRole.SERVER,
                messageType: MessageType.ACK,
                actionCode: ActionCode.ACK_RECEIVED
            });

            const depois = Date.now();

            assert.ok(envelope.protocol.timestamp, 'Deve ter timestamp');
            const ts = envelope.protocol.timestamp;
            assert.ok(ts >= antes && ts <= depois, 'Timestamp deve estar no intervalo');
        });
    });

    describe('2. Validação de Atores', () => {
        it('deve aceitar atores válidos', () => {
            const atoresValidos = [ActorRole.KERNEL, ActorRole.SERVER, ActorRole.INFRA, ActorRole.OBSERVER];

            atoresValidos.forEach(actor => {
                assert.doesNotThrow(() => {
                    createEnvelope({
                        actor,
                        messageType: MessageType.EVENT,
                        actionCode: ActionCode.ACK_RECEIVED
                    });
                });
            });
        });

        it('deve rejeitar ator inválido', () => {
            assert.throws(() => {
                createEnvelope({
                    actor: 'INVALID_ACTOR',
                    messageType: MessageType.EVENT,
                    actionCode: ActionCode.ACK_RECEIVED
                });
            }, /Invalid actor/);
        });
    });

    describe('3. Tipos de Mensagem', () => {
        it('deve aceitar tipo COMMAND', () => {
            const envelope = createEnvelope({
                actor: ActorRole.KERNEL,
                messageType: MessageType.COMMAND,
                actionCode: ActionCode.TASK_START
            });

            assert.strictEqual(envelope.type.message_type, MessageType.COMMAND);
        });

        it('deve aceitar tipo EVENT', () => {
            const envelope = createEnvelope({
                actor: ActorRole.INFRA,
                messageType: MessageType.EVENT,
                actionCode: ActionCode.TASK_OBSERVED
            });

            assert.strictEqual(envelope.type.message_type, MessageType.EVENT);
        });

        it('deve aceitar tipo ACK', () => {
            const envelope = createEnvelope({
                actor: ActorRole.SERVER,
                messageType: MessageType.ACK,
                actionCode: ActionCode.ACK_RECEIVED
            });

            assert.strictEqual(envelope.type.message_type, MessageType.ACK);
        });
    });

    describe('4. Payload e Dados', () => {
        it('deve aceitar payload vazio', () => {
            const envelope = createEnvelope({
                actor: ActorRole.OBSERVER,
                messageType: MessageType.EVENT,
                actionCode: ActionCode.ACK_RECEIVED,
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
                actionCode: ActionCode.TASK_OBSERVED,
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
                actor: ActorRole.INFRA,
                messageType: MessageType.EVENT,
                actionCode: ActionCode.DRIVER_STATE_OBSERVED,
                payload
            });

            assert.deepStrictEqual(envelope.payload.nested.array, [1, 2, 3]);
        });
    });

    describe('5. Correlação de Mensagens', () => {
        it('deve aceitar correlationId opcional', () => {
            const correlationId = '550e8400-e29b-41d4-a716-446655440000'; // UUID válido

            const envelope = createEnvelope({
                actor: ActorRole.KERNEL,
                messageType: MessageType.COMMAND,
                actionCode: ActionCode.TASK_START,
                correlationId
            });

            assert.strictEqual(envelope.causality.correlation_id, correlationId);
        });

        it('deve permitir correlationId null', () => {
            const envelope = createEnvelope({
                actor: ActorRole.SERVER,
                messageType: MessageType.ACK,
                actionCode: ActionCode.ACK_RECEIVED,
                correlationId: null
            });

            // correlationId null usa msg_id como fallback
            assert.ok(envelope.causality.correlation_id);
        });
    });

    describe('6. Target Actor (Destinatário)', () => {
        it('deve aceitar target opcional', () => {
            const envelope = createEnvelope({
                actor: ActorRole.KERNEL,
                messageType: MessageType.COMMAND,
                actionCode: ActionCode.TASK_START,
                target: ActorRole.INFRA
            });

            assert.strictEqual(envelope.identity.target, ActorRole.INFRA);
        });

        it('deve validar target se fornecido', () => {
            assert.throws(() => {
                createEnvelope({
                    actor: ActorRole.KERNEL,
                    messageType: MessageType.COMMAND,
                    actionCode: ActionCode.TASK_START,
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
                actionCode: ActionCode.TASK_OBSERVED
            });

            // Verificar se o envelope está congelado
            assert.ok(Object.isFrozen(envelope), 'Envelope deve estar congelado');
            assert.ok(Object.isFrozen(envelope.identity), 'identity deve estar congelado');
            assert.ok(Object.isFrozen(envelope.type), 'type deve estar congelado');
        });
    });

    describe('8. Serialização', () => {
        it('deve ser serializável para JSON', () => {
            const envelope = createEnvelope({
                actor: ActorRole.KERNEL,
                messageType: MessageType.COMMAND,
                actionCode: ActionCode.TASK_START,
                payload: { taskId: 'task-001' }
            });

            assert.doesNotThrow(() => {
                const json = JSON.stringify(envelope);
                const parsed = JSON.parse(json);

                assert.strictEqual(parsed.identity.actor, ActorRole.KERNEL);
                assert.strictEqual(parsed.payload.taskId, 'task-001');
            });
        });
    });
});
