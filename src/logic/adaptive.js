import { promises as fs } from 'node:fs';
import fss from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { log, LOG_DIR } from '#core/logger';
import CONFIG from '#core/config';

/* --------------------------------------------------------------------------
   CONSTANTES DE SEMENTE (SEEDS)
-------------------------------------------------------------------------- */
const SEED_TTFT = 15000;
const SEED_STREAM = 500;
const SEED_ECHO = 2000;

/* --------------------------------------------------------------------------
   CONSTANTES DE CIRCUIT BREAKER & GC
-------------------------------------------------------------------------- */
const CIRCUIT_BREAKER_THRESHOLD_MS = 120000; // 2min - targets mais lentos acionam circuit breaker
const TARGET_INACTIVE_THRESHOLD_MS = 86400000; // 24h - decay de targets inativos
const MAX_TARGETS = 100; // Limite de targets para GC automático

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
    last_update: z.number().default(0),
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
let persistTimeout = null;

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
            } catch (_) {
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
   PERSISTÊNCIA GARANTIDA (QUEUE PATTERN + DEBOUNCE)
-------------------------------------------------------------------------- */
function debouncedPersist() {
    if (persistTimeout) {
        clearTimeout(persistTimeout);
    }
    persistTimeout = setTimeout(() => {
        persist();
    }, 5000); // 5s debounce
}

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
    const oldAvg = stats.avg;

    // Welford's Algorithm correto:
    stats.avg = oldAvg + alpha * diff;
    const diff2 = value - stats.avg; // Diff com NOVA média
    stats.var = (1 - alpha) * stats.var + alpha * diff * diff2;

    // Arredondamento final APENAS da média (variância mantida precisa)
    stats.avg = Math.round(stats.avg);
    stats.var = Math.max(0, stats.var); // Sem arredondamento para manter precisão
    stats.count++;
}

/* --------------------------------------------------------------------------
   FUNÇÕES AUXILIARES (CIRCUIT BREAKER, DECAY, GC)
-------------------------------------------------------------------------- */
function shouldCircuitBreak(stats) {
    return stats.count >= 5 && stats.avg > CIRCUIT_BREAKER_THRESHOLD_MS;
}

function decayIfNeeded(profile, now) {
    const age = now - profile.last_update;
    if (age > TARGET_INACTIVE_THRESHOLD_MS) {
        // Decay exponencial: mais velho = menos confiança
        const decayFactor = Math.max(0.1, Math.exp(-age / (7 * TARGET_INACTIVE_THRESHOLD_MS)));
        profile.ttft.count = Math.floor(profile.ttft.count * decayFactor);
        profile.stream.count = Math.floor(profile.stream.count * decayFactor);
        profile.echo.count = Math.floor(profile.echo.count * decayFactor);
        log('INFO', `[ADAPTIVE] Decay aplicado: age=${Math.round(age/3600000)}h, factor=${decayFactor.toFixed(2)}`);
    }
}

function garbageCollectTargets() {
    const targets = Object.entries(state.targets);
    if (targets.length > MAX_TARGETS) {
        const sorted = targets.sort((a, b) => a[1].last_update - b[1].last_update);
        const toRemove = sorted.slice(0, sorted.length - MAX_TARGETS);
        toRemove.forEach(([key]) => {
            delete state.targets[key];
            log('INFO', `[ADAPTIVE] GC: removido target inativo: ${key}`);
        });
    }
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
    const now = Date.now();

    if (!state.targets[key]) {
        state.targets[key] = {
            ttft: createEmptyStats(SEED_TTFT),
            stream: createEmptyStats(SEED_STREAM),
            echo: createEmptyStats(SEED_ECHO),
            last_update: now,
        };
    }

    // Update timestamp
    state.targets[key].last_update = now;

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

    state.last_adjustment_at = Date.now();

    // [V46] Garbage collection de targets inativos
    if (Math.random() < 0.01) {
        // 1% chance por call (evita overhead)
        garbageCollectTargets();
    }

    debouncedPersist();
}

