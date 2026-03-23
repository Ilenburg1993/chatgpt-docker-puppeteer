// @ts-check
/**
 * src/copilot/cli-terminal.js
 *
 * CLI REPL para interação direta com o AlwaysAliveAgent via terminal.
 *
 * Comandos especiais (prefixados com /): /status — exibe snapshot de status do agente /history — exibe histórico de
 * conversa (últimas 10 trocas) /clear — limpa histórico local de conversa /answer <x> — responde a pergunta pendente do
 * modelo /quit — encerra o CLI
 *
 * Qualquer outra entrada é enviada ao modelo via LlmBridgeClient.chat(). Chunks são exibidos em tempo real via callback
 * onDelta (streaming).
 *
 * @module copilot/cli-terminal
 *
 * @example
 *     ```bash
 *     # Uso direto:
 *     node --strip-types src/copilot/cli-terminal.js
 *     ```;
 */

import { log } from '#core/logger';
import readline from 'node:readline';
import { alwaysAliveAgent } from './always-alive.js';
import { LlmBridgeClient } from './llm-bridge-client.js';

// ─── Constantes ───────────────────────────────────────────────────────────────

const BANNER = `
╔══════════════════════════════════════════════════╗
║  Copilot CLI — AlwaysAlive REPL                 ║
║  /status · /history · /clear · /answer · /quit  ║
╚══════════════════════════════════════════════════╝
`;

const PROMPT = 'você> ';

// ─── Helpers de output ────────────────────────────────────────────────────────

/**
 * Escreve uma linha para stdout, preservando a linha de prompt.
 *
 * @param {string} text - Texto a exibir
 * @returns {void}
 */
function println(text) {
    process.stdout.write(`\n${text}\n`);
}

/**
 * Escreve um chunk de streaming inline (sem newline).
 *
 * @param {string} chunk - Chunk de texto
 * @returns {void}
 */
function printChunk(chunk) {
    process.stdout.write(chunk);
}

// ─── Handlers de comando ──────────────────────────────────────────────────────

/**
 * Exibe o snapshot de status do agente.
 *
 * @param {LlmBridgeClient} client - Instância do LlmBridgeClient
 * @returns {void}
 */
function cmdStatus(client) {
    const snap = client.getAgentStatus();
    println(`[status] ${JSON.stringify(snap, null, 2)}`);
}

/**
 * Exibe até 10 últimas trocas do histórico local.
 *
 * @param {LlmBridgeClient} client - Instância do LlmBridgeClient
 * @returns {void}
 */
function cmdHistory(client) {
    const hist = client.history;
    if (hist.length === 0) {
        println('[history] Histórico vazio.');
        return;
    }
    const slice = hist.slice(-20); // últimos 20 turnos (10 pares user/assistant)
    for (const turn of slice) {
        const ts = new Date(turn.timestamp).toISOString();
        println(`[${ts}] ${turn.role}: ${turn.content.slice(0, 200)}${turn.content.length > 200 ? '…' : ''}`);
    }
}

/**
 * Responde a uma pergunta pendente do modelo.
 *
 * @param {LlmBridgeClient} client - Instância do LlmBridgeClient
 * @param {string} answer - Texto da resposta
 * @returns {void}
 */
function cmdAnswer(client, answer) {
    if (!answer.trim()) {
        println('[answer] Uso: /answer <texto da resposta>');
        return;
    }
    const ok = client.answer(answer);
    if (ok) {
        println(`[answer] Resposta enviada: "${answer}"`);
    } else {
        println('[answer] Nenhuma pergunta pendente no momento.');
    }
}

// ─── Listeners de eventos do agente ──────────────────────────────────────────

/**
 * Registra listeners de eventos do AlwaysAliveAgent para exibição no CLI.
 *
 * @param {readline.Interface} rl - Interface readline ativa
 * @returns {() => void} Função de cleanup para remover listeners
 */
