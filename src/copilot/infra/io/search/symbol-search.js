// @ts-check
/**
 * Helpers puros para busca simbólica textual.
 *
 * @module copilot/infra/io/search/symbol-search
 */

/**
 * @typedef {'function' | 'class' | 'variable' | 'export' | 'type' | 'all'} IoSymbolKind
 */

/**
 * @param {string} name
 * @returns {string}
 */
export function escapeRegex(name) {
    return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {string} symbolName
 * @param {IoSymbolKind} kind
 * @returns {string}
 */
export function buildSymbolPattern(symbolName, kind) {
    const n = escapeRegex(symbolName);

    /** @type {Record<IoSymbolKind, string>} */
    const patterns = {
        function: [
            `(?:async\\s+)?function\\s+${n}\\b`,
            `${n}\\s*[:=]\\s*(?:async\\s+)?(?:\\([^)]*\\)|\\w+)\\s*=>`,
            `${n}\\s*[:=]\\s*(?:async\\s+)?function`,
            `def\\s+${n}\\b`,
            `fn\\s+${n}\\b`,
            `func\\s+${n}\\b`,
        ].join('|'),
        class: [`class\\s+${n}\\b`, `${n}\\s*=\\s*class\\b`].join('|'),
        variable: [`(?:const|let|var)\\s+${n}\\b`, `${n}\\s*:?=\\s*(?!>)`].join('|'),
        export: [
            `export\\s+(?:default\\s+)?(?:(?:async\\s+)?function|class|const|let|var|type|interface)\\s+${n}\\b`,
            `export\\s*\\{[^}]*\\b${n}\\b`,
            `module\\.exports[\\[.].*\\b${n}\\b`,
        ].join('|'),
        type: [
            `(?:interface|type)\\s+${n}\\b`,
            `@typedef\\s+\\{[^}]+\\}\\s+${n}\\b`,
            `${n}\\s*=\\s*(?:TypeVar|NewType)\\(`,
        ].join('|'),
        all: [
            `(?:export\\s+(?:default\\s+)?)?(?:(?:async\\s+)?function|class|(?:const|let|var)|interface|type|def\\s|fn\\s|func\\s)\\s*${n}\\b`,
            `${n}\\s*[:=]\\s*(?:async\\s+)?(?:\\([^)]*\\)|\\w+)\\s*=>`,
        ].join('|'),
    };

    return patterns[kind] ?? patterns.all;
}

/**
 * @param {IoSymbolKind} kind
 * @returns {string[]}
 */
export function kindToGlobs(kind) {
    if (kind === 'type') return ['*.ts', '*.tsx', '*.d.ts'];
    return ['*.js', '*.mjs', '*.cjs', '*.ts', '*.tsx', '*.py', '*.rs', '*.go'];
}

/**
 * @param {{
 *     relativePath?: string | null;
 *     filePath: string;
 *     symbolName: string;
 *     symbolKind: string;
 *     line: number;
 *     exported?: number | boolean | null;
 *     docComment?: string | null;
 * }[]} rows
 * @returns {string}
 */
export function formatIndexSymbolRows(rows) {
    return rows
        .map((row) => {
            const location = `${row.relativePath || row.filePath}:${row.line}`;
            const exported = row.exported ? ' export' : '';
            const doc = String(row.docComment ?? '')
                .replace(/\s+/gu, ' ')
                .trim();
            const suffix = doc ? ` — ${doc}` : '';
            return `${location}: ${row.symbolKind} ${row.symbolName}${exported}${suffix}`;
        })
        .join('\n');
}