async function getAdjustedTimeout(target = 'generic', messageCount = 0, phase = 'STREAM') {
    if (!isReady) {
        await readyPromise;
    }

    const now = Date.now();
    const profile = state.targets[target.toLowerCase()];

    // [V46] Decay de targets inativos
    if (profile) {
        decayIfNeeded(profile, now);
    }

    const stats = !profile
        ? createEmptyStats(phase === 'STREAM' ? SEED_STREAM : SEED_TTFT)
        : phase === 'INITIAL' || phase === 'TTFT'
          ? profile.ttft
          : profile.stream;

    // [V46] Circuit Breaker para degradação extrema
    if (shouldCircuitBreak(stats)) {
        log(
            'ERROR',
            `[ADAPTIVE] ⚠️  Circuit breaker ativado: ${target} (avg=${stats.avg}ms > ${CIRCUIT_BREAKER_THRESHOLD_MS}ms)`
        );
        return {
            timeout: 300000,
            circuit_broken: true,
            breakdown: {
                learned_avg: stats.avg,
                safety_margin: 0,
                context_penalty: 0,
                std_dev: Math.round(Math.sqrt(Math.max(0, stats.var))),
            },
            phase,
            target: target.toLowerCase(),
            warning: 'Target extremamente lento - considere fallback',
        };
    }

    const avg = Math.max(1, stats.avg);
    const std = Math.sqrt(Math.max(0, stats.var));

    const base = avg;
    const margin = Math.round(3 * std); // P99.7 se distribuição normal

    // Context penalty: log2(n+2)*2000 = ~2s por dobra de mensagens (cap 20s)
    // Rationale: conversas longas precisam de mais tempo (modelo carrega mais contexto)
    const context = Math.min(20000, Math.round(Math.log2(messageCount + 2) * 2000));

    const total = base + margin + context;
    const min = phase === 'INITIAL' ? 30000 : 10000;

    return {
        timeout: Math.min(300000, Math.max(min, total)),
        circuit_broken: false, // [V46] Sempre presente para consistência de API
        breakdown: {
            learned_avg: base,
            safety_margin: margin,
            context_penalty: context,
            std_dev: Math.round(std),
        },
        phase,
        target: target.toLowerCase(),
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

async function getHealthStatus() {
    if (!isReady) {
        await readyPromise;
    }

    const now = Date.now();
    const targets = Object.entries(state.targets);
    const staleTargets = targets.filter(([, p]) => now - p.last_update > TARGET_INACTIVE_THRESHOLD_MS);
    const circuitBrokenTargets = targets.filter(([, p]) => shouldCircuitBreak(p.stream));

    return {
        status: isReady ? 'HEALTHY' : 'NOT_READY',
        state_file: STATE_FILE,
        targets_count: targets.length,
        stale_targets_count: staleTargets.length,
        stale_targets: staleTargets.map(([k]) => k),
        circuit_broken_count: circuitBrokenTargets.length,
        circuit_broken_targets: circuitBrokenTargets.map(([k, p]) => ({ target: k, avg: p.stream.avg })),
        infra_health: state.infra.count >= 10 ? 'SUFFICIENT_DATA' : 'INSUFFICIENT_DATA',
        infra_samples: state.infra.count,
        last_adjustment: state.last_adjustment_at > 0 ? new Date(state.last_adjustment_at).toISOString() : 'never',
        persist_locked: persistLock,
        pending_persist: pendingPersist,
    };
}

function getPercentileTimeout(stats, percentile = 95) {
    const z_scores = {
        50: 0.0, // P50 (mediana)
        95: 1.645, // P95
        99: 2.326, // P99
        99.7: 3.0, // P99.7 (atual padrão)
    };

    const avg = Math.max(1, stats.avg);
    const std = Math.sqrt(Math.max(0, stats.var));
    const z = z_scores[percentile] || 1.645;

    return Math.round(avg + z * std);
}

export const getSnapshot = () => JSON.parse(JSON.stringify(state));
export const forcePersist = persist;
export const values = {
    get HEARTBEAT_TIMEOUT() { return Math.round(state.infra.avg * 5); },
    get ECHO_TIMEOUT() { return Math.round((state.targets.chatgpt?.echo.avg || SEED_ECHO) * 3); },
    get PROGRESS_TIMEOUT() { return 60000; },
};
export { recordMetric, getAdjustedTimeout, getStabilityMetrics, getHealthStatus, getPercentileTimeout };
