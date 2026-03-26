// @ts-check
/**
 * src/copilot/tools/task-tools.js
 *
 * Custom Tools para gerenciamento de tarefas do sistema. Permite ao agente criar, consultar e atualizar tarefas via
 * infra SQLite existente.
 *
 * @module copilot/tools/task-tools
 */

import { log } from '#core/logger';
import { defineTool } from '@github/copilot-sdk';
import http from 'node:http';
import { z } from 'zod';

/**
 * Realiza uma requisição HTTP local sem bloquear o event loop.
 *
 * @param {string} method
 * @param {string} urlStr
 * @param {string | null} body
 * @param {number} [timeoutMs]
 * @returns {Promise<string>}
 */
function httpRequest(method, urlStr, body = null, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlStr);
        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method,
            headers: /** @type {Record<string, string>} */ ({}),
        };
        if (body) {
            options.headers['Content-Type'] = 'application/json';
            options.headers['Content-Length'] = String(Buffer.byteLength(body));
        }
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => resolve(data));
        });
        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error(`Timeout após ${timeoutMs}ms`));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

/**
 * Marca uma tool como skip-permission (SDK v0.2.0+). Forward-compat: campo ignorado silenciosamente em SDK v0.1.x.
 *
 * @template {import('@github/copilot-sdk').Tool<any>} T
 * @param {T} tool
 * @returns {T}
 */
const withSkipPermission = (tool) => Object.assign(tool, /** @type {any} */ ({ skipPermission: true }));

/**
 * Tool: get_tasks — lista tarefas recentes do sistema.
 */
const getTasksTool = defineTool('get_tasks', {
    description: 'Lista as tarefas mais recentes do sistema. Use para verificar estado atual da fila.',
    parameters: /** @type {import('@github/copilot-sdk').ZodSchema<any>} */ (
        /** @type {unknown} */ (
            z.object({
                status: z.string().optional().describe('Filtrar por status (pending, running, done, failed)'),
                limit: z
                    .number()
                    .int()
                    .min(1)
                    .max(50)
                    .optional()
                    .default(10)
                    .describe('Número máximo de tarefas a retornar'),
            })
        )
    ),
    handler: async (/** @type {{ status?: string; limit?: number }} */ { status, limit }) => {
        try {
            const port = process.env.PORT ?? '3008';
            const url = `http://127.0.0.1:${port}/api/tasks?limit=${limit ?? 10}${status ? `&status=${status}` : ''}`;
            const result = await httpRequest('GET', url);
            const data = JSON.parse(result);
            return {
                tasks: data?.data?.tasks ?? data?.tasks ?? [],
                total: data?.data?.total ?? data?.total ?? 0,
            };
        } catch (/** @type {any} */ e) {
            log('WARN', `[copilot/get_tasks] Falha ao consultar tarefas: ${e.message}`);
            return { tasks: [], total: 0, error: e.message };
        }
    },
});

/**
 * Tool: add_task — enfileira uma nova tarefa no sistema.
 */
const addTaskTool = defineTool('add_task', {
    description: 'Cria e enfileira uma nova tarefa no sistema de missões. A tarefa será executada pelo kernel.',
    parameters: /** @type {import('@github/copilot-sdk').ZodSchema<any>} */ (
        /** @type {unknown} */ (
            z.object({
                target: z.string().describe('URL ou identificador do alvo da tarefa'),
                user_message: z.string().describe('Instrução da tarefa (o que o agente deve fazer)'),
                priority: z
                    .number()
                    .int()
                    .min(0)
                    .max(100)
                    .optional()
                    .default(50)
                    .describe('Prioridade (0=baixa, 100=urgente)'),
                model: z.string().optional().describe('Modelo a usar nesta tarefa (ex: gpt-4.1)'),
            })
        )
    ),
    handler: async (
        /** @type {{ target: string; user_message: string; priority?: number; model?: string }} */ {
            target,
            user_message,
            priority,
            model,
        },
    ) => {
        try {
            const port = process.env.PORT ?? '3008';
            const body = JSON.stringify({ target, spec_user_message: user_message, priority: priority ?? 50, model });
            const result = await httpRequest('POST', `http://127.0.0.1:${port}/api/tasks`, body);
            const data = JSON.parse(result);
            log('INFO', `[copilot/add_task] Tarefa criada: ${data?.data?.id ?? JSON.stringify(data)}`);
            return { success: true, task: data?.data ?? data };
        } catch (/** @type {any} */ e) {
            log('WARN', `[copilot/add_task] Falha ao criar tarefa: ${e.message}`);
            return { success: false, error: e.message };
        }
    },
});

/**
 * Tool: get_session_state — lê o estado da sessão do hook system.
 */
const getSessionStateTool = defineTool('get_session_state', {
    description: 'Lê o estado da sessão atual do hook system (briefing, tarefas pendentes).',
    parameters: z.object({}),
    handler: async () => {
        try {
            const { readFileSync, existsSync } = await import('node:fs');
            const { join, resolve } = await import('node:path');
            const { fileURLToPath } = await import('node:url');
            const ROOT = resolve(fileURLToPath(import.meta.url), '../../../../');
            const stateDir = join(ROOT, '.github', 'hooks', 'state');
            const files = ['session-briefing.md', 'pending-tasks.md', 'session.json'];
            /** @type {Record<string, string>} */
            const result = {};
            for (const file of files) {
                const p = join(stateDir, file);
                if (existsSync(p)) result[file] = readFileSync(p, 'utf8');
            }
            return result;
        } catch (/** @type {any} */ e) {
            return { error: e.message };
        }
    },
});

/**
 * Tool: get_system_health — verifica saúde geral do sistema.
 */
const getSystemHealthTool = defineTool('get_system_health', {
    description: 'Verifica a saúde dos serviços principais (API, Chrome, Queue).',
    parameters: z.object({}),
    handler: async () => {
        try {
            const port = process.env.PORT ?? '3008';
            const result = await httpRequest('GET', `http://127.0.0.1:${port}/api/health`);
            return JSON.parse(result);
        } catch (/** @type {any} */ e) {
            return { healthy: false, error: e.message };
        }
    },
});

/**
 * @type {import('@github/copilot-sdk').Tool[]}
 */
export const taskTools = [
    withSkipPermission(getTasksTool),
    addTaskTool,
    withSkipPermission(getSessionStateTool),
    withSkipPermission(getSystemHealthTool),
];
