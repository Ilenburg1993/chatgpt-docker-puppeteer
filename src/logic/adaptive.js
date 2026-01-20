/* ==========================================================================
   src/logic/adaptive.js
   Audit Level: 100 — Industrial Hardening (Consolidated V45)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
========================================================================== */

const fs = require('fs').promises;
const fss = require('fs');
const path = require('path');
const { z } = require('zod');
const { log, LOG_DIR } = require('../core/logger');
const CONFIG = require('../core/config');

/* --------------------------------------------------------------------------
   CONSTANTES DE SEMENTE (SEEDS)
-------------------------------------------------------------------------- */
const SEED_TTFT = 15000;
const SEED_STREAM = 500;
const SEED_ECHO = 2000;

/* --------------------------------------------------------------------------
   SCHEMAS (INTEGRIDADE)
-------------------------------------------------------------------------- */
const StatsSchema = z.object({
    avg: z.number().nonnegative(),
    var: z.number().nonnegative(),
    count: z.number().nonnegative()
});

const TargetProfileSchema = z.object({
    ttft: StatsSchema,
    stream: StatsSchema,
    echo: StatsSchema,
    success_count: z.number()
});

const AdaptiveStateSchema = z.object({
    targets: z.record(TargetProfileSchema),
    infra: StatsSchema,
    last_adjustment_at: z.number()
});

/* --------------------------------------------------------------------------
   ESTADO PRIVADO
-------------------------------------------------------------------------- */
const STATE_FILE = path.join(LOG_DIR, 'adaptive_state.json');

const createEmptyStats = avg => ({
    avg,
    var: Math.pow(avg / 2, 2),
    count: 0
});

const defaultState = {
    targets: {},
    infra: createEmptyStats(200),
    last_adjustment_at: 0
};

let state = defaultState;
let isReady = false;
let persistLock = false;
let pendingPersist = false;

/* --------------------------------------------------------------------------
   INIT (ANTIFRÁGIL)
-------------------------------------------------------------------------- */
async function init() {
    try {
        if (!fss.existsSync(LOG_DIR)) {
            await fs.mkdir(LOG_DIR, { recursive: true });
        }

        if (fss.existsSync(STATE_FILE)) {
            const rawContent = await fs.readFile(STATE_FILE, 'utf-8');
            try {
                state = AdaptiveStateSchema.parse(JSON.parse(rawContent));
            } catch (_parseErr) {
                // [FIX] Preservação forense de dados corrompidos
                const bak = `${STATE_FILE}.bak.${Date.now()}`;
                await fs.writeFile(bak, rawContent);
                log('ERROR', `[ADAPTIVE] Corrupção detectada. Backup criado em: ${bak}`);
                state = defaultState;
            }
        }
    } catch (e) {
        log('WARN', `[ADAPTIVE] Falha no boot: ${e.message}`);
        state = defaultState;
    } finally {
        isReady = true;
    }
}

const readyPromise = init();

