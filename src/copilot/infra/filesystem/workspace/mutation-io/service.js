// @ts-check
/**
 * Mutating workspace IO facade.
 *
 * Mutation/write/lock dependencies are isolated here so read-only workspace consumers never pay their static closure.
 * Validated paths remain authority-bound and mutation operations retain advisory budget accounting.
 *
 * @module copilot/infra/filesystem/workspace/mutation-io/service
 */

import { withIoResourceLock } from '#copilot/infra/internal/concurrency/locks';
import {
    copyFileLocked,
    deleteFileLocked,
    moveFileLocked,
    patchTextBatchLocked,
    patchTextLocked,
    removePathLocked,
} from '#copilot/infra/internal/filesystem/mutation';
import {
    appendTextLocked,
    chmodFileLocked,
    createOrReplaceFileAtomic,
    mkdirPathLocked,
    openDetachedAppendSinkLocked,
    writeFileAtomic,
} from '#copilot/infra/internal/filesystem/write';
import { withIoTelemetryRuntimeOption } from '#copilot/infra/internal/telemetry';
import path from 'node:path';
import { resolveValidatedMutableWorkspacePath, resolveWorkspacePathAuthority } from '../authority/index.js';
import { requireValidatedWorkspaceReadPath, resolveWorkspacePath } from '../boundary/index.js';

/** @typedef {import('../boundary/index.js').WorkspaceIoContext} WorkspaceIoContext */
/** @typedef {import('../authority/index.js').ValidatedMutableWorkspacePath} ValidatedMutableWorkspacePath */
/** @typedef {import('../authority/index.js').ValidatedReadWorkspacePath} ValidatedReadWorkspacePath */
/** @typedef {import('../authority/index.js').WorkspacePathAuthority} WorkspacePathAuthority */
/** @typedef {ReturnType<typeof import('#copilot/infra/internal/telemetry').createIoTelemetryRuntime>} IoTelemetryRuntime */

/** @param {{operation:string;estimatedBytes?:number}} input @param {IoTelemetryRuntime|undefined} telemetryRuntime */
function beginRuntimeAdvisoryBudget(input, telemetryRuntime) {
    if (telemetryRuntime) return telemetryRuntime.advisoryBudget.begin(input);
    return Object.freeze({ id: 0, pressured: false, finish() {} });
}

/** @param {unknown[]} args */
function estimateMutationBytes(args) {
    const value = args[0];
    if (typeof value === 'string') return Buffer.byteLength(value);
    if (ArrayBuffer.isView(value)) return value.byteLength;
    if (value instanceof ArrayBuffer) return value.byteLength;
    if (value && typeof value === 'object' && 'newString' in value) {
        const replacement = /** @type {{ newString?: unknown }} */ (value).newString;
        if (typeof replacement === 'string') return Buffer.byteLength(replacement);
    }
    return 0;
}

/**
 * Attach internal runtime dependencies without mutating caller options.
 * @param {unknown[]} args
 * @param {number | null} optionsIndex
 * @param {unknown} invalidationBus
 * @param {IoTelemetryRuntime|undefined} telemetryRuntime
 * @param {ReturnType<typeof import('../../transaction/index.js').readIoRollbackPolicy>|undefined} rollbackPolicy
 * @param {typeof import('../../transaction/index.js').preflightIoCapacity|undefined} capacityPreflight
 */
function withRuntimeDependencies(
    args,
    optionsIndex,
    invalidationBus,
    telemetryRuntime,
    rollbackPolicy,
    capacityPreflight,
) {
    if (optionsIndex === null) return args;
    const callArgs = [...args];
    while (callArgs.length <= optionsIndex) callArgs.push(undefined);
    callArgs[optionsIndex] = withIoTelemetryRuntimeOption(
        {
            .../** @type {Record<string, unknown>} */ (callArgs[optionsIndex] ?? {}),
            ...(rollbackPolicy ? { rollbackPolicy } : {}),
            ...(capacityPreflight ? { capacityPreflight } : {}),
        },
        telemetryRuntime,
    );
    if (invalidationBus) callArgs.push(invalidationBus);
    return callArgs;
}

