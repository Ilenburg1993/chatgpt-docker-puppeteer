// @ts-check
import { readBootSkillConfig, resolveHooksStateDir, resolveWorkspacePath } from '#copilot/boot';
import { getApplicationWorkspaceInfra } from '#copilot/boot/application-infra';
import { logSwallowed, toError } from '#copilot/core';
import { readConfiguredSkillCatalog } from '#copilot/infra/public/filesystem/skills';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { z } from 'zod';
import { log } from '../infra/logger.js';
import { buildTool, withSkipPermission } from '../infra/tool-factory.js';
/**
 * src/copilot/tools/session/session-tools.js
 *
 * Custom Tools para leitura e atualização do estado da sessão (hook system).
 *
 * @module copilot/tools/session/session-tools
 * @see EventBus
 * @see module:copilot/lib/session
 * @see module:copilot/always-alive
 */

const HOOKS_STATE = resolveHooksStateDir();
const { createOrReplaceFileAtomic, mkdirPathLocked, readText } =
    getApplicationWorkspaceInfra(resolveWorkspacePath()).io;
const GIT_INFO_TIMEOUT_MS = 8_000;
const GIT_INFO_MAX_BUFFER = 8 * 1024 * 1024;

/**
 * Tool: read_briefing — lê o briefing da sessão Hook System.
 */
const readBriefingTool = buildTool({
    name: 'read_briefing',
    description:
        'Lê o briefing de sessão atual do Hook System (session-briefing.md). Contém estado, close_key e tarefas.',
    parameters: z.object({}),
    handler: async () => {
        const p = join(HOOKS_STATE, 'session-briefing.md');
        try {
            const result = await readText(p);
            return { content: result.content, io: result.io };
        } catch {
            return { content: null, message: 'Briefing não encontrado.' };
        }
    },
});

/**
 * Tool: write_pending_task — adiciona uma tarefa pendente ao pending-tasks.md.
 */
const writePendingTaskTool = buildTool({
    name: 'write_pending_task',
    description: 'Adiciona uma tarefa pendente ao arquivo pending-tasks.md do Hook System.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<any>} */ (
        /** @type {unknown} */ (
            z.object({
                title: z.string()['describe']('Título da tarefa pendente'),
                description: z.string().optional()['describe']('Descrição detalhada'),
                priority: z.enum(['high', 'medium', 'low']).optional().default('medium'),
            })
        )
    ),
    handler: async (
        /** @type {{ title: string; description?: string; priority?: string }} */ { title, description, priority },
    ) => {
        try {
            await mkdirPathLocked(HOOKS_STATE, { recursive: true });
            const p = join(HOOKS_STATE, 'pending-tasks.md');
            let existing = '# Tarefas Pendentes\n\n';
            try {
                existing = (await readText(p)).content;
            } catch (e) {
                logSwallowed(e, 'session-tools.readPendingTasks');
            }
            const entry = `\n## [${(priority ?? 'medium').toUpperCase()}] ${title}\n${description ? `\n${description}\n` : ''}_Adicionado pelo SDK Agent em ${new Date().toISOString()}_\n`;
            const writeResult = await createOrReplaceFileAtomic(p, existing + entry);
            log('INFO', `[copilot/write_pending_task] Tarefa adicionada: ${title}`);
            return { success: true, title, io: writeResult.io };
        } catch (e) {
            return { success: false, error: toError(e).message };
        }
    },
});

/**
 * Tool: get_workspace_info — retorna informações contextuais do workspace.
 */
const getWorkspaceInfoTool = buildTool({
    name: 'get_workspace_info',
    description:
        'Retorna informações do workspace atual: diretório de trabalho, branch git, Node version, status básico.',
    parameters: z.object({}),
    handler: async () => {
        const cwd = resolveWorkspacePath();
        const nodeVersion = process.version;
        const platform = process.platform;

        let gitBranch = null;
        let gitRoot = null;
        let gitCommit = null;
        try {
            gitBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
                cwd,
                encoding: 'utf8',
                maxBuffer: GIT_INFO_MAX_BUFFER,
                timeout: GIT_INFO_TIMEOUT_MS,
            }).trim();
            gitRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
                cwd,
                encoding: 'utf8',
                maxBuffer: GIT_INFO_MAX_BUFFER,
                timeout: GIT_INFO_TIMEOUT_MS,
            }).trim();
            gitCommit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
                cwd,
                encoding: 'utf8',
                maxBuffer: GIT_INFO_MAX_BUFFER,
                timeout: GIT_INFO_TIMEOUT_MS,
            }).trim();
        } catch (e) {
            logSwallowed(e, 'session-tools.gitInfo');
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
const setSessionContextTool = buildTool({
    name: 'set_session_context',
    description:
        'Armazena um valor de contexto em memória de sessão (chave/valor). Use para preservar informações entre turnos.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<any>} */ (
        /** @type {unknown} */ (
            z.object({
                key: z.string()['describe']('Chave de contexto (ex: "current_task", "user_goal")'),
                value: z.string()['describe']('Valor a armazenar (string)'),
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
const invokeSkillTool = buildTool({
    name: 'invoke_skill',
    description:
        'Carrega o conteúdo de uma skill pelo nome e retorna seu conteúdo completo como contexto. ' +
        'Use quando precisar de instruções especializadas de uma skill (ex: "code-audit", "jsdoc-authoring"). ' +
        'Lista skills disponíveis se chamado sem parâmetro `name`.',
    parameters: /** @type {import('#copilot/sdk/types').ZodSchema<{ name?: string }>} */ (
        /** @type {unknown} */ (
            z.object({
                name: z
                    .string()
                    .optional()
                    ['describe']('Nome da skill a carregar (slug de um diretório de skills configurado)'),
            })
        )
    ),
    handler: async (/** @type {{ name?: string }} */ { name }) => {
        const bootSkills = readBootSkillConfig();
        const catalog = await readConfiguredSkillCatalog({
            skillDirectories: bootSkills.skillDirectories,
            disabledSkills: bootSkills.disabledSkills,
            ...(name ? { requestedName: name } : {}),
        });
        if (catalog.readableDirectoryCount === 0) {
            return { error: 'Nenhum diretório de skills configurado está disponível.' };
        }
        const available = catalog.names;
        if (!name) return { available };
        if (!catalog.selected) return { error: `Skill '${name}' não encontrada.`, available };

        const content = catalog.selected.content;
        log('INFO', `[copilot/invoke_skill] skill='${name}' carregada (${content.length} bytes)`);
        return { name, content };
    },
});

/**
 * @type {import('#copilot/sdk/types').Tool<any>[]}
 */
export const sessionTools = [
    withSkipPermission(readBriefingTool),
    writePendingTaskTool,
    withSkipPermission(getWorkspaceInfoTool),
    setSessionContextTool,
    withSkipPermission(invokeSkillTool),
];
