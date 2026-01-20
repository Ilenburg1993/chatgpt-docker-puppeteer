/* tests/helpers.js (V3 Compliant) */
const fs = require('fs');
const path = require('path');
const child_process = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const QUEUE_DIR = path.join(ROOT, 'fila');
const LOG_DIR = path.join(ROOT, 'logs');
const RUN_LOCK = path.join(ROOT, 'RUNNING.lock');
const LOG_FILE_CURRENT = path.join(LOG_DIR, 'agente_current.log');
const TMP_DIR = path.join(__dirname, 'tmp');

if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
}

const sleep = ms =>
    new Promise(r => {
        setTimeout(r, ms);
    });

function ensureDirs() {
    [QUEUE_DIR, LOG_DIR, TMP_DIR].forEach(d => {
        if (!fs.existsSync(d)) {
            fs.mkdirSync(d, { recursive: true });
        }
    });
}

// GERA TAREFA NO FORMATO SCHEMA V3
function writeTask(options) {
    ensureDirs();
    const id = options.id || `TEST-${Date.now()}`;

    const task = {
        meta: {
            id: id,
            version: '3.0',
            created_at: new Date().toISOString(),
            priority: options.priority || 5,
            source: 'test_suite',
            tags: ['test']
        },
        spec: {
            target: 'chatgpt',
            model: 'gpt-5',
            payload: {
                user_message: options.prompt || 'Test prompt'
            },
            config: { reset_context: false }
        },
        policy: {
            max_attempts: 3,
            timeout_ms: 30000, // Timeout curto para testes
            dependencies: []
        },
        state: {
            status: options.status || 'PENDING',
            attempts: 0,
            started_at: options.startedEm || null, // Compatibilidade com teste de recovery
            history: []
        }
    };

    const fp = path.join(QUEUE_DIR, `${id}.json`);
    fs.writeFileSync(fp, JSON.stringify(task, null, 2));
    return fp;
}

function readTask(id) {
    try {
        const fp = path.join(QUEUE_DIR, `${id}.json`);
        if (!fs.existsSync(fp)) {
            return null;
        }
        return JSON.parse(fs.readFileSync(fp, 'utf-8'));
    } catch (e) {
        return null;
    }
}

function removeRunLock() {
    try {
        if (fs.existsSync(RUN_LOCK)) {
            fs.unlinkSync(RUN_LOCK);
        }
    } catch (e) {
        /* Ignore lock file removal errors */
    }
}

function cleanTmp() {
    try {
        if (fs.existsSync(TMP_DIR)) {
            fs.readdirSync(TMP_DIR).forEach(f => fs.unlinkSync(path.join(TMP_DIR, f)));
        }
    } catch (e) {
        /* Ignore temp cleanup errors */
    }
}

function readLatestGlobalLogTail(lines = 50) {
    try {
        if (!fs.existsSync(LOG_FILE_CURRENT)) {
            return '<log not created yet>';
        }
        const content = fs.readFileSync(LOG_FILE_CURRENT, 'utf-8').trim().split('\n');
        return content.slice(-lines).join('\n');
    } catch (e) {
        return `<error reading log: ${e.message}>`;
    }
}

function startAgent(timeoutMs = 15000) {
    ensureDirs();
    const outPath = path.join(TMP_DIR, `stdout-${Date.now()}.log`);
    const outStream = fs.createWriteStream(outPath);

    const proc = child_process.spawn('node', ['index.js'], {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, FORCE_COLOR: '1' }
    });

    proc.stdout.pipe(outStream);
    proc.stderr.pipe(outStream);

    const ready = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            stopAgent(proc);
            reject(new Error(`Timeout (${timeoutMs}ms) aguardando agente.`));
        }, timeoutMs);

        const checkOutput = data => {
            const text = data.toString();
            // Accept multiple engine startup variants (e.g. Engine V32.0 Iniciada)
            if (/Engine V\d+\.\d+\s+Iniciad/i.test(text) || text.includes('Agente Iniciado')) {
                clearTimeout(timer);
                proc.stdout.off('data', checkOutput);
                resolve({ proc, outPath });
            }
            if (text.includes('FATAL') || text.includes('Error:')) {
                // Delay para capturar mensagem completa
                setTimeout(() => {
                    clearTimeout(timer);
                    reject(new Error(`Agente falhou: ${text.slice(0, 200)}`));
                }, 500);
            }
        };

        proc.stdout.on('data', checkOutput);
        proc.stderr.on('data', checkOutput);
    });

    return { proc, ready };
}

function stopAgent(proc) {
    if (!proc || proc.killed) {
        return;
    }
    try {
        proc.kill('SIGTERM');
        setTimeout(() => {
            try {
                proc.kill('SIGKILL');
            } catch (e) {
                /* Ignore force kill errors */
            }
        }, 2000);
    } catch (e) {
        /* Ignore process termination errors */
    }
}

async function waitForCondition(fn, timeout = 10000, interval = 500) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
        try {
            if (await fn()) {
                return true;
            }
        } catch (e) {
            /* Retry on condition check errors */
        }
        await sleep(interval);
    }
    return false;
}

module.exports = {
    writeTask,
    readTask,
    removeRunLock,
    cleanTmp,
    startAgent,
    stopAgent,
    waitForCondition,
    readLatestGlobalLogTail,
    sleep,
    ensureDirs,
    ROOT,
    QUEUE_DIR
};
