// @ts-check
/**
 * Least-privilege configured filesystem grants for trusted paths that may live outside a workspace.
 *
 * Grants are immutable authority descriptors. Their effective matcher and operation set stay private in a WeakMap;
 * consumers receive only a branded grant and a bound IO adapter. The current symlink policy is intentionally strict:
 * every existing path component must be a non-symlink.
 *
 * @module copilot/infra/filesystem/configured/service
 */

import { withConfiguredResourceLocks } from '#copilot/infra/internal/concurrency/locks/configured';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import {
    appendConfiguredText,
    chmodConfiguredFile,
    deleteConfiguredFile,
    listConfiguredDirectoryNamesFresh,
    lstatConfiguredPath,
    mkdirConfiguredPath,
    moveConfiguredFile,
    openConfiguredDetachedAppendSink,
    readConfiguredBytesFresh,
    readConfiguredBytesRangeFresh,
    readConfiguredTextFresh,
    statConfiguredPath,
    watchConfiguredPath,
    writeConfiguredFileAtomic,
} from './physical.js';

const CONFIGURED_FS_GRANT_BRAND = Symbol('copilot.infra.configured-fs-grant');
const VALID_OPERATIONS = new Set([
    'read',
    'stat',
    'list',
    'write',
    'mkdir',
    'delete',
    'watch',
    'chmod',
    'append',
    'move',
]);
const VALID_DURABILITY = new Set(['file-and-directory', 'file', 'none']);
/** @type {WeakMap<object,{roots:readonly string[];exactPaths:ReadonlySet<string>;operations:ReadonlySet<string>;durability:ReadonlySet<string>;symlinkPolicy:'deny'}>} */
const GRANT_INTERNALS = new WeakMap();

