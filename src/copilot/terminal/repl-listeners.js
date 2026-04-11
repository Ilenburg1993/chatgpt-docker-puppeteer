// @ts-check
/**
 * src/copilot/terminal/repl-listeners.js
 *
 * Listeners de eventos do AlwaysAliveAgent para exibição no terminal REPL. Extraído de repl.js (F103) para reduzir
 * complexidade.
 *
 * @module copilot/terminal/repl-listeners
 * @see EventBus
 */

import { alwaysAliveAgent } from '../agent/index.js';
import { broadcastSse, println } from './dialog.js';

/**
 * Registra listeners de eventos do AlwaysAliveAgent para exibição no terminal.
 *
 * @param {import('readline').Interface} rl - Interface readline ativa
 * @returns {() => void} Função de cleanup
 */
export function setupAgentListeners(rl) {
    const onQuestion = (/** @type {Record<string, unknown>} */ evt) => {
        const q = /** @type {string} */ (evt?.['question'] ?? '');
        const choices = /** @type {string[]} */ (evt?.['choices'] ?? []);

        if (/^(READY[:\s]|REPLY[:\s]|DONE[:\s]|STOPPED|STOP_DIALOG)/i.test(q.trim())) {
            return;
        }

        rl.pause();
        println(`\n⚡ LLM-B perguntou: "${q}"`);
        if (choices.length > 0) {
            println(`   Opções: ${choices.join(' | ')}`);
        }
        println('   → Responda digitando normalmente. Sua próxima mensagem será a resposta.');
        rl.resume();
        rl.prompt();
    };

    const onStopped = () => {
        println('[llm-b] ⚠️  Agente parado. Use /restart para reiniciar.');
    };

    /** @type {Map<string, { name: string; t0: number }>} */
    const _activeTools = new Map();

    const onToolStart = (/** @type {Record<string, unknown>} */ evt) => {
        const toolCallId = /** @type {string} */ (evt?.['toolCallId'] ?? '');
        const name = /** @type {string} */ (evt?.['toolName'] ?? evt?.['name'] ?? 'tool');
        _activeTools.set(toolCallId, { name, t0: Date.now() });
        println(`  \x1b[90m🔧 ${name}\x1b[0m \x1b[33m(executando…)\x1b[0m`);
        broadcastSse('tool.start', { toolCallId, toolName: name });
    };

    const onToolComplete = (/** @type {Record<string, unknown>} */ evt) => {
        const toolCallId = /** @type {string} */ (evt?.['toolCallId'] ?? '');
        const success = Boolean(evt?.['success']);
        const entry = _activeTools.get(toolCallId);
        _activeTools.delete(toolCallId);
        const name = entry?.name ?? 'tool';
        const dur = entry ? ((Date.now() - entry.t0) / 1000).toFixed(1) : '?';
        const icon = success ? '\x1b[32m✅\x1b[0m' : '\x1b[31m❌\x1b[0m';
        println(`  ${icon} \x1b[90m${name}\x1b[0m \x1b[90m(${dur}s)\x1b[0m`);
        broadcastSse('tool.complete', {
            toolCallId,
            toolName: name,
            success,
            durationMs: entry ? Date.now() - entry.t0 : 0,
        });
    };

    const onSessionError = (/** @type {Record<string, unknown>} */ evt) => {
        const msg = /** @type {string} */ (evt?.['message'] ?? 'unknown error');
        const errorType = /** @type {string} */ (evt?.['errorType'] ?? 'error');
        println(`\n  \x1b[31m⚠️  Erro de sessão [${errorType}]: ${msg}\x1b[0m`);
        broadcastSse('session.error', { errorType, message: msg });
    };

    const onCompactionStart = () => {
        println(`  \x1b[33m🗜️  Compactando context window…\x1b[0m`);
        broadcastSse('compaction.start', {});
    };

    const onCompactionComplete = (/** @type {Record<string, unknown>} */ evt) => {
        const pre = /** @type {number | undefined} */ (evt?.['preCompactionTokens']);
        const post = /** @type {number | undefined} */ (evt?.['postCompactionTokens']);
        const success = Boolean(evt?.['success']);
        if (success && pre !== undefined && post !== undefined) {
            const pct = ((1 - post / pre) * 100).toFixed(0);
            println(
                `  \x1b[32m🗜️  Compactação concluída: ${pre.toLocaleString('pt-BR')} → ${post.toLocaleString('pt-BR')} tokens (-${pct}%)\x1b[0m`,
            );
        } else if (!success) {
            println(`  \x1b[31m🗜️  Compactação falhou\x1b[0m`);
        }
        broadcastSse('compaction.complete', { success, pre, post });
    };

    const onIntent = (/** @type {Record<string, unknown>} */ evt) => {
        const intent = /** @type {string} */ (evt?.['intent'] ?? '');
        if (intent) {
            process.stdout.write(`\r  \x1b[90m⏳ ${intent}\x1b[0m\x1b[K`);
        }
    };

    const onSubagentStarted = (/** @type {Record<string, unknown>} */ evt) => {
        const name = /** @type {string} */ (evt?.['agentName'] ?? 'sub-agent');
        println(`  \x1b[36m🤖 Sub-agente iniciado: ${name}\x1b[0m`);
    };

    const onSubagentCompleted = (/** @type {Record<string, unknown>} */ evt) => {
        const name = /** @type {string} */ (evt?.['agentName'] ?? 'sub-agent');
        println(`  \x1b[32m🤖 Sub-agente concluído: ${name}\x1b[0m`);
    };

    const onSubagentFailed = (/** @type {Record<string, unknown>} */ evt) => {
        const name = /** @type {string} */ (evt?.['agentName'] ?? 'sub-agent');
        const error = /** @type {string} */ (evt?.['error'] ?? 'unknown');
        println(`  \x1b[31m🤖 Sub-agente falhou: ${name} — ${error}\x1b[0m`);
    };

    alwaysAliveAgent.on('question.pending', onQuestion);
    alwaysAliveAgent.once('stopped', onStopped);
    alwaysAliveAgent.on('tool.execution_start', onToolStart);
    alwaysAliveAgent.on('tool.execution_complete', onToolComplete);
    alwaysAliveAgent.on('session.error', onSessionError);
    alwaysAliveAgent.on('session.compaction_start', onCompactionStart);
    alwaysAliveAgent.on('session.compaction_complete', onCompactionComplete);
    alwaysAliveAgent.on('assistant.intent', onIntent);
    alwaysAliveAgent.on('subagent.started', onSubagentStarted);
    alwaysAliveAgent.on('subagent.completed', onSubagentCompleted);
    alwaysAliveAgent.on('subagent.failed', onSubagentFailed);

    return () => {
        alwaysAliveAgent.off('question.pending', onQuestion);
        alwaysAliveAgent.off('stopped', onStopped);
        alwaysAliveAgent.off('tool.execution_start', onToolStart);
        alwaysAliveAgent.off('tool.execution_complete', onToolComplete);
        alwaysAliveAgent.off('session.error', onSessionError);
        alwaysAliveAgent.off('session.compaction_start', onCompactionStart);
        alwaysAliveAgent.off('session.compaction_complete', onCompactionComplete);
        alwaysAliveAgent.off('assistant.intent', onIntent);
        alwaysAliveAgent.off('subagent.started', onSubagentStarted);
        alwaysAliveAgent.off('subagent.completed', onSubagentCompleted);
        alwaysAliveAgent.off('subagent.failed', onSubagentFailed);
    };
}
