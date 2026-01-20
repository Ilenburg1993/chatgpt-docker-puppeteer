/**
 * Testes Unitários: Schemas
 * @module tests/unit/core/test_schemas.spec.js
 * @description Valida schemas Zod para tarefas, DNA e configurações
 * @audit-level 100
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const schemas = require('../../../src/core/schemas');
const { criarLoggerSilencioso } = require('../../mocks/mock_logger');

// Usar logger silencioso para não poluir output dos testes
global.logger = criarLoggerSilencioso();

describe('Schemas - Validação de Dados com Zod', () => {
    describe('1. TaskSchema - Validação de Tarefas', () => {
        it('deve validar tarefa válida completa', () => {
            const tarefaValida = {
                id: 'task-001',
                target: 'gemini',
                prompt: 'Qual é a capital da França?',
                status: 'PENDING',
                priority: 5,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            const resultado = schemas.TaskSchema.safeParse(tarefaValida);

            assert.ok(resultado.success, 'Tarefa válida deve passar na validação');
            assert.strictEqual(resultado.data.id, 'task-001');
        });

        it('deve rejeitar tarefa sem campo obrigatório (target)', () => {
            const tarefaInvalida = {
                id: 'task-002',
                prompt: 'Teste sem target',
                status: 'PENDING'
            };

            const resultado = schemas.TaskSchema.safeParse(tarefaInvalida);

            assert.strictEqual(resultado.success, false, 'Deve falhar sem target');
            assert.ok(resultado.error, 'Deve ter erro de validação');
        });

        it('deve rejeitar tarefa com target inválido', () => {
            const tarefaInvalida = {
                id: 'task-003',
                target: 'invalid-target',
                prompt: 'Teste com target inválido',
                status: 'PENDING'
            };

            const resultado = schemas.TaskSchema.safeParse(tarefaInvalida);

            // Target deve ser 'chatgpt' ou 'gemini'
            assert.strictEqual(resultado.success, false, 'Target inválido deve falhar');
        });

        it('deve rejeitar tarefa com status inválido', () => {
            const tarefaInvalida = {
                id: 'task-004',
                target: 'gemini',
                prompt: 'Teste',
                status: 'INVALID_STATUS'
            };

            const resultado = schemas.TaskSchema.safeParse(tarefaInvalida);

            assert.strictEqual(resultado.success, false, 'Status inválido deve falhar');
        });

        it('deve aceitar tarefa mínima com campos obrigatórios', () => {
            const tarefaMinima = {
                target: 'chatgpt',
                prompt: 'Pergunta simples'
            };

            // parseTask cura a tarefa adicionando campos faltantes
            const resultado = schemas.parseTask(tarefaMinima);

            assert.ok(resultado, 'Tarefa mínima deve ser curada');
            assert.ok(resultado.id, 'Deve ter ID gerado');
            assert.strictEqual(resultado.target, 'chatgpt');
        });
    });

    describe('2. parseTask - Motor de Cura', () => {
        it('deve adicionar ID se não fornecido', () => {
            const tarefa = {
                target: 'gemini',
                prompt: 'Teste'
            };

            const curada = schemas.parseTask(tarefa);

            assert.ok(curada.id, 'Deve ter ID gerado');
            assert.match(curada.id, /^[a-f0-9-]+$/, 'ID deve ser válido');
        });

        it('deve adicionar timestamps se não fornecidos', () => {
            const tarefa = {
                id: 'task-005',
                target: 'chatgpt',
                prompt: 'Teste timestamps'
            };

            const curada = schemas.parseTask(tarefa);

            assert.ok(curada.createdAt, 'Deve ter createdAt');
            assert.ok(curada.updatedAt, 'Deve ter updatedAt');
        });

        it('deve definir status PENDING por padrão', () => {
            const tarefa = {
                target: 'gemini',
                prompt: 'Teste status'
            };

            const curada = schemas.parseTask(tarefa);

            assert.strictEqual(curada.status, 'PENDING', 'Status padrão deve ser PENDING');
        });

        it('deve preservar campos fornecidos', () => {
            const tarefa = {
                id: 'task-custom',
                target: 'chatgpt',
                prompt: 'Teste preservação',
                status: 'RUNNING',
                priority: 10
            };

            const curada = schemas.parseTask(tarefa);

            assert.strictEqual(curada.id, 'task-custom', 'ID deve ser preservado');
            assert.strictEqual(curada.status, 'RUNNING', 'Status deve ser preservado');
            assert.strictEqual(curada.priority, 10, 'Priority deve ser preservada');
        });
    });

    describe('3. DnaSchema - Validação de DNA', () => {
        it('deve validar DNA válido', () => {
            const dnaValido = {
                target: 'gemini',
                url: 'https://gemini.google.com',
                selectors: {
                    textbox: 'textarea[aria-label="Prompt"]',
                    sendButton: 'button[aria-label="Send"]'
                }
            };

            const resultado = schemas.DnaSchema.safeParse(dnaValido);

            assert.ok(resultado.success, 'DNA válido deve passar');
        });

        it('deve rejeitar DNA sem seletores', () => {
            const dnaInvalido = {
                target: 'chatgpt',
                url: 'https://chat.openai.com'
                // Falta selectors
            };

            const resultado = schemas.DnaSchema.safeParse(dnaInvalido);

            assert.strictEqual(resultado.success, false, 'DNA sem seletores deve falhar');
        });

        it('deve validar URL do DNA', () => {
            const dnaUrlInvalida = {
                target: 'gemini',
                url: 'not-a-valid-url',
                selectors: {
                    textbox: 'input'
                }
            };

            const resultado = schemas.DnaSchema.safeParse(dnaUrlInvalida);

            // Schema deve validar formato de URL
            assert.strictEqual(resultado.success, false, 'URL inválida deve falhar');
        });
    });

    describe('4. Tipos Compartilhados', () => {
        it('deve exportar tipos primitivos', () => {
            assert.ok(schemas.core.types, 'Deve exportar tipos');
            assert.ok(schemas.core.types.ID, 'Deve ter tipo ID');
            assert.ok(schemas.core.types.Timestamp, 'Deve ter tipo Timestamp');
            assert.ok(schemas.core.types.Status, 'Deve ter tipo Status');
        });

        it('deve validar tipo Status', () => {
            const StatusSchema = schemas.core.types.Status;

            assert.ok(StatusSchema.safeParse('PENDING').success);
            assert.ok(StatusSchema.safeParse('RUNNING').success);
            assert.ok(StatusSchema.safeParse('DONE').success);
            assert.ok(StatusSchema.safeParse('FAILED').success);
            assert.strictEqual(StatusSchema.safeParse('INVALID').success, false);
        });

        it('deve validar tipo Priority', () => {
            const PrioritySchema = schemas.core.types.Priority;

            assert.ok(PrioritySchema.safeParse(1).success, 'Priority 1 válida');
            assert.ok(PrioritySchema.safeParse(10).success, 'Priority 10 válida');
            assert.strictEqual(PrioritySchema.safeParse(0).success, false, 'Priority 0 inválida');
            assert.strictEqual(PrioritySchema.safeParse(11).success, false, 'Priority 11 inválida');
        });
    });

    describe('5. Integração com Fixtures', () => {
        it('deve validar fixture de tarefa Gemini', () => {
            const fixture = require('../../fixtures/tasks/tarefa-valida-gemini.fixture.json');

            const resultado = schemas.TaskSchema.safeParse(fixture);

            assert.ok(resultado.success, 'Fixture Gemini deve ser válida');
            assert.strictEqual(resultado.data.target, 'gemini');
        });

        it('deve validar fixture de tarefa ChatGPT', () => {
            const fixture = require('../../fixtures/tasks/tarefa-valida-chatgpt.fixture.json');

            const resultado = schemas.TaskSchema.safeParse(fixture);

            assert.ok(resultado.success, 'Fixture ChatGPT deve ser válida');
            assert.strictEqual(resultado.data.target, 'chatgpt');
        });

        it('deve rejeitar fixture inválida', () => {
            const fixture = require('../../fixtures/tasks/tarefa-invalida.fixture.json');

            const resultado = schemas.TaskSchema.safeParse(fixture);

            assert.strictEqual(resultado.success, false, 'Fixture inválida deve falhar');
        });
    });
});
