// @ts-check
/**
 * Local Cloudflare edge snapshot backups for safe MCP operations.
 *
 * @module copilot/mcp/cloudflare/edge-backup
 */

import { createConfiguredFsGrant, createConfiguredFsIo } from '#copilot/infra/public/composition/filesystem/configured';
import {
    MCP_WORKSPACE_ROOT,
    resolveMcpWorkspaceIdentityPath,
    toMcpWorkspaceRelativePath,
} from '#copilot/mcp/public/workspace';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { DEFAULT_CLOUDFLARE_EDGE_BACKUP_DIR } from '../config.js';
import { buildCloudflareEdgeSnapshot } from './edge-snapshot.js';

const BACKUP_SCHEMA_VERSION = 1;
const BACKUP_KIND = 'cloudflare-edge-snapshot-backup';
const CLOUDFLARE_EDGE_BACKUP_ROOT = path.resolve(MCP_WORKSPACE_ROOT, DEFAULT_CLOUDFLARE_EDGE_BACKUP_DIR);
const CLOUDFLARE_EDGE_BACKUP_IO = createConfiguredFsIo(
    createConfiguredFsGrant({
        id: 'mcp.cloudflare.edge-backup',
        roots: [CLOUDFLARE_EDGE_BACKUP_ROOT],
        operations: ['list', 'read', 'stat', 'write'],
        symlinkPolicy: 'deny',
        durability: ['file-and-directory'],
    }),
);
const CLOUDFLARE_EDGE_BACKUP_STORE = createCloudflareEdgeBackupStore({
    dir: CLOUDFLARE_EDGE_BACKUP_ROOT,
    io: CLOUDFLARE_EDGE_BACKUP_IO,
});

/**
 * @typedef {object} CloudflareEdgeBackupOptions
 * @property {import('../environment-authority.js').CloudflareEnvironmentAuthority} [authority]
 * @property {NodeJS.ProcessEnv} [env]
 * @property {Date} [now]
 * @property {string} [label]
 * @property {boolean} [includeSnapshot]
 */

/**
 * @typedef {object} CloudflareEdgeBackupListOptions
 * @property {number} [limit]
 */

/**
 * @param {CloudflareEdgeBackupOptions} [options]
 * @returns {Promise<Record<string, unknown> & { ok: boolean }>}
 */
export async function createCloudflareEdgeBackup(options = {}) {
    const authorityOptions = options.authority
        ? { authority: options.authority }
        : options.env
          ? { env: options.env }
          : {};
    const now = options.now ?? new Date();
    const snapshot = await buildCloudflareEdgeSnapshot({ ...authorityOptions, now });
    const backupOptions = {
        ...(typeof options.label === 'string' ? { label: options.label } : {}),
        ...(typeof options.includeSnapshot === 'boolean' ? { includeSnapshot: options.includeSnapshot } : {}),
        now,
    };
    return writeCloudflareEdgeBackup(snapshot, backupOptions);
}

/** @typedef {ReturnType<typeof createConfiguredFsIo>} ConfiguredFsIo */

/**
 * Build a backup store from an already-authorized IO capability. The factory never mints filesystem authority.
 * @param {{dir:string;io:ConfiguredFsIo}} options
 */
export function createCloudflareEdgeBackupStore(options) {
    const absoluteDir = resolveMcpWorkspaceIdentityPath(String(options.dir).trim());
    if (!String(options.dir).trim() || String(options.dir).includes('\0')) {
        throw new Error('Cloudflare edge backup directory is invalid.');
    }
    const context = Object.freeze({ dir: absoluteDir, io: options.io });
    return Object.freeze({
        /** @param {Record<string, unknown> & {ok?:boolean}} snapshot @param {{label?:string;includeSnapshot?:boolean;now?:Date}} [writeOptions] */
        write: (snapshot, writeOptions = {}) => writeCloudflareEdgeBackupBound(context, snapshot, writeOptions),
        /** @param {CloudflareEdgeBackupListOptions} [listOptions] */
        list: (listOptions = {}) => listCloudflareEdgeBackupsBound(context, listOptions),
    });
}

