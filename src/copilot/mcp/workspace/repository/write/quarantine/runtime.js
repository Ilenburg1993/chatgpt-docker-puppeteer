// @ts-check
/** Reversible repository quarantine transaction, journal, reconcile and recovery semantics. */

import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import {
    pathExists,
    regularFileExists,
    repoWriteListDirectoryNames,
    repoWriteStat,
    throwIfRepoWriteAborted,
} from '../runtime.js';

/** @typedef {import('../contracts.js').RepoWriteRuntime} RepoWriteRuntime */
/** @typedef {import('../contracts.js').RepoWriteIo} RepoWriteIo */
/** @typedef {import('../contracts.js').QuarantineMetadata} QuarantineMetadata */

const MAX_QUARANTINE_ID_LENGTH = 192;

export const quarantineIdSchema = z
    .string()
    .min(1)
    .max(MAX_QUARANTINE_ID_LENGTH)
    ['regex'](/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, 'quarantineId must be a safe basename');

const quarantineTransactionSchema = z.object({
    kind: z.enum(['quarantine', 'restore']),
    destinationPath: z.string().min(1).max(4096).nullable(),
    backupPath: z.string().min(1).max(4096).nullable(),
    destinationExisted: z.boolean(),
});

const quarantineMetadataSchema = z.object({
    quarantineId: quarantineIdSchema,
    originalPath: z.string().min(1).max(4096),
    quarantinePath: z.string().min(1).max(4096),
    metadataPath: z.string().min(1).max(4096),
    createdAt: z.string()['datetime'](),
    status: z.enum(['quarantining', 'quarantined', 'restoring', 'restored']),
    restoredAt: z.string()['datetime']().nullable(),
    restoredPath: z.string().min(1).max(4096).nullable(),
    sourceBytes: z.number().int().nonnegative(),
    sourceHash: z
        .string()
        ['regex'](/^[a-f0-9]{64}$/)
        .nullable(),
    transaction: quarantineTransactionSchema.nullable().optional(),
});

const MAX_QUARANTINE_METADATA_BYTES = 128 * 1024;

/**
 * @param {string} candidate
 * @returns {boolean}
 */
