// @ts-check
/**
 * src/copilot/terminal/dialog/output.js
 *
 * Output helpers e constantes de configuração do motor de diálogo LLM-B.
 *
 * @module copilot/terminal/dialog/output
 * @see EventBus
 */

import { LLM_B_BOOT_PROMPT, LLM_B_TURN_TIMEOUT_MS } from '#copilot/config';
import { getSdkSessionMode } from '../../presentation/runtime-ui-state-store.js';
import { readTerminalActivitySnapshot } from '../activity-state.js';
import { readTerminalDialogStreamMeta, readTerminalRuntimeState } from '../frontend/llm-b-runtime.js';

// ─── Configuração ─────────────────────────────────────────────────────────────

/** Timeout para aguardar resposta da LLM-B por turno (ms). */
export const TURN_TIMEOUT_MS = LLM_B_TURN_TIMEOUT_MS;

export const PROMPT_USER = '\x1b[32mvocê\x1b[0m\x1b[90m›\x1b[0m ';
export const PROMPT_WAITING = '     ';

/**
 * Limita o tamanho de detalhes embutidos no prompt.
 *
 * @param {string} value
 * @param {number} [max=18] Default is `18`
 * @returns {string}
 */
function shortenPromptToken(value, max = 18) {
    return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Constrói o prompt interativo dinâmico do terminal.
 *
 * @returns {string}
 */
export function buildUserPrompt() {
    const state = readTerminalRuntimeState();
    const { model, reasoningEffort } = state;
    /** @type {string[]} */
    const tags = [];

    if (!state.dialogLoopActive) {
        tags.push('\x1b[31m[NOLOOP]\x1b[0m');
    }
    const sdkMode = getSdkSessionMode();
    if (sdkMode && sdkMode !== 'interactive') {
        tags.push(`\x1b[35m[MODE:${sdkMode.toUpperCase()}]\x1b[0m`);
    }
    if (state.dialogPaused) {
        tags.push('\x1b[31m[PAUSED]\x1b[0m');
    }
    if (state.queueSize > 0) {
        tags.push(`\x1b[90m[Q:${state.queueSize}]\x1b[0m`);
    }
    if (state.pendingQuestion && state.pendingQuestionKind) {
        tags.push(`\x1b[36m[ASK:${state.pendingQuestionKind.toUpperCase()}]\x1b[0m`);
    } else if (state.pendingQuestionShadowState) {
        const shadowTag =
            state.pendingQuestionShadowState === 'expired'
                ? '\x1b[31m[SHADOW:EXPIRED]\x1b[0m'
                : state.pendingQuestionShadowState === 'expiring_soon'
                  ? '\x1b[33m[SHADOW:SOON]\x1b[0m'
                  : state.pendingQuestionShadowState === 'fresh'
                    ? '\x1b[36m[SHADOW:FRESH]\x1b[0m'
                    : '\x1b[33m[SHADOW]\x1b[0m';
        tags.push(shadowTag);
    }

    return `\x1b[32mvocê\x1b[0m\x1b[90m[\x1b[36m${model}\x1b[90m/\x1b[35m${reasoningEffort}\x1b[90m]\x1b[0m${tags.join('')}\x1b[90m›\x1b[0m `;
}

/**
 * Constrói o prompt exibido enquanto o terminal está aguardando a resposta da LLM-B.
 *
 * @returns {string}
 */
export function buildWaitingPrompt() {
    const { model, reasoningEffort } = readTerminalDialogStreamMeta();
    const activity = readTerminalActivitySnapshot();
    const phase = shortenPromptToken(activity.phase.toUpperCase(), 10);
    const label = shortenPromptToken(activity.label, 16);
    return `\x1b[90m⏳[${phase}:${label}]\x1b[0m \x1b[90m[\x1b[36m${model}\x1b[90m/\x1b[35m${reasoningEffort}\x1b[90m]\x1b[0m `;
}

/** Separador visual entre turnos — 72 colunas. */
export const SEPARATOR = '\x1b[90m  ' + '─'.repeat(70) + '\x1b[0m';

/**
 * Boot prompt padrão enviado à LLM-B ao iniciar o dialog loop. Pode ser sobrescrito pela variável de ambiente
 * `LLM_B_BOOT_PROMPT`.
 */
const DEFAULT_BOOT_PROMPT = `Você é a LLM-B — assistente técnico interno do projeto chatgpt-docker-puppeteer.

Contexto do projeto:
- Node.js 24+ ESM; arquitetura orientada a eventos via barramento NERV
- Camadas principais: kernel, driver, orchestrator, agent, infra, server, missions
- Você opera como agente contínuo de longa duração, nunca encerra sessões

Seu papel:
- Responder perguntas técnicas sobre o codebase, arquitetura e decisões de design
- Ajudar na análise de bugs, código e logs quando solicitado
- Colaborar criticamente com o desenvolvedor e com a LLM-A (seu parceiro de raciocínio)

Protocolo OBRIGATÓRIO de comunicação via ask_user:
1. Chame ask_user("READY: aguardando próxima mensagem") para sinalizar prontidão.
2. Ao receber uma mensagem, processe-a e formule uma resposta completa.
3. Chame ask_user("REPLY: " + sua_resposta) para enviar a resposta.
4. Retorne ao passo 1.

IMPORTANTE: NUNCA encerre o loop. Não use ask_user("STOPPED") nem qualquer variante
de encerramento — o sistema é projetado para funcionar de forma contínua e permanente.
O loop deve continuar mesmo quando não há mensagens pendentes.`;

/** Boot prompt efetivo: env var sobrescreve o padrão. @type {string} */
export const BOOT_PROMPT = LLM_B_BOOT_PROMPT ?? DEFAULT_BOOT_PROMPT;

// ─── Output helpers ───────────────────────────────────────────────────────────

/**
 * Escreve linha no stdout preservando o estado do prompt.
 *
 * @param {string} text - Texto a exibir
 * @returns {void}
 */
export function println(text) {
    process.stdout.write(`\r${text}\n`);
}

/**
 * Exibe um turno completo (mensagem + resposta) com formatação visual limpa.
 *
 * @param {string} actor - Ator que enviou ('user' | 'llm-a')
 * @param {string} message - Mensagem enviada
 * @param {string} reply - Resposta da LLM-B
 * @param {number} durationMs - Duração da chamada em ms
 * @returns {void}
 */
export function printExchange(actor, message, reply, durationMs) {
    const ts = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const secs = (durationMs / 1000).toFixed(1);
    const { model, reasoningEffort } = readTerminalDialogStreamMeta();
    const effort = reasoningEffort;

    const secsNum = durationMs / 1000;
    const secsColor =
        secsNum < 5 ? `\x1b[32m${secs}s\x1b[0m` : secsNum < 15 ? `\x1b[33m${secs}s\x1b[0m` : `\x1b[31m${secs}s\x1b[0m`;

    if (actor === 'llm-a') {
        println(SEPARATOR);
        println(`  \x1b[90m[${ts}]\x1b[0m  🤖  \x1b[34mLLM-A\x1b[0m`);
        println('');
        for (const line of message.split('\n')) {
            println(`  \x1b[34m│\x1b[0m  ${line}`);
        }
        println('');
    }

    println(SEPARATOR);
    println(
        `  \x1b[90m[${ts}]\x1b[0m  🧠  \x1b[32mLLM-B\x1b[0m  \x1b[90m·\x1b[0m  \x1b[36m${model}\x1b[0m  \x1b[90m·\x1b[0m  \x1b[35m${effort}\x1b[0m  \x1b[90m·\x1b[0m  ${secsColor}`,
    );
    println('');
    const replyLines = reply.split('\n');
    let inCodeBlock = false;
    for (const line of replyLines) {
        if (line.trimStart().startsWith('```')) {
            inCodeBlock = !inCodeBlock;
            println(`  \x1b[32m│\x1b[0m  \x1b[2m${line}\x1b[0m`);
        } else if (inCodeBlock) {
            println(`  \x1b[32m│\x1b[0m  \x1b[48;5;236m\x1b[36m${line}\x1b[0m`);
        } else {
            println(`  \x1b[32m│\x1b[0m  ${line}`);
        }
    }
    println('');
}
