// @ts-check
/**
 * tests/unit/copilot/sdk/test_sdk_experimental_f22.spec.js
 *
 * Faixa 22 — Experimental RPC Features com feature flags.
 *
 * F118: fleet.start() com feature flag F119: agent.* gated F120: skills.* gated F121: mcp.* gated F122: plugins.list()
 * gated F123: extensions.* gated F124: feature-flags.js — config e API F125: feature flag on/off para cada subsistema
 */

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, it, before, afterEach } from 'node:test';

const require = createRequire(import.meta.url);
const { readFileSync } = require('node:fs');

const ROOT = join(import.meta.url.replace('file://', ''), '../../../../..');
const SRC_COPILOT = join(ROOT, 'src/copilot');

/**
 * @param {string} relPath
 * @returns {string}
 */
function readSource(relPath) {
    return readFileSync(join(SRC_COPILOT, relPath), 'utf8');
}

// ─── F124: feature-flags.js ───────────────────────────────────────────────────

describe('F22 — F124: feature-flags.js', () => {
    it('feature-flags.js existe', () => {
        const { existsSync } = require('node:fs');
        expect(existsSync(join(SRC_COPILOT, 'sdk/feature-flags.js'))).toBe(true);
    });

    it('exporta EXPERIMENTAL_FEATURES com 6 features', () => {
        const src = readSource('sdk/feature-flags.js');
        expect(src).toContain('export const EXPERIMENTAL_FEATURES');
        // fleet, agents, skills, mcp, plugins, extensions
        expect(src).toContain("'fleet'");
        expect(src).toContain("'agents'");
        expect(src).toContain("'skills'");
        expect(src).toContain("'mcp'");
        expect(src).toContain("'plugins'");
        expect(src).toContain("'extensions'");
    });

    it('exporta isExperimentalEnabled', () => {
        const src = readSource('sdk/feature-flags.js');
        expect(src).toContain('export function isExperimentalEnabled');
    });

    it('exporta setExperimentalFlag', () => {
        const src = readSource('sdk/feature-flags.js');
        expect(src).toContain('export function setExperimentalFlag');
    });

    it('exporta resetExperimentalFlags', () => {
        const src = readSource('sdk/feature-flags.js');
        expect(src).toContain('export function resetExperimentalFlags');
    });

    it('exporta getExperimentalFlags', () => {
        const src = readSource('sdk/feature-flags.js');
        expect(src).toContain('export function getExperimentalFlags');
    });

    it('lê da variável de ambiente COPILOT_EXPERIMENTAL_*', () => {
        const src = readSource('sdk/feature-flags.js');
        expect(src).toContain('COPILOT_EXPERIMENTAL_');
        expect(src).toContain('process.env');
    });
});

// ─── F124 runtime: feature-flags API ──────────────────────────────────────────

describe('F22 — F124 runtime: feature-flags API', () => {
    /** @type {import('../../../../../../src/copilot/sdk/feature-flags.js')} */
    let featureFlags;

    before(async () => {
        featureFlags = await import('#copilot/sdk/feature-flags.js');
    });

    afterEach(() => {
        featureFlags.resetExperimentalFlags();
    });

    it('todos os flags iniciam false', () => {
        featureFlags.resetExperimentalFlags();
        const flags = featureFlags.getExperimentalFlags();
        for (const name of featureFlags.EXPERIMENTAL_FEATURES) {
            expect(flags[name]).toBe(false);
        }
    });

    it('setExperimentalFlag(fleet, true) habilita fleet', () => {
        featureFlags.setExperimentalFlag('fleet', true);
        expect(featureFlags.isExperimentalEnabled('fleet')).toBe(true);
    });

    it('setExperimentalFlag lança RangeError para feature desconhecida', () => {
        // @ts-expect-error -- valor inválido intencional para testar validação
        expect(() => featureFlags.setExperimentalFlag('unknown_feature', true)).toThrow(RangeError);
    });

    it('resetExperimentalFlags desabilita tudo', () => {
        featureFlags.setExperimentalFlag('agents', true);
        featureFlags.setExperimentalFlag('skills', true);
        featureFlags.resetExperimentalFlags();
        expect(featureFlags.isExperimentalEnabled('agents')).toBe(false);
        expect(featureFlags.isExperimentalEnabled('skills')).toBe(false);
    });

    it('getExperimentalFlags retorna snapshot imutável', () => {
        featureFlags.setExperimentalFlag('mcp', true);
        const snapshot = featureFlags.getExperimentalFlags();
        expect(snapshot.mcp).toBe(true);
        // Snapshot deve ser congelado (não deve permitir mutação)
        expect(() => {
            // @ts-expect-error -- valor inválido intencional para testar validação
            snapshot.mcp = false;
        }).toThrow();
    });

    it('EXPERIMENTAL_FEATURES tem exatamente 6 elementos', () => {
        expect(featureFlags.EXPERIMENTAL_FEATURES).toHaveLength(6);
    });
});

// ─── F118-F123: experimental-rpc.js (source checks) ─────────────────────────

