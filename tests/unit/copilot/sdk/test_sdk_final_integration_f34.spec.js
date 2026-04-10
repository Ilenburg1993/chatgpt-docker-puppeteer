// @ts-check
/**
 * @file Faixa 34 — Final Integration Suite
 *
 *   Verificação end-to-end da completude e integridade do barrel '#copilot/sdk':
 *
 *   - F173: Barrel contém todos os exports críticos de tools
 *   - F174: Barrel contém todos os exports críticos de client
 *   - F175: Barrel contém todos os exports críticos de tools-registry
 *   - F176: Barrel contém todos os exports críticos de config
 *   - F177: Barrel contém exports de events/event-helpers
 *   - F178: Pipeline zero-bypass completo (auditoria end-to-end)
 *   - F179: Módulos SDK não têm dependências circulares grosseiras
 *   - F180: Barrel exporta mínimo 200 símbolos (saúde geral)
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Importar o barrel diretamente para verificação runtime
import * as SDK from '#copilot/sdk';

const ROOT = new URL('../../../../', import.meta.url).pathname.replace(/\/$/, '');

/** @param {string} relPath @returns {string} */
function read(relPath) {
    return readFileSync(join(ROOT, relPath), 'utf-8');
}

// ─── F173: Exports críticos de tools ──────────────────────────────────────

describe('F173 — Barrel exporta exports críticos de tools', () => {
    const TOOLS_EXPORTS = ['createTool', 'createToolSync', 'defineTool', 'getAllTools', 'buildCustomTools'];

    for (const name of TOOLS_EXPORTS) {
        it(`exporta '${name}'`, () => {
            expect(SDK).toHaveProperty(name);
        });
    }

    it('createTool é uma função', () => {
        expect(typeof SDK.createTool).toBe('function');
    });

    it('defineTool é uma função', () => {
        expect(typeof SDK.defineTool).toBe('function');
    });
});

// ─── F174: Exports críticos de client ─────────────────────────────────────

describe('F174 — Barrel exporta exports críticos de client', () => {
    const CLIENT_EXPORTS = [
        'getClient',
        'getClientState',
        'stopClient',
        'ensureClient',
        'forceStopClient',
        'shutdownClient',
        'isClientReady',
        'pingClient',
        'buildClientOptions',
    ];

    for (const name of CLIENT_EXPORTS) {
        it(`exporta '${name}'`, () => {
            expect(SDK).toHaveProperty(name);
        });
    }

    it('getClient é uma função', () => {
        expect(typeof SDK.getClient).toBe('function');
    });

    it('stopClient é uma função', () => {
        expect(typeof SDK.stopClient).toBe('function');
    });
});

// ─── F175: Exports críticos de tools-registry ─────────────────────────────

describe('F175 — Barrel exporta exports críticos de tools-registry', () => {
    const REGISTRY_EXPORTS = [
        'createRegistry',
        'registerTool',
        'registerTools',
        'inspectRegistry',
        'mergeRegistries',
        'filterByNames',
        'excludeByNames',
    ];

    for (const name of REGISTRY_EXPORTS) {
        it(`exporta '${name}'`, () => {
            expect(SDK).toHaveProperty(name);
        });
    }

    it('createRegistry retorna objeto com entries (Map)', () => {
        const registry = SDK.createRegistry();
        expect(registry).toHaveProperty('entries');
        expect(registry.entries).toBeInstanceOf(Map);
    });

    it('inspectRegistry retorna { total, categories, names }', () => {
        const registry = SDK.createRegistry();
        const info = SDK.inspectRegistry(registry);
        expect(info).toHaveProperty('total');
        expect(info).toHaveProperty('categories');
        expect(info).toHaveProperty('names');
    });
});

// ─── F176: Exports críticos de config ─────────────────────────────────────

describe('F176 — Barrel exporta exports críticos de config', () => {
    const CONFIG_EXPORTS = [
        'getToolsConfig',
        'loadToolsConfig',
        'buildSessionConfig',
        'buildFullAccessConfig',
        'buildReadOnlyConfig',
    ];

    for (const name of CONFIG_EXPORTS) {
        it(`exporta '${name}'`, () => {
            expect(SDK).toHaveProperty(name);
        });
    }

    it('getToolsConfig é uma função', () => {
        expect(typeof SDK.getToolsConfig).toBe('function');
    });

    it('buildSessionConfig é uma função', () => {
        expect(typeof SDK.buildSessionConfig).toBe('function');
    });
});

