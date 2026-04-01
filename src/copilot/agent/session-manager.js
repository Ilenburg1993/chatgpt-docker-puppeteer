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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { access, appendFile, mkdir, readFile, rename, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { buildCustomAgentsConfig } from '../config/custom-agents.js';
import { pickDefined } from '../lib/utils.js';

// ─── F5.1 (ARCH-01): Schema Zod para session.json ────────────────────────────

/**
 * Schema Zod para validação de session.json do hook system.
 *
 * Usa .passthrough() para tolerar campos adicionais de outras versões do hook.
 */
const SessionJsonSchema = z
    .object({
        close_key: z
            .string()
            .regex(/^[a-zA-Z0-9_-]{1,64}$/)
            .optional(),
        strict_turn_close: z.boolean().optional(),
        current_turn: z
            .object({
                number: z.number().int().min(0),
            })
            .passthrough()
            .optional(),
        compliance: z
            .object({
                consecutive_unauthorized: z.number().int().min(0).max(9999),
            })
            .passthrough()
            .optional(),
    })
    .passthrough();

// Carrega configuração de tools persistida ao iniciar o módulo.
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
 * ARCH-01: este log registra decisões de permissão (approve/deny) de hooks, distinto do `channel/audit.js` que registra
 * tool calls SDK (start/complete com durationMs). São complementares; ambos escrevem no mesmo arquivo
 * `logs/tool-audit.jsonl`.
 *
 * @param {{ tool: string; decision: 'approved' | 'denied'; highRisk: boolean }} entry
 * @returns {void}
 */
function logToolAudit(entry) {
    // I/O assísncro fire-and-forget — não bloqueia o event loop.
    const line = JSON.stringify({ ...entry, ts: new Date().toISOString() }) + '\n';
    const ROTATE_LOG = TOOL_AUDIT_LOG + '.1';
    const MAX_BYTES = 10 * 1024 * 1024;

    void (async () => {
        try {
            await mkdir(join(TOOL_AUDIT_LOG, '..'), { recursive: true });
            try {
                const { size } = await stat(TOOL_AUDIT_LOG);
                if (size >= MAX_BYTES) await rename(TOOL_AUDIT_LOG, ROTATE_LOG);
            } catch {
                // arquivo não existe ainda — ok
            }
            await appendFile(TOOL_AUDIT_LOG, line, 'utf8');
        } catch {
            // log de auditoria não deve travar a sessão
        }
    })();
}

// Threshold dinâmico de compaction — configurável via PUT /config/infinite-session.
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
 * Convertida para `async` para evitar bloqueio do event loop em I/O lento (ex.: containers Docker com volumes NFS).
 *
 * @returns {Promise<string>} Conteúdo markdown com contexto operacional do hook system
 */
export async function buildHookSystemContext() {
    const parts = [];

    try {
        await access(BRIEFING_FILE);
        const content = await readFile(BRIEFING_FILE, 'utf8');
        parts.push('## Contexto da Sessão (Hook System)\n\n' + content);
    } catch {
        /* arquivo não existe — ignorar */
    }

    try {
        await access(SESSION_JSON_FILE);
        const raw = await readFile(SESSION_JSON_FILE, 'utf8');
        // F5.1 (ARCH-01): valida session.json com schema Zod para detectar corrupcao precocemente
        const parseResult = SessionJsonSchema.safeParse(JSON.parse(raw));
        if (!parseResult.success) {
            log('WARN', `[session-manager] session.json com estrutura inválida: ${parseResult.error.message}`);
        }
        const state = parseResult.success ? parseResult.data : JSON.parse(raw);
        // SEC-VULN-03 (fix): validar e sanitizar todos os valores de session.json
        // antes de usá-los no system prompt para prevenir prompt injection
        const rawConsecutive = state?.compliance?.consecutive_unauthorized;
        const consecutive =
            typeof rawConsecutive === 'number' && Number.isFinite(rawConsecutive)
                ? Math.min(Math.max(0, Math.trunc(rawConsecutive)), 9999)
                : 0;
        const rawTurnNum = state?.current_turn?.number;
        const turnNum =
            typeof rawTurnNum === 'number' && Number.isFinite(rawTurnNum) ? Math.max(0, Math.trunc(rawTurnNum)) : 0;
        const rawCloseKey = state?.close_key ?? 'N/A';
        // SEC-N07 (fix): sanitizar close_key — limitar a alfanuméricos para evitar prompt injection
        const closeKey =
            typeof rawCloseKey === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(rawCloseKey) ? rawCloseKey : 'INVALID_KEY';
        const strictClose =
            state?.strict_turn_close === true || state?.strict_turn_close === false ? state.strict_turn_close : true;
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
        /* arquivo não existe ou JSON inválido — ignorar silenciosamente */
    }

    return parts.join('\n\n');
}

// SEC-02: limite máximo de contexto (8KB) para prevenir injection de conteúdo grande via briefing
const HOOK_CONTEXT_MAX_BYTES = 8 * 1024;

/**
 * Constrói contexto do hook system com limite de tamanho aplicado.
 *
 * @returns {Promise<string>}
 */
export async function buildHookSystemContextSafe() {
    const raw = await buildHookSystemContext();
    if (Buffer.byteLength(raw, 'utf8') > HOOK_CONTEXT_MAX_BYTES) {
        const truncated = Buffer.from(raw, 'utf8').subarray(0, HOOK_CONTEXT_MAX_BYTES).toString('utf8');
        return truncated + '\n\n⚠️ [contexto truncado por limite SEC-02: 8KB]';
    }
    return raw;
}

const ROOT = resolve(import.meta.dirname, '../../');
const STATE_DIR = join(ROOT, '.github', 'hooks', 'state');
const STATE_FILE = join(STATE_DIR, 'sdk-always-alive.json');

// Cache in-process de readState e flag para evitar mkdir redundante.
// `_stateCache` é atualizado em cada writeState/writeStateAsync; readState retorna o cache
// quando disponível, sem I/O adicional. `_stateDirReady` evita mkdirSync/mkdir redundante após a 1ª criação.
/** @type {import('./session-manager.js').AliveAgentState | null} */
let _stateCache = null;
let _stateDirReady = false;

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
 * @property {boolean} [dialogLoopActive] - Se o dialog loop estava ativo no momento do snapshot
 * @property {boolean} [dialogPaused] - `true` se pause explícito foi emitido via `pauseDialogLoop()`
 * @property {number} [pausedAt] - Timestamp do pause (ms)
 * @property {string} [pendingTurnMessage] - Última mensagem enviada sem resposta confirmada
 * @property {number} [pendingTurnTs] - Timestamp do envio pendente (ms)
 * @property {boolean} [pendingTurnConsumedPR] - Se `assistant.usage` já foi emitido para este turno
 * @property {number} [lastPrConsumedAt] - Timestamp do último PR consumido (ms)
 * @property {string} [lastPrModel] - Modelo que consumiu o último PR
 * @property {number} [lastPrCost] - Custo reportado pelo SDK no último PR
 * @property {any} [lastQuotaSnapshots] - Snapshots de cota do último `assistant.usage`
 */

/**
 * Lê o estado persistido do agente da sessão em disco.
 *
 * Retorna o cache in-process quando disponível, evitando readFileSync no hot path.
 *
 * @returns {AliveAgentState | null} Estado persistido ou null se não existir
 */
export function readState() {
    if (_stateCache !== null) return _stateCache;
    if (!existsSync(STATE_FILE)) return null;
    try {
        _stateCache = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
        return _stateCache;
    } catch (/** @type {any} */ e) {
        log('WARN', `[PersistentSession] Falha ao ler estado: ${e.message}`);
        return null;
    }
}

/**
 * Persiste o estado da sessão em disco.
 *
 * `_stateDirReady` evita chamada mkdirSync redundante após a 1ª criação. Atualiza `_stateCache` após a escrita para que
 * `readState()` não precise de I/O nas leituras seguintes.
 *
 * @param {Partial<AliveAgentState>} updates - Campos a atualizar no estado
 * @returns {AliveAgentState} Estado completo após a atualização
 */
export function writeState(updates) {
    if (!_stateDirReady) {
        mkdirSync(STATE_DIR, { recursive: true });
        _stateDirReady = true;
    }
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
    _stateCache = next;
    return next;
}

/**
 * Versão async de `writeState`. Preferir em handlers de alta frequência para não bloquear o event loop.
 *
 * `_stateDirReady` evita chamada mkdir redundante após a 1ª criação. Atualiza `_stateCache` após a escrita para que
 * `readState()` não precise de I/O nas leituras seguintes.
 *
 * @param {Partial<AliveAgentState>} updates
 * @returns {Promise<AliveAgentState>}
 */
export async function writeStateAsync(updates) {
    if (!_stateDirReady) {
        await mkdir(STATE_DIR, { recursive: true });
        _stateDirReady = true;
    }
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
    const { writeFile } = await import('node:fs/promises');
    await writeFile(STATE_FILE, JSON.stringify(next, null, 4), 'utf8');
    _stateCache = next;
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
    // Invalida cache após remoção do arquivo.
    _stateCache = null;
    _stateDirReady = false;
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
                // Se o baseHandler lançar exceção, usa approveAll como fallback seguro.
                try {
                    result = await baseHandler(request, invocation);
                } catch (/** @type {any} */ err) {
                    log('WARN', `[AH.6] baseHandler lançou exceção (fallback approveAll): ${err?.message}`);
                    result = await approveAll(request, invocation);
                }
            } else {
                // Usa SDK approveAll oficial em vez de objeto manual `{ kind: 'approved' }`.
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
    const systemMessage = injectContext ? buildHookContextAppendMessage(await buildHookSystemContextSafe()) : undefined;

    /** @type {any} */
    const opts = {
        model,
        streaming: true,
        // Threshold dinâmico lido da variável de módulo (configurável via setBackgroundCompactionThreshold).
        infiniteSessions: { enabled: true, backgroundCompactionThreshold: _backgroundCompactionThreshold },
        // Diretório de trabalho para o SDK contextualizar ferramentas de busca.
        workingDirectory: process.env.COPILOT_WORKING_DIRECTORY ?? process.cwd(),
        // Diretórios de skills para o SDK carregar.
        skillDirectories: ['.github/skills'],
        // AH.1: ferramentas excluídas por padrão + denylist configurável em runtime
        excludedTools: [...DEFAULT_EXCLUDED_TOOLS, ...getToolsConfig().denylist],
        // AH.2: allowlist em runtime — quando definida, tem precedência sobre excludedTools
        ...(getToolsConfig().allowlist !== null ? { availableTools: getToolsConfig().allowlist } : {}),
        ...pickDefined({
            reasoningEffort: sessionOptions.reasoningEffort,
            onUserInputRequest: sessionOptions.onUserInputRequest,
            hooks: sessionOptions.hooks,
            tools: sessionOptions.tools,
            mcpServers: sessionOptions.mcpServers,
            systemMessage,
        }),
        // AH.6: wrapper de permissão com audit logging de ferramentas de alto risco
        onPermissionRequest: buildAuditingPermissionHandler(sessionOptions.onPermissionRequest),
        // L1: sub-agentes customizados especializados (task, explore, diagnostic)
        customAgents: buildCustomAgentsConfig(),
    };

    // Delega para lib/session.resumeOrCreate — tenta retomar, cria se falhar
    const result = await resumeOrCreate(client, state?.sessionId ?? null, opts);

    // SYNC-SM-01 (fix): usar writeStateAsync nas chamadas dentro de funções async para não bloquear o event loop
    if (result.isResumed) {
        await writeStateAsync({
            resumedAt: Date.now(),
            resumeCount: (state?.resumeCount ?? 0) + 1,
        });
        log('INFO', `[PersistentSession] Sessão retomada com sucesso (retomada #${(state?.resumeCount ?? 0) + 1}).`);
    } else {
        await writeStateAsync({
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
