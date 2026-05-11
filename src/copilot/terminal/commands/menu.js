// @ts-check
/**
 * src/copilot/terminal/commands/menu.js
 *
 * Command palette textual para o terminal: opções contextuais com seleção numerada (pseudo-botões / dropdown-like), sem
 * dependências visuais fora do TTY.
 *
 * @module copilot/terminal/commands/menu
 */

import { getPendingStructuredUserInputCount } from '#copilot/sdk';
import { readTerminalRuntimeControlState, readTerminalRuntimeState } from '../frontend/gateways/agent-runtime.js';
import {
    readTerminalElicitationSummary,
    readTerminalPermissionSummary,
    readTerminalUserInputSummary,
} from '../state/sdk-interactions.js';
import { terminalActionChip, terminalThemeBadge, terminalThemeText } from '../state/ui-theme.js';

/**
 * @typedef {{
 *     id: string;
 *     label: string;
 *     commandLine: string;
 *     description: string;
 *     hot?: boolean;
 * }} TerminalSmartMenuEntry
 */

/**
 * @returns {TerminalSmartMenuEntry[]}
 */
export function buildTerminalSmartMenuEntries() {
    const control = readTerminalRuntimeControlState();
    const state = readTerminalRuntimeState();
    const elicitation = readTerminalElicitationSummary();
    const permission = readTerminalPermissionSummary();
    const userInput = readTerminalUserInputSummary();
    const structuredUserInputPending = getPendingStructuredUserInputCount();
    const entries = /** @type {TerminalSmartMenuEntry[]} */ ([]);

    entries.push(
        {
            id: 'status',
            label: 'Status completo',
            commandLine: '/status',
            description: 'Health, loop, sessão, modelo efetivo e binding',
        },
        {
            id: 'now',
            label: 'Snapshot operacional',
            commandLine: '/now',
            description: 'Fila, pending question e estado curto do runtime',
        },
        {
            id: 'activity',
            label: 'Atividade recente',
            commandLine: '/activity 15',
            description: 'Últimos sinais úteis do loop/dialog/tools',
        },
        {
            id: 'metrics',
            label: 'Métricas da sessão',
            commandLine: '/metrics',
            description: 'Latência, inject, prompt freshness e billing',
        },
    );

    if (!control.dialogLoopActive || control.status === 'stopped') {
        entries.push({
            id: 'restart',
            label: 'Reiniciar dialog loop',
            commandLine: '/restart',
            description: 'Recupera loop inativo/parado',
            hot: true,
        });
    }

    if (control.dialogPaused) {
        entries.push({
            id: 'resume-loop',
            label: 'Retomar dialog loop',
            commandLine: '/dialog-resume',
            description: 'Retoma execução após pausa manual',
            hot: true,
        });
    } else {
        entries.push({
            id: 'pause-loop',
            label: 'Pausar dialog loop',
            commandLine: '/pause',
            description: 'Pausa intake sem perder contexto',
        });
    }

    if (state.pendingQuestion && state.pendingQuestionKind && state.pendingQuestionKind !== 'ready') {
        entries.push({
            id: 'answer',
            label: 'Responder pergunta pendente',
            commandLine: '/answer ',
            description: `Tipo: ${state.pendingQuestionKind} · cole a resposta após /answer`,
            hot: true,
        });
    }

    if (
        (userInput.pending > 0 || structuredUserInputPending > 0) &&
        (!state.pendingQuestion || state.pendingQuestionKind === 'ready')
    ) {
        entries.push({
            id: 'sdk-ask-user',
            label: 'Inspecionar input humano SDK',
            commandLine: '/status',
            description: `ask_user=${userInput.pending} · request_user_input=${structuredUserInputPending}`,
            hot: true,
        });
    }

    if (userInput.pending > 0 || structuredUserInputPending > 0 || elicitation.pending > 0 || permission.pending > 0) {
        entries.push({
            id: 'sdk-waits',
            label: 'Painel de interrupções SDK',
            commandLine: '/sdk waits',
            description: 'Resumo unificado de waits e ações rápidas',
            hot: true,
        });
    }

    if (elicitation.pending > 0) {
        entries.push({
            id: 'elicitation-latest',
            label: 'Revisar elicitation pendente',
            commandLine: '/elicitation show latest',
            description: `${elicitation.pending} pendente(s) · modo ${elicitation.latest?.mode ?? 'form'}`,
            hot: true,
        });
    }

    if (permission.pending > 0) {
        entries.push({
            id: 'permission-latest',
            label: 'Revisar permissão pendente',
            commandLine: '/permission show latest',
            description: `${permission.pending} pendente(s)${permission.latest?.permissionType ? ` · ${permission.latest.permissionType}` : ''}`,
            hot: true,
        });
    }

    if (state.pendingQuestionShadowState === 'expired') {
        entries.push({
            id: 'clear-shadow',
            label: 'Limpar shadow expirada',
            commandLine: '/clear-shadow',
            description: 'Evita replay duplicado de pergunta antiga',
            hot: true,
        });
    }

    const ctxUtil = state.contextWindow?.utilization ?? 0;
    if (ctxUtil >= 0.85) {
        entries.push({
            id: 'compact',
            label: 'Compactar contexto',
            commandLine: '/compact',
            description: `Context window em ${(ctxUtil * 100).toFixed(0)}%`,
            hot: true,
        });
    }

    entries.push(
        {
            id: 'display-focus',
            label: 'Preset de foco',
            commandLine: '/display preset focus',
            description: 'Mais sinal humano e menos ruído de fundo',
        },
        {
            id: 'display-debug',
            label: 'Preset de debug',
            commandLine: '/display preset debug',
            description: 'Ativa todos os sinais para troubleshooting',
        },
        {
            id: 'errors',
            label: 'Erros recentes',
            commandLine: '/errors 20',
            description: 'Últimas falhas observadas no terminal/runtime',
        },
        {
            id: 'help',
            label: 'Ajuda completa',
            commandLine: '/help',
            description: 'Catálogo completo de comandos',
        },
    );

    return entries;
}

