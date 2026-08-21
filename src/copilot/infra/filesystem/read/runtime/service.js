// @ts-check
/** Runtime-owned derived read state. @module copilot/infra/filesystem/read/runtime/service */

import { createIoReadHashRuntime, createLineOffsetCacheRuntime, readLineOffsetCacheConfig } from '../cache/index.js';
import { createByteLineIndexRuntime, readByteLineIndexConfig } from '../line-index/index.js';

/** @param {NodeJS.ProcessEnv} [env] */
export function readIoReadRuntimeConfig(env = process.env) {
    return Object.freeze({
        lineOffsets: readLineOffsetCacheConfig(env),
        byteLineIndex: readByteLineIndexConfig(env),
    });
}

/** @param {{ invalidationBus:{registerHook:(hook:(filePath:string,event:{recursive:boolean;source:string})=>void)=>()=>void}; runtimeId?:string; config?:ReturnType<typeof readIoReadRuntimeConfig> }} options */
export function createIoReadRuntime(options) {
    if (!options?.invalidationBus) throw new TypeError('createIoReadRuntime requires { invalidationBus }.');
    const runtimeId = options.runtimeId ?? 'io-read-runtime';
    const config = options.config ?? readIoReadRuntimeConfig();
    const hashes = createIoReadHashRuntime();
    const lineOffsets = createLineOffsetCacheRuntime({
        invalidationBus: options.invalidationBus,
        config: config.lineOffsets,
    });
    const byteLineIndex = createByteLineIndexRuntime({
        invalidationBus: options.invalidationBus,
        config: config.byteLineIndex,
    });
    let disposed = false;
    return Object.freeze({
        runtimeId,
        hashes,
        lineOffsets,
        byteLineIndex,
        snapshot() {
            return Object.freeze({
                runtimeId,
                disposed,
                hashes: hashes.stats(),
                lineOffsets: lineOffsets.stats(),
                byteLineIndex: byteLineIndex.stats(),
            });
        },
        dispose() {
            if (disposed) return;
            byteLineIndex.dispose();
            lineOffsets.dispose();
            hashes.dispose();
            disposed = true;
        },
    });
}
