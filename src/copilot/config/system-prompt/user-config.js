// @ts-check
/**
 * src/copilot/config/system-prompt/user-config.js
 *
 * Resolução da configuração declarativa do system prompt. Combina env + arquivo persistido para manter o recurso
 * facilmente configurável pelo usuário sem depender de setters ad hoc espalhados pela aplicação.
 *
 * @module copilot/config/system-prompt/user-config
 */

import { createConfiguredFsGrant, createConfiguredFsIo } from '#copilot/infra/public/composition/filesystem/configured';
import { isAbsolute, resolve } from 'node:path';
import { resolvePersistentConfigFile } from '../persistent-paths.js';

/**
 * @typedef {'append' | 'customize' | 'replace'} SystemPromptMode
 *
 * @typedef {'sdk-transform' | 'static'} SystemPromptReloadStrategy
 *
 * @typedef {{
 *     mode?: SystemPromptMode;
 *     appendFiles?: string[];
 *     appendText?: string;
 *     autoReload?: boolean;
 *     reloadStrategy?: SystemPromptReloadStrategy;
 *     objective?: string;
 *     personality?: string;
 *     collaborationContract?: string;
 *     northStar?: string;
 *     engineeringDoctrine?: string;
 *     evolutionLoop?: string;
 *     focusPaths?: string[];
 * }} SystemPromptUserConfig
 *
 *
 * @typedef {{
 *     configPath: string;
 *     mode: SystemPromptMode;
 *     appendFiles: string[];
 *     appendText: string;
 *     autoReload: boolean;
 *     reloadStrategy: SystemPromptReloadStrategy;
 *     objective: string;
 *     personality: string;
 *     collaborationContract: string;
 *     northStar: string;
 *     engineeringDoctrine: string;
 *     evolutionLoop: string;
 *     focusPaths: string[];
 * }} ResolvedSystemPromptUserConfig
 */

import {
    SYSTEM_PROMPT_DEFAULT_COLLABORATION_CONTRACT,
    SYSTEM_PROMPT_DEFAULT_ENGINEERING_DOCTRINE,
    SYSTEM_PROMPT_DEFAULT_EVOLUTION_LOOP,
    SYSTEM_PROMPT_DEFAULT_FOCUS_PATHS,
    SYSTEM_PROMPT_DEFAULT_NORTH_STAR,
    SYSTEM_PROMPT_DEFAULT_OBJECTIVE,
    SYSTEM_PROMPT_DEFAULT_PERSONALITY,
} from './profile.js';

export const SYSTEM_PROMPT_DEFAULT_MODE = /** @type {const} */ ('append');
export const SYSTEM_PROMPT_DEFAULT_RELOAD_STRATEGY = /** @type {const} */ ('sdk-transform');
export const SYSTEM_PROMPT_CONFIG_PATH = resolvePersistentConfigFile('system-prompt.json');

/** Last successfully observed declarative file payloads, keyed by canonical configured path. */
const systemPromptConfigSnapshots = new Map();
/** Last successfully observed append-file text, keyed by configured absolute path. */
const systemPromptAppendTextSnapshots = new Map();
/**
 * Unforgeable authority associated only with asynchronously resolved config snapshots. A caller-crafted plain object
 * cannot become filesystem authority merely by naming append paths.
 * @type {WeakMap<ResolvedSystemPromptUserConfig, ReturnType<typeof createConfiguredFsIo> | null>}
 */
const systemPromptAppendIoByConfig = new WeakMap();

/**
 * @param {string | undefined} value
 * @param {SystemPromptMode} [fallback]
 * @returns {SystemPromptMode}
 */
export function normalizeSystemPromptMode(value, fallback = SYSTEM_PROMPT_DEFAULT_MODE) {
    return value === 'append' || value === 'customize' || value === 'replace' ? value : fallback;
}

/**
 * @param {string | undefined} value
 * @param {SystemPromptReloadStrategy} [fallback]
 * @returns {SystemPromptReloadStrategy}
 */
