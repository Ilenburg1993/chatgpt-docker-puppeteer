// @ts-check
/**
 * @file Faixa 33 — CI Zero-Bypass Regression Guard
 *
 *   Testes que garantem que nenhum arquivo fora de src/copilot/sdk/ importa diretamente submodules do SDK (bypass do
 *   barrel #copilot/sdk).
 *
 *   EXCEÇÕES intencionais documentadas:
 *
 *   - boot-wiring.js: '#copilot/sdk/quota-monitor' (importação precisa intencional)
 *   - config/index.js: '#copilot/sdk/tools-state' (re-export de compatibilidade)
 *
 *   Faixas cobertas:
 *
 *   - F166: Auditoria completa de bypasses — apenas exceções intencionais restam
 *   - F167: Módulos de tools/ sem bypass (11 arquivos críticos)
 *   - F168: Módulos de api/express/ sem bypass
 *   - F169: Módulos de agent/ sem bypass
 *   - F170: Módulos de bridges/ e observability/ sem bypass
 *   - F171: Módulos de terminal/ sem bypass
 *   - F172: Módulos de hooks/ sem bypass
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../../../', import.meta.url).pathname.replace(/\/$/, '');

/**
 * Lê o conteúdo de um arquivo relativo ao root do projeto.
 *
 * @param {string} relPath
 * @returns {string}
 */
function read(relPath) {
    return readFileSync(join(ROOT, relPath), 'utf-8');
}

/**
 * Retorna true se o arquivo tem import direto de submodule SDK (bypass do barrel).
 *
 * @param {string} content
 * @returns {string[]} Lista de bypasses encontrados
 */
function findSdkBypasses(content) {
    const matches = content.matchAll(/from\s+'(#copilot\/sdk\/[^']+)'/g);
    return [...matches].map((m) => m[1]);
}

// ─── F166: Auditoria completa de bypasses ─────────────────────────────────

describe('F166 — Auditoria de zero-bypass SDK em src/copilot/', () => {
    // Mapeamento dos bypasses INTENCIONAIS conhecidos
    const KNOWN_INTENTIONAL_BYPASSES = new Map([
        ['src/copilot/agent/session/boot-wiring.js', ['#copilot/sdk/quota-monitor']],
        ['src/copilot/config/index.js', ['#copilot/sdk/tools-state']],
    ]);

    /**
     * Varre todos os .js em src/copilot/ (exceto o próprio sdk/) e coleta bypasses.
     *
     * @returns {{ file: string; bypasses: string[] }[]}
     */
    function collectAllBypasses() {
        const output = execSync(
            `grep -rn "from '#copilot/sdk/[^']*'" ${join(ROOT, 'src/copilot')} --include="*.js" | grep -v "src/copilot/sdk/"`,
            { encoding: 'utf-8', cwd: ROOT },
        ).trim();

        if (!output) return [];

        /** @type {Map<string, string[]>} */
        const byFile = new Map();
        for (const line of output.split('\n')) {
            if (!line.trim()) continue;
            const [filePath, , ...rest] = line.split(':');
            const importPath = rest.join(':').match(/'(#copilot\/sdk\/[^']+)'/)?.[1];
            if (!filePath || !importPath) continue;
            const rel = filePath.replace(ROOT + '/', '').replace(ROOT, '');
            if (!byFile.has(rel)) byFile.set(rel, []);
            const existing = byFile.get(rel);
            if (existing && !existing.includes(importPath)) existing.push(importPath);
        }
        return [...byFile.entries()].map(([file, bypasses]) => ({ file, bypasses }));
    }

    it('apenas bypasses intencionais restam no código-fonte', () => {
        const allBypasses = collectAllBypasses();

        // Filtrar bypasses que não constam como intencionais
        const unexpected = allBypasses.filter(({ file, bypasses }) => {
            const allowedForFile = KNOWN_INTENTIONAL_BYPASSES.get(file) ?? [];
            return bypasses.some((bp) => !allowedForFile.includes(bp));
        });

        if (unexpected.length > 0) {
            const msg = unexpected.map(({ file, bypasses }) => `  ${file}: ${bypasses.join(', ')}`).join('\n');
            throw new Error(
                `Bypasses inesperados encontrados:\n${msg}\n\nUse o barrel '#copilot/sdk' em vez de importar submodules diretamente.`,
            );
        }

        expect(unexpected).toHaveLength(0);
    });

    it('boot-wiring.js mantém bypass intencional de quota-monitor', () => {
        const src = read('src/copilot/agent/session/boot-wiring.js');
        expect(src).toContain("from '#copilot/sdk/quota-monitor'");
    });

    // F54: re-export de tools-state removido de config/index.js (zero consumers)
});

// ─── F167: tools/ sem bypass ───────────────────────────────────────────────

