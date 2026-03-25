// @ts-check
/**
 * src/copilot/agent/session-manager.js
 *
 * Gerenciador de sessão persistente para o Always-Alive Agent. Preserva o sessionId em disco e retoma sessões após
 * reinicializações (PM2/reboot).
 *
 * @module copilot/session-manager
 */

import { buildHookContextAppendMessage } from '#copilot/config/system-prompt';
import { resumeOrCreate } from '#copilot/lib/session';
import { log } from '#core/logger';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const BRIEFING_FILE = join(resolve(import.meta.dirname, '../../'), '.github', 'hooks', 'state', 'session-briefing.md');
const SESSION_JSON_FILE = join(resolve(import.meta.dirname, '../../'), '.github', 'hooks', 'state', 'session.json');

/**
 * Lê o session-briefing.md e session.json e constrói o conteúdo de systemMessage para injetar o contexto do hook system
 * em sessões SDK.
 *
 * @returns {string} Conteúdo markdown com contexto operacional do hook system
 */
export function buildHookSystemContext() {
    const parts = [];

    if (existsSync(BRIEFING_FILE)) {
        parts.push('## Contexto da Sessão (Hook System)\n\n' + readFileSync(BRIEFING_FILE, 'utf8'));
    }

    if (existsSync(SESSION_JSON_FILE)) {
        try {
            const state = JSON.parse(readFileSync(SESSION_JSON_FILE, 'utf8'));
            const consecutive = state?.compliance?.consecutive_unauthorized ?? 0;
            const turnNum = state?.current_turn?.number ?? 0;
            const closeKey = state?.close_key ?? 'N/A';
            const strictClose = state?.strict_turn_close ?? true;
            parts.push(
                [
                    '\n## Estado de Compliance Atual',
                    `- Turno atual: #${turnNum}`,
                    `- Consecutivos sem vscode_askQuestions: ${consecutive}`,
                    `- close_key: \`${closeKey}\``,
                    `- strict_turn_close: ${strictClose}`,
                    '',
                    '**Protocolo obrigatório**: Encerre cada turno com `vscode_askQuestions`.',
                    'Não inicie task_complete sem chamar vscode_askQuestions antes.',
                ].join('\n'),
            );
        } catch {
            // session.json inválido — ignorar silenciosamente
        }
    }

    return parts.join('\n\n');
}

const ROOT = resolve(import.meta.dirname, '../../');
const STATE_DIR = join(ROOT, '.github', 'hooks', 'state');
const STATE_FILE = join(STATE_DIR, 'sdk-always-alive.json');

/**
 * @typedef {import('@github/copilot-sdk').CopilotClient} CopilotClient
 *
 * @typedef {import('@github/copilot-sdk').CopilotSession} CopilotSession
 */

/**
 * @typedef {Object} AliveAgentState
 * @property {string} sessionId - ID da sessão ativa
 * @property {number} startedAt - Timestamp de criação da sessão (ms)
 * @property {number} resumedAt - Timestamp da última retomada (ms)
 * @property {number} resumeCount - Quantas vezes a sessão foi retomada
 * @property {number} sendCount - Total de mensagens enviadas (tracked externamente)
 * @property {string} model - Modelo configurado para esta sessão
 * @property {string | null} pendingQuestion - Pergunta pendente do modelo (se houver)
 */

/**
 * Lê o estado persistido do agente da sessão em disco.
 *
 * @returns {AliveAgentState | null} Estado persistido ou null se não existir
 */
export function readState() {
    if (!existsSync(STATE_FILE)) return null;
    try {
        return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    } catch (/** @type {any} */ e) {
        log('WARN', `[PersistentSession] Falha ao ler estado: ${e.message}`);
        return null;
    }
}

/**
 * Persiste o estado da sessão em disco.
 *
 * @param {Partial<AliveAgentState>} updates - Campos a atualizar no estado
 * @returns {AliveAgentState} Estado completo após a atualização
 */
