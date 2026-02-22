#!/usr/bin/env node
/**
 * Teste DIRETO com modelos qwen3 cloud
 * Tenta usar qwen3-coder-next e qwen3-next via Ollama
 */

console.log('='.repeat(80));
console.log('TESTE: MODELOS QWEN3 NA NUVEM');
console.log('='.repeat(80));
console.log();

// Teste 1: qwen3-coder-next para CÓDIGO
console.log('📝 TESTE 1: GERAÇÃO DE CÓDIGO (qwen3-coder-next - cloud)');
console.log('-'.repeat(80));

try {
    const response = await fetch('http://host.docker.internal:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'qwen3-coder-next',
            prompt: 'Write a JavaScript function named fibonacci that calculates the nth Fibonacci number. Just the code, no explanation.',
            stream: false,
            options: {
                temperature: 0.3,
                num_predict: 150,
            },
        }),
        signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
        const error = await response.text();
        console.error('❌ Erro:', response.status, error);
    } else {
        const data = await response.json();
        console.log('✅ RESPOSTA LITERAL (qwen3-coder-next - CÓDIGO):');
        console.log('='.repeat(80));
        console.log(data.response);
        console.log('='.repeat(80));
        console.log('Model:', data.model);
        console.log('Total duration:', (data.total_duration / 1e9).toFixed(2), 'seconds');
    }
    console.log();
} catch (error) {
    console.error('❌ Erro:', error.message);
    console.log();
}

// Teste 2: qwen3-next para TEXTO/CHAT
console.log('💬 TESTE 2: GERAÇÃO DE TEXTO/CHAT (qwen3-next - cloud)');
console.log('-'.repeat(80));

try {
    const response = await fetch('http://host.docker.internal:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: 'qwen3-next',
            prompt: 'Explain the concept of promises in JavaScript in 2-3 sentences.',
            stream: false,
            options: {
                temperature: 0.7,
                num_predict: 150,
            },
        }),
        signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
        const error = await response.text();
        console.error('❌ Erro:', response.status, error);
    } else {
        const data = await response.json();
        console.log('✅ RESPOSTA LITERAL (qwen3-next - TEXTO/CHAT):');
        console.log('='.repeat(80));
        console.log(data.response);
        console.log('='.repeat(80));
        console.log('Model:', data.model);
        console.log('Total duration:', (data.total_duration / 1e9).toFixed(2), 'seconds');
    }
    console.log();
} catch (error) {
    console.error('❌ Erro:', error.message);
    console.log();
}

console.log('='.repeat(80));
console.log('TESTES CONCLUÍDOS');
console.log('Modelos testados: qwen3-coder-next (código), qwen3-next (texto/chat)');
console.log('='.repeat(80));