function setupAgentListeners(rl) {
    const onQuestion = (/** @type {any} */ evt) => {
        const q = evt?.question ?? '';
        const choices = evt?.choices ?? [];
        rl.pause(); // pausa input enquanto exibe pergunta
        println(`\n⚡ PERGUNTA DO MODELO: "${q}"`);
        if (choices.length > 0) {
            println(`   Opções: ${choices.join(' | ')}`);
        }
        println('   Use /answer <resposta> para responder.');
        rl.resume();
        rl.prompt();
    };

    const onCompactionStart = () => {
        println('[compaction] Iniciando compactação de contexto (sessão infinita)…');
    };

    const onCompactionComplete = () => {
        println('[compaction] Compactação concluída.');
    };

    const onStopped = () => {
        println('[agente] Agente parado.');
    };

    alwaysAliveAgent.on('question.pending', onQuestion);
    alwaysAliveAgent.on('session.compaction_start', onCompactionStart);
    alwaysAliveAgent.on('session.compaction_complete', onCompactionComplete);
    alwaysAliveAgent.once('stopped', onStopped);

    return () => {
        alwaysAliveAgent.off('question.pending', onQuestion);
        alwaysAliveAgent.off('session.compaction_start', onCompactionStart);
        alwaysAliveAgent.off('session.compaction_complete', onCompactionComplete);
        alwaysAliveAgent.off('stopped', onStopped);
    };
}

// ─── Loop principal ───────────────────────────────────────────────────────────

/**
 * Inicia o REPL de terminal para o Copilot CLI.
 *
 * @returns {Promise<void>}
 */
export async function startCli() {
    const client = new LlmBridgeClient();

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
        prompt: PROMPT,
    });

    const cleanup = setupAgentListeners(rl);

    println(BANNER);

    const agentStatus = alwaysAliveAgent.status;
    if (agentStatus === 'stopped') {
        println('[aviso] Agente está stopped. Use alwaysAliveAgent.start() para iniciar antes de enviar mensagens.');
    } else {
        println(`[agente] Status: ${agentStatus}. Pronto para receber mensagens.`);
    }

    rl.prompt();

    rl.on('line', async (line) => {
        const trimmed = line.trim();
        if (!trimmed) {
            rl.prompt();
            return;
        }

        // Comandos especiais
        if (trimmed.startsWith('/')) {
            const [cmd, ...rest] = trimmed.slice(1).split(' ');
            const arg = rest.join(' ');

            switch (cmd?.toLowerCase()) {
                case 'status':
                    cmdStatus(client);
                    break;
                case 'history':
                    cmdHistory(client);
                    break;
                case 'clear':
                    client.clearHistory();
                    println('[clear] Histórico limpo.');
                    break;
                case 'answer':
                    cmdAnswer(client, arg);
                    break;
                case 'quit':
                case 'exit':
                    println('[cli] Encerrando...');
                    cleanup();
                    rl.close();
                    return;
                default:
                    println(`[cli] Comando desconhecido: /${cmd}. Use /status, /history, /clear, /answer ou /quit.`);
            }
            rl.prompt();
            return;
        }

        // Mensagem normal → envia ao modelo
        rl.pause();
        process.stdout.write('\ncopilot> ');

        try {
            const result = await client.chat(trimmed, {
                onDelta: (chunk) => {
                    printChunk(chunk);
                },
            });

            // Garante nova linha após streaming
            process.stdout.write(
                `\n[${result.durationMs}ms · ${result.responseLen} chars · ${result.chunks.length} chunks]\n`,
            );
        } catch (/** @type {any} */ e) {
            println(`[erro] ${e.message}`);
            log('ERROR', `[CliTerminal] ${e.message}`);
        } finally {
            rl.resume();
            rl.prompt();
        }
    });

    rl.on('close', () => {
        cleanup();
        println('[cli] Sessão encerrada.');
        log('INFO', '[CliTerminal] CLI encerrado.');
    });

    // Handle Ctrl+C graciosamente
    rl.on('SIGINT', () => {
        println('\n[cli] Use /quit para encerrar ou Ctrl+D.');
        rl.prompt();
    });
}

// ─── Entrypoint ───────────────────────────────────────────────────────────────

// Executa diretamente quando chamado via `node cli-terminal.js`
// Compatível com ESM: import.meta.url === process.argv[1] não funciona com strip-types;
// usa verificação de arg posicional como alternativa robusta.
const isMain = process.argv[1]?.endsWith('cli-terminal.js') ?? false;
if (isMain) {
    startCli().catch((e) => {
        console.error('[CliTerminal] Erro fatal:', e);
        process.exit(1);
    });
}