/**
 * @template {unknown[]} Args
 * @template Result
 * @param {(filePath: string, ...args: Args) => Promise<Result>} operation
 * @param {'append' | 'delete' | 'metadata' | 'mkdir' | 'patch' | 'write'} mode
 * @param {WorkspacePathAuthority} authority
 * @param {number | null} optionsIndex
 * @param {unknown} invalidationBus
 * @param {IoTelemetryRuntime|undefined} telemetryRuntime
 * @param {ReturnType<typeof import('../../transaction/index.js').readIoRollbackPolicy>|undefined} rollbackPolicy
 * @param {typeof import('../../transaction/index.js').preflightIoCapacity|undefined} capacityPreflight
 */
function bindWorkspaceMutationOperation(
    operation,
    mode,
    authority,
    optionsIndex,
    invalidationBus,
    telemetryRuntime,
    rollbackPolicy,
    capacityPreflight,
) {
    return /** @type {(filePath:string, ...args:Args)=>Promise<Result>} */ (
        async (filePath, ...args) => {
            const resolvedPath = await resolveWorkspacePath(filePath, mode, authority);
            const budget = beginRuntimeAdvisoryBudget(
                {
                    operation: `workspace.${mode}`,
                    estimatedBytes: estimateMutationBytes(args),
                },
                telemetryRuntime,
            );
            try {
                const callArgs = /** @type {Args} */ (
                    withRuntimeDependencies(
                        args,
                        optionsIndex,
                        invalidationBus,
                        telemetryRuntime,
                        rollbackPolicy,
                        capacityPreflight,
                    )
                );
                return await operation(resolvedPath, ...callArgs);
            } finally {
                budget.finish();
            }
        }
    );
}

/**
 * @template {unknown[]} Args
 * @template Result
 * @param {(filePath: string, ...args: Args) => Promise<Result>} operation
 * @param {'write' | 'patch' | 'metadata'} mode
 * @param {WorkspacePathAuthority} authority
 * @param {number | null} optionsIndex
 * @param {unknown} invalidationBus
 * @param {IoTelemetryRuntime|undefined} telemetryRuntime
 * @param {ReturnType<typeof import('../../transaction/index.js').readIoRollbackPolicy>|undefined} rollbackPolicy
 * @param {typeof import('../../transaction/index.js').preflightIoCapacity|undefined} capacityPreflight
 */
function bindValidatedMutableOperation(
    operation,
    mode,
    authority,
    optionsIndex,
    invalidationBus,
    telemetryRuntime,
    rollbackPolicy,
    capacityPreflight,
) {
    return /** @type {(capability:ValidatedMutableWorkspacePath, ...args:Args)=>Promise<Result>} */ (
        async (capability, ...args) => {
            const resolvedPath = resolveValidatedMutableWorkspacePath(capability, authority, mode);
            if (!resolvedPath) {
                const error = /** @type {Error & { code?: string }} */ (
                    new Error(
                        'Validated workspace mutable method requires an opaque mutable validated-path capability.',
                    )
                );
                error.code = 'EVALIDATEDMUTABLEPATHREQUIRED';
                throw error;
            }
            const budget = beginRuntimeAdvisoryBudget(
                {
                    operation: `workspace.${mode}.validated`,
                    estimatedBytes: estimateMutationBytes(args),
                },
                telemetryRuntime,
            );
            try {
                const callArgs = /** @type {Args} */ (
                    withRuntimeDependencies(
                        args,
                        optionsIndex,
                        invalidationBus,
                        telemetryRuntime,
                        rollbackPolicy,
                        capacityPreflight,
                    )
                );
                return await operation(resolvedPath, ...callArgs);
            } finally {
                budget.finish();
            }
        }
    );
}

/**
 * @param {typeof removePathLocked} operation
 * @param {WorkspacePathAuthority} authority
 * @param {ReturnType<typeof import('../../invalidation/bus/index.js').createIoInvalidationBusRuntime> | undefined} invalidationBus
 * @param {IoTelemetryRuntime|undefined} telemetryRuntime
 */
function bindWorkspaceRemovePathOperation(operation, authority, invalidationBus, telemetryRuntime) {
    return /** @type {(filePath:string, options?:Parameters<typeof removePathLocked>[1])=>ReturnType<typeof removePathLocked>} */ (
        async (filePath, options = {}) => {
            const resolvedPath = await resolveWorkspacePath(filePath, 'delete', authority);
            if (options.recursive && path.resolve(resolvedPath) === path.resolve(authority.workspaceRoot)) {
                const error = /** @type {Error & { code?: string }} */ (
                    new Error('Workspace IO refuses recursive removal of the workspace root.')
                );
                error.code = 'ERECURSIVEWORKSPACEROOT';
                throw error;
            }
            const budget = beginRuntimeAdvisoryBudget(
                {
                    operation: 'workspace.delete',
                },
                telemetryRuntime,
            );
            try {
                return await operation(
                    resolvedPath,
                    withIoTelemetryRuntimeOption(
                        {
                            ...options,
                            ...(options.recursive && options.recursiveConfirmation === filePath
                                ? { recursiveConfirmation: resolvedPath }
                                : {}),
                        },
                        telemetryRuntime,
                    ),
                    invalidationBus,
                );
            } finally {
                budget.finish();
            }
        }
    );
}