function isCanonicalWorkspaceRelativePath(/** @type {RepoWriteRuntime} */ runtime, candidate) {
    if (path.isAbsolute(candidate) || candidate !== path.normalize(candidate)) return false;
    const root = path.resolve(runtime.workspaceRoot);
    const resolved = path.resolve(root, candidate);
    const relative = path.relative(root, resolved);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * @param {string} quarantineId
 * @param {string | null} backupPath
 * @returns {boolean}
 */
function isCanonicalQuarantineBackupPath(/** @type {RepoWriteRuntime} */ runtime, quarantineId, backupPath) {
    if (backupPath === null) return true;
    if (!isCanonicalWorkspaceRelativePath(runtime, backupPath)) return false;
    const resolved = path.resolve(runtime.workspaceRoot, backupPath);
    if (path.dirname(resolved) !== path.resolve(runtime.quarantineDir)) return false;
    return new RegExp(
        `^${quarantineId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.restore-backup-[a-f0-9-]{36}\\.data$`,
    ).test(path.basename(resolved));
}

/**
 * @param {string} filePath
 * @returns {string}
 */
export function buildQuarantineId(filePath) {
    const basename = (path.basename(filePath).replace(/[^a-zA-Z0-9._-]/g, '_') || 'file').slice(0, 96);
    return `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}-${basename}`;
}

/**
 * @param {string} quarantineId
 * @returns {{ dataPath: string; metadataPath: string }}
 */
export function resolveQuarantinePaths(/** @type {RepoWriteRuntime} */ runtime, quarantineId) {
    const normalized = quarantineIdSchema.parse(quarantineId);
    return {
        dataPath: path.join(runtime.quarantineDir, `${normalized}.data`),
        metadataPath: path.join(runtime.quarantineDir, `${normalized}.json`),
    };
}

/**
 * @param {RepoWriteIo} io
 * @param {QuarantineMetadata} metadata
 * @param {string} metadataPath
 * @param {AbortSignal | undefined} [signal]
 * @returns {Promise<void>}
 */
export async function writeQuarantineMetadataDefault(io, metadata, metadataPath, signal) {
    await io.createOrReplaceFileAtomic(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, {
        createParentDirs: true,
        mode: 0o600,
        riskClass: 'high',
        ...(signal ? { signal } : {}),
        advisoryLimits: {
            operation: 'quarantineMetadata',
            quarantineId: metadata.quarantineId,
            status: metadata.status,
        },
    });
}

/**
 * @param {QuarantineMetadata} metadata
 * @param {string} metadataPath
 * @returns {Promise<void>}
 */
async function writeQuarantineMetadata(/** @type {RepoWriteRuntime} */ runtime, metadata, metadataPath) {
    throwIfRepoWriteAborted(runtime);
    await runtime.quarantineMetadataWriter(runtime.io, metadata, metadataPath, runtime.signal);
}

/**
 * Cancellation-shielded metadata repair used only after a forward mutation has already changed state.
 * @param {RepoWriteRuntime} runtime
 * @param {QuarantineMetadata} metadata
 * @param {string} metadataPath
 */
async function writeQuarantineMetadataRecovery(runtime, metadata, metadataPath) {
    await runtime.quarantineMetadataWriter(runtime.io, metadata, metadataPath, undefined);
}

/**
 * @param {string} filePath
 * @returns {Promise<void>}
 */
async function removeFileIfPresent(/** @type {RepoWriteRuntime} */ runtime, filePath) {
    try {
        await runtime.io.deleteFileLocked(filePath, { captureRollback: false });
    } catch (error) {
        const code = /** @type {{ code?: unknown }} */ (error)?.code;
        if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
    }
}

/**
 * @param {string} filePath
 * @returns {Promise<void>}
 */
async function removeRegularFileIfPresent(/** @type {RepoWriteRuntime} */ runtime, filePath) {
    if (!(await pathExists(runtime, filePath))) return;
    if (!(await regularFileExists(runtime, filePath))) {
        const error = /** @type {Error & { code?: string }} */ (
            new Error(`Refusing to remove non-regular quarantine artifact: ${filePath}`)
        );
        error.code = 'ERR_QUARANTINE_ARTIFACT_INVALID';
        throw error;
    }
    await runtime.io.deleteFileLocked(filePath, { captureRollback: false });
}

/**
 * @param {unknown} primaryError
 * @param {unknown} rollbackError
 * @param {string} operation
 * @returns {Error & { code?: string }}
 */
function createQuarantineRollbackError(primaryError, rollbackError, operation) {
    const error = /** @type {Error & { code?: string }} */ (
        new Error(
            `${operation} failed and rollback also failed: ${
                primaryError instanceof Error ? primaryError.message : String(primaryError)
            }; rollback: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
            { cause: primaryError },
        )
    );
    error.code = 'ERR_QUARANTINE_ROLLBACK_FAILED';
    return error;
}

/**
 * @param {string} metadataPath
 * @returns {Promise<QuarantineMetadata | null>}
 */
async function readQuarantineMetadataFile(/** @type {RepoWriteRuntime} */ runtime, metadataPath) {
    try {
        const snapshot = await runtime.io.readBytesRangeFresh(metadataPath, {
            maxBytes: MAX_QUARANTINE_METADATA_BYTES,
            rejectSymlink: true,
        });
        if (!snapshot.isFile || snapshot.truncatedAfter) return null;
        const parsed = JSON.parse(snapshot.content.toString('utf8'));
        const validation = quarantineMetadataSchema.safeParse(parsed);
        if (!validation.success) return null;
        const metadata = /** @type {QuarantineMetadata} */ ({
            ...validation.data,
            transaction: validation.data.transaction ?? null,
        });
        const expectedPaths = resolveQuarantinePaths(runtime, metadata.quarantineId);
        if (path.resolve(metadataPath) !== path.resolve(expectedPaths.metadataPath)) return null;
        if (metadata.metadataPath !== runtime.workspace.toRelativePath(expectedPaths.metadataPath)) return null;
        if (metadata.quarantinePath !== runtime.workspace.toRelativePath(expectedPaths.dataPath)) return null;
        if (!isCanonicalWorkspaceRelativePath(runtime, metadata.originalPath)) return null;
        if (metadata.restoredPath !== null && !isCanonicalWorkspaceRelativePath(runtime, metadata.restoredPath))
            return null;
        if (metadata.transaction?.kind === 'quarantine') {
            if (
                metadata.transaction.destinationPath !== null ||
                metadata.transaction.backupPath !== null ||
                metadata.transaction.destinationExisted
            ) {
                return null;
            }
        } else if (metadata.transaction?.kind === 'restore') {
            if (
                metadata.transaction.destinationPath === null ||
                !isCanonicalWorkspaceRelativePath(runtime, metadata.transaction.destinationPath)
            ) {
                return null;
            }
        }
        if (
            !isCanonicalQuarantineBackupPath(runtime, metadata.quarantineId, metadata.transaction?.backupPath ?? null)
        ) {
            return null;
        }
        if (metadata.status === 'quarantining' && metadata.transaction?.kind !== 'quarantine') return null;
        if (metadata.status === 'quarantined' && metadata.transaction !== null) return null;
        if (metadata.status === 'restoring' && metadata.transaction?.kind !== 'restore') return null;
        if (metadata.status === 'restored' && metadata.transaction?.kind === 'quarantine') return null;
        return metadata;
    } catch (error) {
        const code = /** @type {{ code?: unknown }} */ (error)?.code;
        if (code === 'ENOENT' || code === 'ENOTDIR' || error instanceof SyntaxError) return null;
        throw error;
    }
}

/**
 * @param {string} quarantineId
 * @returns {Promise<QuarantineMetadata | null>}
 */
export async function readQuarantineMetadata(/** @type {RepoWriteRuntime} */ runtime, quarantineId) {
    const parsedId = quarantineIdSchema.safeParse(quarantineId);
    if (!parsedId.success) return null;
    const paths = resolveQuarantinePaths(runtime, parsedId.data);
    const { value } = await runtime.io.withIoResourceLock(
        paths.metadataPath,
        async () => {
            const metadata = await readQuarantineMetadataFile(runtime, paths.metadataPath);
            if (!metadata || metadata.quarantineId !== parsedId.data) return null;
            return reconcileQuarantineMetadata(runtime, metadata, paths);
        },
        {
            ...(runtime.signal ? { signal: runtime.signal } : {}),
            operation: 'quarantine-reconcile',
            target: paths.metadataPath,
            riskClass: 'high',
        },
    );
    return value;
}

/**
 * @returns {Promise<QuarantineMetadata[]>}
 */
export async function listQuarantineMetadata(/** @type {RepoWriteRuntime} */ runtime) {
    const entries = await repoWriteListDirectoryNames(runtime, runtime.quarantineDir).catch((error) => {
        const code = /** @type {{ code?: unknown }} */ (error)?.code;
        if (code === 'ENOENT' || code === 'ENOTDIR') return [];
        throw error;
    });
    /** @type {QuarantineMetadata[]} */
    const items = [];
    const metadataEntries = entries.filter((entry) => entry.endsWith('.json'));
    const batchSize = 32;
    for (let index = 0; index < metadataEntries.length; index += batchSize) {
        const batch = metadataEntries.slice(index, index + batchSize);
        const metadataBatch = await Promise.all(
            batch.map((entry) => readQuarantineMetadata(runtime, entry.slice(0, -'.json'.length))),
        );
        for (const metadata of metadataBatch) {
            if (metadata) items.push(metadata);
        }
    }
    return items.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

/**
 * @param {string} filePath
 * @returns {Promise<string>}
 */
export async function sha256File(/** @type {RepoWriteRuntime} */ runtime, filePath) {
    const snapshot = await runtime.io.readBytesFresh(filePath, { includeHash: true });
    return snapshot.contentHash ?? createHash('sha256').update(snapshot.content).digest('hex');
}

/**
 * @param {string} filePath
 * @param {QuarantineMetadata} metadata
 * @returns {Promise<boolean>}
 */
async function fileMatchesQuarantineMetadata(/** @type {RepoWriteRuntime} */ runtime, filePath, metadata) {
    if (!(await regularFileExists(runtime, filePath))) return false;
    const stats = await repoWriteStat(runtime, filePath);
    if (metadata.sourceBytes > 0 && stats.size !== metadata.sourceBytes) return false;
    if (metadata.sourceHash !== null && (await sha256File(runtime, filePath)) !== metadata.sourceHash) return false;
    return true;
}

/**
 * Reconciles a journal left by a process interruption. The caller must hold the metadata-path lock.
 *
 * @param {QuarantineMetadata} metadata
 * @param {{ dataPath: string; metadataPath: string }} quarantinePaths
 * @returns {Promise<QuarantineMetadata | null>}
 */
async function reconcileQuarantineMetadata(/** @type {RepoWriteRuntime} */ runtime, metadata, quarantinePaths) {
    if (metadata.status === 'quarantining') {
        const original = await runtime.workspace.resolveWritePath(metadata.originalPath);
        if (!original.ok) return metadata;
        const [dataExists, originalExists] = await Promise.all([
            regularFileExists(runtime, quarantinePaths.dataPath),
            pathExists(runtime, original.resolved),
        ]);
        if (dataExists && !originalExists) {
            const dataStats = await repoWriteStat(runtime, quarantinePaths.dataPath);
            const reconciled = /** @type {QuarantineMetadata} */ ({
                ...metadata,
                status: 'quarantined',
                sourceBytes: dataStats.size,
                sourceHash: await sha256File(runtime, quarantinePaths.dataPath),
                transaction: null,
            });
            await writeQuarantineMetadataRecovery(runtime, reconciled, quarantinePaths.metadataPath);
            return reconciled;
        }
        if (!dataExists && originalExists) {
            await removeFileIfPresent(runtime, quarantinePaths.metadataPath);
            return null;
        }
        return metadata;
    }

    if (metadata.status === 'restored' && metadata.transaction?.kind === 'restore') {
        const backupPath = metadata.transaction.backupPath;
        if (backupPath) {
            const backup = await runtime.workspace.resolveWritePath(backupPath);
            if (!backup.ok) return metadata;
            await removeRegularFileIfPresent(runtime, backup.resolved);
        }
        const reconciled = /** @type {QuarantineMetadata} */ ({ ...metadata, transaction: null });
        await writeQuarantineMetadataRecovery(runtime, reconciled, quarantinePaths.metadataPath);
        return reconciled;
    }

    if (metadata.status !== 'restoring' || metadata.transaction?.kind !== 'restore') {
        return metadata;
    }

    const destinationPath = metadata.transaction.destinationPath;
    if (!destinationPath) return metadata;
    const destination = await runtime.workspace.resolveWritePath(destinationPath);
    if (!destination.ok) return metadata;
    const backup = metadata.transaction.backupPath
        ? await runtime.workspace.resolveWritePath(metadata.transaction.backupPath)
        : null;
    if (backup && !backup.ok) return metadata;

    const [dataPresent, destinationExists, backupPresent] = await Promise.all([
        pathExists(runtime, quarantinePaths.dataPath),
        pathExists(runtime, destination.resolved),
        backup?.ok ? pathExists(runtime, backup.resolved) : Promise.resolve(false),
    ]);
    const dataExists = dataPresent ? await regularFileExists(runtime, quarantinePaths.dataPath) : false;
    if (dataPresent && !dataExists) return metadata;
    const backupExists = backup?.ok && backupPresent ? await regularFileExists(runtime, backup.resolved) : false;
    if (backupPresent && !backupExists) return metadata;
    if (dataExists && !(await fileMatchesQuarantineMetadata(runtime, quarantinePaths.dataPath, metadata))) {
        return metadata;
    }

    if (
        !dataExists &&
        destinationExists &&
        (await fileMatchesQuarantineMetadata(runtime, destination.resolved, metadata))
    ) {
        const committed = /** @type {QuarantineMetadata} */ ({
            ...metadata,
            status: 'restored',
            restoredAt: metadata.restoredAt ?? new Date().toISOString(),
        });
        await writeQuarantineMetadataRecovery(runtime, committed, quarantinePaths.metadataPath);
        if (backup?.ok && backupExists) await removeRegularFileIfPresent(runtime, backup.resolved);
        const reconciled = /** @type {QuarantineMetadata} */ ({ ...committed, transaction: null });
        await writeQuarantineMetadataRecovery(runtime, reconciled, quarantinePaths.metadataPath);
        return reconciled;
    }

    if (dataExists) {
        if (backup?.ok && backupExists && !destinationExists) {
            await runtime.io.moveFileLocked(backup.resolved, destination.resolved, { overwrite: false });
        } else if (backupExists || (!metadata.transaction.destinationExisted && destinationExists)) {
            return metadata;
        }
        const rolledBack = /** @type {QuarantineMetadata} */ ({
            ...metadata,
            status: 'quarantined',
            restoredAt: null,
            restoredPath: null,
            transaction: null,
        });
        await writeQuarantineMetadataRecovery(runtime, rolledBack, quarantinePaths.metadataPath);
        return rolledBack;
    }

    return metadata;
}

/**
 * @param {{ resolved: string; relative: string }} source
 * @returns {Promise<{ metadata: QuarantineMetadata; moved: Awaited<ReturnType<RepoWriteIo['moveFileLocked']>> }>}
 */
export async function quarantineResolvedFile(/** @type {RepoWriteRuntime} */ runtime, source) {
    const quarantineId = buildQuarantineId(source.relative);
    const quarantinePaths = resolveQuarantinePaths(runtime, quarantineId);
    /** @type {QuarantineMetadata} */
    const journal = {
        quarantineId,
        originalPath: source.relative,
        quarantinePath: runtime.workspace.toRelativePath(quarantinePaths.dataPath),
        metadataPath: runtime.workspace.toRelativePath(quarantinePaths.metadataPath),
        createdAt: new Date().toISOString(),
        status: 'quarantining',
        restoredAt: null,
        restoredPath: null,
        sourceBytes: 0,
        sourceHash: null,
        transaction: {
            kind: 'quarantine',
            destinationPath: null,
            backupPath: null,
            destinationExisted: false,
        },
    };

    const { value } = await runtime.io.withIoResourceLock(
        quarantinePaths.metadataPath,
        async () => {
            await writeQuarantineMetadata(runtime, journal, quarantinePaths.metadataPath);
            let moved;
            try {
                moved = await runtime.io.moveFileLocked(source.resolved, quarantinePaths.dataPath, {
                    overwrite: false,
                    ...(runtime.signal ? { signal: runtime.signal } : {}),
                });
            } catch (error) {
                await removeFileIfPresent(runtime, quarantinePaths.metadataPath).catch(() => undefined);
                throw error;
            }

            const metadata = /** @type {QuarantineMetadata} */ ({
                ...journal,
                status: 'quarantined',
                sourceBytes: moved.sourceBytes,
                sourceHash: moved.sourceHash,
                transaction: null,
            });
            try {
                await writeQuarantineMetadata(runtime, metadata, quarantinePaths.metadataPath);
            } catch (error) {
                try {
                    await runtime.io.moveFileLocked(quarantinePaths.dataPath, source.resolved, { overwrite: false });
                    await removeFileIfPresent(runtime, quarantinePaths.metadataPath);
                } catch (rollbackError) {
                    throw createQuarantineRollbackError(error, rollbackError, 'Quarantine metadata commit');
                }
                throw error;
            }
            return { metadata, moved };
        },
        {
            ...(runtime.signal ? { signal: runtime.signal } : {}),
            operation: 'quarantine-commit',
            target: quarantinePaths.metadataPath,
            riskClass: 'high',
        },
    );
    return value;
}

/**
 * @param {string} quarantineId
 * @param {{ resolved: string; relative: string }} destination
 * @param {boolean} overwrite
 * @returns {Promise<{
 *     metadata: QuarantineMetadata;
 *     restored: Awaited<ReturnType<RepoWriteIo['moveFileLocked']>>;
 *     destinationPreviousHash: string | null;
 *     destinationPreviousBytes: number | null;
 *     cleanupPending: boolean;
 * }>}
 */
export async function restoreQuarantinedFile(
    /** @type {RepoWriteRuntime} */ runtime,
    quarantineId,
    destination,
    overwrite,
) {
    const quarantinePaths = resolveQuarantinePaths(runtime, quarantineId);
    const { value } = await runtime.io.withIoResourceLock(
        quarantinePaths.metadataPath,
        async () => {
            const stored = await readQuarantineMetadataFile(runtime, quarantinePaths.metadataPath);
            const metadata = stored ? await reconcileQuarantineMetadata(runtime, stored, quarantinePaths) : null;
            if (!metadata) {
                const error = /** @type {Error & { code?: string }} */ (new Error('Quarantine metadata not found.'));
                error.code = 'ERR_QUARANTINE_NOT_FOUND';
                throw error;
            }
            if (metadata.status !== 'quarantined') {
                const error = /** @type {Error & { code?: string }} */ (
                    new Error('Quarantine item is not restorable.')
                );
                error.code = 'ERR_QUARANTINE_NOT_RESTORABLE';
                throw error;
            }
            if (!(await fileMatchesQuarantineMetadata(runtime, quarantinePaths.dataPath, metadata))) {
                const error = /** @type {Error & { code?: string }} */ (
                    new Error('Quarantine data is missing, unsafe or does not match its manifest.')
                );
                error.code = 'ERR_QUARANTINE_DATA_INVALID';
                throw error;
            }

            const destinationExists = await pathExists(runtime, destination.resolved);
            if (destinationExists && !overwrite) {
                const error = /** @type {Error & { code?: string }} */ (
                    new Error(`Destino ja existe: ${destination.relative}`)
                );
                error.code = 'EEXIST';
                throw error;
            }
            const backupPath = destinationExists
                ? path.join(runtime.quarantineDir, `${quarantineId}.restore-backup-${randomUUID()}.data`)
                : null;
            /** @type {QuarantineMetadata} */
            const journal = {
                ...metadata,
                status: 'restoring',
                restoredAt: new Date().toISOString(),
                restoredPath: destination.relative,
                transaction: {
                    kind: 'restore',
                    destinationPath: destination.relative,
                    backupPath: backupPath ? runtime.workspace.toRelativePath(backupPath) : null,
                    destinationExisted: destinationExists,
                },
            };
            await writeQuarantineMetadata(runtime, journal, quarantinePaths.metadataPath);

            let backupMoved = false;
            let dataMoved = false;
            /** @type {Awaited<ReturnType<RepoWriteIo['moveFileLocked']>> | null} */
            let backupMove = null;
            try {
                if (backupPath) {
                    backupMove = await runtime.io.moveFileLocked(destination.resolved, backupPath, {
                        overwrite: false,
                        ...(runtime.signal ? { signal: runtime.signal } : {}),
                    });
                    backupMoved = true;
                }
                const restored = await runtime.io.moveFileLocked(quarantinePaths.dataPath, destination.resolved, {
                    overwrite: false,
                    ...(runtime.signal ? { signal: runtime.signal } : {}),
                });
                dataMoved = true;
                const committed = /** @type {QuarantineMetadata} */ ({ ...journal, status: 'restored' });
                await writeQuarantineMetadata(runtime, committed, quarantinePaths.metadataPath);

                let cleanupPending = false;
                try {
                    if (backupPath) await removeRegularFileIfPresent(runtime, backupPath);
                    await writeQuarantineMetadata(
                        runtime,
                        /** @type {QuarantineMetadata} */ ({ ...committed, transaction: null }),
                        quarantinePaths.metadataPath,
                    );
                } catch {
                    cleanupPending = true;
                }
                return {
                    metadata: /** @type {QuarantineMetadata} */ ({
                        ...committed,
                        transaction: cleanupPending ? committed.transaction : null,
                    }),
                    restored,
                    destinationPreviousHash: backupMove?.sourceHash ?? null,
                    destinationPreviousBytes: backupMove?.sourceBytes ?? null,
                    cleanupPending,
                };
            } catch (error) {
                try {
                    if (dataMoved) {
                        await runtime.io.moveFileLocked(destination.resolved, quarantinePaths.dataPath, {
                            overwrite: false,
                        });
                    }
                    if (backupMoved && backupPath) {
                        await runtime.io.moveFileLocked(backupPath, destination.resolved, { overwrite: false });
                    }
                    await writeQuarantineMetadataRecovery(runtime, metadata, quarantinePaths.metadataPath);
                } catch (rollbackError) {
                    throw createQuarantineRollbackError(error, rollbackError, 'Quarantine restore');
                }
                throw error;
            }
        },
        {
            ...(runtime.signal ? { signal: runtime.signal } : {}),
            operation: 'quarantine-restore',
            target: quarantinePaths.metadataPath,
            riskClass: 'high',
        },
    );
    return value;
}
