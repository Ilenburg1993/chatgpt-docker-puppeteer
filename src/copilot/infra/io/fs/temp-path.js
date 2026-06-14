// @ts-check
/**
 * Nomes temporários irmãos para publicação atômica no mesmo filesystem.
 *
 * @module copilot/infra/io/fs/temp-path
 */

import { createHash, randomBytes } from 'node:crypto';
import { opendir, stat, unlink } from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';

const TEMP_TOKEN_BYTES = 16;
const MAX_TEMP_ENTRY_BYTES = 240;
const TEMP_ROLE_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
const MANAGED_TEMP_ROLE_PATTERN = /^(copy|move|write)$/;
const MANAGED_TEMP_ENTRY_PATTERN =
    /^\.(.+)\.([a-f0-9]{12})\.(\d+)\.([a-f0-9]{32})\.(copy|move|write)\.tmp$/;
const DEFAULT_CLEANUP_MIN_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CLEANUP_MAX_SCANNED = 10_000;
const MAX_PREPARED_DIRECTORIES = 1_024;
const LOCAL_TEMP_HOST_ID = createHash('sha256').update(hostname()).digest('hex').slice(0, 12);
/** @type {Map<string, Promise<void>>} */
const preparedDirectories = new Map();

/**
 * Mantém o prefixo UTF-8 dentro do orçamento sem cortar um code point.
 *
 * @param {string} value
 * @param {number} maxBytes
 * @returns {string}
 */
function truncateUtf8Prefix(value, maxBytes) {
    if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
    let result = '';
    let bytes = 0;
    for (const character of value) {
        const characterBytes = Buffer.byteLength(character, 'utf8');
        if (bytes + characterBytes > maxBytes) break;
        result += character;
        bytes += characterBytes;
    }
    return result;
}

/**
 * Cria um nome oculto no diretório do destino. A criação exclusiva continua
 * sendo a autoridade final para detectar uma colisão.
 *
 * @param {string} targetPath
 * @param {string} role
 * @returns {string}
 */
export function createSiblingTempPath(targetPath, role) {
    if (typeof targetPath !== 'string' || targetPath.length === 0) {
        throw new TypeError('targetPath deve ser um caminho não vazio.');
    }
    if (!TEMP_ROLE_PATTERN.test(role)) {
        throw new TypeError('role de temporário inválido.');
    }

    const token = randomBytes(TEMP_TOKEN_BYTES).toString('hex');
    const suffix = `.${LOCAL_TEMP_HOST_ID}.${process.pid}.${token}.${role}.tmp`;
    const basenameBudget = MAX_TEMP_ENTRY_BYTES - Buffer.byteLength(suffix, 'utf8') - 1;
    const basename = truncateUtf8Prefix(path.basename(targetPath), basenameBudget);
    return path.join(path.dirname(targetPath), `.${basename}${suffix}`);
}

/**
 * @param {string} entryName
 * @returns {{ basename: string; hostId: string; pid: number; token: string; role: 'copy' | 'move' | 'write' } | null}
 */
export function parseSiblingTempEntry(entryName) {
    const match = MANAGED_TEMP_ENTRY_PATTERN.exec(entryName);
    if (!match) return null;
    const [, basename, hostId, rawPid, token, role] = match;
    const pid = Number(rawPid);
    if (!basename || !hostId || !token || !MANAGED_TEMP_ROLE_PATTERN.test(role ?? '') || !Number.isSafeInteger(pid)) {
        return null;
    }
    return {
        basename,
        hostId,
        pid,
        token,
        role: /** @type {'copy' | 'move' | 'write'} */ (role),
    };
}

/**
 * @param {number} pid
 */
function isLocalProcessAlive(pid) {
    if (pid === process.pid) return true;
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return String(/** @type {{ code?: unknown }} */ (error)?.code ?? '') !== 'ESRCH';
    }
}

