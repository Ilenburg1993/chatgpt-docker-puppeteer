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
} from '../frontend/index.js';

/**
 * @param {{ println: (text: string) => void }} ctx
 * @param {string} arg
 * @returns {Promise<void>}
 */
export async function cmdPlan({ println }, arg) {
    const trimmed = (arg ?? '').trim();
    const lower = trimmed.toLowerCase();

    if (!lower) {
        const projection = await readTerminalSdkSessionProjection();
        const exists = projection.plan.exists;
        const path = projection.plan.path ?? '(sem workspace)';
        const preview = projection.plan.content
            ? projection.plan.content.slice(0, 160) + (projection.plan.content.length > 160 ? '…' : '')
            : null;
        const op = projection.lastObservedPlanOperation
            ? `${projection.lastObservedPlanOperation}${projection.lastObservedPlanChangedAt ? ` @ ${new Date(projection.lastObservedPlanChangedAt).toLocaleTimeString('pt-BR')}` : ''}`
            : '(sem alterações observadas)';

        println(`\x1b[36m  /plan\x1b[0m → modo SDK atual: \x1b[35m${projection.currentMode.toUpperCase()}\x1b[0m`);
        println(`\x1b[90m  plan.md: ${exists ? 'presente' : 'ausente'} · ${path}\x1b[0m`);
        println(`\x1b[90m  última operação observada: ${op}\x1b[0m`);
        if (preview) {
            println(`\x1b[90m  preview: ${preview}\x1b[0m`);
        }
        println(
            '\x1b[90m  Uso: /plan on | /plan off | /plan autopilot | /plan read | /plan set <txt> | /plan append <txt> | /plan clear\x1b[0m',
        );
        return;
    }

    if (lower === 'on' || lower === 'plan') {
        const result = await setTerminalSdkModeProjection('plan');
        println(`\x1b[32m  ✓ Modo SDK: ${result.previousMode} → ${result.currentMode}\x1b[0m`);
        return;
    }

    if (lower === 'off' || lower === 'interactive') {
        const result = await setTerminalSdkModeProjection('interactive');
        println(`\x1b[90m  Modo SDK: ${result.previousMode} → ${result.currentMode}\x1b[0m`);
        return;
    }

    if (lower === 'autopilot' || lower === 'auto') {
        const result = await setTerminalSdkModeProjection('autopilot');
        println(`\x1b[36m  Modo SDK: ${result.previousMode} → ${result.currentMode}\x1b[0m`);
        return;
    }

    if (lower === 'read' || lower === 'show') {
        const projection = await readTerminalSdkSessionProjection();
        if (!projection.plan.exists || !projection.plan.content) {
            println('\x1b[90m  plan.md ausente na sessão atual.\x1b[0m');
            return;
        }
        println(`\n\x1b[36m  plan.md (${projection.plan.path ?? 'sem path'})\x1b[0m`);
        println('  ─────────────────────────────────────────────────');
        for (const line of projection.plan.content.split('\n')) {
            println(`  ${line}`);
        }
        println('  ─────────────────────────────────────────────────');
        return;
    }

    if (lower.startsWith('set ')) {
        const content = trimmed.slice(4).trim();
        if (!content) {
            println('\x1b[33m  Uso: /plan set <conteúdo do plan.md>\x1b[0m');
            return;
        }
        const plan = await updateTerminalSdkPlanProjection(content);
        println(
            `\x1b[32m  plan.md atualizado (${plan.path ?? 'sem path'}). Existe? ${plan.exists ? 'sim' : 'não'}\x1b[0m`,
        );
        return;
    }

    if (lower.startsWith('append ')) {
        const addition = trimmed.slice(7).trim();
        if (!addition) {
            println('\x1b[33m  Uso: /plan append <texto>\x1b[0m');
            return;
        }
        const current = await readTerminalSdkSessionProjection();
        const base = current.plan.content ? `${current.plan.content.trimEnd()}\n` : '';
        const plan = await updateTerminalSdkPlanProjection(`${base}${addition}`);
        println(
            `\x1b[32m  plan.md expandido (${plan.path ?? 'sem path'}). Existe? ${plan.exists ? 'sim' : 'não'}\x1b[0m`,
        );
        return;
    }

    if (lower === 'clear' || lower === 'delete') {
        const plan = await deleteTerminalSdkPlanProjection();
        println(`\x1b[33m  plan.md removido. Existe agora? ${plan.exists ? 'sim' : 'não'}\x1b[0m`);
        return;
    }

    println(
        `\x1b[33m  Argumento inválido: "${arg}". Use /plan, /plan on, /plan off, /plan autopilot, /plan read, /plan set <txt>, /plan append <txt> ou /plan clear.\x1b[0m`,
    );
}
