FILE_ORIGINAL: D:\chatgpt-docker-puppeteer\src\core\doctor.js
PASTA_BASE: core
DATA_DA_EXTRACAO: 2026-01-18 22:18:44
--------------------------------------------------------------------------------

/* ==========================================================================
   src/core/doctor.js
   Audit Level: 39 — Universal Physician (Standardized Metrics Edition)
   Responsabilidade: Auditoria Preditiva, Triangulação de Rede e Manifesto de Cura.
   Sincronização: server.js (V40), SADI e Futuro Sistema de Telemetria.
========================================================================== */

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const { exec } = require('child_process');
const CONFIG = require('./config');

const ROOT = path.resolve(__dirname, '../../');
const LOG_DIR = path.join(ROOT, 'logs');
const TREND_FILE = path.join(LOG_DIR, 'health_trends.json');

// --- GESTÃO DE TENDÊNCIAS (PERSISTÊNCIA DE BASELINE) ---
async function getTrends() {
    try {
        if (!fs.existsSync(TREND_FILE)) return { ram: [], cpu: [], io: [] };
        const data = await fsp.readFile(TREND_FILE, 'utf-8');
        return JSON.parse(data);
    } catch { return { ram: [], cpu: [], io: [] }; }
}

async function saveTrends(trends) {
    try {
        const limit = 50; 
        const simplified = {
            ram: trends.ram.slice(-limit),
            cpu: trends.cpu.slice(-limit),
            io: trends.io.slice(-limit),
            ts: new Date().toISOString()
        };
        await fsp.writeFile(TREND_FILE, JSON.stringify(simplified, null, 2));
    } catch (e) { /* Fail-safe */ }
}

/* ==========================================================================
   SONDAS DE ALTA FIDELIDADE
========================================================================== */

/**
 * Coleta métricas instantâneas de Hardware.
 * Absorvido do server.js para centralização de soberania de dados.
 * @returns {object} Métricas padronizadas para o Dashboard/Telemetria.
 */
function getHardwareMetrics() {
    const freeMem = os.freemem();
    const totalMem = os.totalmem();
    return {
        cpu_load: os.loadavg()[0].toFixed(2),
        ram_usage_pct: ((1 - (freeMem / totalMem)) * 100).toFixed(1),
        ram_free_gb: (freeMem / 1024 / 1024 / 1024).toFixed(2) + 'GB',
        ts: Date.now()
    };
}

/**
 * Triangulação de Rede via Handshake HTTP.
 */
async function probeConnectivity(url) {
    return new Promise((resolve) => {
        const t0 = Date.now();
        const client = url.startsWith('https') ? https : http;
        const req = client.request(url, { method: 'HEAD', timeout: 5000 }, (res) => {
            resolve({ ok: res.statusCode < 400, status: res.statusCode, ms: Date.now() - t0 });
        });
        req.on('error', () => resolve({ ok: false, status: 'OFFLINE', ms: Date.now() - t0 }));
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 'TIMEOUT', ms: 5000 }); });
        req.end();
    });
}

/**
 * Auditoria de I/O e Espaço em Disco (SLA de Hardware).
 */
async function checkStorageSLA() {
    const t0 = Date.now();
    const testFile = path.join(LOG_DIR, `doctor_io_${Date.now()}.tmp`);
    let ioLatency = 9999;
    let writeOk = false;

    try {
        await fsp.writeFile(testFile, "X".repeat(1024 * 1024)); 
        await fsp.readFile(testFile);
        await fsp.unlink(testFile);
        ioLatency = Date.now() - t0;
        writeOk = true;
    } catch (e) { writeOk = false; }

    return new Promise((resolve) => {
        const cmd = process.platform === 'win32' ? 'dir' : 'df -h .';
        exec(cmd, (err, stdout) => {
            resolve({
                latency_ms: ioLatency,
                write_ok: writeOk,
                disk_info_raw: stdout ? stdout.split('\n').slice(-2).join(' ').trim() : 'N/A'
            });
        });
    });
}

/**
 * Validação de Integridade do DNA.
 */
async function validateDNASanity() {
    const rulesPath = path.join(ROOT, 'dynamic_rules.json');
    if (!fs.existsSync(rulesPath)) return { ok: false, msg: 'DNA_MISSING' };
    try {
        const dna = JSON.parse(await fsp.readFile(rulesPath, 'utf-8'));
        const hasSelectors = dna.selectors && Object.keys(dna.selectors).length > 0;
        return { ok: hasSelectors, version: dna._meta?.version || 0 };
    } catch { return { ok: false, msg: 'DNA_CORRUPTED' }; }
}

/* ==========================================================================
   MOTOR DE DIAGNÓSTICO E MANIFESTO DE RECUPERAÇÃO
========================================================================== */

async function runFullCheck() {
    const t0 = Date.now();
    const trends = await getTrends();

    const targets = ['https://www.google.com', ... (CONFIG.allowedDomains || []).map(d => `https://${d}`)];
    const [networkResults, storage, dna, lag] = await Promise.all([
        Promise.all(targets.map(url => probeConnectivity(url))),
        checkStorageSLA(),
        validateDNASanity(),
        new Promise(r => { const s = Date.now(); setImmediate(() => r(Date.now() - s)); })
    ]);

    const metrics = getHardwareMetrics();
    
    trends.ram.push(parseFloat(metrics.ram_usage_pct));
    trends.cpu.push(parseFloat(metrics.cpu_load));
    trends.io.push(storage.latency_ms);
    await saveTrends(trends);

    const issues = [];
    const manifest = [];

    if (networkResults.some(n => !n.ok)) {
        issues.push("Conectividade instável com provedores de IA.");
        manifest.push({ op: 'NETWORK_RETRY', target: 'adapter', impact: 'low' });
    }
    if (storage.latency_ms > 1000) {
        issues.push("Latência de disco extrema detectada.");
        manifest.push({ op: 'FS_CLEANUP', target: 'tmp_folder', impact: 'medium' });
    }
    if (!dna.ok) {
        issues.push(`DNA do sistema comprometido: ${dna.msg}`);
        manifest.push({ op: 'RESTORE_DNA', target: 'dynamic_rules.json', impact: 'high' });
    }
    if (parseFloat(metrics.ram_usage_pct) > 90) {
        issues.push("Saturação de memória RAM (>90%).");
        manifest.push({ op: 'PROCESS_RESTART', target: 'agente-gpt', impact: 'high' });
    }

    return {
        meta: {
            version: "39.0",
            engine: "Universal_Physician",
            timestamp: new Date().toISOString(),
            duration_ms: Date.now() - t0
        },
        health: {
            score: Math.max(0, 100 - (issues.length * 20)),
            status: issues.length === 0 ? 'HEALTHY' : (issues.length > 2 ? 'CRITICAL' : 'DEGRADED')
        },
        telemetry: {
            network: targets.map((url, i) => ({ url, ...networkResults[i] })),
            storage: storage,
            dna: dna,
            system: {
                ...metrics,
                event_loop_lag_ms: lag
            }
        },
        recovery_manifest: {
            detected_issues: issues,
            suggested_steps: manifest,
            can_auto_fix: issues.length > 0 && dna.ok
        }
    };
}

module.exports = { runFullCheck, getHardwareMetrics };