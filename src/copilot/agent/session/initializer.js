// @ts-check
/**
 * src/copilot/agent/session-initializer.js
 *
 * Inicializador de sessão persistente para o Always-Alive Agent. Preserva o sessionId em disco e retoma sessões após
 * reinicializações (PM2/reboot).
 *
 * I/O de estado persistido delegado a `state-io.js`. Logging de auditoria de ferramentas delegado a
 * `tool-audit-logger.js`.
 *
 * @module copilot/session-initializer
 * @see module:copilot/lib/session
 * @see module:copilot/agent/state-io
 * @see module:copilot/config/session-config
 */

import { DEFAULT_EXCLUDED_TOOLS } from '#copilot/config/session-config';
import { buildHookContextAppendMessage } from '#copilot/config/system-prompt';
import { getToolsConfig, loadToolsConfig } from '#copilot/config/tools/state';
import { resumeOrCreate } from '#copilot/lib/session';
import { log } from '#copilot/observability/logger';
import { defaultMetrics } from '#copilot/observability/metrics';
import { access, open, readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { buildCustomAgentsConfig } from '../../config/custom-agents.js';
import { pickDefined } from '../../lib/utils.js';
import { readStore as _readTodoStore } from '../../tools/todo/store.js';
import { readState as _readState, writeStateAsync as _writeStateAsync } from '../state-io.js';
import { buildAuditingPermissionHandler } from '../tool-audit-logger.js';
// Re-exporta funções de I/O de estado de state-io.js para compatibilidade retroativa com importadores
// que usam '#copilot/session-manager'. Novos módulos devem importar de './state-io.js' diretamente.
export { clearState, readState, writeState, writeStateAsync } from '../state-io.js';

/**
 * @typedef {import('@github/copilot-sdk').CopilotClient} CopilotClient
 *
 * @typedef {import('@github/copilot-sdk').CopilotSession} CopilotSession
 */

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

/**
 * Threshold dinâmico de compaction — configurável em runtime via PUT /config/infinite-session.
 *
 * **Singleton de módulo**: este valor é compartilhado por todas as chamadas a `initOrResumeSession()` no mesmo
 * processo. Em um cenário futuro multi-agent, cada instância deveria receber o threshold via opções em vez de depender
 * desta variável de módulo. Por enquanto, o design singleton é intencional — há apenas um agente por processo Node.
 *
 * @type {number}
 */
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
        // G2-SEC-02: verificar tamanho antes de readFile para evitar consumo de memória excessivo.
        // Limite: 16KB máximo antes de truncar na leitura.
        const SEC02_READ_LIMIT = 16 * 1024;
        const fileStat = await stat(BRIEFING_FILE);
        let content;
        if (fileStat.size > SEC02_READ_LIMIT) {
            log(
                'WARN',
                `[session-initializer] session-briefing.md excede limite (${fileStat.size} bytes > ${SEC02_READ_LIMIT}) — lendo apenas os primeiros ${SEC02_READ_LIMIT} bytes.`,
            );
            const fh = await open(BRIEFING_FILE, 'r');
            const buf = Buffer.alloc(SEC02_READ_LIMIT);
            await fh.read(buf, 0, SEC02_READ_LIMIT, 0);
            await fh.close();
            content =
                new TextDecoder('utf-8', { fatal: false }).decode(buf).replace(/\uFFFD+$/, '') +
                '\n\n⚠️ [briefing truncado: arquivo excede 16KB]';
        } else {
            content = await readFile(BRIEFING_FILE, 'utf8');
        }
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
                // G2-SEC-03: close_key em bloco de código fenced para evitar que um valor
                // com caracteres markdown especiais seja interpretado como instrução ativa.
                `- close_key: \`\`${closeKey}\`\``,
                `- strict_turn_close: ${strictClose}`,
                '',
                '**Protocolo obrigatório**: Encerre cada turno com `vscode_askQuestions`.',
                'Não inicie task_complete sem chamar vscode_askQuestions antes.',
            ].join('\n'),
        );
    } catch {
        /* arquivo não existe ou JSON inválido — ignorar silenciosamente */
    }

    // F5.3: skills disponíveis no diretório .github/skills/
    try {
        const skillsDir = join(resolve(import.meta.dirname, '../../'), '.github', 'skills');
        const entries = await readdir(skillsDir, { withFileTypes: true });
        const skillNames = entries
            .filter((e) => e.isDirectory())
            .map((e) => e.name)
            .sort();
        if (skillNames.length > 0) {
            parts.push('\n## Skills Disponíveis\n\n' + skillNames.map((s) => `- \`${s}\``).join('\n'));
        }
    } catch {
        /* ignorar — skills são opcionais no system prompt */
    }

    // F5.2: estado runtime do agente SDK (in-memory, sem I/O de arquivo)
    try {
        const summary = defaultMetrics.getSummary();
        const uptimeSecs = Math.round(process.uptime());
        // Contagem de TODOs pendentes (best-effort — falha silenciosa)
        let pendingCount = 0;
        try {
            const todoStore = await _readTodoStore();
            pendingCount = Object.values(todoStore.tasks).filter(
                (t) => t.status === 'todo' || t.status === 'in_progress',
            ).length;
        } catch {
            /* ignorar */
        }
        parts.push(
            [
                '\n## Estado Runtime do Agente (LLM-B SDK)',
                `- Uptime do processo: ${uptimeSecs}s`,
                `- Turns SDK completados: ${summary.dialog.turnsTotal}`,
                `- Tokens acumulados (entrada+saída): ${summary.tokens.inputTokens + summary.tokens.outputTokens}`,
                `- TODOs ativos (todo/in_progress): ${pendingCount}`,
            ].join('\n'),
        );
    } catch {
        /* ignorar falhas silenciosamente — estado runtime não é crítico */
    }

    return parts.join('\n\n');
}

