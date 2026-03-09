// @ts-check
import { STATUS_VALUES } from '#core/constants/tasks';
import { ConnectionOrchestrator } from '#infra/ConnectionOrchestrator';
import { exec } from 'node:child_process';
import fs, { promises as fsp } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import CONFIG from './config.js';

const ROOT = path.resolve(import.meta.dirname, '../../');
const LOG_DIR = path.join(ROOT, 'logs');
const TREND_FILE = path.join(LOG_DIR, 'health_trends.json');

/**
 * @typedef {object} ChromeConnectionStatus
 * @property {boolean} connected - Se a conexão com Chrome foi estabelecida.
 * @property {string} [endpoint] - Endpoint HTTP usado para conexão.
 * @property {string} [error] - Mensagem de erro se não conectado.
 * @property {number} [latency_ms] - Latência da conexão em ms.
 * @property {string} [version] - Versão do Chrome detectada.
 * @property {string} [protocol] - Versão do protocolo.
 * @property {string} [user_agent] - User agent do Chrome.
 * @property {string} [ws_endpoint] - Endpoint WebSocket para debugging.
 */

/**
 * @typedef {object} HardwareMetrics
 * @property {string} cpu_load - [LEGACY] Carga de CPU em porcentagem.
 * @property {string} cpu_usage_percent - Uso real de CPU em porcentagem.
 * @property {string} cpu_load_1min - Load average de 1 minuto.
 * @property {string} cpu_load_5min - Load average de 5 minutos.
 * @property {string} cpu_load_15min - Load average de 15 minutos.
 * @property {number} cpu_cores - Número de núcleos.
 * @property {string} ram_usage_pct - Uso de RAM em porcentagem.
 * @property {string} ram_free_gb - RAM livre em GB (formato string com 'GB').
 * @property {number} ts - Timestamp da coleta em ms.
 */

/**
 * @typedef {object} Trends
 * @property {number[]} ram - Histórico de uso de RAM.
 * @property {number[]} cpu - Histórico de carga de CPU.
 * @property {number[]} io - Histórico de latência de I/O.
 */

/**
 * @typedef {object} StorageSLA
 * @property {number} latency_ms - Latência de I/O em ms.
 * @property {boolean} write_ok - Se a escrita foi bem-sucedida.
 * @property {string} disk_info_raw - Informações brutas do disco.
 */

/**
 * @typedef {object} DNASanity
 * @property {boolean} ok - Se o DNA está íntegro.
 * @property {string} [msg] - Mensagem de erro se não íntegro.
 * @property {number} [version] - Versão do DNA.
 */

/**
 * @typedef {object} NetworkProbe
 * @property {boolean} ok - Se a conexão foi bem-sucedida.
 * @property {string | number} status - Status da resposta ou 'OFFLINE'/'TIMEOUT'.
 * @property {number} ms - Tempo de resposta em ms.
 */

/**
 * @typedef {object} QueueStats
 * @property {number} pending - Número de tarefas pendentes.
 * @property {number} running - Número de tarefas em execução.
 * @property {number} total - Total de tarefas.
 */

/**
 * @typedef {object} RecoveryStep
 * @property {string} op - Operação sugerida.
 * @property {string} target - Alvo da operação.
 * @property {string} impact - Impacto ('low'|'medium'|'high'|'critical').
 */

/**
 * @typedef {object} FullCheckResult
 * @property {object} meta - Metadados do diagnóstico.
 * @property {string} meta.version - Versão do engine.
 * @property {string} meta.engine - Nome do engine.
 * @property {string} meta.timestamp - Timestamp ISO.
 * @property {number} meta.duration_ms - Duração em ms.
 * @property {object} health - Status de saúde.
 * @property {number} health.score - Pontuação de saúde (0-100).
 * @property {string} health.status - Status ('HEALTHY'|'DEGRADED'|'CRITICAL').
 * @property {object} telemetry - Dados de telemetria.
 * @property {NetworkProbe[]} telemetry.network - Resultados de rede.
 * @property {StorageSLA} telemetry.storage - Dados de armazenamento.
 * @property {DNASanity} telemetry.dna - Status do DNA.
 * @property {ChromeConnectionStatus & { proxyReport: unknown }} telemetry.chrome - Status do Chrome + relatório proxy.
 * @property {QueueStats} telemetry.queue - Estatísticas da fila.
 * @property {HardwareMetrics & { event_loop_lag_ms: number; uptime_seconds: number }} telemetry.system - Métricas do
 *   sistema.
 * @property {object} recovery_manifest - Manifesto de recuperação.
 * @property {string[]} recovery_manifest.detected_issues - Problemas detectados.
 * @property {RecoveryStep[]} recovery_manifest.suggested_steps - Passos sugeridos.
 * @property {boolean} recovery_manifest.can_auto_fix - Se pode corrigir automaticamente.
 */