/**
 * @param {WorkspacePathAuthority} authority
 * @param {ReturnType<typeof import('../../invalidation/bus/index.js').createIoInvalidationBusRuntime> | undefined} invalidationBus
 * @param {IoTelemetryRuntime|undefined} telemetryRuntime
 * @param {ReturnType<typeof import('../../transaction/index.js').readIoRollbackPolicy>|undefined} rollbackPolicy
 * @param {typeof import('../../transaction/index.js').preflightIoCapacity|undefined} capacityPreflight
 */
function bindWorkspaceCopy(authority, invalidationBus, telemetryRuntime, rollbackPolicy, capacityPreflight) {
    return /** @type {(source:string,destination:string,options?:Parameters<typeof copyFileLocked>[2])=>ReturnType<typeof copyFileLocked>} */ (
        async (source, destination, options = {}) => {
            const [resolvedSource, resolvedDestination] = await Promise.all([
                resolveWorkspacePath(source, 'read', authority),
                resolveWorkspacePath(destination, 'write', authority),
            ]);
            const budget = beginRuntimeAdvisoryBudget(
                {
                    operation: 'workspace.read-write',
                },
                telemetryRuntime,
            );
            try {
                return await copyFileLocked(
                    resolvedSource,
                    resolvedDestination,
                    withIoTelemetryRuntimeOption(
                        {
                            ...options,
                            ...(rollbackPolicy ? { rollbackPolicy } : {}),
                            ...(capacityPreflight ? { capacityPreflight } : {}),
                        },
                        telemetryRuntime,
                    ),
                    invalidationBus,
                );
            } finally {
                budget.finish();
            }
        }
    );
}

/**
 * @param {WorkspacePathAuthority} authority
 * @param {ReturnType<typeof import('../../invalidation/bus/index.js').createIoInvalidationBusRuntime> | undefined} invalidationBus
 * @param {IoTelemetryRuntime|undefined} telemetryRuntime
 * @param {ReturnType<typeof import('../../transaction/index.js').readIoRollbackPolicy>|undefined} rollbackPolicy
 * @param {typeof import('../../transaction/index.js').preflightIoCapacity|undefined} capacityPreflight
 */
function bindValidatedWorkspaceCopy(authority, invalidationBus, telemetryRuntime, rollbackPolicy, capacityPreflight) {
    return /** @type {(sourceCapability:ValidatedReadWorkspacePath,destinationCapability:ValidatedMutableWorkspacePath,options?:Parameters<typeof copyFileLocked>[2])=>ReturnType<typeof copyFileLocked>} */ (
        async (sourceCapability, destinationCapability, options = {}) => {
            const source = requireValidatedWorkspaceReadPath(sourceCapability, 'read', authority);
            const destination = resolveValidatedMutableWorkspacePath(destinationCapability, authority, 'write');
            if (!destination) {
                const error = /** @type {Error & { code?: string }} */ (
                    new Error(
                        'Validated workspace copy requires opaque read-source and mutable-destination capabilities.',
                    )
                );
                error.code = 'EVALIDATEDPAIRREQUIRED';
                throw error;
            }
            const budget = beginRuntimeAdvisoryBudget(
                {
                    operation: 'workspace.read-write.validated',
                },
                telemetryRuntime,
            );
            try {
                return await copyFileLocked(
                    source,
                    destination,
                    withIoTelemetryRuntimeOption(
                        {
                            ...options,
                            ...(rollbackPolicy ? { rollbackPolicy } : {}),
                            ...(capacityPreflight ? { capacityPreflight } : {}),
                        },
                        telemetryRuntime,
                    ),
                    invalidationBus,
                );
            } finally {
                budget.finish();
            }
        }
    );
}

