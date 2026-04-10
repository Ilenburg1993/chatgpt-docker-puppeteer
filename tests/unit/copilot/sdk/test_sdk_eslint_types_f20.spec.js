/**
 * @file Faixa 20 — ESLint Enforcement + Types Cleanup
 *
 *   Verifica:
 *
 *   - ESLint rule `no-restricted-imports` bloqueia `@github/copilot-sdk` fora de `sdk/`
 *   - `hooks/types.js` importa de `sdk/types.js` (não de `@github/copilot-sdk`)
 *   - `core/sdk-types.js` importa de `sdk/types.js` (deprecated, não de `@github/copilot-sdk`)
 *   - `config/index.js` marca re-exports de sdk/ como deprecated
 *   - Zero imports diretos residuais em toda a codebase copilot
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const ROOT = resolve(import.meta.dirname, '../../../../');
const SRC_COPILOT = join(ROOT, 'src/copilot');

/**
 * @param {string} relPath
 * @returns {string}
 */
function readSource(relPath) {
    return readFileSync(join(SRC_COPILOT, relPath), 'utf8');
}

// ---------------------------------------------------------------------------
// 1. ESLint config tem no-restricted-imports
// ---------------------------------------------------------------------------
describe('F20 — ESLint no-restricted-imports', () => {
    it('eslint.config.mjs contém regra no-restricted-imports para @github/copilot-sdk', () => {
        const eslintCfg = readFileSync(join(ROOT, 'eslint.config.mjs'), 'utf8');
        expect(eslintCfg).toContain('no-restricted-imports');
        expect(eslintCfg).toContain('@github/copilot-sdk');
    });

    it('A regra aplica-se a src/copilot/**/*.js', () => {
        const eslintCfg = readFileSync(join(ROOT, 'eslint.config.mjs'), 'utf8');
        expect(eslintCfg).toContain('src/copilot/**/*.js');
    });

    it('A regra ignora src/copilot/sdk/**', () => {
        const eslintCfg = readFileSync(join(ROOT, 'eslint.config.mjs'), 'utf8');
        expect(eslintCfg).toContain('src/copilot/sdk/**');
    });
});

// ---------------------------------------------------------------------------
// 2. hooks/types.js alinhado com sdk/types.js
// ---------------------------------------------------------------------------
describe('F20 — hooks/types.js alinhamento', () => {
    it('hooks/types.js NÃO importa de @github/copilot-sdk em tipo PermissionHandler', () => {
        const src = readSource('hooks/types.js');
        const directImports = src.split('\n').filter((line) => /import\('@github\/copilot-sdk'\)/.test(line));
        expect(directImports, 'hooks/types.js não deveria importar de @github/copilot-sdk').toHaveLength(0);
    });

    it('hooks/types.js importa PermissionHandler de sdk/types.js', () => {
        const src = readSource('hooks/types.js');
        expect(src).toContain("import('#copilot/sdk/types.js').PermissionHandler");
    });

    it('hooks/types.js importa PermissionRequest de sdk/types.js', () => {
        const src = readSource('hooks/types.js');
        expect(src).toContain("import('#copilot/sdk/types.js').PermissionRequest");
    });

    it('hooks/types.js importa PermissionRequestResult de sdk/types.js', () => {
        const src = readSource('hooks/types.js');
        expect(src).toContain("import('#copilot/sdk/types.js').PermissionRequestResult");
    });

    it('hooks/types.js preserva typedef SessionHooks (não afetado pela migração)', () => {
        const src = readSource('hooks/types.js');
        expect(src).toContain('@typedef {object} SessionHooks');
    });
});

// ---------------------------------------------------------------------------
// 3. core/sdk-types.js deprecated e migrado
// ---------------------------------------------------------------------------
describe('F20 — core/sdk-types.js deprecation', () => {
    it('core/sdk-types.js tem @deprecated', () => {
        const src = readSource('core/sdk-types.js');
        expect(src).toContain('@deprecated');
    });

    it('core/sdk-types.js NÃO importa de @github/copilot-sdk', () => {
        const src = readSource('core/sdk-types.js');
        expect(src).not.toContain('@github/copilot-sdk');
    });

    it('core/sdk-types.js importa de #copilot/sdk/types.js', () => {
        const src = readSource('core/sdk-types.js');
        expect(src).toContain('#copilot/sdk/types.js');
    });
});

// ---------------------------------------------------------------------------
// 4. config/index.js boundary fix
// ---------------------------------------------------------------------------
describe('F20 — config/index.js boundary fix', () => {
    it('config/index.js marca re-exports de custom-tools como deprecated', () => {
        const src = readSource('config/index.js');
        // Procura pattern: @deprecated seguido (em poucas linhas) por #copilot/sdk/custom-tools
        const deprecatedCustomTools = /@deprecated[\s\S]{0,300}#copilot\/sdk\/custom-tools/.test(src);
        expect(deprecatedCustomTools).toBe(true);
    });

    it('config/index.js marca re-exports de tools-state como deprecated', () => {
        const src = readSource('config/index.js');
        const deprecatedToolsState = /@deprecated[\s\S]{0,300}#copilot\/sdk\/tools-state/.test(src);
        expect(deprecatedToolsState).toBe(true);
    });

    it('config/index.js preserva exports locais (não-sdk)', () => {
        const src = readSource('config/index.js');
        expect(src).toContain("from './system-prompt.js'");
    });
});

// ---------------------------------------------------------------------------
// 5. Verificação global: zero type imports de @github/copilot-sdk em hooks/types e core/sdk-types
// ---------------------------------------------------------------------------
describe('F20 — Cleanup: zero runtime imports de @github/copilot-sdk fora de sdk/', () => {
    it('Nenhum arquivo fora de sdk/ tem runtime import (import statement) de @github/copilot-sdk', () => {
        /**
         * @param {string} dir
         * @returns {string[]}
         */
        function collectJsFiles(dir) {
            /** @type {string[]} */
            const results = [];
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                const full = join(dir, entry.name);
                if (entry.isDirectory()) {
                    results.push(...collectJsFiles(full));
                } else if (entry.name.endsWith('.js')) {
                    results.push(relative(SRC_COPILOT, full));
                }
            }
            return results;
        }

        const allNonSdk = collectJsFiles(SRC_COPILOT).filter((f) => !f.startsWith('sdk/'));
        /** @type {string[]} */
        const violations = [];

        for (const file of allNonSdk) {
            const src = readSource(file);
            const lines = src.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const t = line.trimStart();
                // Ignorar comentários JSDoc, // comments — apenas olhar runtime imports
                if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/**')) continue;
                // Runtime import: `import { X } from '@github/copilot-sdk'`
                if (/^\s*import\s.*from\s+['"]@github\/copilot-sdk['"]/.test(line)) {
                    violations.push(`${file}:${i + 1}`);
                }
            }
        }

        expect(violations, `Runtime imports diretos encontrados:\n${violations.join('\n')}`).toHaveLength(0);
    });
});
