// @ts-check
/**
 * src/copilot/terminal/index.js
 *
 * Ponto de entrada do Terminal Permanente LLM-B.
 *
 * Orquestra a inicialização sequencial de todos os subsistemas:
 *
 * 1. Carrega aliases customizados
 * 2. Cria o servidor HTTP de injeção (via `server.js`)
 * 3. Cria hub_session no ConversationStore (best-effort)
 * 4. Registra watchdogs e listeners de eventos do AlwaysAliveAgent
 * 5. Ativa o reflection loop periódico (se configurado)
 * 6. Inicia o REPL readline (via `repl.js`)
 *
 * @module copilot/terminal
 */

import { log } from '#core/logger';
import { alwaysAliveAgent } from '../agent/always-alive.js';
import { loadAliases } from '../bridges/alias-store.js';
import { llmBridgeClient } from '../bridges/llm-bridge-client.js';
import { conversationHub } from '../conversation-hub/hub.js';
import { broadcastSse, ensureDialogLoop, println, sendTurn } from './dialog.js';
import { startRepl } from './repl.js';
import { createInjectServer } from './server.js';
import { getHubSessionId, setHubSessionId } from './state.js';

/**
 * Inicia o Terminal Permanente LLM-B.
 *
 * @returns {Promise<void>}
 */
export async function startTerminalServer() {
    log('INFO', '[TerminalServer] Iniciando terminal permanente LLM-B…');

    loadAliases();

    const injectServer = createInjectServer();

    // Criar hub_session permanente (best-effort)
    try {
        conversationHub.store.init();
        const hubSessionId = conversationHub.store.createHubSession({
            title: 'Terminal Permanente LLM-B',
            metadata: { source: 'terminal-server', startedAt: new Date().toISOString() },
        });
        setHubSessionId(hubSessionId);
        log('INFO', `[TerminalServer] Hub session criada: ${hubSessionId}`);
    } catch (/** @type {any} */ e) {
        log('WARN', `[TerminalServer] Hub storage indisponível, continua sem persistência: ${e.message}`);
    }

    // Watchdog: dialog loop travado → reinicia automaticamente
    alwaysAliveAgent.on('dialog.stalled', (/** @type {{ stalledMs: number }} */ evt) => {
        const secs = Math.round(evt.stalledMs / 1000);
        println(`\n[watchdog] ⚠️  Dialog loop inativo há ${secs}s — reiniciando automaticamente…`);
        log('WARN', `[TerminalServer] Watchdog disparou (${secs}s inativo). Reiniciando dialog loop.`);
        const _hubSessionId = getHubSessionId();
        if (_hubSessionId) {
            try {
                conversationHub.store.writeTurn(_hubSessionId, {
                    role: 'user',
                    content: `[SISTEMA] Watchdog: dialog loop inativo por ${secs}s — reinício automático.`,
                });
            } catch {
                /* best-effort */
            }
        }
        llmBridgeClient
            .stopDialogMode()
            .catch(() => {})
            .then(() => ensureDialogLoop())
            .catch((/** @type {any} */ e) =>
                log('ERROR', `[TerminalServer] Falha ao reiniciar dialog loop: ${e.message}`),
            );
        broadcastSse('stalled', { stalledMs: evt.stalledMs });
    });

    // SSE: transmite respostas da LLM-B para clientes subscritos
    alwaysAliveAgent.on('dialog.reply', (/** @type {{ reply: string }} */ evt) => {
        broadcastSse('reply', {
            content: evt.reply,
            timestamp: Date.now(),
            model: alwaysAliveAgent.model,
            reasoningEffort: alwaysAliveAgent.reasoningEffort ?? 'high',
        });
    });
    alwaysAliveAgent.on('dialog.ready', () => {
        broadcastSse('ready', {
            timestamp: Date.now(),
            model: alwaysAliveAgent.model,
            reasoningEffort: alwaysAliveAgent.reasoningEffort ?? 'high',
        });
    });

    // Persiste reconexões e sessões fatais no Hub
    alwaysAliveAgent.on(
        'ready',
        (/** @type {{ sessionId: string; isResumed: boolean; reconected?: boolean }} */ evt) => {
            const _hubSessionId = getHubSessionId();
            if (!_hubSessionId || !evt.reconected) return;
            try {
                conversationHub.store.writeTurn(_hubSessionId, {
                    role: 'user',
                    content: `[SISTEMA] Session reconectada: ${evt.sessionId} (retomada: ${evt.isResumed})`,
                });
            } catch {
                /* best-effort */
            }
        },
    );
    alwaysAliveAgent.on('session.fatal', (/** @type {{ originalError: string; attempts: number }} */ evt) => {
        const _hubSessionId = getHubSessionId();
        if (!_hubSessionId) return;
        try {
            conversationHub.store.writeTurn(_hubSessionId, {
                role: 'user',
                content: `[SISTEMA] session.fatal após ${evt.attempts} tentativas: ${evt.originalError}`,
            });
        } catch {
            /* best-effort */
        }
    });

    // P7: Reflection loop periódico
    const reflectionIntervalMin = Number(process.env.LLM_B_REFLECTION_INTERVAL_MIN ?? '0');
    if (reflectionIntervalMin > 0) {
        const reflectionIntervalMs = reflectionIntervalMin * 60 * 1000;
        log('INFO', `[TerminalServer] Reflection loop ativado: a cada ${reflectionIntervalMin}min.`);

        const runReflection = () => {
            if (!alwaysAliveAgent.dialogLoopActive) return;
            log('INFO', '[TerminalServer] Executando reflection loop…');
            sendTurn(
                '[REFLEXÃO] Faça uma breve reflexão sobre as últimas mensagens desta conversa: o que foi discutido, o que está pendente, e se você tem alguma sugestão ou insight que ainda não mencionou. Seja conciso.',
                'llm-a',
            ).catch((/** @type {any} */ e) => log('WARN', `[TerminalServer] Reflection loop falhou: ${e.message}`));
        };

        const reflectionTimer = setInterval(runReflection, reflectionIntervalMs);
        if (typeof reflectionTimer.unref === 'function') reflectionTimer.unref();
    }

    await startRepl(injectServer);
}
