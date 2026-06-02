// @ts-check
/**
 * @module copilot/terminal/repl-lifecycle
 * @file Lifecycle readline do REPL terminal LLM-B.
 *
 *   Gerencia a criação do readline, tab completion, eventos `line`/`close`/`SIGINT` e o loop de input principal. Extrai a
 *   responsabilidade de lifecycle do composition root (repl.js).
 *
 *   src/copilot/terminal/repl/repl-lifecycle.js
 * @see module:copilot/terminal/repl
 * @see module:copilot/terminal/repl-command-router
 */

import { getTerminalInterventionPolicy } from '#copilot/config';
import { toError } from '#copilot/core';
import { log } from '#copilot/observability';
import readline from 'node:readline';
import { extractAtReferences } from '../../presentation/files/index.js';
import {
    addAttachment,
    enqueueRuntimeInterventionMailbox,
    getBusy,
    readRuntimeInterventionMailboxSummary,
    setRl,
} from '../../presentation/state/index.js';
import {
    beginTerminalRenderLock,
    buildUserPrompt,
    buildWaitingPrompt,
    endTerminalRenderLock,
    getTurnQueueDepth,
    println,
    resetStatusRowState,
    scheduleTerminalPromptRedraw,
    sendTurn,
} from '../dialog/index.js';
import {
    shouldConsumeTerminalPendingAnswerInput,
    tryAnswerTerminalPendingQuestionInput,
} from '../state/repl-runtime/index.js';
import { terminalThemeRow, terminalThemeText } from '../state/repl/index.js';
import { resolve } from '../stores/index.js';
import { renderTerminalAutoBrief } from './auto-brief.js';
import { resolveFreeTextDelivery } from './free-text-delivery.js';
import { setupTerminalLiveStatusLine } from './live-status-line.js';
import { buildTerminalReplBanner } from './repl-banner.js';
import { parseTerminalReplCommand } from './repl-command-parser.js';
import {
    CMD_ROUTES,
    dispatchCmd,
    isReadlineOpen,
    setTerminalCommandRouterInjectPort,
} from './repl-command-router.js';
import {
    formatTerminalQueuedTurnNotice,
    isTerminalEscapeCommand,
    isTerminalImmediateCommand,
} from './repl-input-routing.js';
import { setupAgentListeners } from './repl-listeners.js';
import { createTerminalMultilineInputState } from './repl-multiline.js';

/**
 * Executa o lifecycle completo do REPL readline para o terminal permanente.
 *
 * Cria o readline, registra tab completion e listeners de eventos, exibe o banner e aguarda input interativo do
 * operador. Retorna quando o readline é fechado.
 *
 * @param {import('node:http').Server} injectServer - Servidor HTTP de injeção (para fechar no /quit)
 * @param {{ injectPort: number; onReady?: () => void }} opts - Opções do lifecycle
 * @returns {Promise<void>}
 */
