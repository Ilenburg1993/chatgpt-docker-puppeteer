// @ts-check
/**
 * Read-only workspace IO facade.
 *
 * This capability has no static dependency on mutation/write/lock implementations. String paths run canonical async
 * workspace policy immediately before IO; validated fast paths accept only tokens issued by the same authority.
 *
 * @module copilot/infra/filesystem/workspace/read-io/service
 */

import { diffTextWithReader } from '#copilot/infra/internal/filesystem/patch';
import {
    listDirectoryNamesFresh,
    listRegularFilesFresh,
    listWorkspaceTreeEntriesFresh,
    lstatPath,
    readBytes,
    readBytesFresh,
    readBytesRangeFresh,
    readLines,
    readText,
    readTextChunks,
    readTextFresh,
    statPath,
} from '#copilot/infra/internal/filesystem/read';
import { withIoTelemetryRuntimeOption } from '#copilot/infra/internal/telemetry';
import { resolveWorkspacePathAuthority } from '../authority/index.js';
import {
    requireValidatedWorkspaceReadPath,
    resolveWorkspaceLstatPath,
    resolveWorkspacePath,
} from '../boundary/index.js';

/** @typedef {import('../boundary/index.js').WorkspaceIoContext} WorkspaceIoContext */
/** @typedef {import('../authority/index.js').ValidatedReadWorkspacePath} ValidatedReadWorkspacePath */
/** @typedef {import('../authority/index.js').WorkspacePathAuthority} WorkspacePathAuthority */

/** @typedef {ReturnType<typeof import('#copilot/infra/internal/telemetry').createIoTelemetryRuntime>} IoTelemetryRuntime */
/** @template {unknown[]} Args @param {Args} args @param {IoTelemetryRuntime|undefined} telemetryRuntime @returns {Args} */
function withTelemetryArgs(args, telemetryRuntime) {
    if (!telemetryRuntime) return args;
    const callArgs = [...args];
    callArgs[0] = withIoTelemetryRuntimeOption(callArgs[0] ?? {}, telemetryRuntime);
    return /** @type {Args} */ (callArgs);
}

/**
 * @template {unknown[]} Args
 * @template Result
 * @param {(filePath: string, ...args: Args) => Promise<Result>} operation
 * @param {'read' | 'search' | 'stat' | 'scan'} mode
 * @param {WorkspacePathAuthority} authority
 * @param {IoTelemetryRuntime|undefined} telemetryRuntime
 */
function bindWorkspaceReadOperation(operation, mode, authority, telemetryRuntime) {
    return /** @type {(filePath:string, ...args:Args) => Promise<Result>} */ (
        async (filePath, ...args) =>
            operation(
                await resolveWorkspacePath(filePath, mode, authority),
                ...withTelemetryArgs(args, telemetryRuntime),
            )
    );
}

/**
 * Preserve the lexical final component so lstat observes a symlink rather than the target resolved by normal read
 * policy. The specialized boundary still canonicalizes every ancestor and rejects workspace escape.
 *
 * @template {unknown[]} Args
 * @template Result
 * @param {(filePath: string, ...args: Args) => Promise<Result>} operation
 * @param {WorkspacePathAuthority} authority
 * @param {IoTelemetryRuntime|undefined} telemetryRuntime
 */
function bindWorkspaceLstatOperation(operation, authority, telemetryRuntime) {
    return /** @type {(filePath:string, ...args:Args) => Promise<Result>} */ (
        async (filePath, ...args) =>
            operation(
                await resolveWorkspaceLstatPath(filePath, authority),
                ...withTelemetryArgs(args, telemetryRuntime),
            )
    );
}

/**
 * @template {unknown[]} Args
 * @template Result
 * @param {(filePath: string, ...args: Args) => Promise<Result>} operation
 * @param {'read' | 'search' | 'stat' | 'scan'} mode
 * @param {WorkspacePathAuthority} authority
 * @param {IoTelemetryRuntime|undefined} telemetryRuntime
 */
function bindValidatedReadOperation(operation, mode, authority, telemetryRuntime) {
    return /** @type {(capability:ValidatedReadWorkspacePath, ...args:Args) => Promise<Result>} */ (
        async (capability, ...args) =>
            operation(
                requireValidatedWorkspaceReadPath(capability, mode, authority),
                ...withTelemetryArgs(args, telemetryRuntime),
            )
    );
}

/**
 * @template {unknown[]} Args
 * @template Result
 * @param {(pathA: string, pathB: string, ...args: Args) => Promise<Result>} operation
 * @param {WorkspacePathAuthority} authority
 * @param {IoTelemetryRuntime|undefined} telemetryRuntime
 */
