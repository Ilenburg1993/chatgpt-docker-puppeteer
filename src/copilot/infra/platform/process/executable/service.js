// @ts-check
/**
 * Deterministic executable discovery for process capabilities.
 *
 * The resolver never invokes a shell or subprocess and never reads ambient process environment. Callers explicitly
 * supply the environment snapshot that owns PATH/PATHEXT semantics. Explicit candidates are checked before PATH so
 * application-local binaries can be preferred without reproducing discovery logic at each call site.
 *
 * @module copilot/infra/platform/process/executable/service
 */

import { accessSync, constants, statSync } from 'node:fs';
import { extname, isAbsolute, join, resolve, sep } from 'node:path';

/** @typedef {'candidate'|'command-path'|'path'|'not-found'} ExecutableResolutionSource */
/**
 * @typedef {Readonly<{
 *   found:true;
 *   command:string;
 *   path:string;
 *   source:Exclude<ExecutableResolutionSource,'not-found'>;
 *   candidatesChecked:number;
 *   searchedPathEntries:number;
 *   candidateIndex:number|null;
 *   pathEntryIndex:number|null;
 *   extension:string|null;
 * }>} ExecutableResolutionFound
 * @typedef {Readonly<{
 *   found:false;
 *   command:string;
 *   path:null;
 *   source:'not-found';
 *   candidatesChecked:number;
 *   searchedPathEntries:number;
 *   candidateIndex:null;
 *   pathEntryIndex:null;
 *   extension:null;
 * }>} ExecutableResolutionMissing
 * @typedef {ExecutableResolutionFound|ExecutableResolutionMissing} ExecutableResolution
 */

const WINDOWS_DEFAULT_PATHEXT = '.EXE;.CMD;.BAT;.COM';

/**
 * Resolve an executable without shelling out.
 *
 * `cwd` is used only to make relative explicit candidates/PATH entries deterministic. When omitted, relative entries
 * are checked as supplied, preserving Node's normal filesystem-relative semantics without consulting process.cwd here.
 *
 * @param {string} command
 * @param {{
 *   env:Readonly<Record<string,string|undefined>>|NodeJS.ProcessEnv;
 *   cwd?:string;
 *   candidates?:readonly string[];
 *   platform?:NodeJS.Platform;
 * }} options
 * @returns {ExecutableResolution}
 */
export function resolveExecutable(command, options) {
    const normalizedCommand = String(command ?? '').trim();
    if (!normalizedCommand) throw new TypeError('resolveExecutable requires a non-empty command.');
    if (!options?.env) throw new TypeError('resolveExecutable requires an explicit env snapshot.');

    const platform = options.platform ?? process.platform;
    const pathEntries = readPathEntries(options.env, platform, options.cwd);
    const extensions = executableExtensions(normalizedCommand, options.env, platform);
    const explicitCandidates = options.candidates ?? [];
    let candidatesChecked = 0;

    for (let index = 0; index < explicitCandidates.length; index += 1) {
        const rawCandidate = String(explicitCandidates[index] ?? '').trim();
        if (!rawCandidate) continue;
        for (const candidate of expandExecutableCandidate(
            normalizeCandidate(rawCandidate, options.cwd),
            extensions,
            platform,
        )) {
            candidatesChecked += 1;
            if (!isExecutableFile(candidate.path, platform)) continue;
            return freezeFound({
                command: normalizedCommand,
                path: candidate.path,
                source: 'candidate',
                candidatesChecked,
                searchedPathEntries: pathEntries.length,
                candidateIndex: index,
                pathEntryIndex: null,
                extension: candidate.extension,
            });
        }
    }

    if (isDirectCommandPath(normalizedCommand)) {
        for (const candidate of expandExecutableCandidate(
            normalizeCandidate(normalizedCommand, options.cwd),
            extensions,
            platform,
        )) {
            candidatesChecked += 1;
            if (!isExecutableFile(candidate.path, platform)) continue;
            return freezeFound({
                command: normalizedCommand,
                path: candidate.path,
                source: 'command-path',
                candidatesChecked,
                searchedPathEntries: pathEntries.length,
                candidateIndex: null,
                pathEntryIndex: null,
                extension: candidate.extension,
            });
        }
        return freezeMissing(normalizedCommand, candidatesChecked, pathEntries.length);
    }

    for (let pathEntryIndex = 0; pathEntryIndex < pathEntries.length; pathEntryIndex += 1) {
        const directory = pathEntries[pathEntryIndex];
        if (!directory) continue;
        for (const extension of extensions) {
            const candidate = join(directory, `${normalizedCommand}${extension}`);
            candidatesChecked += 1;
            if (!isExecutableFile(candidate, platform)) continue;
            return freezeFound({
                command: normalizedCommand,
                path: candidate,
                source: 'path',
                candidatesChecked,
                searchedPathEntries: pathEntries.length,
                candidateIndex: null,
                pathEntryIndex,
                extension: extension || null,
            });
        }
    }

    return freezeMissing(normalizedCommand, candidatesChecked, pathEntries.length);
}

