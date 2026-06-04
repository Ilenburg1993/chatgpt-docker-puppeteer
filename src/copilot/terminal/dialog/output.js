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
import { resolveModelSelectionMismatch } from '#copilot/core';
import readline from 'node:readline';
import { getBusy, getRl, getSdkSessionMode } from '../../presentation/state/index.js';
import {
    getTerminalPendingStructuredUserInputCount,
    readTerminalDialogStreamMeta,
    readTerminalRuntimeState,
} from '../frontend/gateways/index.js';
import {
    getTerminalDetailLevel,
    readTerminalActivitySnapshot,
    formatTerminalTimeLabel,
    readTerminalPromptDisplayPolicy,
    terminalThemeDivider,
    terminalThemeDuration,
    terminalThemeHeadline,
    renderTerminalPendingQuestionPromptTag,
    terminalThemeText,
} from '../state/dialog/index.js';

// ─── Configuração ─────────────────────────────────────────────────────────────

/** Timeout para aguardar resposta da LLM-B por turno (ms). */
export const TURN_TIMEOUT_MS = LLM_B_TURN_TIMEOUT_MS;

export const PROMPT_USER = '\x1b[32mvocê\x1b[0m\x1b[90m›\x1b[0m ';
export const PROMPT_WAITING = '     ';

/** @type {number} */
let _terminalRenderLockDepth = 0;
/** @typedef {string | (() => string)} ScheduledPrompt */

/**
 * @typedef {{
 *     ready: boolean;
 *     reasons: string[];
 * }} TerminalExclusiveTtyReadiness
 */

/**
 * @template T
 * @typedef {{
 *     ok: true;
 *     value: T;
 *     reason: null;
 *     reasons: [];
 *     error: null;
 * } | {
 *     ok: false;
 *     value: null;
 *     reason: string;
 *     reasons: string[];
 *     error: unknown;
 * }} TerminalExclusiveTtyResult
 */

/** @type {WeakMap<object, { prompt: ScheduledPrompt; immediate: NodeJS.Immediate }>} */
const _scheduledPromptRedraws = new WeakMap();
/** @type {WeakMap<object, { prompt: string; at: number }>} */
const _lastPromptPaints = new WeakMap();

const ANSI_ESCAPE = String.fromCharCode(27);
const ANSI_ESCAPE_PATTERN = new RegExp(`${ANSI_ESCAPE}\\[[0-?]*[ -/]*[@-~]`, 'g');
const ANSI_CLEAR_TO_END_OF_LINE = '\x1b[K';
const INLINE_STATUS_MIN_COLUMNS = 48;
const INLINE_STATUS_FALLBACK_COLUMNS = 120;
const INLINE_STATUS_MIN_ROWS = 3;
const INLINE_STATUS_FALLBACK_ROWS = 8;
const INLINE_STATUS_HEIGHT_RATIO = 0.24;
const INLINE_STATUS_PROMPT_GUARD_ROWS = 5;
const PROMPT_INPUT_GUARD_COLUMNS = 48;
const PROMPT_MAX_WIDTH_RATIO = 0.58;
const INLINE_STATUS_MODE_OFF = 'off';
const INLINE_STATUS_MODE_OVERLAY = 'overlay';
const INLINE_STATUS_MODE_RESERVED = 'reserved';
const PROMPT_REDRAW_DEDUPE_MS = 250;

/**
 * Quantidade de linhas reservadas para status acima do prompt (layout: [status...][prompt]).
 *
 * A UX antiga assumia exatamente 1 linha. Isso fazia textos longos sumirem, quebrarem o prompt ou ficarem
 * permanentemente escondidos no rodapé do terminal. Mantemos uma área transitória pequena e elástica: ela cresce até um
 * limite seguro, preserva o cursor do usuário via ANSI save/restore e deixa o histórico permanente para `println`.
 *
 * @type {number}
 */
let _statusRowsReserved = 0;

/**
 * @param {string} value
 * @returns {string}
 */
export function stripAnsiEscapes(value) {
    return value.replace(ANSI_ESCAPE_PATTERN, '');
}

/**
 * @param {string} value
 * @returns {number}
 */
function visibleTextLength(value) {
    return Array.from(stripAnsiEscapes(value)).length;
}

/**
 * @returns {number}
 */
function resolveInlineStatusColumns() {
    const columns = Number(process.stdout.columns ?? INLINE_STATUS_FALLBACK_COLUMNS);
    if (!Number.isFinite(columns)) return INLINE_STATUS_FALLBACK_COLUMNS;
    return Math.max(INLINE_STATUS_MIN_COLUMNS, Math.floor(columns) - 1);
}

