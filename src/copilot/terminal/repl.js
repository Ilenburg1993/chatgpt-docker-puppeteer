// @ts-check
/**
 * src/copilot/terminal/repl.js
 *
 * Interface REPL readline do Terminal Permanente LLM-B.
 *
 * Responsável por:
 *
 * - Criar/gerenciar readline interface (`startRepl`)
 * - Registrar listeners de eventos do AlwaysAliveAgent (`setupAgentListeners`)
 * - Fazer dispatch dos comandos `/xxx` para os módulos de commands/
 *
 * @module copilot/terminal/repl
 */

import { log } from '#core/logger';
import readline from 'node:readline';
import { alwaysAliveAgent } from '../agent/always-alive.js';
import { resolve } from '../bridges/alias-store.js';
import { llmBridgeClient } from '../bridges/llm-bridge-client.js';
import {
    cmdAlias as _cmdAlias,
    cmdAnswer as _cmdAnswer,
    cmdAttach as _cmdAttach,
    cmdClear as _cmdClear,
    cmdCompact as _cmdCompact,
    cmdContext as _cmdContext,
    cmdCount as _cmdCount,
    cmdDbHistory as _cmdDbHistory,
    cmdDbSessions as _cmdDbSessions,
    cmdForget as _cmdForget,
    cmdGh as _cmdGh,
    cmdGit as _cmdGit,
    cmdHelp as _cmdHelp,
    cmdHistory as _cmdHistory,
    cmdModel as _cmdModel,
    cmdPlan as _cmdPlan,
    cmdReasoning as _cmdReasoning,
    cmdRecall as _cmdRecall,
    cmdRemember as _cmdRemember,
    cmdResume as _cmdResume,
    cmdStatus as _cmdStatus,
    cmdWho as _cmdWho,
} from './commands/index.js';
import { ensureDialogLoop, println, sendTurn } from './dialog.js';
import { extractAtReferences } from './file-context.js';
import { addAttachment, getHubSessionId, setRl } from './state.js';

// ─── Configuração ─────────────────────────────────────────────────────────────

const INJECT_PORT = Number(process.env.LLM_B_TERMINAL_PORT ?? 3009);
const PROMPT_USER = '\x1b[32mvocê\x1b[0m\x1b[90m›\x1b[0m ';

const BANNER = `
\x1b[36m╔══════════════════════════════════════════════════════════════════════════╗\x1b[0m
\x1b[36m║\x1b[0m  💬  \x1b[1mTerminal LLM-B\x1b[0m  \x1b[90m—\x1b[0m  Sessão Permanente                            \x1b[36m║\x1b[0m
\x1b[36m╚══════════════════════════════════════════════════════════════════════════╝\x1b[0m
  \x1b[33m/status\x1b[0m · \x1b[33m/history [n]\x1b[0m · \x1b[33m/db-history [n]\x1b[0m · \x1b[33m/db-sessions [n]\x1b[0m · \x1b[33m/who\x1b[0m · \x1b[33m/clear\x1b[0m · \x1b[33m/restart\x1b[0m
  \x1b[33m/model [list|id]\x1b[0m · \x1b[33m/reasoning [low|medium|high|xhigh|off]\x1b[0m · \x1b[33m/count\x1b[0m
  \x1b[33m/attach [path|clear]\x1b[0m · \x1b[33m/context\x1b[0m · \x1b[33m/compact\x1b[0m · \x1b[33m/plan [on|off]\x1b[0m · \x1b[33m/resume [id]\x1b[0m
  \x1b[33m/remember [tag:] texto\x1b[0m · \x1b[33m/recall [tag]\x1b[0m · \x1b[33m/recall ?busca\x1b[0m · \x1b[33m/forget <id>\x1b[0m
  \x1b[36m/gh issue list\x1b[0m · \x1b[36m/gh pr list\x1b[0m · \x1b[36m/gh run list\x1b[0m · \x1b[36m/git status\x1b[0m · \x1b[36m/git log\x1b[0m · \x1b[36m/alias\x1b[0m · \x1b[36m/help\x1b[0m
  \x1b[90mPOST :${INJECT_PORT}/inject  ·  POST :${INJECT_PORT}/pipeline  ·  GET :${INJECT_PORT}/events  ·  GET :${INJECT_PORT}/sessions  ·  POST/GET/DELETE :${INJECT_PORT}/memory\x1b[0m
  \x1b[90mGET :${INJECT_PORT}/gh/issues  ·  GET :${INJECT_PORT}/gh/prs  ·  GET :${INJECT_PORT}/gh/ci  ·  GET :${INJECT_PORT}/git/status  ·  GET :${INJECT_PORT}/git/log\x1b[0m
  \x1b[90mGET :${INJECT_PORT}/config  ·  GET :${INJECT_PORT}/health  |  @caminho/arquivo → embed automático\x1b[0m
`;

// ─── Helpers de dispatch ──────────────────────────────────────────────────────

/**
 * @param {string} cmd
 * @param {string} arg
 * @param {string[]} rest
 * @param {readline.Interface} rl
 * @param {import('node:http').Server} injectServer
 * @param {() => void} cleanup
 * @returns {Promise<void>}
 */