// G2-DX-09: limite máximo de contexto configurável via env (default 8KB).
// SEC-02: previne injection de conteúdo grande via briefing
const HOOK_CONTEXT_MAX_BYTES = Number(process.env['AGENT_HOOK_CONTEXT_MAX_BYTES']) || 8 * 1024;

/**
 * Constrói contexto do hook system com limite de tamanho aplicado.
 *
 * @returns {Promise<string>}
 */
export async function buildHookSystemContextSafe() {
    const raw = await buildHookSystemContext();
    if (Buffer.byteLength(raw, 'utf8') > HOOK_CONTEXT_MAX_BYTES) {
        // G1-BUG-08 (fix): usar TextDecoder com fatal=false para garantir que o truncamento em
        // limite de bytes não corta caracteres UTF-8 multibyte no meio, gerando strings inválidas.
        const bytes = Buffer.from(raw, 'utf8').subarray(0, HOOK_CONTEXT_MAX_BYTES);
        const truncated = new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/\uFFFD+$/, '');
        return truncated + '\n\n⚠️ [contexto truncado por limite SEC-02: 8KB]';
    }
    return raw;
}

/**
 * F8.2: Valida se um sessionId persistido é elegível para tentativa de resumo.
 *
 * Retorna null (força criação de nova sessão) quando:
 *
 * - `sessionId` for falsy, não-string ou falhar no padrão UUID/opaque
 * - `lastActivityMs` for mais antigo que `SESSION_MAX_AGE_MS` (padrão: 24h) indicando que a sessão pode ter expirado no
 *   servidor do SDK
 *
 * @param {string | null | undefined} sessionId - ID da sessão persistida
 * @param {number | null | undefined} lastActivityMs - Epoch ms da última atividade conhecida
 * @returns {string | null} sessionId validado ou null para forçar nova sessão
 */
function _validateSessionForResume(sessionId, lastActivityMs) {
    if (!sessionId || typeof sessionId !== 'string') return null;
    // Aceita UUIDs (xxxxxxxx-xxxx-...) e IDs opacos alfanuméricos usados pelo SDK
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(sessionId)) {
        log('WARN', '[session-initializer] sessionId inválido — forçando nova sessão.');
        return null;
    }
    const maxAgeMs = Number(process.env['AGENT_SESSION_MAX_AGE_MS']) || 24 * 60 * 60_000;
    if (lastActivityMs && Date.now() - lastActivityMs > maxAgeMs) {
        log(
            'WARN',
            `[session-initializer] Sessão ${sessionId.slice(0, 12)}... expirou (${Math.round((Date.now() - lastActivityMs) / 3_600_000)}h inativa) — forçando nova.`,
        );
        return null;
    }
    return sessionId;
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
 * @throws {Error} Se a criação/retomada da sessão SDK falhar ou a escrita de estado falhar
 */
export async function initOrResumeSession(client, sessionOptions) {
    const state = _readState();
    const model = sessionOptions.model ?? 'gpt-4.1';
    const injectContext = sessionOptions.injectHookContext !== false;

    /** @type {import('@github/copilot-sdk').SystemMessageConfig | undefined} */
    const systemMessage = injectContext ? buildHookContextAppendMessage(await buildHookSystemContextSafe()) : undefined;

    /** @type {Record<string, unknown>} */
    const opts = {
        model,
        streaming: true,
        // Threshold dinâmico lido da variável de módulo (configurável via setBackgroundCompactionThreshold).
        infiniteSessions: { enabled: true, backgroundCompactionThreshold: _backgroundCompactionThreshold },
        // Diretório de trabalho para o SDK contextualizar ferramentas de busca.
        workingDirectory: process.env['COPILOT_WORKING_DIRECTORY'] ?? process.cwd(),
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

    // F43.2 (GAP-SD-03): verificar se a sessão deve ser rotacionada antes de tentar retomada
    let savedSessionId = _validateSessionForResume(state?.sessionId, state?.resumedAt ?? state?.startedAt);
    if (savedSessionId) {
        const { shouldRotateSession } = await import('./rotation.js');
        /** @type {import('./rotation.js').RotationContext} */
        const rotationCtx = {};
        if (state?.startedAt) {
            rotationCtx.sessionAgeMs = Date.now() - state.startedAt;
        }
        const decision = shouldRotateSession(rotationCtx);
        if (decision.shouldRotate) {
            log('INFO', `[PersistentSession] F43.2: Rotacionando sessão — ${decision.reason}`);
            const { defaultMetrics } = await import('#copilot/observability/metrics');
            defaultMetrics.recordSessionRotation();
            savedSessionId = null;
        }
    }
    const result = await resumeOrCreate(client, savedSessionId, opts);

    // SYNC-SM-01 (fix): usar writeStateAsync nas chamadas dentro de funções async para não bloquear o event loop
    if (result.isResumed) {
        await _writeStateAsync({
            resumedAt: Date.now(),
            resumeCount: (state?.resumeCount ?? 0) + 1,
        });
        log('INFO', `[PersistentSession] Sessão retomada com sucesso (retomada #${(state?.resumeCount ?? 0) + 1}).`);
    } else {
        await _writeStateAsync({
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
