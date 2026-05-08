// @ts-check
/**
 * src/copilot/tools/shell/sandbox.js
 *
 * Validação de segurança para comandos shell: blocklist, allowlist, path traversal, detecção de metacaracteres, e
 * ambientes sanitizados.
 *
 * @module copilot/tools/shell/sandbox
 * @see EventBus
 */

import { WORKSPACE_ROOT as BOOT_WORKSPACE_ROOT } from '#copilot/boot';
import { COPILOT_ALLOWED_EXECUTABLES, COPILOT_NPM_SCRIPT_ALLOWLIST } from '#copilot/config';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/** Raiz canonica do workspace definida pelo boot. */
export const WORKSPACE_ROOT = BOOT_WORKSPACE_ROOT;

/**
 * BUG-07 (fix): Detecta metacaracteres shell perigosos fora de aspas simples ou duplas. Evita falsos positivos em
 * argumentos legítimos como caminhos com `$HOME` ou formatos de git log.
 *
 * @param {string} command
 * @returns {boolean}
 */
export function hasShellMetaOutsideQuotes(command) {
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < command.length; i++) {
        const c = command[i];
        if (c === "'" && !inDouble) {
            inSingle = !inSingle;
            continue;
        }
        if (c === '"' && !inSingle) {
            inDouble = !inDouble;
            continue;
        }
        if (!inSingle && !inDouble) {
            if ('|;&<>'.includes(/** @type {string} */ (c))) return true;
            if (c === '`') return true;
            if (c === '$' && command[i + 1] === '(') return true; // subshell $()
        }
    }
    return false;
}

/**
 * Padrões de comandos perigosos bloqueados. Verificados contra o comando completo após tokenização.
 *
 * @type {RegExp[]}
 */
