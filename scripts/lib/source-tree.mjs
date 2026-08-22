// @ts-check

import { readdirSync } from 'node:fs';
import { extname, join } from 'node:path';

const DEFAULT_IGNORED_DIRECTORY_NAMES = Object.freeze(['node_modules', 'logs']);

/**
 * @typedef {{
 *     extensions?: readonly string[];
 *     ignoredDirectoryNames?: readonly string[];
 *     ignoreHiddenDirectories?: boolean;
 * }} SourceTreeWalkOptions
 */

/** @param {unknown} error @returns {string | null} */
function errorCode(error) {
    if (!error || typeof error !== 'object' || !('code' in error)) return null;
    const code = /** @type {{code?:unknown}} */ (error).code;
    return typeof code === 'string' ? code : null;
}

/**
 * Source-tree policy shared by architecture/CI scanners.
 *
 * Hidden directories are operational/configuration artifacts rather than JavaScript source modules under `src/copilot`.
 * The only filesystem race tolerated is a directory disappearing between a parent `readdir` and recursive descent;
 * every other filesystem error remains fail-closed.
 *
 * @param {string} name
 * @param {SourceTreeWalkOptions} [options]
 */
export function shouldIgnoreSourceDirectory(name, options = {}) {
    if ((options.ignoreHiddenDirectories ?? true) && name.startsWith('.')) return true;
    const ignored = options.ignoredDirectoryNames ?? DEFAULT_IGNORED_DIRECTORY_NAMES;
    return ignored.includes(name);
}

/**
 * Recursively lists source files with deterministic ordering and explicit transient-directory semantics.
 *
 * @param {string} directory
 * @param {SourceTreeWalkOptions} [options]
 * @returns {string[]}
 */
export function listSourceFilesSync(directory, options = {}) {
    const extensions = new Set(
        (options.extensions ?? ['.js', '.mjs', '.cjs']).map((extension) =>
            extension.startsWith('.') ? extension : `.${extension}`,
        ),
    );

    let entries;
    try {
        entries = readdirSync(directory, { withFileTypes: true });
    } catch (error) {
        if (errorCode(error) === 'ENOENT') return [];
        throw error;
    }

    /** @type {string[]} */
    const files = [];
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
        const absolute = join(directory, entry.name);
        if (entry.isDirectory()) {
            if (shouldIgnoreSourceDirectory(entry.name, options)) continue;
            files.push(...listSourceFilesSync(absolute, options));
            continue;
        }
        if (entry.isFile() && extensions.has(extname(entry.name))) files.push(absolute);
    }
    return files;
}
