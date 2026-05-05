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
import readline from 'node:readline';
import { getBusy, getRl, getSdkSessionMode } from '../../presentation/runtime-ui-state-store.js';
import { readTerminalActivitySnapshot } from '../activity-state.js';
import { readTerminalPromptDisplayPolicy } from '../display-policy.js';
import { readTerminalDialogStreamMeta, readTerminalRuntimeState } from '../frontend/gateways/agent-runtime.js';
import { getTerminalDetailLevel } from '../ui-preferences.js';
import { terminalThemeText } from '../ui-theme.js';

// ─── Configuração ─────────────────────────────────────────────────────────────

/** Timeout para aguardar resposta da LLM-B por turno (ms). */
export const TURN_TIMEOUT_MS = LLM_B_TURN_TIMEOUT_MS;

export const PROMPT_USER = '\x1b[32mvocê\x1b[0m\x1b[90m›\x1b[0m ';
export const PROMPT_WAITING = '     ';

/** @type {number} */
let _terminalRenderLockDepth = 0;

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
 * @param {ReturnType<typeof readTerminalRuntimeState>} state
 * @returns {{ displayModel: string; configuredModel: string | null; mismatch: boolean }}
 */
function resolvePromptModelProjection(state) {
    const lastPrInfo = /** @type {Record<string, unknown> | null} */ (state.lastPrInfo ?? null);
    const configuredModel = typeof lastPrInfo?.['configuredModel'] === 'string' ? lastPrInfo['configuredModel'] : null;
    const effectiveModel = typeof lastPrInfo?.['effectiveModel'] === 'string' ? lastPrInfo['effectiveModel'] : null;
    const billedModel = typeof lastPrInfo?.['model'] === 'string' ? lastPrInfo['model'] : null;
    const mismatch =
        Boolean(lastPrInfo?.['modelMismatch']) ||
        Boolean(configuredModel && billedModel && configuredModel !== billedModel) ||
        Boolean(configuredModel && effectiveModel && configuredModel !== effectiveModel);
    return {
        displayModel: effectiveModel ?? billedModel ?? configuredModel ?? state.model,
        configuredModel,
        mismatch,
    };
}

/**
 * Constrói o prompt interativo dinâmico do terminal.
 *
 * @returns {string}
 */
export function buildUserPrompt() {
    const state = readTerminalRuntimeState();
    const promptPolicy = readTerminalPromptDisplayPolicy();
    const detailLevel = getTerminalDetailLevel();
    const compactDetail = detailLevel === 'compact';
    const { reasoningEffort } = state;
    const modelProjection = resolvePromptModelProjection(state);
    const model = compactDetail
        ? shortenPromptToken(modelProjection.displayModel || state.model, 14)
        : modelProjection.displayModel || state.model;
    /** @type {string[]} */
    const tags = [];

    const bootstrapping = state.status === 'starting';
    if (!state.dialogLoopActive && !bootstrapping) {
        tags.push(terminalThemeText('error', '[NOLOOP]'));
    }
    const sdkMode = getSdkSessionMode();
    if (sdkMode && sdkMode !== 'interactive') {
        tags.push(
            terminalThemeText(
                'thinking',
                compactDetail ? `[M:${sdkMode.toUpperCase()}]` : `[MODE:${sdkMode.toUpperCase()}]`,
            ),
        );
    }
    if (state.dialogPaused) {
        tags.push(terminalThemeText('error', '[PAUSED]'));
    }
    if (promptPolicy.showQueueTag && state.queueSize > 0) {
        tags.push(terminalThemeText('muted', `[Q:${state.queueSize}]`));
    }
    if (state.pendingQuestion && state.pendingQuestionKind && state.pendingQuestionKind !== 'ready') {
        tags.push(
            terminalThemeText('question', compactDetail ? '[ASK]' : `[ASK:${state.pendingQuestionKind.toUpperCase()}]`),
        );
    } else if (state.pendingQuestionShadowState) {
        const shadowTag =
            state.pendingQuestionShadowState === 'expired'
                ? terminalThemeText('error', compactDetail ? '[SHDW]' : '[SHADOW:EXPIRED]')
                : state.pendingQuestionShadowState === 'expiring_soon'
                  ? terminalThemeText('warn', compactDetail ? '[SHDW]' : '[SHADOW:SOON]')
                  : state.pendingQuestionShadowState === 'fresh'
                    ? terminalThemeText('question', compactDetail ? '[SHDW]' : '[SHADOW:FRESH]')
                    : terminalThemeText('warn', '[SHADOW]');
        if (state.pendingQuestionShadowState === 'expired' || promptPolicy.showNonCriticalShadowTag) {
            tags.push(shadowTag);
        }
    }
    if (
        modelProjection.mismatch &&
        modelProjection.configuredModel &&
        modelProjection.displayModel !== modelProjection.configuredModel
    ) {
        tags.push(
            terminalThemeText(
                'error',
                compactDetail ? '[MM]' : `[MODEL:${modelProjection.configuredModel}→${modelProjection.displayModel}]`,
            ),
        );
    }

    return `${terminalThemeText('success', 'você')}${terminalThemeText('muted', '[')}${terminalThemeText('info', model)}${terminalThemeText('muted', '/')}${terminalThemeText('thinking', reasoningEffort)}${terminalThemeText('muted', ']')}${tags.join('')}${terminalThemeText('muted', '›')} `;
}

/**
 * Constrói o prompt exibido enquanto o terminal está aguardando a resposta da LLM-B.
 *
 * @returns {string}
 */
