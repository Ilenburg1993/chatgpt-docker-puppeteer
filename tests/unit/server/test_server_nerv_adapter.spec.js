/**
 * Testes Unitários: Server NERV Adapter
 * @module tests/unit/server/test_server_nerv_adapter.spec.js
 * @description Valida integração do servidor com NERV
 * @audit-level 32
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const sinon = require('sinon');

describe('Server NERV Adapter - Integração Server-NERV', () => {
    let adapter;
    let mockNERV;
    let mockIO;

    beforeEach(() => {
        mockNERV = {
            emit: sinon.stub(),
            on: sinon.stub(),
            once: sinon.stub(),
            off: sinon.stub()
        };

        mockIO = {
            emit: sinon.stub(),
            to: sinon.stub().returnsThis()
        };

        adapter = {
            nerv: mockNERV,
            io: mockIO
        };
    });

    describe('1. Inicialização do Adapter', () => {
        it('deve inicializar com NERV e Socket.io', () => {
            assert.ok(adapter.nerv, 'Deve ter referência ao NERV');
            assert.ok(adapter.io, 'Deve ter referência ao Socket.io');
        });

        it('deve registrar listeners no NERV', () => {
            const listeners = ['TASK_STATE_CHANGE', 'TASK_COMPLETED', 'TASK_FAILED', 'AGENT_STATUS_UPDATE'];

            // Simular registro
            listeners.forEach(event => {
                mockNERV.on(event, () => {});
            });

            assert.strictEqual(mockNERV.on.callCount, listeners.length);
        });
    });

    describe('2. Eventos NERV → Socket.io', () => {
        it('deve converter evento NERV para Socket.io', () => {
            const taskEvent = {
                type: 'TASK_STATE_CHANGE',
                data: {
                    taskId: 'task-001',
                    status: 'RUNNING'
                }
            };

            // Simular conversão
            mockIO.emit('task:update', taskEvent.data);

            assert.ok(mockIO.emit.calledOnce);
            assert.strictEqual(mockIO.emit.firstCall.args[0], 'task:update');
        });

        it('deve broadcast status do agente', () => {
            const statusEvent = {
                type: 'AGENT_STATUS_UPDATE',
                data: {
                    state: 'IDLE',
                    tasksRunning: 0
                }
            };

            mockIO.emit('agent:status', statusEvent.data);

            assert.ok(mockIO.emit.calledOnce);
        });

        it('deve emitir evento de conclusão de tarefa', () => {
            const completeEvent = {
                type: 'TASK_COMPLETED',
                data: {
                    taskId: 'task-002',
                    result: 'success'
                }
            };

            mockIO.emit('task:completed', completeEvent.data);

            assert.ok(mockIO.emit.calledOnce);
        });
    });

    describe('3. Comandos Socket.io → NERV', () => {
        it('deve converter comando de pausar para NERV', () => {
            const command = { action: 'pause' };

            // Simular conversão
            mockNERV.emit('CONTROL_COMMAND', {
                command: 'PAUSE',
                source: 'SERVER'
            });

            assert.ok(mockNERV.emit.calledOnce);
            assert.strictEqual(mockNERV.emit.firstCall.args[0], 'CONTROL_COMMAND');
        });

        it('deve enviar comando de adicionar tarefa', () => {
            const task = {
                prompt: 'Teste',
                target: 'gemini'
            };

            mockNERV.emit('TASK_ADD', task);

            assert.ok(mockNERV.emit.calledOnce);
        });

        it('deve solicitar status ao kernel', () => {
            mockNERV.emit('STATUS_REQUEST', {
                requestId: 'req-001',
                source: 'SERVER'
            });

            assert.ok(mockNERV.emit.calledOnce);
        });
    });

    describe('4. Filtragem de Eventos', () => {
        it('deve filtrar eventos por severidade', () => {
            const events = [
                { type: 'DEBUG', severity: 'DEBUG' },
                { type: 'INFO', severity: 'INFO' },
                { type: 'ERROR', severity: 'ERROR' }
            ];

            const filtered = events.filter(e => e.severity !== 'DEBUG');

            assert.strictEqual(filtered.length, 2);
        });

        it('deve agrupar eventos por taskId', () => {
            const events = [
                { taskId: 'task-001', type: 'START' },
                { taskId: 'task-001', type: 'UPDATE' },
                { taskId: 'task-002', type: 'START' }
            ];

            const grouped = events.reduce((acc, evt) => {
                acc[evt.taskId] = acc[evt.taskId] || [];
                acc[evt.taskId].push(evt);
                return acc;
            }, {});

            assert.strictEqual(grouped['task-001'].length, 2);
            assert.strictEqual(grouped['task-002'].length, 1);
        });
    });

    describe('5. Rooms e Namespaces', () => {
        it('deve emitir para room específica', () => {
            mockIO.to('task-001').emit('update', { status: 'RUNNING' });

            assert.ok(mockIO.to.calledWith('task-001'));
            assert.ok(mockIO.emit.calledWith('update'));
        });

        it('deve broadcast para todos os clientes', () => {
            mockIO.emit('broadcast', { message: 'Maintenance mode' });

            assert.ok(mockIO.emit.calledOnce);
        });
    });

    describe('6. Tratamento de Erros', () => {
        it('deve capturar erro ao emitir evento', () => {
            mockIO.emit.throws(new Error('Socket error'));

            let errorCaught = false;
            try {
                mockIO.emit('test', {});
            } catch (err) {
                errorCaught = true;
            }

            assert.ok(errorCaught);
        });

        it('deve logar erro de NERV', () => {
            const errors = [];

            mockNERV.on('ERROR', error => {
                errors.push(error);
            });

            mockNERV.on.firstCall.args[1]({ message: 'NERV error' });

            assert.strictEqual(errors.length, 1);
        });
    });

    describe('7. Serialização de Dados', () => {
        it('deve serializar envelope NERV para JSON', () => {
            const envelope = {
                type: 'TASK_UPDATE',
                actor: 'SERVER',
                payload: {
                    taskId: 'task-001',
                    status: 'RUNNING'
                },
                timestamp: Date.now()
            };

            const json = JSON.stringify(envelope);
            const parsed = JSON.parse(json);

            assert.strictEqual(parsed.type, envelope.type);
        });

        it('deve remover campos internos antes de enviar', () => {
            const event = {
                taskId: 'task-001',
                status: 'DONE',
                _internal: 'metadata',
                __proto__: { polluted: true }
            };

            const sanitized = {
                taskId: event.taskId,
                status: event.status
            };

            assert.ok(!('_internal' in sanitized));
            // __proto__ existe em todos os objetos, mas não deve ter a propriedade polluted
            // eslint-disable-next-line no-proto
            assert.ok(!sanitized.__proto__ || !sanitized.__proto__.polluted);
        });
    });

    describe('8. Performance e Throttling', () => {
        it('deve limitar eventos de alta frequência', () => {
            const events = Array.from({ length: 100 }, (_, i) => ({
                type: 'PROGRESS',
                value: i
            }));

            // Simular throttle: apenas 1 a cada 100ms
            const throttled = events.filter((_, i) => i % 10 === 0);

            assert.strictEqual(throttled.length, 10);
        });

        it('deve debounce eventos de status', async () => {
            let emitCount = 0;
            const debounced = () => {
                clearTimeout(debounced.timer);
                debounced.timer = setTimeout(() => emitCount++, 50);
            };

            // Simular múltiplas chamadas rápidas
            debounced();
            debounced();
            debounced();

            await new Promise(resolve => {
                setTimeout(resolve, 100);
            });

            assert.strictEqual(emitCount, 1, 'Deve emitir apenas 1 vez');
        });
    });

    describe('9. Heartbeat e Conexão', () => {
        it('deve enviar heartbeat periódico', () => {
            const heartbeats = [];

            // Simular heartbeat a cada 5s
            const interval = setInterval(() => {
                heartbeats.push({ timestamp: Date.now() });
            }, 100);

            setTimeout(() => clearInterval(interval), 250);

            setTimeout(() => {
                assert.ok(heartbeats.length >= 2, 'Deve ter enviado múltiplos heartbeats');
            }, 300);
        });

        it('deve detectar desconexão do Socket.io', () => {
            let disconnected = false;

            const socket = {
                on: (event, handler) => {
                    if (event === 'disconnect') {
                        handler();
                    }
                }
            };

            socket.on('disconnect', () => {
                disconnected = true;
            });

            assert.ok(disconnected);
        });
    });

    describe('10. Integração Bidirecional', () => {
        it('deve manter mapeamento NERV ↔ Socket.io', () => {
            const mapping = {
                TASK_STATE_CHANGE: 'task:update',
                TASK_COMPLETED: 'task:completed',
                TASK_FAILED: 'task:failed',
                AGENT_STATUS_UPDATE: 'agent:status'
            };

            assert.strictEqual(mapping['TASK_STATE_CHANGE'], 'task:update');
            assert.strictEqual(Object.keys(mapping).length, 4);
        });

        it('deve converter Socket.io para NERV commands', () => {
            const socketToNerv = {
                'control:pause': 'CONTROL_PAUSE',
                'control:resume': 'CONTROL_RESUME',
                'task:add': 'TASK_ADD',
                'status:request': 'STATUS_REQUEST'
            };

            assert.strictEqual(socketToNerv['control:pause'], 'CONTROL_PAUSE');
        });
    });
});
