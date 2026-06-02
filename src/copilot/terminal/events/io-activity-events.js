// @ts-check
/**
 * Adapter terminal para operações reais de I/O.
 *
 * A engine publica `copilot.io.operation` via diagnostics_channel. Este módulo é a ponte canônica desse sinal para UX
 * terminal: `/activity`, SSE e narrativa ao vivo. Ele não executa I/O e não substitui tool lifecycle do SDK.
 *
 * @module copilot/terminal/io-activity-events
 */

import { channel } from 'node:diagnostics_channel';
import { relative } from 'node:path';
import { getShowToolActivity } from '../../presentation/state/index.js';
import { println } from '../dialog/index.js';
import {
    recordTerminalActivity,
    recordTerminalTurnFileActivity,
    terminalThemeBadge,
    terminalThemeText,
} from '../state/events/index.js';
import { handleTerminalIoToolLifecycle } from './tool-lifecycle-runtime.js';

const ioOperationChannel = channel('copilot.io.operation');
const MAX_RECENT_IO_OPERATIONS = 80;

/**
 * F1.2: Dedup window para absorver triple-firing das camadas de cache de I/O. Para a mesma operação+alvo, apenas a
 * primeira ocorrência dentro da janela é registrada. Entradas subsequentes dentro da janela atualizam bytes/duração se
 * forem maiores/menores.
 */
const IO_DEDUP_WINDOW_MS = 60;
/** @type {Map<string, number>} */
const _ioDedupWindow = new Map();

/**
 * @param {string} operation
 * @param {string | string[]} targets
 * @param {string} [fallbackTarget]
 * @returns {boolean} true se deve suprimir (é duplicata dentro da janela)
 */
function isDuplicateIoOperation(operation, targets, fallbackTarget) {
    const normalizedTargets = Array.isArray(targets)
        ? targets
        : typeof targets === 'string' && targets
          ? [targets]
          : [];
    const normalizedFallback = fallbackTarget ?? (typeof targets === 'string' ? targets : 'unknown');
    const keyTarget = normalizedTargets.length > 0 ? normalizedTargets.join(' -> ') : normalizedFallback;
    const key = `${operation}::${keyTarget}`;
    const now = Date.now();
    const lastTs = _ioDedupWindow.get(key);
    if (lastTs !== undefined && now - lastTs <= IO_DEDUP_WINDOW_MS) {
        return true;
    }
    _ioDedupWindow.set(key, now);
    // Prune periódico: remover entradas antigas para evitar crescimento ilimitado
    if (_ioDedupWindow.size > 200) {
        for (const [k, ts] of _ioDedupWindow.entries()) {
            if (now - ts > IO_DEDUP_WINDOW_MS * 10) {
                _ioDedupWindow.delete(k);
            }
        }
    }
    return false;
}

/**
 * @typedef {{
 *     ts?: number;
 *     success?: boolean;
 *     io?: import('../../core/io-contracts.js').IoMeta;
 *     error?: { name?: string; message?: string };
 * }} TerminalIoOperationMessage
 *
 *
 * @typedef {{
 *     timestamp: number;
 *     success: boolean;
 *     operation: string;
 *     target: string;
 *     targets: string[];
 *     engine: string | null;
 *     targetKind: string | null;
 *     durationMs: number | null;
 *     bytesRead: number | null;
 *     bytesWritten: number | null;
 *     riskClass: string | null;
 *     error: { name?: string; message?: string } | null;
 * }} TerminalIoActivityEntry
 */

/** @type {TerminalIoActivityEntry[]} */
let _recentIoOperations = [];

/**
 * @param {unknown} value
 * @returns {TerminalIoOperationMessage | null}
 */
function normalizeIoMessage(value) {
    if (!value || typeof value !== 'object') return null;
    const message = /** @type {TerminalIoOperationMessage} */ (value);
    if (!message.io || typeof message.io !== 'object') return null;
    if (typeof message.io.operation !== 'string') return null;
    return message;
}

/**
 * @param {string} operation
 * @returns {import('../state/turn-trace-state.js').TerminalTurnTraceOperation}
 */
function mapIoOperationToTurnOperation(operation) {
    if (operation === 'read' || operation === 'fetch') return 'read';
    if (operation === 'write' || operation === 'append' || operation === 'mkdir') return 'write';
    if (operation === 'copy') return 'copy';
    if (operation === 'patch') return 'edit';
    if (operation === 'move') return 'move';
    if (operation === 'delete') return 'delete';
    if (operation === 'scan' || operation === 'search' || operation === 'stat') return 'list';
    return 'unknown';
}

/**
 * @param {import('../state/turn-trace-state.js').TerminalTurnTraceOperation} operation
 * @returns {'fileRead' | 'fileWrite' | 'fileEdit' | 'fileDelete' | 'tool'}
 */
function mapTurnOperationToRole(operation) {
    if (operation === 'read' || operation === 'list') return 'fileRead';
    if (operation === 'write' || operation === 'copy') return 'fileWrite';
    if (operation === 'edit' || operation === 'move') return 'fileEdit';
    if (operation === 'delete') return 'fileDelete';
    return 'tool';
}

/**
 * @param {string} target
 * @returns {string}
 */