/**
 * @param {Record<string, unknown> & { ok?: boolean }} snapshot
 * @param {{ label?: string; includeSnapshot?: boolean; now?: Date }} [options]
 * @returns {Promise<Record<string, unknown> & { ok: boolean }>}
 */
export async function writeCloudflareEdgeBackup(snapshot, options = {}) {
    return CLOUDFLARE_EDGE_BACKUP_STORE.write(snapshot, options);
}

/**
 * @param {CloudflareEdgeBackupListOptions} [options]
 * @returns {Promise<Record<string, unknown> & { ok: boolean }>}
 */
export async function listCloudflareEdgeBackups(options = {}) {
    return CLOUDFLARE_EDGE_BACKUP_STORE.list(options);
}

/**
 * @param {{dir:string;io:ConfiguredFsIo}} context
 * @param {Record<string, unknown> & { ok?: boolean }} snapshot
 * @param {{ label?: string; includeSnapshot?: boolean; now?: Date }} options
 */
async function writeCloudflareEdgeBackupBound(context, snapshot, options) {
    const now = options.now ?? new Date();
    const label = normalizeBackupLabel(options.label);
    const fileName = buildCloudflareEdgeBackupFileName(now, label);
    const absolutePath = resolveBoundBackupPath(context.dir, fileName);
    const relativePath = normalizeRelativePath(absolutePath);
    const snapshotJson = `${JSON.stringify(snapshot, null, 2)}\n`;
    const snapshotSha256 = sha256(snapshotJson);
    const payload = {
        schemaVersion: BACKUP_SCHEMA_VERSION,
        kind: BACKUP_KIND,
        createdAt: now.toISOString(),
        mode: 'local-json-backup',
        appliesChanges: false,
        backup: { label, fileName, relativePath, snapshotSha256 },
        snapshot,
    };
    const content = `${JSON.stringify(payload, null, 2)}\n`;
    const contentSha256 = sha256(content);
    await context.io.writeFileAtomic(absolutePath, content, { mode: 0o600 });

    const readiness = asRecord(snapshot['readiness']);
    const policyDiff = asRecord(snapshot['policyDiff']);
    const summary = asRecord(policyDiff['summary']);
    return {
        ok: snapshot.ok === true,
        success: true,
        mode: 'local-json-backup',
        appliesChanges: false,
        backupWritten: true,
        backup: { label, fileName, relativePath, snapshotSha256, contentSha256 },
        snapshotSummary: {
            capturedAt: snapshot['capturedAt'] ?? null,
            endpoint: snapshot['endpoint'] ?? null,
            readiness,
            policyDiffSummary: summary,
        },
        nextActions: [
            'Keep this backup before any Cloudflare ruleset mutation.',
            'Run edge-policy-diff after any dashboard/API change and compare with this snapshot.',
            'Do not delete old backups until the connector has passed smoke-refresh after the change.',
        ],
        ...(options.includeSnapshot === true ? { snapshot } : {}),
    };
}

/** @param {{dir:string;io:ConfiguredFsIo}} context @param {CloudflareEdgeBackupListOptions} options */
async function listCloudflareEdgeBackupsBound(context, options) {
    const limit = normalizeLimit(options.limit);
    let entries;
    try {
        entries = (await context.io.listDirectoryNamesFresh(context.dir)).entries;
    } catch (error) {
        if (isMissingBackupPathError(error)) {
            return {
                ok: true,
                success: true,
                mode: 'local-json-backup-list',
                directory: normalizeRelativePath(context.dir),
                backups: [],
                total: 0,
            };
        }
        throw error;
    }

    const backups = [];
    for (const entryName of entries) {
        if (!entryName.endsWith('.json')) continue;
        const absolutePath = resolveBoundBackupPath(context.dir, entryName);
        try {
            const { stats } = await context.io.lstatPath(absolutePath);
            if (!stats.isFile()) continue;
            backups.push(await summarizeBackupFile(context.io, absolutePath, stats.size, stats.mtime.toISOString()));
        } catch (error) {
            // Concurrent retention may remove a candidate between listing and lstat; symlink candidates are never read.
            if (isMissingBackupPathError(error) || isConfiguredSymlinkError(error)) continue;
            throw error;
        }
    }
    backups.sort((left, right) => String(right['createdAt']).localeCompare(String(left['createdAt'])));
    return {
        ok: true,
        success: true,
        mode: 'local-json-backup-list',
        directory: normalizeRelativePath(context.dir),
        backups: backups.slice(0, limit),
        total: backups.length,
        limit,
    };
}