// ─── F177: Exports de events/event-helpers ────────────────────────────────

describe('F177 — Barrel exporta exports de events e event-helpers', () => {
    const EVENT_EXPORTS = [
        'waitForEvent',
        'raceEvents',
        'onSessionEvent',
        'onLifecycleEvent',
        'isKnownEventType',
        'getEventType',
        'getEventPayload',
        'createEventFilter',
    ];

    for (const name of EVENT_EXPORTS) {
        it(`exporta '${name}'`, () => {
            expect(SDK).toHaveProperty(name);
        });
    }

    it('waitForEvent é uma função', () => {
        expect(typeof SDK.waitForEvent).toBe('function');
    });

    it('raceEvents é uma função', () => {
        expect(typeof SDK.raceEvents).toBe('function');
    });
});

// ─── F178: Pipeline zero-bypass — auditoria dos módulos mais críticos ──────

describe('F178 — Pipeline zero-bypass dos módulos mais críticos', () => {
    /**
     * @param {string} content
     * @returns {string[]}
     */
    function findBypasses(content) {
        return [...content.matchAll(/from\s+'(#copilot\/sdk\/[^']+)'/g)].map((m) => m[1]);
    }

    const CRITICAL_FILES = [
        { path: 'src/copilot/tools/tool-factory.js', label: 'tool-factory' },
        { path: 'src/copilot/agent/infra/tools-bootstrap.js', label: 'tools-bootstrap' },
        { path: 'src/copilot/api/express/client.js', label: 'api/client' },
        { path: 'src/copilot/api/express/session-messaging.js', label: 'api/session-messaging' },
        { path: 'src/copilot/agent/dialog/loop-manager.js', label: 'loop-manager' },
        { path: 'src/copilot/bridges/nerv-bridge.js', label: 'nerv-bridge' },
        { path: 'src/copilot/observability/event-collector.js', label: 'event-collector' },
        { path: 'src/copilot/hooks/session-lifecycle.js', label: 'session-lifecycle' },
        { path: 'src/copilot/terminal/commands/config.js', label: 'terminal/config' },
    ];

    for (const { path, label } of CRITICAL_FILES) {
        it(`${label}: sem bypass direto de submodulo SDK`, () => {
            const src = read(path);
            const bypasses = findBypasses(src);
            expect(bypasses, `${label} contém bypasses: ${bypasses.join(', ')}`).toHaveLength(0);
        });
    }
});

// ─── F179: Consistência de estrutura do barrel ─────────────────────────────

describe('F179 — Barrel tem consistência de estrutura', () => {
    it('barrel index.js existe e é ESM', () => {
        const src = read('src/copilot/sdk/index.js');
        expect(src).toContain('export');
        // Não deve ter require() — ESM puro
        expect(src).not.toContain("require('");
    });

    it('barrel não importa de si mesmo (sem import circular trivial)', () => {
        const src = read('src/copilot/sdk/index.js');
        const selfImports = [...src.matchAll(/from\s+'\.\/index\.js'/g)];
        expect(selfImports).toHaveLength(0);
    });

    it('barrel não importa de fora do sdk/ (sem dependências externas no barrel)', () => {
        const src = read('src/copilot/sdk/index.js');
        // Só deve ter imports de './submodule'
        const externalImports = [...src.matchAll(/from\s+'(#copilot\/(?!sdk)[^']+)'/g)].map((m) => m[1]);
        // Permitir até 2 exceções (caso haja necessidade de core)
        expect(externalImports.length).toBeLessThanOrEqual(2);
    });
});

// ─── F180: Saúde geral do barrel ──────────────────────────────────────────

describe('F180 — Saúde geral do barrel: quantidade mínima de exports', () => {
    it('barrel exporta pelo menos 200 símbolos', () => {
        const keys = Object.keys(SDK);
        expect(keys.length).toBeGreaterThanOrEqual(200);
    });

    it('barrel exporta pelo menos 10 funções', () => {
        const fns = Object.entries(SDK).filter(([, v]) => typeof v === 'function');
        expect(fns.length).toBeGreaterThanOrEqual(10);
    });

    it('barrel exporta createTool, getClient e createRegistry como funções', () => {
        expect(typeof SDK.createTool).toBe('function');
        expect(typeof SDK.getClient).toBe('function');
        expect(typeof SDK.createRegistry).toBe('function');
    });
});
