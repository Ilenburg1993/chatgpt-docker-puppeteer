#!/usr/bin/env node
/**
 * src/copilot/llm-a-conversation.mjs
 *
 * Script de conversa estruturada LLM-A (GitHub Copilot) → LLM-B (Copilot SDK gpt-4.1).
 *
 * Objetivo:
 *
 * 1. Verificar que todos os sprints implementados funcionam (diagnóstico)
 * 2. Planejar como melhorar a comunicação LLM-A ↔ LLM-B
 * 3. Definir os próximos sprints colaborativamente
 *
 * Uso: node --strip-types src/copilot/llm-a-conversation.mjs
 *
 * @module copilot/llm-a-conversation
 */

import { alwaysAliveAgent } from './agent/always-alive.js';
import { LlmBridgeClient } from './bridges/llm-bridge-client.js';

// ─── Helpers de display ────────────────────────────────────────────────────

const HR = '─'.repeat(80);

function section(/** @type {string} */ title) {
    console.log(`\n${'═'.repeat(80)}`);
    console.log(`  ${title}`);
    console.log('═'.repeat(80));
}

function turn(/** @type {string} */ role, /** @type {string} */ content) {
    const label = role === 'A' ? '🤖 LLM-A' : '🔵 LLM-B';
    console.log(`\n${HR}`);
    console.log(`${label}:`);
    console.log(HR);
    console.log(content);
}

// ─── Mensagens LLM-A ──────────────────────────────────────────────────────

const MESSAGES = [
    // ── Turno 1: Apresentação e verificação ──
    `Olá LLM-B! Sou LLM-A — um agente GitHub Copilot que atua como orquestrador \
neste repositório. Esta é uma conversa programática entre nós para:

1. Confirmar que tudo implementado até agora está funcionando
2. Planejar como melhorar nossa comunicação
3. Definir os próximos sprints juntos

Primeiro, me confirma: você está online, qual é seu model ID, e quantas ferramentas \
você tem disponíveis neste momento?`,

    // ── Turno 2: Verificação de ferramentas ──
    `Obrigado! Agora preciso verificar os sprints implementados:

- Sprint 17: File Tools (8 ferramentas de arquivo)
- Sprint 19: Session API Extensions (6 endpoints REST)
- Sprint 20: Agent Lifecycle Stream
- Sprint 21: Shell Tools (exec_command, run_npm_script, run_node_file)
- Sprint 22: System Message Upgrade (4 builders tipados, bug fixes)

Você consegue usar a ferramenta \`exec_command\` para rodar \`npm run test:unit -- \
--test-reporter=tap 2>&1 | tail -5\` e confirmar quantos testes passam?`,

    // ── Turno 3: Análise de comunicação ──
    `Perfeito. Agora quero explorar melhorias na nossa comunicação LLM-A ↔ LLM-B.

Problema atual: LLM-A precisa passar contexto estruturado para LLM-B a cada turno \
(estado de hooks, briefing, sessão, pendências). Estamos usando systemMessage com \
mode: 'append' para isso, mas é estático — enviado apenas na criação da sessão.

Proposta para discussão:
1. **Protocolo JSON estruturado**: LLM-A monta um payload JSON a cada mensagem com \
campos: { context, intent, priority, expectedOutput }
2. **Session memory file**: LLM-B lê um arquivo de estado compartilhado antes de \
cada resposta
3. **Tool callback channel**: LLM-B usa uma ferramenta \`report_to_llm_a\` para \
enviar resultados estruturados de volta

Qual dessas abordagens você considera mais eficaz? Por que? Tem sugestões alternativas?`,

    // ── Turno 4: Planejamento de sprints ──
    `Excelente análise! Agora vamos planejar juntos os próximos sprints.

**Contexto do backlog atual:**
- Sprint 18: Bloqueado (SDK v0.2.0 não publicado ainda)
- Sprint 23: OpenTelemetry (baixa prioridade)
- Sprint 24: Integration Tests (alta prioridade)

**Sprints candidatos que quero sua opinião:**

Sprint A — **Structured Dialog Protocol**
  - Implementar o protocolo JSON que discutimos
  - Criar \`StructuredMessage\` type com campos: context/intent/priority/output
  - Adapter em \`LlmBridgeClient.chat()\` para serializar/deserializar

Sprint B — **Session Persistence v2**
  - Salvar histórico de conversa entre sessões (SQLite ou JSON)
  - LLM-B receber os últimos N turnos como contexto ao retomar

Sprint C — **Tool Call Auditing**
  - Registrar cada tool call com: timestamp, tool name, args, result, duration
  - Exportar para \`.github/hooks/state/tool-audit.jsonl\`

Sprint D — **Parallel Task Queue**
  - LLM-A enfileira múltiplas tasks simultaneamente
  - LLM-B responde em paralelo com consolidação de resultados

Ordene por prioridade técnica e justifique. Qual implementar primeiro?`,

    // ── Turno 5: Protocolo de comunicação ──
    `Para finalizar esta sessão de planejamento, preciso que você especifique o formato \
exato do protocolo de mensagem estruturada que usaremos a partir de agora.

Defina:
1. O schema TypeScript/JSDoc do tipo \`StructuredMessage\`
2. Como deve ser serializado na mensagem enviada (envelope de texto ou JSON puro?)
3. Como LLM-B deve formatar suas respostas para facilitar parsing por LLM-A
4. Qual campo de "tipo de resposta" usar para: diagnóstico / planejamento / código / pergunta

Isso vai ser implementado no Sprint A. Seja preciso.`,
];

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
    section('🚀 Iniciando Conversa LLM-A ↔ LLM-B');
    console.log('\nInicializando AlwaysAlive Agent...');

    await alwaysAliveAgent.start();
    const snap = /** @type {{ sessionId?: string; model?: string }} */ (alwaysAliveAgent.getStatusSnapshot());
    console.log(`✅ Agente ativo: sessionId=${snap.sessionId}, model=${snap.model}, tools=30`);

    const bridge = new LlmBridgeClient();

    for (let i = 0; i < MESSAGES.length; i++) {
        const msg = /** @type {string} */ (MESSAGES[i]);
        section(`Turno ${i + 1} de ${MESSAGES.length}`);

        turn('A', msg);
        console.log('\n[aguardando resposta LLM-B...]\n');

        try {
            const result = await bridge.chat(msg, {
                onDelta: (chunk) => process.stdout.write(chunk),
                timeoutMs: 120_000,
            });

            console.log('\n');
            turn('B', `[resposta completa — ${result.responseLen} chars, ${result.durationMs}ms]`);
        } catch (/** @type {any} */ e) {
            console.error(`\n❌ Erro no turno ${i + 1}: ${e.message}`);
        }

        // Pausa entre turnos para não sobrecarregar
        if (i < MESSAGES.length - 1) {
            await new Promise((r) => setTimeout(r, 2_000));
        }
    }

    section('📋 Histórico Completo da Conversa');
    bridge.history.forEach((turn_item, idx) => {
        const role = turn_item.role === 'user' ? '🤖 LLM-A' : '🔵 LLM-B';
        console.log(`\n[Turno ${idx + 1}] ${role} (${new Date(turn_item.timestamp).toISOString()}):`);
        console.log(turn_item.content.substring(0, 500) + (turn_item.content.length > 500 ? '...' : ''));
    });

    await alwaysAliveAgent.stop();
    console.log('\n✅ Conversa encerrada. Agente parado.');
}

main().catch((e) => {
    console.error('ERRO FATAL:', e.message);
    process.exit(1);
});
