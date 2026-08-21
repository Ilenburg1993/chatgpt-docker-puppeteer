import { describe, expect, it } from 'vitest';
import {
    IO_GLOB_ENGINE,
    matchesAnyPattern,
    matchesFilter,
    matchesGlobPattern,
    matchesPlainPathPattern,
    simpleGlobToRegExp,
} from '../../../../src/copilot/infra/indexing/scanner/index.js';

describe('canonical IO glob policy', () => {
    it('uses minimatch v10 as the shared engine', () => {
        expect(IO_GLOB_ENGINE).toBe('minimatch-v10');
    });

    it('supports braces, globstar, extglob and character classes', () => {
        expect(matchesGlobPattern('src/copilot/a.ts', '*.{js,ts}')).toBe(true);
        expect(matchesGlobPattern('src/copilot/nested/a.js', 'src/**/a.{js,ts}')).toBe(true);
        expect(matchesGlobPattern('src/copilot/test-a.js', 'src/**/@(test-a|test-b).js')).toBe(true);
        expect(matchesGlobPattern('src/copilot/a1.ts', 'src/**/a[0-9].ts')).toBe(true);
    });

    it('preserves plain directory and segment compatibility', () => {
        expect(matchesPlainPathPattern('node_modules/pkg/a.js', 'node_modules')).toBe(true);
        expect(matchesGlobPattern('src/copilot/infra/a.js', 'src/copilot')).toBe(true);
        expect(matchesGlobPattern('src/server/a.js', 'src/copilot')).toBe(false);
    });

    it('normalizes Windows separators and supports dot files', () => {
        expect(matchesGlobPattern('src\\copilot\\.hidden.ts', 'src/**/*.ts')).toBe(true);
        expect(matchesGlobPattern('.hidden.ts', '*.ts')).toBe(true);
    });

    it('treats negation and comments literally because include/exclude are separate fields', () => {
        expect(matchesGlobPattern('src/a.js', '!src/**')).toBe(false);
        expect(matchesGlobPattern('#notes.md', '#notes.md')).toBe(true);
    });

    it('matches relative, absolute and basename-oriented patterns', () => {
        const root = '/workspace';
        expect(matchesAnyPattern('/workspace/src/a.ts', root, ['src/**/*.ts'])).toBe(true);
        expect(matchesAnyPattern('/workspace/src/a.ts', root, ['*.ts'])).toBe(true);
        expect(matchesAnyPattern('/workspace/src/a.ts', root, ['/workspace/src/*.ts'])).toBe(true);
    });

    it('keeps filter and regexp compatibility exports functional', () => {
        expect(matchesFilter('alpha.ts', '*.{js,ts}')).toBe(true);
        expect(simpleGlobToRegExp('src/**/*.ts').test('src/nested/a.ts')).toBe(true);
    });
});
