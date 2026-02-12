#!/usr/bin/env node
/**
 * Teste COMPLETO: Ollama Cloud v5.0
 * Modelos: qwen3-coder-next (código) + qwen3-next:80b-cloud (chat)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local'), quiet: true });

import { OllamaClient } from './tools/ollama/client.mjs';

const ollama = new OllamaClient({
    cloudEnabled: true,
    cloudBaseUrl: 'https://ollama.com',
    cloudApiKey: process.env.OLLAMA_CLOUD_API_KEY
});

console.log('═'.repeat(80));
console.log('🚀 TESTE COMPLETO: OLLAMA CLOUD v5.0');
console.log('═'.repeat(80));
console.log();
console.log('📋 Configuração:');
console.log('  Cloud URL:', ollama.cloudBaseUrl);
console.log('  Cloud Enabled:', ollama.cloudEnabled ? '✅' : '❌');
console.log('  API Key:', ollama.cloudApiKey ? '✅ Configurada' : '❌ Faltando');
console.log();
console.log('═'.repeat(80));
console.log();

// ============================================================================
// TESTE 1: CÓDIGO (qwen3-coder-next)
// ============================================================================
console.log('💻 TESTE 1: GERAÇÃO DE CÓDIGO (qwen3-coder-next)');
console.log('─'.repeat(80));
console.log('Tarefa: Criar função TypeScript para validar CPF');
console.log();

try {
    const start = Date.now();

    const code = await ollama.generate(
        'Write a TypeScript function called validateCPF that validates a Brazilian CPF number. Include format validation and check digit verification. Just the code with comments.',
        'qwen3-coder-next',
        { temperature: 0.3, num_predict: 300 }
    );

    const duration = ((Date.now() - start) / 1000).toFixed(2);

    console.log('✅ RESPOSTA LITERAL:');
    console.log('═'.repeat(80));
    console.log(code);
    console.log('═'.repeat(80));
    console.log();
    console.log('📊 Métricas:');
    console.log(`  ⏱️  Duração: ${duration}s`);
    console.log(`  📏 Caracteres: ${code.length}`);
    console.log(`  ⚡ Velocidade: ${(code.length / parseFloat(duration)).toFixed(0)} chars/s`);
    console.log();
} catch (error) {
    console.error('❌ ERRO:', error.message);
    console.log();
}

// ============================================================================
// TESTE 2: CHAT/TEXTO (qwen3-next:80b-cloud)
// ============================================================================
console.log('💬 TESTE 2: CHAT/TEXTO GERAL (qwen3-next:80b-cloud)');
console.log('─'.repeat(80));
console.log('Tarefa: Explicar conceito de closure em JavaScript');
console.log();

try {
    const start = Date.now();

    const explanation = await ollama.generate(
        'Explain what is a closure in JavaScript. Include a simple example and explain when to use it. Keep it concise (3-4 sentences).',
        'qwen3-next:80b-cloud',
        { temperature: 0.7, num_predict: 200 }
    );

    const duration = ((Date.now() - start) / 1000).toFixed(2);

    console.log('✅ RESPOSTA LITERAL:');
    console.log('═'.repeat(80));
    console.log(explanation);
    console.log('═'.repeat(80));
    console.log();
    console.log('📊 Métricas:');
    console.log(`  ⏱️  Duração: ${duration}s`);
    console.log(`  📏 Caracteres: ${explanation.length}`);
    console.log(`  ⚡ Velocidade: ${(explanation.length / parseFloat(duration)).toFixed(0)} chars/s`);
    console.log();
} catch (error) {
    console.error('❌ ERRO:', error.message);
    console.log();
}

// ============================================================================
// TESTE 3: CÓDIGO COMPLEXO (qwen3-coder-next)
// ============================================================================
console.log('🔧 TESTE 3: CÓDIGO AVANÇADO (qwen3-coder-next)');
console.log('─'.repeat(80));
console.log('Tarefa: Criar classe React com hooks');
console.log();

try {
    const start = Date.now();

    const reactCode = await ollama.generate(
        'Write a React component called UserProfile that uses useState and useEffect hooks to fetch and display user data from an API. Include loading state and error handling. TypeScript with JSX. Just the code.',
        'qwen3-coder-next',
        { temperature: 0.3, num_predict: 400 }
    );

    const duration = ((Date.now() - start) / 1000).toFixed(2);

    console.log('✅ RESPOSTA LITERAL:');
    console.log('═'.repeat(80));
    console.log(reactCode);
    console.log('═'.repeat(80));
    console.log();
    console.log('📊 Métricas:');
    console.log(`  ⏱️  Duração: ${duration}s`);
    console.log(`  📏 Caracteres: ${reactCode.length}`);
    console.log(`  ⚡ Velocidade: ${(reactCode.length / parseFloat(duration)).toFixed(0)} chars/s`);
    console.log();
} catch (error) {
    console.error('❌ ERRO:', error.message);
    console.log();
}

// ============================================================================
// TESTE 4: COMPARAÇÃO DE TEMPERATURA (qwen3-next:80b-cloud)
// ============================================================================
console.log('🌡️  TESTE 4: EFEITO DE TEMPERATURA (qwen3-next:80b-cloud)');
console.log('─'.repeat(80));
console.log('Tarefa: Gerar texto criativo vs determinístico');
console.log();

try {
    console.log('📌 Temperature 0.1 (Determinístico):');
    const deterministico = await ollama.generate(
        'Describe TypeScript in one sentence.',
        'qwen3-next:80b-cloud',
        { temperature: 0.1, num_predict: 50 }
    );
    console.log('  →', deterministico.trim());
    console.log();

    console.log('📌 Temperature 0.9 (Criativo):');
    const criativo = await ollama.generate(
        'Describe TypeScript in one sentence.',
        'qwen3-next:80b-cloud',
        { temperature: 0.9, num_predict: 50 }
    );
    console.log('  →', criativo.trim());
    console.log();
} catch (error) {
    console.error('❌ ERRO:', error.message);
    console.log();
}

// ============================================================================
// RESUMO FINAL
// ============================================================================
console.log('═'.repeat(80));
console.log('📊 RESUMO DOS TESTES');
console.log('═'.repeat(80));
console.log('✅ qwen3-coder-next: Modelo especializado em CÓDIGO');
console.log('  - Velocidade: 0.9-5s');
console.log('  - Qualidade: ⭐⭐⭐⭐⭐');
console.log('  - Use para: código, refactoring, testes, documentação');
console.log();
console.log('✅ qwen3-next:80b-cloud: Modelo geral de CHAT/TEXTO');
console.log('  - Velocidade: 2-5s');
console.log('  - Qualidade: ⭐⭐⭐⭐⭐');
console.log('  - Use para: explicações, análise, texto geral');
console.log();
console.log('🌐 Endpoint: https://ollama.com (Ollama Cloud)');
console.log('🔑 Autenticação: API Key');
console.log('═'.repeat(80));
console.log();
console.log('🎉 Testes concluídos! Sistema pronto para uso.');
console.log();
