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
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

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
    /** @type {import('../../../../src/copilot/sdk/feature-flags.js')} */
    let featureFlags;

    beforeAll(async () => {
        featureFlags = await import('#copilot/sdk/feature-flags');
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
        expect(() => featureFlags.setExperimentalFlag(/** @type {any} */ ('unknown_feature'), true)).toThrow(
            RangeError,
        );
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
            Reflect.set(snapshot, 'mcp', false);
        }).toThrow();
    });

    it('EXPERIMENTAL_FEATURES tem exatamente 6 elementos', () => {
        expect(featureFlags.EXPERIMENTAL_FEATURES).toHaveLength(6);
    });
});

// ─── F118-F123: experimental-rpc.js (source checks) ─────────────────────────

describe('F22 — F118-F123: experimental-rpc.js exports', () => {
    it('experimental.js exporta fleetStart (F118)', () => {
        const src = readSource('sdk/rpc/experimental.js');
        expect(src).toContain('export async function fleetStart');
    });

    it('experimental.js exporta agentList, agentGetCurrent, agentSelect, agentDeselect, agentReload (F119)', () => {
        const src = readSource('sdk/rpc/experimental.js');
        expect(src).toContain('export async function agentList');
        expect(src).toContain('export async function agentGetCurrent');
        expect(src).toContain('export async function agentSelect');
        expect(src).toContain('export async function agentDeselect');
        expect(src).toContain('export async function agentReload');
    });

    it('experimental.js NÃO exporta funções fantasmas (agentGetStatus, agentStop, skillsGetStatus, mcpGetStatus)', () => {
        const src = readSource('sdk/rpc/experimental.js');
        expect(src).not.toContain('export async function agentGetStatus');
        expect(src).not.toContain('export async function agentStop');
        expect(src).not.toContain('export async function skillsGetStatus');
        expect(src).not.toContain('export async function mcpGetStatus');
    });

    it('experimental.js exporta skillsList, skillsEnable, skillsDisable, skillsReload (F120)', () => {
        const src = readSource('sdk/rpc/experimental.js');
        expect(src).toContain('export async function skillsList');
        expect(src).toContain('export async function skillsEnable');
        expect(src).toContain('export async function skillsDisable');
        expect(src).toContain('export async function skillsReload');
    });

    it('experimental.js exporta mcpList, mcpEnable, mcpDisable, mcpReload (F121)', () => {
        const src = readSource('sdk/rpc/experimental.js');
        expect(src).toContain('export async function mcpList');
        expect(src).toContain('export async function mcpEnable');
        expect(src).toContain('export async function mcpDisable');
        expect(src).toContain('export async function mcpReload');
    });

    it('experimental.js exporta pluginsList (F122)', () => {
        const src = readSource('sdk/rpc/experimental.js');
        expect(src).toContain('export async function pluginsList');
    });

    it('experimental.js exporta extensionsList, extensionsEnable, extensionsDisable, extensionsReload (F123)', () => {
        const src = readSource('sdk/rpc/experimental.js');
        expect(src).toContain('export async function extensionsList');
        expect(src).toContain('export async function extensionsEnable');
        expect(src).toContain('export async function extensionsDisable');
        expect(src).toContain('export async function extensionsReload');
    });

    it('experimental.js importa isExperimentalEnabled de feature-flags.js', () => {
        const src = readSource('sdk/rpc/experimental.js');
        expect(src).toContain("from '../feature-flags.js'");
        expect(src).toContain('isExperimentalEnabled');
    });
});

// ─── F125: feature flag on/off por subsistema (runtime) ──────────────────────

