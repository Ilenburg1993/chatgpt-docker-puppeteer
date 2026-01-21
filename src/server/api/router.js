/* ==========================================================================
   src/server/api/router.js
   Audit Level: 700 — Sovereign API Gateway (Singularity Edition)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Ponto central de roteamento do Mission Control Prime.
                     Orquestra a hierarquia de namespaces e sela a malha de
                     proteção (Error Boundary) da API.
   Sincronizado com: controllers/tasks.js V700, controllers/system.js V700,
                     controllers/dna.js V700, middleware/error_handler.js V600.
========================================================================== */

const tasksController = require('./controllers/tasks');

const { STATUS_VALUES: STATUS_VALUES } = require('../../core/constants/tasks.js');

const systemController = require('./controllers/system');
const dnaController = require('./controllers/dna');
const { notFound, errorHandler } = require('../middleware/error_handler');
const { log } = require('../../core/logger');
const { apiLimiter } = require('../engine/app');

/**
 * Aplica a malha de rotas à instância do Express.
 * Define a topologia lógica da API e injeta os escudos de integridade.
 *
 * @param {object} app - Instância do Express vinda de engine/app.js.
 */
function applyRoutes(app) {
    log('INFO', '[GATEWAY] Selando malha de rotas V700 (Consolidação Total)...');

    /* --------------------------------------------------------------------------
       0. ENDPOINT DE SAÚDE SIMPLIFICADO (Para Docker Healthcheck)
    -------------------------------------------------------------------------- */

    /**
     * GET /api/health
     * Endpoint simplificado de health check para Docker e monitoramento.
     * Retorna status básico: uptime, Chrome connection, queue stats.
     */
    app.get('/api/health', async (req, res) => {
        try {
            const doctor = require('../../core/doctor');
            const io = require('../../infra/io');

            // Verificação rápida de Chrome (timeout curto)
            const chrome = await doctor.probeChromeConnection();

            // Estatísticas básicas da fila
            let queueStats = { pending: 0, running: 0 };
            try {
                const tasks = await io.loadAllTasks();
                queueStats = {
                    pending: tasks.filter(t => t.status === STATUS_VALUES.PENDING).length,
                    running: tasks.filter(t => t.status === STATUS_VALUES.RUNNING).length
                };
            } catch {
                /* Fail-safe */
            }

            const status = chrome.connected ? 'ok' : 'degraded';
            const httpCode = chrome.connected ? 200 : 503;

            res.status(httpCode).json({
                status: status,
                timestamp: new Date().toISOString(),
                uptime: Math.floor(process.uptime()),
                chrome: {
                    connected: chrome.connected,
                    endpoint: chrome.endpoint,
                    version: chrome.version || null,
                    latency_ms: chrome.latency_ms
                },
                queue: queueStats,
                memory: {
                    usage_mb: Math.floor(process.memoryUsage().heapUsed / 1024 / 1024),
                    total_mb: Math.floor(process.memoryUsage().heapTotal / 1024 / 1024)
                }
            });
        } catch (e) {
            log('ERROR', `[HEALTH] Falha no health check: ${e.message}`);
            res.status(503).json({
                status: 'error',
                timestamp: new Date().toISOString(),
                error: e.message
            });
        }
    });

    /* --------------------------------------------------------------------------
       0.1 ENDPOINTS DE SAÚDE ESPECÍFICOS (Para Super Launcher)
    -------------------------------------------------------------------------- */

    /**
     * GET /api/health/chrome
     * Health check específico do Chrome debug port.
     * Usado pelo launcher para validar conectividade antes de prosseguir.
     */
    app.get('/api/health/chrome', async (req, res) => {
        try {
            const doctor = require('../../core/doctor');
            const chromeConfig = require('../../../chrome-config.json');

            const chrome = await doctor.probeChromeConnection();

            res.status(chrome.connected ? 200 : 503).json({
                status: chrome.connected ? 'healthy' : 'unhealthy',
                timestamp: new Date().toISOString(),
                component: 'chrome',
                connected: chrome.connected,
                endpoint: chrome.endpoint || chromeConfig.health.chromeDebugUrl,
                version: chrome.version || null,
                latency_ms: chrome.latency_ms,
                detectedPorts: chromeConfig.connection.ports,
                mode: chromeConfig.connection.mode
            });
        } catch (e) {
            log('ERROR', `[HEALTH:CHROME] ${e.message}`);
            res.status(503).json({
                status: 'unhealthy',
                timestamp: new Date().toISOString(),
                component: 'chrome',
                error: e.message
            });
        }
    });

    /**
     * GET /api/health/pm2
     * Health check dos processos PM2 (agente-gpt, dashboard-web).
     * Retorna status detalhado de cada processo gerenciado.
     */
    app.get('/api/health/pm2', async (req, res) => {
        try {
            const system = require('../../infra/system');

            const status = await system.getAgentStatus();

            // Lista todos os processos PM2
            let allProcesses = [];
            try {
                const pm2 = require('pm2');
                allProcesses = await new Promise((resolve, reject) => {
                    pm2.list((err, list) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(
                                list.map(proc => ({
                                    name: proc.name,
                                    status: proc.pm2_env.status,
                                    pid: proc.pid,
                                    uptime: proc.pm2_env.pm_uptime,
                                    restarts: proc.pm2_env.restart_time,
                                    memory: Math.floor(proc.monit.memory / 1024 / 1024),
                                    cpu: proc.monit.cpu
                                }))
                            );
                        }
                    });
                });
            } catch (listErr) {
                log('WARN', `[HEALTH:PM2] Não foi possível listar processos: ${listErr.message}`);
            }

            const healthy = status.agent === 'online' || status.agent === 'running';

            res.status(healthy ? 200 : 503).json({
                status: healthy ? 'healthy' : 'unhealthy',
                timestamp: new Date().toISOString(),
                component: 'pm2',
                agent: status.agent,
                server: status.server,
                processes: allProcesses,
                totalProcesses: allProcesses.length,
                onlineProcesses: allProcesses.filter(p => p.status === 'online').length
            });
        } catch (e) {
            log('ERROR', `[HEALTH:PM2] ${e.message}`);
            res.status(503).json({
                status: 'unhealthy',
                timestamp: new Date().toISOString(),
                component: 'pm2',
                error: e.message
            });
        }
    });

    /**
     * GET /api/health/kernel
     * Health check do Kernel via NERV bus.
     * Verifica se o Kernel está ativo e respondendo.
     */
    app.get('/api/health/kernel', async (req, res) => {
        try {
            // Verifica se NERV bus está disponível
            const nerv = require('../../nerv/nerv');

            // Tenta obter estado do Kernel via NERV
            let kernelState = 'unknown';
            let isActive = false;

            try {
                // Simula ping no NERV para verificar se Kernel está vivo
                const response = await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => reject(new Error('Kernel timeout')), 2000);

                    nerv.emit({
                        messageType: 'REQUEST',
                        actionCode: 'KERNEL_STATUS',
                        sender: { componentId: 'health-check', instanceId: 'api' },
                        payload: {}
                    });

                    // Observer temporário para resposta
                    const observer = msg => {
                        if (msg.messageType === 'RESPONSE' && msg.actionCode === 'KERNEL_STATUS') {
                            clearTimeout(timeout);
                            nerv.off(observer);
                            resolve(msg.payload);
                        }
                    };

                    nerv.on(observer);
                });

                kernelState = response.state || 'running';
                isActive = true;
            } catch (kernelErr) {
                log('WARN', `[HEALTH:KERNEL] ${kernelErr.message}`);
                // Fallback: verifica se há tarefas ativas (indica Kernel vivo)
                const io = require('../../infra/io');
                const tasks = await io.loadAllTasks();
                const runningTasks = tasks.filter(t => t.status === STATUS_VALUES.RUNNING).length;
                isActive = runningTasks > 0;
                kernelState = isActive ? 'running' : 'idle';
            }

            res.status(isActive ? 200 : 503).json({
                status: isActive ? 'healthy' : 'unhealthy',
                timestamp: new Date().toISOString(),
                component: 'kernel',
                state: kernelState,
                active: isActive,
                nervBus: 'available'
            });
        } catch (e) {
            log('ERROR', `[HEALTH:KERNEL] ${e.message}`);
            res.status(503).json({
                status: 'unhealthy',
                timestamp: new Date().toISOString(),
                component: 'kernel',
                error: e.message
            });
        }
    });

    /**
     * GET /api/health/disk
     * Health check de espaço em disco.
     * Verifica logs/, fila/, respostas/ e alerta se espaço baixo.
     */
    app.get('/api/health/disk', async (req, res) => {
        try {
            const fs = require('fs');
            const path = require('path');
            const { execSync } = require('child_process');

            const ROOT = path.join(__dirname, '../../..');

            // Função helper para obter tamanho de diretório
            const getDirSize = dirPath => {
                try {
                    if (!fs.existsSync(dirPath)) {
                        return 0;
                    }
                    const output = execSync(`du -sb "${dirPath}"`, { encoding: 'utf-8' });
                    return parseInt(output.split('\t')[0]);
                } catch {
                    return 0;
                }
            };

            const logsSize = getDirSize(path.join(ROOT, 'logs'));
            const queueSize = getDirSize(path.join(ROOT, 'fila'));
            const responsesSize = getDirSize(path.join(ROOT, 'respostas'));
            const totalSize = logsSize + queueSize + responsesSize;

            // Conta arquivos
            const countFiles = dirPath => {
                try {
                    if (!fs.existsSync(dirPath)) {
                        return 0;
                    }
                    return fs.readdirSync(dirPath).length;
                } catch {
                    return 0;
                }
            };

            const logsCount = countFiles(path.join(ROOT, 'logs'));
            const queueCount = countFiles(path.join(ROOT, 'fila'));
            const responsesCount = countFiles(path.join(ROOT, 'respostas'));

            // Alertas (>500MB = warning, >1GB = critical)
            const warningThreshold = 500 * 1024 * 1024;
            const criticalThreshold = 1024 * 1024 * 1024;

            let diskStatus = 'healthy';
            const alerts = [];

            if (totalSize > criticalThreshold) {
                diskStatus = 'critical';
                alerts.push(`Uso total excede 1GB (${Math.floor(totalSize / 1024 / 1024)}MB)`);
            } else if (totalSize > warningThreshold) {
                diskStatus = 'warning';
                alerts.push(`Uso total excede 500MB (${Math.floor(totalSize / 1024 / 1024)}MB)`);
            }

            if (logsCount > 1000) {
                alerts.push(`Logs acumulados: ${logsCount} arquivos`);
            }

            res.status(diskStatus === 'healthy' ? 200 : diskStatus === 'warning' ? 200 : 503).json({
                status: diskStatus,
                timestamp: new Date().toISOString(),
                component: 'disk',
                usage: {
                    logs: { bytes: logsSize, mb: Math.floor(logsSize / 1024 / 1024), files: logsCount },
                    queue: { bytes: queueSize, mb: Math.floor(queueSize / 1024 / 1024), files: queueCount },
                    responses: {
                        bytes: responsesSize,
                        mb: Math.floor(responsesSize / 1024 / 1024),
                        files: responsesCount
                    },
                    total: { bytes: totalSize, mb: Math.floor(totalSize / 1024 / 1024) }
                },
                alerts: alerts,
                thresholds: {
                    warning_mb: 500,
                    critical_mb: 1024
                }
            });
        } catch (e) {
            log('ERROR', `[HEALTH:DISK] ${e.message}`);
            res.status(503).json({
                status: 'unhealthy',
                timestamp: new Date().toISOString(),
                component: 'disk',
                error: e.message
            });
        }
    });

    /* --------------------------------------------------------------------------
       1. MAPEAMENTO DE DOMÍNIOS SOBERANOS
    -------------------------------------------------------------------------- */

    /**
     * DOMÍNIO DE MISSÃO (Tarefas, Fila e Artefatos)
     * Namespace: /api/tasks, /api/queue, /api/results
     * Responsável pelo ciclo de vida das intenções de execução e download de .txt.
     */
    app.use('/api/tasks', apiLimiter, tasksController);
    app.use('/api/queue', apiLimiter, tasksController); // Alias para operações bulk de fila
    app.use('/api/results', apiLimiter, tasksController); // Alias para recuperação de respostas

    /**
     * DOMÍNIO DE SISTEMA E OBSERVABILIDADE (Agentes e Infraestrutura)
     * Namespace: /api/system
     * Responsável pelo inventário IPC 2.0 (/agents), saúde (Doctor) e processos.
     */
    app.use('/api/system', apiLimiter, systemController);

    /**
     * DOMÍNIO DE INTELIGÊNCIA E CONFIGURAÇÃO (DNA e Parâmetros)
     * Namespace: /api/config
     * Responsável pela evolução do genoma (SADI) e controle do config.json.
     */
    app.use('/api/config', apiLimiter, dnaController);

    /* --------------------------------------------------------------------------
       2. ESCUDOS DE PROTEÇÃO (ERROR BOUNDARY)
       Estratégia: Garantir que nenhuma requisição órfã ou falha lógica escape
       do sistema sem um tratamento padronizado e rastreável.
    -------------------------------------------------------------------------- */

    // Captura rotas inexistentes (404)
    app.use(notFound);

    // Captura e trata falhas de execução nos controladores (500)
    // Este middleware injeta o request_id na resposta final de erro.
    app.use(errorHandler);

    log('INFO', '[GATEWAY] Sincronia de namespaces e Error Boundary operacionais.');
}

module.exports = { applyRoutes };
