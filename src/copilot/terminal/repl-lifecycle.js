// @ts-check
/**
 * @module copilot/terminal/repl-lifecycle
 * @file Lifecycle readline do REPL terminal LLM-B.
 *
 *   Gerencia a criação do readline, tab completion, eventos `line`/`close`/`SIGINT` e o loop de input principal. Extrai a
 *   responsabilidade de lifecycle do composition root (repl.js).
 *
 *   src/copilot/terminal/repl-lifecycle.js
 * @see module:copilot/terminal/repl
 * @see module:copilot/terminal/repl-command-router
 */

import { toError } from '#copilot/core';
import { log } from '#copilot/observability';
import readline from 'node:readline';
import { extractAtReferences } from '../presentation/runtime-file-context.js';
import { addAttachment, setRl } from '../presentation/runtime-ui-state-store.js';
import { buildTerminalOperationalGuidance } from './auto-briefing.js';
import { buildUserPrompt, println, sendTurn } from './dialog/index.js';
import { readTerminalStatusProjection } from './frontend/index.js';
import { tryAnswerTerminalPendingQuestionInput } from './pending-question-answer.js';
import { buildTerminalReplBanner } from './repl-banner.js';
import { parseTerminalReplCommand } from './repl-command-parser.js';
import { CMD_ROUTES, dispatchCmd, isReadlineOpen } from './repl-command-router.js';
import { setupAgentListeners } from './repl-listeners.js';
import { createTerminalMultilineInputState } from './repl-multiline.js';

import { resolve } from './alias-store.js';

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

    println(buildTerminalReplBanner(injectPort));
    println('\x1b[90m  Iniciando sessão com LLM-B…\x1b[0m');
    try {
        const projection = readTerminalStatusProjection({ injectPort });
        const guidance = buildTerminalOperationalGuidance({
            sdkFsRouting: projection.sdkFsRouting,
            toolLoad: projection.toolLoad,
            instructionLoad: projection.instructionLoad,
        });
        println(`\x1b[90m  [auto-brief] route=${guidance.mode} · ${guidance.summary}\x1b[0m`);
        println(`\x1b[90m  [auto-brief] ${guidance.domainHint}\x1b[0m`);
        println(`\x1b[90m  [auto-brief] ${guidance.contextHint}\x1b[0m`);
        if (guidance.warnings.length > 0) {
            println(`\x1b[33m  [auto-brief] atenção: ${guidance.warnings.join(' | ')}\x1b[0m`);
        }
    } catch (e) {
        log('WARN', `[TerminalServer] Auto-briefing indisponível no boot: ${toError(e).message}`);
    }

    if (onReady) void onReady();

    rl.setPrompt(buildUserPrompt());
    rl.prompt();

    const PROMPT_CONTINUATION = '\x1b[90m  ...\x1b[0m ';
    const multilineInput = createTerminalMultilineInputState();

    rl.on('line', async (line) => {
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
                rl.setPrompt(buildUserPrompt());
                rl.prompt();
            }
            return;
        }

        const command = parseTerminalReplCommand(trimmed, resolve);
        if (command) {
            await dispatchCmd(command.command, command.arg, command.rest, rl, injectServer, cleanup);
            if (isReadlineOpen(rl)) {
                rl.setPrompt(buildUserPrompt());
                rl.prompt();
            }
            return;
        }

        const pendingAnswer = tryAnswerTerminalPendingQuestionInput(trimmed);
        if (pendingAnswer.routed) {
            println(
                pendingAnswer.ok
                    ? `\x1b[90m  [answer] Resposta enviada para pergunta pendente (${pendingAnswer.runtimeId}).\x1b[0m`
                    : `\x1b[31m  [answer] Falha ao responder pergunta pendente (${pendingAnswer.runtimeId}).\x1b[0m`,
            );
            if (isReadlineOpen(rl)) {
                rl.setPrompt(buildUserPrompt());
                rl.prompt();
            }
            return;
        }

        // Detectar referências @path inline e adicioná-las à fila de attachment
        const { paths: atPaths, strippedMessage } = extractAtReferences(trimmed);
        for (const p of atPaths) {
            addAttachment(p);
            println(`\x1b[90m  📎 @${p} adicionado à fila de attachments\x1b[0m`);
        }
        const finalMessage = atPaths.length > 0 ? strippedMessage || trimmed : trimmed;

        await sendTurn(finalMessage, 'user');
    });

    rl.on('close', () => {
        cleanup();
        setRl(null);
        println('[terminal] readline fechado. Inject server continua ativo.');
        log('INFO', '[TerminalServer] readline encerrado.');
    });

    rl.on('SIGINT', () => {
        // T-27: Ctrl+C mantém dialog loop ativo. Cancelar turno in-flight exigiria
        // propagar AbortController de sendTurn → sendMessage (infra AbortSignal já existe
        // em message-queue.js). Candidato a upgrade P4 futuro.
        multilineInput.reset();
        println('\n[terminal] Ctrl+C detectado. Dialog loop mantido ativo. Use /quit para encerrar.');
        rl.setPrompt(buildUserPrompt());
        rl.prompt();
    });
}