function bindWorkspaceReadPairOperation(operation, authority, telemetryRuntime) {
    return /** @type {(pathA:string, pathB:string, ...args:Args) => Promise<Result>} */ (
        async (pathA, pathB, ...args) =>
            operation(
                await resolveWorkspacePath(pathA, 'read', authority),
                await resolveWorkspacePath(pathB, 'read', authority),
                ...withTelemetryArgs(args, telemetryRuntime),
            )
    );
}

/**
 * @template {unknown[]} Args
 * @template Result
 * @param {(pathA: string, pathB: string, ...args: Args) => Promise<Result>} operation
 * @param {WorkspacePathAuthority} authority
 * @param {IoTelemetryRuntime|undefined} telemetryRuntime
 */
function bindValidatedReadPairOperation(operation, authority, telemetryRuntime) {
    return /** @type {(pathACapability:ValidatedReadWorkspacePath, pathBCapability:ValidatedReadWorkspacePath, ...args:Args) => Promise<Result>} */ (
        async (pathACapability, pathBCapability, ...args) =>
            operation(
                requireValidatedWorkspaceReadPath(pathACapability, 'read', authority),
                requireValidatedWorkspaceReadPath(pathBCapability, 'read', authority),
                ...withTelemetryArgs(args, telemetryRuntime),
            )
    );
}

/**
 * @template {Record<string, unknown>} OperationOptions
 * @template Result
 * @param {(filePath:string, options?:OperationOptions)=>Promise<Result>} operation
 * @param {'read'|'search'|'stat'|'scan'} mode
 * @param {WorkspacePathAuthority} authority
 * @param {{cacheRuntime?:{l1:ReturnType<typeof import('../../../cache/memory/index.js').createIoL1CacheRuntime>;l2:ReturnType<typeof import('../../../cache/l2/index.js').createIoL2CacheRuntime>};readRuntime?:ReturnType<typeof import('../../read/runtime/index.js').createIoReadRuntime>;telemetryRuntime?:IoTelemetryRuntime}} runtimeOptions
 * @param {{cache:boolean;read:boolean}} dependencies
 */
function bindRuntimeRead(operation, mode, authority, runtimeOptions, dependencies) {
    return /** @type {(filePath:string, operationOptions?:OperationOptions)=>Promise<Result>} */ (
        async (filePath, operationOptions = /** @type {OperationOptions} */ ({})) =>
            operation(
                await resolveWorkspacePath(filePath, mode, authority),
                withIoTelemetryRuntimeOption(
                    {
                        ...operationOptions,
                        ...(dependencies.cache && runtimeOptions.cacheRuntime
                            ? { cacheRuntime: runtimeOptions.cacheRuntime }
                            : {}),
                        ...(dependencies.read && runtimeOptions.readRuntime
                            ? { readRuntime: runtimeOptions.readRuntime }
                            : {}),
                    },
                    runtimeOptions.telemetryRuntime,
                ),
            )
    );
}

/**
 * @template {Record<string, unknown>} OperationOptions
 * @template Result
 * @param {(filePath:string, options?:OperationOptions)=>Promise<Result>} operation
 * @param {'read'|'search'|'stat'|'scan'} mode
 * @param {WorkspacePathAuthority} authority
 * @param {{cacheRuntime?:{l1:ReturnType<typeof import('../../../cache/memory/index.js').createIoL1CacheRuntime>;l2:ReturnType<typeof import('../../../cache/l2/index.js').createIoL2CacheRuntime>};readRuntime?:ReturnType<typeof import('../../read/runtime/index.js').createIoReadRuntime>;telemetryRuntime?:IoTelemetryRuntime}} runtimeOptions
 * @param {{cache:boolean;read:boolean}} dependencies
 */
function bindRuntimeValidatedRead(operation, mode, authority, runtimeOptions, dependencies) {
    return /** @type {(capability:ValidatedReadWorkspacePath, operationOptions?:OperationOptions)=>Promise<Result>} */ (
        async (capability, operationOptions = /** @type {OperationOptions} */ ({})) =>
            operation(
                requireValidatedWorkspaceReadPath(capability, mode, authority),
                withIoTelemetryRuntimeOption(
                    {
                        ...operationOptions,
                        ...(dependencies.cache && runtimeOptions.cacheRuntime
                            ? { cacheRuntime: runtimeOptions.cacheRuntime }
                            : {}),
                        ...(dependencies.read && runtimeOptions.readRuntime
                            ? { readRuntime: runtimeOptions.readRuntime }
                            : {}),
                    },
                    runtimeOptions.telemetryRuntime,
                ),
            )
    );
}

