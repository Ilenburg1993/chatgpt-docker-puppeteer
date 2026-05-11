// @ts-check
/**
 * src/copilot/terminal/state/tool-call-registry.js
 *
 * Registro session-scoped de tool calls em andamento e recentemente concluídas.
 *
 * Substitui os Maps globais de módulo em `sdk-session-events.js`:
 *
 * - `externalToolsInFlight` → `isInFlight()`
 * - `externalToolRequestNames` → `resolveByRequestId()`
 * - `externalToolsRecentlyCompleted` → `wasRecentlyCompleted()`
 *
 * E o `activeTools` Map do closure em `agent-runtime-events.js`:
 *
 * - `activeTools.set/get/delete` → `register()` / `getEntry()` / `complete()`
 *
 * Ciclo de vida: instanciado uma vez por sessão. `clear()` deve ser chamado em `session.shutdown`.
 *
 * @module copilot/terminal/state/tool-call-registry
 */

/** TTL para entries de tools external sem heartbeat/completion (evita supressão eterna). */
const IN_FLIGHT_TTL_MS = 2 * 60_000;
/** TTL para entries de completion recente (janela de dedup cross-path). */
const RECENTLY_COMPLETED_TTL_MS = 2 * 60_000;

/**
 * @typedef {'native' | 'external' | 'mcp'} ToolCallKind
 */

/**
 * @typedef {{
 *     toolCallId: string;
 *     toolName: string;
 *     canonicalName: string | null;
 *     kind: ToolCallKind;
 *     requestId: string | null;
 *     t0: number;
 *     lastSignalAt: number;
 *     lastHeartbeatAt: number;
 *     lastProgress: number | null;
 *     lastProgressMessage: string | null;
 *     rawArgs: Record<string, unknown>;
 *     presentation: import('../events/tool-activity-presenter.js').TerminalToolActivityPresentation | null;
 *     completedAt: number | null;
 *     success: boolean | null;
 * }} ToolCallEntry
 */

/**
 * Cria um novo ToolCallRegistry session-scoped.
 *
 * @returns {{
 *     register: (
 *         toolCallId: string,
 *         toolName: string,
 *         kind: ToolCallKind,
 *         opts?: {
 *             requestId?: string | null;
 *             canonicalName?: string | null;
 *             rawArgs?: Record<string, unknown>;
 *             presentation?: import('../events/tool-activity-presenter.js').TerminalToolActivityPresentation | null;
 *         },
 *     ) => ToolCallEntry;
 *     getEntry: (toolCallId: string) => ToolCallEntry | null;
 *     touch: (
 *         toolCallId: string,
 *         patch: {
 *             rawArgs?: Record<string, unknown>;
 *             presentation?: import('../events/tool-activity-presenter.js').TerminalToolActivityPresentation | null;
 *             progress?: number | null;
 *             progressMessage?: string | null;
 *             lastHeartbeatAt?: number;
 *             lastSignalAt?: number;
 *         },
 *     ) => ToolCallEntry | null;
 *     updatePresentation: (
 *         toolCallId: string,
 *         presentation: import('../events/tool-activity-presenter.js').TerminalToolActivityPresentation,
 *     ) => void;
 *     updateProgress: (toolCallId: string, progress: number | null, message: string | null) => void;
 *     complete: (toolCallId: string, success: boolean) => ToolCallEntry | null;
 *     resolveByRequestId: (requestId: string | null | undefined) => ToolCallEntry | null;
 *     isInFlight: (toolCallId: string) => boolean;
 *     isNameInFlight: (toolName: string) => boolean;
 *     markRecentCompletion: (toolName: string, requestId?: string | null) => void;
 *     wasNameRecentlyCompleted: (toolName: string, requestId?: string | null) => boolean;
 *     wasRecentlyCompleted: (toolCallId: string, requestId?: string | null) => boolean;
 *     markRequestIdForExternalTool: (requestId: string, toolName: string) => void;
 *     resolveNameByRequestId: (requestId: string | null | undefined) => string | null;
 *     getAllInFlight: () => ToolCallEntry[];
 *     clear: () => void;
 * }}
 */
