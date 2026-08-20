// @ts-check
/**
 * src/copilot/terminal/commands/menu.js
 *
 * Command palette textual para o terminal: opções contextuais com seleção numerada (pseudo-botões / dropdown-like), sem
 * dependências visuais fora do TTY.
 *
 * @module copilot/terminal/commands/menu
 */

import { buildTerminalPickerPlan, runTerminalExternalPicker } from '../capabilities/index.js';
import {
    getTerminalPendingStructuredUserInputCount,
    readTerminalRuntimeControlState,
    readTerminalRuntimeState,
} from '../frontend/gateways/index.js';
import { readTerminalIntentStats } from '../state/index.js';
import {
    readTerminalElicitationSummary,
    readTerminalPermissionSummary,
    readTerminalUserInputSummary,
} from '../state/sdk/index.js';
import {
    renderTerminalPendingQuestionKindLabel,
    terminalThemeHeadline,
    terminalThemeRow,
    terminalThemeWrappedRow,
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
                    ? countLabel(intentStats.entries, 'intenção explícita capturada', 'intenções explícitas capturadas')
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
            label: 'Reiniciar sessão SDK',
            commandLine: '/restart',
            description: 'Fecha a sessão atual e reabre via initializer',
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
            description: 'Pendências vivas agora; histórico em /session sdk waits',
            hot: true,
        });
    }

    if (elicitation.pending > 0) {
        entries.push({
            id: 'elicitation-latest',
            label: 'Revisar elicitation pendente',
            commandLine: '/elicitation show latest',
            description: `${countLabel(elicitation.pending, 'pendente', 'pendentes')} · modo ${elicitation.latest?.mode ?? 'form'}`,
            hot: true,
        });
    }

    if (permission.pending > 0) {
        entries.push({
            id: 'permission-latest',
            label: 'Revisar permissão pendente',
            commandLine: '/permission show latest',
            description: `${countLabel(permission.pending, 'pendente', 'pendentes')}${permission.latest?.permissionType ? ` · ${permission.latest.permissionType}` : ''}`,
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
            description: `Janela de contexto em ${(ctxUtil * 100).toFixed(0)}%`,
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
 * @param {number} count
 * @param {string} singular
 * @param {string} plural
 * @returns {string}
 */
function countLabel(count, singular, plural) {
    return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * @param {(text: string) => void} println
 * @param {TerminalSmartMenuEntry[]} entries
 * @returns {void}
 */
function renderTerminalSmartMenu(println, entries) {
    println('');
    println(
        terminalThemeHeadline('assistant', 'Painel de ações', [
            countLabel(entries.length, 'ação contextual', 'ações contextuais'),
        ]),
    );
    for (let i = 0; i < entries.length; i += 1) {
        const entry = /** @type {TerminalSmartMenuEntry} */ (entries[i]);
        println(
            terminalThemeWrappedRow(
                `#${String(i + 1).padStart(2, '0')}`,
                `${entry.hot ? 'Agora · ' : ''}${entry.label} · ${entry.commandLine} · ${entry.description}`,
                { role: entry.hot ? 'warn' : 'command', width: 6, columns: 118 },
            ),
        );
    }
    println(
        terminalThemeWrappedRow('Executar', '/menu <n> · /menu <id> · /menu picker', {
            role: 'command',
            columns: 118,
        }),
    );
    println('');
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
    println('');
    println(
        terminalThemeHeadline('assistant', 'Picker do menu', [
            countLabel(entries.length, 'ação contextual', 'ações contextuais'),
        ]),
    );
    println(terminalThemeRow('Modo', plan.label, { role: plan.mode === 'external' ? 'success' : 'warn' }));
    println(terminalThemeRow('Fallback', plan.fallbackCommand, { role: 'command' }));
    if (plan.command) {
        println(terminalThemeRow('Comando', plan.command, { role: 'command' }));
    }
    if (plan.reasons.length > 0) {
        for (const reason of plan.reasons) {
            println(terminalThemeRow('Guarda', reason, { role: 'warn' }));
        }
    }
    println(terminalThemeRow('Seguro', '/menu <n> ou /menu <id>', { role: 'command' }));
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
 * @param {{
 *     executeCommandLine?: (commandLine: string) => Promise<boolean>;
 *     readExclusiveTtyReadiness?: () => { ready: boolean; reasons: string[] };
 *     withExclusiveTty?: <T>(
 *         operation: () => T | Promise<T>,
 *     ) => Promise<
 *         | { ok: true; value: T; reason: null; reasons: []; error: null }
 *         | { ok: false; value: null; reason: string; reasons: string[]; error: unknown }
 *     >;
 * }} [deps]
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
        const state = readTerminalRuntimeState();
        const plan = buildTerminalPickerPlan({
            allowInteractive: ttyReadiness?.ready === true,
            blockReasons: ttyReadiness?.ready === false ? ttyReadiness.reasons : [],
            pendingQuestion: Boolean(state.pendingQuestion && state.pendingQuestionKind !== 'ready'),
            preferred: 'auto',
        });
        if (plan.mode !== 'external' || !plan.command || !plan.toolId || !deps.withExclusiveTty) {
            renderTerminalPickerPlan(println, entries, ttyReadiness);
            println(
                terminalThemeRow('Picker', 'interativo indisponível; use /menu <n> ou /menu <id>', { role: 'warn' }),
            );
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
            println(terminalThemeRow('Picker', `indisponível: ${selected.reason}`, { role: 'warn' }));
            return;
        }
        const result = selected.value;
        if (result.status !== 'selected' || !result.item) {
            const role = result.status === 'failed' ? 'error' : 'muted';
            println(terminalThemeRow('Picker', result.reason ?? 'seleção cancelada', { role }));
            return;
        }
        const entry = resolveTerminalSmartMenuSelection(entries, result.item.id);
        if (!entry) {
            println(terminalThemeRow('Picker', 'retornou uma ação desconhecida', { role: 'error' }));
            return;
        }
        println(terminalThemeRow('Ação', `${entry.label} · ${entry.commandLine}`, { role: 'command' }));
        if (typeof deps.executeCommandLine === 'function') {
            const ok = await deps.executeCommandLine(entry.commandLine);
            if (!ok)
                println(
                    terminalThemeRow('Ação', 'execução automática falhou; copie o comando acima', { role: 'warn' }),
                );
        }
        return;
    }

    const selectionToken = primary.toLowerCase() === 'run' ? (remaining[0] ?? '') : primary;
    const selected = resolveTerminalSmartMenuSelection(entries, selectionToken);
    if (!selected) {
        println(terminalThemeRow('Seleção', `inválida: ${selectionToken || '(vazio)'}`, { role: 'error' }));
        println(terminalThemeRow('Uso', '/menu para listar opções · /menu <n> para executar', { role: 'command' }));
        return;
    }

    println(terminalThemeRow('Ação', `${selected.label} · ${selected.commandLine}`, { role: 'command' }));

    if (typeof deps.executeCommandLine === 'function') {
        const ok = await deps.executeCommandLine(selected.commandLine);
        if (!ok) {
            println(terminalThemeRow('Ação', 'execução automática falhou; copie o comando acima', { role: 'warn' }));
        }
    } else {
        println(
            terminalThemeRow('Ação', 'execução automática indisponível; copie e execute manualmente', {
                role: 'muted',
            }),
        );
    }
}
