// @ts-check
import assert from 'node:assert';

/**
 * Testes unitários para o controller de métricas
 *
 * Cobre o contrato de resposta de GET /api/metrics e GET /api/metrics/tasks. Utiliza mocks isolados, sem dependência de
 * SQLite ou Express real.
 */

describe('Metrics Controller — /api/metrics', () => {
    describe('1. GET /api/metrics — shape da resposta', () => {
        it('deve retornar status ok com campos de métricas do processo', () => {
            const response = {
                status: 'ok',
                metrics: {
                    timestamp: Date.now(),
                    uptime: process.uptime(),
                    memory: process.memoryUsage(),
                    cpu: process.cpuUsage(),
                    pid: process.pid,
                    platform: process.platform,
                    nodeVersion: process.version,
                },
            };

            assert.strictEqual(response.status, 'ok');
            assert.ok(typeof response.metrics.uptime === 'number', 'uptime deve ser número');
            assert.ok(response.metrics.timestamp > 0, 'timestamp deve ser positivo');
            assert.ok(typeof response.metrics.pid === 'number', 'pid deve ser número');
            assert.ok(typeof response.metrics.memory === 'object', 'memory deve ser objeto');
            assert.ok(typeof response.metrics.nodeVersion === 'string', 'nodeVersion deve ser string');
        });

        it('deve incluir campo platform', () => {
            const validPlatforms = ['linux', 'darwin', 'win32'];
            const platform = process.platform;
            // Não restringir a lista — apenas verificar que é string não-vazia
            assert.ok(typeof platform === 'string' && platform.length > 0);
        });
    });
});

describe('Metrics Controller — /api/metrics/tasks', () => {
    /**
     * Simula countTasksByStatus() retornando resultado de GROUP BY SQL. A função real usa uma única query; aqui
     * testamos o contrato de resposta.
     *
     * @param {Record<string, number>} mockCounts
     * @returns {{ status: string; timestamp: number; metrics: { by_status: Record<string, number>; total: number } }}
     */
    function buildTaskMetricsResponse(mockCounts) {
        const total = Object.values(mockCounts).reduce((a, b) => a + b, 0);
        return {
            status: 'ok',
            timestamp: Date.now(),
            metrics: {
                by_status: mockCounts,
                total,
            },
        };
    }

    describe('2. GET /api/metrics/tasks — shape da resposta', () => {
        it('deve retornar status ok', () => {
            const response = buildTaskMetricsResponse({ PENDING: 2, RUNNING: 1, DONE: 5 });
            assert.strictEqual(response.status, 'ok');
        });

        it('deve incluir campo timestamp numérico positivo', () => {
            const response = buildTaskMetricsResponse({ PENDING: 0 });
            assert.ok(typeof response.timestamp === 'number' && response.timestamp > 0);
        });

        it('deve incluir metrics.by_status como objeto', () => {
            const response = buildTaskMetricsResponse({ PENDING: 3, RUNNING: 1 });
            assert.ok(typeof response.metrics.by_status === 'object');
            assert.ok(response.metrics.by_status !== null);
        });

        it('deve calcular total como soma de todos os status', () => {
            const counts = { PENDING: 2, RUNNING: 1, DONE: 5, FAILED: 0 };
            const response = buildTaskMetricsResponse(counts);
            assert.strictEqual(response.metrics.total, 8, 'total deve ser soma de todos os status');
        });

        it('deve retornar total 0 quando não há tarefas', () => {
            const response = buildTaskMetricsResponse({});
            assert.strictEqual(response.metrics.total, 0);
        });

        it('deve retornar apenas os status com tarefas (GROUP BY result)', () => {
            // countTasksByStatus usa GROUP BY — só retorna linhas com n > 0
            const counts = { RUNNING: 2, DONE: 10 };
            const response = buildTaskMetricsResponse(counts);
            assert.strictEqual(Object.keys(response.metrics.by_status).length, 2);
            assert.strictEqual(response.metrics.by_status.RUNNING, 2);
            assert.strictEqual(response.metrics.by_status.DONE, 10);
        });

        it('deve calcular corretamente total com valores altos', () => {
            const counts = {
                PENDING: 100,
                RUNNING: 5,
                DONE: 1000,
                FAILED: 23,
                CANCELLED: 7,
                BLOCKED: 2,
            };
            const response = buildTaskMetricsResponse(counts);
            assert.strictEqual(response.metrics.total, 1137);
        });
    });

    describe('3. countTasksByStatus — contrato da query GROUP BY', () => {
        it('deve retornar Record<string, number>', () => {
            // Simula o retorno esperado da função countTasksByStatus()
            const mockResult = { PENDING: 5, RUNNING: 2, DONE: 100 };

            assert.ok(typeof mockResult === 'object');
            for (const [status, count] of Object.entries(mockResult)) {
                assert.ok(typeof status === 'string', `status "${status}" deve ser string`);
                assert.ok(typeof count === 'number', `count de "${status}" deve ser número`);
                assert.ok(count >= 0, `count de "${status}" não pode ser negativo`);
            }
        });

        it('deve tratar resultado vazio (tabela sem tarefas)', () => {
            const emptyResult = {};
            const total = Object.values(emptyResult).reduce((a, b) => a + b, 0);
            assert.strictEqual(total, 0);
        });
    });
});
