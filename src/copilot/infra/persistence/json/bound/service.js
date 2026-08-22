// @ts-check
/**
 * Storage-neutral JSON store bound to one already-authorized file identity.
 *
 * This layer never mints filesystem authority and never accepts a path per operation. The caller must provide an IO
 * capability that was authorized by its composition owner (workspace/configured/test fixture) before construction.
 *
 * @module copilot/infra/persistence/json/bound/service
 */

import path from 'node:path';

/**
 * @typedef {{
 *   readTextFresh:(filePath:string, options?:Record<string,unknown>)=>Promise<{content:string}>;
 *   writeFileAtomic:(filePath:string, content:string, options?:Record<string,unknown>)=>Promise<unknown>;
 *   statPath?:(filePath:string, options?:Record<string,unknown>)=>Promise<{stats:{isFile:()=>boolean;isDirectory:()=>boolean}}>;
 * }} AuthorizedJsonIo
 */

/**
 * @param {{
 *   filePath:string;
 *   io:AuthorizedJsonIo;
 *   writeOptions?:Readonly<Record<string,unknown>>;
 * }} options
 */
export function createBoundJsonStore(options) {
    const filePath = path.resolve(assertNonEmptyString(options?.filePath, 'filePath'));
    const io = assertAuthorizedJsonIo(options?.io);
    const writeOptions = Object.freeze({ ...(options.writeOptions ?? {}) });

    return Object.freeze({
        filePath,
        /** @template T @param {T} defaultValue @returns {Promise<T>} */
        async read(defaultValue) {
            try {
                const snapshot = await io.readTextFresh(filePath);
                return /** @type {T} */ (JSON.parse(snapshot.content));
            } catch {
                return defaultValue;
            }
        },
        /** @param {unknown} value */
        async write(value) {
            await io.writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`, writeOptions);
        },
        async exists() {
            if (typeof io.statPath !== 'function') {
                try {
                    await io.readTextFresh(filePath);
                    return true;
                } catch (error) {
                    if (isMissingPathError(error)) return false;
                    throw error;
                }
            }
            try {
                const { stats } = await io.statPath(filePath);
                return stats.isFile() || stats.isDirectory();
            } catch (error) {
                if (isMissingPathError(error)) return false;
                throw error;
            }
        },
    });
}

/** @param {unknown} value @param {string} name */
function assertNonEmptyString(value, name) {
    if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string.`);
    return value;
}

/** @param {unknown} value @returns {AuthorizedJsonIo} */
function assertAuthorizedJsonIo(value) {
    const io = /** @type {Partial<AuthorizedJsonIo> | null | undefined} */ (value);
    if (!io || typeof io.readTextFresh !== 'function' || typeof io.writeFileAtomic !== 'function') {
        throw new TypeError('createBoundJsonStore requires already-authorized readTextFresh/writeFileAtomic IO.');
    }
    return /** @type {AuthorizedJsonIo} */ (io);
}

/** @param {unknown} error */
function isMissingPathError(error) {
    const code = /** @type {{code?:unknown}} */ (error)?.code;
    return code === 'ENOENT' || code === 'ENOTDIR';
}
