// @ts-check
/**
 * Builder puro de outline textual a partir de símbolos.
 *
 * @module copilot/infra/code-analysis/outline-builder
 */

/**
 * @param {{
 *     symbols: { kind: string; name: string; exported: boolean; line: number }[];
 *     imports: { source: string; specifiers: string[] }[];
 *     exports?: string[];
 *     parseError: string | null;
 * }} symbols
 * @returns {string[]}
 */
export function buildOutline(symbols) {
    const lines = [];
    const exported = symbols.symbols.filter((s) => s.exported);
    const unexported = symbols.symbols.filter((s) => !s.exported);

    if (exported.length) {
        lines.push(`── Exports (${exported.length})`);
        for (const s of exported) {
            lines.push(`   [${s.kind}] ${s.name} (L${s.line})`);
        }
    }

    const reExports = (symbols.exports ?? []).filter((e) => e.startsWith('* from '));
    if (reExports.length) {
        lines.push(`── Re-exports (${reExports.length})`);
        for (const re of reExports) {
            lines.push(`   export ${re}`);
        }
    }

    if (unexported.length > 0 && unexported.length <= 20) {
        lines.push(`── Internal (${unexported.length})`);
        for (const s of unexported) {
            lines.push(`   [${s.kind}] ${s.name} (L${s.line})`);
        }
    }
    if (symbols.imports.length) {
        lines.push(`── Imports (${symbols.imports.length})`);
        for (const imp of symbols.imports) {
            const specs = imp.specifiers.length
                ? `{ ${imp.specifiers.slice(0, 4).join(', ')}${imp.specifiers.length > 4 ? ', ...' : ''} }`
                : '*';
            lines.push(`   ${specs} from '${imp.source}'`);
        }
    }
    if (symbols.parseError) lines.push(`⚠️ Parse error: ${symbols.parseError}`);
    return lines;
}
