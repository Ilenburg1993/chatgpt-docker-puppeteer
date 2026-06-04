// @ts-check
/**
 * src/copilot/terminal/commands/menu.js
 *
 * Command palette textual para o terminal: opções contextuais com seleção numerada (pseudo-botões / dropdown-like), sem
 * dependências visuais fora do TTY.
 *
 * @module copilot/terminal/commands/menu
 */

import {
    getTerminalPendingStructuredUserInputCount,
    readTerminalRuntimeControlState,
    readTerminalRuntimeState,
} from '../frontend/gateways/index.js';
import { buildTerminalPickerPlan, runTerminalExternalPicker } from '../capabilities/index.js';
import { readTerminalIntentStats } from '../state/index.js';
import {
    readTerminalElicitationSummary,
    readTerminalPermissionSummary,
    readTerminalUserInputSummary,
} from '../state/sdk/index.js';
import {
    renderTerminalPendingQuestionKindLabel,
    terminalActionChip,
    terminalThemeText,
} from '../state/ui/index.js';

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
    const intentStats = readTerminalIntentStats();
    const structuredUserInputPending = getTerminalPendingStructuredUserInputCount();
    const entries = /** @type {TerminalSmartMenuEntry[]} */ ([]);

    entries.push(
        {
            id: 'status',
            label: 'Status completo',
            commandLine: '/status',
            description: 'Saúde, conversa, sessão e modelo efetivo',
        },
        {
            id: 'now',
            label: 'Snapshot operacional',
            commandLine: '/now',
            description: 'Fila, pergunta pendente e estado curto',
        },
        {
            id: 'activity',
            label: 'Atividade recente',
            commandLine: '/activity 15',
            description: 'Últimos sinais úteis da conversa e das ferramentas',
        },
        {
            id: 'intent',
            label: 'Intenções da LLM-B',
            commandLine: '/intent 20',
            description:
                intentStats.entries > 0
                    ? `${intentStats.entries} intenção(ões) explícita(s) capturada(s)`
                    : 'Histórico de intenções explícitas da LLM-B',
        },
        {
            id: 'metrics',
            label: 'Métricas da sessão',
            commandLine: '/metrics',
            description: 'Latência, entrada HTTP, prompt e custo',
        },
    );

    if (!control.dialogLoopActive || control.status === 'stopped') {
        entries.push({
            id: 'restart',
            label: 'Reiniciar conversa',
            commandLine: '/restart',
            description: 'Recupera conversa inativa ou parada',
            hot: true,
        });
    }

    if (control.dialogPaused) {
        entries.push({
            id: 'resume-loop',
            label: 'Retomar conversa',
            commandLine: '/dialog-resume',
            description: 'Retoma execução após pausa manual',
            hot: true,
        });
    } else {
        entries.push({
            id: 'pause-loop',
            label: 'Pausar conversa',
            commandLine: '/pause',
            description: 'Pausa entrada sem perder contexto',
        });
    }

    if (state.pendingQuestion && state.pendingQuestionKind && state.pendingQuestionKind !== 'ready') {
        entries.push({
            id: 'answer',
            label: 'Responder pergunta pendente',
            commandLine: '/answer ',
            description: `Tipo: ${renderTerminalPendingQuestionKindLabel(
                state.pendingQuestionKind,
            )} · cole a resposta após /answer`,
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
            description: `pergunta=${userInput.pending} · input=${structuredUserInputPending}`,
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
            label: 'Limpar pergunta restaurada',
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
            label: 'Preset de diagnóstico',
            commandLine: '/display preset debug',
            description: 'Ativa todos os sinais para diagnóstico',
        },
        {
            id: 'errors',
            label: 'Erros recentes',
            commandLine: '/errors 20',
            description: 'Últimas falhas observadas no terminal',
        },
        {
            id: 'terminal-libs',
            label: 'Libs auxiliares',
            commandLine: '/terminal libs',
            description: 'Ferramentas opcionais de preview, picker, diff e JSON',
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
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
function compactMenuCell(text, max) {
    const clean = text.replace(/\s+/gu, ' ').trim();
    if (clean.length <= max) return clean;
    return `${clean.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * @param {string} text
 * @param {number} width
 * @returns {string}
 */
function padMenuCell(text, width) {
    const clean = compactMenuCell(text, width);
    return clean.padEnd(width);
}

/**
 * @param {(text: string) => void} println
 * @param {TerminalSmartMenuEntry[]} entries
 * @returns {void}
 */
function renderTerminalSmartMenu(println, entries) {
    println(`\n  ${terminalThemeText('info', 'Painel de ações')}`);
    println(
        `  ${terminalThemeText('muted', `${entries.length} ações contextuais · execute com /menu <n> ou /menu <id>`)}\n`,
    );
    for (let i = 0; i < entries.length; i += 1) {
        const entry = /** @type {TerminalSmartMenuEntry} */ (entries[i]);
        const index = terminalThemeText('index', `[${String(i + 1).padStart(2, '0')}]`);
        const hot = entry.hot ? `${terminalThemeText('warn', 'Agora')} ` : '      ';
        const label = padMenuCell(entry.label, 28);
        const command = padMenuCell(entry.commandLine, 24);
        const description = compactMenuCell(entry.description, 64);
        println(
            `  ${index} ${hot}${terminalThemeText('info', label)} ${terminalThemeText('command', command)} ${terminalThemeText('muted', description)}`,
        );
    }
    println(
        `\n  ${terminalThemeText('muted', 'Ações rápidas:')} ${terminalActionChip('/menu 1')} ${terminalActionChip('/menu status')} ${terminalActionChip('/menu help')}\n`,
    );
}

/**
 * @param {(text: string) => void} println
 * @param {TerminalSmartMenuEntry[]} entries
 * @param {{ ready: boolean; reasons: string[] } | null} [ttyReadiness]
 * @returns {void}
 */
function renderTerminalPickerPlan(println, entries, ttyReadiness = null) {
    const state = readTerminalRuntimeState();
    const plan = buildTerminalPickerPlan({
        allowInteractive: false,
        pendingQuestion: Boolean(state.pendingQuestion && state.pendingQuestionKind !== 'ready'),
        blockReasons: ttyReadiness?.ready === false ? ttyReadiness.reasons : [],
        preferred: 'auto',
    });
    println(`\n  ${terminalThemeText('info', 'Picker do menu')}`);
    println(`  ${terminalThemeText('muted', `${entries.length} ações contextuais · fallback ${plan.fallbackCommand}`)}\n`);
    println(`  ${terminalThemeText('muted', 'Modo'.padEnd(12))} ${terminalThemeText(plan.mode === 'external' ? 'success' : 'warn', plan.label)}`);
    if (plan.command) {
        println(`  ${terminalThemeText('muted', 'Comando'.padEnd(12))} ${terminalThemeText('command', plan.command)}`);
    }
    if (plan.reasons.length > 0) {
        for (const reason of plan.reasons) {
            println(`  ${terminalThemeText('muted', 'Guarda'.padEnd(12))} ${terminalThemeText('warn', reason)}`);
        }
    }
    println(`  ${terminalThemeText('muted', 'Seguro'.padEnd(12))} ${terminalThemeText('command', '/menu <n> ou /menu <id>')}`);
    println('');
}

/**
 * @param {TerminalSmartMenuEntry[]} entries
 * @returns {{ id: string; label: string; description: string }[]}
 */
function buildTerminalMenuPickerItems(entries) {
    return entries.map((entry) => ({
        id: entry.id,
        label: entry.label,
        description: `${entry.description} · ${entry.commandLine}`,
    }));
}

/**
 * @param {{ println: (text: string) => void }} ctx
 * @param {string} [arg=''] Default is `''`
 * @param {string[]} [rest=[]] Default is `[]`
 * @param {{ executeCommandLine?: (commandLine: string) => Promise<boolean>; readExclusiveTtyReadiness?: () => { ready: boolean; reasons: string[] }; withExclusiveTty?: <T>(operation: () => T | Promise<T>) => Promise<{ ok: true; value: T; reason: null; reasons: []; error: null } | { ok: false; value: null; reason: string; reasons: string[]; error: unknown }> }} [deps]
 * @returns {Promise<void>}
 */
export async function cmdMenu({ println }, arg = '', rest = [], deps = {}) {
    const entries = buildTerminalSmartMenuEntries();
    const argTokens = arg.split(/\s+/u).filter(Boolean);
    const restTokens = rest.filter(Boolean);
    const tokens = restTokens.length > 0 && restTokens[0] === argTokens[0] ? restTokens : [...argTokens, ...restTokens];
    const primary = tokens[0] ?? '';
    const remaining = tokens.slice(1);

    if (primary.length === 0) {
        renderTerminalSmartMenu(println, entries);
        return;
    }

    if (primary.toLowerCase() === 'picker' || primary.toLowerCase() === '--picker') {
        const wantsInteractive = remaining.some((token) =>
            ['interactive', '--interactive', 'real', '--real'].includes(token.toLowerCase()),
        );
        const ttyReadiness = deps.readExclusiveTtyReadiness?.() ?? null;
        if (!wantsInteractive) {
            renderTerminalPickerPlan(println, entries, ttyReadiness);
            return;
        }
        const plan = buildTerminalPickerPlan({
            allowInteractive: ttyReadiness?.ready === true,
            blockReasons: ttyReadiness?.ready === false ? ttyReadiness.reasons : [],
            pendingQuestion: false,
            preferred: 'auto',
        });
        if (plan.mode !== 'external' || !plan.command || !plan.toolId || !deps.withExclusiveTty) {
            renderTerminalPickerPlan(println, entries, ttyReadiness);
            println(`  ${terminalThemeText('warn', 'Picker interativo indisponível; use /menu <n> ou /menu <id>.')}`);
            return;
        }
        const pickerCommand = plan.command;
        const pickerRenderer = plan.toolId;
        const selected = await deps.withExclusiveTty(() =>
            runTerminalExternalPicker(buildTerminalMenuPickerItems(entries), {
                command: pickerCommand,
                renderer: pickerRenderer,
                prompt: 'menu> ',
            }),
        );
        if (!selected.ok) {
            println(`  ${terminalThemeText('warn', `Picker indisponível: ${selected.reason}`)}`);
            return;
        }
        const result = selected.value;
        if (result.status !== 'selected' || !result.item) {
            const role = result.status === 'failed' ? 'error' : 'muted';
            println(`  ${terminalThemeText(role, `Picker: ${result.reason ?? 'seleção cancelada'}`)}`);
            return;
        }
        const entry = resolveTerminalSmartMenuSelection(entries, result.item.id);
        if (!entry) {
            println(`  ${terminalThemeText('error', 'Picker retornou uma ação desconhecida.')}`);
            return;
        }
        println(`  ${terminalThemeText('info', `⏵ ${entry.label}`)}  ${terminalThemeText('muted', `→ ${entry.commandLine}`)}`);
        if (typeof deps.executeCommandLine === 'function') {
            const ok = await deps.executeCommandLine(entry.commandLine);
            if (!ok) println(`  ${terminalThemeText('warn', 'Não foi possível executar a ação automaticamente; copie o comando acima.')}`);
        }
        return;
    }

    const selectionToken = primary.toLowerCase() === 'run' ? (remaining[0] ?? '') : primary;
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