export function normalizeSystemPromptReloadStrategy(value, fallback = SYSTEM_PROMPT_DEFAULT_RELOAD_STRATEGY) {
    return value === 'sdk-transform' || value === 'static' ? value : fallback;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function readStringArray(value) {
    return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
}

/**
 * @param {string | undefined} value
 * @returns {string[]}
 */
function splitList(value) {
    if (!value) return [];
    return value
        .split(/[\n,;]+/)
        .map((item) => item.trim())
        .filter(Boolean);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function readOptionalString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

/**
 * @param {string | undefined} envValue
 * @param {unknown} fileValue
 * @param {string} fallback
 * @returns {string}
 */
function resolveTextSetting(envValue, fileValue, fallback) {
    const value = readOptionalString(envValue) || readOptionalString(fileValue) || fallback;
    return value.trim();
}

/**
 * @param {string[]} values
 * @param {readonly string[]} fallback
 * @returns {string[]}
 */
function resolveFocusPaths(values, fallback) {
    const deduped = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
    return deduped.length > 0 ? deduped : [...fallback];
}

/**
 * @param {unknown} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
function readBoolean(value, fallback) {
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') return fallback;
    if (['1', 'true', 'yes', 'on'].includes(value.toLowerCase())) return true;
    if (['0', 'false', 'no', 'off'].includes(value.toLowerCase())) return false;
    return fallback;
}

/**
 * Return the last asynchronously hydrated file snapshot. Sync projections never touch the filesystem.
 *
 * @param {string} filePath
 * @returns {SystemPromptUserConfig}
 */
function readConfigFileSnapshot(filePath) {
    return systemPromptConfigSnapshots.get(filePath) ?? {};
}

/**
 * @param {string} filePath
 * @returns {Promise<SystemPromptUserConfig>}
 */
async function readConfigFileAsync(filePath) {
    const configIo = createConfiguredFsIo(
        createConfiguredFsGrant({
            id: 'config.system-prompt.user-config.source',
            exactPaths: [filePath],
            operations: ['read'],
            symlinkPolicy: 'deny',
            durability: ['file-and-directory'],
        }),
    );
    try {
        const raw = (await configIo.readTextFresh(filePath)).content;
        const parsed = JSON.parse(raw);
        const snapshot = parsed && typeof parsed === 'object' ? /** @type {SystemPromptUserConfig} */ (parsed) : {};
        systemPromptConfigSnapshots.set(filePath, snapshot);
        return snapshot;
    } catch {
        const snapshot = {};
        systemPromptConfigSnapshots.set(filePath, snapshot);
        return snapshot;
    }
}

/**
 * @param {string[]} filePaths
 * @param {string} cwd
 * @returns {string[]}
 */
function resolveAppendFiles(filePaths, cwd) {
    return filePaths.map((filePath) => (isAbsolute(filePath) ? filePath : resolve(cwd, filePath)));
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function getSystemPromptConfigFilePath(env = process.env) {
    const overridePath = env['COPILOT_SYSTEM_PROMPT_CONFIG'];
    if (!overridePath) return SYSTEM_PROMPT_CONFIG_PATH;
    return isAbsolute(overridePath) ? overridePath : resolve(process.cwd(), overridePath);
}

/**
 * Resolve one immutable effective config from process/env inputs plus an already-observed file payload.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {string} cwd
 * @param {string} configPath
 * @param {SystemPromptUserConfig} fileConfig
 * @returns {ResolvedSystemPromptUserConfig}
 */
function resolveSystemPromptUserConfigSnapshot(env, cwd, configPath, fileConfig) {
    const appendFiles = resolveAppendFiles(
        [
            ...readStringArray(fileConfig.appendFiles),
            ...splitList(env['COPILOT_SYSTEM_PROMPT_APPEND_FILES']),
            ...splitList(env['COPILOT_SYSTEM_PROMPT_APPEND_FILE']),
        ],
        cwd,
    );

    return {
        configPath,
        mode: normalizeSystemPromptMode(env['COPILOT_SYSTEM_PROMPT_MODE'] ?? fileConfig.mode),
        appendFiles,
        appendText:
            (typeof env['COPILOT_SYSTEM_PROMPT_APPEND_TEXT'] === 'string'
                ? env['COPILOT_SYSTEM_PROMPT_APPEND_TEXT']
                : undefined) ?? (typeof fileConfig.appendText === 'string' ? fileConfig.appendText : ''),
        autoReload: readBoolean(env['COPILOT_SYSTEM_PROMPT_AUTO_RELOAD'] ?? fileConfig.autoReload, true),
        reloadStrategy: normalizeSystemPromptReloadStrategy(
            env['COPILOT_SYSTEM_PROMPT_RELOAD_STRATEGY'] ?? fileConfig.reloadStrategy,
        ),
        objective: resolveTextSetting(
            env['COPILOT_SYSTEM_PROMPT_OBJECTIVE'],
            fileConfig.objective,
            SYSTEM_PROMPT_DEFAULT_OBJECTIVE,
        ),
        personality: resolveTextSetting(
            env['COPILOT_SYSTEM_PROMPT_PERSONALITY'],
            fileConfig.personality,
            SYSTEM_PROMPT_DEFAULT_PERSONALITY,
        ),
        collaborationContract: resolveTextSetting(
            env['COPILOT_SYSTEM_PROMPT_COLLABORATION_CONTRACT'],
            fileConfig.collaborationContract,
            SYSTEM_PROMPT_DEFAULT_COLLABORATION_CONTRACT,
        ),
        northStar: resolveTextSetting(
            env['COPILOT_SYSTEM_PROMPT_NORTH_STAR'],
            fileConfig.northStar,
            SYSTEM_PROMPT_DEFAULT_NORTH_STAR,
        ),
        engineeringDoctrine: resolveTextSetting(
            env['COPILOT_SYSTEM_PROMPT_ENGINEERING_DOCTRINE'],
            fileConfig.engineeringDoctrine,
            SYSTEM_PROMPT_DEFAULT_ENGINEERING_DOCTRINE,
        ),
        evolutionLoop: resolveTextSetting(
            env['COPILOT_SYSTEM_PROMPT_EVOLUTION_LOOP'],
            fileConfig.evolutionLoop,
            SYSTEM_PROMPT_DEFAULT_EVOLUTION_LOOP,
        ),
        focusPaths: resolveFocusPaths(
            [
                ...readStringArray(fileConfig.focusPaths),
                ...splitList(env['COPILOT_SYSTEM_PROMPT_FOCUS_PATHS']),
                ...splitList(env['COPILOT_SYSTEM_PROMPT_FOCUS_PATH']),
            ],
            SYSTEM_PROMPT_DEFAULT_FOCUS_PATHS,
        ),
    };
}

/**
 * Synchronous projection of the latest hydrated config snapshot. It never performs filesystem IO. Before first
 * hydration, file-backed fields use defaults/env; async session bootstrap hydrates them before live use.
 *
 * @param {{ env?: NodeJS.ProcessEnv; cwd?: string }} [opts]
 * @returns {ResolvedSystemPromptUserConfig}
 */
export function readResolvedSystemPromptUserConfigSync(opts = {}) {
    const env = opts.env ?? process.env;
    const cwd = opts.cwd ?? process.cwd();
    const configPath = getSystemPromptConfigFilePath(env);
    return resolveSystemPromptUserConfigSnapshot(env, cwd, configPath, readConfigFileSnapshot(configPath));
}

/**
 * Hydrate the declarative file physically and return the resulting effective config.
 *
 * @param {{ env?: NodeJS.ProcessEnv; cwd?: string }} [opts]
 * @returns {Promise<ResolvedSystemPromptUserConfig>}
 */
export async function readResolvedSystemPromptUserConfig(opts = {}) {
    const env = opts.env ?? process.env;
    const cwd = opts.cwd ?? process.cwd();
    const configPath = getSystemPromptConfigFilePath(env);
    const resolved = resolveSystemPromptUserConfigSnapshot(env, cwd, configPath, await readConfigFileAsync(configPath));
    const appendIo =
        resolved.appendFiles.length === 0
            ? null
            : createConfiguredFsIo(
                  createConfiguredFsGrant({
                      id: 'config.system-prompt.user-config.append-files',
                      exactPaths: resolved.appendFiles,
                      operations: ['read', 'stat'],
                      symlinkPolicy: 'deny',
                      durability: ['file-and-directory'],
                  }),
              );
    systemPromptAppendIoByConfig.set(resolved, appendIo);
    return resolved;
}

/**
 * @param {ResolvedSystemPromptUserConfig} [resolved]
 * @returns {string}
 */
export function readUserAppendContentSync(resolved = readResolvedSystemPromptUserConfigSync()) {
    /** @type {string[]} */
    const parts = [];
    for (const filePath of resolved.appendFiles) {
        const content = (systemPromptAppendTextSnapshots.get(filePath) ?? '').trim();
        if (!content) continue;
        parts.push(`<!-- user-system-prompt:${filePath} -->\n${content}\n<!-- /user-system-prompt:${filePath} -->`);
    }
    if (resolved.appendText.trim()) parts.push(resolved.appendText.trim());
    return parts.join('\n\n');
}

/**
 * @param {ResolvedSystemPromptUserConfig} [resolved]
 * @returns {Promise<string>}
 */
export async function readUserAppendContent(resolved) {
    const effective = resolved ?? (await readResolvedSystemPromptUserConfig());
    const appendIo = systemPromptAppendIoByConfig.get(effective) ?? null;
    /** @type {string[]} */
    const parts = [];

    for (const filePath of effective.appendFiles) {
        try {
            if (!appendIo) continue;
            const content = (await appendIo.readTextFresh(filePath)).content.trim();
            systemPromptAppendTextSnapshots.set(filePath, content);
            if (!content) continue;
            parts.push(`<!-- user-system-prompt:${filePath} -->\n${content}\n<!-- /user-system-prompt:${filePath} -->`);
        } catch {
            systemPromptAppendTextSnapshots.delete(filePath);
            // Silencioso: config do usuário não deve quebrar a sessão.
        }
    }

    if (effective.appendText.trim()) {
        parts.push(effective.appendText.trim());
    }

    return parts.join('\n\n');
}

/**
 * Return physical metadata for append files using only authority bound to a resolver-produced config snapshot.
 * Caller-crafted config objects receive no filesystem authority.
 *
 * @param {ResolvedSystemPromptUserConfig} resolved
 * @returns {Promise<Array<{path:string;exists:boolean;bytes:number|null;mtimeMs:number|null}>>}
 */
export async function readBoundSystemPromptAppendFileStatuses(resolved) {
    const appendIo = systemPromptAppendIoByConfig.get(resolved) ?? null;
    const statuses = [];
    for (const filePath of resolved.appendFiles) {
        if (!appendIo) {
            statuses.push({ path: filePath, exists: false, bytes: null, mtimeMs: null });
            continue;
        }
        try {
            const info = (await appendIo.statPath(filePath)).stats;
            statuses.push({ path: filePath, exists: true, bytes: info.size, mtimeMs: info.mtimeMs });
        } catch {
            statuses.push({ path: filePath, exists: false, bytes: null, mtimeMs: null });
        }
    }
    return statuses;
}

/**
 * Explicitly hydrate both declarative config and append-file snapshots for sync projections/builders.
 *
 * @param {{ env?: NodeJS.ProcessEnv; cwd?: string }} [opts]
 */
export async function refreshSystemPromptUserConfigSnapshot(opts = {}) {
    const config = await readResolvedSystemPromptUserConfig(opts);
    const userAppendContent = await readUserAppendContent(config);
    return { config, userAppendContent };
}
