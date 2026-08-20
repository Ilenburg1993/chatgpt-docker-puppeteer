#!/usr/bin/env node
/**
 * Teste FINAL com modelos Qwen3 Cloud
 *
 * - qwen3-coder-next: Código (confirmado funcionando!)
 * - qwen3: Chat geral (alternativa ao qwen3-next)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local'), quiet: true });

import { OllamaClient } from './tools/ollama/client.mjs';

const cloudApiKey = process.env['OLLAMA_CLOUD_API_KEY'];
const ollama = new OllamaClient({
    cloudEnabled: true,
    cloudBaseUrl: 'https://ollama.com',
    ...(cloudApiKey ? { cloudApiKey } : {}),
});

console.log('='.repeat(80));
console.log('🚀 TESTE FINAL: OLLAMA CLOUD - QWEN3 MODELS');
console.log('='.repeat(80));
console.log();

// Teste 1: qwen3-coder-next (CONFIRMADO FUNCIONANDO)
console.log('📝 TESTE 1: CÓDIGO com qwen3-coder-next');
console.log('-'.repeat(80));

try {
    const start = Date.now();
    const result = await ollama.generate(
        'Write a Python function to calculate factorial recursively. Just the code.',
        'qwen3-coder-next',
        { temperature: 0.3, num_predict: 100 },
    );
    const duration = (Date.now() - start) / 1000;

    console.log('✅ RESPOSTA LITERAL:');
    console.log('═'.repeat(80));
    console.log(result);
    console.log('═'.repeat(80));
    console.log(`⏱️  Duração: ${duration.toFixed(2)}s | 📏 Tamanho: ${result.length} chars`);
    console.log();
} catch (error) {
    console.error('❌ Erro:', error instanceof Error ? error.message : String(error));
    console.log();
}

// Teste 2: qwen3 (modelo geral para chat)
console.log('💬 TESTE 2: CHAT com qwen3 (modelo geral)');
console.log('-'.repeat(80));

try {
    const start = Date.now();
    const result = await ollama.generate(
        'What are the main benefits of using TypeScript over JavaScript? Answer in 2-3 sentences.',
        'qwen3',
        { temperature: 0.7, num_predict: 150 },
    );
    const duration = (Date.now() - start) / 1000;

    console.log('✅ RESPOSTA LITERAL:');
    console.log('═'.repeat(80));
    console.log(result);
    console.log('═'.repeat(80));
    console.log(`⏱️  Duração: ${duration.toFixed(2)}s | 📏 Tamanho: ${result.length} chars`);
    console.log();
} catch (error) {
    console.error('❌ Erro:', error instanceof Error ? error.message : String(error));
    console.log();
}

// Teste 3: qwen3-coder-next com CÓDIGO MAIS COMPLEXO
console.log('🔧 TESTE 3: CÓDIGO COMPLEXO com qwen3-coder-next');
console.log('-'.repeat(80));

try {
    const start = Date.now();
    const result = await ollama.generate(
        'Write a JavaScript class called ApiClient with async methods get(), post(), put(), delete() that use fetch. Include error handling. Just the code.',
        'qwen3-coder-next',
        { temperature: 0.3, num_predict: 300 },
    );
    const duration = (Date.now() - start) / 1000;

    console.log('✅ RESPOSTA LITERAL:');
    console.log('═'.repeat(80));
    console.log(result);
    console.log('═'.repeat(80));
    console.log(`⏱️  Duração: ${duration.toFixed(2)}s | 📏 Tamanho: ${result.length} chars`);
    console.log();
} catch (error) {
    console.error('❌ Erro:', error instanceof Error ? error.message : String(error));
    console.log();
}

console.log('='.repeat(80));
console.log('📊 RESUMO DOS TESTES');
console.log('='.repeat(80));
console.log('✅ qwen3-coder-next: Modelo especializado em CÓDIGO (80B MoE, 3B active)');
console.log('✅ qwen3: Modelo geral para CHAT e texto');
console.log('🌐 Endpoint: https://ollama.com (Ollama Cloud)');
console.log('🔑 Autenticação: API Key');
console.log('='.repeat(80));
