// @ts-check
import { exec } from 'node:child_process';
import { createRequire } from 'node:module';
import pm2 from 'pm2';
import treeKill from 'tree-kill';
import path from 'node:path';
import { execa } from 'execa';
import { log } from '#core/logger';

const AGENTE_NAME = 'agente-gpt';

// Importa a configuração oficial do PM2 (CJS — usa createRequire)
const require_ = createRequire(import.meta.url);
const ecosystemConfig = require_(path.join(import.meta.dirname, '../../ecosystem.config.cjs'));

/**
 * Interface Promisificada interna para o PM2.
 * Evita o aninhamento de callbacks e facilita o tratamento de erros.
 */
const pm2p = /** @type {any} */ ({
    connect: () =>
        new Promise((/** @type {any} */ res, /** @type {any} */ rej) => {
            pm2.connect(err => {
                if (err) {
                    rej(err);
                } else {
                    res();
                }
            });
        }),
    describe: /** @param {any} name */ name =>
        new Promise((/** @type {any} */ res, /** @type {any} */ rej) => {
            pm2.describe(name, (err, list) => {
                if (err) {
                    rej(err);
                } else {
                    res(list);
                }
            });
        }),
    start: (/** @type {any} */ opts) =>
        new Promise((/** @type {any} */ res, /** @type {any} */ rej) => {
            pm2.start(opts, err => {
                if (err) {
                    rej(err);
                } else {
                    res();
                }
            });
        }),
    stop: (/** @type {any} */ name) =>
        new Promise((/** @type {any} */ res, /** @type {any} */ rej) => {
            pm2.stop(name, err => {
                if (err) {
                    rej(err);
                } else {
                    res();
                }
            });
        }),
    restart: (/** @type {any} */ name) =>
        new Promise((/** @type {any} */ res, /** @type {any} */ rej) => {
            pm2.restart(name, err => {
                if (err) {
                    rej(err);
                } else {
                    res();
                }
            });
        }),
    disconnect: () => pm2.disconnect(),
});

/* ==========================================================================
   API DE CONTROLE DE PROCESSO (PM2)
========================================================================== */

/**
 * Retorna o status detalhado do processo do Agente.
 * Mapeia os dados brutos do PM2 para um contrato limpo.
 * @returns {Promise<any>}
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
            uptime: app.pm2_env.status === 'online' ? Date.now() - app.pm2_env.pm_uptime : 0,
            pid: app.pid,
        };
    } catch (/** @type {any} */ e) {
        const _ce = /** @type {any} */ (e);
        log('ERROR', `[SYSTEM] Falha ao obter status PM2: ${_ce.message}`);
        return { agent: 'offline', error: _ce.message };
    }
}

/**
 * Executa uma ação de controle no Agente (start/stop/restart/kill_daemon).
 * Contém a inteligência de decisão de comando baseada no estado atual.
 * @param {*} action
 * @returns {Promise<any>}
 */
async function controlAgent(action) {
    try {
        await pm2p.connect();
        log('INFO', `[SYSTEM] Comando recebido: ${action}`);

        switch (action) {
            case 'start': {
                const statusInfo = await getAgentStatus();
                // Se já existe no PM2 (mesmo parado ou com erro), usamos restart para reviver
                if (statusInfo.agent !== 'stopped' && statusInfo.agent !== 'not_found') {
                    await pm2p.restart(AGENTE_NAME);
                } else {
                    // Se não existe ou está totalmente parado, iniciamos com a spec oficial do ecosystem.config.js
                    const agenteSpec = ecosystemConfig.apps.find((/** @type {any} */ app) => app.name === AGENTE_NAME);
                    if (!agenteSpec) {
                        throw new Error(`Configuração para "${AGENTE_NAME}" não encontrada em ecosystem.config.js`);
                    }

                    await pm2p.start({
                        name: agenteSpec.name,
                        script: agenteSpec.script,
                        node_args: agenteSpec.node_args,
                        max_memory_restart: agenteSpec.max_memory_restart,
                        exp_backoff_restart_delay: agenteSpec.exp_backoff_restart_delay,
                        env: agenteSpec.env,
                    });
                }
                break;
            }

            case 'stop':
                await pm2p.stop(AGENTE_NAME);
                break;

            case 'restart':
                await pm2p.restart(AGENTE_NAME);
                break;

            case 'kill_daemon': {
                // Prefer execa if available for structured subprocess control
                if (execa) {
                    try {
                        await execa('pm2', ['kill']);
                        return { success: true };
                    } catch (/** @type {any} */ err) {
                        const _ce = /** @type {any} */ (err);
                        try {
                            await execa('npx', ['pm2', 'kill']);
                            return { success: true };
                        } catch (/** @type {any} */ err2) {
                            log('ERROR', `[SYSTEM] Falha ao matar daemon: ${/** @type {any} */ (err2).message}`);
                            return { success: false };
                        }
                    }
                }

                // Fallback to original exec behavior
                return new Promise((/** @type {any} */ res) => {
                    exec('npx pm2 kill', err => {
                        if (err) {
                            log('ERROR', `[SYSTEM] Falha ao matar daemon: ${err.message}`);
                        }
                        res({ success: !err });
                    });
                });
            }

            default:
                throw new Error(`Ação de controle inválida: ${action}`);
        }
        return { success: true };
    } catch (/** @type {any} */ e) {
        const _ce = /** @type {any} */ (e);
        log('ERROR', `[SYSTEM] Erro na operação ${action}: ${_ce.message}`);
        throw e;
    }
}

