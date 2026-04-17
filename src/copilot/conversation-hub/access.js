// @ts-check
/**
 * @module copilot/conversation-hub/access
 * @file SSOT de autorização por hub_session.
 *
 *   Centraliza:
 *
 *   - normalização de principal proveniente de claims JWT;
 *   - parsing resiliente de `metadata` de `hub_session`;
 *   - avaliação de ACL para leitura/escrita em sessões persistidas.
 *
 *   O objetivo é impedir que autenticação global no transporte (JWT válido) seja confundida com autorização por sessão.
 *   Chamadores devem sempre consultar `authorizeHubSessionAction()` antes de expor histórico, permitir join em sala, ou
 *   aceitar inject de mensagens.
 */

/**
 * @typedef {'read' | 'write'} HubSessionAction
 */

/**
 * @typedef {object} HubAccessPrincipal
 * @property {string | null} userId
 * @property {Set<string>} roles
 * @property {Set<string>} scopes
 * @property {Set<string>} sessionIds
 * @property {boolean} isAdmin
 */

/**
 * @typedef {object} HubSessionAccessPolicy
 * @property {Record<string, unknown>} metadata
 * @property {string | null} source
 * @property {Set<string>} ownerIds
 * @property {Set<string>} viewerIds
 * @property {Set<string>} editorIds
 * @property {boolean} sharedRead
 * @property {boolean} sharedWrite
 * @property {boolean} systemManaged
 * @property {boolean} hasAclSignals
 */

/**
 * @typedef {object} HubSessionAccessDecision
 * @property {boolean} ok
 * @property {string} reason
 * @property {HubSessionAccessPolicy} policy
 */

const ADMIN_ROLE_NAMES = new Set(['admin', 'ops', 'support', 'copilot-admin']);
const ADMIN_SCOPE_NAMES = new Set(['copilot:admin', 'copilot:hub:*', 'copilot:hub:admin']);
const SYSTEM_MANAGED_SOURCES = new Set(['terminal', 'terminal-server', 'llm-b-terminal', 'system']);

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function _isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function _toStringArray(value) {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return [];
        return trimmed.includes(',')
            ? trimmed
                  .split(',')
                  .map((part) => part.trim())
                  .filter(Boolean)
            : trimmed.split(/\s+/).filter(Boolean);
    }
    if (Array.isArray(value)) {
        return value
            .flatMap((item) => _toStringArray(item))
            .map((item) => item.trim())
            .filter(Boolean);
    }
    return [];
}

/**
 * @param {unknown} root
 * @param {string[]} path
 * @returns {unknown}
 */
function _getPath(root, path) {
    /** @type {unknown} */
    let cur = root;
    for (const segment of path) {
        if (!_isRecord(cur) || !(segment in cur)) return undefined;
        cur = cur[segment];
    }
    return cur;
}

/**
 * @param {unknown} root
 * @param {string[][]} paths
 * @returns {string | null}
 */
function _readFirstString(root, paths) {
    for (const path of paths) {
        const value = _getPath(root, path);
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
}

/**
 * @param {unknown} root
 * @param {string[][]} paths
 * @returns {Set<string>}
 */
function _readStringSet(root, paths) {
    const values = new Set();
    for (const path of paths) {
        for (const value of _toStringArray(_getPath(root, path))) values.add(value);
    }
    return values;
}

/**
 * @param {unknown} root
 * @param {string[][]} paths
 * @returns {boolean}
 */
function _readBoolean(root, paths) {
    for (const path of paths) {
        const value = _getPath(root, path);
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') {
            const lower = value.trim().toLowerCase();
            if (lower === 'true' || lower === '1' || lower === 'yes') return true;
            if (lower === 'false' || lower === '0' || lower === 'no') return false;
        }
    }
    return false;
}

/**
 * Faz parse resiliente do campo `metadata` de uma hub session.
 *
 * @param {unknown} rawMetadata
 * @returns {Record<string, unknown>}
 */