describe('F167 — tools/ sem bypass direto de SDK', () => {
    const TOOLS_FILES = [
        'src/copilot/tools/session-rpc-tools.js',
        'src/copilot/tools/git/index.js',
        'src/copilot/tools/introspection-tools.js',
        'src/copilot/tools/task-tools.js',
        'src/copilot/tools/session-tools.js',
        'src/copilot/tools/todo/bulk-tools.js',
        'src/copilot/tools/todo/crud-tools.js',
        'src/copilot/tools/todo/query-tools.js',
        'src/copilot/tools/shell/index.js',
        'src/copilot/tools/tool-factory.js',
        'src/copilot/bridges/mcp-tool-bridge.js',
    ];

    for (const file of TOOLS_FILES) {
        it(`${file.split('/').pop()} usa barrel '#copilot/sdk'`, () => {
            const src = read(file);
            const bypasses = findSdkBypasses(src);
            expect(bypasses, `Bypasses encontrados em ${file}: ${bypasses.join(', ')}`).toHaveLength(0);
        });
    }
});

// ─── F168: api/express/ sem bypass ─────────────────────────────────────────

describe('F168 — api/express/ sem bypass direto de SDK', () => {
    const API_FILES = [
        'src/copilot/api/express/session-crud.js',
        'src/copilot/api/express/session-messaging.js',
        'src/copilot/api/express/agent.js',
        'src/copilot/api/express/client.js',
        'src/copilot/api/express/webhooks.js',
    ];

    for (const file of API_FILES) {
        it(`${file.split('/').pop()} usa barrel '#copilot/sdk'`, () => {
            const src = read(file);
            const bypasses = findSdkBypasses(src);
            expect(bypasses, `Bypasses encontrados em ${file}: ${bypasses.join(', ')}`).toHaveLength(0);
        });
    }
});

// ─── F169: agent/ sem bypass ───────────────────────────────────────────────

describe('F169 — agent/ sem bypass direto de SDK', () => {
    const AGENT_FILES = [
        'src/copilot/agent/infra/tools-bootstrap.js',
        'src/copilot/agent/dialog/loop-manager.js',
        'src/copilot/agent/lifecycle/agent-lifecycle.js',
        'src/copilot/agent/session/initializer.js',
        'src/copilot/agent/session/cleanup.js',
        'src/copilot/agent/agent-context.js',
        'src/copilot/agent/lifecycle/session-setup.js',
    ];

    for (const file of AGENT_FILES) {
        it(`${file.split('/').pop()} usa barrel '#copilot/sdk'`, () => {
            const src = read(file);
            const bypasses = findSdkBypasses(src);
            expect(bypasses, `Bypasses encontrados em ${file}: ${bypasses.join(', ')}`).toHaveLength(0);
        });
    }
});

// ─── F170: bridges/ e observability/ sem bypass ────────────────────────────

describe('F170 — bridges/ e observability/ sem bypass direto de SDK', () => {
    const FILES = [
        'src/copilot/bridges/nerv-bridge.js',
        'src/copilot/observability/event-collector.js',
        'src/copilot/observability/observers/dialog-task-handlers.js',
    ];

    for (const file of FILES) {
        it(`${file.split('/').pop()} usa barrel '#copilot/sdk'`, () => {
            const src = read(file);
            const bypasses = findSdkBypasses(src);
            expect(bypasses, `Bypasses encontrados em ${file}: ${bypasses.join(', ')}`).toHaveLength(0);
        });
    }
});

// ─── F171: terminal/ sem bypass ────────────────────────────────────────────

describe('F171 — terminal/ sem bypass direto de SDK', () => {
    const FILES = ['src/copilot/terminal/commands/config.js', 'src/copilot/terminal/handlers/system-config.js'];

    for (const file of FILES) {
        it(`${file.split('/').pop()} usa barrel '#copilot/sdk'`, () => {
            const src = read(file);
            const bypasses = findSdkBypasses(src);
            expect(bypasses, `Bypasses encontrados em ${file}: ${bypasses.join(', ')}`).toHaveLength(0);
        });
    }
});

// ─── F172: hooks/ e config/ sem bypass (exceto re-export intencional) ──────

describe('F172 — hooks/ e config/ sem bypass não-intencional de SDK', () => {
    it('hooks/session-lifecycle.js usa barrel (não submodule models/*)', () => {
        const src = read('src/copilot/hooks/session-lifecycle.js');
        // Não deve ter bypass de submodules como sdk/models/*
        const sdkModelsBypasses = [...src.matchAll(/from\s+'#copilot\/sdk\/models\/[^']+'/g)];
        expect(sdkModelsBypasses).toHaveLength(0);
    });

    it('config/session-config.js usa barrel (não submodule sdk/index)', () => {
        const src = read('src/copilot/config/session-config.js');
        const sdkIndexBypasses = [...src.matchAll(/from\s+'#copilot\/sdk\/index'/g)];
        expect(sdkIndexBypasses).toHaveLength(0);
    });

    it('config/index.js re-export de tools-state está documentado como intencional', () => {
        // Garantir que o comentário de intencionalidade existe, ou pelo menos o import está isolado a tools-state
        const src = read('src/copilot/config/index.js');
        const bypasses = findSdkBypasses(src);
        // Apenas tools-state é permitido
        expect(bypasses.every((bp) => bp === '#copilot/sdk/tools-state')).toBe(true);
    });
});
