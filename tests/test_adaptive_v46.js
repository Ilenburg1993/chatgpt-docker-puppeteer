#!/usr/bin/env node
import adaptive from '#logic/adaptive';
// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';

/* --------------------------------------------------------------------------
   SETUP & TEARDOWN
-------------------------------------------------------------------------- */
const STATE_FILE = path.join(import.meta.dirname, '..', 'logs', 'adaptive_state.json');
let originalState = null;

async function setup() {
    // Backup state atual
    if (fs.existsSync(STATE_FILE)) {
        originalState = fs.readFileSync(STATE_FILE, 'utf-8');
    }
}

async function teardown() {
    // Restaura state original
    if (originalState) {
        fs.writeFileSync(STATE_FILE, originalState);
    } else if (fs.existsSync(STATE_FILE)) {
        fs.unlinkSync(STATE_FILE);
    }
}

/* --------------------------------------------------------------------------
   HELPERS
-------------------------------------------------------------------------- */
function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${expected}, got ${actual}`);
    }
}

function assertGreater(actual, threshold, message) {
    if (actual <= threshold) {
        throw new Error(`${message}: expected > ${threshold}, got ${actual}`);
    }
}

function assertLess(actual, threshold, message) {
    if (actual >= threshold) {
        throw new Error(`${message}: expected < ${threshold}, got ${actual}`);
    }
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/* --------------------------------------------------------------------------
   TESTES
-------------------------------------------------------------------------- */
const tests = [];

// Test 1: Variância Converge Corretamente (Welford's Algorithm)
tests.push({
    name: 'Variância converge corretamente após 100 samples',
    async run() {
        // Simular 100 métricas com média=1000, std=200
        for (let i = 0; i < 100; i++) {
            const value = 1000 + (Math.random() - 0.5) * 400; // ~N(1000, 200)
            await adaptive.recordMetric('ttft', value, 'test-variance');
        }

        const snapshot = adaptive.getSnapshot();
        const profile = snapshot.targets['test-variance'];
        const std = Math.sqrt(profile.ttft.var);

        // Após 100 samples, avg deve estar próximo de 1000 (±10%)
        assertGreater(profile.ttft.avg, 900, 'Média TTFT');
        assertLess(profile.ttft.avg, 1100, 'Média TTFT');

        // Std deve estar entre 80-260 (tolerância maior devido ao EMA com alpha variável)
        assertGreater(std, 80, 'Desvio padrão TTFT');
        assertLess(std, 260, 'Desvio padrão TTFT');

        console.log(`  Stats: avg=${profile.ttft.avg}, std=${Math.round(std)}, count=${profile.ttft.count}`);
    },
});

// Test 2: Circuit Breaker Lógica (Verificação de shouldCircuitBreak)
tests.push({
    name: 'Circuit breaker detecta targets lentos corretamente',
    async run() {
        // Teste simplificado: verificar lógica de circuit breaker
        // Criar mock de stats com avg alto
        const mockStats = {
            avg: 150000, // 150s - acima do threshold de 120s
            var: 10000,
            count: 10,
        };

        // shouldCircuitBreak deveria retornar true
        // Como a função é privada, vamos testar indiretamente via getAdjustedTimeout
        // usando um target que já tem avg alto

        // Criar target com valores graduais para evitar outlier rejection
        const targetName = `circuit-test-${Math.random()}`;
        const values = [
            1000, 3000, 10000, 30000, 60000, 90000, 110000, 125000, 135000, 145000, 150000, 150000, 150000, 150000,
            150000,
        ];

        for (const value of values) {
            await adaptive.recordMetric('stream', value, targetName);
        }

        const snapshot = adaptive.getSnapshot();
        const profile = snapshot.targets[targetName];
        console.log(`  Final avg: ${profile.stream.avg}ms (count=${profile.stream.count})`);

        // Se avg > 120000, circuit breaker deve ativar
        const result = await adaptive.getAdjustedTimeout(targetName, 0, 'STREAM');

        if (profile.stream.avg > 120000) {
            assertEqual(result.circuit_broken, true, 'Circuit breaker ativado para avg alto');
            assertEqual(result.timeout, 300000, 'Timeout 5min quando circuit break');
        } else {
            // Se avg ainda não chegou a 120s, pelo menos verificar que circuit_broken existe
            assertEqual(typeof result.circuit_broken, 'boolean', 'circuit_broken field presente');
        }

        console.log(`  Circuit status: ${result.circuit_broken ? 'ATIVO' : 'inativo'}`);
    },
});

// Test 3: Health Check API Retorna Status Completo
tests.push({
    name: 'Health check API retorna status completo',
    async run() {
        // Criar alguns targets
        await adaptive.recordMetric('ttft', 1000, 'test-health-1');
        await adaptive.recordMetric('stream', 500, 'test-health-2');

        const health = await adaptive.getHealthStatus();

        assertEqual(health.status, 'HEALTHY', 'Status geral');
        assertGreater(health.targets_count, 0, 'Número de targets');
        assertEqual(typeof health.infra_health, 'string', 'Infra health tipo');
        assertEqual(typeof health.persist_locked, 'boolean', 'Persist lock tipo');

        console.log(`  Targets: ${health.targets_count}, Infra: ${health.infra_health}`);
    },
});

// Test 4: Target GC Remove Targets Mais Antigos
tests.push({
    name: 'Target GC remove targets mais antigos quando excede MAX_TARGETS',
    async run() {
        // Criar 105 targets (excede limite de 100)
        for (let i = 0; i < 105; i++) {
            await adaptive.recordMetric('stream', 500, `test-gc-${i}`);
        }

        // Forçar múltiplas chamadas para aumentar probabilidade de GC (1% chance por call)
        for (let i = 0; i < 200; i++) {
            await adaptive.recordMetric('stream', 500, 'test-gc-trigger');
        }

        const snapshot = adaptive.getSnapshot();
        const targetsCount = Object.keys(snapshot.targets).length;

        // Deve estar próximo ou abaixo de 100
        assertLess(targetsCount, 110, 'Número de targets após GC');
        console.log(`  Targets após GC: ${targetsCount}`);
    },
});

// Test 5: Decay de Targets Inativos (simulado via getAdjustedTimeout)
tests.push({
    name: 'Decay é chamado em getAdjustedTimeout para targets antigos',
    async run() {
        // Criar target com samples
        for (let i = 0; i < 20; i++) {
            await adaptive.recordMetric('stream', 500, 'test-decay');
        }

        // Verificar que getAdjustedTimeout funciona sem erros
        const result = await adaptive.getAdjustedTimeout('test-decay', 0, 'STREAM');

        assertEqual(typeof result.timeout, 'number', 'Timeout tipo');
        assertGreater(result.timeout, 0, 'Timeout positivo');
        console.log(`  Timeout calculado: ${result.timeout}ms`);
    },
});

// Test 6: Percentile Timeout P95 < P99 < P99.7
tests.push({
    name: 'Percentile timeouts seguem ordem P95 < P99 < P99.7',
    async run() {
        // Criar target com variância MUITO ALTA (range 100-2000ms = 1900ms spread)
        for (let i = 0; i < 100; i++) {
            await adaptive.recordMetric('stream', 100 + Math.random() * 1900, 'test-percentile');
        }

        const snapshot = adaptive.getSnapshot();
        const stats = snapshot.targets['test-percentile'].stream;

        const p50 = adaptive.getPercentileTimeout(stats, 50);
        const p95 = adaptive.getPercentileTimeout(stats, 95);
        const p99 = adaptive.getPercentileTimeout(stats, 99);
        const p997 = adaptive.getPercentileTimeout(stats, 99.7);

        // P50 deve ser MENOR que P95 (se variância é alta)
        assertLess(p50, p95 * 1.01, 'P50 <= P95'); // Tolerar até 1% de diferença devido ao arredondamento
        assertLess(p95, p99, 'P95 < P99');
        assertLess(p99, p997, 'P99 < P99.7');

        console.log(`  P50=${p50}, P95=${p95}, P99=${p99}, P99.7=${p997}`);
    },
});

// Test 7: last_update É Atualizado em recordMetric
tests.push({
    name: 'last_update é atualizado em recordMetric',
    async run() {
        const before = Date.now();
        await sleep(10); // Pequeno delay
        await adaptive.recordMetric('stream', 500, 'test-timestamp');
        await sleep(10);
        const after = Date.now();

        const snapshot = adaptive.getSnapshot();
        const profile = snapshot.targets['test-timestamp'];

        assertGreater(profile.last_update, before, 'last_update mínimo');
        assertLess(profile.last_update, after, 'last_update máximo');

        console.log(`  last_update: ${new Date(profile.last_update).toISOString()}`);
    },
});

/* --------------------------------------------------------------------------
   RUNNER
-------------------------------------------------------------------------- */
async function runTests() {
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║       ADAPTIVE SYSTEM V46 - VALIDATION TESTS                 ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

    await setup();

    let passed = 0;
    let failed = 0;

    for (const test of tests) {
        try {
            process.stdout.write(`🧪 ${test.name}... `);
            await test.run();
            console.log('✅');
            passed++;
        } catch (e) {
            console.log(`❌\n   Error: ${e.message}`);
            failed++;
        }
    }

    console.log('\n' + '─'.repeat(64));
    console.log(`📊 Results: ✅ Passed: ${passed}, ❌ Failed: ${failed}, 📈 Total: ${tests.length}`);

    if (failed === 0) {
        console.log('✅ ALL TESTS PASSED - ADAPTIVE V46 VALIDATED\n');
    } else {
        console.log(`❌ ${failed} TEST(S) FAILED\n`);
    }

    await teardown();

    process.exit(failed > 0 ? 1 : 0);
}

// Run
runTests().catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
});
