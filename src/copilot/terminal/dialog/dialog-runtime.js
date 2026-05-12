// @ts-check
/**
 * Runtime explícito do submódulo de dialog do terminal.
 *
 * `dialog/index.js` permanece como barrel puro; lazy-loading e estado local do engine vivem aqui.
 *
 * @module copilot/terminal/dialog/dialog-runtime
 */

/** @type {Promise<typeof import('./engine.js')> | null} */
let _engineModulePromise = null;
/** @type {typeof import('./engine.js') | null} */
let _engineModule = null;

/**
 * @returns {Promise<typeof import('./engine.js')>}
 */
function loadEngineModule() {
    if (_engineModulePromise === null) {
        _engineModulePromise = import('./engine.js').then((mod) => {
            _engineModule = mod;
            return mod;
        });
    }
    return _engineModulePromise;
}

/**
 * @returns {Promise<void>}
 */
export async function ensureDialogLoop() {
    const mod = await loadEngineModule();
    return mod.ensureDialogLoop();
}

/**
 * @param {string} message
 * @param {string} [actor]
 * @returns {Promise<string | null>}
 */
export async function sendTurn(message, actor = 'user') {
    const mod = await loadEngineModule();
    return mod.sendTurn(message, actor);
}

/**
 * @returns {number}
 */
export function getTurnQueueDepth() {
    return _engineModule?.getTurnQueueDepth() ?? 0;
}
