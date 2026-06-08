// @ts-check
/**
 * src/copilot/terminal/commands/plan.js
 *
 * Comando `/plan` baseado exclusivamente na superfície vanilla do SDK.
 *
 * Sintaxe:
 *
 * - `/plan` → exibe estado atual do `mode` e do `plan.md`
 * - `/plan on` → `mode.set('plan')`
 * - `/plan off` → `mode.set('interactive')`
 * - `/plan autopilot` → `mode.set('autopilot')`
 * - `/plan read` → imprime o conteúdo atual de `plan.md`
 * - `/plan set <content>` → `plan.update(content)`
 * - `/plan append <content>` → `read + update` do `plan.md` vanilla
 * - `/plan clear` → remove `plan.md`
 *
 * @module copilot/terminal/commands/plan
 */

import {
    deleteTerminalSdkPlanProjection,
    readTerminalSdkSessionProjection,
    setTerminalSdkModeProjection,
    updateTerminalSdkPlanProjection,
} from '../frontend/projections/sdk-session-vanilla.js';
import {
    formatTerminalTimeLabel,
    terminalThemeDivider,
    terminalThemeHeadline,
    terminalThemeRow,
    terminalThemeRows,
} from '../state/index.js';
import { callWithRuntimeTarget, extractRuntimeTarget } from './runtime-target.js';

/**
 * @param {unknown} value
 * @returns {string}
 */
function renderPlanMode(value) {
    const mode = String(value ?? '');
    if (mode === 'interactive') return 'interativo';
    if (mode === 'plan') return 'plano';
    if (mode === 'autopilot') return 'autopiloto';
    return mode.replace(/[._-]+/gu, ' ') || 'desconhecido';
}

/**
 * @param {{ previousMode?: unknown; currentMode?: unknown }} result
 * @returns {string}
 */
function renderPlanModeChange(result) {
    return `${renderPlanMode(result.previousMode)} -> ${renderPlanMode(result.currentMode)}`;
}

/**
 * @param {{ println: (text: string) => void }} ctx
 * @param {string} arg
 * @returns {Promise<void>}
 */
export async function cmdPlan({ println }, arg) {
    const { runtimeId, arg: cleanArg } = extractRuntimeTarget(arg);
    const trimmed = cleanArg.trim();
    const lower = trimmed.toLowerCase();

    if (!lower) {
        const projection = await callWithRuntimeTarget(readTerminalSdkSessionProjection, runtimeId);
        const exists = projection.plan.exists;
        const path = projection.plan.path ?? '(sem workspace)';
        const preview = projection.plan.content
            ? projection.plan.content.slice(0, 160) + (projection.plan.content.length > 160 ? '…' : '')
            : null;
        const op = projection.lastObservedPlanOperation
            ? `${projection.lastObservedPlanOperation}${projection.lastObservedPlanChangedAt ? ` @ ${formatTerminalTimeLabel(projection.lastObservedPlanChangedAt, { mode: 'dual' })}` : ''}`
            : '(sem alterações observadas)';

        println('');
        println(terminalThemeHeadline('assistant', 'Plano SDK'));
        println(terminalThemeRow('Modo SDK', renderPlanMode(projection.currentMode), { role: 'assistant' }));
        println(terminalThemeRow('plan.md', `${exists ? 'presente' : 'ausente'} · ${path}`));
        println(terminalThemeRow('Última op.', op));
        if (preview) {
            println(terminalThemeRow('Prévia', preview));
        }
        println(
            terminalThemeRows(
                'Uso',
                [
                    '/plan on · /plan off · /plan autopilot',
                    '/plan read · /plan set <txt> · /plan append <txt>',
                    '/plan clear',
                ],
                { role: 'command' },
            ),
        );
        println('');
        return;
    }

    if (lower === 'on' || lower === 'plan') {
        const result = await callWithRuntimeTarget(setTerminalSdkModeProjection, runtimeId, 'plan');
        println(terminalThemeRow('Modo SDK', renderPlanModeChange(result), { role: 'success' }));
        return;
    }

    if (lower === 'off' || lower === 'interactive') {
        const result = await callWithRuntimeTarget(setTerminalSdkModeProjection, runtimeId, 'interactive');
        println(terminalThemeRow('Modo SDK', renderPlanModeChange(result), { role: 'success' }));
        return;
    }

    if (lower === 'autopilot' || lower === 'auto') {
        const result = await callWithRuntimeTarget(setTerminalSdkModeProjection, runtimeId, 'autopilot');
        println(terminalThemeRow('Modo SDK', renderPlanModeChange(result), { role: 'success' }));
        return;
    }

    if (lower === 'read' || lower === 'show') {
        const projection = await callWithRuntimeTarget(readTerminalSdkSessionProjection, runtimeId);
        if (!projection.plan.exists || !projection.plan.content) {
            println(terminalThemeRow('plan.md', 'ausente na sessão atual', { role: 'warn' }));
            return;
        }
        println('');
        println(terminalThemeHeadline('assistant', `plan.md (${projection.plan.path ?? 'sem path'})`));
        println(terminalThemeDivider(49));
        for (const line of projection.plan.content.split('\n')) {
            println(`  ${line}`);
        }
        println(terminalThemeDivider(49));
        return;
    }

    if (lower.startsWith('set ')) {
        const content = trimmed.slice(4).trim();
        if (!content) {
            println(terminalThemeRow('Uso', '/plan set <conteúdo do plan.md>', { role: 'warn' }));
            return;
        }
        const plan = await callWithRuntimeTarget(updateTerminalSdkPlanProjection, runtimeId, content);
        println(terminalThemeRow('plan.md', `atualizado · ${plan.path ?? 'sem path'} · ${plan.exists ? 'presente' : 'ausente'}`, { role: 'success' }));
        return;
    }

    if (lower.startsWith('append ')) {
        const addition = trimmed.slice(7).trim();
        if (!addition) {
            println(terminalThemeRow('Uso', '/plan append <texto>', { role: 'warn' }));
            return;
        }
        const current = await callWithRuntimeTarget(readTerminalSdkSessionProjection, runtimeId);
        const base = current.plan.content ? `${current.plan.content.trimEnd()}\n` : '';
        const plan = await callWithRuntimeTarget(updateTerminalSdkPlanProjection, runtimeId, `${base}${addition}`);
        println(terminalThemeRow('plan.md', `expandido · ${plan.path ?? 'sem path'} · ${plan.exists ? 'presente' : 'ausente'}`, { role: 'success' }));
        return;
    }

    if (lower === 'clear' || lower === 'delete') {
        const plan = await callWithRuntimeTarget(deleteTerminalSdkPlanProjection, runtimeId);
        println(terminalThemeRow('plan.md', `removido · agora ${plan.exists ? 'presente' : 'ausente'}`, { role: 'warn' }));
        return;
    }

    println(
        terminalThemeRows(
            'Argumento',
            [
                `"${arg}" não é válido`,
                'use /plan, /plan on/off/autopilot, /plan read',
                '/plan set <txt>, /plan append <txt> ou /plan clear',
            ],
            { role: 'warn' },
        ),
    );
}
