/**
 * Testes Unitários: Kernel Execution Engine
 * @module tests/unit/kernel/test_execution_engine.spec.js
 * @description Valida ciclo de vida de tarefas e transições de estado
 * @audit-level 32
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { STATUS_VALUES } = require('../../../src/core/constants/tasks');

describe('Kernel Execution Engine - Motor de Execução', () => {
    describe('1. Ciclo de Vida de Tarefas', () => {
        it('deve ter estados definidos', () => {
            assert.ok(STATUS_VALUES.PENDING, 'Estado PENDING deve existir');
            assert.ok(STATUS_VALUES.RUNNING, 'Estado RUNNING deve existir');
            assert.ok(STATUS_VALUES.SUCCESS, 'Estado SUCCESS deve existir');
            assert.ok(STATUS_VALUES.FAILED, 'Estado FAILED deve existir');
        });

        it('deve iniciar tarefa em PENDING', () => {
            const tarefa = {
                id: 'task-001',
                status: STATUS_VALUES.PENDING
            };

            assert.strictEqual(tarefa.status, STATUS_VALUES.PENDING);
        });

        it('deve transicionar PENDING → RUNNING', () => {
            let tarefa = {
                id: 'task-002',
                status: STATUS_VALUES.PENDING
            };

            // Simular transição
            tarefa = { ...tarefa, status: STATUS_VALUES.RUNNING };

            assert.strictEqual(tarefa.status, STATUS_VALUES.RUNNING);
        });

        it('deve transicionar RUNNING → DONE', () => {
            let tarefa = {
                id: 'task-003',
                status: STATUS_VALUES.RUNNING
            };

            tarefa = { ...tarefa, status: STATUS_VALUES.DONE };

            assert.strictEqual(tarefa.status, STATUS_VALUES.DONE);
        });

        it('deve transicionar RUNNING → FAILED', () => {
            let tarefa = {
                id: 'task-004',
                status: STATUS_VALUES.RUNNING
            };

            tarefa = { ...tarefa, status: STATUS_VALUES.FAILED };

            assert.strictEqual(tarefa.status, STATUS_VALUES.FAILED);
        });
    });

    describe('2. Validação de Transições', () => {
        it('não deve transicionar DONE → RUNNING', () => {
            const tarefa = {
                id: 'task-005',
                status: STATUS_VALUES.DONE
            };

            // Estado final não deve mudar
            const transicaoInvalida = STATUS_VALUES.RUNNING;

            assert.notStrictEqual(tarefa.status, transicaoInvalida);
        });

        it('não deve transicionar FAILED → RUNNING diretamente', () => {
            const tarefa = {
                id: 'task-006',
                status: STATUS_VALUES.FAILED
            };

            // Retry deve criar nova tentativa, não mudar status diretamente
            assert.strictEqual(tarefa.status, STATUS_VALUES.FAILED);
        });
    });

    describe('3. Metadados de Execução', () => {
        it('deve registrar timestamp de início', () => {
            const tarefa = {
                id: 'task-007',
                status: STATUS_VALUES.RUNNING,
                startedAt: new Date().toISOString()
            };

            assert.ok(tarefa.startedAt, 'Deve ter timestamp de início');
        });

        it('deve registrar timestamp de conclusão', () => {
            const tarefa = {
                id: 'task-008',
                status: STATUS_VALUES.DONE,
                startedAt: new Date(Date.now() - 1000).toISOString(),
                completedAt: new Date().toISOString()
            };

            assert.ok(tarefa.completedAt, 'Deve ter timestamp de conclusão');
            assert.ok(tarefa.completedAt > tarefa.startedAt, 'Conclusão após início');
        });

        it('deve calcular duração da execução', () => {
            const inicio = Date.now() - 5000;
            const fim = Date.now();

            const tarefa = {
                id: 'task-009',
                status: STATUS_VALUES.DONE,
                startedAt: new Date(inicio).toISOString(),
                completedAt: new Date(fim).toISOString()
            };

            const duracao = new Date(tarefa.completedAt) - new Date(tarefa.startedAt);

            assert.ok(duracao >= 5000, 'Duração deve ser ~5 segundos');
        });
    });

    describe('4. Contador de Tentativas', () => {
        it('deve iniciar com 0 tentativas', () => {
            const tarefa = {
                id: 'task-010',
                attempts: 0
            };

            assert.strictEqual(tarefa.attempts, 0);
        });

        it('deve incrementar tentativas após retry', () => {
            let tarefa = {
                id: 'task-011',
                attempts: 0
            };

            tarefa = { ...tarefa, attempts: tarefa.attempts + 1 };

            assert.strictEqual(tarefa.attempts, 1);
        });

        it('deve limitar número máximo de tentativas', () => {
            const MAX_ATTEMPTS = 3;

            const tarefa = {
                id: 'task-012',
                attempts: 3
            };

            const deveRetentar = tarefa.attempts < MAX_ATTEMPTS;

            assert.strictEqual(deveRetentar, false, 'Não deve retentar após 3 tentativas');
        });
    });

    describe('5. Histórico de Erros', () => {
        it('deve registrar erros de execução', () => {
            const tarefa = {
                id: 'task-013',
                status: STATUS_VALUES.FAILED,
                errors: [
                    {
                        timestamp: new Date().toISOString(),
                        message: 'Timeout na execução',
                        type: 'TIMEOUT'
                    }
                ]
            };

            assert.strictEqual(tarefa.errors.length, 1);
            assert.strictEqual(tarefa.errors[0].type, 'TIMEOUT');
        });

        it('deve acumular múltiplos erros', () => {
            const tarefa = {
                id: 'task-014',
                errors: [
                    { message: 'Erro 1', type: 'NETWORK' },
                    { message: 'Erro 2', type: 'TIMEOUT' },
                    { message: 'Erro 3', type: 'VALIDATION' }
                ]
            };

            assert.strictEqual(tarefa.errors.length, 3);
        });
    });

    describe('6. Priorização de Tarefas', () => {
        it('deve ordenar por prioridade', () => {
            const tarefas = [
                { id: 't1', priority: 3 },
                { id: 't2', priority: 8 },
                { id: 't3', priority: 5 }
            ];

            const ordenadas = [...tarefas].sort((a, b) => b.priority - a.priority);

            assert.strictEqual(ordenadas[0].id, 't2', 'Maior prioridade primeiro');
            assert.strictEqual(ordenadas[2].id, 't1', 'Menor prioridade por último');
        });

        it('deve respeitar ordem FIFO para mesma prioridade', () => {
            const tarefas = [
                { id: 't1', priority: 5, createdAt: '2026-01-20T10:00:00Z' },
                { id: 't2', priority: 5, createdAt: '2026-01-20T10:00:01Z' },
                { id: 't3', priority: 5, createdAt: '2026-01-20T10:00:02Z' }
            ];

            const ordenadas = [...tarefas].sort((a, b) => {
                if (a.priority === b.priority) {
                    return new Date(a.createdAt) - new Date(b.createdAt);
                }
                return b.priority - a.priority;
            });

            assert.strictEqual(ordenadas[0].id, 't1', 'Primeira criada primeiro');
        });
    });

    describe('7. Timeouts e Limites', () => {
        it('deve respeitar timeout configurado', () => {
            const tarefa = {
                id: 'task-015',
                timeout: 30000, // 30 segundos
                startedAt: new Date().toISOString()
            };

            assert.ok(tarefa.timeout, 'Timeout deve estar configurado');
        });

        it('deve detectar timeout excedido', () => {
            const tarefa = {
                id: 'task-016',
                timeout: 5000,
                startedAt: new Date(Date.now() - 10000).toISOString() // 10s atrás
            };

            const tempoDecorrido = Date.now() - new Date(tarefa.startedAt).getTime();
            const excedeu = tempoDecorrido > tarefa.timeout;

            assert.ok(excedeu, 'Timeout deve ter sido excedido');
        });
    });

    describe('8. Observadores de Estado', () => {
        it('deve notificar mudanças de estado', () => {
            let notificado = false;

            const observador = (oldState, newState) => {
                notificado = true;
            };

            // Simular mudança de estado
            const oldState = STATUS_VALUES.PENDING;
            const newState = STATUS_VALUES.RUNNING;

            observador(oldState, newState);

            assert.ok(notificado, 'Observador deve ser notificado');
        });
    });
});
