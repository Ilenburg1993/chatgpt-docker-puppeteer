#!/usr/bin/env node

import os from 'os';
import { performance } from 'perf_hooks';

// Benchmark de CPU
function cpuBenchmark(iterations = 1000000) {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
        Math.sqrt(i); // Apenas executar operação, resultado não usado
    }
    const end = performance.now();
    return {
        iterations,
        time_ms: end - start,
        ops_per_sec: (iterations / (end - start)) * 1000,
    };
}

// Métricas de sistema
function getSystemMetrics() {
    const freeMem = os.freemem();
    const totalMem = os.totalmem();
    const cpus = os.cpus();

    return {
        platform: os.platform(),
        arch: os.arch(),
        cpu_count: cpus.length,
        cpu_model: cpus[0]?.model || 'Unknown',
        total_memory_gb: (totalMem / 1024 / 1024 / 1024).toFixed(2),
        free_memory_gb: (freeMem / 1024 / 1024 / 1024).toFixed(2),
        memory_usage_pct: ((1 - freeMem / totalMem) * 100).toFixed(1),
        load_average: os.loadavg(),
        uptime_seconds: os.uptime(),
    };
}

// Benchmark de memória
function memoryBenchmark() {
    const arrays = [];
    const start = performance.now();

    // Criar arrays grandes para testar alocação de memória
    for (let i = 0; i < 100; i++) {
        arrays.push(new Array(10000).fill(Math.random()));
    }

    const mid = performance.now();

    // Limpar memória
    arrays.length = 0;
    global.gc?.();

    const end = performance.now();

    return {
        allocation_time_ms: mid - start,
        cleanup_time_ms: end - mid,
        total_time_ms: end - start,
    };
}

async function runBenchmarks() {
    console.log('🚀 Executando benchmarks de performance...\n');

    // Métricas do sistema
    const system = getSystemMetrics();
    console.log('📊 Métricas do Sistema:');
    console.log(`   Plataforma: ${system.platform} ${system.arch}`);
    console.log(`   CPU: ${system.cpu_count}x ${system.cpu_model}`);
    console.log(
        `   Memória: ${system.free_memory_gb}GB livre / ${system.total_memory_gb}GB total (${system.memory_usage_pct}%)`,
    );
    console.log(`   Load Average: ${system.load_average.map((l) => l.toFixed(2)).join(', ')}`);
    console.log(`   Uptime: ${(system.uptime_seconds / 3600).toFixed(1)} horas\n`);

    // Benchmark de CPU
    console.log('⚡ Benchmark de CPU:');
    const cpu = cpuBenchmark();
    console.log(`   ${cpu.iterations.toLocaleString()} operações de sqrt()`);
    console.log(`   Tempo: ${cpu.time_ms.toFixed(2)}ms`);
    console.log(`   Performance: ${(cpu.ops_per_sec / 1000).toFixed(0)}K ops/seg\n`);

    // Benchmark de memória
    console.log('🧠 Benchmark de Memória:');
    const mem = memoryBenchmark();
    console.log(`   Alocação: ${mem.allocation_time_ms.toFixed(2)}ms`);
    console.log(`   Limpeza: ${mem.cleanup_time_ms.toFixed(2)}ms`);
    console.log(`   Total: ${mem.total_time_ms.toFixed(2)}ms\n`);

    // Análise de gargalos
    console.log('🔍 Análise de Performance:');
    const cpuScore = cpu.ops_per_sec / 100000; // Baseline score
    const memScore = 1000 / mem.total_time_ms; // Higher is better

    console.log(`   CPU Score: ${cpuScore.toFixed(2)} (baseline: 1.0)`);
    console.log(`   Memory Score: ${memScore.toFixed(2)} (higher is better)`);

    if (cpuScore < 0.8) {
        console.log('   ⚠️  CPU performance baixa - possível gargalo');
    }
    if (memScore < 1.0) {
        console.log('   ⚠️  Memória lenta - possível gargalo de GC');
    }
    if (parseFloat(system.memory_usage_pct) > 80) {
        console.log('   ⚠️  Memória do sistema alta - possível pressão de memória');
    }

    console.log('\n✅ Benchmarks concluídos');
}

runBenchmarks().catch(console.error);
