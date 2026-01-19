/* ==========================================================================
   src/infra/system.js
   Audit Level: 45 — System & Process Manager (NASA Standard)
   Responsabilidade: Controle cirúrgico de processos (Tree-Kill) e Orquestração PM2.
   Sincronizado com: server.js (V40), Maestro index.js (V240).
========================================================================== */

const { exec } = require('child_process');
const pm2 = require('pm2');
const treeKill = require('tree-kill');
const { log } = require('../core/logger');

const AGENTE_NAME = 'agente-gpt';

/**
 * Interface Promisificada interna para o PM2.
 * Evita o aninhamento de callbacks e facilita o tratamento de erros.
 */
const pm2p = {
    connect: () => new Promise((res, rej) => pm2.connect(err => err ? rej(err) : res())),
    describe: (name) => new Promise((res, rej) => pm2.describe(name, (err, list) => err ? rej(err) : res(list))),
    start: (opts) => new Promise((res, rej) => pm2.start(opts, err => err ? rej(err) : res())),
    stop: (name) => new Promise((res, rej) => pm2.stop(name, err => err ? rej(err) : res())),
    restart: (name) => new Promise((res, rej) => pm2.restart(name, err => err ? rej(err) : res())),
    disconnect: () => pm2.disconnect()
};

/* ==========================================================================
   API DE CONTROLE DE PROCESSO (PM2)
========================================================================== */

/**
 * Retorna o status detalhado do processo do Agente.
 * Mapeia os dados brutos do PM2 para um contrato limpo.
 */
async function getAgentStatus() {
    try {
        await pm2p.connect();
        const list = await pm2p.describe(AGENTE_NAME);
        const app = list && list[0];
        
        if (!app) {
            return { agent: 'stopped', memory: 0, uptime: 0 };
        }

        return {
            agent: app.pm2_env.status, // 'online', 'stopped', 'errored', etc.
            memory: app.monit.memory || 0,
            uptime: (app.pm2_env.status === 'online') ? (Date.now() - app.pm2_env.pm_uptime) : 0,
            pid: app.pid
        };
    } catch (e) {
        log('ERROR', `[SYSTEM] Falha ao obter status PM2: ${e.message}`);
        return { agent: 'offline', error: e.message };
    }
}

/**
 * Executa uma ação de controle no Agente (start/stop/restart/kill_daemon).
 * Contém a inteligência de decisão de comando baseada no estado atual.
 */
async function controlAgent(action) {
    try {
        await pm2p.connect();
        log('INFO', `[SYSTEM] Comando recebido: ${action}`);

        switch (action) {
            case 'start':
                const statusInfo = await getAgentStatus();
                // Se já existe no PM2 (mesmo parado ou com erro), usamos restart para reviver
                if (statusInfo.agent !== 'stopped' && statusInfo.agent !== 'not_found') {
                    await pm2p.restart(AGENTE_NAME);
                } else {
                    // Se não existe ou está totalmente parado, iniciamos com a spec oficial
                    await pm2p.start({
                        name: AGENTE_NAME,
                        script: './index.js',
                        node_args: '--expose-gc',
                        max_memory_restart: '1G',
                        env: { 
                            NODE_ENV: "production",
                            FORCE_COLOR: "1" 
                        }
                    });
                }
                break;

            case 'stop':
                await pm2p.stop(AGENTE_NAME);
                break;

            case 'restart':
                await pm2p.restart(AGENTE_NAME);
                break;

            case 'kill_daemon':
                return new Promise((res) => {
                    exec('npx pm2 kill', (err) => {
                        if (err) log('ERROR', `[SYSTEM] Falha ao matar daemon: ${err.message}`);
                        res({ success: !err });
                    });
                });

            default:
                throw new Error(`Ação de controle inválida: ${action}`);
        }
        return { success: true };
    } catch (e) {
        log('ERROR', `[SYSTEM] Erro na operação ${action}: ${e.message}`);
        throw e;
    }
}

/* ==========================================================================
   API DE BAIXO NÍVEL (SISTEMA OPERACIONAL)
========================================================================== */

/**
 * Mata um processo específico e sua árvore de filhos com SIGKILL.
 */
function killProcess(pid) {
    return new Promise((resolve) => {
        if (!pid) {
            log('WARN', 'Tentativa de matar processo sem PID.');
            return resolve();
        }

        log('FATAL', `Executando Kill Switch no PID ${pid}...`);
        
        treeKill(pid, 'SIGKILL', (err) => {
            if (err) {
                log('ERROR', `Falha ao matar PID ${pid}: ${err.message}`);
                killChromeGlobal(); 
            } else {
                log('INFO', `Processo ${pid} e filhos encerrados.`);
            }
            resolve();
        });
    });
}

/**
 * Mata TODOS os processos do Chrome (Fallback Nuclear).
 */
function killChromeGlobal() {
    return new Promise((resolve) => {
        log('WARN', 'Executando Kill Global no Chrome (Fallback)...');
        const cmd = process.platform === 'win32' 
            ? 'taskkill /F /IM chrome.exe /T' 
            : 'pkill -9 chrome';
            
        exec(cmd, (err) => {
            if (err) log('WARN', `Falha no Kill Global: ${err.message}`);
            else log('INFO', 'Todos os Chromes encerrados.');
            resolve();
        });
    });
}

module.exports = { 
    getAgentStatus, 
    controlAgent, 
    killProcess, 
    killChromeGlobal,
    pm2Raw: pm2 // Expõe a instância bruta para o bus de eventos realtime
};