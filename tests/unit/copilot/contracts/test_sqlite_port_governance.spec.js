// @ts-check

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const INFRA_ROOT = new URL('../../../../src/copilot/infra/', import.meta.url).pathname;
const PORT_PATH = join(INFRA_ROOT, 'database', 'port', 'contract.js');
const CONCRETE_BETTER_SQLITE_ROOT = join(INFRA_ROOT, 'database', 'sqlite', 'better-sqlite3');
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts']);

/** @param {string} directory @returns {string[]} */
function listSources(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const filePath = join(directory, entry.name);
        if (entry.isDirectory()) return listSources(filePath);
        return entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name)) ? [filePath] : [];
    });
}

/** @param {string} source */
function importedSpecifiers(source) {
    const patterns = [
        /(?:^|\n)\s*(?:import|export)\b[\s\S]{0,2048}?\bfrom\s*['"]([^'"]+)['"]/gu,
        /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/gu,
        /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu,
        /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/gu,
    ];
    const result = new Set();
    for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
            if (match[1]) result.add(match[1]);
        }
    }
    return [...result];
}

describe('Infra SQLite structural-port governance', () => {
    it('only the concrete better-sqlite3 adapter/runtime owner may import or type the concrete driver', () => {
        const violations = [];
        const concreteOwners = [];
        for (const filePath of listSources(INFRA_ROOT)) {
            const source = readFileSync(filePath, 'utf8');
            const concrete = importedSpecifiers(source).filter(
                (specifier) => specifier === 'better-sqlite3' || specifier.startsWith('better-sqlite3/'),
            );
            if (concrete.length === 0) continue;
            if (filePath.startsWith(`${CONCRETE_BETTER_SQLITE_ROOT}/`)) {
                concreteOwners.push(filePath.slice(INFRA_ROOT.length));
                continue;
            }
            violations.push({ filePath: filePath.slice(INFRA_ROOT.length), concrete });
        }
        expect(violations).toEqual([]);
        expect(concreteOwners.length).toBeGreaterThan(0);
    });

    it('SQLite owners use the canonical port instead of ad-hoc Function mini-ports', () => {
        const violations = [];
        for (const filePath of listSources(INFRA_ROOT)) {
            const source = readFileSync(filePath, 'utf8');
            const matches = ['prepare: Function', 'exec: Function', 'transaction?: Function'].filter((token) =>
                source.includes(token),
            );
            if (
                !filePath.startsWith(`${CONCRETE_BETTER_SQLITE_ROOT}/`) &&
                source.includes("import('better-sqlite3').Database")
            ) {
                matches.push("import('better-sqlite3').Database");
            }
            if (matches.length > 0) violations.push({ filePath: filePath.slice(INFRA_ROOT.length), matches });
        }
        expect(violations).toEqual([]);
    });

    it('the Infra port remains a minimal SQL execution contract, not a driver lifecycle facade', () => {
        expect(statSync(PORT_PATH).isFile()).toBe(true);
        const source = readFileSync(PORT_PATH, 'utf8');
        expect(source).toContain('SqliteDatabasePort');
        expect(source).toContain('prepare: (source: string) => SqliteStatementPort');
        expect(source).toContain('exec: (source: string) => unknown');
        expect(source).toContain('transaction?: (operation: () => unknown) => () => unknown');

        const forbiddenMembers = [
            /\bpragma\s*:/u,
            /\bclose\s*:/u,
            /\bbackup\s*:/u,
            /\bloadExtension\s*:/u,
            /\bserialize\s*:/u,
            /\bunsafeMode\s*:/u,
        ];
        expect(forbiddenMembers.filter((pattern) => pattern.test(source))).toEqual([]);
    });
});
