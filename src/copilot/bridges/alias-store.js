// @ts-check
/**
 * @module copilot/alias-store
 * @file Alias Store — gerencia aliases de comandos do terminal REPL.
 *
 *   Suporta aliases built-in e customizados pelo usuário. Aliases customizados são persistidos em arquivo JSON.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
const ALIASES_FILE = process.env.LLM_B_ALIASES_FILE ?? path.join(os.homedir(), '.copilot-aliases.json');

/** Cache em memória dos aliases (builtin + custom). @type {Record<string, string>} */
let _aliases = /** @type {Record<string, string>} */ ({ ...BUILTIN_ALIASES });

// ---------------------------------------------------------------------------
// Persistência
// ---------------------------------------------------------------------------

/**
 * Carrega aliases customizados do arquivo JSON. Mescla com built-ins (custom tem precedência).
 *
 * @returns {void}
 */
export function loadAliases() {
    try {
        const raw = fs.readFileSync(ALIASES_FILE, 'utf8');
        const custom = JSON.parse(raw);
        _aliases = { ...BUILTIN_ALIASES, ...custom };
    } catch {
        // arquivo não existe ou inválido — usar apenas built-ins
        _aliases = { ...BUILTIN_ALIASES };
    }
}

/**
 * Salva aliases customizados (apenas os não-builtin) no arquivo JSON.
 *
 * @returns {void}
 */
function saveCustomAliases() {
    /** @type {Record<string, string>} */
    const custom = {};
    for (const [k, v] of Object.entries(_aliases)) {
        if (BUILTIN_ALIASES[k] === undefined || BUILTIN_ALIASES[k] !== v) {
            custom[k] = v;
        }
    }
    try {
        fs.writeFileSync(ALIASES_FILE, JSON.stringify(custom, null, 2));
    } catch {
        // silently ignore write errors
    }
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Resolve um alias para o comando completo. Suporta resolução em cadeia (alias que aponta para outro alias), até 5
 * níveis.
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
        if (!alias || seen.has(cmd)) break;
        seen.add(cmd);
        current = rest.length ? `${alias} ${rest.join(' ')}` : alias;
    }
    return current;
}

/**
 * Define um alias (sobrescreve se já existir).
 *
 * @param {string} name - nome do alias (ex: "/issues")
 * @param {string} command - comando alvo (ex: "/gh issue list --state open")
 * @returns {void}
 */
export function setAlias(name, command) {
    const key = name.startsWith('/') ? name : `/${name}`;
    _aliases[key] = command;
    saveCustomAliases();
}

/**
 * Remove um alias. Built-ins podem ser removidos (mas voltam no loadAliases seguinte se não houver custom).
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