describe('F22 — F125: feature flag on/off por subsistema', () => {
    /** @type {typeof import('../../../../src/copilot/sdk/feature-flags.js')} */
    let featureFlags;
    /** @type {typeof import('../../../../src/copilot/sdk/rpc/experimental.js')} */
    let expRpc;

    beforeAll(async () => {
        featureFlags = await import('#copilot/sdk/feature-flags');
        expRpc = await import('../../../../src/copilot/sdk/rpc/experimental.js');
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
        expect(result[0]?.id).toBe('mcp1');
    });

    it('sdk/barrel reexporta funções experimentais alinhadas com SDK', () => {
        const src = readSource('sdk/index.js');
        expect(src).toContain('fleetStart');
        expect(src).toContain('agentList');
        expect(src).toContain('agentGetCurrent');
        expect(src).toContain('agentReload');
        expect(src).toContain('skillsList');
        expect(src).toContain('skillsReload');
        expect(src).toContain('mcpList');
        expect(src).toContain('mcpReload');
        expect(src).toContain('pluginsList');
        expect(src).toContain('extensionsList');
        expect(src).toContain('extensionsReload');
        // Removidas
        expect(src).not.toContain('agentGetStatus');
        expect(src).not.toContain('agentStop');
        expect(src).not.toContain('skillsGetStatus');
        expect(src).not.toContain('mcpGetStatus');
    });

    // ─── A3.2: Novos testes runtime para funções adicionadas ─────────────────

    it('agentGetCurrent com flag=true chama session.rpc.agent.getCurrent()', async () => {
        featureFlags.setExperimentalFlag('agents', true);
        const getCurrentMock = vi.fn().mockResolvedValue({ id: 'a1', name: 'Agent 1' });
        const sess = /** @type {any} */ ({ rpc: { agent: { getCurrent: getCurrentMock } } });
        const result = await expRpc.agentGetCurrent(sess);
        expect(getCurrentMock).toHaveBeenCalledOnce();
        expect(result).toEqual({ id: 'a1', name: 'Agent 1' });
    });

    it('agentReload com flag=true chama session.rpc.agent.reload()', async () => {
        featureFlags.setExperimentalFlag('agents', true);
        const reloadMock = vi.fn().mockResolvedValue(undefined);
        const sess = /** @type {any} */ ({ rpc: { agent: { reload: reloadMock } } });
        await expRpc.agentReload(sess);
        expect(reloadMock).toHaveBeenCalledOnce();
    });

    it('skillsReload com flag=true chama session.rpc.skills.reload()', async () => {
        featureFlags.setExperimentalFlag('skills', true);
        const reloadMock = vi.fn().mockResolvedValue(undefined);
        const sess = /** @type {any} */ ({ rpc: { skills: { reload: reloadMock } } });
        await expRpc.skillsReload(sess);
        expect(reloadMock).toHaveBeenCalledOnce();
    });

    it('mcpReload com flag=true chama session.rpc.mcp.reload()', async () => {
        featureFlags.setExperimentalFlag('mcp', true);
        const reloadMock = vi.fn().mockResolvedValue(undefined);
        const sess = /** @type {any} */ ({ rpc: { mcp: { reload: reloadMock } } });
        await expRpc.mcpReload(sess);
        expect(reloadMock).toHaveBeenCalledOnce();
    });

    it('extensionsReload com flag=true chama session.rpc.extensions.reload()', async () => {
        featureFlags.setExperimentalFlag('extensions', true);
        const reloadMock = vi.fn().mockResolvedValue(undefined);
        const sess = /** @type {any} */ ({ rpc: { extensions: { reload: reloadMock } } });
        await expRpc.extensionsReload(sess);
        expect(reloadMock).toHaveBeenCalledOnce();
    });

    it('agentSelect valida agentId não-vazio', async () => {
        featureFlags.setExperimentalFlag('agents', true);
        const sess = /** @type {any} */ ({ rpc: { agent: { select: vi.fn() } } });
        await expect(expRpc.agentSelect(sess, '')).rejects.toThrow(TypeError);
    });

    it('mcpEnable valida serverId não-vazio', async () => {
        featureFlags.setExperimentalFlag('mcp', true);
        const sess = /** @type {any} */ ({ rpc: { mcp: { enable: vi.fn() } } });
        await expect(expRpc.mcpEnable(sess, '')).rejects.toThrow(TypeError);
    });

    it('extensionsDisable valida extensionId não-vazio', async () => {
        featureFlags.setExperimentalFlag('extensions', true);
        const sess = /** @type {any} */ ({ rpc: { extensions: { disable: vi.fn() } } });
        await expect(expRpc.extensionsDisable(sess, '')).rejects.toThrow(TypeError);
    });

    it('assertSession lança TypeError para sessão inválida', async () => {
        featureFlags.setExperimentalFlag('agents', true);
        await expect(expRpc.agentList(/** @type {any} */ (null))).rejects.toThrow(TypeError);
        await expect(expRpc.agentList(/** @type {any} */ ({}))).rejects.toThrow(TypeError);
    });

    it('pluginsList com flag=true chama session.rpc.plugins.list()', async () => {
        featureFlags.setExperimentalFlag('plugins', true);
        const listMock = vi.fn().mockResolvedValue([{ id: 'p1', name: 'P', version: '1.0', enabled: true }]);
        const sess = /** @type {any} */ ({ rpc: { plugins: { list: listMock } } });
        const result = await expRpc.pluginsList(sess);
        expect(listMock).toHaveBeenCalledOnce();
        expect(result[0]?.id).toBe('p1');
    });

    it('extensionsEnable com flag=true chama session.rpc.extensions.enable({ extensionId })', async () => {
        featureFlags.setExperimentalFlag('extensions', true);
        const enableMock = vi.fn().mockResolvedValue(undefined);
        const sess = /** @type {any} */ ({ rpc: { extensions: { enable: enableMock } } });
        await expRpc.extensionsEnable(sess, 'ext-1');
        expect(enableMock).toHaveBeenCalledWith({ extensionId: 'ext-1' });
    });

    it('skillsDisable com flag=true chama session.rpc.skills.disable({ skillId })', async () => {
        featureFlags.setExperimentalFlag('skills', true);
        const disableMock = vi.fn().mockResolvedValue(undefined);
        const sess = /** @type {any} */ ({ rpc: { skills: { disable: disableMock } } });
        await expRpc.skillsDisable(sess, 'skill-1');
        expect(disableMock).toHaveBeenCalledWith({ skillId: 'skill-1' });
    });

    it('agentDeselect com flag=true chama session.rpc.agent.deselect()', async () => {
        featureFlags.setExperimentalFlag('agents', true);
        const deselectMock = vi.fn().mockResolvedValue(undefined);
        const sess = /** @type {any} */ ({ rpc: { agent: { deselect: deselectMock } } });
        await expRpc.agentDeselect(sess);
        expect(deselectMock).toHaveBeenCalledOnce();
    });

    it('mcpDisable com flag=true chama session.rpc.mcp.disable({ serverId })', async () => {
        featureFlags.setExperimentalFlag('mcp', true);
        const disableMock = vi.fn().mockResolvedValue(undefined);
        const sess = /** @type {any} */ ({ rpc: { mcp: { disable: disableMock } } });
        await expRpc.mcpDisable(sess, 'srv-1');
        expect(disableMock).toHaveBeenCalledWith({ serverId: 'srv-1' });
    });
});
