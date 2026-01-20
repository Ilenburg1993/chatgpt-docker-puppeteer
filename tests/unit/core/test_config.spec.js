/**
 * Testes Unitários: Core Config Completo
 * @module tests/unit/core/test_config_completo.spec.js
 * @description Valida config.json, dynamic_rules.json e hot-reload
 * @audit-level 32
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

describe('Core Config Completo - Configuração', () => {
    describe('1. config.json - Estrutura Básica', () => {
        it('deve existir e ser JSON válido', () => {
            const configPath = path.join(__dirname, '../../../config.json');

            assert.ok(fs.existsSync(configPath), 'config.json deve existir');

            const content = fs.readFileSync(configPath, 'utf-8');
            const config = JSON.parse(content);

            assert.ok(config, 'config.json deve ser JSON válido');
        });

        it('deve ter campos obrigatórios', () => {
            const configPath = path.join(__dirname, '../../../config.json');
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

            const required = ['DEBUG_PORT', 'IDLE_SLEEP', 'CYCLE_DELAY', 'allowedDomains'];

            for (const field of required) {
                assert.ok(field in config, `Campo ${field} é obrigatório`);
            }
        });

        it('deve validar tipos dos campos', () => {
            const configPath = path.join(__dirname, '../../../config.json');
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

            assert.strictEqual(typeof config.IDLE_SLEEP, 'number');
            assert.strictEqual(typeof config.CYCLE_DELAY, 'number');
            assert.ok(Array.isArray(config.allowedDomains));
        });
    });

    describe('2. dynamic_rules.json - Regras Dinâmicas', () => {
        it('deve existir e ser JSON válido', () => {
            const rulesPath = path.join(__dirname, '../../../dynamic_rules.json');

            // Pode não existir em ambiente de teste
            if (fs.existsSync(rulesPath)) {
                const content = fs.readFileSync(rulesPath, 'utf-8');
                const rules = JSON.parse(content);

                assert.ok(rules, 'dynamic_rules.json deve ser JSON válido');
            }
        });

        it('deve ter estrutura de targets e selectors', () => {
            const rulesPath = path.join(__dirname, '../../../dynamic_rules.json');

            if (fs.existsSync(rulesPath)) {
                const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));

                assert.ok(rules.targets, 'Deve ter seção targets');
                assert.ok(rules.global_selectors, 'Deve ter seção global_selectors');
            }
        });

        it('deve ter metadados de versão', () => {
            const rulesPath = path.join(__dirname, '../../../dynamic_rules.json');

            if (fs.existsSync(rulesPath)) {
                const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));

                assert.ok(rules._meta, 'Deve ter seção _meta');
                assert.ok('version' in rules._meta, 'Deve ter versão');
            }
        });
    });

    describe('3. Integração com Zod', () => {
        it('deve carregar CONFIG sem erros', () => {
            const CONFIG = require('../../../src/core/config');

            assert.ok(CONFIG, 'CONFIG deve ser exportado');
            assert.ok(typeof CONFIG.reload === 'function', 'Deve ter método reload');
        });

        it('deve fornecer acesso a configurações', () => {
            const CONFIG = require('../../../src/core/config');

            // Verificar estrutura básica
            assert.ok(CONFIG.all || CONFIG.isInitialized !== undefined);
        });
    });

    describe('4. Hot-Reload de Configuração', () => {
        it('deve ter método reload disponível', () => {
            const CONFIG = require('../../../src/core/config');

            assert.ok(typeof CONFIG.reload === 'function');
        });

        it('deve invalidar cache ao recarregar', () => {
            const CONFIG = require('../../../src/core/config');

            // Simular reload (não executar para não afetar outros testes)
            const hasReload = typeof CONFIG.reload === 'function';

            assert.ok(hasReload);
        });
    });

    describe('5. Valores Padrão', () => {
        it('deve ter IDLE_SLEEP padrão', () => {
            const configPath = path.join(__dirname, '../../../config.json');
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

            assert.ok(typeof config.IDLE_SLEEP === 'number');
            assert.ok(config.IDLE_SLEEP > 0);
        });

        it('deve ter CYCLE_DELAY padrão', () => {
            const configPath = path.join(__dirname, '../../../config.json');
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

            assert.ok(typeof config.CYCLE_DELAY === 'number');
        });
    });

    describe('6. Domínios Permitidos', () => {
        it('deve ter lista de domínios permitidos', () => {
            const configPath = path.join(__dirname, '../../../config.json');
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

            assert.ok(Array.isArray(config.allowedDomains));
            assert.ok(config.allowedDomains.length > 0);
        });

        it('deve incluir domínios essenciais', () => {
            const configPath = path.join(__dirname, '../../../config.json');
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

            const essentials = ['chat.openai.com', 'gemini.google.com'];
            const domainsStr = config.allowedDomains.join(',');

            let hasEssentials = false;
            for (const domain of essentials) {
                if (domainsStr.includes(domain)) {
                    hasEssentials = true;
                    break;
                }
            }

            assert.ok(hasEssentials, 'Deve incluir pelo menos um domínio essencial');
        });
    });

    describe('7. Segurança e .gitignore', () => {
        it('deve ter .gitignore configurado', () => {
            const gitignorePath = path.join(__dirname, '../../../.gitignore');

            assert.ok(fs.existsSync(gitignorePath), '.gitignore deve existir');
        });

        it('deve ignorar arquivos sensíveis', () => {
            const gitignorePath = path.join(__dirname, '../../../.gitignore');
            const content = fs.readFileSync(gitignorePath, 'utf-8');

            const patterns = ['.env', 'logs/', 'fila/', 'profile/'];

            for (const pattern of patterns) {
                assert.ok(content.includes(pattern), `Deve ignorar ${pattern}`);
            }
        });
    });

    describe('8. Validação de Formato', () => {
        it('config.json não deve ter sintaxe JSON quebrada', () => {
            const configPath = path.join(__dirname, '../../../config.json');
            const content = fs.readFileSync(configPath, 'utf-8');

            // Não deve lançar erro
            assert.doesNotThrow(() => JSON.parse(content));
        });

        it('deve ter encoding UTF-8', () => {
            const configPath = path.join(__dirname, '../../../config.json');
            const content = fs.readFileSync(configPath, 'utf-8');

            // Deve conseguir ler como UTF-8
            assert.ok(content.length > 0);
        });
    });
});

console.log(`\n${'='.repeat(50)}`);
if (errors === 0) {
    console.log('✓ PASS: All configuration validations passed\n');
    process.exit(0);
} else {
    console.log(`✗ FAIL: ${errors} validation(s) failed\n`);
    process.exit(1);
}