/**
 * @returns {number}
 */
function resolveInlineStatusMaxRows() {
    const rows = Number(process.stdout.rows ?? INLINE_STATUS_FALLBACK_ROWS);
    if (!Number.isFinite(rows) || rows <= 0) return INLINE_STATUS_FALLBACK_ROWS;
    const promptAwareMax = Math.max(1, Math.floor(rows) - INLINE_STATUS_PROMPT_GUARD_ROWS);
    return Math.max(
        1,
        Math.min(promptAwareMax, Math.max(INLINE_STATUS_MIN_ROWS, Math.floor(rows * INLINE_STATUS_HEIGHT_RATIO))),
    );
}

/**
 * @returns {boolean}
 */
function shouldUseCompactPromptLayout() {
    if (!process.stdout.isTTY) return false;
    return resolveInlineStatusColumns() < 96;
}

/**
 * @returns {'off' | 'overlay' | 'reserved'}
 */
function resolveInlineStatusMode() {
    const mode = process.env['COPILOT_TERMINAL_INLINE_STATUS'];
    if (mode === INLINE_STATUS_MODE_OFF) return INLINE_STATUS_MODE_OFF;
    if (mode === INLINE_STATUS_MODE_OVERLAY) return INLINE_STATUS_MODE_OVERLAY;
    return INLINE_STATUS_MODE_RESERVED;
}

/**
 * A linha viva overlay usa cursor-up/clear-line para pintar acima do prompt e deixa uma linha vazia reservada depois de
 * blocos permanentes. O modo `reserved` usa o mesmo mecanismo de linhas acima do prompt, mas sem o salto visual extra
 * do overlay. `reserved` e o default em TTY; `off` preserva o comportamento transcript-first antigo.
 *
 * @returns {boolean}
 */
function shouldUseInlineStatusOverlay() {
    return resolveInlineStatusMode() === INLINE_STATUS_MODE_OVERLAY;
}

/**
 * @returns {boolean}
 */
function shouldUseInlineStatus() {
    return resolveInlineStatusMode() !== INLINE_STATUS_MODE_OFF;
}

/**
 * @returns {number}
 */
function resolvePromptBudgetColumns() {
    const columns = resolveInlineStatusColumns();
    const ratioBudget = Math.floor(columns * PROMPT_MAX_WIDTH_RATIO);
    return Math.max(24, Math.min(columns - 8, Math.min(ratioBudget, columns - PROMPT_INPUT_GUARD_COLUMNS)));
}

/**
 * @param {string} value
 * @param {number} max
 * @returns {string}
 */
function truncateVisibleEnd(value, max) {
    const chars = Array.from(value);
    if (chars.length <= max) return value;
    if (max <= 1) return '…';
    return `${chars.slice(0, max - 1).join('')}…`;
}

/**
 * @param {string} line
 * @param {number} columns
 * @returns {string[]}
 */
