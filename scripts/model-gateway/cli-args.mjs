// @ts-check
/**
 * Primitivas canônicas para parsing dos argumentos dos comandos Model Gateway.
 *
 * Mantém o parser intencionalmente pequeno: estes comandos aceitam `--name=value`
 * e `--name value`; opções sem valor usam o fallback. A leitura por índice é
 * protegida para permanecer correta com `noUncheckedIndexedAccess` no TS7.
 */

/**
 * @param {readonly string[]} args
 * @returns {(name: string, fallback?: string) => string}
 */
export function createArgReader(args) {
    return function readArg(name, fallback = '') {
        const prefix = `${name}=`;
        for (let index = 0; index < args.length; index += 1) {
            const arg = args[index];
            if (arg === undefined) continue;
            if (arg.startsWith(prefix)) return arg.slice(prefix.length);
            if (arg === name) return args[index + 1] ?? fallback;
        }
        return fallback;
    };
}

/**
 * @param {(name: string, fallback?: string) => string} readArg
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
export function readPositiveIntArg(readArg, name, fallback) {
    const value = Number.parseInt(readArg(name), 10);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}
