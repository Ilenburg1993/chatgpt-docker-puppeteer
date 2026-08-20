// @ts-check
/**
 * tests/unit/copilot/sdk/test_sdk_experimental_f22.spec.js
 *
 * Faixa 22 — Experimental RPC Features com feature flags.
 *
 * F118: fleet.start() com feature flag F119: agent.* permanece em rpc estável (não experimental) F120: skills.* gated
 * F121: mcp.* gated F122: plugins.list() gated F123: extensions.* gated F124: feature-flags.js — config e API F125:
 * feature flag on/off por subsistema experimental
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

    it('exporta EXPERIMENTAL_FEATURES com 8 features', () => {
        const src = readSource('sdk/feature-flags.js');
        expect(src).toContain('export const EXPERIMENTAL_FEATURES');
        // fleet, skills, mcp, plugins, extensions, sessions, history, usage
        expect(src).toContain("'fleet'");
        expect(src).toContain("'skills'");
        expect(src).toContain("'mcp'");
        expect(src).toContain("'plugins'");
        expect(src).toContain("'extensions'");
        expect(src).toContain("'sessions'");
        expect(src).toContain("'history'");
        expect(src).toContain("'usage'");
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
    /** @type {typeof import('../../../../src/copilot/sdk/feature-flags.js')} */
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
        featureFlags.setExperimentalFlag('fleet', true);
        featureFlags.setExperimentalFlag('skills', true);
        featureFlags.resetExperimentalFlags();
        expect(featureFlags.isExperimentalEnabled('fleet')).toBe(false);
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

    it('EXPERIMENTAL_FEATURES tem exatamente 8 elementos', () => {
        expect(featureFlags.EXPERIMENTAL_FEATURES).toHaveLength(8);
    });
});

// ─── F118-F123: rpc/experimental.js (source checks) ─────────────────────────

