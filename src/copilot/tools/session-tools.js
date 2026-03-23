// @ts-check
/**
 * src/copilot/tools/session-tools.js
 *
 * Custom Tools para leitura e atualização do estado da sessão (hook system).
 *
 * @module copilot/tools/session-tools
 */

import { log } from '#core/logger';
import { defineTool } from '@github/copilot-sdk';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';

/**
 * Marca uma tool como skip-permission (SDK v0.2.0+). Forward-compat: campo ignorado silenciosamente em SDK v0.1.x.
 *
 * @template {import('@github/copilot-sdk').Tool<any>} T
 * @param {T} tool
 * @returns {T}
 */
const withSkipPermission = (tool) => Object.assign(tool, /** @type {any} */ ({ skipPermission: true }));

const ROOT = resolve(new URL('../..', import.meta.url).pathname, '..');
const HOOKS_STATE = join(ROOT, '.github', 'hooks', 'state');

/**
 * Tool: read_briefing — lê o briefing da sessão Hook System.
 */
const readBriefingTool = defineTool('read_briefing', {
    description:
        'Lê o briefing de sessão atual do Hook System (session-briefing.md). Contém estado, close_key e tarefas.',
    parameters: z.object({}),
    handler: async () => {
        const p = join(HOOKS_STATE, 'session-briefing.md');
        if (!existsSync(p)) return { content: null, message: 'Briefing não encontrado.' };
        return { content: readFileSync(p, 'utf8') };
    },
});

/**
 * Tool: write_pending_task — adiciona uma tarefa pendente ao pending-tasks.md.
 */
const writePendingTaskTool = defineTool('write_pending_task', {
    description: 'Adiciona uma tarefa pendente ao arquivo pending-tasks.md do Hook System.',
    parameters: /** @type {import('@github/copilot-sdk').ZodSchema<any>} */ (
        /** @type {unknown} */ (
            z.object({
                title: z.string().describe('Título da tarefa pendente'),
                description: z.string().optional().describe('Descrição detalhada'),
                priority: z.enum(['high', 'medium', 'low']).optional().default('medium'),
            })
        )
    ),
    handler: async (
        /** @type {{ title: string; description?: string; priority?: string }} */ { title, description, priority },
    ) => {
        try {
            mkdirSync(HOOKS_STATE, { recursive: true });
            const p = join(HOOKS_STATE, 'pending-tasks.md');
            const existing = existsSync(p) ? readFileSync(p, 'utf8') : '# Tarefas Pendentes\n\n';
            const entry = `\n## [${(priority ?? 'medium').toUpperCase()}] ${title}\n${description ? `\n${description}\n` : ''}_Adicionado pelo SDK Agent em ${new Date().toISOString()}_\n`;
            writeFileSync(p, existing + entry, 'utf8');
            log('INFO', `[copilot/write_pending_task] Tarefa adicionada: ${title}`);
            return { success: true, title };
        } catch (/** @type {any} */ e) {
            return { success: false, error: e.message };
        }
    },
});

/**
 * @type {import('@github/copilot-sdk').Tool[]}
 */
export const sessionTools = [withSkipPermission(readBriefingTool), writePendingTaskTool];
