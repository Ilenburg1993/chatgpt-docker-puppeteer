/* ==========================================================================
   server.js
   Audit Level: 39 — Ultimate Diamond Mission Control (NASA Standard)
   Responsabilidade: Orquestração de API, Telemetria Real-time e Auto-Cura.
   Sincronizado com: io.js (V34), schemas.js (V34), memory.js (V33) e doctor.js.
========================================================================== */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const pm2 = require('pm2');
const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;
const os = require('os');
const { exec } = require('child_process');
const compression = require('compression');

// --- MÓDULOS INTERNOS DE ALTA CONFIANÇA ---
const io = require('./src/infra/io');
const schemas = require('./src/core/schemas');
const memory = require('./src/core/memory');
const doctor = require('./src/core/doctor');
const { log } = require('./src/core/logger');

// --- CONFIGURAÇÃO DE AMBIENTE ---
const PORT = process.env.PORT || 3000;
const ROOT = path.resolve(__dirname);
const AGENTE_NAME = 'agente-gpt';
const CONFIG_FILE = path.join(ROOT, 'config.json');
const LOG_FILE = path.join(ROOT, 'logs', 'agente_current.log');
const AUDIT_FILE = path.join(ROOT, 'logs', 'audit.log');
const TARGETS_DIR = path.join(ROOT, 'src', 'driver', 'targets');

const app = express();
const server = http.createServer(app);
const socketIo = new Server(server, {
    cors: { origin: "*" },
    transports: ['websocket'],
    pingTimeout: 10000,
    pingInterval: 5000
});

// --- MIDDLEWARES ---
app.use(compression()); 
app.use(express.json());
app.use(express.static('public'));
app.use('/crash_reports', express.static(path.join(ROOT, 'logs', 'crash_reports')));

/* ==========================================================================
   SISTEMA DE AUDITORIA E ROTAÇÃO (NON-BLOCKING)
========================================================================== */

async function auditAction(action, details) {
    const entry = `[${new Date().toISOString()}] [AUDIT] ${action} | ${JSON.stringify(details)}\n`;
    try {
        const stats = await fsp.stat(AUDIT_FILE).catch(() => null);
        if (stats && stats.size > 2 * 1024 * 1024) {
            await fsp.rename(AUDIT_FILE, `${AUDIT_FILE}.${Date.now()}.bak`);
        }
        await fsp.appendFile(AUDIT_FILE, entry, 'utf-8');
    } catch (e) { /* Silent fail for audit */ }
}

/* ==========================================================================
   WATCHDOG DE TELEMETRIA (SELF-HEALING BUS)
========================================================================== */

let isPm2Connected = false;

function connectToSystemBus() {
    pm2.connect((err) => {
        if (err) {
            setTimeout(connectToSystemBus, 5000);
            return;
        }
        isPm2Connected = true;
        pm2.launchBus((busErr, bus) => {
            if (busErr) return;
            bus.on('process:event', (data) => {
                if (data.process.name === AGENTE_NAME) {
                    socketIo.emit('status_update', { 
                        event: data.event, 
                        status: data.process.status,
                        ts: Date.now()
                    });
                }
            });
        });
    });
}

// Verifica saúde do link PM2 a cada 30s
setInterval(() => {
    if (isPm2Connected) {
        pm2.list((err) => {
            if (err) {
                isPm2Connected = false;
                connectToSystemBus();
            }
        });
    }
}, 30000);

connectToSystemBus();

/* ==========================================================================
   LOG STREAMING ENGINE (RESILIENTE A ROTAÇÃO)
========================================================================== */

/**
 * Watcher Robusto: No Windows, a rotação de arquivos quebra o fs.watch.
 * Esta implementação detecta o erro de Inode e re-anexa o watcher automaticamente.
 */
let logWatcher = null;
let logReadActive = false;

function setupLogWatcher() {
    if (logWatcher) {
        logWatcher.close();
        logWatcher = null;
    }

    if (!fs.existsSync(LOG_FILE)) {
        setTimeout(setupLogWatcher, 5000);
        return;
    }

    logWatcher = fs.watch(LOG_FILE, (event) => {
        if (event === 'rename') {
            // Arquivo rotacionado. Reinicia o watcher no novo arquivo.
            setTimeout(setupLogWatcher, 500);
            return;
        }

        if (event === 'change' && !logReadActive) {
            logReadActive = true;
            setTimeout(async () => {
                try {
                    const stats = await fsp.stat(LOG_FILE);
                    const bufferSize = 2048;
                    const start = Math.max(0, stats.size - bufferSize);
                    const stream = fs.createReadStream(LOG_FILE, { start });
                    
                    stream.on('data', (chunk) => socketIo.emit('log_stream', chunk.toString()));
                    const release = () => { logReadActive = false; };
                    stream.on('end', release);
                    stream.on('close', release);
                    stream.on('error', release);
                } catch (e) { logReadActive = false; }
            }, 100);
        }
    });
}
setupLogWatcher();

// Telemetria de Hardware (Push 5s)
setInterval(() => {
    socketIo.emit('sys_metrics', {
        cpu_load: os.loadavg()[0].toFixed(2),
        ram_free: (os.freemem() / 1024 / 1024 / 1024).toFixed(2) + 'GB',
        ts: Date.now()
    });
}, 5000);

/* ==========================================================================
   API: GESTÃO DE TAREFAS E RESULTADOS (NON-BLOCKING)
========================================================================== */