/**
 * @param {WorkspacePathAuthority} authority
 * @param {ReturnType<typeof import('../../invalidation/bus/index.js').createIoInvalidationBusRuntime> | undefined} invalidationBus
 * @param {IoTelemetryRuntime|undefined} telemetryRuntime
 * @param {ReturnType<typeof import('../../transaction/index.js').readIoRollbackPolicy>|undefined} rollbackPolicy
 * @param {typeof import('../../transaction/index.js').preflightIoCapacity|undefined} capacityPreflight
 */
function bindWorkspaceMove(authority, invalidationBus, telemetryRuntime, rollbackPolicy, capacityPreflight) {
    return /** @type {(source:string,destination:string,options?:Parameters<typeof moveFileLocked>[2])=>ReturnType<typeof moveFileLocked>} */ (
        async (source, destination, options = {}) => {
            const [resolvedSource, resolvedDestination] = await Promise.all([
                resolveWorkspacePath(source, 'move', authority),
                resolveWorkspacePath(destination, 'write', authority),
            ]);
            const budget = beginRuntimeAdvisoryBudget(
                {
                    operation: 'workspace.move-write',
                },
                telemetryRuntime,
            );
            try {
                return await moveFileLocked(
                    resolvedSource,
                    resolvedDestination,
                    withIoTelemetryRuntimeOption(
                        {
                            ...options,
                            ...(rollbackPolicy ? { rollbackPolicy } : {}),
                            ...(capacityPreflight ? { capacityPreflight } : {}),
                        },
                        telemetryRuntime,
                    ),
                    invalidationBus,
                );
            } finally {
                budget.finish();
            }
        }
    );
}

/**
 * @param {WorkspacePathAuthority} authority
 * @param {ReturnType<typeof import('../../invalidation/bus/index.js').createIoInvalidationBusRuntime> | undefined} invalidationBus
 * @param {IoTelemetryRuntime|undefined} telemetryRuntime
 * @param {ReturnType<typeof import('../../transaction/index.js').readIoRollbackPolicy>|undefined} rollbackPolicy
 * @param {typeof import('../../transaction/index.js').preflightIoCapacity|undefined} capacityPreflight
 */
function bindValidatedWorkspaceMove(authority, invalidationBus, telemetryRuntime, rollbackPolicy, capacityPreflight) {
    return /** @type {(sourceCapability:ValidatedMutableWorkspacePath,destinationCapability:ValidatedMutableWorkspacePath,options?:Parameters<typeof moveFileLocked>[2])=>ReturnType<typeof moveFileLocked>} */ (
        async (sourceCapability, destinationCapability, options = {}) => {
            const source = resolveValidatedMutableWorkspacePath(sourceCapability, authority, 'write');
            const destination = resolveValidatedMutableWorkspacePath(destinationCapability, authority, 'write');
            if (!source || !destination) {
                const error = /** @type {Error & { code?: string }} */ (
                    new Error('Validated workspace move requires opaque mutable source and destination capabilities.')
                );
                error.code = 'EVALIDATEDPAIRREQUIRED';
                throw error;
            }
            const budget = beginRuntimeAdvisoryBudget(
                {
                    operation: 'workspace.write-write.validated',
                },
                telemetryRuntime,
            );
            try {
                return await moveFileLocked(
                    source,
                    destination,
                    withIoTelemetryRuntimeOption(
                        {
                            ...options,
                            ...(rollbackPolicy ? { rollbackPolicy } : {}),
                            ...(capacityPreflight ? { capacityPreflight } : {}),
                        },
                        telemetryRuntime,
                    ),
                    invalidationBus,
                );
            } finally {
                budget.finish();
            }
        }
    );
}

/**
 * @param {WorkspaceIoContext | WorkspacePathAuthority} input
 * @param {{invalidationBus?: ReturnType<typeof import('../../invalidation/bus/index.js').createIoInvalidationBusRuntime>;telemetryRuntime?:IoTelemetryRuntime;rollbackPolicy?:ReturnType<typeof import('../../transaction/index.js').readIoRollbackPolicy>;capacityPreflight?:typeof import('../../transaction/index.js').preflightIoCapacity}} [options]
 */