/**
 * Verifica conectividade com Chrome Remote Debugging.
 *
 * @returns {Promise<ChromeConnectionStatus>} Status da conexão com Chrome, incluindo versão e latência se conectado.
 * @throws {Error} Nunca lança erro - sempre retorna objeto de status.
 */
async function probeChromeConnection() {
    const proxyPort = process.env.CHROME_PROXY_PORT || CONFIG.CHROME_PROXY_PORT || 9224;
    const defaultEndpoint = `http://localhost:${proxyPort}`;
    const endpoint = process.env.CHROME_WS_ENDPOINT || process.env.CHROME_URL || CONFIG.DEBUG_PORT || defaultEndpoint;
    const httpEndpoint = endpoint.replace('ws://', 'http://').replace('wss://', 'https://');

    try {
        const versionUrl = `${httpEndpoint}/json/version`;
        const result = await probeConnectivity(versionUrl);

        if (!result.ok) {
            return {
                connected: false,
                endpoint: httpEndpoint,
                error: 'Chrome not responding',
                latency_ms: result.ms,
            };
        }

        // Tenta buscar informações detalhadas do Chrome
        return new Promise((resolve) => {
            const client = httpEndpoint.startsWith('https') ? https : http;
            const req = client.get(versionUrl, (res) => {
                let data = '';
                res.on('data', (chunk) => (data += chunk));
                res.on('end', () => {
                    try {
                        const info = JSON.parse(data);
                        resolve({
                            connected: true,
                            endpoint: httpEndpoint,
                            version: info['Browser'] || 'Unknown',
                            protocol: info['Protocol-Version'] || 'Unknown',
                            user_agent: info['User-Agent'] || 'Unknown',
                            ws_endpoint: info['webSocketDebuggerUrl'] || endpoint,
                            latency_ms: result.ms,
                        });
                    } catch {
                        resolve({
                            connected: true,
                            endpoint: httpEndpoint,
                            version: 'Unknown',
                            latency_ms: result.ms,
                        });
                    }
                });
            });
            req.on('error', (err) => {
                resolve({
                    connected: false,
                    endpoint: httpEndpoint,
                    error: err.message,
                    latency_ms: 0,
                });
            });
            req.setTimeout(5000, () => {
                req.destroy();
                resolve({
                    connected: false,
                    endpoint: httpEndpoint,
                    error: 'Connection timeout',
                    latency_ms: 5000,
                });
            });
        });
    } catch (/** @type {any} */ err) {
        const _ce = /** @type {any} */ (err);
        return {
            connected: false,
            endpoint: httpEndpoint,
            error: _ce.message,
            latency_ms: 0,
        };
    }
}

// --- GESTÃO DE TENDÊNCIAS (PERSISTÊNCIA DE BASELINE) ---
/**
 * Carrega tendências de métricas de saúde do arquivo de persistência.
 *
 * @returns {Promise<Trends>} Objeto com arrays de tendências para RAM, CPU e I/O. Retorna arrays vazios se arquivo não
 *   existir ou houver erro.
 * @throws {Error} Nunca lança erro - sempre retorna objeto com arrays vazios em caso de falha.
 */
async function getTrends() {
    try {
        if (!fs.existsSync(TREND_FILE)) {
            return { ram: [], cpu: [], io: [] };
        }
        const data = await fsp.readFile(TREND_FILE, 'utf-8');
        return JSON.parse(data);
    } catch {
        return { ram: [], cpu: [], io: [] };
    }
}

async function saveTrends(/** @type {any} */ trends) {
    try {
        const limit = 50;
        const simplified = {
            ram: trends.ram.slice(-limit),
            cpu: trends.cpu.slice(-limit),
            io: trends.io.slice(-limit),
            ts: new Date().toISOString(),
        };
        await fsp.writeFile(TREND_FILE, JSON.stringify(simplified, null, 2));
    } catch (/** @type {any} */ _) {
        const _ce = /** @type {any} */ (_);
        /* Fail-safe */
    }
}

/* ==========================================================================
   SONDAS DE ALTA FIDELIDADE
========================================================================== */

