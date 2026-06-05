// @ts-check
/**
 * @module copilot/terminal/terminal-phases/boot-pinned
 * @file Fase de boot: PinnedFiles.
 *
 *   Carrega arquivos de contexto pinados (skills, instruções) e registra o bridge de eventos para hot-reload durante a
 *   sessão.
 */

import { bridgeEmitter, EVENT_BUS } from '#copilot/core';
import { CONFIG_PINNED_FILES_CHANGED } from '#copilot/events';
import { log } from '#copilot/observability';
import { PinnedFilesLoader } from '../../config/pinned-files.js';
import { container } from '../../core/di-container.js';
import { broadcastSse } from '../dialog/index.js';
import { recordTerminalActivity, terminalActivityEmitter } from '../state/boot/index.js';

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
 * @param {import('../runtime-root.js').TerminalBootContext} ctx
 * @returns {Promise<void>}
 */
export async function runTerminalPinnedContextPhase(ctx) {
    const pinnedLoader = new PinnedFilesLoader(ctx.bootConfig.skills.pinnedContextDirectories);
    ctx.pinnedLoader = pinnedLoader;
    recordTerminalActivity('boot', 'Carregando arquivos pinados', { source: 'terminal', recordHistory: false });
    await pinnedLoader.start().catch((e) => {
        recordTerminalActivity('system', 'Pinned files indisponíveis', {
            detail: e.message,
            severity: 'warn',
            source: 'terminal',
        });
        log('WARN', `[TerminalServer] PinnedFilesLoader não pôde iniciar: ${e.message}`);
    });

    const pinnedBus = container.resolve(EVENT_BUS);
    ctx.disposePinnedBridge = pinnedBus
        ? bridgeEmitter(pinnedLoader, pinnedBus, { changed: CONFIG_PINNED_FILES_CHANGED })
        : null;

    ctx.pinnedFilesChangedHandler = (/** @type {{ file: string; type: string }} */ evt) => {
        const updatedAt = new Date().toISOString();
        const fileCount = pinnedLoader.getFiles().length;
        log(
            'WARN',
            `[TerminalServer] Skills/instruções atualizadas — hot-reload ativo (${countLabel(fileCount, 'arquivo', 'arquivos')}, trigger: ${evt?.file ?? 'unknown'})`,
        );
        broadcastSse('skills.reloaded', {
            updatedAt,
            source: 'terminal-boot/skills.reloaded',
            fileCount,
            trigger: evt?.file ?? null,
            type: evt?.type ?? 'change',
            note: 'Context refreshed. Next session turn will use updated skills/instructions.',
        });
    };
    pinnedLoader.on('changed', ctx.pinnedFilesChangedHandler);

    ctx.activityChangedHandler = (current, previous) => {
        broadcastSse('activity.changed', {
            current,
            previous: previous ?? null,
            timestamp: Date.now(),
            source: 'terminal-boot/activity.changed',
        });
    };
    terminalActivityEmitter.on('activity:changed', ctx.activityChangedHandler);
}

/**
 * Rollback/cleanup do PinnedFilesLoader. Seguro para chamar em qualquer fase (shutdown ou falha de boot).
 *
 * @param {import('../runtime-root.js').TerminalBootContext} ctx
 * @returns {Promise<void>}
 */
export async function rollbackTerminalPinnedContextPhase(ctx) {
    const pinnedLoader = ctx.pinnedLoader;
    ctx.disposePinnedBridge?.();
    ctx.disposePinnedBridge = null;
    if (ctx.activityChangedHandler) {
        terminalActivityEmitter.off('activity:changed', ctx.activityChangedHandler);
        ctx.activityChangedHandler = null;
    }
    if (pinnedLoader && ctx.pinnedFilesChangedHandler) {
        if (typeof pinnedLoader.off === 'function') {
            pinnedLoader.off('changed', ctx.pinnedFilesChangedHandler);
        } else {
            pinnedLoader.removeListener('changed', ctx.pinnedFilesChangedHandler);
        }
        ctx.pinnedFilesChangedHandler = null;
    }
    if (pinnedLoader && typeof pinnedLoader.stop === 'function') {
        await Promise.resolve(pinnedLoader.stop());
    }
    ctx.pinnedLoader = null;
}