export function writeState(updates) {
    mkdirSync(STATE_DIR, { recursive: true });
    const current = readState() ?? {
        sessionId: '',
        startedAt: Date.now(),
        resumedAt: Date.now(),
        resumeCount: 0,
        sendCount: 0,
        model: 'gpt-4.1',
        pendingQuestion: null,
    };
    const next = /** @type {AliveAgentState} */ ({ ...current, ...updates });
    writeFileSync(STATE_FILE, JSON.stringify(next, null, 4), 'utf8');
    return next;
}

/**
 * Remove o estado persistido. Usado para forçar uma nova sessão.
 */
export function clearState() {
    if (existsSync(STATE_FILE)) {
        rmSync(STATE_FILE);
        log('INFO', '[PersistentSession] Estado removido — próxima inicialização criará nova sessão.');
    }
}

/**
 * Inicializa ou retoma uma sessão Copilot SDK de forma persistente.
 *
 * Fluxo:
 *
 * 1. Lê o sessionId em disco.
 * 2. Se existir → tenta `resumeSession()`.
 * 3. Se não existir ou der erro → cria nova sessão e persiste o ID.
 *
 * Sempre injeta o contexto do hook system (session-briefing.md + session.json) como `systemMessage.sections.guidelines`
 * para que o agente SDK herde o protocolo operacional da sessão principal do VS Code Copilot.
 *
 * @param {CopilotClient} client - Instância do CopilotClient
 * @param {object} sessionOptions - Opções para createSession/resumeSession
 * @param {string} [sessionOptions.model] - Modelo a usar (default: 'gpt-4.1')
 * @param {import('@github/copilot-sdk').PermissionHandler} [sessionOptions.onPermissionRequest]
 * @param {Function} [sessionOptions.onUserInputRequest]
 * @param {object} [sessionOptions.hooks]
 * @param {import('@github/copilot-sdk').Tool[]} [sessionOptions.tools] - Custom Tools a registrar na sessão
 * @param {boolean} [sessionOptions.injectHookContext] - Injetar contexto do hook system (default: true)
 * @param {Record<string, unknown>} [sessionOptions.mcpServers] - Configurações de servidores MCP nativos
 * @returns {Promise<{ session: CopilotSession; isResumed: boolean }>}
 */
export async function initOrResumeSession(client, sessionOptions) {
    const state = readState();
    const model = sessionOptions.model ?? 'gpt-4.1';
    const injectContext = sessionOptions.injectHookContext !== false;

    /** @type {import('@github/copilot-sdk').SystemMessageConfig | undefined} */
    const systemMessage = injectContext ? buildHookContextAppendMessage(buildHookSystemContext()) : undefined;

    /** @type {any} */
    const opts = {
        model,
        streaming: true,
        infiniteSessions: { enabled: true, backgroundCompactionThreshold: 0.75 },
        ...(sessionOptions.onPermissionRequest !== undefined
            ? { onPermissionRequest: sessionOptions.onPermissionRequest }
            : {}),
        ...(sessionOptions.onUserInputRequest !== undefined
            ? { onUserInputRequest: sessionOptions.onUserInputRequest }
            : {}),
        ...(sessionOptions.hooks !== undefined ? { hooks: sessionOptions.hooks } : {}),
        ...(sessionOptions.tools !== undefined ? { tools: sessionOptions.tools } : {}),
        ...(sessionOptions.mcpServers !== undefined ? { mcpServers: sessionOptions.mcpServers } : {}),
        ...(systemMessage !== undefined ? { systemMessage } : {}),
    };

    // Delega para lib/session.resumeOrCreate — tenta retomar, cria se falhar
    const result = await resumeOrCreate(client, state?.sessionId ?? null, opts);

    if (result.isResumed) {
        writeState({
            resumedAt: Date.now(),
            resumeCount: (state?.resumeCount ?? 0) + 1,
        });
        log('INFO', `[PersistentSession] Sessão retomada com sucesso (retomada #${(state?.resumeCount ?? 0) + 1}).`);
    } else {
        writeState({
            sessionId: result.sessionId,
            startedAt: Date.now(),
            resumedAt: Date.now(),
            resumeCount: 0,
            sendCount: 0,
            model,
            pendingQuestion: null,
        });
        log('INFO', `[PersistentSession] Nova sessão criada: ${result.sessionId}`);
    }

    return { session: result.session, isResumed: result.isResumed };
}
