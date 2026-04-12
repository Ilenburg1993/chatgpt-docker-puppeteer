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

// ─── F140: session-crud.js usa #copilot/services ─────────────────────────────

describe('F140 — session-crud.js usa #copilot/services para funções de client', () => {
    it('importa createSessionService do barrel services', () => {
        const content = src('src/copilot/api/express/session-crud.js');
        expect(content).toContain('createSessionService');
        expect(content).toContain("from '#copilot/services'");
    });

    it('importa approveAll do barrel services', () => {
        const content = src('src/copilot/api/express/session-crud.js');
        expect(content).toContain('approveAll');
        expect(content).toContain("from '#copilot/services'");
    });
});

// ─── F141: session-messaging.js usa #copilot/services ────────────────────────

describe('F141 — session-messaging.js usa #copilot/services para funções de client', () => {
    it('importa createSessionService do barrel services', () => {
        const content = src('src/copilot/api/express/session-messaging.js');
        expect(content).toContain('createSessionService');
        expect(content).toContain("from '#copilot/services'");
    });
});

// ─── F142/F143: agent.js e client.js usam DI ──────────────────────────────

describe('F142 — agent.js recebe getClient via DI (não import)', () => {
    it('não importa getClient diretamente — recebe via deps', () => {
        const content = src('src/copilot/api/express/agent.js');
        expect(content).toContain('getClient');
        expect(content).not.toContain('import { getClient }');
    });
});

describe('F143 — client.js recebe getClient/getClientState/stopClient via DI', () => {
    it('não importa de #copilot/sdk — recebe via deps', () => {
        const content = src('src/copilot/api/express/client.js');
        expect(content).toContain('getClient');
        expect(content).toContain('getClientState');
        expect(content).toContain('stopClient');
        expect(content).not.toContain('import { getClient }');
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