describe('F22 — F118-F123: experimental-rpc.js exports', () => {
    it('experimental-rpc.js exporta fleetStart (F118)', () => {
        const src = readSource('sdk/experimental-rpc.js');
        expect(src).toContain('export async function fleetStart');
    });

    it('experimental-rpc.js exporta agentList, agentSelect, agentDeselect, agentGetStatus, agentStop (F119)', () => {
        const src = readSource('sdk/experimental-rpc.js');
        expect(src).toContain('export async function agentList');
        expect(src).toContain('export async function agentSelect');
        expect(src).toContain('export async function agentDeselect');
        expect(src).toContain('export async function agentGetStatus');
        expect(src).toContain('export async function agentStop');
    });

    it('experimental-rpc.js exporta skillsList, skillsEnable, skillsDisable, skillsGetStatus (F120)', () => {
        const src = readSource('sdk/experimental-rpc.js');
        expect(src).toContain('export async function skillsList');
        expect(src).toContain('export async function skillsEnable');
        expect(src).toContain('export async function skillsDisable');
        expect(src).toContain('export async function skillsGetStatus');
    });

    it('experimental-rpc.js exporta mcpList, mcpEnable, mcpDisable, mcpGetStatus (F121)', () => {
        const src = readSource('sdk/experimental-rpc.js');
        expect(src).toContain('export async function mcpList');
        expect(src).toContain('export async function mcpEnable');
        expect(src).toContain('export async function mcpDisable');
        expect(src).toContain('export async function mcpGetStatus');
    });

    it('experimental-rpc.js exporta pluginsList (F122)', () => {
        const src = readSource('sdk/experimental-rpc.js');
        expect(src).toContain('export async function pluginsList');
    });

    it('experimental-rpc.js exporta extensionsList, extensionsEnable, extensionsDisable (F123)', () => {
        const src = readSource('sdk/experimental-rpc.js');
        expect(src).toContain('export async function extensionsList');
        expect(src).toContain('export async function extensionsEnable');
        expect(src).toContain('export async function extensionsDisable');
    });

    it('experimental-rpc.js importa isExperimentalEnabled de feature-flags.js', () => {
        const src = readSource('sdk/experimental-rpc.js');
        expect(src).toContain("from './feature-flags.js'");
        expect(src).toContain('isExperimentalEnabled');
    });
});

// ─── F125: feature flag on/off por subsistema (runtime) ──────────────────────

describe('F22 — F125: feature flag on/off por subsistema', () => {
    /** @type {typeof import('../../../../../../src/copilot/sdk/feature-flags.js')} */
    let featureFlags;
    /** @type {typeof import('../../../../../../src/copilot/sdk/experimental-rpc.js')} */
    let expRpc;

    before(async () => {
        featureFlags = await import('#copilot/sdk/feature-flags.js');
        expRpc = await import('#copilot/sdk/experimental-rpc.js');
    });

    afterEach(() => {
        featureFlags.resetExperimentalFlags();
    });

    const mockSession = /** @type {any} */ ({ rpc: {} });

    it('fleetStart lança Error quando fleet=false', async () => {
        featureFlags.resetExperimentalFlags();
        await expect(expRpc.fleetStart(mockSession)).rejects.toThrow("'fleet'");
    });

    it('agentList lança Error quando agents=false', async () => {
        featureFlags.resetExperimentalFlags();
        await expect(expRpc.agentList(mockSession)).rejects.toThrow("'agents'");
    });

    it('skillsList lança Error quando skills=false', async () => {
        featureFlags.resetExperimentalFlags();
        await expect(expRpc.skillsList(mockSession)).rejects.toThrow("'skills'");
    });

    it('mcpList lança Error quando mcp=false', async () => {
        featureFlags.resetExperimentalFlags();
        await expect(expRpc.mcpList(mockSession)).rejects.toThrow("'mcp'");
    });

    it('pluginsList lança Error quando plugins=false', async () => {
        featureFlags.resetExperimentalFlags();
        await expect(expRpc.pluginsList(mockSession)).rejects.toThrow("'plugins'");
    });

    it('extensionsList lança Error quando extensions=false', async () => {
        featureFlags.resetExperimentalFlags();
        await expect(expRpc.extensionsList(mockSession)).rejects.toThrow("'extensions'");
    });

    it('agentList com flag=true chama session.rpc.agent.list()', async () => {
        featureFlags.setExperimentalFlag('agents', true);
        const listMock = vi.fn().mockResolvedValue([]);
        const sess = /** @type {any} */ ({ rpc: { agent: { list: listMock } } });
        const result = await expRpc.agentList(sess);
        expect(listMock).toHaveBeenCalledOnce();
        expect(result).toEqual([]);
    });

    it('fleetStart com flag=true chama session.rpc.fleet.start()', async () => {
        featureFlags.setExperimentalFlag('fleet', true);
        const startMock = vi.fn().mockResolvedValue({ fleetId: 'f1', status: 'starting' });
        const sess = /** @type {any} */ ({ rpc: { fleet: { start: startMock } } });
        const result = await expRpc.fleetStart(sess, { maxAgents: 3 });
        expect(startMock).toHaveBeenCalledWith({ maxAgents: 3 });
        expect(result).toEqual({ fleetId: 'f1', status: 'starting' });
    });

    it('mcpList com flag=true chama session.rpc.mcp.list()', async () => {
        featureFlags.setExperimentalFlag('mcp', true);
        const listMock = vi.fn().mockResolvedValue([{ id: 'mcp1', name: 'Server A', enabled: true, status: 'ok' }]);
        const sess = /** @type {any} */ ({ rpc: { mcp: { list: listMock } } });
        const result = await expRpc.mcpList(sess);
        expect(listMock).toHaveBeenCalledOnce();
        expect(result[0].id).toBe('mcp1');
    });

    it('sdk/barrel reexporta fleetStart, agentList, skillsList, mcpList, pluginsList, extensionsList', () => {
        const src = readSource('sdk/index.js');
        expect(src).toContain('fleetStart');
        expect(src).toContain('agentList');
        expect(src).toContain('skillsList');
        expect(src).toContain('mcpList');
        expect(src).toContain('pluginsList');
        expect(src).toContain('extensionsList');
    });
});
