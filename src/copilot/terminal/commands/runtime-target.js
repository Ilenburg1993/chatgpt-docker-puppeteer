// @ts-check
/**
 * @module copilot/terminal/commands/runtime-target
 * @file Parsing canônico de seleção explícita de runtime nos comandos do REPL.
 *
 *   Suporta formas equivalentes como:
 *
 *   - `--runtime alt`
 *   - `--runtime=alt`
 *   - `@runtime:alt`
 */

import { hasRuntimeId, normalizeRuntimeId } from '../../presentation/routing/index.js';

/**
 * @param {string | null | undefined} rawArg
 * @returns {{ runtimeId: string | null; arg: string }}
 */
export function extractRuntimeTarget(rawArg) {
    const tokens = String(rawArg ?? '')
        .trim()
        .split(/\s+/u)
        .filter(Boolean);

    /** @type {string | null} */
    let runtimeId = null;
    /** @type {string[]} */
    const rest = [];

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i] ?? '';
        if (token === '--runtime') {
            const next = tokens[i + 1] ?? '';
            if (next) {
                runtimeId = next;
                i += 1;
            }
            continue;
        }
        if (token.startsWith('--runtime=')) {
            runtimeId = token.slice('--runtime='.length) || runtimeId;
            continue;
        }
        if (token.startsWith('@runtime:')) {
            runtimeId = token.slice('@runtime:'.length) || runtimeId;
            continue;
        }
        rest.push(token);
    }

    return { runtimeId: normalizeRuntimeId(runtimeId), arg: rest.join(' ').trim() };
}

/**
 * @param {string | null | undefined} runtimeId
 * @returns {runtimeId is string}
 */
export function hasRuntimeTarget(runtimeId) {
    return hasRuntimeId(runtimeId);
}

/**
 * Invoca uma função runtime-aware sem vazar `null` como segundo argumento opcional.
 *
 * @template {(...args: any[]) => any} T
 * @param {T} fn
 * @param {string | null | undefined} runtimeId
 * @param {...any} args
 * @returns {ReturnType<T>}
 */
export function callWithRuntimeTarget(fn, runtimeId, ...args) {
    const normalizedRuntimeId = normalizeRuntimeId(runtimeId);
    return normalizedRuntimeId ? fn(...args, normalizedRuntimeId) : fn(...args);
}

/**
 * Injeta `runtimeId` em payloads baseados em objeto apenas quando ele existir explicitamente.
 *
 * @template {Record<string, unknown>} T
 * @param {T} input
 * @param {string | null | undefined} runtimeId
 * @returns {T & { runtimeId?: string }}
 */
export function withRuntimeTarget(input, runtimeId) {
    const normalizedRuntimeId = normalizeRuntimeId(runtimeId);
    return normalizedRuntimeId ? { ...input, runtimeId: normalizedRuntimeId } : input;
}
