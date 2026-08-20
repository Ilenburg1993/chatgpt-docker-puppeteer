#!/usr/bin/env node
/**
 * Teste REAL com Ollama Cloud usando API Key Testa qwen3-coder-next e qwen3-next via https://ollama.com
 */

// Carregar .env.local para pegar API key
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { OllamaClient } from './tools/ollama/client.mjs';

// Criar cliente com cloud habilitado
const cloudApiKey = process.env['OLLAMA_CLOUD_API_KEY'];
const ollama = new OllamaClient({
    cloudEnabled: true,
    cloudBaseUrl: process.env['OLLAMA_CLOUD_BASE_URL'] || 'https://ollama.com',
    ...(cloudApiKey ? { cloudApiKey } : {}),
    localBaseUrl: process.env['OLLAMA_LOCAL_BASE_URL'] || 'http://host.docker.internal:11434',
});

console.log('='.repeat(80));
console.log('TESTE: OLLAMA CLOUD COM API KEY (qwen3-coder-next & qwen3-next)');
console.log('='.repeat(80));
console.log();
console.log('📋 Configuração:');
console.log('  - Cloud URL:', ollama.cloudBaseUrl);
console.log('  - Cloud Enabled:', ollama.cloudEnabled);
console.log('  - Has API Key:', ollama.cloudApiKey ? '✅ Sim' : '❌ Não');
console.log(
    '  - API Key (primeiros 20 chars):',
    ollama.cloudApiKey ? ollama.cloudApiKey.substring(0, 20) + '...' : 'N/A',
);
console.log();
console.log('='.repeat(80));
console.log();

// Teste 1: qwen3-coder-next para CÓDIGO
console.log('📝 TESTE 1: GERAÇÃO DE CÓDIGO (qwen3-coder-next)');
console.log('-'.repeat(80));
console.log('Modelo: qwen3-coder-next (80B MoE, 3B active, cloud)');
console.log('Prompt: Write a TypeScript interface for a User with id, name, and email');
console.log();

try {
    const startTime = Date.now();

    const codeResult = await ollama.generate(
        'Write a TypeScript interface for a User with id (number), name (string), and email (string). Just the code, no explanation.',
        'qwen3-coder-next',
        {
            temperature: 0.3,
            num_predict: 150,
        },
    );

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('✅ RESPOSTA LITERAL (qwen3-coder-next - CÓDIGO):');
    console.log('='.repeat(80));
    console.log(codeResult);
    console.log('='.repeat(80));
    console.log();
    console.log('📊 Métricas:');
    console.log('  - Duração:', duration, 'segundos');
    console.log('  - Caracteres:', codeResult.length);
    console.log();
} catch (error) {
    console.error('❌ ERRO (qwen3-coder-next):', error instanceof Error ? error.message : String(error));
    console.log();
}

// Teste 2: qwen3-next para TEXTO/CHAT
console.log('💬 TESTE 2: GERAÇÃO DE TEXTO/CHAT (qwen3-next)');
console.log('-'.repeat(80));
console.log('Modelo: qwen3-next (Hybrid attention, high-sparsity MoE, cloud)');
console.log('Prompt: Explain what is TypeScript in 2 sentences');
console.log();

try {
    const startTime = Date.now();

    const textResult = await ollama.generate('Explain what is TypeScript in 2 sentences.', 'qwen3-next', {
        temperature: 0.7,
        num_predict: 100,
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('✅ RESPOSTA LITERAL (qwen3-next - TEXTO/CHAT):');
    console.log('='.repeat(80));
    console.log(textResult);
    console.log('='.repeat(80));
    console.log();
    console.log('📊 Métricas:');
    console.log('  - Duração:', duration, 'segundos');
    console.log('  - Caracteres:', textResult.length);
    console.log();
} catch (error) {
    console.error('❌ ERRO (qwen3-next):', error instanceof Error ? error.message : String(error));
    console.log();
}

console.log('='.repeat(80));
console.log('RESUMO:');
console.log('  - Modelos testados: qwen3-coder-next (código), qwen3-next (texto/chat)');
console.log('  - Endpoint: Ollama Cloud (https://ollama.com)');
console.log('  - Autenticação: API Key configurada via .env.local');
console.log('='.repeat(80));
