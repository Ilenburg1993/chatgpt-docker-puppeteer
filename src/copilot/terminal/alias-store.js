// @ts-check
/**
 * @module copilot/alias-store
 * @file Alias Store — gerencia aliases de comandos do terminal REPL.
 *
 *   Suporta aliases built-in e customizados pelo usuário. Aliases customizados são persistidos em arquivo JSON.
 */

import { LLM_B_ALIASES_FILE } from '#copilot/config/env';
import { log } from '#copilot/observability/logger';
import fs from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { logSwallowed } from '../core/error-handlers.js';
import { safeJsonParse } from '../core/safe-json.js';
import { AliasConfigSchema } from '../core/schemas.js';

/** Aliases built-in (não podem ser removidos, apenas sobrescritos). @type {Record<string, string>} */
const BUILTIN_ALIASES = /** @type {Record<string, string>} */ ({
    '/issues': '/gh issue list',
    '/prs': '/gh pr list',
    '/runs': '/gh run list',
    '/ci': '/gh run list',
    '/log': '/git log',
    '/st': '/git status',
    '/diff': '/git diff',
    '/gst': '/git status',
    '/glog': '/git log 20',
    '/glog1': '/git log --oneline 20',
});

/** Arquivo padrão de aliases customizados. */
const ALIASES_FILE = LLM_B_ALIASES_FILE ?? path.join(os.homedir(), '.copilot-aliases.json');

/** Cache em memória dos aliases (builtin + custom). @type {Record<string, string>} */
let _aliases = /** @type {Record<string, string>} */ ({ ...BUILTIN_ALIASES });

// ---------------------------------------------------------------------------
// Persistência
// ---------------------------------------------------------------------------

/**
 * Carrega aliases customizados do arquivo JSON. Mescla com built-ins (custom tem precedência).
 *
 * @deprecated F93: Use loadAliasesAsync() em fluxos assíncronos.
 * @example
 *     loadAliases(); // carrega de .copilot-aliases.json
 *
 * @returns {void}
 */
export function loadAliases() {
    try {
        const raw = fs.readFileSync(ALIASES_FILE, 'utf8');
        const result = safeJsonParse(raw, '[alias-store/loadAliases]');
        const custom = result.ok ? result.data : null;
        _aliases =
            custom && typeof custom === 'object' && !Array.isArray(custom)
                ? { ...BUILTIN_ALIASES, .../** @type {Record<string, string>} */ (custom) }
                : { ...BUILTIN_ALIASES };
    } catch {
        // arquivo não existe ou inválido — usar apenas built-ins
        _aliases = { ...BUILTIN_ALIASES };
    }
}

/**
 * Salva aliases customizados (apenas os não-builtin) no arquivo JSON.
 *
 * @deprecated F128: Use _saveCustomAliasesAsync() em vez desta versão síncrona.
 * @returns {void}
 */
function saveCustomAliases() {
    _saveCustomAliasesAsync().catch((/** @type {any} */ e) => {
        log('WARN', `[alias-store] Falha ao salvar aliases: ${e?.message ?? e}`);
    });
}

/**
 * F93: Versão async de loadAliases — usa fs/promises.
 *
 * @returns {Promise<void>}
 */
export async function loadAliasesAsync() {
    try {
        const raw = await readFile(ALIASES_FILE, 'utf8');
        const jsonResult = safeJsonParse(raw, '[alias-store/loadAliasesAsync]');
        if (!jsonResult.ok) {
            _aliases = { ...BUILTIN_ALIASES };
            return;
        }
        const result = AliasConfigSchema.safeParse(jsonResult.data);
        if (result.success && result.data) {
            const custom = /** @type {Record<string, string>} */ (/** @type {unknown} */ (result.data));
            _aliases = { ...BUILTIN_ALIASES, ...custom };
        } else {
            _aliases = { ...BUILTIN_ALIASES };
        }
    } catch {
        _aliases = { ...BUILTIN_ALIASES };
    }
}

/**
 * F93: Versão async de saveCustomAliases — usa fs/promises.
 *
 * @returns {Promise<void>}
 */