/** @param {Readonly<Record<string,string|undefined>>|NodeJS.ProcessEnv} env @param {NodeJS.Platform} platform @param {string|undefined} cwd */
function readPathEntries(env, platform, cwd) {
    const pathValue = firstString(env, ['PATH', 'Path', 'path']) ?? '';
    const delimiter = platform === 'win32' ? ';' : ':';
    return pathValue
        .split(delimiter)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => normalizeCandidate(entry, cwd));
}

/** @param {string} command @param {Readonly<Record<string,string|undefined>>|NodeJS.ProcessEnv} env @param {NodeJS.Platform} platform */
function executableExtensions(command, env, platform) {
    if (platform !== 'win32' || extname(command)) return Object.freeze(['']);
    const raw = firstString(env, ['PATHEXT', 'PathExt', 'pathext']) ?? WINDOWS_DEFAULT_PATHEXT;
    const normalized = raw
        .split(';')
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => (value.startsWith('.') ? value : `.${value}`));
    return Object.freeze(normalized.length > 0 ? normalized : WINDOWS_DEFAULT_PATHEXT.split(';'));
}

/** @param {string} candidate @param {readonly string[]} extensions @param {NodeJS.Platform} platform */
function expandExecutableCandidate(candidate, extensions, platform) {
    if (platform !== 'win32' || extname(candidate))
        return [{ path: candidate, extension: /** @type {string|null} */ (null) }];
    return extensions.map((extension) => ({ path: `${candidate}${extension}`, extension: extension || null }));
}

/** @param {string} candidate @param {string|undefined} cwd */
function normalizeCandidate(candidate, cwd) {
    if (!cwd || isAbsolute(candidate)) return candidate;
    return resolve(cwd, candidate);
}

/** @param {string} command */
function isDirectCommandPath(command) {
    return isAbsolute(command) || command.includes('/') || command.includes('\\') || command.includes(sep);
}

/** @param {string} filePath @param {NodeJS.Platform} platform */
function isExecutableFile(filePath, platform) {
    try {
        if (!statSync(filePath).isFile()) return false;
        if (platform !== 'win32') accessSync(filePath, constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

/** @param {Readonly<Record<string,string|undefined>>|NodeJS.ProcessEnv} env @param {readonly string[]} keys */
function firstString(env, keys) {
    for (const key of keys) {
        const value = env[key];
        if (typeof value === 'string' && value.length > 0) return value;
    }
    return null;
}

/** @param {Omit<ExecutableResolutionFound,'found'>} result @returns {ExecutableResolutionFound} */
function freezeFound(result) {
    return Object.freeze({ found: true, ...result });
}

/** @param {string} command @param {number} candidatesChecked @param {number} searchedPathEntries @returns {ExecutableResolutionMissing} */
function freezeMissing(command, candidatesChecked, searchedPathEntries) {
    return Object.freeze({
        found: false,
        command,
        path: null,
        source: 'not-found',
        candidatesChecked,
        searchedPathEntries,
        candidateIndex: null,
        pathEntryIndex: null,
        extension: null,
    });
}
