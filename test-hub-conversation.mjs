#!/usr/bin/env node
/**
 * test-hub-conversation.mjs
 *
 * Script de conversa real LLM-A ↔ LLM-B usando o ConversationHub.
 *
 * - Inicia o AlwaysAliveAgent
 * - Inicia ConversationStore + HubOrchestrator (in-memory DB)
 * - Usa startDialogLoop para conversa eficiente (1 PR, N turnos)
 * - Persiste cada turno via store
 * - Exibe conversa no terminal com formatação
 *
 * Uso: node --strip-types test-hub-conversation.mjs
 */

// @ts-check

import Database from 'better-sqlite3';
import { alwaysAliveAgent } from './src/copilot/agent/always-alive-singleton.js';
import { LlmBridgeClient } from './src/copilot/channel/client.js';
import { HubOrchestrator } from './src/copilot/conversation-hub/orchestrator.js';
import { ConversationStore } from './src/copilot/conversation-hub/store.js';

// ─── Display helpers ──────────────────────────────────────────────────────────

const HR = '─'.repeat(80);
const HR2 = '═'.repeat(80);

/**
 * @param {string} title
 */
function section(title) {
    console.log(`\n${HR2}`);
    console.log(`  🌐 ${title}`);
    console.log(HR2);
}

/**
 * @param {'A' | 'B' | 'HUB'} role
 * @param {string} content
 */
function turn(role, content) {
    const labels = { A: '🤖 LLM-A (eu)', B: '🔵 LLM-B (gpt-4.1)', HUB: '🏛️  HUB' };
    console.log(`\n${HR}`);
    console.log(`${labels[role]}:`);
    console.log(HR);
    console.log(content);
}

// ─── Setup mínimo do Hub (in-memory, sem servidor) ───────────────────────────

const testDb = new Database(':memory:');
const store = new ConversationStore();
store.init(testDb);

// ─── Conversa principal ───────────────────────────────────────────────────────

section('ConversationHub — Conversa Real LLM-A ↔ LLM-B');

console.log('\n⚡ Iniciando AlwaysAliveAgent...');
await alwaysAliveAgent.start();
console.log(`✅ Agente iniciado. SessionId: ${alwaysAliveAgent.sessionId}`);

// Hub orchestrator usa o agente real agora
const orchestrator = new HubOrchestrator(store, alwaysAliveAgent);

// Bridge real — usa o alwaysAliveAgent já iniciado
const bridge = new LlmBridgeClient();
orchestrator.init(bridge);

// Criar sessão no hub
const hubSessionId = orchestrator.createSession({ title: 'Conversa Livre Sprint Hub' });
console.log(`\n🏛️  Hub Session criada: ${hubSessionId}`);

// Listeners de eventos do orchestrator
orchestrator.on('turn:complete', (evt) => {
    console.log(`\n📌 [HUB] Turno #${evt.turnNumber} salvo (id=${evt.turnId}, role=${evt.role})`);
});

// ─── Dialog loop: usar boot prompt padrão (protocolo READY/REPLY) ──────────

section('Iniciando Dialog Loop com LLM-B');

// Boot prompt nulo = usa protocolo padrão (READY: / REPLY: / ask_user)
// Contexto real é injetado no primeiro sendDialogTurn após READY
const bootPrompt = undefined;

orchestrator.on('session:created', () => {});

alwaysAliveAgent.on('dialog.ready', () => {
    console.log('\n✅ Dialog loop pronto. Iniciando conversa...');
});

/**
 * @param {string} text
 * @returns {Promise<string>}
 */
async function chat(text) {
    // Salva turno LLM-A no store
    store.writeTurn(hubSessionId, {
        role: 'llm_a',
        content: text,
        model: 'copilot-claude-sonnet-4.6',
    });
    turn('A', text);

    // Envia via dialog loop
    const response = await alwaysAliveAgent.sendDialogTurn(text, { timeout: 90_000 });

    // Salva turno LLM-B no store
    store.writeTurn(hubSessionId, {
        role: 'llm_b',
        content: response,
        model: 'gpt-4.1',
    });
    turn('B', response);

    return response;
}

// Inicia o dialog loop (1 PR que sustenta N turnos)
console.log('\n🚀 Iniciando dialog loop...');
alwaysAliveAgent.startDialogLoop(bootPrompt).catch((e) => {
    console.error('\n❌ Dialog loop terminou:', e instanceof Error ? e.message : String(e));
});

// Aguarda o loop ficar pronto
await new Promise((resolve) => {
    alwaysAliveAgent.once('dialog.ready', resolve);
    setTimeout(resolve, 30_000); // fallback timeout
});

section('Conversa Livre — Sprint Hub Review');

// ─── Turno 0: Contexto + primeira pergunta (conciso) ─────────────────────────
await chat(
    'Olá! Sou LLM-A (Claude Sonnet). Implementei o Conversation Hub neste projeto: ' +
        'ConversationStore (SQLite DDL inline), HubOrchestrator (EventEmitter), Socket.io /copilot, REST /api/hub. ' +
        '1474 testes passando. Opinião sobre DDL inline vs migrations? Trade-offs em 3 frases.',
);

// ─── Turno 1: Turn counter persistence ───────────────────────────────────────
await chat(
    'HubOrchestrator mantém contadores de turno em Map (memória). Se reiniciar, turn_number dessincroniza. ' +
        'Solução em 2-3 linhas de código?',
);

// ─── Turno 2: CPU starvation ──────────────────────────────────────────────────
await chat(
    'Hub roda no mesmo processo do servidor Express. LLM calls longas podem bloquear event loop? ' +
        'Maior risco e mitigação em 2 frases.',
);

// ─── Turno 3: Pull vs Push ────────────────────────────────────────────────────
await chat(
    'Usuário injeta mensagem via hub_inject_user_message. LLM-A usa poll (pull). ' +
        'Prefere push? Como dado que LLM-A é stateless entre chamadas?',
);

// ─── Turno 4: Top 3 melhorias ────────────────────────────────────────────────
await chat(
    'Top 3 melhorias no hub (observabilidade, confiabilidade, UX). Numeradas, sem preâmbulo, máx 4 linhas cada.',
);

// ─── Encerramento ─────────────────────────────────────────────────────────────
await alwaysAliveAgent.stopDialogLoop();

section('Resumo da Sessão Hub');

const turns = store.readTurns(hubSessionId);
console.log(`\n📊 Sessão: ${hubSessionId}`);
console.log(`   Total de turnos salvos: ${turns.length}`);
console.log(`   Turnos LLM-A: ${turns.filter((t) => t.role === 'llm_a').length}`);
console.log(`   Turnos LLM-B: ${turns.filter((t) => t.role === 'llm_b').length}`);
console.log(`   Usuário: ${turns.filter((t) => t.role === 'user').length}`);

// Fechar sessão no store
store.closeHubSession(hubSessionId);
console.log('\n✅ Hub session fechada no store.');

// Parar o agente
await alwaysAliveAgent.stop();
console.log('✅ AlwaysAliveAgent parado.');

testDb.close();
console.log('\n🎯 Conversa concluída com sucesso.');