export function buildWaitingPrompt() {
    const { model, reasoningEffort } = readTerminalDialogStreamMeta();
    const promptPolicy = readTerminalPromptDisplayPolicy();
    const detailLevel = getTerminalDetailLevel();
    const activity = readTerminalActivitySnapshot();
    const runtime = readTerminalRuntimeState();
    const compactDetail = detailLevel === 'compact';
    const phase = shortenPromptToken(activity.phase.toUpperCase(), 10);
    const label = shortenPromptToken(activity.label, 16);
    const sevRole = activity.severity === 'error' ? 'error' : activity.severity === 'warn' ? 'warn' : 'muted';
    /** @type {string[]} */
    const tags = [];
    if (promptPolicy.showQueueTag && runtime.queueSize > 0) tags.push(`Q:${runtime.queueSize}`);
    if (runtime.pendingQuestion && runtime.pendingQuestionKind && runtime.pendingQuestionKind !== 'ready') {
        tags.push(`ASK:${runtime.pendingQuestionKind.toUpperCase()}`);
    }
    if (promptPolicy.showNonCriticalShadowTag && runtime.pendingQuestionShadowState === 'expiring_soon') {
        tags.push('SHDW:SOON');
    }
    if (runtime.pendingQuestionShadowState === 'expired') tags.push('SHDW:EXP');
    const tagsStr = tags.length > 0 ? ` ${terminalThemeText('muted', `[${tags.join('|')}]`)}` : '';
    if (!promptPolicy.showWaitingActivity || compactDetail) {
        return `${terminalThemeText('muted', '⏳')}${tagsStr} ${terminalThemeText('muted', '[')}${terminalThemeText('info', model)}${terminalThemeText('muted', '/')}${terminalThemeText('thinking', reasoningEffort)}${terminalThemeText('muted', ']')} `;
    }
    return `${terminalThemeText(sevRole, `⏳[${phase}:${label}]`)}${tagsStr} ${terminalThemeText('muted', '[')}${terminalThemeText('info', model)}${terminalThemeText('muted', '/')}${terminalThemeText('thinking', reasoningEffort)}${terminalThemeText('muted', ']')} `;
}

/** Separador visual entre turnos — 72 colunas. */
export const SEPARATOR = '\x1b[90m  ' + '─'.repeat(70) + '\x1b[0m';

/**
 * @returns {void}
 */
function clearTerminalLine() {
    if (!process.stdout.isTTY) return;
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
}

/**
 * @returns {void}
 */
function redrawPromptIfInteractive() {
    const rl = getRl();
    if (!rl || getBusy() || _terminalRenderLockDepth > 0) return;
    rl.setPrompt(buildUserPrompt());
    rl.prompt();
}

/**
 * Ativa lock de renderização para impedir redraw de prompt enquanto há escrita contínua no terminal.
 *
 * @returns {void}
 */
export function beginTerminalRenderLock() {
    _terminalRenderLockDepth += 1;
}

/**
 * Libera lock de renderização previamente ativado.
 *
 * @returns {void}
 */
export function endTerminalRenderLock() {
    if (_terminalRenderLockDepth > 0) {
        _terminalRenderLockDepth -= 1;
    }
}

/**
 * @returns {boolean}
 */
export function isTerminalRenderLocked() {
    return _terminalRenderLockDepth > 0;
}

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
4. Ao receber CONTINUE_DIALOG_LOOP após o REPLY, chame imediatamente ask_user("READY: aguardando próxima mensagem").

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
    if (getRl()) {
        clearTerminalLine();
        process.stdout.write(`${text}\n`);
        redrawPromptIfInteractive();
        return;
    }
    process.stdout.write(`\r${text}\n`);
}

/**
 * Escreve uma linha transitória sem quebra, limpando o prompt atual quando necessário.
 *
 * @param {string} text
 * @returns {void}
 */
export function writeInlineStatus(text) {
    if (isTerminalRenderLocked()) return;
    clearTerminalLine();
    process.stdout.write(text);
}

/**
 * Escreve texto bruto no terminal. Pode opcionalmente limpar a linha interativa antes do primeiro write de um bloco.
 *
 * @param {string} text
 * @param {{ clearPromptLine?: boolean }} [options]
 * @returns {void}
 */
export function writeTerminalRaw(text, options = {}) {
    if (options.clearPromptLine === true) {
        clearTerminalLine();
    }
    process.stdout.write(text);
}

/**
 * Escreve chunk multi-linha prefixando cada linha com o marcador visual do bloco atual.
 *
 * @param {string} linePrefix
 * @param {string} chunk
 * @param {{ clearPromptLine?: boolean }} [options]
 * @returns {void}
 */
export function writeTerminalPrefixedChunk(linePrefix, chunk, options = {}) {
    const lines = chunk.split('\n');
    /** @type {string[]} */
    const out = [];
    for (let i = 0; i < lines.length; i += 1) {
        if (i > 0) {
            out.push('\n');
        }
        if (linePrefix.length > 0) {
            out.push(linePrefix);
        }
        out.push(/** @type {string} */ (lines[i]));
    }
    if (linePrefix.length === 0 && options.clearPromptLine === true) {
        clearTerminalLine();
    }
    writeTerminalRaw(out.join(''), { clearPromptLine: linePrefix.length > 0 && options.clearPromptLine === true });
}

/**
 * Limpa a linha transitória atual do terminal.
 *
 * @returns {void}
 */
export function clearInlineStatus() {
    if (isTerminalRenderLocked()) return;
    clearTerminalLine();
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
