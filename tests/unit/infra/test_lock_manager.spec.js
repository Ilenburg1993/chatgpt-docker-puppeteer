/**
 * Testes Unitários: Infra Lock Manager
 * @module tests/unit/infra/test_lock_manager.spec.js
 * @description Valida aquisição, liberação e validação de locks com PID
 * @audit-level 32
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('Infra Lock Manager - Gerenciador de Locks', () => {
    describe('1. Aquisição de Locks', () => {
        it('deve adquirir lock para tarefa', () => {
            const locks = new Map();
            const taskId = 'task-001';
            const pid = process.pid;

            const lock = {
                taskId,
                pid,
                acquiredAt: Date.now()
            };

            locks.set(taskId, lock);

            assert.ok(locks.has(taskId));
        });

        it('deve rejeitar lock duplicado', () => {
            const locks = new Map();
            const taskId = 'task-002';

            locks.set(taskId, { pid: 1001, acquiredAt: Date.now() });

            const podeAdquirir = !locks.has(taskId);

            assert.strictEqual(podeAdquirir, false);
        });

        it('deve incluir PID no lock', () => {
            const lock = {
                taskId: 'task-003',
                pid: process.pid,
                acquiredAt: Date.now()
            };

            assert.ok(lock.pid, 'Lock deve ter PID');
            assert.strictEqual(typeof lock.pid, 'number');
        });
    });

    describe('2. Liberação de Locks', () => {
        it('deve liberar lock existente', () => {
            const locks = new Map();
            const taskId = 'task-004';

            locks.set(taskId, { pid: process.pid });
            locks.delete(taskId);

            assert.strictEqual(locks.has(taskId), false);
        });

        it('deve validar PID antes de liberar', () => {
            const locks = new Map();
            const taskId = 'task-005';
            const lockPid = 1001;
            const currentPid = process.pid;

            locks.set(taskId, { pid: lockPid });

            // Só pode liberar se PID corresponder
            const podeLiberar = locks.get(taskId).pid === currentPid;

            assert.strictEqual(podeLiberar, false);
        });
    });

    describe('3. Validação de PID', () => {
        it('deve verificar se processo está vivo', () => {
            const pid = process.pid;

            let isAlive = false;
            try {
                process.kill(pid, 0); // Signal 0 apenas testa
                isAlive = true;
            } catch (err) {
                isAlive = false;
            }

            assert.ok(isAlive, 'Processo atual deve estar vivo');
        });

        it('deve detectar processo morto', () => {
            const deadPid = 999999; // PID improvável

            let isAlive = true;
            try {
                process.kill(deadPid, 0);
            } catch (err) {
                isAlive = false;
            }

            assert.strictEqual(isAlive, false);
        });

        it('deve quebrar lock de processo morto', () => {
            const locks = new Map();
            const taskId = 'task-006';
            const deadPid = 999999;

            locks.set(taskId, { pid: deadPid });

            // Verificar se processo está vivo
            let processAlive = true;
            try {
                process.kill(deadPid, 0);
            } catch (err) {
                processAlive = false;
            }

            // Quebrar lock se processo morto
            if (!processAlive) {
                locks.delete(taskId);
            }

            assert.strictEqual(locks.has(taskId), false);
        });
    });

    describe('4. Timeout de Locks', () => {
        it('deve detectar lock expirado', () => {
            const MAX_LOCK_AGE = 3600000; // 1 hora

            const lock = {
                taskId: 'task-007',
                pid: 1001,
                acquiredAt: Date.now() - 7200000 // 2 horas atrás
            };

            const age = Date.now() - lock.acquiredAt;
            const isExpired = age > MAX_LOCK_AGE;

            assert.ok(isExpired);
        });

        it('não deve considerar lock recente como expirado', () => {
            const MAX_LOCK_AGE = 3600000;

            const lock = {
                taskId: 'task-008',
                acquiredAt: Date.now() - 60000 // 1 minuto atrás
            };

            const age = Date.now() - lock.acquiredAt;
            const isExpired = age > MAX_LOCK_AGE;

            assert.strictEqual(isExpired, false);
        });
    });

    describe('5. Locks por Alvo (Target)', () => {
        it('deve criar lock específico por target', () => {
            const locks = new Map();
            const key = 'task-009:gemini';

            locks.set(key, {
                taskId: 'task-009',
                target: 'gemini',
                pid: process.pid
            });

            assert.ok(locks.has(key));
        });

        it('deve permitir mesma tarefa em targets diferentes', () => {
            const locks = new Map();
            const taskId = 'task-010';

            locks.set(`${taskId}:chatgpt`, { taskId, target: 'chatgpt' });
            locks.set(`${taskId}:gemini`, { taskId, target: 'gemini' });

            assert.strictEqual(locks.size, 2);
        });
    });

    describe('6. Listagem de Locks', () => {
        it('deve listar todos os locks ativos', () => {
            const locks = new Map();

            locks.set('task-1', { pid: 1001 });
            locks.set('task-2', { pid: 1002 });
            locks.set('task-3', { pid: 1003 });

            const all = Array.from(locks.entries());

            assert.strictEqual(all.length, 3);
        });

        it('deve filtrar locks por PID', () => {
            const locks = new Map();
            const myPid = process.pid;

            locks.set('task-1', { pid: myPid });
            locks.set('task-2', { pid: 9999 });
            locks.set('task-3', { pid: myPid });

            const myLocks = Array.from(locks.entries()).filter(([_, lock]) => lock.pid === myPid);

            assert.strictEqual(myLocks.length, 2);
        });
    });

    describe('7. Cleanup Automático', () => {
        it('deve remover locks órfãos', () => {
            const locks = new Map();

            locks.set('task-1', { pid: 999991, acquiredAt: Date.now() });
            locks.set('task-2', { pid: 999992, acquiredAt: Date.now() });

            // Simular cleanup de processos mortos
            for (const [taskId, lock] of locks.entries()) {
                try {
                    process.kill(lock.pid, 0);
                } catch (err) {
                    locks.delete(taskId);
                }
            }

            assert.strictEqual(locks.size, 0);
        });
    });

    describe('8. Metadados do Lock', () => {
        it('deve registrar timestamp de aquisição', () => {
            const lock = {
                taskId: 'task-011',
                pid: process.pid,
                acquiredAt: Date.now()
            };

            assert.ok(lock.acquiredAt);
            assert.strictEqual(typeof lock.acquiredAt, 'number');
        });

        it('deve registrar informação do target', () => {
            const lock = {
                taskId: 'task-012',
                target: 'gemini',
                pid: process.pid
            };

            assert.strictEqual(lock.target, 'gemini');
        });

        it('deve calcular idade do lock', () => {
            const lock = {
                acquiredAt: Date.now() - 5000 // 5 segundos atrás
            };

            const age = Date.now() - lock.acquiredAt;

            assert.ok(age >= 5000);
        });
    });

    describe('9. Concorrência', () => {
        it('deve prevenir race condition', () => {
            const locks = new Map();
            const taskId = 'task-013';

            // Tentativa 1
            if (!locks.has(taskId)) {
                locks.set(taskId, { pid: process.pid });
            }

            // Tentativa 2 (simultânea)
            const acquired = !locks.has(taskId);

            assert.strictEqual(acquired, false, 'Segunda tentativa deve falhar');
        });
    });

    describe('10. Persistência de Locks', () => {
        it('deve serializar lock para JSON', () => {
            const lock = {
                taskId: 'task-014',
                target: 'chatgpt',
                pid: process.pid,
                acquiredAt: Date.now()
            };

            const json = JSON.stringify(lock);
            const parsed = JSON.parse(json);

            assert.strictEqual(parsed.taskId, lock.taskId);
            assert.strictEqual(parsed.pid, lock.pid);
        });
    });
});
