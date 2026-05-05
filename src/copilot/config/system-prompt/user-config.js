// @ts-check
/**
 * src/copilot/config/system-prompt/user-config.js
 *
 * Resolução da configuração declarativa do system prompt. Combina env + arquivo persistido para manter o recurso
 * facilmente configurável pelo usuário sem depender de setters ad hoc espalhados pela aplicação.
 *
 * @module copilot/config/system-prompt/user-config
 */

import { existsSync, readFileSync } from 'node:fs';
import { readFile as readFileAsync } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { resolvePersistentConfigFile } from '../sdk-config-port.js';

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
 * @param {string} filePath
 * @returns {SystemPromptUserConfig}
 */
function readConfigFileSync(filePath) {
    if (!existsSync(filePath)) return {};
    try {
        const raw = readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? /** @type {SystemPromptUserConfig} */ (parsed) : {};
    } catch {
        return {};
    }
}

/**
 * @param {string} filePath
 * @returns {Promise<SystemPromptUserConfig>}
 */
async function readConfigFileAsync(filePath) {
    if (!existsSync(filePath)) return {};
    try {
        const raw = await readFileAsync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? /** @type {SystemPromptUserConfig} */ (parsed) : {};
    } catch {
        return {};
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
 * @param {{ env?: NodeJS.ProcessEnv; cwd?: string }} [opts]
 * @returns {ResolvedSystemPromptUserConfig}
 */
export function readResolvedSystemPromptUserConfigSync(opts = {}) {
    const env = opts.env ?? process.env;
    const cwd = opts.cwd ?? process.cwd();
    const configPath = getSystemPromptConfigFilePath(env);
    const fileConfig = readConfigFileSync(configPath);
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
 * @param {{ env?: NodeJS.ProcessEnv; cwd?: string }} [opts]
 * @returns {Promise<ResolvedSystemPromptUserConfig>}
 */
export async function readResolvedSystemPromptUserConfig(opts = {}) {
    const env = opts.env ?? process.env;
    const cwd = opts.cwd ?? process.cwd();
    const configPath = getSystemPromptConfigFilePath(env);
    const fileConfig = await readConfigFileAsync(configPath);
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
 * @param {ResolvedSystemPromptUserConfig} [resolved]
 * @returns {string}
 */
export function readUserAppendContentSync(resolved = readResolvedSystemPromptUserConfigSync()) {
    /** @type {string[]} */
    const parts = [];

    for (const filePath of resolved.appendFiles) {
        if (!existsSync(filePath)) continue;
        try {
            const content = readFileSync(filePath, 'utf8').trim();
            if (!content) continue;
            parts.push(`<!-- user-system-prompt:${filePath} -->\n${content}\n<!-- /user-system-prompt:${filePath} -->`);
        } catch {
            // Silencioso: config do usuário não deve quebrar o boot.
        }
    }

    if (resolved.appendText.trim()) {
        parts.push(resolved.appendText.trim());
    }

    return parts.join('\n\n');
}

/**
 * @param {ResolvedSystemPromptUserConfig} [resolved]
 * @returns {Promise<string>}
 */
export async function readUserAppendContent(resolved) {
    const effective = resolved ?? (await readResolvedSystemPromptUserConfig());
    /** @type {string[]} */
    const parts = [];

    for (const filePath of effective.appendFiles) {
        try {
            const content = (await readFileAsync(filePath, 'utf8')).trim();
            if (!content) continue;
            parts.push(`<!-- user-system-prompt:${filePath} -->\n${content}\n<!-- /user-system-prompt:${filePath} -->`);
        } catch {
            // Silencioso: config do usuário não deve quebrar a sessão.
        }
    }

    if (effective.appendText.trim()) {
        parts.push(effective.appendText.trim());
    }

    return parts.join('\n\n');
}