/* ==========================================================================
   API DE BAIXO NÍVEL (SISTEMA OPERACIONAL)
========================================================================== */

/**
 * Mata um processo específico e sua árvore de filhos com SIGKILL.
 * @param {*} pid
 * @returns {Promise<any>}
 */
async function killProcess(pid) {
    if (!pid) {
        log('WARN', 'Tentativa de matar processo sem PID.');
        return;
    }

    log('FATAL', `Executando Kill Switch no PID ${pid}...`);

    // Try platform-native recursive kill via execa if available
    if (execa) {
        try {
            if (process.platform === 'win32') {
                await execa('taskkill', ['/PID', String(pid), '/T', '/F']);
            } else {
                // attempt to kill child processes first, then parent
                try {
                    await execa('pkill', ['-P', String(pid)]);
                } catch (/** @type {any} */ err) {
                    const _ce = /** @type {any} */ (err);
                    void err;
                }
                try {
                    process.kill(pid, 'SIGKILL');
                } catch (/** @type {any} */ err) {
                    const _ce = /** @type {any} */ (err);
                    void err;
                }
            }
            log('INFO', `Processo ${pid} e filhos encerrados.`);
            return;
        } catch (/** @type {any} */ err) {
            const _ce = /** @type {any} */ (err);
            log(
                'ERROR',
                `Falha ao matar PID ${pid}: ${err && _ce.message ? _ce.message : String(err)} — usando fallback tree-kill`
            );
        }
    }

    // Fallback to tree-kill (legacy behavior)
    await new Promise((/** @type {any} */ resolve) => {
        treeKill(pid, 'SIGKILL', err => {
            if (err) {
                log('ERROR', `Falha ao matar PID ${pid} com tree-kill: ${err.message}`);
                // As a last resort, attempt a global Chrome kill
                killChromeGlobal().then(() => resolve());
            } else {
                log('INFO', `Processo ${pid} e filhos encerrados via tree-kill.`);
                resolve();
            }
        });
    });
}

/**
 * Mata TODOS os processos do Chrome (Fallback Nuclear).
 * @returns {Promise<any>}
 */
async function killChromeGlobal() {
    log('WARN', 'Executando Kill Global no Chrome (Fallback)...');
    const isWin = process.platform === 'win32';
    if (execa) {
        try {
            if (isWin) {
                await execa('taskkill', ['/F', '/IM', 'chrome.exe', '/T']);
            } else {
                await execa('pkill', ['-9', 'chrome']);
            }
            log('INFO', 'Todos os Chromes encerrados.');
            return;
        } catch (/** @type {any} */ err) {
            const _ce = /** @type {any} */ (err);
            log('WARN', `Falha no Kill Global (execa): ${err && _ce.message ? _ce.message : String(err)}`);
        }
    }

    // Fallback to exec
    return new Promise((/** @type {any} */ resolve) => {
        const cmd = isWin ? 'taskkill /F /IM chrome.exe /T' : 'pkill -9 chrome';
        exec(cmd, err => {
            if (err) {
                log('WARN', `Falha no Kill Global: ${err.message}`);
            } else {
                log('INFO', 'Todos os Chromes encerrados.');
            }
            resolve();
        });
    });
}

/** Reexport público: pm2Raw. */
export { getAgentStatus, controlAgent, killProcess, killChromeGlobal, pm2 as pm2Raw };
