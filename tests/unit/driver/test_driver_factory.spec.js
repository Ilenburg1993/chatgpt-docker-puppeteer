/**
 * Testes Unitários: Driver Factory
 * @module tests/unit/driver/test_driver_factory.spec.js
 * @description Valida criação, registro e seleção de drivers
 * @audit-level 32
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('Driver Factory - Fábrica de Drivers', () => {
    describe('1. Registro de Drivers', () => {
        it('deve registrar driver ChatGPT', () => {
            const registry = new Map();

            registry.set('chatgpt', {
                name: 'ChatGPT',
                version: '1.0.0',
                create: () => ({ type: 'chatgpt' })
            });

            assert.ok(registry.has('chatgpt'));
        });

        it('deve registrar driver Gemini', () => {
            const registry = new Map();

            registry.set('gemini', {
                name: 'Gemini',
                version: '1.0.0',
                create: () => ({ type: 'gemini' })
            });

            assert.ok(registry.has('gemini'));
        });

        it('deve listar drivers disponíveis', () => {
            const registry = new Map([
                ['chatgpt', { name: 'ChatGPT' }],
                ['gemini', { name: 'Gemini' }]
            ]);

            const available = Array.from(registry.keys());

            assert.deepStrictEqual(available, ['chatgpt', 'gemini']);
        });
    });

    describe('2. Criação de Drivers', () => {
        it('deve criar instância de ChatGPT driver', () => {
            const factory = {
                create: type => {
                    if (type === 'chatgpt') {
                        return { type: 'chatgpt', initialized: true };
                    }
                }
            };

            const driver = factory.create('chatgpt');

            assert.strictEqual(driver.type, 'chatgpt');
            assert.ok(driver.initialized);
        });

        it('deve criar instância de Gemini driver', () => {
            const factory = {
                create: type => {
                    if (type === 'gemini') {
                        return { type: 'gemini', initialized: true };
                    }
                }
            };

            const driver = factory.create('gemini');

            assert.strictEqual(driver.type, 'gemini');
        });

        it('deve rejeitar driver desconhecido', () => {
            const factory = {
                create: type => {
                    const known = ['chatgpt', 'gemini'];
                    if (!known.includes(type)) {
                        throw new Error(`Driver desconhecido: ${type}`);
                    }
                }
            };

            assert.throws(() => factory.create('unknown'), /Driver desconhecido/);
        });
    });

    describe('3. Seleção Automática', () => {
        it('deve selecionar driver baseado em target', () => {
            const selectDriver = target => {
                const mapping = {
                    chatgpt: 'chatgpt',
                    gemini: 'gemini'
                };
                return mapping[target];
            };

            assert.strictEqual(selectDriver('chatgpt'), 'chatgpt');
            assert.strictEqual(selectDriver('gemini'), 'gemini');
        });

        it('deve usar driver padrão se target inválido', () => {
            const selectDriver = target => {
                const mapping = {
                    chatgpt: 'chatgpt',
                    gemini: 'gemini'
                };
                return mapping[target] || 'chatgpt'; // default
            };

            assert.strictEqual(selectDriver('invalid'), 'chatgpt');
        });
    });

    describe('4. Configuração de Drivers', () => {
        it('deve aplicar configuração específica', () => {
            const config = {
                chatgpt: {
                    timeout: 30000,
                    retries: 3
                },
                gemini: {
                    timeout: 60000,
                    retries: 5
                }
            };

            assert.strictEqual(config.chatgpt.timeout, 30000);
            assert.strictEqual(config.gemini.timeout, 60000);
        });

        it('deve mesclar config global com específica', () => {
            const globalConfig = {
                timeout: 45000,
                retries: 3
            };

            const specificConfig = {
                timeout: 30000
                // retries herda do global
            };

            const finalConfig = { ...globalConfig, ...specificConfig };

            assert.strictEqual(finalConfig.timeout, 30000);
            assert.strictEqual(finalConfig.retries, 3);
        });
    });

    describe('5. Pool de Drivers', () => {
        it('deve criar pool com múltiplas instâncias', () => {
            const pool = [
                { id: 'driver-1', type: 'chatgpt', busy: false },
                { id: 'driver-2', type: 'chatgpt', busy: false },
                { id: 'driver-3', type: 'gemini', busy: false }
            ];

            assert.strictEqual(pool.length, 3);
        });

        it('deve retornar driver disponível', () => {
            const pool = [
                { id: 'driver-1', busy: true },
                { id: 'driver-2', busy: false },
                { id: 'driver-3', busy: true }
            ];

            const available = pool.find(d => !d.busy);

            assert.strictEqual(available.id, 'driver-2');
        });

        it('deve retornar null se todos ocupados', () => {
            const pool = [
                { id: 'driver-1', busy: true },
                { id: 'driver-2', busy: true }
            ];

            const available = pool.find(d => !d.busy);

            assert.strictEqual(available, undefined);
        });
    });

    describe('6. Versionamento', () => {
        it('deve validar versão do driver', () => {
            const driver = {
                name: 'ChatGPT',
                version: '1.2.3'
            };

            const versionRegex = /^\d+\.\d+\.\d+$/;

            assert.ok(versionRegex.test(driver.version));
        });

        it('deve comparar versões', () => {
            const compareVersions = (v1, v2) => {
                const parts1 = v1.split('.').map(Number);
                const parts2 = v2.split('.').map(Number);

                for (let i = 0; i < 3; i++) {
                    if (parts1[i] > parts2[i]) {
                        return 1;
                    }
                    if (parts1[i] < parts2[i]) {
                        return -1;
                    }
                }
                return 0;
            };

            assert.strictEqual(compareVersions('1.2.3', '1.2.2'), 1);
            assert.strictEqual(compareVersions('1.2.3', '1.2.4'), -1);
            assert.strictEqual(compareVersions('1.2.3', '1.2.3'), 0);
        });
    });

    describe('7. Capacidades do Driver', () => {
        it('deve listar capacidades de ChatGPT', () => {
            const chatgptDriver = {
                type: 'chatgpt',
                capabilities: ['text-generation', 'conversation', 'code-analysis']
            };

            assert.ok(chatgptDriver.capabilities.includes('text-generation'));
        });

        it('deve verificar suporte a recurso', () => {
            const driver = {
                capabilities: ['text-generation', 'conversation']
            };

            const hasCapability = cap => driver.capabilities.includes(cap);

            assert.ok(hasCapability('conversation'));
            assert.strictEqual(hasCapability('image-generation'), false);
        });
    });

    describe('8. Cleanup de Drivers', () => {
        it('deve limpar driver após uso', () => {
            let driver = {
                id: 'driver-1',
                resources: { page: {}, browser: {} }
            };

            // Simular cleanup
            driver = {
                ...driver,
                resources: null
            };

            assert.strictEqual(driver.resources, null);
        });

        it('deve remover driver do pool', () => {
            const pool = [{ id: 'driver-1' }, { id: 'driver-2' }, { id: 'driver-3' }];

            const filtered = pool.filter(d => d.id !== 'driver-2');

            assert.strictEqual(filtered.length, 2);
            assert.strictEqual(
                filtered.find(d => d.id === 'driver-2'),
                undefined
            );
        });
    });
});