app.get('/api/tasks', async (req, res) => {
    try {
        const queue = await io.getQueue();
        res.json(queue);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/tasks', async (req, res) => {
    try {
        const task = schemas.parseTask(req.body);
        await io.saveTask(task);
        await auditAction('CREATE_TASK', { id: task.meta.id });
        res.json({ success: true, id: task.meta.id });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/tasks/:id', async (req, res) => {
    try {
        const safeId = req.params.id.replace(/[^a-zA-Z0-9._-]/g, '');
        const task = schemas.parseTask(req.body);
        if (task.meta.id !== safeId) throw new Error("Integrity Violation: ID Mismatch.");
        await io.saveTask(task);
        await auditAction('EDIT_TASK', { id: safeId });
        res.json({ success: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/tasks/:id', async (req, res) => {
    try {
        const safeId = req.params.id.replace(/[^a-zA-Z0-9._-]/g, '');
        await io.deleteTask(safeId);
        await auditAction('DELETE_TASK', { id: safeId });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/results/:id', async (req, res) => {
    const safeId = req.params.id.replace(/[^a-zA-Z0-9._-]/g, '');
    const fp = path.join(io.RESPONSE_DIR, `${safeId}.txt`);
    try {
        await fsp.access(fp);
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        fs.createReadStream(fp).pipe(res);
    } catch (e) { res.status(404).json({ error: "Result not found." }); }
});

app.post('/api/queue/retry-failed', async (req, res) => {
    try {
        const queue = await io.getQueue();
        const failed = queue.filter(t => t.state.status === 'FAILED');
        for (const t of failed) {
            t.state.status = 'PENDING';
            t.state.attempts = 0;
            await io.saveTask(t);
        }
        await auditAction('RETRY_BATCH', { count: failed.length });
        res.json({ success: true, count: failed.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ==========================================================================
   API: INFRAESTRUTURA, DNA E LOCKS
========================================================================== */

app.get('/api/health', async (req, res) => {
    res.json(await doctor.runFullCheck());
});

app.get('/api/config', async (req, res) => {
    res.json(await io.safeReadJSON(CONFIG_FILE) || {});
});

app.put('/api/config', async (req, res) => {
    try {
        await io.atomicWrite(CONFIG_FILE, JSON.stringify(req.body, null, 2));
        await auditAction('UPDATE_CONFIG', { user: 'GUI' });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/locks', async (req, res) => {
    try {
        const files = (await fsp.readdir(ROOT)).filter(f => f.startsWith('RUNNING_') && f.endsWith('.lock'));
        const locks = await Promise.all(files.map(async f => {
            const content = await io.safeReadJSON(path.join(ROOT, f));
            return content ? { target: f.replace('RUNNING_', '').replace('.lock', ''), ...content } : null;
        }));
        res.json(locks.filter(l => l && l.pid));
    } catch (e) { res.json([]); }
});

app.put('/api/dna', async (req, res) => {
    try {
        await io.saveDna(req.body);
        await auditAction('UPDATE_DNA', { user: 'GUI' });
        res.json({ success: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

/* ==========================================================================
   API: CONTROLE DE PROCESSO (PM2)
========================================================================== */

app.post('/api/control/:action', async (req, res) => {
    const action = req.params.action;
    if (!isPm2Connected) return res.status(503).json({ error: "PM2 Offline" });

    await auditAction('PROCESS_CONTROL', { action });

    const cb = (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    };

    if (action === 'start') {
        pm2.describe(AGENTE_NAME, (err, list) => {
            if (!err && list && list.length > 0) pm2.restart(AGENTE_NAME, cb);
            else pm2.start({ 
                name: AGENTE_NAME, script: './index.js', node_args: '--expose-gc',
                max_memory_restart: '1G', env: { FORCE_COLOR: "1" }
            }, cb);
        });
    } 
    else if (action === 'stop') pm2.stop(AGENTE_NAME, cb);
    else if (action === 'restart') pm2.restart(AGENTE_NAME, cb);
    else if (action === 'kill_daemon') {
        exec('npx pm2 kill', (err) => res.json({ success: !err }));
    }
    else res.status(400).json({ error: "Invalid action" });
});

app.get('/api/status', (req, res) => {
    if (!isPm2Connected) return res.json({ agent: 'offline' });
    pm2.describe(AGENTE_NAME, (err, list) => {
        const appInfo = list && list[0];
        res.json({ 
            agent: appInfo ? appInfo.pm2_env.status : 'stopped',
            memory: appInfo ? appInfo.monit.memory : 0,
            uptime: (appInfo && appInfo.pm2_env.status === 'online') ? (Date.now() - appInfo.pm2_env.pm_uptime) : 0
        });
    });
});

/* ==========================================================================
   WATCHER E INICIALIZAÇÃO
========================================================================== */

let updateDebounce;
fs.watch(io.QUEUE_DIR, (event, filename) => {
    if (filename && filename.endsWith('.json')) {
        io.setCacheDirty();
        clearTimeout(updateDebounce);
        updateDebounce = setTimeout(() => socketIo.emit('update'), 500);
    }
});

/**
 * Inicialização com Port-Hunting.
 */
function startServer(port) {
    server.listen(port, () => {
        console.log(`\n🚀 MISSION CONTROL CENTER v39.0 ONLINE`);
        console.log(`🔗 http://localhost:${port}`);
    }).on('error', (e) => {
        if (e.code === 'EADDRINUSE') {
            console.log(`[SYSTEM] Porta ${port} ocupada, tentando ${port + 1}...`);
            startServer(port + 1);
        }
    });
}

/**
 * Graceful Shutdown: Garante que os watchers sejam fechados antes do processo morrer.
 */
process.on('SIGINT', () => {
    if (logWatcher) logWatcher.close();
    pm2.disconnect();
    process.exit(0);
});

startServer(PORT);