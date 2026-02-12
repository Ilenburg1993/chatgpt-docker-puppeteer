#!/usr/bin/env node
/**
 * Test Ollama Cloud Integration
 * Tests both code generation and text generation using cloud models
 */

import { ollama } from './tools/ollama/client.mjs';

console.log('='.repeat(80));
console.log('TESTE DE INTEGRAÇÃO OLLAMA CLOUD');
console.log('='.repeat(80));
console.log();

console.log('Configuração:');
console.log('  Cloud URL:', ollama.cloudBaseUrl);
console.log('  Local URL:', ollama.localBaseUrl);
console.log('  Cloud Enabled:', ollama.cloudEnabled);
console.log('  Has API Key:', ollama.cloudApiKey ? 'Sim' : 'Não');
console.log();

// Test 1: Code Generation (via local Ollama accessing cloud models)
console.log('='.repeat(80));
console.log('TESTE 1: GERAÇÃO DE CÓDIGO (qwen3:4b - disponível localmente)');
console.log('='.repeat(80));
console.log();

try {
    console.log('Prompt: "Write a hello world function in JavaScript"');
    console.log('Model: qwen3:4b');
    console.log('Chamando Ollama...');
    console.log();

    const codeResult = await ollama.generate(
        'Write a hello world function in JavaScript. Just the code, no explanation.',
        'qwen3:4b',
        { temperature: 0.7, num_predict: 100 }
    );

    console.log('RESPOSTA LITERAL (Code Generation):');
    console.log('-'.repeat(80));
    console.log(codeResult);
    console.log('-'.repeat(80));
    console.log();
} catch (error) {
    console.error('❌ Erro na geração de código:', error.message);
    console.log();
}

// Test 2: Text Generation - Chat (via local Ollama)
console.log('='.repeat(80));
console.log('TESTE 2: GERAÇÃO DE TEXTO/CHAT (qwen2.5:3b-instruct - local)');
console.log('='.repeat(80));
console.log();

try {
    console.log('Prompt: "Explain what is a closure in JavaScript in one sentence"');
    console.log('Model: qwen2.5:3b-instruct');
    console.log('Chamando Ollama...');
    console.log();

    const textResult = await ollama.generate(
        'Explain what is a closure in JavaScript in one sentence.',
        'qwen2.5:3b-instruct',
        { temperature: 0.7, num_predict: 50 }
    );

    console.log('RESPOSTA LITERAL (Text Generation):');
    console.log('-'.repeat(80));
    console.log(textResult);
    console.log('-'.repeat(80));
    console.log();
} catch (error) {
    console.error('❌ Erro na geração de texto:', error.message);
    console.log();
}

// Test 3: Test with Gemini Cloud Model (if available via cloud proxy)
console.log('='.repeat(80));
console.log('TESTE 3: MODELO CLOUD VIA PROXY (gemini-3-flash-preview - cloud)');
console.log('='.repeat(80));
console.log();

try {
    console.log('Prompt: "What is 2+2?"');
    console.log('Model: gemini-3-flash-preview:cloud');
    console.log('Chamando Ollama Cloud via proxy local...');
    console.log();

    const cloudResult = await ollama.generate(
        'What is 2+2? Answer in one sentence.',
        'gemini-3-flash-preview:cloud',
        { temperature: 0.7, num_predict: 30 }
    );

    console.log('RESPOSTA LITERAL (Cloud Model via Proxy):');
    console.log('-'.repeat(80));
    console.log(cloudResult);
    console.log('-'.repeat(80));
    console.log();
} catch (error) {
    console.error('❌ Erro com modelo cloud:', error.message);
    console.log();
}

console.log('='.repeat(80));
console.log('TESTES CONCLUÍDOS');
console.log('='.repeat(80));