/**
 * @param {{
 *   cacheRuntime?:{l1:ReturnType<typeof import('#copilot/infra/internal/cache/memory/runtime').createIoL1CacheRuntime>;l2:ReturnType<typeof import('../../../cache/l2/index.js').createIoL2CacheRuntime>};
 *   readRuntime?:ReturnType<typeof import('../../read/runtime/index.js').createIoReadRuntime>;
 *   telemetryRuntime?:IoTelemetryRuntime;
 * }} runtimeOptions
 */
function createRuntimeDiffOperation(runtimeOptions) {
    /** @type {Parameters<typeof readText>[1]} */
    const readOptions = {};
    if (runtimeOptions.cacheRuntime) readOptions.cacheRuntime = runtimeOptions.cacheRuntime;
    if (runtimeOptions.readRuntime) readOptions.readRuntime = runtimeOptions.readRuntime;
    return /** @type {(pathA:string,pathB:string,diffOptions?:Parameters<typeof diffTextWithReader>[3])=>ReturnType<typeof diffTextWithReader>} */ (
        async (pathA, pathB, diffOptions = {}) =>
            diffTextWithReader(
                async (filePath) =>
                    readText(filePath, withIoTelemetryRuntimeOption(readOptions, runtimeOptions.telemetryRuntime)),
                pathA,
                pathB,
                diffOptions,
            )
    );
}

/**
 * @param {WorkspaceIoContext | WorkspacePathAuthority} input
 * @param {{
 *   cacheRuntime?:{l1:ReturnType<typeof import('../../../cache/memory/index.js').createIoL1CacheRuntime>;l2:ReturnType<typeof import('../../../cache/l2/index.js').createIoL2CacheRuntime>};
 *   readRuntime?:ReturnType<typeof import('../../read/runtime/index.js').createIoReadRuntime>;
 *   telemetryRuntime?:IoTelemetryRuntime;
 * }} [options]
 */
export function createWorkspaceReadIo(input, options = {}) {
    const authority = resolveWorkspacePathAuthority(input);
    const telemetryRuntime = options.telemetryRuntime;
    const runtimeDiffText = createRuntimeDiffOperation(options);
    return Object.freeze({
        diffText: bindWorkspaceReadPairOperation(runtimeDiffText, authority, telemetryRuntime),
        diffTextValidated: bindValidatedReadPairOperation(runtimeDiffText, authority, telemetryRuntime),
        listDirectoryNamesFresh: bindWorkspaceReadOperation(
            listDirectoryNamesFresh,
            'scan',
            authority,
            telemetryRuntime,
        ),
        listRegularFilesFresh: bindWorkspaceReadOperation(
            listRegularFilesFresh,
            'scan',
            authority,
            telemetryRuntime,
        ),
        listRegularFilesFreshValidated: bindValidatedReadOperation(
            listRegularFilesFresh,
            'scan',
            authority,
            telemetryRuntime,
        ),
        listWorkspaceTreeEntriesFresh: bindWorkspaceReadOperation(
            listWorkspaceTreeEntriesFresh,
            'scan',
            authority,
            telemetryRuntime,
        ),
        listWorkspaceTreeEntriesFreshValidated: bindValidatedReadOperation(
            listWorkspaceTreeEntriesFresh,
            'scan',
            authority,
            telemetryRuntime,
        ),
        lstatPath: bindWorkspaceLstatOperation(lstatPath, authority, telemetryRuntime),
        readBytes: bindRuntimeRead(readBytes, 'read', authority, options, { cache: true, read: false }),
        readBytesFresh: bindWorkspaceReadOperation(readBytesFresh, 'read', authority, telemetryRuntime),
        readBytesRangeFresh: bindWorkspaceReadOperation(readBytesRangeFresh, 'read', authority, telemetryRuntime),
        readBytesRangeFreshValidated: bindValidatedReadOperation(
            readBytesRangeFresh,
            'read',
            authority,
            telemetryRuntime,
        ),
        readBytesValidated: bindRuntimeValidatedRead(readBytes, 'read', authority, options, {
            cache: true,
            read: false,
        }),
        readLines: bindRuntimeRead(readLines, 'read', authority, options, { cache: true, read: true }),
        readText: bindRuntimeRead(readText, 'read', authority, options, { cache: true, read: true }),
        readTextChunks: bindRuntimeRead(readTextChunks, 'read', authority, options, { cache: false, read: true }),
        readTextChunksValidated: bindRuntimeValidatedRead(readTextChunks, 'read', authority, options, {
            cache: false,
            read: true,
        }),
        readTextFresh: bindWorkspaceReadOperation(readTextFresh, 'read', authority, telemetryRuntime),
        readTextValidated: bindRuntimeValidatedRead(readText, 'read', authority, options, { cache: true, read: true }),
        statPath: bindWorkspaceReadOperation(statPath, 'stat', authority, telemetryRuntime),
        statPathValidated: bindValidatedReadOperation(statPath, 'stat', authority, telemetryRuntime),
    });
}
