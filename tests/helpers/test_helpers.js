// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import child_process from 'node:child_process';

/** Constante/valor exportado: ROOT. */
const ROOT = path.resolve(import.meta.dirname, '..');
/** Constante/valor exportado: QUEUE_DIR. */
const QUEUE_DIR = path.join(ROOT, 'fila');
const LOG_DIR = path.join(ROOT, 'logs');
const RUN_LOCK = path.join(ROOT, 'RUNNING.lock');
const LOG_FILE_CURRENT = path.join(LOG_DIR, 'agente_current.log');
const TMP_DIR = path.join(import.meta.dirname, 'tmp');

if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
}

/** Constante/valor exportado: sleep. */
const sleep = (/** @type {number} */ ms) =>
    new Promise(r => {
        setTimeout(r, ms);
    });

/**
 * Função exportada: ensureDirs.
 * @returns {void}
 */
function ensureDirs() {
    [QUEUE_DIR, LOG_DIR, TMP_DIR].forEach(d => {
        if (!fs.existsSync(d)) {
            fs.mkdirSync(d, { recursive: true });
        }
    });
}

// GERA TAREFA NO FORMATO SCHEMA V3
/**
 * @typedef {object} WriteTaskOptions
 * @property {string} [id] - ID explícito da tarefa (default: gerado automaticamente)
 * @property {string} type - Tipo da tarefa
 * @property {string} [target] - Target URL
 * @property {*} [prompt] - Prompt da tarefa
 * @property {*} [context] - Contexto adicional
 * @property {number} [priority] - Prioridade (default: 5)
 * @property {string} [status] - Status inicial (default: PENDING)
 * @property {string|null} [startedEm] - Data de início (para testes de recovery)
 */
/**
 * Função exportada: writeTask.
 * @param {WriteTaskOptions} options
 * @returns {string}
 */
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
            tags: ['test'],
        },
        spec: {
            target: 'chatgpt',
            model: 'gpt-5',
            payload: {
                user_message: options.prompt || 'Test prompt',
            },
            config: { reset_context: false },
        },
        policy: {
            max_attempts: 3,
            timeout_ms: 30000, // Timeout curto para testes
            dependencies: [],
        },
        state: {
            status: options.status || 'PENDING',
            attempts: 0,
            started_at: options.startedEm || null, // Compatibilidade com teste de recovery
            history: [],
        },
    };

    const fp = path.join(QUEUE_DIR, `${id}.json`);
    fs.writeFileSync(fp, JSON.stringify(task, null, 2));
    return fp;
}

/**
 * Função exportada: readTask.
 * @param {string} id
 * @returns {object|null}
 */
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

/**
 * Função exportada: removeRunLock.
 * @returns {void}
 */
function removeRunLock() {
    try {
        if (fs.existsSync(RUN_LOCK)) {
            fs.unlinkSync(RUN_LOCK);
        }
    } catch (e) {
        /* Ignore lock file removal errors */
    }
}

/**
 * Função exportada: cleanTmp.
 * @returns {void}
 */
function cleanTmp() {
    try {
        if (fs.existsSync(TMP_DIR)) {
            fs.readdirSync(TMP_DIR).forEach(f => fs.unlinkSync(path.join(TMP_DIR, f)));
        }
    } catch (e) {
        /* Ignore temp cleanup errors */
    }
}

/**
 * Função exportada: readLatestGlobalLogTail.
 * @param {*} [lines]
 * @returns {string}
 */
function readLatestGlobalLogTail(lines = 50) {
    try {
        if (!fs.existsSync(LOG_FILE_CURRENT)) {
            return '<log not created yet>';
        }
        const content = fs.readFileSync(LOG_FILE_CURRENT, 'utf-8').trim().split('\n');
        return content.slice(-lines).join('\n');
    } catch (e) {
        return `<error reading log: ${e instanceof Error ? e.message : String(e)}>`;
    }
}

/**
 * Função exportada: startAgent.
 * @param {*} [timeoutMs]
 * @returns {object}
 */
function startAgent(timeoutMs = 15000) {
    ensureDirs();
    const outPath = path.join(TMP_DIR, `stdout-${Date.now()}.log`);
    const outStream = fs.createWriteStream(outPath);
    const childEnv = /** @type {Record<string, string | undefined>} */ ({ ...process.env, FORCE_COLOR: '1' });
    delete childEnv.NO_COLOR;

    const proc = child_process.spawn('node', ['index.js'], {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: childEnv,
    });

    proc.stdout.pipe(outStream);
    proc.stderr.pipe(outStream);

    const ready = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            stopAgent(proc);
            reject(new Error(`Timeout (${timeoutMs}ms) aguardando agente.`));
        }, timeoutMs);

        const checkOutput = (/** @type {Buffer} */ data) => {
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

/**
 * Função exportada: stopAgent.
 * @param {*} proc
 * @returns {void}
 */
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

/**
 * Função exportada: waitForCondition.
 * @param {function(): Promise<boolean>|boolean} fn
 * @param {number} [timeout]
 * @param {number} [interval]
 * @returns {Promise<unknown>}
 */
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

export {
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
    QUEUE_DIR,
};
