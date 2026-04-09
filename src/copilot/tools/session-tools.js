// @ts-check
/**
 * src/copilot/tools/session-tools.js
 *
 * Custom Tools para leitura e atualização do estado da sessão (hook system).
 *
 * @module copilot/tools/session-tools
 * @see module:copilot/lib/session
 * @see module:copilot/always-alive
 */

import { log } from '#copilot/observability/logger';
import { defineTool } from '@github/copilot-sdk';
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { withSkipPermission } from './tool-factory.js';

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
        try {
            const content = await readFile(p, 'utf8');
            return { content };
        } catch {
            return { content: null, message: 'Briefing não encontrado.' };
        }
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
            await mkdir(HOOKS_STATE, { recursive: true });
            const p = join(HOOKS_STATE, 'pending-tasks.md');
            let existing = '# Tarefas Pendentes\n\n';
            try {
                existing = await readFile(p, 'utf8');
            } catch {
                /* file may not exist yet */
            }
            const entry = `\n## [${(priority ?? 'medium').toUpperCase()}] ${title}\n${description ? `\n${description}\n` : ''}_Adicionado pelo SDK Agent em ${new Date().toISOString()}_\n`;
            await writeFile(p, existing + entry, 'utf8');
            log('INFO', `[copilot/write_pending_task] Tarefa adicionada: ${title}`);
            return { success: true, title };
        } catch (/** @type {any} */ e) {
            return { success: false, error: e.message };
        }
    },
});

/**
 * Tool: get_workspace_info — retorna informações contextuais do workspace.
 */
const getWorkspaceInfoTool = defineTool('get_workspace_info', {
    description:
        'Retorna informações do workspace atual: diretório de trabalho, branch git, Node version, status básico.',
    parameters: z.object({}),
    handler: async () => {
        const cwd = ROOT;
        const nodeVersion = process.version;
        const platform = process.platform;

        let gitBranch = null;
        let gitRoot = null;
        let gitCommit = null;
        try {
            gitBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8', timeout: 5000 }).trim();
            gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', timeout: 5000 }).trim();
            gitCommit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd, encoding: 'utf8', timeout: 5000 }).trim();
        } catch {
            // not a git repo or git not available
        }

        return {
            cwd,
            nodeVersion,
            platform,
            git: gitRoot ? { branch: gitBranch, commit: gitCommit, root: gitRoot } : null,
        };
    },
});

/**
 * Cache de contexto de sessão em memória.
 *
 * **Efêmero por design**: os dados são perdidos quando o processo é reiniciado. Use apenas para contexto temporário
 * intra-sessão. Para persistência, utilize `conversation-hub/store.js` (SQLite).
 *
 * @type {Map<string, unknown>}
 */
const SESSION_CONTEXT_STORE = new Map();

/**
 * Tool: set_session_context — armazena contexto em memória de sessão.
 */
const setSessionContextTool = defineTool('set_session_context', {
    description:
        'Armazena um valor de contexto em memória de sessão (chave/valor). Use para preservar informações entre turnos.',
    parameters: /** @type {import('@github/copilot-sdk').ZodSchema<any>} */ (
        /** @type {unknown} */ (
            z.object({
                key: z.string().describe('Chave de contexto (ex: "current_task", "user_goal")'),
                value: z.string().describe('Valor a armazenar (string)'),
            })
        )
    ),
    handler: async (/** @type {{ key: string; value: string }} */ { key, value }) => {
        SESSION_CONTEXT_STORE.set(key, value);
        log('INFO', `[copilot/set_session_context] key='${key}' armazenado (${SESSION_CONTEXT_STORE.size} entradas)`);
        return { success: true, key, stored: SESSION_CONTEXT_STORE.size };
    },
});

/**
 * Tool: invoke_skill — carrega e retorna o conteúdo de uma skill pelo nome. Análogo ao built-in `skill` do GitHub
 * Copilot CLI. Permite ao agente injetar o conteúdo de uma skill como contexto adicional no turn atual.
 */
const invokeSkillTool = defineTool('invoke_skill', {
    description:
        'Carrega o conteúdo de uma skill pelo nome e retorna seu conteúdo completo como contexto. ' +
        'Use quando precisar de instruções especializadas de uma skill (ex: "code-audit", "jsdoc-authoring"). ' +
        'Lista skills disponíveis se chamado sem parâmetro `name`.',
    parameters: /** @type {import('@github/copilot-sdk').ZodSchema<{ name?: string }>} */ (
        /** @type {unknown} */ (
            z.object({
                name: z.string().optional().describe('Nome da skill a carregar (slug do diretório em .github/skills/)'),
            })
        )
    ),
    handler: async (/** @type {{ name?: string }} */ { name }) => {
        const skillsDir = resolve(join(process.cwd(), '.github', 'skills'));
        try {
            await stat(skillsDir);
        } catch {
            return { error: 'Diretório .github/skills/ não encontrado.' };
        }

        const entries = await readdir(skillsDir, { withFileTypes: true });
        const available = entries
            .filter((d) => d.isDirectory())
            .map((d) => d.name)
            .sort();

        if (!name) {
            return { available };
        }

        const skillPath = join(skillsDir, name, 'SKILL.md');
        let content;
        try {
            content = await readFile(skillPath, 'utf-8');
        } catch {
            return { error: `Skill '${name}' não encontrada.`, available };
        }

        log('INFO', `[copilot/invoke_skill] skill='${name}' carregada (${content.length} bytes)`);
        return { name, content };
    },
});

/**
 * @type {import('@github/copilot-sdk').Tool[]}
 */
export const sessionTools = [
    withSkipPermission(readBriefingTool),
    writePendingTaskTool,
    withSkipPermission(getWorkspaceInfoTool),
    setSessionContextTool,
    withSkipPermission(invokeSkillTool),
];