export function createWorkspaceMutationIo(input, options = {}) {
    const authority = resolveWorkspacePathAuthority(input);
    const invalidationBus = options.invalidationBus;
    const telemetryRuntime = options.telemetryRuntime;
    const rollbackPolicy = options.rollbackPolicy;
    const capacityPreflight = options.capacityPreflight;
    return Object.freeze({
        appendTextLocked: bindWorkspaceMutationOperation(
            appendTextLocked,
            'append',
            authority,
            1,
            invalidationBus,
            telemetryRuntime,
            rollbackPolicy,
            capacityPreflight,
        ),
        chmodFileLocked: bindWorkspaceMutationOperation(
            chmodFileLocked,
            'metadata',
            authority,
            1,
            invalidationBus,
            telemetryRuntime,
            rollbackPolicy,
            capacityPreflight,
        ),
        chmodFileLockedValidated: bindValidatedMutableOperation(
            chmodFileLocked,
            'metadata',
            authority,
            1,
            invalidationBus,
            telemetryRuntime,
            rollbackPolicy,
            capacityPreflight,
        ),
        copyFileLocked: bindWorkspaceCopy(
            authority,
            invalidationBus,
            telemetryRuntime,
            rollbackPolicy,
            capacityPreflight,
        ),
        copyFileLockedValidated: bindValidatedWorkspaceCopy(
            authority,
            invalidationBus,
            telemetryRuntime,
            rollbackPolicy,
            capacityPreflight,
        ),
        createOrReplaceFileAtomic: bindWorkspaceMutationOperation(
            createOrReplaceFileAtomic,
            'write',
            authority,
            1,
            invalidationBus,
            telemetryRuntime,
            rollbackPolicy,
            capacityPreflight,
        ),
        createOrReplaceFileAtomicValidated: bindValidatedMutableOperation(
            createOrReplaceFileAtomic,
            'write',
            authority,
            1,
            invalidationBus,
            telemetryRuntime,
            rollbackPolicy,
            capacityPreflight,
        ),
        deleteFileLocked: bindWorkspaceMutationOperation(
            deleteFileLocked,
            'delete',
            authority,
            0,
            invalidationBus,
            telemetryRuntime,
            rollbackPolicy,
            capacityPreflight,
        ),
        mkdirPathLocked: bindWorkspaceMutationOperation(
            mkdirPathLocked,
            'mkdir',
            authority,
            0,
            invalidationBus,
            telemetryRuntime,
            rollbackPolicy,
            capacityPreflight,
        ),
        moveFileLocked: bindWorkspaceMove(
            authority,
            invalidationBus,
            telemetryRuntime,
            rollbackPolicy,
            capacityPreflight,
        ),
        moveFileLockedValidated: bindValidatedWorkspaceMove(
            authority,
            invalidationBus,
            telemetryRuntime,
            rollbackPolicy,
            capacityPreflight,
        ),
        openDetachedAppendSink: bindWorkspaceMutationOperation(
            openDetachedAppendSinkLocked,
            'append',
            authority,
            0,
            invalidationBus,
            telemetryRuntime,
            rollbackPolicy,
            capacityPreflight,
        ),
        patchTextBatchLocked: bindWorkspaceMutationOperation(
            patchTextBatchLocked,
            'patch',
            authority,
            0,
            invalidationBus,
            telemetryRuntime,
            rollbackPolicy,
            capacityPreflight,
        ),
        patchTextBatchLockedValidated: bindValidatedMutableOperation(
            patchTextBatchLocked,
            'patch',
            authority,
            0,
            invalidationBus,
            telemetryRuntime,
            rollbackPolicy,
            capacityPreflight,
        ),
        patchTextLocked: bindWorkspaceMutationOperation(
            patchTextLocked,
            'patch',
            authority,
            0,
            invalidationBus,
            telemetryRuntime,
            rollbackPolicy,
            capacityPreflight,
        ),
        patchTextLockedValidated: bindValidatedMutableOperation(
            patchTextLocked,
            'patch',
            authority,
            0,
            invalidationBus,
            telemetryRuntime,
            rollbackPolicy,
            capacityPreflight,
        ),
        removePathLocked: bindWorkspaceRemovePathOperation(
            removePathLocked,
            authority,
            invalidationBus,
            telemetryRuntime,
        ),
        withIoResourceLock: bindWorkspaceMutationOperation(
            withIoResourceLock,
            'write',
            authority,
            null,
            null,
            telemetryRuntime,
            rollbackPolicy,
            capacityPreflight,
        ),
        writeFileAtomic: bindWorkspaceMutationOperation(
            writeFileAtomic,
            'write',
            authority,
            1,
            invalidationBus,
            telemetryRuntime,
            rollbackPolicy,
            capacityPreflight,
        ),
        writeFileAtomicValidated: bindValidatedMutableOperation(
            writeFileAtomic,
            'write',
            authority,
            1,
            invalidationBus,
            telemetryRuntime,
            rollbackPolicy,
            capacityPreflight,
        ),
    });
}
