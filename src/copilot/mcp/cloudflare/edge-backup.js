// @ts-check
/**
 * Local Cloudflare edge snapshot backups for safe MCP operations.
 *
 * @module copilot/mcp/cloudflare/edge-backup
 */

import { writeFileAtomicPortable } from '#copilot/infra/public/io';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_CLOUDFLARE_EDGE_BACKUP_DIR } from './config.js';
import { buildCloudflareEdgeSnapshot } from './edge-snapshot.js';

const BACKUP_SCHEMA_VERSION = 1;
const BACKUP_KIND = 'cloudflare-edge-snapshot-backup';

/**
 * @typedef {object} CloudflareEdgeBackupOptions
 * @property {NodeJS.ProcessEnv} [env]
 * @property {Date} [now]
 * @property {string} [dir]
 * @property {string} [label]
 * @property {boolean} [includeSnapshot]
 */

/**
 * @typedef {object} CloudflareEdgeBackupListOptions
 * @property {string} [dir]
 * @property {number} [limit]
 */

/**
 * @param {CloudflareEdgeBackupOptions} [options]
 * @returns {Promise<Record<string, unknown> & { ok: boolean }>}
 */
export async function createCloudflareEdgeBackup(options = {}) {
    const childOptions = options.env ? { env: options.env } : {};
    const now = options.now ?? new Date();
    const snapshot = await buildCloudflareEdgeSnapshot({ ...childOptions, now });
    const backupOptions = {
        ...(typeof options.dir === 'string' ? { dir: options.dir } : {}),
        ...(typeof options.label === 'string' ? { label: options.label } : {}),
        ...(typeof options.includeSnapshot === 'boolean' ? { includeSnapshot: options.includeSnapshot } : {}),
        now,
    };
    return writeCloudflareEdgeBackup(snapshot, backupOptions);
}

/**
 * @param {Record<string, unknown> & { ok?: boolean }} snapshot
 * @param {{ dir?: string; label?: string; includeSnapshot?: boolean; now?: Date }} [options]
 * @returns {Promise<Record<string, unknown> & { ok: boolean }>}
 */
export async function writeCloudflareEdgeBackup(snapshot, options = {}) {
    const now = options.now ?? new Date();
    const dir = normalizeBackupDir(options.dir);
    const label = normalizeBackupLabel(options.label);
    const fileName = buildCloudflareEdgeBackupFileName(now, label);
    const absolutePath = path.resolve(dir, fileName);
    const relativePath = normalizeRelativePath(absolutePath);
    const snapshotJson = `${JSON.stringify(snapshot, null, 2)}\n`;
    const snapshotSha256 = sha256(snapshotJson);
    const payload = {
        schemaVersion: BACKUP_SCHEMA_VERSION,
        kind: BACKUP_KIND,
        createdAt: now.toISOString(),
        mode: 'local-json-backup',
        appliesChanges: false,
        backup: {
            label,
            fileName,
            relativePath,
            snapshotSha256,
        },
        snapshot,
    };
    const content = `${JSON.stringify(payload, null, 2)}\n`;
    const contentSha256 = sha256(content);
    await writeFileAtomicPortable(absolutePath, content, { mode: 0o600 });

    const readiness = asRecord(snapshot['readiness']);
    const policyDiff = asRecord(snapshot['policyDiff']);
    const summary = asRecord(policyDiff['summary']);
    return {
        ok: snapshot.ok === true,
        success: true,
        mode: 'local-json-backup',
        appliesChanges: false,
        backupWritten: true,
        backup: {
            label,
            fileName,
            relativePath,
            snapshotSha256,
            contentSha256,
        },
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

/**
 * @param {CloudflareEdgeBackupListOptions} [options]
 * @returns {Promise<Record<string, unknown> & { ok: boolean }>}
 */
export async function listCloudflareEdgeBackups(options = {}) {
    const dir = normalizeBackupDir(options.dir);
    const limit = normalizeLimit(options.limit);
    const absoluteDir = path.resolve(dir);
    let entries;
    try {
        entries = await readdir(absoluteDir, { withFileTypes: true });
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
            return {
                ok: true,
                success: true,
                mode: 'local-json-backup-list',
                directory: normalizeRelativePath(absoluteDir),
                backups: [],
                total: 0,
            };
        }
        throw error;
    }

    const backups = [];
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        const absolutePath = path.join(absoluteDir, entry.name);
        const fileStat = await stat(absolutePath);
        backups.push(await summarizeBackupFile(absolutePath, fileStat.size, fileStat.mtime.toISOString()));
    }
    backups.sort((left, right) => String(right['createdAt']).localeCompare(String(left['createdAt'])));
    return {
        ok: true,
        success: true,
        mode: 'local-json-backup-list',
        directory: normalizeRelativePath(absoluteDir),
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
 * @param {string | undefined} dir
 * @returns {string}
 */
function normalizeBackupDir(dir) {
    const value = String(dir ?? DEFAULT_CLOUDFLARE_EDGE_BACKUP_DIR).trim();
    if (!value || value.includes('\0')) throw new Error('Cloudflare edge backup directory is invalid.');
    return value;
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
 * @param {string} absolutePath
 * @param {number} bytes
 * @param {string} modifiedAt
 * @returns {Promise<Record<string, unknown>>}
 */
async function summarizeBackupFile(absolutePath, bytes, modifiedAt) {
    try {
        const parsed = JSON.parse(await readFile(absolutePath, 'utf8'));
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
    const relative = path.relative(process.cwd(), absolutePath);
    return relative && !relative.startsWith('..') ? relative : absolutePath;
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
