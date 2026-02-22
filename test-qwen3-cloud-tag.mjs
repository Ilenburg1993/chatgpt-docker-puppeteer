#!/usr/bin/env node
/**
 * Teste com modelos qwen3 usando tag :cloud
 * Baseado em https://ollama.com/library/qwen3-coder-next:cloud
 */

console.log('='.repeat(80));
console.log('TESTE: MODELOS QWEN3 CLOUD (tag :cloud)');
console.log('='.repeat(80));
console.log();

// Teste 1: qwen3-coder-next:cloud para CÓDIGO
console.log('📝 TESTE 1: GERAÇÃO DE CÓDIGO (qwen3-coder-next:cloud)');
console.log('-'.repeat(80));
console.log('Modelo: qwen3-coder-next:cloud (80B MoE, 3B active)');
console.log('Prompt: Write a JavaScript async function to fetch user data from an API');
console.log();

try {
    const response = await fetch('http://host.docker.internal:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'qwen3-coder-next:cloud',
            prompt: 'Write a JavaScript async function named fetchUserData that takes a userId and fetches user data from an API endpoint. Include error handling. Just the code.',
            stream: false,
            options: {
                temperature: 0.3,
                num_predict: 200,
            },
        }),
        signal: AbortSignal.timeout(60000),
    });

    const data = await response.json();

    if (!response.ok) {
        console.error('❌ Erro:', response.status);
        console.error('Detalhes:', JSON.stringify(data, null, 2));
    } else {
        console.log('✅ RESPOSTA LITERAL (qwen3-coder-next:cloud - CÓDIGO):');
        console.log('='.repeat(80));
        console.log(data.response);
        console.log('='.repeat(80));
        console.log();
        console.log('📊 Métricas:');
        console.log('  - Modelo:', data.model);
        console.log('  - Duração total:', (data.total_duration / 1e9).toFixed(2), 'segundos');
        console.log('  - Tokens gerados:', data.eval_count || 'N/A');
        console.log(
            '  - Velocidade:',
            data.eval_count ? (data.eval_count / (data.eval_duration / 1e9)).toFixed(2) + ' tokens/s' : 'N/A'
        );
    }
    console.log();
} catch (error) {
    console.error('❌ Erro no fetch:', error.message);
    console.log();
}

// Teste 2: qwen3-next:cloud para TEXTO/CHAT
console.log('💬 TESTE 2: GERAÇÃO DE TEXTO/CHAT (qwen3-next:cloud)');
console.log('-'.repeat(80));
console.log('Modelo: qwen3-next:cloud (Hybrid attention, high-sparsity MoE)');
console.log('Prompt: Explain the difference between let, const and var in JavaScript');
console.log();

try {
    const response = await fetch('http://host.docker.internal:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'qwen3-next:cloud',
            prompt: 'Explain the difference between let, const and var in JavaScript in 3-4 sentences.',
            stream: false,
            options: {
                temperature: 0.7,
                num_predict: 200,
            },
        }),
        signal: AbortSignal.timeout(60000),
    });

    const data = await response.json();

    if (!response.ok) {
        console.error('❌ Erro:', response.status);
        console.error('Detalhes:', JSON.stringify(data, null, 2));
    } else {
        console.log('✅ RESPOSTA LITERAL (qwen3-next:cloud - TEXTO/CHAT):');
        console.log('='.repeat(80));
        console.log(data.response);
        console.log('='.repeat(80));
        console.log();
        console.log('📊 Métricas:');
        console.log('  - Modelo:', data.model);
        console.log('  - Duração total:', (data.total_duration / 1e9).toFixed(2), 'segundos');
        console.log('  - Tokens gerados:', data.eval_count || 'N/A');
        console.log(
            '  - Velocidade:',
            data.eval_count ? (data.eval_count / (data.eval_duration / 1e9)).toFixed(2) + ' tokens/s' : 'N/A'
        );
    }
    console.log();
} catch (error) {
    console.error('❌ Erro no fetch:', error.message);
    console.log();
}

console.log('='.repeat(80));
console.log('FONTE: https://ollama.com/library/qwen3-coder-next');
console.log('ARQUITETURA: 80B MoE (3B active), released Feb 2026');
console.log('='.repeat(80));
