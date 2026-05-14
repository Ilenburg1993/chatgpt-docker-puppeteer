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

import { SdkOperationError } from '#copilot/sdk/errors';

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
        expect(Reflect.isExtensible(snapshot)).toBe(false);
        expect(Reflect.set(snapshot, 'mcp', false)).toBe(false);
        expect(snapshot.mcp).toBe(true);
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

    it('experimental.js reexporta agentList, agentGetCurrent, agentSelect, agentDeselect, agentReload (F119)', () => {
        const src = readSource('sdk/rpc/experimental.js');
        expect(src).toContain('export { agentDeselect, agentGetCurrent, agentList, agentReload, agentSelect }');
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
        await expect(expRpc.agentList(mockSession)).rejects.toThrow('agent.list');
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
        const startMock = vi.fn().mockResolvedValue({ started: true });
        const sess = /** @type {any} */ ({ rpc: { fleet: { start: startMock } } });
        const result = await expRpc.fleetStart(sess, { prompt: 'investigue' });
        expect(startMock).toHaveBeenCalledWith({ prompt: 'investigue' });
        expect(result).toEqual({ started: true });
    });

    it('mcpList com flag=true chama session.rpc.mcp.list()', async () => {
        featureFlags.setExperimentalFlag('mcp', true);
        const listMock = vi.fn().mockResolvedValue([{ name: 'Server A', status: 'connected' }]);
        const sess = /** @type {any} */ ({ rpc: { mcp: { list: listMock } } });
        const result = await expRpc.mcpList(sess);
        expect(listMock).toHaveBeenCalledOnce();
        expect(result[0]?.name).toBe('Server A');
    });

    it('sdk/experimental-rpc surface exporta funções experimentais alinhadas com SDK', () => {
        const src = readSource('sdk/index.js');
        expect(src).not.toContain('fleetStart');
        const expSrc = readSource('sdk/rpc/experimental.js');
        expect(expSrc).toContain('fleetStart');
        expect(expSrc).toContain('skillsList');
        expect(expSrc).toContain('mcpList');
        expect(expSrc).toContain('pluginsList');
        expect(expSrc).toContain('extensionsList');
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

    it('agentSelect valida name não-vazio', async () => {
        featureFlags.setExperimentalFlag('agents', true);
        const sess = /** @type {any} */ ({ rpc: { agent: { select: vi.fn() } } });
        await expect(expRpc.agentSelect(sess, '')).rejects.toThrow(TypeError);
    });

    it('mcpEnable valida serverName não-vazio', async () => {
        featureFlags.setExperimentalFlag('mcp', true);
        const sess = /** @type {any} */ ({ rpc: { mcp: { enable: vi.fn() } } });
        await expect(expRpc.mcpEnable(sess, '')).rejects.toThrow(TypeError);
    });

    it('extensionsDisable valida id não-vazio', async () => {
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
        expect(/** @type {{ id?: string }} */ (result[0])?.id).toBe('p1');
    });

    it('agentSelect com flag=true chama session.rpc.agent.select({ name })', async () => {
        featureFlags.setExperimentalFlag('agents', true);
        const selectMock = vi.fn().mockResolvedValue(undefined);
        const sess = /** @type {any} */ ({ rpc: { agent: { select: selectMock } } });
        await expRpc.agentSelect(sess, 'reviewer');
        expect(selectMock).toHaveBeenCalledWith({ name: 'reviewer' });
    });

    it('extensionsEnable com flag=true chama session.rpc.extensions.enable({ id })', async () => {
        featureFlags.setExperimentalFlag('extensions', true);
        const enableMock = vi.fn().mockResolvedValue(undefined);
        const sess = /** @type {any} */ ({ rpc: { extensions: { enable: enableMock } } });
        await expRpc.extensionsEnable(sess, 'ext-1');
        expect(enableMock).toHaveBeenCalledWith({ id: 'ext-1' });
    });

    it('skillsDisable com flag=true chama session.rpc.skills.disable({ name })', async () => {
        featureFlags.setExperimentalFlag('skills', true);
        const disableMock = vi.fn().mockResolvedValue(undefined);
        const sess = /** @type {any} */ ({ rpc: { skills: { disable: disableMock } } });
        await expRpc.skillsDisable(sess, 'skill-1');
        expect(disableMock).toHaveBeenCalledWith({ name: 'skill-1' });
    });

    it('skillsEnable com flag=true chama session.rpc.skills.enable({ name })', async () => {
        featureFlags.setExperimentalFlag('skills', true);
        const enableMock = vi.fn().mockResolvedValue(undefined);
        const sess = /** @type {any} */ ({ rpc: { skills: { enable: enableMock } } });
        await expRpc.skillsEnable(sess, 'skill-1');
        expect(enableMock).toHaveBeenCalledWith({ name: 'skill-1' });
    });

    it('agentDeselect com flag=true chama session.rpc.agent.deselect()', async () => {
        featureFlags.setExperimentalFlag('agents', true);
        const deselectMock = vi.fn().mockResolvedValue(undefined);
        const sess = /** @type {any} */ ({ rpc: { agent: { deselect: deselectMock } } });
        await expRpc.agentDeselect(sess);
        expect(deselectMock).toHaveBeenCalledOnce();
    });

    it('mcpDisable com flag=true chama session.rpc.mcp.disable({ serverName })', async () => {
        featureFlags.setExperimentalFlag('mcp', true);
        const disableMock = vi.fn().mockResolvedValue(undefined);
        const sess = /** @type {any} */ ({ rpc: { mcp: { disable: disableMock } } });
        await expRpc.mcpDisable(sess, 'srv-1');
        expect(disableMock).toHaveBeenCalledWith({ serverName: 'srv-1' });
    });

    it('mcpEnable com flag=true chama session.rpc.mcp.enable({ serverName })', async () => {
        featureFlags.setExperimentalFlag('mcp', true);
        const enableMock = vi.fn().mockResolvedValue(undefined);
        const sess = /** @type {any} */ ({ rpc: { mcp: { enable: enableMock } } });
        await expRpc.mcpEnable(sess, 'srv-1');
        expect(enableMock).toHaveBeenCalledWith({ serverName: 'srv-1' });
    });

    it('agentList converte falha de auth em SdkOperationError', async () => {
        featureFlags.setExperimentalFlag('agents', true);
        const listMock = vi.fn().mockRejectedValue(Object.assign(new Error('unauthorized'), { status: 401 }));
        const sess = /** @type {any} */ ({ sessionId: 'sess-exp-1', rpc: { agent: { list: listMock } } });
        await expect(expRpc.agentList(sess)).rejects.toBeInstanceOf(SdkOperationError);
    });
});
