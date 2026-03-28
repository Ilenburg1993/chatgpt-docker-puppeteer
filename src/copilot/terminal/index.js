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
import { resolve } from 'node:path';
import { alwaysAliveAgent } from '../agent/always-alive.js';
import { loadAliases } from '../bridges/alias-store.js';
import { llmBridgeClient } from '../channel/client.js';
import { PinnedFilesLoader } from '../config/pinned-files-loader.js';
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

    // ARCH-05 (fix): instanciar PinnedFilesLoader com paths reais dos skills e instruções
    // Isso habilita o comando /skills reload e o sistema de pinned context files
    const _root = resolve(import.meta.dirname, '../../..');
    const pinnedLoader = new PinnedFilesLoader([
        resolve(_root, '.github', 'skills'),
        resolve(_root, '.github', 'instructions'),
    ]);
    await pinnedLoader.start().catch((/** @type {any} */ e) => {
        log('WARN', `[TerminalServer] PinnedFilesLoader não pôde iniciar: ${e.message}`);
    });
    pinnedLoader.on('changed', () => {
        log('INFO', '[TerminalServer] PinnedFilesLoader: arquivos de contexto atualizados.');
    });

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

    // Watchdog: dialog loop travado → reinicia via stopDialogMode (emite dialog.stopped com reason: watchdog_restart)
    // O handler de 'dialog.stopped' abaixo é responsável por chamar ensureDialogLoop() — evitando duplicação.
    alwaysAliveAgent.on('dialog.stalled', async (/** @type {{ stalledMs: number }} */ evt) => {
        const secs = Math.round(evt.stalledMs / 1000);
        println(`\n[watchdog] ⚠️  Dialog loop inativo há ${secs}s — reiniciando automaticamente…`);
        log('WARN', `[TerminalServer] Watchdog disparou (${secs}s inativo). Reiniciando dialog loop.`);
        const _hubSessionId = getHubSessionId();
        if (_hubSessionId) {
            try {
                await conversationHub.store.writeTurn(_hubSessionId, {
                    role: 'user',
                    content: `[SISTEMA] Watchdog: dialog loop inativo por ${secs}s — reinício automático.`,
                });
            } catch {
                /* best-effort */
            }
        }
        // DL-PERM-06: stopDialogMode() usará reason='watchdog_restart', que o handler de
        // 'dialog.stopped' capturará e chamará ensureDialogLoop(). Não chamar ensureDialogLoop()
        // aqui diretamente para evitar duplo restart.
        llmBridgeClient.stopDialogMode().catch((/** @type {any} */ e) => {
            log('ERROR', `[TerminalServer] Falha ao parar dialog loop no watchdog: ${e.message}`);
            // Fallback: se stopDialogMode() falhar, tentar reiniciar diretamente
            ensureDialogLoop().catch((/** @type {any} */ e2) =>
                log('ERROR', `[TerminalServer] Falha no fallback de restart após watchdog: ${e2.message}`),
            );
        });
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

    // DL-PERM: dialog loop permanente — reinicia automaticamente se o modelo encerrar o loop.
    // A LLM-B NUNCA deve encerrar o dialog loop sem autorização explícita do usuário.
    // Quando 'dialog.stopped' é emitido por iniciativa do modelo, reiniciamos automaticamente.
    alwaysAliveAgent.on('dialog.stopped', (/** @type {{ reason: string; authorized?: boolean }} */ evt) => {
        const reason = evt.reason ?? 'desconhecido';

        if (reason === 'authorized_stop') {
            // Encerramento permanente autorizado pelo usuário — não reiniciar
            println(`\n\x1b[33m  [dialog] Loop encerrado por autorização explícita do usuário.\x1b[0m`);
            log('INFO', '[TerminalServer] Dialog loop encerrado com autorização do usuário.');
            broadcastSse('stopped', { authorized: true, reason });
            return;
        }

        // Para todos os outros casos (watchdog_restart, model_stopped, falha de sendMessage, etc.)
        // — reiniciar automaticamente. Isso garante que o loop nunca morre de forma permanente.
        const isWatchdog = reason === 'watchdog_restart';
        const label = isWatchdog ? 'reinício por watchdog' : `reason: ${reason}`;
        println(`\n\x1b[33m  [dialog] Loop encerrado (${label}) — reiniciando automaticamente…\x1b[0m`);
        log('WARN', `[TerminalServer] Dialog loop encerrado (${label}). Reiniciando.`);
        broadcastSse('stopped', { reason, restarting: true });
        ensureDialogLoop().catch((/** @type {any} */ e) =>
            log('ERROR', `[TerminalServer] Falha ao reiniciar dialog loop após stop: ${e.message}`),
        );
    });

    // AA.4: SSE 'context' event — emitir dados reais de uso de contexto após cada turno
    alwaysAliveAgent.on('session.usage', (/** @type {{ currentTokens: number; tokenLimit: number }} */ data) => {
        const { currentTokens = 0, tokenLimit = 0 } = data;
        if (tokenLimit > 0) {
            broadcastSse('context', {
                tokens: currentTokens,
                tokenLimit,
                utilization: currentTokens / tokenLimit,
                timestamp: Date.now(),
            });
        }
    });

    // AB.4: SSE 'cache.hit' — emitir quando compactação usar tokens cached
    alwaysAliveAgent.on(
        'session.compaction_complete',
        (/** @type {{ compactionTokensUsed?: { cachedInput?: number }; success?: boolean }} */ evt) => {
            const cachedInput = evt?.compactionTokensUsed?.cachedInput ?? 0;
            if (cachedInput > 0) {
                broadcastSse('cache.hit', { cachedInput, timestamp: Date.now() });
            }
        },
    );

    // Persiste reconexões e sessões fatais no Hub
    alwaysAliveAgent.on(
        'ready',
        async (/** @type {{ sessionId: string; isResumed: boolean; reconected?: boolean }} */ evt) => {
            const _hubSessionId = getHubSessionId();
            if (!_hubSessionId || !evt.reconected) return;
            try {
                await conversationHub.store.writeTurn(_hubSessionId, {
                    role: 'user',
                    content: `[SISTEMA] Session reconectada: ${evt.sessionId} (retomada: ${evt.isResumed})`,
                });
            } catch {
                /* best-effort */
            }
        },
    );
    alwaysAliveAgent.on('session.fatal', async (/** @type {{ originalError: string; attempts: number }} */ evt) => {
        const _hubSessionId = getHubSessionId();
        if (!_hubSessionId) return;
        try {
            await conversationHub.store.writeTurn(_hubSessionId, {
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