/**
 * @param {Date} now
 * @param {string | null} label
 * @returns {string}
 */
export function buildCloudflareEdgeBackupFileName(now, label) {
    const timestamp = now.toISOString().replace(/[:.]/gu, '-');
    return label ? `cloudflare-edge-snapshot-${timestamp}-${label}.json` : `cloudflare-edge-snapshot-${timestamp}.json`;
}

/**
 * @param {string | undefined} label
 * @returns {string | null}
 */
function normalizeBackupLabel(label) {
    const value = String(label ?? '')
        .trim()
        .toLowerCase();
    if (!value) return null;
    const normalized = value
        .replace(/[^a-z0-9._-]+/gu, '-')
        .replace(/^-+|-+$/gu, '')
        .slice(0, 48);
    return normalized || null;
}

/**
 * @param {number | undefined} limit
 * @returns {number}
 */
function normalizeLimit(limit) {
    if (limit === undefined) return 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
        throw new Error('Cloudflare edge backup list limit must be an integer between 1 and 200.');
    }
    return limit;
}

/**
 * @param {ConfiguredFsIo} io
 * @param {string} absolutePath
 * @param {number} bytes
 * @param {string} modifiedAt
 * @returns {Promise<Record<string, unknown>>}
 */
async function summarizeBackupFile(io, absolutePath, bytes, modifiedAt) {
    try {
        const parsed = JSON.parse((await io.readTextFresh(absolutePath)).content);
        const record = asRecord(parsed);
        const backup = asRecord(record['backup']);
        const snapshot = asRecord(record['snapshot']);
        return {
            fileName: path.basename(absolutePath),
            relativePath: normalizeRelativePath(absolutePath),
            bytes,
            modifiedAt,
            valid: record['schemaVersion'] === BACKUP_SCHEMA_VERSION && record['kind'] === BACKUP_KIND,
            createdAt: typeof record['createdAt'] === 'string' ? record['createdAt'] : modifiedAt,
            label: backup['label'] ?? null,
            snapshotSha256: backup['snapshotSha256'] ?? null,
            endpoint: snapshot['endpoint'] ?? null,
            readiness: snapshot['readiness'] ?? null,
        };
    } catch (error) {
        return {
            fileName: path.basename(absolutePath),
            relativePath: normalizeRelativePath(absolutePath),
            bytes,
            modifiedAt,
            valid: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

/**
 * Resolve one backup child beneath the store root without permitting traversal or absolute redirection.
 * @param {string} boundDir
 * @param {string} fileName
 */
function resolveBoundBackupPath(boundDir, fileName) {
    const absolutePath = path.resolve(boundDir, fileName);
    const relative = path.relative(boundDir, absolutePath);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error('Cloudflare edge backup path escaped its bound directory.');
    }
    return absolutePath;
}

/** @param {unknown} error */
function errorCode(error) {
    return error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
}

/** @param {unknown} error */
function isMissingBackupPathError(error) {
    const code = errorCode(error);
    return code === 'ENOENT' || code === 'ENOTDIR';
}

/** @param {unknown} error */
function isConfiguredSymlinkError(error) {
    return errorCode(error) === 'ERR_CONFIGURED_FS_SYMLINK';
}

/**
 * @param {string} content
 * @returns {string}
 */
function sha256(content) {
    return createHash('sha256').update(content).digest('hex');
}

/**
 * @param {string} absolutePath
 * @returns {string}
 */
function normalizeRelativePath(absolutePath) {
    const relative = toMcpWorkspaceRelativePath(absolutePath);
    return relative !== '.' && !relative.startsWith('..') ? relative : absolutePath;
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? /** @type {Record<string, unknown>} */ (value)
        : {};
}