/** @param {string} candidate @param {string} root */
function isWithinRoot(candidate, root) {
    const rel = path.relative(root, candidate);
    return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

/** @param {string} candidate */
async function assertNoSymlinkComponents(candidate) {
    const absolute = path.resolve(candidate);
    const parsed = path.parse(absolute);
    const relativeParts = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
    let current = parsed.root;
    for (const part of relativeParts) {
        current = path.join(current, part);
        try {
            const stats = await lstat(current);
            if (stats.isSymbolicLink()) {
                const error = new Error(`Configured filesystem grant rejects symlink component: ${current}`);
                /** @type {{code?:string}} */ (error).code = 'ERR_CONFIGURED_FS_SYMLINK';
                throw error;
            }
        } catch (error) {
            const code = /** @type {{code?:unknown}} */ (error)?.code;
            if (code === 'ENOENT' || code === 'ENOTDIR') break;
            throw error;
        }
    }
}

/**
 * @typedef {'read'|'stat'|'list'|'write'|'mkdir'|'delete'|'watch'|'chmod'|'append'|'move'} ConfiguredFsOperation
 * @typedef {'file-and-directory'|'file'|'none'} ConfiguredFsDurability
 * @typedef {Readonly<{
 *   id:string;
 *   roots:readonly string[];
 *   exactPaths:readonly string[];
 *   operations:readonly ConfiguredFsOperation[];
 *   symlinkPolicy:'deny';
 *   durability:readonly ConfiguredFsDurability[];
 *   policyVersion:1;
 *   [CONFIGURED_FS_GRANT_BRAND]:true;
 * }>} ConfiguredFsGrant
 */

/**
 * @typedef {{traceId?:string;signal?:AbortSignal;includeHash?:boolean;advisoryLimits?:Record<string,unknown>;maxRetries?:number}} ConfiguredTextReadOptions
 * @typedef {ConfiguredTextReadOptions} ConfiguredBytesReadOptions
 * @typedef {{start?:number;maxBytes:number;fromEnd?:boolean;rejectSymlink?:boolean;traceId?:string;advisoryLimits?:Record<string,unknown>;signal?:AbortSignal;maxRetries?:number}} ConfiguredRangeReadOptions
 * @typedef {{traceId?:string;advisoryLimits?:Record<string,unknown>}} ConfiguredListOptions
 * @typedef {ConfiguredListOptions} ConfiguredStatOptions
 * @typedef {{mode?:number;durability?:ConfiguredFsDurability;failIfExists?:boolean}} ConfiguredWriteOptions
 * @typedef {{recursive?:boolean;mode?:number;durability?:ConfiguredFsDurability}} ConfiguredMkdirOptions
 * @typedef {{ignoreMissing?:boolean;durability?:ConfiguredFsDurability}} ConfiguredDeleteOptions
 * @typedef {{durability?:ConfiguredFsDurability}} ConfiguredChmodOptions
 * @typedef {{mode?:number;durability?:ConfiguredFsDurability}} ConfiguredAppendOptions
 * @typedef {{overwrite?:boolean;durability?:ConfiguredFsDurability}} ConfiguredMoveOptions
 * @typedef {{persistent?:boolean;recursive?:boolean}} ConfiguredWatchOptions
 */

/**
 * Mint one immutable configured-path authority from trusted composition data.
 * @param {{
 *   id:string;
 *   roots?:readonly string[];
 *   exactPaths?:readonly string[];
 *   operations:readonly ConfiguredFsOperation[];
 *   symlinkPolicy?:'deny';
 *   durability?:readonly ConfiguredFsDurability[];
 * }} declaration
 * @returns {ConfiguredFsGrant}
 */
export function createConfiguredFsGrant(declaration) {
    const id = String(declaration?.id ?? '').trim();
    if (!id) throw new TypeError('createConfiguredFsGrant requires a non-empty id.');
    const roots = Object.freeze([...new Set((declaration.roots ?? []).map((entry) => path.resolve(String(entry))))]);
    const exactPaths = Object.freeze([
        ...new Set((declaration.exactPaths ?? []).map((entry) => path.resolve(String(entry)))),
    ]);
    if (roots.length === 0 && exactPaths.length === 0) {
        throw new TypeError('Configured filesystem grant requires at least one root or exact path.');
    }
    const operations = [...new Set(declaration.operations ?? [])];
    if (operations.length === 0 || operations.some((operation) => !VALID_OPERATIONS.has(operation))) {
        throw new TypeError('Configured filesystem grant requires only known, non-empty operations.');
    }
    if ((declaration.symlinkPolicy ?? 'deny') !== 'deny') {
        throw new TypeError('Configured filesystem grants currently support only symlinkPolicy="deny".');
    }
    const durability = [...new Set(declaration.durability ?? ['file-and-directory'])];
    if (durability.length === 0 || durability.some((mode) => !VALID_DURABILITY.has(mode))) {
        throw new TypeError('Configured filesystem grant contains an invalid durability mode.');
    }
    const grant = Object.freeze({
        id,
        roots,
        exactPaths,
        operations: Object.freeze(/** @type {ConfiguredFsOperation[]} */ ([...operations])),
        symlinkPolicy: /** @type {const} */ ('deny'),
        durability: Object.freeze(/** @type {ConfiguredFsDurability[]} */ ([...durability])),
        policyVersion: /** @type {const} */ (1),
        [CONFIGURED_FS_GRANT_BRAND]: /** @type {const} */ (true),
    });
    GRANT_INTERNALS.set(grant, {
        roots,
        exactPaths: new Set(exactPaths),
        operations: new Set(operations),
        durability: new Set(durability),
        symlinkPolicy: 'deny',
    });
    return grant;
}

/** @param {ConfiguredFsGrant} grant */
function requireGrantInternals(grant) {
    const internals = grant && typeof grant === 'object' ? GRANT_INTERNALS.get(grant) : undefined;
    if (!internals || grant[CONFIGURED_FS_GRANT_BRAND] !== true) {
        const error = new TypeError('Configured filesystem operation requires a genuine composition-issued grant.');
        /** @type {{code?:string}} */ (error).code = 'ERR_CONFIGURED_FS_GRANT_REQUIRED';
        throw error;
    }
    return internals;
}

/** @param {ConfiguredFsGrant} grant @param {string} candidate @param {ConfiguredFsOperation} operation */
async function authorizeConfiguredPath(grant, candidate, operation) {
    const internals = requireGrantInternals(grant);
    if (!internals.operations.has(operation)) {
        const error = new Error(`Configured filesystem grant ${grant.id} denies operation ${operation}.`);
        /** @type {{code?:string}} */ (error).code = 'ERR_CONFIGURED_FS_OPERATION_DENIED';
        throw error;
    }
    const resolved = path.resolve(String(candidate));
    const contained =
        internals.exactPaths.has(resolved) || internals.roots.some((root) => isWithinRoot(resolved, root));
    if (!contained) {
        const error = new Error(`Configured filesystem grant ${grant.id} denies path outside its configured domain.`);
        /** @type {{code?:string}} */ (error).code = 'ERR_CONFIGURED_FS_PATH_DENIED';
        throw error;
    }
    if (internals.symlinkPolicy === 'deny') await assertNoSymlinkComponents(resolved);
    return resolved;
}

/** @param {ConfiguredFsGrant} grant @param {ConfiguredFsDurability|undefined} durability */
function assertDurability(grant, durability) {
    if (durability === undefined) return;
    const internals = requireGrantInternals(grant);
    if (!internals.durability.has(durability)) {
        const error = new Error(`Configured filesystem grant ${grant.id} denies durability mode ${durability}.`);
        /** @type {{code?:string}} */ (error).code = 'ERR_CONFIGURED_FS_DURABILITY_DENIED';
        throw error;
    }
}

/**
 * Bind physical IO to one configured grant. Every method re-authorizes operation + path before touching filesystem.
 * @param {ConfiguredFsGrant} grant
 */
export function createConfiguredFsIo(grant) {
    requireGrantInternals(grant);

    /**
     * Compose multiple configured IO operations under one reentrant resource lock without exposing raw filesystem
     * primitives. The selected operation is authorized up front; every nested IO call still performs its own normal
     * operation/path/durability checks.
     * @template T
     * @param {string} filePath
     * @param {ConfiguredFsOperation} operation
     * @param {() => Promise<T>} callback
     * @param {{riskClass?:'low'|'medium'|'high'|'critical'}} [options]
     * @returns {Promise<T>}
     */
    async function withPathLock(filePath, operation, callback, options = {}) {
        const target = await authorizeConfiguredPath(grant, filePath, operation);
        return withConfiguredResourceLocks([target], callback, {
            operation: `configured-${operation}-composite`,
            riskClass: options.riskClass ?? 'medium',
        });
    }

    return Object.freeze({
        grant,
        withPathLock,
        async readTextFresh(/** @type {string} */ filePath, /** @type {ConfiguredTextReadOptions} */ options = {}) {
            const target = await authorizeConfiguredPath(grant, filePath, 'read');
            return readConfiguredTextFresh(target, options);
        },
        async readBytesFresh(/** @type {string} */ filePath, /** @type {ConfiguredBytesReadOptions} */ options = {}) {
            const target = await authorizeConfiguredPath(grant, filePath, 'read');
            return readConfiguredBytesFresh(target, options);
        },
        async readBytesRangeFresh(/** @type {string} */ filePath, /** @type {ConfiguredRangeReadOptions} */ options) {
            const target = await authorizeConfiguredPath(grant, filePath, 'read');
            return readConfiguredBytesRangeFresh(target, options);
        },
        async listDirectoryNamesFresh(
            /** @type {string} */ dirPath,
            /** @type {ConfiguredListOptions} */ options = {},
        ) {
            const target = await authorizeConfiguredPath(grant, dirPath, 'list');
            return listConfiguredDirectoryNamesFresh(target, options);
        },
        async lstatPath(/** @type {string} */ filePath, /** @type {ConfiguredStatOptions} */ options = {}) {
            const target = await authorizeConfiguredPath(grant, filePath, 'stat');
            return lstatConfiguredPath(target, options);
        },
        async statPath(/** @type {string} */ filePath, /** @type {ConfiguredStatOptions} */ options = {}) {
            const target = await authorizeConfiguredPath(grant, filePath, 'stat');
            return statConfiguredPath(target, options);
        },
        async writeFileAtomic(
            /** @type {string} */ filePath,
            /** @type {string | Buffer | Uint8Array | ArrayBuffer | SharedArrayBuffer | DataView} */ content,
            /** @type {ConfiguredWriteOptions} */ options = {},
        ) {
            assertDurability(grant, options.durability);
            const target = await authorizeConfiguredPath(grant, filePath, 'write');
            return writeConfiguredFileAtomic(target, content, options, async () => {
                await authorizeConfiguredPath(grant, target, 'write');
            });
        },
        async mkdirPath(/** @type {string} */ dirPath, /** @type {ConfiguredMkdirOptions} */ options = {}) {
            assertDurability(grant, options.durability);
            const target = await authorizeConfiguredPath(grant, dirPath, 'mkdir');
            return mkdirConfiguredPath(target, options, async () => {
                await authorizeConfiguredPath(grant, target, 'mkdir');
            });
        },
        async deleteFile(/** @type {string} */ filePath, /** @type {ConfiguredDeleteOptions} */ options = {}) {
            assertDurability(grant, options.durability);
            const target = await authorizeConfiguredPath(grant, filePath, 'delete');
            return deleteConfiguredFile(target, options);
        },
        async chmodFile(
            /** @type {string} */ filePath,
            /** @type {number} */ mode,
            /** @type {ConfiguredChmodOptions} */ options = {},
        ) {
            assertDurability(grant, options.durability);
            const target = await authorizeConfiguredPath(grant, filePath, 'chmod');
            return chmodConfiguredFile(target, mode, options);
        },
        async moveFile(
            /** @type {string} */ source,
            /** @type {string} */ destination,
            /** @type {ConfiguredMoveOptions} */ options = {},
        ) {
            const [resolvedSource, resolvedDestination] = await Promise.all([
                authorizeConfiguredPath(grant, source, 'move'),
                authorizeConfiguredPath(grant, destination, 'move'),
            ]);
            return moveConfiguredFile(resolvedSource, resolvedDestination, options, async () => {
                await Promise.all([
                    authorizeConfiguredPath(grant, resolvedSource, 'move'),
                    authorizeConfiguredPath(grant, resolvedDestination, 'move'),
                ]);
            });
        },
        async appendText(
            /** @type {string} */ filePath,
            /** @type {string | Buffer | Uint8Array | ArrayBuffer | SharedArrayBuffer | DataView} */ content,
            /** @type {ConfiguredAppendOptions} */ options = {},
        ) {
            assertDurability(grant, options.durability);
            const target = await authorizeConfiguredPath(grant, filePath, 'append');
            return appendConfiguredText(target, content, options, async () => {
                await authorizeConfiguredPath(grant, target, 'append');
            });
        },
        async openDetachedAppendSink(
            /** @type {string} */ filePath,
            /** @type {ConfiguredAppendOptions} */ options = {},
        ) {
            assertDurability(grant, options.durability);
            const target = await authorizeConfiguredPath(grant, filePath, 'append');
            return openConfiguredDetachedAppendSink(target, options, async () => {
                await authorizeConfiguredPath(grant, target, 'append');
            });
        },
        async watchPath(
            /** @type {string} */ targetPath,
            /** @type {ConfiguredWatchOptions} */ options,
            /** @type {import('node:fs').WatchListener<string>} */ listener,
        ) {
            const target = await authorizeConfiguredPath(grant, targetPath, 'watch');
            return watchConfiguredPath(target, { encoding: 'utf8', ...options }, listener);
        },
    });
}