function compactTargetPath(target) {
    if (/^https?:\/\//iu.test(target)) return target;
    const rel = relative(process.cwd(), target);
    if (rel && !rel.startsWith('..') && !rel.startsWith('/')) return rel;
    return target;
}

/**
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
function compactText(text, max = 120) {
    const clean = text.replace(/\s+/gu, ' ').trim();
    return clean.length <= max ? clean : `${clean.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * @param {number | undefined} bytes
 * @returns {string | null}
 */
function formatBytes(bytes) {
    if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * @param {import('../../core/io-contracts.js').IoMeta} io
 * @returns {string[]}
 */
function extractTouchedTargets(io) {
    const target = typeof io.target === 'string' ? io.target : '';
    if (!target) return [];
    if (/^https?:\/\//iu.test(target)) return [];
    if (target.includes(' -> '))
        return target
            .split(' -> ')
            .map((part) => compactTargetPath(part))
            .filter(Boolean);
    return [compactTargetPath(target)];
}

/**
 * @param {TerminalIoActivityEntry} entry
 * @returns {void}
 */
function recordRecentIoOperation(entry) {
    _recentIoOperations.push(entry);
    if (_recentIoOperations.length > MAX_RECENT_IO_OPERATIONS) {
        _recentIoOperations = _recentIoOperations.slice(-MAX_RECENT_IO_OPERATIONS);
    }
}

/**
 * @param {TerminalIoOperationMessage} message
 * @param {ReturnType<import('../state/tool-call-registry.js').createToolCallRegistry> | null} registry
 * @returns {void}
 */
function handleIoOperation(message, registry = null) {
    const io = message.io;
    if (!io) return;
    const success = message.success !== false;
    const turnOperation = mapIoOperationToTurnOperation(io.operation);
    const role = mapTurnOperationToRole(turnOperation);
    const touchedTargets = extractTouchedTargets(io);
    const primaryTarget =
        touchedTargets[0] ?? (typeof io.target === 'string' ? compactTargetPath(io.target) : 'unknown');
    // F1.2: absorver triple-firing de camadas de cache de I/O
    if (isDuplicateIoOperation(io.operation, touchedTargets, primaryTarget)) {
        return;
    }
    const byteLabel = formatBytes(io.bytesRead ?? io.bytesWritten);
    const durationLabel = typeof io.durationMs === 'number' ? `${Math.max(0, Math.round(io.durationMs))}ms` : null;
    const extra = [byteLabel, durationLabel, io.engine].filter(Boolean).join(' · ');
    const detail = `${io.operation} · ${primaryTarget}${extra ? ` · ${extra}` : ''}`;
    const label = success ? `I/O ${io.operation} concluído` : `I/O ${io.operation} falhou`;
    const entry = {
        timestamp: message.ts ?? Date.now(),
        success,
        operation: io.operation,
        target: primaryTarget,
        targets: touchedTargets,
        engine: io.engine ?? null,
        targetKind: io.targetKind ?? null,
        durationMs: io.durationMs ?? null,
        bytesRead: io.bytesRead ?? null,
        bytesWritten: io.bytesWritten ?? null,
        riskClass: io.riskClass ?? null,
        error: message.error ?? null,
    };

    recordRecentIoOperation(entry);

    for (const path of touchedTargets) {
        recordTerminalTurnFileActivity({
            path,
            operation: turnOperation,
            source: 'io',
            timestamp: entry.timestamp,
        });
    }

    recordTerminalActivity('tool', label, {
        detail,
        toolName: `io.${io.operation}`,
        source: 'io',
        severity: success ? 'info' : 'error',
        progress: success ? 100 : null,
    });

    if (getShowToolActivity()) {
        const badge = success
            ? terminalThemeBadge(role, io.operation.toUpperCase())
            : terminalThemeBadge('error', 'IO');
        const status = success ? terminalThemeText('success', 'ok') : terminalThemeText('error', 'falhou');
        println(
            `  ${terminalThemeBadge('tool', 'IO')} ${badge} ${terminalThemeText(role, compactText(primaryTarget, 92))} ${terminalThemeText('muted', `· ${status}${extra ? ` · ${extra}` : ''}`)}`,
        );
    }

    handleTerminalIoToolLifecycle({ registry, entry });
}

/**
 * Conecta operações reais da engine de I/O ao terminal.
 *
 * @param {{
 *     registry?: ReturnType<import('../state/tool-call-registry.js').createToolCallRegistry> | null;
 * }} [options]
 * @returns {() => void}
 */
export function setupTerminalIoActivityEvents(options = {}) {
    const registry = options.registry ?? null;
    /** @param {unknown} message */
    const subscriber = (message) => {
        const normalized = normalizeIoMessage(message);
        if (!normalized) return;
        handleIoOperation(normalized, registry);
    };
    ioOperationChannel.subscribe(subscriber);
    return () => {
        ioOperationChannel.unsubscribe(subscriber);
    };
}

/**
 * @param {number} [limit=10] Default is `10`
 * @returns {TerminalIoActivityEntry[]}
 */
export function readTerminalIoActivityProjection(limit = 10) {
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 10;
    return _recentIoOperations
        .slice(-safeLimit)
        .reverse()
        .map((entry) => ({ ...entry, targets: [...entry.targets], error: entry.error ? { ...entry.error } : null }));
}

/**
 * @returns {void}
 */
export function clearTerminalIoActivityProjection() {
    _recentIoOperations = [];
}

export const __test__ = {
    compactTargetPath,
    extractTouchedTargets,
    mapIoOperationToTurnOperation,
    handleIoOperation,
    isDuplicateIoOperation,
    get ioDedupWindow() {
        return _ioDedupWindow;
    },
};