/* --------------------------------------------------------------------------
   PERSISTÊNCIA GARANTIDA (QUEUE PATTERN)
-------------------------------------------------------------------------- */
async function persist() {
    if (persistLock) {
        pendingPersist = true;
        return;
    }
    persistLock = true;

    try {
        const tmp = `${STATE_FILE}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(state, null, 2));
        await fs.rename(tmp, STATE_FILE);
    } catch (e) {
        log('ERROR', `[ADAPTIVE] Falha de escrita: ${e.message}`);
    } finally {
    // eslint-disable-next-line require-atomic-updates -- Single-threaded execution, no race condition
        persistLock = false;
        if (pendingPersist) {
            pendingPersist = false;
            setImmediate(() => persist()); // Processa pendência no próximo ciclo
        }
    }
}

/* --------------------------------------------------------------------------
   MOTOR ESTATÍSTICO
-------------------------------------------------------------------------- */
function updateStats(stats, value, label) {
    if (!Number.isFinite(value) || value < 0) {
        return;
    }

    const std = Math.sqrt(Math.max(0, stats.var));
    if (stats.count > 10 && value > stats.avg + 6 * std) {
        log('WARN', `[ADAPTIVE] Outlier rejeitado (${label}): ${value}ms`);
        return;
    }

    const alpha = stats.count < 20 ? 0.4 : CONFIG.ADAPTIVE_ALPHA || 0.15;
    const diff = value - stats.avg;

    stats.avg = Math.round(stats.avg + alpha * diff);
    stats.var = Math.max(0, Math.round((1 - alpha) * (stats.var + alpha * diff * diff)));
    stats.count++;
}

/* --------------------------------------------------------------------------
   API PÚBLICA
-------------------------------------------------------------------------- */
async function recordMetric(type, ms, target = 'generic') {
    if (!isReady) {
        await readyPromise;
    }
    if (!Number.isFinite(ms) || ms < 0) {
        return;
    }

    const key = target.toLowerCase();
    if (!state.targets[key]) {
        state.targets[key] = {
            ttft: createEmptyStats(SEED_TTFT),
            stream: createEmptyStats(SEED_STREAM),
            echo: createEmptyStats(SEED_ECHO),
            success_count: 0
        };
    }

    switch (type) {
        case 'ttft':
            updateStats(state.targets[key].ttft, ms, 'TTFT');
            break;
        case 'gap':
            updateStats(state.targets[key].stream, ms, 'STREAM');
            break;
        case 'echo':
            updateStats(state.targets[key].echo, ms, 'ECHO');
            break;
        case 'heartbeat':
            updateStats(state.infra, ms, 'INFRA');
            break;
    }

    state.last_adjustment_at = Date.now(); // [FIX] Atualização de contrato

    if (Math.random() < 0.05) {
        persist();
    }
}

async function getAdjustedTimeout(target = 'generic', messageCount = 0, phase = 'STREAM') {
    if (!isReady) {
        await readyPromise;
    }

    const profile = state.targets[target.toLowerCase()];
    const stats = !profile
        ? createEmptyStats(phase === 'STREAM' ? SEED_STREAM : SEED_TTFT) // [FIX] Fallback consistente
        : phase === 'INITIAL' || phase === 'TTFT'
            ? profile.ttft
            : profile.stream;

    const avg = Math.max(1, stats.avg);
    const std = Math.sqrt(Math.max(0, stats.var));

    const base = avg;
    const margin = Math.round(3 * std);
    const context = Math.min(20000, Math.round(Math.log2(messageCount + 2) * 2000));

    const total = base + margin + context;
    const min = phase === 'INITIAL' ? 30000 : 10000;

    return {
        timeout: Math.min(300000, Math.max(min, total)),
        breakdown: {
            learned_avg: base,
            safety_margin: margin,
            context_penalty: context,
            std_dev: Math.round(std)
        },
        phase,
        target: target.toLowerCase()
    };
}

async function getStabilityMetrics(target = 'generic') {
    if (!isReady) {
        await readyPromise;
    }

    const profile = state.targets[target.toLowerCase()];
    if (!profile || profile.stream.count === 0) {
        return { score: 100, status: 'STABLE', samples: 0 };
    }

    const avg = Math.max(1, profile.stream.avg);
    const cv = Math.sqrt(Math.max(0, profile.stream.var)) / avg;
    const score = Math.max(0, Math.min(100, Math.round(100 - cv * 100)));

    return {
        score,
        status: score > 80 ? 'STABLE' : score > 50 ? 'DEGRADED' : 'UNSTABLE',
        samples: profile.stream.count
    };
}

module.exports = {
    recordMetric,
    getAdjustedTimeout,
    getStabilityMetrics,
    getSnapshot: () => JSON.parse(JSON.stringify(state)),
    get values() {
        return {
            HEARTBEAT_TIMEOUT: Math.round(state.infra.avg * 5),
            ECHO_TIMEOUT: Math.round((state.targets.chatgpt?.echo.avg || SEED_ECHO) * 3),
            PROGRESS_TIMEOUT: 60000
        };
    }
};