export function parseHubSessionMetadata(rawMetadata) {
    if (_isRecord(rawMetadata)) return rawMetadata;
    if (typeof rawMetadata !== 'string' || !rawMetadata.trim()) return {};
    try {
        const parsed = JSON.parse(rawMetadata);
        return _isRecord(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

/**
 * Normaliza claims do JWT em um principal de autorização do hub.
 *
 * @param {unknown} payload
 * @returns {HubAccessPrincipal}
 */
export function createHubAccessPrincipal(payload) {
    const root = _isRecord(payload) ? payload : {};
    const roles = _readStringSet(root, [
        ['role'],
        ['roles'],
        ['realm_access', 'roles'],
        ['resource_access', 'copilot', 'roles'],
        ['resource_access', 'copilot-dashboard', 'roles'],
    ]);
    const scopes = _readStringSet(root, [['scope'], ['scopes'], ['permissions'], ['permission']]);
    const sessionIds = _readStringSet(root, [
        ['hubSessionId'],
        ['hubSessionIds'],
        ['hubSessions'],
        ['allowedHubSessionId'],
        ['allowedHubSessionIds'],
        ['allowedHubSessions'],
        ['copilotHubSessionId'],
        ['copilotHubSessionIds'],
    ]);
    const userId = _readFirstString(root, [['sub'], ['userId'], ['uid'], ['preferred_username']]);

    const isAdmin =
        [...roles].some((role) => ADMIN_ROLE_NAMES.has(role)) ||
        [...scopes].some((scope) => ADMIN_SCOPE_NAMES.has(scope));

    return {
        userId,
        roles,
        scopes,
        sessionIds,
        isAdmin,
    };
}

/**
 * Deriva a política de acesso de uma sessão a partir de seus metadados.
 *
 * @param {{ metadata?: unknown }} session
 * @returns {HubSessionAccessPolicy}
 */
export function deriveHubSessionAccessPolicy(session) {
    const metadata = parseHubSessionMetadata(session.metadata);
    const ownerIds = _readStringSet(metadata, [
        ['ownerId'],
        ['owner_id'],
        ['userId'],
        ['user_id'],
        ['createdBy'],
        ['created_by'],
        ['createdByUserId'],
        ['owners'],
        ['ownerIds'],
        ['acl', 'ownerId'],
        ['acl', 'owners'],
        ['acl', 'ownerIds'],
        ['access', 'ownerId'],
        ['access', 'owners'],
    ]);
    const viewerIds = _readStringSet(metadata, [
        ['viewerIds'],
        ['viewers'],
        ['readerIds'],
        ['readers'],
        ['readUserIds'],
        ['allowedUserIds'],
        ['acl', 'viewerIds'],
        ['acl', 'viewers'],
        ['acl', 'readerIds'],
        ['acl', 'allowedUserIds'],
        ['access', 'viewerIds'],
        ['access', 'readUserIds'],
    ]);
    const editorIds = _readStringSet(metadata, [
        ['editorIds'],
        ['editors'],
        ['writerIds'],
        ['writers'],
        ['writeUserIds'],
        ['injectorIds'],
        ['collaboratorIds'],
        ['acl', 'editorIds'],
        ['acl', 'editors'],
        ['acl', 'writerIds'],
        ['acl', 'injectorIds'],
        ['access', 'editorIds'],
        ['access', 'writeUserIds'],
    ]);
    const source = _readFirstString(metadata, [['source'], ['origin'], ['acl', 'source'], ['access', 'source']]);
    const visibility = _readFirstString(metadata, [['visibility'], ['acl', 'visibility'], ['access', 'visibility']]);
    const sharedRead =
        _readBoolean(metadata, [['shared'], ['public'], ['isShared'], ['acl', 'shared'], ['access', 'shared']]) ||
        visibility === 'shared' ||
        visibility === 'public';
    const sharedWrite =
        _readBoolean(metadata, [
            ['sharedWrite'],
            ['allowAllInject'],
            ['allowUserInject'],
            ['acl', 'sharedWrite'],
            ['access', 'sharedWrite'],
        ]) || visibility === 'collaborative';
    const systemManaged = source !== null && SYSTEM_MANAGED_SOURCES.has(source);

    return {
        metadata,
        source,
        ownerIds,
        viewerIds,
        editorIds,
        sharedRead,
        sharedWrite,
        systemManaged,
        hasAclSignals:
            ownerIds.size > 0 || viewerIds.size > 0 || editorIds.size > 0 || sharedRead || sharedWrite || systemManaged,
    };
}

/**
 * @param {HubAccessPrincipal} principal
 * @param {HubSessionAction} action
 * @returns {boolean}
 */
function _hasHubWildcardScope(principal, action) {
    return (
        principal.scopes.has('copilot:hub:*') ||
        principal.scopes.has(`copilot:hub:${action}:*`) ||
        principal.scopes.has(`copilot:hub:${action}:all`) ||
        principal.scopes.has('copilot:hub:read-write')
    );
}

/**
 * Avalia se um principal pode executar uma ação sobre uma hub session.
 *
 * @param {HubAccessPrincipal} principal
 * @param {{ id: string; metadata?: unknown }} session
 * @param {HubSessionAction} action
 * @returns {HubSessionAccessDecision}
 */
export function authorizeHubSessionAction(principal, session, action) {
    const policy = deriveHubSessionAccessPolicy(session);
    const userId = principal.userId;

    if (principal.isAdmin || _hasHubWildcardScope(principal, action)) {
        return { ok: true, reason: 'admin_or_scope', policy };
    }

    if (principal.sessionIds.has(session.id)) {
        return { ok: true, reason: 'token_session_grant', policy };
    }

    if (userId && policy.ownerIds.has(userId)) {
        return { ok: true, reason: 'session_owner', policy };
    }

    if (action === 'read') {
        if (userId && (policy.viewerIds.has(userId) || policy.editorIds.has(userId))) {
            return { ok: true, reason: 'session_acl_read', policy };
        }
        if (policy.sharedRead || policy.sharedWrite) {
            return { ok: true, reason: 'session_shared_read', policy };
        }
    }

    if (action === 'write') {
        if (userId && policy.editorIds.has(userId)) {
            return { ok: true, reason: 'session_acl_write', policy };
        }
        if (policy.sharedWrite) {
            return { ok: true, reason: 'session_shared_write', policy };
        }
    }

    if (policy.systemManaged) {
        return { ok: false, reason: 'system_session_requires_admin_or_explicit_grant', policy };
    }

    if (!policy.hasAclSignals) {
        return { ok: false, reason: 'session_acl_missing', policy };
    }

    return { ok: false, reason: 'principal_not_authorized', policy };
}