export async function runReplLifecycle(injectServer, { injectPort, onReady }) {
    setTerminalCommandRouterInjectPort(injectPort);
    // F37: lista de comandos para tab completion
    const _cmdNames = CMD_ROUTES.flatMap(([names]) => names).map((n) => `/${n}`);

    /**
     * Readline completer para comandos REPL (F37.1).
     *
     * @param {string} line
     * @returns {[string[], string]}
     */
    function _completer(line) {
        if (!line.startsWith('/')) return [[], line];
        const hits = _cmdNames.filter((c) => c.startsWith(line));
        return [hits.length ? hits : _cmdNames, line];
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
        prompt: buildUserPrompt(),
        completer: _completer,
    });
    setRl(rl);

    const cleanup = setupAgentListeners(rl);
    const cleanupLiveStatusLine = setupTerminalLiveStatusLine();

    println(buildTerminalReplBanner(injectPort));
    println(terminalThemeText('muted', '  Iniciando sessão com LLM-B...'));
    renderTerminalAutoBrief({ injectPort, phase: 'boot', force: true });

    if (onReady) void onReady();

    // `println()` já redesenha o prompt ao final de cada linha do auto-brief. Reconfiguramos apenas o prompt efetivo
    // aqui; redesenhar de novo nesta fase duplica `você› você›` quando o cursor já está na linha interativa.
    rl.setPrompt(buildUserPrompt());

    const PROMPT_CONTINUATION = '\x1b[90m  ...\x1b[0m ';
    const multilineInput = createTerminalMultilineInputState();
    /** @type {Promise<void>} */
    let lineQueue = Promise.resolve();

    /**
     * @returns {void}
     */
    function refreshPrompt() {
        if (!isReadlineOpen(rl)) return;
        scheduleTerminalPromptRedraw(rl, () =>
            getBusy() || getTurnQueueDepth() > 0 ? buildWaitingPrompt() : buildUserPrompt(),
        );
    }

    /**
     * @param {ReturnType<typeof tryAnswerTerminalPendingQuestionInput>} pendingAnswer
     * @returns {void}
     */
    function printPendingAnswerResult(pendingAnswer) {
        if (pendingAnswer.reason === 'invalid_choice') {
            const choices =
                pendingAnswer.pendingQuestionChoices.length > 0
                    ? ` Opções: ${pendingAnswer.pendingQuestionChoices.join(' | ')}.`
                    : '';
            println(
                `\x1b[33m  [answer] Resposta não corresponde às opções da pergunta pendente.${choices}\x1b[0m`,
            );
            return;
        }
        const runtimeSuffix =
            pendingAnswer.runtimeId && pendingAnswer.runtimeId !== 'default'
                ? ` · runtime ${pendingAnswer.runtimeId}`
                : '';
        println(
            pendingAnswer.ok
                ? `\n\x1b[90m  Resposta enviada para pergunta pendente${runtimeSuffix}.\x1b[0m`
                : `\n\x1b[31m  Falha ao responder pergunta pendente${runtimeSuffix}.\x1b[0m`,
        );
    }

    /**
     * @param {ReturnType<typeof parseTerminalReplCommand>} command
     * @returns {void}
     */
    function dispatchImmediateCommand(command) {
        if (!command) return;
        beginTerminalRenderLock();
        void dispatchCmd(command.command, command.arg, command.rest, rl, injectServer, cleanup)
            .catch((e) => {
                log('ERROR', `[TerminalServer] Comando imediato falhou: ${toError(e).message}`);
            })
            .finally(() => {
                endTerminalRenderLock();
                refreshPrompt();
            });
    }

    /**
     * @param {string} finalMessage
     * @returns {Promise<void>}
     */
    async function queueUserTurn(finalMessage) {
        const queuedBefore = getTurnQueueDepth();
        const wasBusy = getBusy();
        if (queuedBefore > 0 || getBusy()) {
            println(formatTerminalQueuedTurnNotice({ queueDepth: queuedBefore + 1 }));
        }
        try {
            const reply = await sendTurn(finalMessage, 'user');
            if (reply === null) {
                println('\x1b[33m  [fila] Mensagem não produziu resposta. Veja /errors ou /status.\x1b[0m');
            }
        } catch (e) {
            log('ERROR', `[TerminalServer] Turno foreground falhou: ${toError(e).message}`);
            throw e;
        } finally {
            if (queuedBefore > 0 || wasBusy) {
                refreshPrompt();
            }
        }
    }

    /**
     * @param {string} finalMessage
     * @returns {Promise<void>}
     */
    async function handleImmediateIntervention(finalMessage) {
        const pendingAnswer = tryAnswerTerminalPendingQuestionInput(finalMessage);
        if (shouldConsumeTerminalPendingAnswerInput(pendingAnswer)) {
            printPendingAnswerResult(pendingAnswer);
            refreshPrompt();
            return;
        }

        // Se o modelo está ocioso (sem turno ativo ou na fila), o mailbox nunca será consumido:
        // ask_user só dispara durante processamento ativo. Fallback para turno garante entrega.
        const interventionPolicy = getTerminalInterventionPolicy();
        const isModelIdle = !getBusy() && getTurnQueueDepth() === 0;
        if (isModelIdle && interventionPolicy.allowQueueFallback) {
            println(
                terminalThemeText('muted', '  [intervene->turn] Modelo ocioso; mailbox não seria consumido. Encaminhando como turno.'),
            );
            await queueUserTurn(finalMessage);
            return;
        }

        const queued = enqueueRuntimeInterventionMailbox({
            runtimeId: null,
            source: 'terminal',
            modeHint: 'interrupt',
            message: finalMessage,
        });
        const summary = readRuntimeInterventionMailboxSummary(null);
        log(
            'INFO',
            `[TerminalServer] immediate intervention mailbox enqueue runtime=${queued.runtimeId} merged=${queued.merged} queue=${queued.queueSize} dropped=${queued.dropped}`,
        );
        println(
            terminalThemeRow(
                'Intervenção',
                `registrada para aplicação prioritária na próxima pergunta humana (${summary.queueSize} na fila${summary.dropped > 0 ? ` · ${summary.dropped} descartada(s)` : ''})`,
                { role: 'info' },
            ),
        );
        println(
            terminalThemeText('muted', '  Este caminho preserva zero-PR. Use /steer apenas quando quiser intervenção SDK immediate explícita.'),
        );
        if (isModelIdle) {
            println(
                terminalThemeText(
                    'warn',
                    '  Modelo ocioso e allowQueueFallback=false; entrada no mailbox pode não ser consumida até próximo turno ativo.',
                ),
            );
        }
        refreshPrompt();
    }

    /**
     * @param {string} finalMessage
     * @returns {Promise<void>}
     */
    async function routeFreeTextMessage(finalMessage) {
        const resolved = resolveFreeTextDelivery(finalMessage);
        if (!resolved.message) {
            println(terminalThemeText('warn', '  Mensagem vazia após diretiva; nada foi enviado.'));
            refreshPrompt();
            return;
        }
        if (resolved.mode === 'turn') {
            await queueUserTurn(resolved.message);
            return;
        }
        if (resolved.mode === 'steer') {
            const commandLine = `/steer ${resolved.message}`;
            const command = parseTerminalReplCommand(commandLine, resolve);
            if (command) {
                beginTerminalRenderLock();
                try {
                    await dispatchCmd(command.command, command.arg, command.rest, rl, injectServer, cleanup);
                } finally {
                    endTerminalRenderLock();
                    refreshPrompt();
                }
                return;
            }
        }
        await handleImmediateIntervention(resolved.message);
    }

    /**
     * @param {string} line
     * @returns {Promise<void>}
     */
    async function handleLine(line) {
        const multiline = multilineInput.acceptLine(line);
        if (!multiline.complete) {
            rl.setPrompt(PROMPT_CONTINUATION);
            rl.prompt();
            return;
        }
        line = multiline.line ?? '';
        if (multiline.wasBuffered) {
            rl.setPrompt(buildUserPrompt());
        }

        const trimmed = line.trim();
        if (!trimmed) {
            if (isReadlineOpen(rl)) {
                scheduleTerminalPromptRedraw(rl, buildUserPrompt());
            }
            return;
        }

        const command = parseTerminalReplCommand(trimmed, resolve);
        if (command) {
            beginTerminalRenderLock();
            try {
                await dispatchCmd(command.command, command.arg, command.rest, rl, injectServer, cleanup);
            } finally {
                endTerminalRenderLock();
                if (isReadlineOpen(rl)) {
                    scheduleTerminalPromptRedraw(rl, buildUserPrompt());
                }
            }
            return;
        }

        const pendingAnswer = tryAnswerTerminalPendingQuestionInput(trimmed);
        if (shouldConsumeTerminalPendingAnswerInput(pendingAnswer)) {
            printPendingAnswerResult(pendingAnswer);
            refreshPrompt();
            return;
        }

        // Detectar referências @path inline e adicioná-las à fila de attachment
        const { paths: atPaths, strippedMessage } = extractAtReferences(trimmed);
        for (const p of atPaths) {
            addAttachment(p);
            println(terminalThemeRow('Anexo', `@${p} adicionado à fila`, { role: 'muted' }));
        }
        const finalMessage = atPaths.length > 0 ? strippedMessage : trimmed;
        if (!finalMessage.trim()) {
            println(terminalThemeRow('Anexos', 'arquivo(s) anexados. Escreva uma mensagem para enviar o turno', { role: 'warn' }));
            if (isReadlineOpen(rl)) {
                scheduleTerminalPromptRedraw(rl, buildUserPrompt());
            }
            return;
        }

        await routeFreeTextMessage(finalMessage);
    }

    rl.on('line', (line) => {
        // ESCAPE-BYPASS: comandos críticos de saída/restart executam IMEDIATAMENTE, sem entrar na fila serializada.
        // Isso garante que /quit e /restart funcionem mesmo se um sendTurn anterior estiver travado na fila.
        const trimmedForEscape = line.trim();
        if (trimmedForEscape.startsWith('/')) {
            const escapeCmd = parseTerminalReplCommand(trimmedForEscape, resolve);
            if (escapeCmd && isTerminalEscapeCommand(escapeCmd.command)) {
                dispatchImmediateCommand(escapeCmd);
                return;
            }
            if (escapeCmd && isTerminalImmediateCommand(escapeCmd.command)) {
                dispatchImmediateCommand(escapeCmd);
                return;
            }
        }
        const immediatePendingAnswer = trimmedForEscape.startsWith('/')
            ? null
            : tryAnswerTerminalPendingQuestionInput(trimmedForEscape);
        if (immediatePendingAnswer && shouldConsumeTerminalPendingAnswerInput(immediatePendingAnswer)) {
            beginTerminalRenderLock();
            try {
                printPendingAnswerResult(immediatePendingAnswer);
            } finally {
                endTerminalRenderLock();
            }
            refreshPrompt();
            return;
        }
        lineQueue = lineQueue
            .then(() => handleLine(line))
            .catch((e) => {
                log('ERROR', `[TerminalServer] Falha ao processar linha do REPL: ${toError(e).message}`);
                if (isReadlineOpen(rl)) {
                    scheduleTerminalPromptRedraw(rl, buildUserPrompt());
                }
            });
    });

    rl.on('close', () => {
        // Resetar estado da linha de status para evitar layout corrupido na próxima sessão readline
        resetStatusRowState();
        try {
            cleanupLiveStatusLine();
        } catch (e) {
            log('WARN', `[TerminalServer] cleanup da linha viva falhou: ${toError(e).message}`);
        }
        try {
            cleanup();
        } catch (e) {
            log('WARN', `[TerminalServer] cleanup de listeners falhou: ${toError(e).message}`);
        } finally {
            setRl(null);
            println('[terminal] readline fechado. Inject server continua ativo.');
            log('INFO', '[TerminalServer] readline encerrado.');
        }
    });

    rl.on('SIGINT', () => {
        // T-27: Ctrl+C mantém dialog loop ativo. Cancelar turno in-flight exigiria
        // propagar AbortController de sendTurn → sendMessage (infra AbortSignal já existe
        // em message-queue.js). Candidato a upgrade P4 futuro.
        multilineInput.reset();
        println('\n[terminal] Ctrl+C detectado. Conversa mantida ativa. Use /quit para encerrar.');
        scheduleTerminalPromptRedraw(rl, buildUserPrompt());
    });
}