export function createToolCallRegistry() {
    /** @type {Map<string, ToolCallEntry>} active (in-flight) by toolCallId */
    const _active = new Map();

    /** @type {Map<string, ToolCallEntry>} recently-completed by toolCallId */
    const _recentlyCompleted = new Map();

    /** @type {Map<string, number>} aliases de completion recente: name:, id:, name-id: */
    const _recentCompletionKeys = new Map();

    /** @type {Map<string, string>} requestId → toolName (para external tools sem toolCallId explícito) */
    const _requestIdToName = new Map();

    /** @type {Map<string, ToolCallEntry>} requestId → ToolCallEntry */
    const _requestIdToEntry = new Map();

    /**
     * @param {number} [now]
     * @returns {void}
     */
    function pruneStale(now = Date.now()) {
        for (const [id, entry] of _active.entries()) {
            if (now - entry.lastSignalAt > IN_FLIGHT_TTL_MS) {
                _active.delete(id);
            }
        }
        for (const [id, entry] of _recentlyCompleted.entries()) {
            if (entry.completedAt !== null && now - entry.completedAt > RECENTLY_COMPLETED_TTL_MS) {
                _recentlyCompleted.delete(id);
            }
        }
        for (const [key, ts] of _recentCompletionKeys.entries()) {
            if (now - ts > RECENTLY_COMPLETED_TTL_MS) {
                _recentCompletionKeys.delete(key);
            }
        }
    }

    /**
     * @param {string} toolName
     * @param {string | null | undefined} requestId
     * @returns {string[]}
     */
    function buildCompletionKeys(toolName, requestId) {
        const keys = [`name:${toolName}`];
        if (requestId && String(requestId).trim().length > 0) {
            const cleanRequestId = String(requestId).trim();
            keys.push(`id:${cleanRequestId}`);
            keys.push(`name-id:${toolName}::${cleanRequestId}`);
        }
        return keys;
    }

    /**
     * @param {string} toolCallId
     * @param {string} toolName
     * @param {ToolCallKind} kind
     * @param {{
     *     requestId?: string | null;
     *     canonicalName?: string | null;
     *     rawArgs?: Record<string, unknown>;
     *     presentation?: import('../events/tool-activity-presenter.js').TerminalToolActivityPresentation | null;
     * }} [opts]
     * @returns {ToolCallEntry}
     */
    function register(toolCallId, toolName, kind, opts = {}) {
        pruneStale();
        const now = Date.now();
        /** @type {ToolCallEntry} */
        const entry = {
            toolCallId,
            toolName,
            canonicalName: opts.canonicalName ?? null,
            kind,
            requestId: opts.requestId ?? null,
            t0: now,
            lastSignalAt: now,
            lastHeartbeatAt: 0,
            lastProgress: null,
            lastProgressMessage: null,
            rawArgs: opts.rawArgs ?? {},
            presentation: opts.presentation ?? null,
            completedAt: null,
            success: null,
        };
        _active.set(toolCallId, entry);
        if (opts.requestId) {
            _requestIdToEntry.set(opts.requestId, entry);
            _requestIdToName.set(opts.requestId, toolName);
        }
        return entry;
    }

    /**
     * @param {string} toolCallId
     * @returns {ToolCallEntry | null}
     */
    function getEntry(toolCallId) {
        return _active.get(toolCallId) ?? null;
    }

    /**
     * @param {string} toolCallId
     * @param {{
     *     rawArgs?: Record<string, unknown>;
     *     presentation?: import('../events/tool-activity-presenter.js').TerminalToolActivityPresentation | null;
     *     progress?: number | null;
     *     progressMessage?: string | null;
     *     lastHeartbeatAt?: number;
     *     lastSignalAt?: number;
     * }} patch
     * @returns {ToolCallEntry | null}
     */
    function touch(toolCallId, patch) {
        const entry = _active.get(toolCallId);
        if (!entry) return null;
        if ('rawArgs' in patch && patch.rawArgs) entry.rawArgs = patch.rawArgs;
        if ('presentation' in patch) entry.presentation = patch.presentation ?? null;
        if ('progress' in patch) entry.lastProgress = patch.progress ?? null;
        if ('progressMessage' in patch) entry.lastProgressMessage = patch.progressMessage ?? null;
        if ('lastHeartbeatAt' in patch && typeof patch.lastHeartbeatAt === 'number') {
            entry.lastHeartbeatAt = patch.lastHeartbeatAt;
        }
        entry.lastSignalAt =
            'lastSignalAt' in patch && typeof patch.lastSignalAt === 'number' ? patch.lastSignalAt : Date.now();
        return entry;
    }

    /**
     * @param {string} toolCallId
     * @param {import('../events/tool-activity-presenter.js').TerminalToolActivityPresentation} presentation
     * @returns {void}
     */
    function updatePresentation(toolCallId, presentation) {
        touch(toolCallId, { presentation });
    }

    /**
     * @param {string} toolCallId
     * @param {number | null} progress
     * @param {string | null} message
     * @returns {void}
     */
    function updateProgress(toolCallId, progress, message) {
        touch(toolCallId, { progress, progressMessage: message });
    }

    /**
     * @param {string} toolCallId
     * @param {boolean} success
     * @returns {ToolCallEntry | null}
     */
    function complete(toolCallId, success) {
        pruneStale();
        const entry = _active.get(toolCallId);
        if (!entry) return null;
        entry.completedAt = Date.now();
        entry.success = success;
        _active.delete(toolCallId);
        _recentlyCompleted.set(toolCallId, entry);
        markRecentCompletion(entry.canonicalName ?? entry.toolName, entry.requestId);
        if (entry.requestId) {
            _requestIdToEntry.delete(entry.requestId);
            _requestIdToName.delete(entry.requestId);
        }
        return entry;
    }

    /**
     * @param {string | null | undefined} requestId
     * @returns {ToolCallEntry | null}
     */
    function resolveByRequestId(requestId) {
        if (!requestId) return null;
        return _requestIdToEntry.get(requestId) ?? null;
    }

    /**
     * @param {string} toolCallId
     * @returns {boolean}
     */
    function isInFlight(toolCallId) {
        pruneStale();
        return _active.has(toolCallId);
    }

    /**
     * Verifica se qualquer tool com esse nome está em voo. Usado para supressão de eventos duplicados quando só se tem
     * o nome.
     *
     * @param {string} toolName
     * @returns {boolean}
     */
    function isNameInFlight(toolName) {
        pruneStale();
        for (const entry of _active.values()) {
            if (entry.toolName === toolName || entry.canonicalName === toolName) {
                return true;
            }
        }
        return false;
    }

    /**
     * @param {string} toolCallId
     * @param {string | null | undefined} [requestId]
     * @returns {boolean}
     */
    function wasRecentlyCompleted(toolCallId, requestId) {
        pruneStale();
        if (_recentlyCompleted.has(toolCallId)) return true;
        if (requestId) {
            const byId = _recentCompletionKeys.get(`id:${requestId}`);
            if (typeof byId === 'number') return true;
        }
        if (requestId) {
            for (const entry of _recentlyCompleted.values()) {
                if (entry.requestId === requestId) return true;
            }
        }
        return false;
    }

    /**
     * Marca aliases de completion recente por nome/requestId, usado quando recebemos eventos externos sem
     * correspondência confiável de toolCallId.
     *
     * @param {string} toolName
     * @param {string | null | undefined} requestId
     * @returns {void}
     */
    function markRecentCompletion(toolName, requestId) {
        const now = Date.now();
        pruneStale(now);
        for (const key of buildCompletionKeys(toolName, requestId)) {
            _recentCompletionKeys.set(key, now);
        }
    }

    /**
     * @param {string} toolName
     * @param {string | null | undefined} requestId
     * @returns {boolean}
     */
    function wasNameRecentlyCompleted(toolName, requestId) {
        pruneStale();
        const byName = _recentCompletionKeys.get(`name:${toolName}`);
        if (typeof byName === 'number') return true;
        if (requestId) {
            const cleanRequestId = String(requestId).trim();
            const byNameAndId = _recentCompletionKeys.get(`name-id:${toolName}::${cleanRequestId}`);
            if (typeof byNameAndId === 'number') return true;
            const byId = _recentCompletionKeys.get(`id:${cleanRequestId}`);
            if (typeof byId === 'number') return true;
        }
        return false;
    }

    /**
     * Registra mapeamento requestId → toolName para external tools que chegam sem toolCallId. Usado para resolver o
     * nome real quando `external_tool.completed` chega com nome genérico.
     *
     * @param {string} requestId
     * @param {string} toolName
     * @returns {void}
     */
    function markRequestIdForExternalTool(requestId, toolName) {
        _requestIdToName.set(requestId, toolName);
    }

    /**
     * @param {string | null | undefined} requestId
     * @returns {string | null}
     */
    function resolveNameByRequestId(requestId) {
        if (!requestId) return null;
        return _requestIdToName.get(requestId) ?? null;
    }

    /**
     * @returns {ToolCallEntry[]}
     */
    function getAllInFlight() {
        pruneStale();
        return [..._active.values()];
    }

    /**
     * Limpa todo o estado. Deve ser chamado em `session.shutdown`.
     *
     * @returns {void}
     */
    function clear() {
        _active.clear();
        _recentlyCompleted.clear();
        _recentCompletionKeys.clear();
        _requestIdToName.clear();
        _requestIdToEntry.clear();
    }

    return {
        register,
        getEntry,
        touch,
        updatePresentation,
        updateProgress,
        complete,
        resolveByRequestId,
        isInFlight,
        isNameInFlight,
        markRecentCompletion,
        wasNameRecentlyCompleted,
        wasRecentlyCompleted,
        markRequestIdForExternalTool,
        resolveNameByRequestId,
        getAllInFlight,
        clear,
    };
}
