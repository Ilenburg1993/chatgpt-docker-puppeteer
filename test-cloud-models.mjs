#!/usr/bin/env node
/**
 * Teste FOCUSED: Ollama Cloud Models Usando modelos cloud disponíveis via proxy local do Ollama
 */

import { ollama } from './tools/ollama/client.mjs';

console.log('='.repeat(80));
console.log('TESTE: OLLAMA CLOUD - GERAÇÃO DE CÓDIGO E TEXTO');
console.log('='.repeat(80));
console.log();

// Test 1: Code Generation with GPT-OSS (cloud model)
console.log('📝 TESTE 1: GERAÇÃO DE CÓDIGO (gpt-oss:20b-cloud)');
console.log('-'.repeat(80));
console.log();

try {
    const codePrompt =
        'Write a JavaScript function named greet that takes a name and returns "Hello, [name]!". Just the code.';
    console.log('Prompt:', codePrompt);
    console.log('Model: gpt-oss:20b-cloud (120B parameters, cloud)');
    console.log();
    console.log('Chamando Ollama Cloud...');

    const codeResult = await ollama.generate(codePrompt, 'gpt-oss:20b-cloud', { temperature: 0.3, num_predict: 150 });

    console.log();
    console.log('✅ RESPOSTA LITERAL (Code Generation):');
    console.log('='.repeat(80));
    console.log(codeResult);
    console.log('='.repeat(80));
    console.log();
} catch (error) {
    console.error('❌ Erro:', error instanceof Error ? error.message : String(error));
    console.log();
}

// Test 2: Text/Chat Generation with Gemini (cloud model)
console.log('💬 TESTE 2: GERAÇÃO DE TEXTO/CHAT (gemini-3-pro-preview)');
console.log('-'.repeat(80));
console.log();

try {
    const chatPrompt = 'Explain the concept of asynchronous programming in JavaScript in 2-3 sentences.';
    console.log('Prompt:', chatPrompt);
    console.log('Model: gemini-3-pro-preview:latest (cloud)');
    console.log();
    console.log('Chamando Ollama Cloud...');

    const chatResult = await ollama.generate(chatPrompt, 'gemini-3-pro-preview:latest', {
        temperature: 0.7,
        num_predict: 200,
    });

    console.log();
    console.log('✅ RESPOSTA LITERAL (Text/Chat Generation):');
    console.log('='.repeat(80));
    console.log(chatResult);
    console.log('='.repeat(80));
    console.log();
} catch (error) {
    console.error('❌ Erro:', error instanceof Error ? error.message : String(error));
    console.log();
}

// Test 3: Smaller local model for code (fallback)
console.log('🔧 TESTE 3: GERAÇÃO DE CÓDIGO (qwen2.5-coder:3b - local fallback)');
console.log('-'.repeat(80));
console.log();

try {
    const codePrompt2 = 'Write a Python function to calculate factorial. Just the code.';
    console.log('Prompt:', codePrompt2);
    console.log('Model: qwen2.5-coder:3b (local, 3.1B parameters)');
    console.log();
    console.log('Chamando Ollama Local...');

    const codeResult2 = await ollama.generate(codePrompt2, 'qwen2.5-coder:3b', { temperature: 0.3, num_predict: 150 });

    console.log();
    console.log('✅ RESPOSTA LITERAL (Code Generation - Local):');
    console.log('='.repeat(80));
    console.log(codeResult2);
    console.log('='.repeat(80));
    console.log();
} catch (error) {
    console.error('❌ Erro:', error instanceof Error ? error.message : String(error));
    console.log();
}

console.log('='.repeat(80));
console.log('RESUMO:');
console.log('- Modelos Cloud: Acessados via proxy local do Ollama');
console.log('- URL Cloud: https://ollama.com:443');
console.log('- URL Local: http://host.docker.internal:11434');
console.log('- Sistema funcionando em modo híbrido (cloud + local)');
console.log('='.repeat(80));