const BLOCKED_COMMAND_PATTERNS = [
    /\brm\s+-[a-z]*r[a-z]*f|rm\s+-[a-z]*f[a-z]*r/i, // rm -rf / rm -fr (flags combinadas)
    /\brm\s+(-\w+\s+){1,4}-[rf]/i, // BUG-MED-10 (fix): rm -r -f / rm -f -r (flags separadas)
    /\brm\b[^\n]*--recursive\b[^\n]*--force\b/i, // rm --recursive --force
    /\brm\b[^\n]*--force\b[^\n]*--recursive\b/i, // rm --force --recursive
    /\bdd\b/,
    /\bmkfs\b/,
    /\bformat\b/,
    /\bfdisk\b/,
    /\bmkswap\b/,
    /\bshred\b/,
    /\bwipe\b/,
    /\bchmod\s+777\b/,
    /\bchown\s+-R.*root/i,
    /\bsudo\b/,
    /\bsu\s/,
    /\bpasswd\b/,
    /\bcurl\b.*\|\s*(sh|bash)/i, // curl | bash pipe (code injection)
    /\bwget\b.*\|\s*(sh|bash)/i, // wget | bash pipe
    /\beval\b.*\$\(/i, // eval $(...) command injection
    />\s*\/dev\//, // write to /dev/*
    /\bkill\s+-9\s+1\b/, // kill PID 1
    /\bpkill\s+-9\b/,
    /\b(reboot|shutdown|halt|poweroff)\b/i,
    /\bcrontab\b/,
    /\bat\s+\w/, // at scheduler
    // SEC-01 (fix): bloquear comandos de enumeração de ambiente que expõem variáveis sensíveis
    /\bprintenv\b/,
    /\benv\b\s*$/, // 'env' sem args lista todas as variáveis
    /\benv\b\s+(-0|--null)\b/i, // env -0 / env --null
    /\bset\b\s*$/, // shell builtin 'set' sem args lista todas as variáveis
];

/**
 * Scripts npm permitidos (whitelist explícita). Qualquer outro script requer revisão. F6.6 (BUG-MOD-13): configurável
 * via COPILOT_NPM_SCRIPT_ALLOWLIST (lista separada por vírgula).
 *
 * @type {Set<string>}
 */
export const ALLOWED_NPM_SCRIPTS = new Set(
    (() => {
        const envAllowlist = COPILOT_NPM_SCRIPT_ALLOWLIST;
        if (envAllowlist) {
            return envAllowlist
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
        }
        return [
            'lint',
            'lint:fix',
            'format',
            'format:check',
            'test:unit',
            'test:fast',
            'test:integration',
            'test:all',
            'typecheck:node',
            'typecheck:tools',
            'typecheck:browser',
            'typecheck:full',
            'typecheck:strict',
            'audit:quick',
            'analyze:deps',
            'diagnose',
            'health:core',
            'health:full',
            'queue:status',
            'queue:flow',
            'queue:clean',
        ];
    })(),
);

/**
 * F15.1 — Allowlist de executáveis para `exec_command`. Configurada via `COPILOT_ALLOWED_EXECUTABLES` (lista separada
 * por vírgula). Quando definida, apenas executáveis na lista passam — o blocklist permanece ativo. Quando não definida
 * (padrão), qualquer executável não bloqueado é permitido.
 *
 * @type {Set<string> | null}
 */
export const ALLOWED_EXECUTABLES = (() => {
    const env = COPILOT_ALLOWED_EXECUTABLES;
    if (!env) return null;
    const list = env
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    return list.length > 0 ? new Set(list) : null;
})();

/** @type {Promise<string> | null} */
let _rootRealPromise = null;

/**
 * @returns {Promise<string>}
 */
async function getWorkspaceRootRealPath() {
    if (!_rootRealPromise) {
        _rootRealPromise = fs.realpath(WORKSPACE_ROOT).catch(() => WORKSPACE_ROOT);
    }
    return _rootRealPromise;
}

/**
 * Verifica se um cwd é seguro (dentro do workspace). SEC-TOOLS-001: resolve symlinks antes de comparar para evitar path
 * traversal via symlink.
 *
 * @param {string | undefined} cwd
 * @returns {Promise<{ ok: boolean; reason?: string; resolved: string }>}
 */
export async function validateCwd(cwd) {
    const resolved = cwd ? (path.isAbsolute(cwd) ? cwd : path.resolve(WORKSPACE_ROOT, cwd)) : WORKSPACE_ROOT;
    const rootReal = await getWorkspaceRootRealPath();

    // Resolve symlinks para bloquear travessia via link simbólico.
    // Se o target não existir, valida o diretório pai real para impedir bypass por parent symlink.
    let real;
    try {
        real = await fs.realpath(resolved);
    } catch {
        const parent = path.dirname(resolved);
        try {
            const parentReal = await fs.realpath(parent);
            real = path.join(parentReal, path.basename(resolved));
        } catch {
            return { ok: false, reason: `Cwd não resolvível com segurança: ${resolved}`, resolved };
        }
    }

    if (!real.startsWith(rootReal + path.sep) && real !== rootReal) {
        return { ok: false, reason: `Cwd fora do workspace: ${resolved}`, resolved };
    }
    return { ok: true, resolved };
}

/**
 * Verifica se o comando contém padrões bloqueados.
 *
 * @param {string} command
 * @returns {{ ok: boolean; reason?: string }}
 */
export function checkCommandBlocklist(command) {
    for (const pattern of BLOCKED_COMMAND_PATTERNS) {
        if (pattern.test(command)) {
            return { ok: false, reason: `Comando bloqueado por política de segurança: ${pattern}` };
        }
    }
    return { ok: true };
}

/**
 * Ambiente seguro para sub-processos: remove variáveis sensíveis.
 *
 * SEC-VULN-04 (fix): além de lista explícita, filtra por padrão todas as variáveis cujo nome sugere credenciais (TOKEN,
 * SECRET, PASSWORD, API_KEY, CREDENTIAL, PRIVATE_KEY).
 *
 * @returns {Record<string, string>}
 */
export function safeEnv() {
    /** @type {{ expiresAt: number; env: Record<string, string> } | null} */
    const cache = /** @type {any} */ (safeEnv)._cache ?? null;
    const now = Date.now();
    if (cache && cache.expiresAt > now) {
        return cache.env;
    }

    const env = { ...process.env };
    // Lista explícita de variáveis sensíveis conhecidas
    const sensitiveExact = new Set([
        'GITHUB_TOKEN',
        'COPILOT_TOKEN',
        'NPM_TOKEN',
        'NPM_AUTH_TOKEN',
        'AWS_SECRET_ACCESS_KEY',
        'AWS_SESSION_TOKEN',
        'GOOGLE_APPLICATION_CREDENTIALS',
        'AZURE_CLIENT_SECRET',
        'DATABASE_URL',
        'DATABASE_PASSWORD',
        'REDIS_URL',
        'REDIS_PASSWORD',
        'JWT_SECRET',
        'SESSION_SECRET',
        'OPENAI_API_KEY',
        'ANTHROPIC_API_KEY',
    ]);
    // Padrão genérico: remove qualquer var cujo nome contenha tokens sensíveis
    const sensitivePattern = /TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL|PRIVATE_KEY/i;
    for (const key of Object.keys(env)) {
        if (sensitiveExact.has(key) || sensitivePattern.test(key)) {
            delete env[key];
        }
    }

    const sanitized = /** @type {Record<string, string>} */ (env);
    /** @type {any} */ (safeEnv)._cache = {
        expiresAt: now + 1000,
        env: sanitized,
    };
    return sanitized;
}
