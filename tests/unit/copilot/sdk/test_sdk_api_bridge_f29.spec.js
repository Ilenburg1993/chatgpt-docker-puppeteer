// @ts-check
/**
 * @file Faixa 29 — API Bridge Hardening
 *
 *   Verifica que:
 *
 *   - F139: camada api/express não importa #copilot/sdk/client diretamente (usa barrel)
 *   - F140: session-crud.js usa barrel para imports de client
 *   - F141: session-messaging.js usa barrel para imports de client
 *   - F142: agent.js usa barrel para getClient
 *   - F143: client.js usa barrel para getClient/getClientState/stopClient
 *   - F144: barrel exporta todas as funções de client (cobertura de contratos)
 *   - F145: zero-bypass completo — nenhum arquivo em api/ importa sdk submodules diretamente
 */

import {
    createClientSession,
    disconnectClientSession,
    getClient,
    getClientSession,
    getClientState,
    getClientStatus,
    incrementSessionMessageCount,
    listActiveClientSessions,
    stopClient,
} from '#copilot/sdk';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { describe, expect, it } from 'vitest';

const ROOT = '/workspaces/chatgpt-docker-puppeteer';

/** @param {string} relPath */
const src = (relPath) => readFileSync(join(ROOT, relPath), 'utf8');

// ─── F139: camada api não importa sdk/client diretamente ──────────────────

describe('F139 — api/express não importa #copilot/sdk/client diretamente', () => {
    const apiFiles = [
        'src/copilot/api/express/client.js',
        'src/copilot/api/express/agent.js',
        'src/copilot/api/express/session-crud.js',
        'src/copilot/api/express/session-messaging.js',
        'src/copilot/api/express/sessions.js',
        'src/copilot/api/express/hooks.js',
        'src/copilot/api/express/middleware.js',
        'src/copilot/api/express/observability.js',
    ];

    for (const file of apiFiles) {
        it(`${file.split('/').pop()} não contém import de #copilot/sdk/client`, () => {
            const content = src(file);
            expect(content).not.toContain("from '#copilot/sdk/client'");
        });
    }
});

// ─── F140: session-crud.js usa barrel ──────────────────────────────────────

describe('F140 — session-crud.js usa barrel para funções de client', () => {
    it('importa createClientSession do barrel', () => {
        const content = src('src/copilot/api/express/session-crud.js');
        expect(content).toContain('createClientSession');
        expect(content).toContain("from '#copilot/sdk'");
    });

    it('importa listActiveClientSessions do barrel', () => {
        const content = src('src/copilot/api/express/session-crud.js');
        expect(content).toContain('listActiveClientSessions');
        expect(content).toContain("from '#copilot/sdk'");
    });

    it('importa getClient do barrel', () => {
        const content = src('src/copilot/api/express/session-crud.js');
        expect(content).toContain('getClient');
        expect(content).toContain("from '#copilot/sdk'");
    });
});

// ─── F141: session-messaging.js usa barrel ─────────────────────────────────

describe('F141 — session-messaging.js usa barrel para funções de client', () => {
    it('importa getClientSession do barrel', () => {
        const content = src('src/copilot/api/express/session-messaging.js');
        expect(content).toContain('getClientSession');
        expect(content).toContain("from '#copilot/sdk'");
    });

    it('importa incrementSessionMessageCount do barrel', () => {
        const content = src('src/copilot/api/express/session-messaging.js');
        expect(content).toContain('incrementSessionMessageCount');
        expect(content).toContain("from '#copilot/sdk'");
    });
});

// ─── F142: agent.js usa barrel ─────────────────────────────────────────────

describe('F142 — agent.js usa barrel para getClient', () => {
    it('importa getClient de #copilot/sdk (não de submodule)', () => {
        const content = src('src/copilot/api/express/agent.js');
        expect(content).toContain("import { getClient } from '#copilot/sdk'");
        expect(content).not.toContain("from '#copilot/sdk/client'");
    });
});

// ─── F143: client.js usa barrel ────────────────────────────────────────────

describe('F143 — client.js usa barrel para getClient/getClientState/stopClient', () => {
    it('importa getClient, getClientState, stopClient de #copilot/sdk', () => {
        const content = src('src/copilot/api/express/client.js');
        expect(content).toContain('getClient');
        expect(content).toContain('getClientState');
        expect(content).toContain('stopClient');
        expect(content).toContain("from '#copilot/sdk'");
        expect(content).not.toContain("from '#copilot/sdk/client'");
    });
});

// ─── F144: barrel exporta funções de client ────────────────────────────────

describe('F144 — barrel exporta funções de client', () => {
    it('exporta getClient', () => expect(typeof getClient).toBe('function'));
    it('exporta getClientState', () => expect(typeof getClientState).toBe('function'));
    it('exporta stopClient', () => expect(typeof stopClient).toBe('function'));
    it('exporta getClientSession', () => expect(typeof getClientSession).toBe('function'));
    it('exporta getClientStatus', () => expect(typeof getClientStatus).toBe('function'));
    it('exporta createClientSession', () => expect(typeof createClientSession).toBe('function'));
    it('exporta disconnectClientSession', () => expect(typeof disconnectClientSession).toBe('function'));
    it('exporta listActiveClientSessions', () => expect(typeof listActiveClientSessions).toBe('function'));
    it('exporta incrementSessionMessageCount', () => expect(typeof incrementSessionMessageCount).toBe('function'));
});

// ─── F145: zero-bypass completo em api/ ────────────────────────────────────

describe('F145 — zero-bypass: api/ não importa submodules do sdk diretamente', () => {
    const SDK_SUBMODULES = [
        '#copilot/sdk/client',
        '#copilot/sdk/session',
        '#copilot/sdk/health',
        '#copilot/sdk/quota-monitor',
        '#copilot/sdk/tools-registry',
    ];

    for (const mod of SDK_SUBMODULES) {
        it(`api/ não importa "${mod}"`, () => {
            const { execSync } = /** @type {typeof import('node:child_process')} */ (
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                require('node:child_process')
            );
            let found = false;
            try {
                const result = execSync(`grep -rl "from '${mod}'" ${ROOT}/src/copilot/api/ --include='*.js'`, {
                    encoding: 'utf8',
                });
                found = result.trim().length > 0;
            } catch {
                found = false;
            }
            expect(found).toBe(false);
        });
    }
});
