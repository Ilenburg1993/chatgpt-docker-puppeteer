// @ts-check
/**
 * tests/unit/copilot/sdk/test_sdk_config_path_f27.spec.js
 *
 * Faixa 27 — Config Path Unification
 *
 * F128: audit de caminhos de config — sdk/ não bypassa @github/copilot-sdk F129: DEFAULT_EXCLUDED_TOOLS acessível via
 * #copilot/sdk barrel F130: initializer.js usa #copilot/sdk (não #copilot/config/session-config) para
 * DEFAULT_EXCLUDED_TOOLS F131: sdk/config.js exporta constantes centrais de config F132: verificar que zero-bypass se
 * mantém após unificação
 *
 * @module tests/unit/copilot/sdk/test_sdk_config_path_f27
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = '/workspaces/chatgpt-docker-puppeteer';
const SRC = join(ROOT, 'src/copilot');

// ─── F132: zero-bypass intacto após mudanças ───────────────────────────────────

describe("F132 — zero-bypass: nenhum arquivo fora de sdk/ importa '@github/copilot-sdk'", () => {
    it('agent/ não importa @github/copilot-sdk diretamente', async () => {
        const { globSync } = await import('glob');
        const files = globSync(`${SRC}/agent/**/*.js`);
        const violations = files.filter((f) => {
            const content = readFileSync(f, 'utf8');
            return content.includes("from '@github/copilot-sdk'") || content.includes('require("@github/copilot-sdk")');
        });
        expect(violations).toHaveLength(0);
    });

    it('api/ não importa @github/copilot-sdk diretamente', async () => {
        const { globSync } = await import('glob');
        const files = globSync(`${SRC}/api/**/*.js`);
        const violations = files.filter((f) => {
            const content = readFileSync(f, 'utf8');
            return content.includes("from '@github/copilot-sdk'") || content.includes('require("@github/copilot-sdk")');
        });
        expect(violations).toHaveLength(0);
    });

    it('observability/ não importa @github/copilot-sdk diretamente', async () => {
        const { globSync } = await import('glob');
        const files = globSync(`${SRC}/observability/**/*.js`);
        const violations = files.filter((f) => {
            const content = readFileSync(f, 'utf8');
            return content.includes("from '@github/copilot-sdk'") || content.includes('require("@github/copilot-sdk")');
        });
        expect(violations).toHaveLength(0);
    });
});

// ─── F129: DEFAULT_EXCLUDED_TOOLS via #copilot/config ──────────

describe('F129 — DEFAULT_EXCLUDED_TOOLS acessível via config barrel', () => {
    it('config barrel exporta DEFAULT_EXCLUDED_TOOLS', async () => {
        const cfg = await import('#copilot/config');
        expect(cfg.DEFAULT_EXCLUDED_TOOLS).toBeDefined();
    });

    it('DEFAULT_EXCLUDED_TOOLS é array frozen', async () => {
        const cfg = await import('#copilot/config');
        const tools = cfg.DEFAULT_EXCLUDED_TOOLS;
        expect(Array.isArray(tools)).toBe(true);
        expect(Object.isFrozen(tools)).toBe(true);
    });

    it('DEFAULT_EXCLUDED_TOOLS inclui powershell (padrão de segurança)', async () => {
        const cfg = await import('#copilot/config');
        expect(/** @type {readonly string[]} */ (cfg.DEFAULT_EXCLUDED_TOOLS)).toContain('powershell');
    });

    it('DEFAULT_EXCLUDED_TOOLS inclui web_fetch', async () => {
        const cfg = await import('#copilot/config');
        expect(/** @type {readonly string[]} */ (cfg.DEFAULT_EXCLUDED_TOOLS)).toContain('web_fetch');
    });

    it('DEFAULT_EXCLUDED_TOOLS inclui web_search', async () => {
        const cfg = await import('#copilot/config');
        expect(/** @type {readonly string[]} */ (cfg.DEFAULT_EXCLUDED_TOOLS)).toContain('web_search');
    });

    it('DEFAULT_EXCLUDED_TOOLS inclui memory', async () => {
        const cfg = await import('#copilot/config');
        expect(/** @type {readonly string[]} */ (cfg.DEFAULT_EXCLUDED_TOOLS)).toContain('memory');
    });
});

// ─── F130: initializer.js usa #copilot/sdk ────────────────────────────────────

describe('F130 — session-setup.js usa config canônica para DEFAULT_EXCLUDED_TOOLS', () => {
    it('session-setup.js não importa DEFAULT_EXCLUDED_TOOLS de #copilot/config/session-config', () => {
        const content = readFileSync(join(SRC, 'agent/lifecycle/setup/session-setup.js'), 'utf8');
        // Não deve ter o import antigo
        expect(content).not.toContain("import { DEFAULT_EXCLUDED_TOOLS } from '#copilot/config/session-config'");
    });

    it('session-setup.js importa DEFAULT_EXCLUDED_TOOLS do config barrel', () => {
        const content = readFileSync(join(SRC, 'agent/lifecycle/setup/session-setup.js'), 'utf8');
        expect(content).toContain("from '#copilot/config'");
    });

    it('session-setup.js ainda usa DEFAULT_EXCLUDED_TOOLS', () => {
        const content = readFileSync(join(SRC, 'agent/lifecycle/setup/session-setup.js'), 'utf8');
        expect(content).toContain('DEFAULT_EXCLUDED_TOOLS');
    });
});

// ─── F131: DEFAULT_EXCLUDED_TOOLS definido em config/index.js ──────────

describe('F131 — config/index.js exporta DEFAULT_EXCLUDED_TOOLS', () => {
    it('config/index.js tem DEFAULT_EXCLUDED_TOOLS definido localmente', () => {
        const content = readFileSync(join(SRC, 'config/index.js'), 'utf8');
        expect(content).toContain('export const DEFAULT_EXCLUDED_TOOLS');
    });

    it('config barrel exporta DEFAULT_EXCLUDED_TOOLS como array', async () => {
        const config = await import('#copilot/config');
        expect(Array.isArray(config.DEFAULT_EXCLUDED_TOOLS)).toBe(true);
    });

    // sdk/config.js não exporta mais DEFAULT_EXCLUDED_TOOLS (removido intencionalmente)
    it('sdk/config.js NÃO exporta DEFAULT_EXCLUDED_TOOLS (removido)', () => {
        const content = readFileSync(join(SRC, 'sdk/config.js'), 'utf8');
        expect(content).not.toContain('export const DEFAULT_EXCLUDED_TOOLS');
    });
});

// ─── F128: audit de zero-bypass completo ──────────────────────────────────────

describe('F128 — audit: nenhum arquivo do projeto importa @github/copilot-sdk diretamente fora de sdk/', () => {
    it('apenas sdk/ importa @github/copilot-sdk', async () => {
        const { globSync } = await import('glob');
        const allFiles = globSync(`${SRC}/**/*.js`);
        const sdkFiles = allFiles.filter((f) => f.includes('/sdk/'));
        const nonSdkFiles = allFiles.filter((f) => !f.includes('/sdk/'));

        const violations = nonSdkFiles.filter((f) => {
            const content = readFileSync(f, 'utf8');
            return content.includes("from '@github/copilot-sdk'") || content.includes("require('@github/copilot-sdk')");
        });

        // Se há violações, reportar quais arquivos para facilitar debugging
        const violationPaths = violations.map((f) => f.replace(ROOT + '/', ''));
        expect(violationPaths).toHaveLength(0);
    });
});
