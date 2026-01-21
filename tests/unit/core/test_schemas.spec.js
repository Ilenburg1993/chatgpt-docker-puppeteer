/**
 * @file tests/unit/core/test_schemas.spec.js
 * Testes unitários para validação de schemas Zod (Task V4 + DNA)
 * FASE 3 - Cobertura de Core/Schemas
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const schemas = require('../../../src/core/schemas');
const { STATUS_VALUES } = require('../../../src/core/constants/tasks');

describe('Task Schema Validation', () => {
    describe('Validação de tarefas válidas', () => {
        it('deve validar tarefa válida completa', () => {
            const tarefaValida = {
                meta: {
                    id: 'task-001',
                    created_at: new Date().toISOString(),
                    priority: 5,
                    source: 'api',
                    tags: ['unit-test']
                },
                spec: {
                    target: 'gemini',
                    payload: {
                        user_message: 'Qual é a capital da França?'
                    }
                },
                state: {
                    status: STATUS_VALUES.PENDING,
                    attempts: 0
                }
            };

            const resultado = schemas.parseTask(tarefaValida);

            assert.ok(resultado, 'Tarefa válida deve passar na validação');
            assert.strictEqual(resultado.meta.id, 'task-001');
            assert.strictEqual(resultado.spec.target, 'gemini');
            assert.strictEqual(resultado.state.status, STATUS_VALUES.PENDING);
        });

        it('deve aceitar tarefa mínima com campos obrigatórios', () => {
            const tarefaMinima = {
                meta: {
                    id: 'task-min',
                    created_at: new Date().toISOString(),
                    priority: 5,
                    source: 'manual'
                },
                spec: {
                    target: 'chatgpt',
                    payload: {
                        user_message: 'Teste mínimo'
                    }
                },
                state: {
                    status: STATUS_VALUES.PENDING,
                    attempts: 0
                }
            };

            const resultado = schemas.parseTask(tarefaMinima);

            assert.ok(resultado, 'Tarefa mínima deve ser válida');
            assert.strictEqual(resultado.spec.target, 'chatgpt');
            assert.strictEqual(resultado.spec.payload.user_message, 'Teste mínimo');
        });

        it('deve migrar ID do root para meta.id (healer)', () => {
            // O healer migra raw.id -> meta.id, não gera automaticamente
            const tarefaLegacyId = {
                id: 'legacy-001', // ID no formato V1/V2 (root level)
                meta: {
                    created_at: new Date().toISOString(),
                    priority: 5,
                    source: 'api'
                },
                spec: {
                    target: 'gemini',
                    payload: {
                        user_message: 'ID legado'
                    }
                },
                state: {
                    status: STATUS_VALUES.PENDING,
                    attempts: 0
                }
            };

            const resultado = schemas.parseTask(tarefaLegacyId);

            assert.ok(resultado.meta.id, 'Deve migrar ID do root para meta.id');
            assert.strictEqual(resultado.meta.id, 'legacy-001');
        });

        it('deve adicionar timestamps se não fornecidos', () => {
            const tarefaSemTimestamps = {
                meta: {
                    id: 'task-ts',
                    priority: 3,
                    source: 'gui'
                },
                spec: {
                    target: 'chatgpt',
                    payload: {
                        user_message: 'Teste timestamps'
                    }
                },
                state: {
                    status: STATUS_VALUES.PENDING,
                    attempts: 0
                }
            };

            const resultado = schemas.parseTask(tarefaSemTimestamps);

            assert.ok(resultado.meta.created_at, 'Deve adicionar created_at');
            assert.ok(new Date(resultado.meta.created_at).getTime() > 0, 'created_at deve ser válido');
        });

        it('deve definir status PENDING por padrão', () => {
            const tarefaSemStatus = {
                meta: {
                    id: 'task-status',
                    created_at: new Date().toISOString(),
                    priority: 5,
                    source: 'flow_manager'
                },
                spec: {
                    target: 'gemini',
                    payload: {
                        user_message: 'Teste status'
                    }
                }
            };

            const resultado = schemas.parseTask(tarefaSemStatus);

            assert.strictEqual(resultado.state.status, STATUS_VALUES.PENDING);
        });

        it('deve preservar campos opcionais fornecidos', () => {
            const tarefaCompleta = {
                meta: {
                    id: 'task-completa',
                    project_id: 'proj-123',
                    parent_id: 'parent-456',
                    correlation_id: 'corr-789',
                    created_at: new Date().toISOString(),
                    priority: 7,
                    source: 'api',
                    tags: ['test', 'priority']
                },
                spec: {
                    target: 'chatgpt',
                    model: 'gpt-4',
                    payload: {
                        system_message: 'Você é um assistente útil',
                        user_message: 'Teste completo',
                        context: 'Contexto adicional'
                    },
                    parameters: {
                        temperature: 0.7,
                        max_tokens: 1000
                    }
                },
                state: {
                    status: STATUS_VALUES.PENDING,
                    attempts: 0
                }
            };

            const resultado = schemas.parseTask(tarefaCompleta);

            assert.strictEqual(resultado.meta.project_id, 'proj-123');
            assert.strictEqual(resultado.meta.parent_id, 'parent-456');
            assert.strictEqual(resultado.spec.model, 'gpt-4');
            assert.strictEqual(resultado.spec.payload.system_message, 'Você é um assistente útil');
            assert.strictEqual(resultado.spec.parameters.temperature, 0.7);
        });
    });

    describe('Validação de tarefas inválidas', () => {
        it('deve rejeitar tarefa sem target', () => {
            const tarefaInvalida = {
                meta: {
                    id: 'task-no-target',
                    created_at: new Date().toISOString(),
                    priority: 5,
                    source: 'manual'
                },
                spec: {
                    payload: {
                        user_message: 'Sem target'
                    }
                },
                state: {
                    status: STATUS_VALUES.PENDING,
                    attempts: 0
                }
            };

            assert.throws(
                () => {
                    schemas.parseTask(tarefaInvalida);
                },
                /target/i,
                'Deve lançar erro sobre target ausente'
            );
        });

        it('deve rejeitar tarefa com target vazio', () => {
            const tarefaInvalida = {
                meta: {
                    id: 'task-empty-target',
                    created_at: new Date().toISOString(),
                    priority: 5,
                    source: 'manual'
                },
                spec: {
                    target: '',
                    payload: {
                        user_message: 'Target vazio'
                    }
                }
            };

            assert.throws(() => {
                schemas.parseTask(tarefaInvalida);
            }, 'Deve rejeitar target vazio');
        });

        it('deve rejeitar tarefa sem user_message', () => {
            const tarefaInvalida = {
                meta: {
                    id: 'task-no-msg',
                    created_at: new Date().toISOString(),
                    priority: 5,
                    source: 'manual'
                },
                spec: {
                    target: 'gemini',
                    payload: {}
                }
            };

            assert.throws(
                () => {
                    schemas.parseTask(tarefaInvalida);
                },
                /user_message/i,
                'Deve lançar erro sobre user_message ausente'
            );
        });

        it('deve rejeitar prioridade negativa', () => {
            const tarefaInvalida = {
                meta: {
                    id: 'task-bad-priority',
                    created_at: new Date().toISOString(),
                    priority: -5, // Prioridade negativa é inválida
                    source: 'manual'
                },
                spec: {
                    target: 'chatgpt',
                    payload: {
                        user_message: 'Prioridade inválida'
                    }
                }
            };

            assert.throws(() => {
                schemas.parseTask(tarefaInvalida);
            }, 'Deve rejeitar prioridade negativa');
        });

        it('deve rejeitar status inválido', () => {
            const tarefaInvalida = {
                meta: {
                    id: 'task-bad-status',
                    created_at: new Date().toISOString(),
                    priority: 5,
                    source: 'manual'
                },
                spec: {
                    target: 'gemini',
                    payload: {
                        user_message: 'Status inválido'
                    }
                },
                state: {
                    status: 'INVALID_STATUS',
                    attempts: 0
                }
            };

            assert.throws(() => {
                schemas.parseTask(tarefaInvalida);
            }, 'Deve rejeitar status não reconhecido');
        });
    });

    describe('Validação de DNA (identidade)', () => {
        it('deve validar DNA completo com targets', () => {
            const dnaCompleto = {
                targets: {
                    'chatgpt.com': {
                        selectors: {
                            input_box: ['#prompt-textarea', 'textarea'],
                            send_button: ['button[data-testid="send-button"]']
                        },
                        behavior_overrides: {
                            idle_sleep_ms: 100,
                            typing_speed_factor: 1.5
                        }
                    }
                },
                global_selectors: {
                    input_box: ['textarea', '[contenteditable="true"]'],
                    send_button: ['button[type="submit"]']
                }
            };

            const resultado = schemas.DnaSchema.safeParse(dnaCompleto);

            if (!resultado.success) {
                console.error('Erro DNA completo:', JSON.stringify(resultado.error.issues, null, 2));
            }

            assert.ok(resultado.success, 'DNA completo deve passar');
            assert.strictEqual(resultado.data._meta.version, 1);
            assert.ok(resultado.data.targets['chatgpt.com']);
            assert.strictEqual(resultado.data.targets['chatgpt.com'].selectors.input_box[0], '#prompt-textarea');
        });

        it('deve validar DNA vazio com defaults', () => {
            const dnaMinimo = {};

            const resultado = schemas.DnaSchema.safeParse(dnaMinimo);

            if (!resultado.success) {
                console.error('Erro DNA vazio:', JSON.stringify(resultado.error.issues, null, 2));
            }

            assert.ok(resultado.success, 'DNA vazio deve passar');
            assert.ok(resultado.data._meta);
            assert.strictEqual(resultado.data._meta.version, 1);
            assert.ok(resultado.data._meta.last_updated);
            assert.strictEqual(resultado.data._meta.evolution_count, 0);
        });

        it('deve validar DNA com SelectorProtocol SADI V10+', () => {
            const dnaSADI = {
                targets: {
                    'gemini.google.com': {
                        selectors: {
                            input_box: {
                                selector: 'textarea#prompt',
                                context: 'root',
                                isShadow: false,
                                frameSelector: null,
                                framePath: null,
                                timestamp: Date.now()
                            }
                        }
                    }
                }
            };

            const resultado = schemas.DnaSchema.safeParse(dnaSADI);

            if (!resultado.success) {
                console.error('Erro DNA SADI:', JSON.stringify(resultado.error.issues, null, 2));
            }

            assert.ok(resultado.success, 'DNA com SelectorProtocol deve passar');
            assert.ok(resultado.data.targets['gemini.google.com']);
        });
    });
});