async function dispatchCmd(cmd, arg, rest, rl, injectServer, cleanup) {
    const _hubSessionId = getHubSessionId();
    switch (cmd?.toLowerCase()) {
        case 'status':
            _cmdStatus({ hubSessionId: _hubSessionId, injectPort: INJECT_PORT, println });
            break;
        case 'history': {
            const n = Number(arg) || 10;
            _cmdHistory({ println }, n);
            break;
        }
        case 'db-history': {
            const n = Number(arg) || 20;
            _cmdDbHistory({ hubSessionId: _hubSessionId, println }, n);
            break;
        }
        case 'db-sessions': {
            const n = Number(arg) || 10;
            _cmdDbSessions({ hubSessionId: _hubSessionId, println }, n);
            break;
        }
        case 'remember':
            _cmdRemember({ hubSessionId: _hubSessionId, println }, arg);
            break;
        case 'recall':
            _cmdRecall({ hubSessionId: _hubSessionId, println }, arg);
            break;
        case 'forget':
            _cmdForget({ hubSessionId: _hubSessionId, println }, arg);
            break;
        case 'who':
            _cmdWho({ injectPort: INJECT_PORT, println });
            break;
        case 'clear':
            _cmdClear({ println });
            break;
        case 'answer':
            _cmdAnswer({ println }, arg);
            break;
        case 'count':
            _cmdCount({ hubSessionId: _hubSessionId, println });
            break;
        case 'restart':
            println('\x1b[90m  Reiniciando dialog loop…\x1b[0m');
            try {
                await llmBridgeClient.stopDialogMode();
            } catch {
                /* já parado */
            }
            await ensureDialogLoop();
            println('\x1b[32m  Dialog loop reiniciado.\x1b[0m');
            break;
        case 'model':
            await _cmdModel({ println }, arg);
            break;
        case 'reasoning':
            _cmdReasoning({ println }, arg);
            break;
        case 'attach':
            await _cmdAttach({ println }, arg);
            break;
        case 'context':
            _cmdContext({ println });
            break;
        case 'compact':
            await _cmdCompact({ println });
            break;
        case 'plan':
            _cmdPlan({ println }, arg);
            break;
        case 'resume':
            await _cmdResume({ println, hubSessionId: _hubSessionId }, arg);
            break;
        case 'quit':
        case 'exit':
            println('[terminal] Encerrando sessão…');
            cleanup();
            try {
                await llmBridgeClient.stopDialogMode();
            } catch {
                /* ignora */
            }
            rl.close();
            injectServer.close();
            setRl(null);
            break;
        case 'gh':
            await _cmdGh({ println }, rest);
            break;
        case 'git':
            await _cmdGit({ println }, rest);
            break;
        case 'alias':
            _cmdAlias({ println }, rest);
            break;
        case 'help':
            _cmdHelp({ println, injectPort: INJECT_PORT });
            break;
        default:
            println(`\x1b[90m  Comando desconhecido: /${cmd}. Use /help para ver todos os comandos.\x1b[0m`);
    }
}

// ─── Agent listeners ──────────────────────────────────────────────────────────

/**
 * Registra listeners de eventos do AlwaysAliveAgent para exibição no terminal.
 *
 * @param {readline.Interface} rl - Interface readline ativa
 * @returns {() => void} Função de cleanup
 */
export function setupAgentListeners(rl) {
    const onQuestion = (/** @type {any} */ evt) => {
        const q = /** @type {string} */ (evt?.question ?? '');
        const choices = /** @type {string[]} */ (evt?.choices ?? []);

        // Filtra mensagens internas do protocolo dialog loop
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

    alwaysAliveAgent.on('question.pending', onQuestion);
    alwaysAliveAgent.once('stopped', onStopped);

    return () => {
        alwaysAliveAgent.off('question.pending', onQuestion);
        alwaysAliveAgent.off('stopped', onStopped);
    };
}

// ─── REPL ─────────────────────────────────────────────────────────────────────

/**
 * Inicia o REPL readline do terminal permanente.
 *
 * Em modo headless (stdin não-TTY), apenas garante o dialog loop e retorna, deixando o inject server HTTP manter o
 * event loop ativo.
 *
 * @param {import('node:http').Server} injectServer - Servidor HTTP de injeção (para fechar no /quit)
 * @returns {Promise<void>}
 */
export async function startRepl(injectServer) {
    if (!process.stdin.isTTY) {
        println('[boot] Modo headless detectado — REPL desativado. Use POST :' + INJECT_PORT + '/inject.');
        await ensureDialogLoop();
        return;
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
        prompt: PROMPT_USER,
    });
    setRl(rl);

    const cleanup = setupAgentListeners(rl);

    println(BANNER);
    println('\x1b[90m  Iniciando sessão com LLM-B…\x1b[0m');

    try {
        await ensureDialogLoop();
    } catch (/** @type {any} */ e) {
        println(`\x1b[31m  [erro de boot] ${e.message}\x1b[0m`);
        log('ERROR', `[TerminalServer] Boot error: ${e.message}`);
    }

    rl.prompt();

    rl.on('line', async (line) => {
        const trimmed = line.trim();
        if (!trimmed) {
            rl.prompt();
            return;
        }

        if (trimmed.startsWith('/')) {
            const resolved = resolve(trimmed);
            const [cmd, ...rest] = resolved.slice(1).split(' ');
            const arg = rest.join(' ');
            await dispatchCmd(cmd ?? '', arg, rest, rl, injectServer, cleanup);
            rl.prompt();
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
        println('\n[terminal] Ctrl+C detectado. Dialog loop mantido ativo. Use /quit para encerrar.');
        rl.prompt();
    });
}
