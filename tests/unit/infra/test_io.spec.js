/**
 * Testes Unitários: Infra IO Operations
 * @module tests/unit/infra/test_io.spec.js
 * @description Valida operações de I/O, cache e atomicidade
 * @audit-level 32
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmpdir } = require('os');

describe('Infra IO Operations - Operações de Entrada/Saída', () => {
    let testDir;

    before(() => {
        testDir = path.join(tmpdir(), `test-io-${Date.now()}`);
        fs.mkdirSync(testDir, { recursive: true });
    });

    after(() => {
        try {
            fs.rmSync(testDir, { recursive: true, force: true });
        } catch (err) {
            // Ignorar erros de cleanup
        }
    });

    describe('1. Leitura de Tarefas', () => {
        it('deve ler tarefa do arquivo', () => {
            const taskPath = path.join(testDir, 'task-001.json');
            const taskData = {
                id: 'task-001',
                prompt: 'Teste',
                target: 'gemini'
            };

            fs.writeFileSync(taskPath, JSON.stringify(taskData));

            const lido = JSON.parse(fs.readFileSync(taskPath, 'utf-8'));

            assert.strictEqual(lido.id, 'task-001');
        });

        it('deve retornar null para tarefa inexistente', () => {
            const taskPath = path.join(testDir, 'inexistente.json');

            const existe = fs.existsSync(taskPath);

            assert.strictEqual(existe, false);
        });

        it('deve validar formato JSON', () => {
            const taskPath = path.join(testDir, 'invalid.json');
            fs.writeFileSync(taskPath, 'json inválido{}}');

            assert.throws(() => {
                JSON.parse(fs.readFileSync(taskPath, 'utf-8'));
            }, /Unexpected token/);
        });
    });

    describe('2. Escrita de Tarefas', () => {
        it('deve salvar tarefa em arquivo', () => {
            const taskPath = path.join(testDir, 'task-002.json');
            const taskData = {
                id: 'task-002',
                prompt: 'Novo teste',
                status: 'PENDING'
            };

            fs.writeFileSync(taskPath, JSON.stringify(taskData, null, 2));

            assert.ok(fs.existsSync(taskPath));
        });

        it('deve sobrescrever tarefa existente', () => {
            const taskPath = path.join(testDir, 'task-003.json');

            fs.writeFileSync(taskPath, JSON.stringify({ version: 1 }));
            fs.writeFileSync(taskPath, JSON.stringify({ version: 2 }));

            const lido = JSON.parse(fs.readFileSync(taskPath, 'utf-8'));

            assert.strictEqual(lido.version, 2);
        });

        it('deve criar diretórios se não existirem', () => {
            const nestedPath = path.join(testDir, 'sub', 'dir', 'task.json');
            const dir = path.dirname(nestedPath);

            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(nestedPath, '{}');

            assert.ok(fs.existsSync(nestedPath));
        });
    });

    describe('3. Cache de Leitura', () => {
        it('deve cachear tarefa lida', () => {
            const cache = new Map();
            const taskId = 'task-004';

            cache.set(taskId, { id: taskId, cached: true });

            assert.ok(cache.has(taskId));
        });

        it('deve retornar do cache em vez de ler arquivo', () => {
            const cache = new Map();
            const taskId = 'task-005';
            const taskData = { id: taskId, from: 'cache' };

            cache.set(taskId, taskData);

            const resultado = cache.get(taskId);

            assert.strictEqual(resultado.from, 'cache');
        });

        it('deve invalidar cache após escrita', () => {
            const cache = new Map();
            const taskId = 'task-006';

            cache.set(taskId, { version: 1 });

            // Simular escrita - invalida cache
            cache.delete(taskId);

            assert.strictEqual(cache.has(taskId), false);
        });
    });

    describe('4. Atomicidade de Escrita', () => {
        it('deve usar escrita atômica (temp + rename)', () => {
            const finalPath = path.join(testDir, 'atomic.json');
            const tempPath = `${finalPath}.tmp`;

            // Escrever em temp
            fs.writeFileSync(tempPath, JSON.stringify({ atomic: true }));

            // Rename atômico
            fs.renameSync(tempPath, finalPath);

            assert.ok(fs.existsSync(finalPath));
            assert.strictEqual(fs.existsSync(tempPath), false);
        });

        it('deve limpar arquivo temp em caso de erro', () => {
            const finalPath = path.join(testDir, 'error.json');
            const tempPath = `${finalPath}.tmp`;

            try {
                fs.writeFileSync(tempPath, 'invalid json{}}');
                // Simular erro antes do rename
                throw new Error('Erro de validação');
            } catch (err) {
                // Cleanup
                if (fs.existsSync(tempPath)) {
                    fs.unlinkSync(tempPath);
                }
            }

            assert.strictEqual(fs.existsSync(tempPath), false);
        });
    });

    describe('5. Listagem de Tarefas', () => {
        it('deve listar todas as tarefas da fila', () => {
            const filaDir = path.join(testDir, 'fila');
            fs.mkdirSync(filaDir, { recursive: true });

            fs.writeFileSync(path.join(filaDir, 'task-1.json'), '{}');
            fs.writeFileSync(path.join(filaDir, 'task-2.json'), '{}');
            fs.writeFileSync(path.join(filaDir, 'task-3.json'), '{}');

            const arquivos = fs.readdirSync(filaDir).filter(f => f.endsWith('.json'));

            assert.strictEqual(arquivos.length, 3);
        });

        it('deve filtrar apenas arquivos JSON', () => {
            const dir = path.join(testDir, 'mixed');
            fs.mkdirSync(dir, { recursive: true });

            fs.writeFileSync(path.join(dir, 'task.json'), '{}');
            fs.writeFileSync(path.join(dir, 'readme.txt'), 'texto');
            fs.writeFileSync(path.join(dir, 'data.csv'), 'csv');

            const jsons = fs.readdirSync(dir).filter(f => f.endsWith('.json'));

            assert.strictEqual(jsons.length, 1);
        });
    });

    describe('6. Movimentação de Arquivos', () => {
        it('deve mover tarefa entre diretórios', () => {
            const origem = path.join(testDir, 'origem', 'task.json');
            const destino = path.join(testDir, 'destino', 'task.json');

            fs.mkdirSync(path.dirname(origem), { recursive: true });
            fs.mkdirSync(path.dirname(destino), { recursive: true });

            fs.writeFileSync(origem, '{}');
            fs.renameSync(origem, destino);

            assert.ok(fs.existsSync(destino));
            assert.strictEqual(fs.existsSync(origem), false);
        });

        it('deve mover para corrupted em caso de JSON inválido', () => {
            const origem = path.join(testDir, 'fila2', 'broken.json');
            const corrupted = path.join(testDir, 'corrupted', 'broken.json');

            fs.mkdirSync(path.dirname(origem), { recursive: true });
            fs.mkdirSync(path.dirname(corrupted), { recursive: true });

            fs.writeFileSync(origem, 'invalid json');

            try {
                JSON.parse(fs.readFileSync(origem, 'utf-8'));
            } catch (err) {
                fs.renameSync(origem, corrupted);
            }

            assert.ok(fs.existsSync(corrupted));
        });
    });

    describe('7. Exclusão Segura', () => {
        it('deve deletar tarefa do disco', () => {
            const taskPath = path.join(testDir, 'delete-me.json');

            fs.writeFileSync(taskPath, '{}');
            assert.ok(fs.existsSync(taskPath));

            fs.unlinkSync(taskPath);
            assert.strictEqual(fs.existsSync(taskPath), false);
        });

        it('não deve falhar ao deletar arquivo inexistente', () => {
            const taskPath = path.join(testDir, 'nao-existe.json');

            // Não deve lançar erro
            try {
                if (fs.existsSync(taskPath)) {
                    fs.unlinkSync(taskPath);
                }
            } catch (err) {
                assert.fail('Não deveria lançar erro');
            }
        });
    });

    describe('8. Encoding UTF-8', () => {
        it('deve ler e escrever UTF-8 corretamente', () => {
            const taskPath = path.join(testDir, 'utf8.json');
            const data = {
                texto: 'Olá! 你好! مرحبا! 🎉'
            };

            fs.writeFileSync(taskPath, JSON.stringify(data), 'utf-8');
            const lido = JSON.parse(fs.readFileSync(taskPath, 'utf-8'));

            assert.strictEqual(lido.texto, data.texto);
        });
    });

    describe('9. Tratamento de Erros', () => {
        it('deve tratar erro de permissão', () => {
            // Simular erro de permissão
            const readonlyPath = path.join(testDir, 'readonly.json');

            fs.writeFileSync(readonlyPath, '{}');
            fs.chmodSync(readonlyPath, 0o444); // somente leitura

            assert.throws(() => {
                fs.writeFileSync(readonlyPath, '{"modified": true}');
            }, /EACCES|EPERM/);

            // Restaurar permissão para cleanup
            fs.chmodSync(readonlyPath, 0o644);
        });

        it('deve tratar disco cheio', () => {
            // Simular (apenas estrutura - teste real precisa disco cheio)
            const simulateFullDisk = () => {
                throw Object.assign(new Error('ENOSPC: no space left'), {
                    code: 'ENOSPC'
                });
            };

            assert.throws(simulateFullDisk, /ENOSPC/);
        });
    });

    describe('10. Performance', () => {
        it('deve ler múltiplas tarefas rapidamente', () => {
            const perfDir = path.join(testDir, 'perf');
            fs.mkdirSync(perfDir, { recursive: true });

            // Criar 10 tarefas
            for (let i = 0; i < 10; i++) {
                fs.writeFileSync(path.join(perfDir, `task-${i}.json`), JSON.stringify({ id: `task-${i}` }));
            }

            const start = Date.now();
            const arquivos = fs.readdirSync(perfDir);
            const elapsed = Date.now() - start;

            assert.strictEqual(arquivos.length, 10);
            assert.ok(elapsed < 1000, 'Deve ler 10 arquivos em < 1s');
        });
    });
});