/**
 * Coleta métricas instantâneas de Hardware. Absorvido do server.js para centralização de soberania de dados.
 *
 * @returns {HardwareMetrics} Métricas padronizadas para o Dashboard/Telemetria.
 */
function getHardwareMetrics() {
    const freeMem = os.freemem();
    const totalMem = os.totalmem();
    const cpus = os.cpus();
    const load = /** @type {[number, number, number]} */ (os.loadavg());
    const cores = Math.max(1, cpus.length || 1);
    const normalizedLoadPct = Math.max(0, Math.min(100, (load[0] / cores) * 100));
    const cpuUsagePercent = normalizedLoadPct.toFixed(1);

    return {
        cpu_load: cpuUsagePercent,
        cpu_usage_percent: cpuUsagePercent,
        cpu_load_1min: load[0].toFixed(2),
        cpu_load_5min: load[1].toFixed(2),
        cpu_load_15min: load[2].toFixed(2),
        cpu_cores: cores,
        ram_usage_pct: ((1 - freeMem / totalMem) * 100).toFixed(1),
        ram_free_gb: `${(freeMem / 1024 / 1024 / 1024).toFixed(2)}GB`,
        ts: Date.now(),
    };
}

/**
 * Triangulação de Rede via Handshake HTTP.
 *
 * @param {string} url - URL a ser testada para conectividade.
 * @returns {Promise<NetworkProbe>} Resultado do teste de conectividade com status, latência e sucesso.
 * @throws {Error} Nunca lança erro - sempre resolve a Promise.
 */
async function probeConnectivity(url) {
    return new Promise((resolve) => {
        const t0 = Date.now();
        const client = url.startsWith('https') ? https : http;
        const req = client.request(url, { method: 'HEAD', timeout: 5000 }, (res) => {
            resolve({
                ok: /** @type {any} */ (res).statusCode < 400,
                status: /** @type {any} */ (res).statusCode,
                ms: Date.now() - t0,
            });
        });
        req.on('error', () => resolve({ ok: false, status: 'OFFLINE', ms: Date.now() - t0 }));
        req.on('timeout', () => {
            req.destroy();
            resolve({ ok: false, status: 'TIMEOUT', ms: 5000 });
        });
        req.end();
    });
}

/**
 * Auditoria de I/O e Espaço em Disco (SLA de Hardware).
 *
 * @returns {Promise<StorageSLA>} Métricas de armazenamento incluindo latência de I/O, sucesso de escrita e informações
 *   do disco.
 * @throws {Error} Nunca lança erro - sempre resolve a Promise.
 */
async function checkStorageSLA() {
    const t0 = Date.now();
    const testFile = path.join(LOG_DIR, `doctor_io_${Date.now()}.tmp`);
    let ioLatency = 9999;
    let writeOk = false;

    try {
        await fsp.writeFile(testFile, 'X'.repeat(1024 * 1024));
        await fsp.readFile(testFile);
        await fsp.unlink(testFile);
        ioLatency = Date.now() - t0;
        writeOk = true;
    } catch (/** @type {any} */ _) {
        const _ce = /** @type {any} */ (_);
        writeOk = false;
    }

    return new Promise((resolve) => {
        const cmd = process.platform === 'win32' ? 'dir' : 'df -h .';
        exec(cmd, (err, stdout) => {
            resolve({
                latency_ms: ioLatency,
                write_ok: writeOk,
                disk_info_raw: stdout ? stdout.split('\n').slice(-2).join(' ').trim() : 'N/A',
            });
        });
    });
}

/**
 * Validação de Integridade do DNA.
 *
 * @returns {Promise<DNASanity>} Status da validação do arquivo dynamic_rules.json.
 * @throws {Error} Nunca lança erro - sempre retorna objeto de status.
 */
async function validateDNASanity() {
    const rulesPath = path.join(ROOT, 'dynamic_rules.json');
    if (!fs.existsSync(rulesPath)) {
        return { ok: false, msg: 'DNA_MISSING' };
    }
    try {
        const dna = JSON.parse(await fsp.readFile(rulesPath, 'utf-8'));
        const hasSelectors = dna.selectors && Object.keys(dna.selectors).length > 0;
        return { ok: hasSelectors, version: dna._meta?.version || 0 };
    } catch {
        return { ok: false, msg: 'DNA_CORRUPTED' };
    }
}

/* ==========================================================================
   MOTOR DE DIAGNÓSTICO E MANIFESTO DE RECUPERAÇÃO
========================================================================== */

