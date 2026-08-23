// @ts-check
/**
 * src/copilot/sdk/tools/state.js
 *
 * AH.2 — Estado compartilhado de configuração de ferramentas (allowlist/denylist). Módulo isolado para evitar
 * dependências circulares entre session-manager.js e http-handlers.js.
 *
 * AI.1 — Persistência em `tools-config.json` na raiz do projeto. Carregado no boot via `loadToolsConfigAsync()`;
 * gravado a cada `patchToolsConfig()` para sobreviver a restarts.
 *
 * @module copilot/sdk/tools/state
 * @see EventBus
 */

import { createConfiguredFsGrant, createConfiguredFsIo } from '#copilot/infra/public/composition/filesystem/configured';
import { toError } from '#copilot/infra/public/platform/error';
import { parseJsonResult } from '#copilot/infra/public/platform/json';
import { log, logSdkSwallowed } from '../logger.js';
import { resolvePersistentConfigFile } from '../persistent-paths.js';
import { ToolsConfigSchema } from './schemas.js';

/** Caminho do arquivo de persistência. @type {string} */
const TOOLS_CONFIG_PATH = resolvePersistentConfigFile('tools-config.json');
const TOOLS_CONFIG_IO = createConfiguredFsIo(
    createConfiguredFsGrant({
        id: 'sdk.tools.state',
        exactPaths: [TOOLS_CONFIG_PATH],
        operations: ['read', 'write'],
        symlinkPolicy: 'deny',
    }),
);

/**
 * Configuração de ferramentas em runtime (allow/deny lists).
 *
 * @type {{ allowlist: string[] | null; denylist: string[] }}
 */
let _toolsConfig = { allowlist: null, denylist: [] };
/** @type {Promise<void>} */
let _toolsConfigWriteQueue = Promise.resolve();

/**
 * Reseta o estado em memória da configuração de tools para defaults.
 *
 * Útil para isolamento de testes e cenários de rebootstrap controlado.
 *
 * @returns {void}
 */
export function resetToolsConfigForTests() {
    _toolsConfig = { allowlist: null, denylist: [] };
    _toolsConfigWriteQueue = Promise.resolve();
}

/**
 * F92: Versão async de loadToolsConfig — usa fs/promises.
 *
 * @returns {Promise<void>}
 */
export async function loadToolsConfigAsync() {
    try {
        const raw = (await TOOLS_CONFIG_IO.readTextFresh(TOOLS_CONFIG_PATH)).content;
        const jsonResult = parseJsonResult(raw, '[tools-state/loadToolsConfigAsync]');
        if (!jsonResult.ok) {
            log('WARN', '[tools-state] tools-config.json JSON inválido — mantendo defaults.');
            return;
        }
        const jsonData = /** @type {unknown} */ (jsonResult.data);
        const result = ToolsConfigSchema.safeParse(jsonData);
        if (result.success && result.data) {
            _toolsConfig = {
                allowlist: Array.isArray(result.data.allowlist) ? [...result.data.allowlist] : null,
                denylist: [...result.data.denylist],
            };
            const { allowlist, denylist } = _toolsConfig;
            log(
                'INFO',
                `[tools-state] Configuração carregada (async): ${allowlist ? allowlist.length + ' ferramentas na allowlist' : 'sem allowlist'}, ${denylist.length} na denylist`,
            );
        } else {
            log('WARN', '[tools-state] tools-config.json schema inválido — mantendo defaults.');
        }
    } catch (e) {
        if (/** @type {NodeJS.ErrnoException} */ (e)?.code === 'ENOENT') {
            log('DEBUG', '[tools-state] tools-config.json ausente — usando defaults em memória.');
            return;
        }
        logSdkSwallowed(e, 'sdk.toolsState.loadConfig');
    }
}

/**
 * F92: Versão async de persistToolsConfig — usa fs/promises.
 *
 * @returns {Promise<void>}
 */
async function _persistToolsConfigAsync() {
    const payload = `${JSON.stringify(getToolsConfig(), null, 2)}\n`;
    const write = _toolsConfigWriteQueue.then(() =>
        TOOLS_CONFIG_IO.writeFileAtomic(TOOLS_CONFIG_PATH, payload, { mode: 0o600 }),
    );
    _toolsConfigWriteQueue = write.catch((err) => {
        log('WARN', `[tools-state] Falha ao persistir tools-config.json (async): ${toError(err).message}`);
    });
    await _toolsConfigWriteQueue;
}

/**
 * Retorna uma cópia da configuração atual de ferramentas.
 *
 * @returns {{ allowlist: string[] | null; denylist: string[] }}
 */
export function getToolsConfig() {
    return {
        allowlist: Array.isArray(_toolsConfig.allowlist) ? [..._toolsConfig.allowlist] : null,
        denylist: [..._toolsConfig.denylist],
    };
}

/**
 * Atualiza parcialmente a configuração de ferramentas e persiste no disco (async).
 *
 * @param {{ allowlist?: string[] | null; denylist?: string[] }} updates
 * @returns {Promise<void>}
 */
export async function patchToolsConfig(updates) {
    if ('allowlist' in updates) {
        _toolsConfig = {
            ..._toolsConfig,
            allowlist: Array.isArray(updates.allowlist) ? [...updates.allowlist] : null,
        };
    }
    if ('denylist' in updates) {
        _toolsConfig = {
            ..._toolsConfig,
            denylist: Array.isArray(updates.denylist) ? [...updates.denylist] : [],
        };
    }
    await _persistToolsConfigAsync();
}
