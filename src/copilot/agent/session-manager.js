// @ts-check
/**
 * src/copilot/agent/session-manager.js
 *
 * Gerenciador de sessão persistente para o Always-Alive Agent. Preserva o sessionId em disco e retoma sessões após
 * reinicializações (PM2/reboot).
 *
 * @module copilot/session-manager
 */

import { DEFAULT_EXCLUDED_TOOLS } from '#copilot/config/session-config';
import { buildHookContextAppendMessage } from '#copilot/config/system-prompt';
import { getToolsConfig, loadToolsConfig } from '#copilot/config/tools/state';
import { resumeOrCreate } from '#copilot/lib/session';
import { log } from '#core/logger';
import { approveAll } from '@github/copilot-sdk';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildCustomAgentsConfig } from '../config/custom-agents.js';

// AI.1: carregar configuração de tools persistida ao iniciar o módulo
loadToolsConfig();

const BRIEFING_FILE = join(resolve(import.meta.dirname, '../../'), '.github', 'hooks', 'state', 'session-briefing.md');
const SESSION_JSON_FILE = join(resolve(import.meta.dirname, '../../'), '.github', 'hooks', 'state', 'session.json');

// AH.3: JSONL de auditoria de ferramentas (na raiz do projeto, diretório logs/)
const TOOL_AUDIT_LOG = join(resolve(import.meta.dirname, '../../..'), 'logs', 'tool-audit.jsonl');

/**
 * AH.6 — Retorna true se a tool é considerada de alto risco. High-risk tools são aprovadas mas logadas explicitamente
 * para auditoria.
 *
 * @param {string} toolName
 * @returns {boolean}
 */
function isHighRiskTool(toolName) {
    return ['bash', 'edit', 'create', 'git_apply_patch'].includes(toolName);
}

/**
 * AH.3 — Registra uma decisão de permissão de ferramenta no JSONL de auditoria.
 *
 * ARCH-01: este log registra decisões de permissão (approve/deny) de hooks, distinto do
 * `channel/audit.js` que registra tool calls SDK (start/complete com durationMs). São
 * complementares; ambos escrevem no mesmo arquivo `logs/tool-audit.jsonl`.
 *
 * @param {{ tool: string; decision: 'approved' | 'denied'; highRisk: boolean }} entry
 * @returns {void}
 */
function logToolAudit(entry) {
    try {
        mkdirSync(join(TOOL_AUDIT_LOG, '..'), { recursive: true });
        // SEC-V03 fix: rotacionar arquivo ao atingir 10 MB
        const ROTATE_LOG = TOOL_AUDIT_LOG + '.1';
        const MAX_BYTES = 10 * 1024 * 1024;
        if (existsSync(TOOL_AUDIT_LOG)) {
            const size = statSync(TOOL_AUDIT_LOG).size;
            if (size >= MAX_BYTES) renameSync(TOOL_AUDIT_LOG, ROTATE_LOG);
        }
        const line = JSON.stringify({ ...entry, ts: new Date().toISOString() }) + '\n';
        appendFileSync(TOOL_AUDIT_LOG, line, 'utf8');
    } catch {
        // log de auditoria não deve travar a sessão
    }
}

// AC.1: threshold dinâmico de compaction — configurável via PUT /config/infinite-session
let _backgroundCompactionThreshold = 0.75;

/**
 * Atualiza o threshold de compaction. Aplicado na próxima sessão criada/retomada.
 *
 * @param {number} threshold - Valor entre 0.1 e 1.0
 * @returns {void}
 */
export function setBackgroundCompactionThreshold(threshold) {
    if (typeof threshold === 'number' && threshold >= 0.1 && threshold <= 1.0) {
        _backgroundCompactionThreshold = threshold;
    }
}

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
 *
 * @returns {void}
 */
export function clearState() {
    if (existsSync(STATE_FILE)) {
        rmSync(STATE_FILE);
        log('INFO', '[PersistentSession] Estado removido — próxima inicialização criará nova sessão.');
    }
}

/**
 * AH.6 — Cria um PermissionHandler que audita todas as decisões e loga ferramentas de alto risco. Envolve o handler
 * fornecido (ou approveAll por padrão) com logging de auditoria.
 *
 * @param {import('@github/copilot-sdk').PermissionHandler | undefined} baseHandler
 * @returns {import('@github/copilot-sdk').PermissionHandler}
 */
function buildAuditingPermissionHandler(baseHandler) {
    return /** @type {import('@github/copilot-sdk').PermissionHandler} */ (
        async (request, invocation) => {
            const toolName = /** @type {any} */ (request)?.toolName ?? /** @type {any} */ (request)?.tool ?? 'unknown';
            const highRisk = isHighRiskTool(toolName);

            if (highRisk) {
                log('WARN', `[AH.6] Ferramenta de alto risco solicitada: '${toolName}'`);
            }

            /** @type {any} */
            let result;
            if (baseHandler) {
                result = await baseHandler(request, invocation);
            } else {
                // BUG-H07 (fix): usar SDK approveAll em vez de objeto manual { kind: 'approved' }
                result = await approveAll(request, invocation);
            }

            const decision = result?.kind === 'approved' ? 'approved' : 'denied';
            logToolAudit({ tool: toolName, decision, highRisk });

            if (highRisk && decision === 'approved') {
                log('INFO', `[AH.6] Ferramenta alto risco APROVADA: '${toolName}'`);
            }

            return result;
        }
    );
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
 * @param {'low' | 'medium' | 'high' | 'xhigh'} [sessionOptions.reasoningEffort] - Esforço de raciocínio para o3/o4-mini
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
        // AC.1: threshold dinâmico lido da variável de módulo (configurável via setBackgroundCompactionThreshold)
        infiniteSessions: { enabled: true, backgroundCompactionThreshold: _backgroundCompactionThreshold },
        // AA.6: passar workingDirectory para o SDK contextualizar ferramentas de busca
        workingDirectory: process.env.COPILOT_WORKING_DIRECTORY ?? process.cwd(),
        // AA.7: diretórios de skills para o SDK carregar
        skillDirectories: ['.github/skills'],
        // AH.1: ferramentas excluídas por padrão + denylist configurável em runtime
        excludedTools: [...DEFAULT_EXCLUDED_TOOLS, ...getToolsConfig().denylist],
        // AH.2: allowlist em runtime — quando definida, tem precedência sobre excludedTools
        ...(getToolsConfig().allowlist !== null ? { availableTools: getToolsConfig().allowlist } : {}),
        ...(sessionOptions.reasoningEffort !== undefined ? { reasoningEffort: sessionOptions.reasoningEffort } : {}),
        // AH.6: wrapper de permissão com audit logging de ferramentas de alto risco
        onPermissionRequest: buildAuditingPermissionHandler(sessionOptions.onPermissionRequest),
        ...(sessionOptions.onUserInputRequest !== undefined
            ? { onUserInputRequest: sessionOptions.onUserInputRequest }
            : {}),
        ...(sessionOptions.hooks !== undefined ? { hooks: sessionOptions.hooks } : {}),
        ...(sessionOptions.tools !== undefined ? { tools: sessionOptions.tools } : {}),
        ...(sessionOptions.mcpServers !== undefined ? { mcpServers: sessionOptions.mcpServers } : {}),
        // L1: sub-agentes customizados especializados (task, explore, diagnostic)
        customAgents: buildCustomAgentsConfig(),
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