/**
 * Remove somente temporários canônicos antigos, pertencentes ao host local e sem PID vivo.
 *
 * @param {{
 *     directory: string;
 *     minimumAgeMs?: number;
 *     foreignHostMinimumAgeMs?: number;
 *     maxScannedEntries?: number;
 *     nowMs?: number;
 *     hostId?: string;
 *     isProcessAlive?: (pid: number) => boolean;
 * }} options
 */
export async function cleanupStaleSiblingTemps(options) {
    const directory = path.resolve(options.directory);
    const minimumAgeMs =
        Number.isFinite(options.minimumAgeMs) && Number(options.minimumAgeMs) >= 0
            ? Number(options.minimumAgeMs)
            : DEFAULT_CLEANUP_MIN_AGE_MS;
    const foreignHostMinimumAgeMs =
        Number.isFinite(options.foreignHostMinimumAgeMs) && Number(options.foreignHostMinimumAgeMs) >= minimumAgeMs
            ? Number(options.foreignHostMinimumAgeMs)
            : Number.POSITIVE_INFINITY;
    const maxScannedEntries =
        Number.isInteger(options.maxScannedEntries) && Number(options.maxScannedEntries) > 0
            ? Number(options.maxScannedEntries)
            : DEFAULT_CLEANUP_MAX_SCANNED;
    const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
    const localHostId = options.hostId ?? LOCAL_TEMP_HOST_ID;
    const processAlive = options.isProcessAlive ?? isLocalProcessAlive;
    const result = {
        directory,
        scanned: 0,
        matched: 0,
        removed: 0,
        skippedYoung: 0,
        skippedActive: 0,
        skippedForeignHost: 0,
        removedForeignHost: 0,
        failed: 0,
        limited: false,
    };

    const handle = await opendir(directory);
    try {
        for await (const entry of handle) {
            result.scanned += 1;
            if (result.scanned > maxScannedEntries) {
                result.limited = true;
                break;
            }
            if (!entry.isFile()) continue;
            const parsed = parseSiblingTempEntry(entry.name);
            if (!parsed) continue;
            result.matched += 1;

            const entryPath = path.join(directory, entry.name);
            try {
                const entryStat = await stat(entryPath);
                const ageMs = nowMs - entryStat.mtimeMs;
                if (parsed.hostId !== localHostId) {
                    if (ageMs < foreignHostMinimumAgeMs) {
                        result.skippedForeignHost += 1;
                        continue;
                    }
                    await unlink(entryPath);
                    result.removed += 1;
                    result.removedForeignHost += 1;
                    continue;
                }
                if (ageMs < minimumAgeMs) {
                    result.skippedYoung += 1;
                    continue;
                }
                if (processAlive(parsed.pid)) {
                    result.skippedActive += 1;
                    continue;
                }
                await unlink(entryPath);
                result.removed += 1;
            } catch {
                result.failed += 1;
            }
        }
    } finally {
        await handle.close().catch(() => undefined);
    }
    return result;
}

/**
 * Faz no máximo um scan bounded por diretório em cada processo antes da primeira publicação.
 *
 * @param {string} targetPath
 * @param {string} role
 */
export async function prepareSiblingTempPath(targetPath, role) {
    const directory = path.resolve(path.dirname(targetPath));
    let preparation = preparedDirectories.get(directory);
    if (!preparation) {
        if (preparedDirectories.size >= MAX_PREPARED_DIRECTORIES) {
            const oldestDirectory = preparedDirectories.keys().next().value;
            if (typeof oldestDirectory === 'string') preparedDirectories.delete(oldestDirectory);
        }
        preparation = cleanupStaleSiblingTemps({ directory })
            .then(() => undefined)
            .catch(() => {
                preparedDirectories.delete(directory);
            });
        preparedDirectories.set(directory, preparation);
    }
    await preparation;
    return createSiblingTempPath(targetPath, role);
}

export function resetSiblingTempCleanupForTest() {
    preparedDirectories.clear();
}
