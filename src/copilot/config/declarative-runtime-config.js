// @ts-check
/**
 * @module copilot/config/declarative-runtime-config
 * @file Configuração declarativa consumida pelo runtime, sem projection de borda.
 *
 *   Este módulo é dono de artefatos persistidos como `skills.json`, `tools-config.json` e `custom-tools.json`. Quando
 *   esses dados viram sessão viva, registry vivo ou capability, a autoridade passa para `agent/`.
 */

import { resolvePersistentConfigFile } from '#copilot/boot';
import { existsSync } from 'node:fs';
import { readFile as readFileAsync, writeFile as writeFileAsync } from 'node:fs/promises';
import { safeJsonParse } from '../core/safe-json.js';
import {
    BUILTIN_HANDLER_MAP,
    getCustomToolDefinitions,
    getToolsConfig,
    patchToolsConfig,
    registerCustomTool,
    removeCustomTool,
} from '#copilot/sdk/tools';

const SKILLS_PATH = resolvePersistentConfigFile('skills.json');

/**
 * @typedef {{ paths: string[] }} SkillsConfig
 *
 * @typedef {{ ok: true } | { ok: false; error: string }} ConfigMutationResult
 */

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
    return value && typeof value === 'object' ? /** @type {Record<string, unknown>} */ (value) : {};
}

/**
 * @param {unknown} value
 * @returns {string[] | null}
 */
function readStringArray(value) {
    return Array.isArray(value) && value.every((item) => typeof item === 'string')
        ? /** @type {string[]} */ (value)
        : null;
}

/**
 * Lê a configuração declarativa de paths de skills/contexto pinado.
 *
 * @returns {Promise<SkillsConfig>}
 */
export async function readSkillsConfig() {
    if (!existsSync(SKILLS_PATH)) return { paths: [] };
    try {
        const raw = await readFileAsync(SKILLS_PATH, 'utf8');
        const result = safeJsonParse(raw, '[config/declarative-runtime-config.readSkillsConfig]');
        return result.ok ? /** @type {SkillsConfig} */ (result.data) : { paths: [] };
    } catch {
        return { paths: [] };
    }
}

/**
 * Persiste a configuração declarativa de paths de skills/contexto pinado.
 *
 * @param {SkillsConfig} config
 * @returns {Promise<void>}
 */
export async function writeSkillsConfig(config) {
    await writeFileAsync(SKILLS_PATH, JSON.stringify(config, null, 2), 'utf8');
}

/**
 * Atualiza skills aceitando o contrato canônico `{ paths }` e o corpo legado HTTP `{ skills }`.
 *
 * @param {unknown} rawBody
 * @returns {Promise<{ ok: true; skills: SkillsConfig } | { ok: false; error: string }>}
 */
export async function updateSkillsConfig(rawBody) {
    const body = asRecord(rawBody);
    const paths = readStringArray(body['paths'] ?? body['skills']);
    if (!paths) return { ok: false, error: 'body deve conter { paths: string[] }' };
    const config = { paths };
    await writeSkillsConfig(config);
    return { ok: true, skills: config };
}

/**
 * @returns {{ allowlist: string[] | null; denylist: string[] }}
 */
export function readDeclarativeToolsConfig() {
    return getToolsConfig();
}

/**
 * Atualiza allowlist/denylist declarativas de tools.
 *
 * @param {unknown} rawBody
 * @returns {Promise<
 *     { ok: true; tools: ReturnType<typeof readDeclarativeToolsConfig> } | { ok: false; error: string }
 * >}
 */
export async function updateDeclarativeToolsConfig(rawBody) {
    const body = asRecord(rawBody);

    if ('allowlist' in body) {
        const allowlist = body['allowlist'];
        if (allowlist !== null && readStringArray(allowlist) === null) {
            return { ok: false, error: 'allowlist deve ser string[] ou null' };
        }
        await patchToolsConfig({ allowlist: /** @type {string[] | null} */ (allowlist) });
    }

    if ('denylist' in body) {
        const denylist = readStringArray(body['denylist']);
        if (denylist === null) return { ok: false, error: 'denylist deve ser string[]' };
        await patchToolsConfig({ denylist });
    }

    return { ok: true, tools: readDeclarativeToolsConfig() };
}

/**
 * @returns {{ tools: ReturnType<typeof getCustomToolDefinitions>; availableHandlers: string[] }}
 */
export function readDeclarativeCustomToolsConfig() {
    return {
        tools: getCustomToolDefinitions(),
        availableHandlers: [...BUILTIN_HANDLER_MAP.keys()],
    };
}

/**
 * Registra uma custom tool declarativa.
 *
 * @param {unknown} rawBody
 * @returns {Promise<{ ok: true; tool: { name: string; handlerId: string } } | { ok: false; error: string }>}
 */
export async function registerDeclarativeCustomToolConfig(rawBody) {
    const body = asRecord(rawBody);
    const name = typeof body['name'] === 'string' ? body['name'] : '';
    const description = typeof body['description'] === 'string' ? body['description'] : '';
    const handlerId = typeof body['handlerId'] === 'string' ? body['handlerId'] : '';
    if (!name) return { ok: false, error: 'name (string) é obrigatório' };
    if (!description) {
        return { ok: false, error: 'description (string) é obrigatória' };
    }
    if (!handlerId) {
        return { ok: false, error: 'handlerId (string) é obrigatório' };
    }
    const result = await registerCustomTool({
        name,
        description,
        handlerId,
        ...(body['parameters'] != null && {
            parameters: /** @type {Record<string, unknown>} */ (body['parameters']),
        }),
    });
    if (!result.ok) return { ok: false, error: result.error ?? 'falha ao registrar custom tool' };
    return { ok: true, tool: { name, handlerId } };
}

/**
 * Remove uma custom tool declarativa.
 *
 * @param {unknown} rawParams
 * @returns {Promise<ConfigMutationResult>}
 */
export async function removeDeclarativeCustomToolConfig(rawParams) {
    const params = asRecord(rawParams);
    const name = typeof params['name'] === 'string' ? params['name'] : undefined;
    if (!name) return { ok: false, error: 'name é obrigatório' };
    const result = await removeCustomTool(name);
    if (!result.ok) return { ok: false, error: result.error ?? 'falha ao remover custom tool' };
    return { ok: true };
}