function wrapPlainStatusLine(line, columns) {
    if (line.length === 0) return [''];
    const tokens = line.match(/\S+\s*|\s+/g) ?? [line];
    /** @type {string[]} */
    const rows = [];
    let current = '';
    const pushCurrent = () => {
        if (current.length === 0) return;
        rows.push(current.trimEnd());
        current = '';
    };
    for (const token of tokens) {
        const tokenLength = Array.from(token).length;
        if (visibleTextLength(current) + tokenLength <= columns) {
            current += token;
            continue;
        }
        pushCurrent();
        if (tokenLength <= columns) {
            current = token.trimStart();
            continue;
        }
        const tokenChars = Array.from(token.trim());
        while (tokenChars.length > columns) {
            rows.push(tokenChars.splice(0, columns).join(''));
        }
        current = tokenChars.join('');
    }
    if (current.length > 0) rows.push(current);
    return rows;
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function fitInlineStatusRows(text) {
    const columns = resolveInlineStatusColumns();
    const maxRows = resolveInlineStatusMaxRows();
    const sanitized = normalizeInlineStatusText(text).replaceAll(ANSI_CLEAR_TO_END_OF_LINE, '').replace(/\r/g, '');
    const naturalRows = sanitized.split('\n');
    const alreadyFits =
        naturalRows.length <= maxRows && naturalRows.every((line) => visibleTextLength(line) <= columns);
    if (alreadyFits) {
        return naturalRows.map((line) => `${line}${ANSI_CLEAR_TO_END_OF_LINE}`);
    }

    const plainRows = stripAnsiEscapes(sanitized)
        .split('\n')
        .flatMap((line) => wrapPlainStatusLine(line, columns));
    if (plainRows.length <= maxRows) {
        return plainRows.map((line) => `${line}${ANSI_CLEAR_TO_END_OF_LINE}`);
    }
    const rows = plainRows.slice(0, maxRows);
    const lastIndex = rows.length - 1;
    rows[lastIndex] = truncateVisibleEnd(rows[lastIndex] ?? '', columns);
    return rows.map((line) => `${line}${ANSI_CLEAR_TO_END_OF_LINE}`);
}

/**
 * Ultima barreira de apresentacao da linha viva. Os produtores modernos ja enviam texto humano; este fallback impede
 * que rotas antigas reintroduzam taxonomia interna no rodape do operador.
 *
 * @param {string} text
 * @returns {string}
 */
function normalizeInlineStatusText(text) {
    return String(text)
        .replace(/\bLLM-B\s+tool\/Executando tool\b/giu, 'LLM-B ferramenta · Ferramenta em uso')
        .replace(/\btool\/Executando tool\b/giu, 'ferramenta · Ferramenta em uso')
        .replace(/\btool\/([^·\n]+)/giu, 'ferramenta · $1')
        .replace(/\bturn\/([^·\n]+)/giu, 'turno · $1')
        .replace(/\bthinking\/([^·\n]+)/giu, 'pensando · $1')
        .replace(/\bstreaming\/([^·\n]+)/giu, 'respondendo · $1')
        .replace(/\brequest_user_input ainda executando\b[^\n]*/giu, 'Pergunta ao operador aguardando resposta')
        .replace(/\bchatcmpl-tool-[a-z0-9-]+\b/giu, 'id interno')
        .replace(/\b(?:toolu|call)_[a-z0-9_-]+\b/giu, 'id interno')
        .replace(/\bexec_command\b/giu, 'Executar comando')
        .replace(/\bread_file_content\b/giu, 'Ler arquivo')
        .replace(/\breport_intent(?:_local)?\b/giu, 'Intenção capturada');
}

/**
 * @param {string} text
 * @param {number} [columns]
 * @returns {number}
 */
export function estimateTerminalPhysicalRows(text, columns = resolveInlineStatusColumns()) {
    const safeColumns = Math.max(1, Math.floor(columns));
    const lines = String(text).replace(/\r/g, '').split('\n');
    return Math.max(
        1,
        lines.reduce((total, line) => {
            const length = visibleTextLength(line);
            return total + Math.max(1, Math.ceil(length / safeColumns));
        }, 0),
    );
}

/**
 * @returns {number}
 */
function resolveCurrentReadlinePromptRows() {
    const rl = getRl();
    if (!rl) return 1;
    const record = /** @type {{ getPrompt?: () => string; line?: string }} */ (rl);
    const prompt = typeof record.getPrompt === 'function' ? record.getPrompt() : buildUserPrompt();
    const line = typeof record.line === 'string' ? record.line : '';
    return estimateTerminalPhysicalRows(`${prompt}${line}`);
}

/**
 * @returns {number}
 */
function resolveStatusCursorMoveUpRows() {
    return Math.max(1, _statusRowsReserved + resolveCurrentReadlinePromptRows() - 1);
}

/**
 * @returns {void}
 */
function clearReservedStatusRowsPreservingCursor() {
    if (!process.stdout.isTTY || _statusRowsReserved <= 0) return;
    /** @type {string[]} */
    const output = [`\x1b[s\x1b[${resolveStatusCursorMoveUpRows()}A`];
    for (let i = 0; i < _statusRowsReserved; i += 1) {
        output.push('\r\x1b[K');
        if (i < _statusRowsReserved - 1) output.push('\x1b[1B');
    }
    output.push('\x1b[u');
    process.stdout.write(output.join(''));
}

/**
 * @param {{ setPrompt: (prompt: string) => void; prompt: () => void } | null | undefined} rl
 * @param {number} rows
 * @returns {void}
 */
function reserveInlineStatusRows(rl, rows) {
    if (!rl || !isTerminalReadlineOpen(rl) || rows <= _statusRowsReserved) return;
    const missingRows = rows - _statusRowsReserved;
    clearTerminalLine();
    process.stdout.write('\n'.repeat(missingRows));
    paintTerminalPrompt(rl, getBusy() ? buildWaitingPrompt() : buildUserPrompt());
    _statusRowsReserved = rows;
}

/**
 * @param {string[]} rows
 * @returns {void}
 */
function renderReservedStatusRows(rows) {
    if (_statusRowsReserved <= 0) return;
    /** @type {string[]} */
    const output = [`\x1b[s\x1b[${resolveStatusCursorMoveUpRows()}A`];
    for (let i = 0; i < _statusRowsReserved; i += 1) {
        output.push(`\r\x1b[K${rows[i] ?? ''}`);
        if (i < _statusRowsReserved - 1) output.push('\x1b[1B');
    }
    output.push('\x1b[u');
    process.stdout.write(output.join(''));
}

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
 * @returns {{ displayModel: string; configuredModel: string | null; observedModel: string | null; mismatch: boolean }}
 */
function resolvePromptModelProjection(state) {
    const lastPrInfo = /** @type {Record<string, unknown> | null} */ (state.lastPrInfo ?? null);
    const activeModel = state.model || 'unknown';
    const observedConfiguredModel =
        typeof lastPrInfo?.['configuredModel'] === 'string' ? lastPrInfo['configuredModel'] : null;
    const effectiveModel = typeof lastPrInfo?.['effectiveModel'] === 'string' ? lastPrInfo['effectiveModel'] : null;
    const billedModel = typeof lastPrInfo?.['model'] === 'string' ? lastPrInfo['model'] : null;
    const observedModel = effectiveModel ?? billedModel ?? null;
    const telemetryMatchesActiveConfig = !observedConfiguredModel || observedConfiguredModel === activeModel;
    const mismatch =
        telemetryMatchesActiveConfig &&
        resolveModelSelectionMismatch({
            configuredModel: activeModel,
            billedModel,
            effectiveModel,
            explicitMismatch: Boolean(lastPrInfo?.['modelMismatch']),
        });
    return {
        displayModel: activeModel,
        configuredModel: activeModel,
        observedModel,
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
    const compactDetail = detailLevel === 'compact' || shouldUseCompactPromptLayout();
    const { reasoningEffort } = state;
    const modelProjection = resolvePromptModelProjection(state);
    const model = compactDetail
        ? shortenPromptToken(modelProjection.displayModel || state.model, 14)
        : modelProjection.displayModel || state.model;
    /** @type {string[]} */
    const tags = [];
    /** @type {string[]} */
    const compactTags = [];

    /**
     * @param {string} full
     * @param {string} [compact=full] Default is `full`
     * @returns {void}
     */
    const pushPromptTag = (full, compact = full) => {
        tags.push(full);
        compactTags.push(compact);
    };

    const bootstrapping = state.status === 'starting';
    if (!state.dialogLoopActive && !bootstrapping) {
        pushPromptTag(terminalThemeText('warn', '[STANDBY]'), terminalThemeText('warn', '[STBY]'));
    }
    const sdkMode = getSdkSessionMode();
    if (sdkMode && sdkMode !== 'interactive') {
        pushPromptTag(
            terminalThemeText(
                'thinking',
                compactDetail ? `[M:${sdkMode.toUpperCase()}]` : `[MODE:${sdkMode.toUpperCase()}]`,
            ),
            terminalThemeText('thinking', `[M:${sdkMode.toUpperCase()}]`),
        );
    }
    if (state.dialogPaused) {
        pushPromptTag(terminalThemeText('error', '[PAUSED]'), terminalThemeText('error', '[P]'));
    }
    if (promptPolicy.showQueueTag && state.queueSize > 0) {
        pushPromptTag(terminalThemeText('muted', `[Q:${state.queueSize}]`));
    }
    if (state.pendingQuestion && state.pendingQuestionKind && state.pendingQuestionKind !== 'ready') {
        pushPromptTag(
            terminalThemeText(
                'question',
                compactDetail ? '[PERGUNTA]' : `[${renderTerminalPendingQuestionPromptTag(state.pendingQuestionKind)}]`,
            ),
            terminalThemeText('question', '[PERG]'),
        );
    } else if (getTerminalPendingStructuredUserInputCount() > 0) {
        pushPromptTag(
            terminalThemeText('question', '[PERGUNTA]'),
            terminalThemeText('question', '[PERG]'),
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
            pushPromptTag(shadowTag, terminalThemeText('warn', '[S]'));
        }
    }
    if (
        modelProjection.mismatch &&
        modelProjection.configuredModel &&
        modelProjection.observedModel &&
        modelProjection.observedModel !== modelProjection.configuredModel
    ) {
        pushPromptTag(
            terminalThemeText(
                'warn',
                compactDetail
                    ? '[MODEL?]'
                    : `[MODEL-CHECK:${modelProjection.configuredModel}→${modelProjection.observedModel}]`,
            ),
            terminalThemeText('warn', '[MODEL?]'),
        );
    }
    const prompt = `${terminalThemeText('user', 'você')}${terminalThemeText('muted', '[')}${terminalThemeText('assistant', model)}${terminalThemeText('muted', '/')}${terminalThemeText('thinking', reasoningEffort)}${terminalThemeText('muted', ']')}${tags.join('')}${terminalThemeText('muted', '›')} `;
    if (!process.stdout.isTTY || visibleTextLength(prompt) <= resolvePromptBudgetColumns()) {
        return prompt;
    }
    const compactModel = shortenPromptToken(modelProjection.displayModel || state.model, 10);
    return `${terminalThemeText('user', 'você')}${terminalThemeText('muted', '[')}${terminalThemeText('assistant', compactModel)}${terminalThemeText('muted', '/')}${terminalThemeText('thinking', reasoningEffort)}${terminalThemeText('muted', ']')}${compactTags.join('')}${terminalThemeText('muted', '›')} `;
}

/**
 * @param {string} phase
 * @returns {string}
 */
function renderWaitingPromptPhaseLabel(phase) {
    if (phase === 'idle') return 'pronta';
    if (phase === 'boot') return 'iniciando';
    if (phase === 'turn') return 'turno';
    if (phase === 'thinking') return 'pensando';
    if (phase === 'streaming') return 'respondendo';
    if (phase === 'tool') return 'ferramenta';
    if (phase === 'task') return 'tarefa';
    if (phase === 'compaction') return 'compactando';
    if (phase === 'question') return 'aguardando operador';
    if (phase === 'subagent') return 'subagente';
    if (phase === 'error') return 'erro';
    return phase || 'atividade';
}

/**
 * Constrói o prompt exibido enquanto o terminal está aguardando a resposta da LLM-B.
 *
 * @returns {string}
 */
export function buildWaitingPrompt() {
    const promptPolicy = readTerminalPromptDisplayPolicy();
    const detailLevel = getTerminalDetailLevel();
    const activity = readTerminalActivitySnapshot();
    const runtime = readTerminalRuntimeState();
    const compactDetail = detailLevel === 'compact' || shouldUseCompactPromptLayout();
    const phase = shortenPromptToken(renderWaitingPromptPhaseLabel(activity.phase), 20);
    const label = shortenPromptToken(activity.label, 16);
    const sevRole = activity.severity === 'error' ? 'error' : activity.severity === 'warn' ? 'warn' : 'muted';
    /** @type {string[]} */
    const tags = [];
    if (promptPolicy.showQueueTag && runtime.queueSize > 0) tags.push(`Q:${runtime.queueSize}`);
    if (runtime.pendingQuestion && runtime.pendingQuestionKind && runtime.pendingQuestionKind !== 'ready') {
        tags.push(renderTerminalPendingQuestionPromptTag(runtime.pendingQuestionKind));
    } else if (getTerminalPendingStructuredUserInputCount() > 0) {
        tags.push('PERGUNTA');
    }
    if (promptPolicy.showNonCriticalShadowTag && runtime.pendingQuestionShadowState === 'expiring_soon') {
        tags.push('SHDW:SOON');
    }
    if (runtime.pendingQuestionShadowState === 'expired') tags.push('SHDW:EXP');
    const tagsStr = tags.length > 0 ? ` ${terminalThemeText('muted', `[${tags.join('|')}]`)}` : '';
    if (!promptPolicy.showWaitingActivity || compactDetail) {
        return `${terminalThemeText('thinking', 'LLM-B pensando')}${tagsStr} `;
    }
    return `${terminalThemeText(sevRole, `LLM-B pensando · ${phase} · ${label}`)}${tagsStr} `;
}

/** Separador visual entre turnos — 72 colunas. */
export const SEPARATOR = terminalThemeDivider(70);

/**
 * @returns {void}
 */
function clearTerminalLine() {
    if (!process.stdout.isTTY) return;
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
}

/**
 * Readline pode fechar entre a intenção de redraw e o tick que a materializa.
 *
 * @param {unknown} rl
 * @returns {boolean}
 */
function isTerminalReadlineOpen(rl) {
    return Boolean(rl) && /** @type {{ closed?: boolean }} */ (rl).closed !== true;
}

/**
 * A linha viva nao deve disputar a linha interativa quando o operador ja comecou a digitar.
 *
 * @param {unknown} rl
 * @returns {boolean}
 */
function hasTerminalReadlineBufferedInput(rl) {
    const line = /** @type {{ line?: unknown }} */ (rl ?? {}).line;
    return typeof line === 'string' && line.length > 0;
}

/**
 * @param {{ setPrompt: (prompt: string) => void; prompt: () => void; closed?: boolean }} rl
 * @param {string} prompt
 * @param {{ force?: boolean }} [options]
 * @returns {void}
 */
function paintTerminalPrompt(rl, prompt, options = {}) {
    if (!isTerminalReadlineOpen(rl)) return;
    if (options.force !== true) {
        _lastPromptPaints.set(/** @type {object} */ (rl), { prompt, at: Date.now() });
    }
    rl.setPrompt(prompt);
    if (!isTerminalReadlineOpen(rl)) return;
    rl.prompt();
}

/**
 * @param {unknown} rl
 * @param {string} prompt
 * @param {number} [now]
 * @returns {boolean}
 */
function shouldSkipDuplicatePromptPaint(rl, prompt, now = Date.now()) {
    if (!rl || typeof rl !== 'object') return false;
    const inputLine = /** @type {{ line?: string }} */ (rl).line;
    if (typeof inputLine === 'string' && inputLine.length > 0) return false;
    const last = _lastPromptPaints.get(rl);
    return Boolean(last && last.prompt === prompt && now - last.at >= 0 && now - last.at < PROMPT_REDRAW_DEDUPE_MS);
}

/**
 * @returns {void}
 */
function redrawPromptIfInteractive() {
    const rl = getRl();
    if (!rl || getBusy() || _terminalRenderLockDepth > 0) return;
    scheduleTerminalPromptRedraw(rl, () => buildUserPrompt());
}

/**
 * Abre uma separação física entre o prompt vivo e um bloco durável.
 *
 * A limpeza ANSI deixa a tela real correta, mas logs plain e alguns terminais integrados ainda podem preservar a linha
 * do prompt antes de aplicar o carriage-return. Uma quebra real evita que eventos duráveis apareçam como se fossem
 * texto digitado pelo operador, mantendo o input pronto na linha seguinte quando o prompt for redesenhado.
 *
 * @returns {void}
 */
function breakPromptLineBeforeDurableOutput() {
    const rl = getRl();
    if (!process.stdout.isTTY || !rl || _terminalRenderLockDepth > 0) return;
    const bufferedInput = /** @type {{ line?: unknown }} */ (rl).line;
    if (typeof bufferedInput === 'string' && bufferedInput.length > 0) return;
    process.stdout.write('\n');
}

/**
 * Redesenha o prompt em uma linha limpa imediatamente.
 *
 * @param {{ setPrompt: (prompt: string) => void; prompt: () => void; closed?: boolean } | null | undefined} rl
 * @param {string} [prompt]
 * @returns {void}
 */
export function redrawTerminalPrompt(rl, prompt = buildUserPrompt()) {
    if (!rl || !isTerminalReadlineOpen(rl)) return;
    if (shouldSkipDuplicatePromptPaint(rl, prompt)) return;
    clearTerminalLine();
    paintTerminalPrompt(rl, prompt);
}

/**
 * Agenda um único redraw limpo do prompt por tick para um readline específico.
 *
 * Vários subsistemas podem terminar quase ao mesmo tempo (tool events, transcript, linha viva, comando REPL). Antes,
 * cada um chamava `rl.prompt()` diretamente e, em TTYs reais, isso podia produzir `você› você›` ou esconder texto já
 * digitado. Este gateway preserva a última intenção de prompt e executa uma única pintura limpa quando a pilha atual de
 * writes ANSI termina.
 *
 * @param {{ setPrompt: (prompt: string) => void; prompt: () => void; closed?: boolean } | null | undefined} rl
 * @param {ScheduledPrompt} [prompt]
 * @returns {void}
 */
export function scheduleTerminalPromptRedraw(rl, prompt = () => buildUserPrompt()) {
    if (!isTerminalReadlineOpen(rl)) return;
    const key = /** @type {object} */ (rl);
    const current = _scheduledPromptRedraws.get(key);
    if (current) {
        current.prompt = prompt;
        return;
    }
    const state = {
        prompt,
        immediate: setImmediate(() => {
            _scheduledPromptRedraws.delete(key);
            if (_terminalRenderLockDepth > 0 || !isTerminalReadlineOpen(rl)) return;
            const inputLine = /** @type {{ line?: string }} */ (rl).line;
            if (typeof inputLine === 'string' && inputLine.length > 0) return;
            const nextPrompt = typeof state.prompt === 'function' ? state.prompt() : state.prompt;
            redrawTerminalPrompt(rl, getBusy() ? buildWaitingPrompt() : nextPrompt);
        }),
    };
    if (typeof state.immediate.unref === 'function') state.immediate.unref();
    _scheduledPromptRedraws.set(key, state);
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
 * Verifica se o terminal pode entregar controle exclusivo de stdin/stdout para uma TUI externa.
 *
 * Este contrato e intencionalmente mais estrito que `process.stdout.isTTY`: o prompt vivo tambem precisa estar
 * ocioso, sem input humano parcialmente digitado e sem render lock ativo. Qualquer comando que venha a usar
 * `fzf`, `gum` ou pager interativo deve passar por este gateway em vez de pausar readline localmente.
 *
 * @param {{ line?: string; closed?: boolean } | null | undefined} rl
 * @param {{ requireTty?: boolean; allowBusy?: boolean; allowBufferedInput?: boolean; ignoreRenderLock?: boolean }} [options]
 * @returns {TerminalExclusiveTtyReadiness}
 */
export function readTerminalExclusiveTtyReadiness(rl, options = {}) {
    /** @type {string[]} */
    const reasons = [];
    if (!isTerminalReadlineOpen(rl)) reasons.push('readline indisponível');
    if (options.requireTty !== false && (!process.stdin.isTTY || !process.stdout.isTTY)) {
        reasons.push('TTY interativo indisponível');
    }
    if (getBusy() && options.allowBusy !== true) reasons.push('turno em execução');
    if (isTerminalRenderLocked() && options.ignoreRenderLock !== true) {
        reasons.push('renderização terminal em andamento');
    }
    const inputLine = typeof rl?.line === 'string' ? rl.line : '';
    if (inputLine.length > 0 && options.allowBufferedInput !== true) {
        reasons.push('input humano parcialmente digitado');
    }
    return {
        ready: reasons.length === 0,
        reasons,
    };
}

/**
 * Executa uma operação com controle exclusivo temporário do TTY e restaura prompt/linha viva no fim.
 *
 * A função nao executa nenhum binário por conta própria; ela só cria o envelope seguro para adapters interativos.
 * Isso mantém a regra: tool externa opcional nunca compete diretamente com readline, streaming ou pergunta humana.
 *
 * @template T
 * @param {{ pause?: () => void; resume?: () => void; getPrompt?: () => string; setPrompt: (prompt: string) => void; prompt: () => void; line?: string; closed?: boolean } | null | undefined} rl
 * @param {() => T | Promise<T>} operation
 * @param {{ requireTty?: boolean; allowBusy?: boolean; allowBufferedInput?: boolean; ignoreRenderLock?: boolean }} [options]
 * @returns {Promise<TerminalExclusiveTtyResult<T>>}
 */
export async function withTerminalExclusiveTty(rl, operation, options = {}) {
    const readiness = readTerminalExclusiveTtyReadiness(rl, options);
    if (!readiness.ready) {
        return {
            ok: false,
            value: null,
            reason: readiness.reasons.join('; '),
            reasons: readiness.reasons,
            error: null,
        };
    }

    const prompt = typeof rl?.getPrompt === 'function' ? rl.getPrompt() : buildUserPrompt();
    try {
        clearInlineStatus();
        resetStatusRowState();
        beginTerminalRenderLock();
        clearTerminalLine();
        rl?.pause?.();
        const value = await operation();
        return {
            ok: true,
            value,
            reason: null,
            reasons: [],
            error: null,
        };
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return {
            ok: false,
            value: null,
            reason,
            reasons: [reason],
            error,
        };
    } finally {
        rl?.resume?.();
        endTerminalRenderLock();
        resetStatusRowState();
        if (rl && isTerminalReadlineOpen(rl)) {
            clearTerminalLine();
            paintTerminalPrompt(rl, prompt, { force: true });
        }
    }
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

Contrato operacional da fila de intervenção:
- Neste terminal, "PR" NÃO significa pull request do GitHub.
- "PR" significa consumo de uma nova paid/prompt request do SDK/modelo.
- A fila de intervenção é mantida pelo runtime e aplicada somente quando você chama
  ask_user("READY: ...") ou outra pergunta humana normal; ela deve ser respondida por answerPendingQuestion, sem
  abrir novo session.send().
- Turno explícito ('/turn', 'mode=turn', 'mode=dialog', '!!turn', '!!dialog') é trabalho deliberado e pode consumir PR.
- 'steer/immediate' é intervenção SDK direta e também pode consumir PR; por padrão, o sistema deve preservar a intenção
  na fila de intervenção quando a política de economia de PR estiver ativa.

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
    printlnBlock([text]);
}

/**
 * Escreve um bloco de linhas no stdout preservando o prompt com um único redraw.
 *
 * Use para blocos multi-linha semanticamente atômicos (auto-brief, transcript, cards). Isso evita que o prompt seja
 * redesenhado entre cada linha, reduz writes ANSI e deixa o histórico visual muito mais limpo.
 *
 * @param {string | string[]} lines
 * @returns {void}
 */
export function printlnBlock(lines) {
    const text = Array.isArray(lines) ? lines.join('\n') : lines;
    if (getRl()) {
        const useOverlay = shouldUseInlineStatusOverlay();
        const hadReservedStatusRows = _statusRowsReserved > 0;
        if (_statusRowsReserved > 0) {
            clearReservedStatusRowsPreservingCursor();
            _statusRowsReserved = 0;
        }
        clearTerminalLine();
        breakPromptLineBeforeDurableOutput();
        process.stdout.write(`${text.endsWith('\n') ? text : `${text}\n`}`);
        // Overlay opt-in: re-reserva uma linha em branco acima do prompt para evitar salto visual no próximo pulso.
        if (useOverlay && !hadReservedStatusRows) {
            process.stdout.write('\n');
        }
        _statusRowsReserved = useOverlay ? 1 : 0;
        redrawPromptIfInteractive();
        return;
    }
    process.stdout.write(`\r${text}\n`);
}

/**
 * Escreve uma linha transitória de status SEM deslocar o cursor do usuário.
 *
 * Quando o readline está ativo, usa uma linha reservada ACIMA do prompt via ANSI save/restore. O cursor do usuário
 * permanece exatamente onde estava, garantindo digitação independente.
 *
 * @param {string} text
 * @returns {void}
 */
export function writeInlineStatus(text) {
    if (isTerminalRenderLocked()) return;
    if (!process.stdout.isTTY) return;
    if (!shouldUseInlineStatus()) return;
    const rows = fitInlineStatusRows(text);
    const rl = getRl();
    if (!rl) {
        clearTerminalLine();
        process.stdout.write(rows.join('\n'));
        return;
    }
    if (hasTerminalReadlineBufferedInput(rl)) {
        if (_statusRowsReserved > 0) clearReservedStatusRowsPreservingCursor();
        return;
    }
    reserveInlineStatusRows(rl, rows.length);
    renderReservedStatusRows(rows);
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
 * Limpa a linha de status sem mover o cursor do usuário.
 *
 * Quando readline está ativo e há linha reservada, usa ANSI save/restore para limpar a linha acima sem deslocar o
 * cursor do usuário.
 *
 * @returns {void}
 */
export function clearInlineStatus() {
    if (isTerminalRenderLocked()) return;
    if (!shouldUseInlineStatus()) {
        _statusRowsReserved = 0;
        return;
    }
    if (!process.stdout.isTTY) {
        clearTerminalLine();
        return;
    }
    const rl = getRl();
    if (!rl || _statusRowsReserved <= 0) {
        clearTerminalLine();
        return;
    }
    clearReservedStatusRowsPreservingCursor();
    // Mantém _statusRowsReserved: a área em branco reservada permanece acima do prompt.
}

/**
 * Reseta o estado da linha de status reservada. Deve ser chamado quando o readline é fechado.
 *
 * @returns {void}
 */
export function resetStatusRowState() {
    _statusRowsReserved = 0;
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
    const ts = formatTerminalTimeLabel(Date.now(), { mode: 'dual' });
    const { model, reasoningEffort } = readTerminalDialogStreamMeta();
    const effort = reasoningEffort;

    /** @type {string[]} */
    const lines = [];

    if (actor === 'llm-a') {
        lines.push(SEPARATOR);
        lines.push(terminalThemeHeadline('system', 'LLM-A', [`[${ts}]`]));
        lines.push('');
        for (const line of message.split('\n')) {
            lines.push(`  ${terminalThemeText('system', '│')}  ${line}`);
        }
        lines.push('');
    }

    lines.push(SEPARATOR);
    lines.push(terminalThemeHeadline('assistant', 'LLM-B', [`[${ts}]`, model, effort, terminalThemeDuration(durationMs)]));
    lines.push('');
    const replyLines = reply.split('\n');
    let inCodeBlock = false;
    const visibleReplyLines = reply.trim().length > 0 ? replyLines : ['[sem resposta textual materializada pelo SDK]'];
    for (const line of visibleReplyLines) {
        if (line.trimStart().startsWith('```')) {
            inCodeBlock = !inCodeBlock;
            lines.push(`  ${terminalThemeText('assistant', '│')}  \x1b[2m${line}\x1b[0m`);
        } else if (inCodeBlock) {
            lines.push(`  ${terminalThemeText('assistant', '│')}  \x1b[48;5;236m${terminalThemeText('info', line)}`);
        } else if (reply.trim().length === 0) {
            lines.push(`  ${terminalThemeText('warn', '│')}  ${terminalThemeText('warn', line)}`);
        } else {
            lines.push(`  ${terminalThemeText('assistant', '│')}  ${line}`);
        }
    }
    lines.push('');
    printlnBlock(lines);
}