async function _saveCustomAliasesAsync() {
    /** @type {Record<string, string>} */
    const custom = {};
    for (const [k, v] of Object.entries(_aliases)) {
        if (BUILTIN_ALIASES[k] === undefined || BUILTIN_ALIASES[k] !== v) {
            custom[k] = v;
        }
    }
    try {
        await writeFile(ALIASES_FILE, JSON.stringify(custom, null, 2));
    } catch (/** @type {any} */ e) {
        logSwallowed(e, 'terminal.aliasStore.write');
    }
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Resolve um alias para o comando completo. Suporta resolução em cadeia (alias que aponta para outro alias), até 5
 * níveis.
 *
 * @example
 *     resolve('st'); // 'status'
 *     resolve('unknown cmd'); // 'unknown cmd'
 *
 * @param {string} input - linha de comando digitada
 * @returns {string} comando resolvido (ou o mesmo input se não for alias)
 */
export function resolve(input) {
    let current = input.trim();
    const seen = new Set();
    for (let i = 0; i < 5; i++) {
        // Tentar match exato ou com args
        const [cmd, ...rest] = current.split(' ');
        const alias = cmd ? _aliases[cmd] : undefined;
        if (!alias) break;
        // F6.5 (BUG-LEVE-06): detectar loop de alias explicitamente antes de quebrar silencioso
        if (seen.has(cmd)) {
            console.warn(
                `[alias-store] Loop de alias detectado: "${cmd}" → ciclo em ${[...seen].join(' → ')} → "${cmd}"`,
            );
            break;
        }
        seen.add(cmd);
        current = rest.length ? `${alias} ${rest.join(' ')}` : alias;
    }
    return current;
}

/**
 * Define um alias (sobrescreve se já existir).
 *
 * @example
 *     setAlias('/issues', '/gh issue list --state open');
 *
 * @param {string} name - nome do alias (ex: "/issues")
 * @param {string} command - comando alvo (ex: "/gh issue list --state open")
 * @returns {{ ok: boolean; error?: string }}
 */
export function setAlias(name, command) {
    const key = name.startsWith('/') ? name : `/${name}`;
    // F6.5 (BUG-LEVE-06): detectar ciclos antes de persistir
    const testAliases = { ..._aliases, [key]: command };
    const seen = new Set([key]);
    let current = command.split(' ')[0] ?? '';
    for (let i = 0; i < 10; i++) {
        if (!current || !testAliases[current]) break;
        if (seen.has(current)) {
            return { ok: false, error: `Loop de alias detectado: "${key}" → ${[...seen].join(' → ')} → "${current}"` };
        }
        seen.add(current);
        current = (testAliases[current] ?? '').split(' ')[0] ?? '';
    }
    _aliases[key] = command;
    saveCustomAliases();
    return { ok: true };
}

/**
 * Remove um alias. Built-ins podem ser removidos (mas voltam no loadAliases seguinte se não houver custom).
 *
 * @example
 *     removeAlias('/issues'); // true
 *
 * @param {string} name
 * @returns {boolean} true se removido, false se não existia
 */
export function removeAlias(name) {
    const key = name.startsWith('/') ? name : `/${name}`;
    if (!(key in _aliases)) return false;
    delete _aliases[key];
    saveCustomAliases();
    return true;
}

/**
 * Restaura apenas os aliases built-in, removendo todos os customizados.
 *
 * @returns {void}
 */
export function resetAliases() {
    _aliases = { ...BUILTIN_ALIASES };
    saveCustomAliases();
}

/**
 * Retorna todos os aliases (builtin + custom).
 *
 * @example
 *     const all = getAliases();
 *     Object.entries(all).forEach(([k, v]) => console.log(k, '->', v));
 *
 * @returns {Record<string, string>}
 */
export function getAliases() {
    return { ..._aliases };
}

/**
 * Formata aliases para exibição no terminal.
 *
 * @returns {string}
 */
export function formatAliases() {
    const entries = Object.entries(_aliases);
    if (!entries.length) return '  (nenhum alias)';

    const maxKey = Math.max(...entries.map(([k]) => k.length));
    return entries
        .map(([key, cmd]) => {
            const isBuiltin = BUILTIN_ALIASES[key] !== undefined;
            const tag = isBuiltin ? '\x1b[90m[builtin]\x1b[0m' : '\x1b[32m[custom]\x1b[0m';
            return `  \x1b[36m${key.padEnd(maxKey)}\x1b[0m  →  ${cmd}  ${tag}`;
        })
        .join('\n');
}

// Aliases são carregados explicitamente pelo caller (ex: terminal/index.js → loadAliases())