describe('F22 — F118-F123: rpc/experimental.js exports', () => {
    it('experimental.js exporta fleetStart (F118)', () => {
        const src = readSource('sdk/rpc/experimental.js');
        expect(src).toContain('export async function fleetStart');
    });

    it('experimental.js NÃO exporta agent.* (F119: agent é surface estável em #copilot/sdk/rpc)', () => {
        const src = readSource('sdk/rpc/experimental.js');
        expect(src).not.toContain('agentList');
        expect(src).not.toContain('agentGetCurrent');
        expect(src).not.toContain('agentSelect');
        expect(src).not.toContain('agentDeselect');
        expect(src).not.toContain('agentReload');
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

/**
 * Invoca a surface pública com uma fixture deliberadamente parcial. O limite reflexivo mantém o teste focado no
 * contrato runtime sem fingir que a fixture implementa uma CopilotSession completa.
 *
 * @template R
 * @param {(...args: never[]) => R} operation
 * @param {unknown} session
 * @param {...unknown} args
 * @returns {R}
 */
function invokeExperimental(operation, session, ...args) {
    return Reflect.apply(operation, undefined, [session, ...args]);
}

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

    const mockSession = { sessionId: 'experimental-test-session', rpc: {} };

    it('fleetStart lança Error quando fleet=false', async () => {
        featureFlags.resetExperimentalFlags();
        await expect(invokeExperimental(expRpc.fleetStart, mockSession)).rejects.toThrow("'fleet'");
    });

    it('skillsList lança Error quando skills=false', async () => {
        featureFlags.resetExperimentalFlags();
        await expect(invokeExperimental(expRpc.skillsList, mockSession)).rejects.toThrow("'skills'");
    });

    it('mcpList lança Error quando mcp=false', async () => {
        featureFlags.resetExperimentalFlags();
        await expect(invokeExperimental(expRpc.mcpList, mockSession)).rejects.toThrow("'mcp'");
    });

    it('pluginsList lança Error quando plugins=false', async () => {
        featureFlags.resetExperimentalFlags();
        await expect(invokeExperimental(expRpc.pluginsList, mockSession)).rejects.toThrow("'plugins'");
    });

    it('extensionsList lança Error quando extensions=false', async () => {
        featureFlags.resetExperimentalFlags();
        await expect(invokeExperimental(expRpc.extensionsList, mockSession)).rejects.toThrow("'extensions'");
    });

    it('fleetStart com flag=true chama session.rpc.fleet.start()', async () => {
        featureFlags.setExperimentalFlag('fleet', true);
        const startMock = vi.fn().mockResolvedValue({ started: true });
        const sess = { sessionId: 'fleet-test', rpc: { fleet: { start: startMock } } };
        const result = await invokeExperimental(expRpc.fleetStart, sess, { prompt: 'investigue' });
        expect(startMock).toHaveBeenCalledWith({ prompt: 'investigue' });
        expect(result).toEqual({ started: true });
    });

    it('mcpList com flag=true chama session.rpc.mcp.list()', async () => {
        featureFlags.setExperimentalFlag('mcp', true);
        const listMock = vi.fn().mockResolvedValue([{ name: 'Server A', status: 'connected' }]);
        const sess = { sessionId: 'mcp-list-test', rpc: { mcp: { list: listMock } } };
        const result = await invokeExperimental(expRpc.mcpList, sess);
        expect(listMock).toHaveBeenCalledOnce();
        expect(result[0]?.name).toBe('Server A');
    });

    it('sdk/rpc/experimental surface exporta funções experimentais alinhadas com SDK', () => {
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

    it('skillsReload com flag=true chama session.rpc.skills.reload()', async () => {
        featureFlags.setExperimentalFlag('skills', true);
        const reloadMock = vi.fn().mockResolvedValue(undefined);
        const sess = { sessionId: 'skills-reload-test', rpc: { skills: { reload: reloadMock } } };
        await invokeExperimental(expRpc.skillsReload, sess);
        expect(reloadMock).toHaveBeenCalledOnce();
    });

    it('mcpReload com flag=true chama session.rpc.mcp.reload()', async () => {
        featureFlags.setExperimentalFlag('mcp', true);
        const reloadMock = vi.fn().mockResolvedValue(undefined);
        const sess = { sessionId: 'mcp-reload-test', rpc: { mcp: { reload: reloadMock } } };
        await invokeExperimental(expRpc.mcpReload, sess);
        expect(reloadMock).toHaveBeenCalledOnce();
    });

    it('extensionsReload com flag=true chama session.rpc.extensions.reload()', async () => {
        featureFlags.setExperimentalFlag('extensions', true);
        const reloadMock = vi.fn().mockResolvedValue(undefined);
        const sess = { sessionId: 'extensions-reload-test', rpc: { extensions: { reload: reloadMock } } };
        await invokeExperimental(expRpc.extensionsReload, sess);
        expect(reloadMock).toHaveBeenCalledOnce();
    });

    it('mcpEnable valida serverName não-vazio', async () => {
        featureFlags.setExperimentalFlag('mcp', true);
        const sess = { sessionId: 'mcp-enable-validation', rpc: { mcp: { enable: vi.fn() } } };
        await expect(invokeExperimental(expRpc.mcpEnable, sess, '')).rejects.toThrow(TypeError);
    });

    it('extensionsDisable valida id não-vazio', async () => {
        featureFlags.setExperimentalFlag('extensions', true);
        const sess = { sessionId: 'extensions-disable-validation', rpc: { extensions: { disable: vi.fn() } } };
        await expect(invokeExperimental(expRpc.extensionsDisable, sess, '')).rejects.toThrow(TypeError);
    });

    it('assertSession lança TypeError para sessão inválida', async () => {
        featureFlags.setExperimentalFlag('skills', true);
        await expect(invokeExperimental(expRpc.skillsList, null)).rejects.toThrow(TypeError);
        await expect(invokeExperimental(expRpc.skillsList, {})).rejects.toThrow(TypeError);
    });

    it('pluginsList com flag=true chama session.rpc.plugins.list()', async () => {
        featureFlags.setExperimentalFlag('plugins', true);
        const listMock = vi.fn().mockResolvedValue([{ id: 'p1', name: 'P', version: '1.0', enabled: true }]);
        const sess = { sessionId: 'plugins-list-test', rpc: { plugins: { list: listMock } } };
        const result = await invokeExperimental(expRpc.pluginsList, sess);
        expect(listMock).toHaveBeenCalledOnce();
        expect(/** @type {{ id?: string }} */ (result[0])?.id).toBe('p1');
    });

    it('extensionsEnable com flag=true chama session.rpc.extensions.enable({ id })', async () => {
        featureFlags.setExperimentalFlag('extensions', true);
        const enableMock = vi.fn().mockResolvedValue(undefined);
        const sess = { sessionId: 'extensions-enable-test', rpc: { extensions: { enable: enableMock } } };
        await invokeExperimental(expRpc.extensionsEnable, sess, 'ext-1');
        expect(enableMock).toHaveBeenCalledWith({ id: 'ext-1' });
    });

    it('skillsDisable com flag=true chama session.rpc.skills.disable({ name })', async () => {
        featureFlags.setExperimentalFlag('skills', true);
        const disableMock = vi.fn().mockResolvedValue(undefined);
        const sess = { sessionId: 'skills-disable-test', rpc: { skills: { disable: disableMock } } };
        await invokeExperimental(expRpc.skillsDisable, sess, 'skill-1');
        expect(disableMock).toHaveBeenCalledWith({ name: 'skill-1' });
    });

    it('skillsEnable com flag=true chama session.rpc.skills.enable({ name })', async () => {
        featureFlags.setExperimentalFlag('skills', true);
        const enableMock = vi.fn().mockResolvedValue(undefined);
        const sess = { sessionId: 'skills-enable-test', rpc: { skills: { enable: enableMock } } };
        await invokeExperimental(expRpc.skillsEnable, sess, 'skill-1');
        expect(enableMock).toHaveBeenCalledWith({ name: 'skill-1' });
    });

    it('mcpDisable com flag=true chama session.rpc.mcp.disable({ serverName })', async () => {
        featureFlags.setExperimentalFlag('mcp', true);
        const disableMock = vi.fn().mockResolvedValue(undefined);
        const sess = { sessionId: 'mcp-disable-test', rpc: { mcp: { disable: disableMock } } };
        await invokeExperimental(expRpc.mcpDisable, sess, 'srv-1');
        expect(disableMock).toHaveBeenCalledWith({ serverName: 'srv-1' });
    });

    it('mcpEnable com flag=true chama session.rpc.mcp.enable({ serverName })', async () => {
        featureFlags.setExperimentalFlag('mcp', true);
        const enableMock = vi.fn().mockResolvedValue(undefined);
        const sess = { sessionId: 'mcp-enable-test', rpc: { mcp: { enable: enableMock } } };
        await invokeExperimental(expRpc.mcpEnable, sess, 'srv-1');
        expect(enableMock).toHaveBeenCalledWith({ serverName: 'srv-1' });
    });

    it('skillsList converte falha de auth em SdkOperationError', async () => {
        featureFlags.setExperimentalFlag('skills', true);
        const listMock = vi.fn().mockRejectedValue(Object.assign(new Error('unauthorized'), { status: 401 }));
        const sess = { sessionId: 'sess-exp-1', rpc: { skills: { list: listMock } } };
        await expect(invokeExperimental(expRpc.skillsList, sess)).rejects.toBeInstanceOf(SdkOperationError);
    });
});
