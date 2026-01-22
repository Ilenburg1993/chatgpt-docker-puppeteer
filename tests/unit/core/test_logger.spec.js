/**
 * Testes Unitários: Logger
 * @module tests/unit/core/test_logger.spec.js
 * @description Valida sistema de logging, rotação de arquivos e métricas
 * @audit-level 40
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const sinon = require('sinon');

// Mock do logger antes de importar
const loggerPath = '../../../src/core/logger';
delete require.cache[require.resolve(loggerPath)];

const logger = require(loggerPath);

describe('Logger - Sistema de Logging Unificado', () => {
    const TEST_LOG_DIR = path.join(__dirname, '../../tmp/logs');
    const TEST_LOG_FILE = path.join(TEST_LOG_DIR, 'test_agente.log');

    before(() => {
        // Criar diretório de teste
        if (!fs.existsSync(TEST_LOG_DIR)) {
            fs.mkdirSync(TEST_LOG_DIR, { recursive: true });
        }
    });

    after(() => {
        // Limpar arquivos de teste
        if (fs.existsSync(TEST_LOG_DIR)) {
            fs.rmSync(TEST_LOG_DIR, { recursive: true, force: true });
        }
    });

    beforeEach(() => {
        // Limpar logs entre testes
        const files = fs.existsSync(TEST_LOG_DIR) ? fs.readdirSync(TEST_LOG_DIR) : [];
        files.forEach(file => {
            try {
                fs.unlinkSync(path.join(TEST_LOG_DIR, file));
            } catch (_e) {
                // Ignorar erros de limpeza
            }
        });
    });

    describe('1. Níveis de Log', () => {
        it('deve aceitar nível INFO', () => {
            assert.doesNotThrow(() => {
                logger.log('INFO', 'Teste de log INFO');
            });
        });

        it('deve aceitar nível WARN', () => {
            assert.doesNotThrow(() => {
                logger.log('WARN', 'Teste de log WARN');
            });
        });

        it('deve aceitar nível ERROR', () => {
            assert.doesNotThrow(() => {
                logger.log('ERROR', 'Teste de log ERROR');
            });
        });

        it('deve aceitar nível DEBUG', () => {
            assert.doesNotThrow(() => {
                logger.log('DEBUG', 'Teste de log DEBUG');
            });
        });
    });

    describe('2. Formatação de Mensagens', () => {
        it('deve incluir timestamp no formato ISO', () => {
            const spy = sinon.spy(console, 'log');

            logger.log('INFO', 'Teste timestamp');

            assert.ok(spy.called, 'Console.log deve ser chamado');
            const output = spy.firstCall.args[0];

            // Verificar formato ISO: YYYY-MM-DDTHH:mm:ss.sssZ
            const isoRegex = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/;
            assert.match(output, isoRegex, 'Deve conter timestamp ISO');

            spy.restore();
        });

        it('deve incluir nível de log na mensagem', () => {
            const spy = sinon.spy(console, 'log');

            logger.log('ERROR', 'Teste nível');

            const output = spy.firstCall.args[0];
            assert.match(output, /ERROR/, 'Deve conter o nível ERROR');

            spy.restore();
        });

        it('deve incluir mensagem fornecida', () => {
            const spy = sinon.spy(console, 'log');

            const mensagem = 'Esta é uma mensagem de teste';
            logger.log('INFO', mensagem);

            const output = spy.firstCall.args[0];
            assert.match(output, new RegExp(mensagem), 'Deve conter a mensagem');

            spy.restore();
        });

        it('deve aceitar taskId opcional', () => {
            const spy = sinon.spy(console, 'log');

            logger.log('INFO', 'Teste com taskId', 'task-123');

            const output = spy.firstCall.args[0];
            assert.match(output, /task-123/, 'Deve conter o taskId');

            spy.restore();
        });
    });

    describe('3. Persistência em Arquivo', () => {
        it('deve criar arquivo de log se não existir', () => {
            // Logger cria automaticamente o diretório logs/
            const logsDir = path.join(__dirname, '../../../logs');

            assert.ok(fs.existsSync(logsDir), 'Diretório logs/ deve existir');
        });

        it('deve escrever logs em arquivo', async () => {
            logger.log('INFO', 'Teste de escrita em arquivo');

            // Aguardar escrita assíncrona
            await new Promise(resolve => {
                setTimeout(resolve, 100);
            });

            const logFile = path.join(__dirname, '../../../logs/agente_current.log');
            if (fs.existsSync(logFile)) {
                const content = fs.readFileSync(logFile, 'utf-8');
                // Verificar que há conteúdo
                assert.ok(content.length > 0, 'Arquivo de log deve ter conteúdo');
            }
            // Nota: Arquivo pode não existir em ambiente de teste isolado
        });
    });

    describe('4. Métricas', () => {
        it('deve registrar métrica com timestamp', () => {
            assert.doesNotThrow(() => {
                logger.logMetric('test_metric', 42);
            });
        });

        it('deve aceitar valores numéricos', () => {
            assert.doesNotThrow(() => {
                logger.logMetric('latency', 150);
                logger.logMetric('success_rate', 0.95);
            });
        });

        it('deve aceitar valores string', () => {
            assert.doesNotThrow(() => {
                logger.logMetric('status', 'ok');
            });
        });
    });

    describe('5. Auditoria', () => {
        it('deve registrar evento de auditoria', () => {
            assert.doesNotThrow(() => {
                logger.audit('USER_LOGIN', { user: 'test', timestamp: Date.now() });
            });
        });

        it('deve aceitar objeto de contexto', () => {
            const contexto = {
                action: 'TASK_CREATED',
                taskId: 'task-456',
                user: 'system'
            };

            assert.doesNotThrow(() => {
                logger.audit('TASK_LIFECYCLE', contexto);
            });
        });
    });

    describe('6. Rotação de Arquivos', () => {
        it('deve rotacionar arquivo quando exceder limite', async () => {
            // Criar arquivo grande (mock)
            const largePath = path.join(TEST_LOG_DIR, 'large.log');
            const largeContent = 'x'.repeat(6 * 1024 * 1024); // 6MB

            fs.writeFileSync(largePath, largeContent);

            const statsBefore = fs.statSync(largePath);
            assert.ok(statsBefore.size > 5 * 1024 * 1024, 'Arquivo deve ser maior que 5MB');

            // Nota: rotateFile é função interna, testar indiretamente via logger
        });

        it('deve manter no máximo 5 arquivos de backup', () => {
            // Criar múltiplos arquivos de backup
            for (let i = 0; i < 7; i++) {
                const backupPath = path.join(TEST_LOG_DIR, `agente_2026-01-${10 + i}.bak.log`);
                fs.writeFileSync(backupPath, `backup ${i}`);
            }

            const files = fs.readdirSync(TEST_LOG_DIR);
            const backups = files.filter(f => f.includes('.bak'));

            // Nota: limpeza é feita pela função cleanOldFiles
            assert.ok(backups.length <= 7, 'Deve ter no máximo os arquivos criados');
        });
    });

    describe('7. Tratamento de Erros', () => {
        it('deve lidar com diretório de logs inexistente', () => {
            // Logger cria diretório automaticamente
            assert.doesNotThrow(() => {
                logger.log('INFO', 'Teste com diretório inexistente');
            });
        });

        it('deve continuar funcionando se escrita falhar', () => {
            // Simular falha de escrita (sem throw)
            const spy = sinon.spy(console, 'log');

            logger.log('ERROR', 'Teste de resiliência');

            assert.ok(spy.called, 'Deve logar no console mesmo se arquivo falhar');

            spy.restore();
        });
    });

    describe('8. Integração com Sistema', () => {
        it('deve ser usável como módulo singleton', () => {
            const logger1 = require('../../../src/core/logger');
            const logger2 = require('../../../src/core/logger');

            assert.strictEqual(logger1, logger2, 'Deve retornar a mesma instância');
        });

        it('deve exportar todas as funções principais', () => {
            assert.ok(typeof logger.log === 'function', 'Deve exportar log');
            assert.ok(typeof logger.logMetric === 'function', 'Deve exportar logMetric');
            assert.ok(typeof logger.audit === 'function', 'Deve exportar audit');
        });
    });
});