/**
 * @param {TerminalSmartMenuEntry[]} entries
 * @param {string} token
 * @returns {TerminalSmartMenuEntry | null}
 */
export function resolveTerminalSmartMenuSelection(entries, token) {
    const normalized = token.trim().toLowerCase();
    if (normalized.length === 0) return null;

    const numeric = Number(normalized);
    if (Number.isInteger(numeric) && numeric >= 1 && numeric <= entries.length) {
        return entries[numeric - 1] ?? null;
    }

    return entries.find((entry) => entry.id === normalized) ?? null;
}

/**
 * @param {(text: string) => void} println
 * @param {TerminalSmartMenuEntry[]} entries
 * @returns {void}
 */
function renderTerminalSmartMenu(println, entries) {
    println(`\n  ${terminalThemeText('info', '╔══════════════ Command Palette (Terminal Smart UX) ══════════════╗')}`);
    for (let i = 0; i < entries.length; i += 1) {
        const entry = /** @type {TerminalSmartMenuEntry} */ (entries[i]);
        const hot = entry.hot ? ` ${terminalThemeBadge('hot', 'HOT')}` : '';
        println(`  ${terminalThemeText('index', `[${i + 1}]`)} ${entry.label}${hot}`);
        println(`      ${terminalThemeText('muted', entry.description)}`);
        println(`      ${terminalThemeText('command', entry.commandLine)}`);
    }
    println(`  ${terminalThemeText('info', '╚══════════════════════════════════════════════════════════════════╝')}`);
    println(`  ${terminalThemeText('muted', `Use /menu <n> para executar, /menu run <n> ou /menu <id>. Ex: /menu 1`)}`);
    println(
        `  ${terminalThemeText('muted', 'Ações rápidas:')} ${terminalActionChip('/menu 1')} ${terminalActionChip('/menu status')}\n`,
    );
}

/**
 * @param {{ println: (text: string) => void }} ctx
 * @param {string} [arg=''] Default is `''`
 * @param {string[]} [rest=[]] Default is `[]`
 * @param {{ executeCommandLine?: (commandLine: string) => Promise<boolean> }} [deps]
 * @returns {Promise<void>}
 */
export async function cmdMenu({ println }, arg = '', rest = [], deps = {}) {
    const entries = buildTerminalSmartMenuEntries();
    const primary = arg.trim();

    if (primary.length === 0) {
        renderTerminalSmartMenu(println, entries);
        return;
    }

    const selectionToken = primary.toLowerCase() === 'run' ? (rest[0] ?? '') : primary;
    const selected = resolveTerminalSmartMenuSelection(entries, selectionToken);
    if (!selected) {
        println(`  ${terminalThemeText('error', `Seleção inválida: ${selectionToken || '(vazio)'}`)}`);
        println(`  ${terminalThemeText('muted', 'Use /menu para listar opções e /menu <n> para executar.')}`);
        return;
    }

    println(
        `  ${terminalThemeText('info', `⏵ ${selected.label}`)}  ${terminalThemeText('muted', `→ ${selected.commandLine}`)}`,
    );

    if (typeof deps.executeCommandLine === 'function') {
        const ok = await deps.executeCommandLine(selected.commandLine);
        if (!ok) {
            println(
                `  ${terminalThemeText('warn', 'Não foi possível executar a ação automaticamente; copie o comando acima.')}`,
            );
        }
    } else {
        println(
            `  ${terminalThemeText('muted', '(execução automática indisponível neste contexto; copie e execute manualmente)')}`,
        );
    }
}