/**
 * Executa verificação completa de saúde do sistema. Coleta métricas de rede, armazenamento, DNA, Chrome e sistema, gera
 * relatório de saúde e manifesto de recuperação.
 *
 * @returns {Promise<FullCheckResult>} Relatório completo de diagnóstico com telemetria, saúde e sugestões de
 *   recuperação.
 * @throws {Error} Nunca lança erro - opera em modo fail-safe e sempre retorna resultado.
 */
async function runFullCheck() {
    const t0 = Date.now();
    const trends = await getTrends();
    const io = await import('#infra/io').then((m) => /** @type {any} */ (m).default ?? m); // Carrega dinamicamente para evitar ciclos

    const targets = [
        'https://www.google.com',
        ...(CONFIG.allowedDomains || []).map((/** @type {string} */ d) => `https://${d}`),
    ];
    const [networkResults, storage, dna, lag, chrome] = await Promise.all([
        Promise.all(targets.map((url) => probeConnectivity(url))),
        checkStorageSLA(),
        validateDNASanity(),
        new Promise((r) => {
            const s = Date.now();
            setImmediate(() => r(Date.now() - s));
        }),
        probeChromeConnection(),
    ]);

    // Additional probe: check configured proxy/hosts via ConnectionOrchestrator
    let proxyReport;
    try {
        proxyReport = await ConnectionOrchestrator.synchronize();
    } catch (/** @type {any} */ err) {
        const _ce = /** @type {any} */ (err);
        proxyReport = { error: err && _ce.message ? _ce.message : String(err) };
    }

    // Estatísticas da fila
    let queueStats = { pending: 0, running: 0, total: 0 };
    try {
        const tasks = /** @type {any[]} */ (await io.loadAllTasks());
        queueStats = {
            pending: tasks.filter((t) => t.status === STATUS_VALUES.PENDING).length,
            running: tasks.filter((t) => t.status === STATUS_VALUES.RUNNING).length,
            total: tasks.length,
        };
    } catch {
        /* Fail-safe */
    }

    const metrics = getHardwareMetrics();

    trends.ram.push(parseFloat(metrics.ram_usage_pct));
    trends.cpu.push(parseFloat(metrics.cpu_usage_percent || metrics.cpu_load));
    trends.io.push(storage.latency_ms);
    await saveTrends(trends);

    const issues = [];
    const manifest = [];

    // Verificação de Chrome
    if (!chrome.connected) {
        issues.push(`Chrome remote debugging não conectado: ${chrome.error || 'Unknown error'}`);
        manifest.push({ op: 'START_CHROME', target: 'chrome_debugging', impact: 'critical' });
    }

    if (networkResults.some((n) => !n.ok)) {
        issues.push('Conectividade instável com provedores de IA.');
        manifest.push({ op: 'NETWORK_RETRY', target: 'adapter', impact: 'low' });
    }
    if (storage.latency_ms > 1000) {
        issues.push('Latência de disco extrema detectada.');
        manifest.push({ op: 'FS_CLEANUP', target: 'tmp_folder', impact: 'medium' });
    }
    if (!dna.ok) {
        issues.push(`DNA do sistema comprometido: ${dna.msg}`);
        manifest.push({ op: 'RESTORE_DNA', target: 'dynamic_rules.json', impact: 'high' });
    }
    if (parseFloat(metrics.ram_usage_pct) > 90) {
        issues.push('Saturação de memória RAM (>90%).');
        manifest.push({ op: 'PROCESS_RESTART', target: 'agente-gpt', impact: 'high' });
    }

    return {
        meta: {
            version: '39.0',
            engine: 'Universal_Physician',
            timestamp: new Date().toISOString(),
            duration_ms: Date.now() - t0,
        },
        health: {
            score: Math.max(0, 100 - issues.length * 20),
            status: issues.length === 0 ? STATUS_VALUES.HEALTHY : issues.length > 2 ? 'CRITICAL' : 'DEGRADED',
        },
        telemetry: {
            network: targets.map((url, i) => ({ url, .../** @type {NetworkProbe} */ (networkResults[i]) })),
            storage: storage,
            dna: dna,
            chrome: Object.assign({}, chrome, { proxyReport }),
            queue: queueStats,
            system: {
                ...metrics,
                event_loop_lag_ms: lag,
                uptime_seconds: Math.floor(process.uptime()),
            },
        },
        recovery_manifest: {
            detected_issues: issues,
            suggested_steps: manifest,
            can_auto_fix: issues.length > 0 && dna.ok,
        },
    };
}

export { getHardwareMetrics, probeChromeConnection, runFullCheck };
