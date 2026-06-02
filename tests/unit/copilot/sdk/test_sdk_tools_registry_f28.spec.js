// @ts-check
/**
 * @file Faixa 28 — Tools Registry Deprecation
 *
 *   Verifica que:
 *
 *   - F133: tools-bootstrap.js importa registerTools via barrel (#copilot/sdk), não diretamente
 *   - F134: todos os exports de tools-registry.js estão disponíveis via barrel
 *   - F135: contratos de createRegistry / registerTool / registerTools
 *   - F136: funções de consulta (getToolsByCategory, getToolsByTag, getReadOnlyTools, listToolNames)
 *   - F137: funções de composição (mergeRegistries, filterByNames, excludeByNames)
 *   - F138: zero-bypass audit — nenhum arquivo fora de sdk/ importa #copilot/sdk/tools
 */

import {
    createRegistry,
    excludeByNames,
    filterByNames,
    getAllTools,
    getReadOnlyTools,
    getToolByName,
    getToolCount,
    getToolsByCategory,
    getToolsByTag,
    hasToolByName,
    inspectRegistry,
    listToolNames,
    mergeRegistries,
    registerTool,
    registerTools,
} from '#copilot/sdk';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

/** @typedef {import('@github/copilot-sdk').Tool} SdkTool */

// ─── helpers ───────────────────────────────────────────────────────────────

/**
 * Cria um Tool stub mínimo.
 *
 * @param {string} name
 * @returns {SdkTool}
 */
function makeTool(name) {
    return {
        name,
        description: `tool ${name}`,
        handler: async () => `result:${name}`,
    };
}

const ROOT = '/workspaces/chatgpt-docker-puppeteer';

/**
 * @param {string} dir
 * @returns {string[]}
 */
function listJsFiles(dir) {
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return listJsFiles(path);
        if (entry.isFile() || statSync(path).isFile()) return path.endsWith('.js') ? [path] : [];
        return [];
    });
}

/**
 * @param {string} dir
 * @param {string} needle
 * @returns {string[]}
 */
function findFilesContaining(dir, needle) {
    return listJsFiles(dir).filter((file) => readFileSync(file, 'utf8').includes(needle));
}

// ─── F133: tools-bootstrap usa surface canônica ────────────────────────────

describe('F133 — tools-bootstrap não importa sdk/tools-registry diretamente', () => {
    it('tools-bootstrap.js não contém import de alias folha removido', () => {
        const src = readFileSync(join(ROOT, 'src/copilot/tools/bootstrap.js'), 'utf8');
        const removedAlias = "from '#copilot/sdk/" + "tools-registry'";
        expect(src).not.toContain(removedAlias);
    });

    it('tools-bootstrap.js contém import de registerTools vindo de #copilot/sdk/tools', () => {
        const src = readFileSync(join(ROOT, 'src/copilot/tools/bootstrap.js'), 'utf8');
        expect(src).toContain("registerTools } from '#copilot/sdk/tools'");
    });

    it('tools-bootstrap aplica skipPermission SDK em approve_all/audit_only sem importar config', () => {
        const src = readFileSync(join(ROOT, 'src/copilot/tools/bootstrap.js'), 'utf8');
        expect(src).toContain('const sdkSessionTools = applySessionToolPermissionPolicy(allTools, permissionMode)');
        expect(src).toContain("permissionMode === 'approve_all' || permissionMode === 'audit_only'");
        expect(src).toContain("process.env['AGENT_PERMISSION_MODE']");
        expect(src).not.toContain("from '#copilot/config'");
    });
});

// ─── F134: barrel exporta todas as funções de tools-registry ───────────────

describe('F134 — barrel exporta funções de tools-registry', () => {
    it('exporta createRegistry', () => expect(typeof createRegistry).toBe('function'));
    it('exporta registerTool', () => expect(typeof registerTool).toBe('function'));
    it('exporta registerTools', () => expect(typeof registerTools).toBe('function'));
    it('exporta getAllTools', () => expect(typeof getAllTools).toBe('function'));
    it('exporta getToolsByCategory', () => expect(typeof getToolsByCategory).toBe('function'));
    it('exporta getToolsByTag', () => expect(typeof getToolsByTag).toBe('function'));
    it('exporta getReadOnlyTools', () => expect(typeof getReadOnlyTools).toBe('function'));
    it('exporta getToolByName', () => expect(typeof getToolByName).toBe('function'));
    it('exporta getToolCount', () => expect(typeof getToolCount).toBe('function'));
    it('exporta listToolNames', () => expect(typeof listToolNames).toBe('function'));
    it('exporta hasToolByName', () => expect(typeof hasToolByName).toBe('function'));
    it('exporta mergeRegistries', () => expect(typeof mergeRegistries).toBe('function'));
    it('exporta filterByNames', () => expect(typeof filterByNames).toBe('function'));
    it('exporta excludeByNames', () => expect(typeof excludeByNames).toBe('function'));
    it('exporta inspectRegistry', () => expect(typeof inspectRegistry).toBe('function'));
});

// ─── F135: contratos de createRegistry / registerTool / registerTools ───────

describe('F135 — contratos de registro', () => {
    /** @type {ReturnType<typeof createRegistry>} */
    let reg;
    beforeEach(() => {
        reg = createRegistry();
    });

    it('createRegistry retorna objeto com entries Map vazio', () => {
        expect(reg).toMatchObject({ entries: expect.any(Map) });
        expect(reg.entries.size).toBe(0);
    });

    it('registerTool adiciona entrada ao registry', () => {
        const t = makeTool('myTool');
        registerTool(reg, t, { category: 'code' });
        expect(reg.entries.has('myTool')).toBe(true);
    });

    it('registerTool preserva category e tags', () => {
        const t = makeTool('t1');
        registerTool(reg, t, { category: 'git', tags: ['vcs', 'diff'], readOnly: true });
        const entry = reg.entries.get('t1');
        expect(entry?.category).toBe('git');
        expect(entry?.tags).toContain('vcs');
        expect(entry?.readOnly).toBe(true);
    });

    it('registerTool sintetiza instructions quando ausentes', () => {
        const t = makeTool('t1');
        registerTool(reg, t, { category: 'git', tags: ['vcs', 'diff'], readOnly: true });
        const instructions = String(/** @type {any} */ (reg.entries.get('t1')?.tool)?.instructions ?? '');
        expect(instructions).toContain('Use t1 for:');
        expect(instructions).toContain('Category: git; tags: vcs, diff.');
        expect(instructions).toContain('Read-only:');
    });

    it('registerTool preserva instructions explícitas', () => {
        const t = /** @type {any} */ ({ ...makeTool('with_instructions'), instructions: 'Custom tool guidance.' });
        registerTool(reg, t, { category: 'custom', tags: ['runtime'] });
        expect(/** @type {any} */ (reg.entries.get('with_instructions')?.tool)?.instructions).toBe(
            'Custom tool guidance.',
        );
    });

    it('registerTool com tool inválido lança erro', () => {
        expect(() => registerTool(reg, /** @type {any} */ (null))).toThrow();
    });

    it('registerTool com tool.name vazio lança erro', () => {
        expect(() => registerTool(reg, /** @type {any} */ ({ name: '', description: 'x' }))).toThrow();
    });

    it('registerTools registra múltiplas tools de uma vez', () => {
        /** @type {SdkTool[]} */
        const tools = [makeTool('a'), makeTool('b'), makeTool('c')];
        registerTools(reg, tools, { category: 'task' });
        expect(reg.entries.size).toBe(3);
        expect(reg.entries.has('a')).toBe(true);
        expect(reg.entries.has('c')).toBe(true);
    });
});

// ─── F136: funções de consulta ──────────────────────────────────────────────

describe('F136 — funções de consulta', () => {
    /** @type {ReturnType<typeof createRegistry>} */
    let reg;
    beforeEach(() => {
        reg = createRegistry();
        registerTool(reg, makeTool('codeA'), { category: 'code', tags: ['lint'], readOnly: true });
        registerTool(reg, makeTool('codeB'), { category: 'code', tags: ['test'] });
        registerTool(reg, makeTool('gitC'), { category: 'git', tags: ['diff', 'lint'] });
        registerTool(reg, makeTool('taskD'), { category: 'task' });
    });

    it('getAllTools retorna todas as tools', () => {
        expect(getAllTools(reg)).toHaveLength(4);
    });

    it('getToolsByCategory filtra por categoria', () => {
        const codeTools = getToolsByCategory(reg, 'code');
        expect(codeTools).toHaveLength(2);
        expect(codeTools.every((t) => t.name.startsWith('code'))).toBe(true);
    });

    it('getToolsByTag retorna tools com a tag especificada', () => {
        const lintTools = getToolsByTag(reg, 'lint');
        expect(lintTools).toHaveLength(2);
    });

    it('getReadOnlyTools retorna apenas ferramentas somente-leitura', () => {
        const ro = getReadOnlyTools(reg);
        expect(ro).toHaveLength(1);
        expect(ro[0]?.name).toBe('codeA');
    });

    it('listToolNames retorna nomes de todas as tools', () => {
        const names = listToolNames(reg);
        expect(names).toHaveLength(4);
        expect(names).toContain('codeA');
        expect(names).toContain('taskD');
    });

    it('getToolByName retorna a tool correta', () => {
        const t = getToolByName(reg, 'gitC');
        expect(t?.name).toBe('gitC');
    });

    it('getToolByName retorna undefined para nome inexistente', () => {
        expect(getToolByName(reg, 'naoExiste')).toBeUndefined();
    });

    it('getToolCount retorna a contagem total', () => {
        expect(getToolCount(reg)).toBe(4);
    });

    it('hasToolByName retorna true para tool existente', () => {
        expect(hasToolByName(reg, 'taskD')).toBe(true);
    });

    it('hasToolByName retorna false para tool inexistente', () => {
        expect(hasToolByName(reg, 'ghost')).toBe(false);
    });
});

// ─── F137: funções de composição ───────────────────────────────────────────

describe('F137 — funções de composição', () => {
    /** @type {ReturnType<typeof createRegistry>} */
    let regA;
    /** @type {ReturnType<typeof createRegistry>} */
    let regB;
    beforeEach(() => {
        regA = createRegistry();
        regB = createRegistry();
        registerTools(regA, [makeTool('x'), makeTool('y')], { category: 'cat1' });
        registerTools(regB, [makeTool('z'), makeTool('w')], { category: 'cat2' });
    });

    it('mergeRegistries combina dois registries sem alterar os originais', () => {
        const merged = mergeRegistries(regA, regB);
        expect(getToolCount(merged)).toBe(4);
        // originais inalterados
        expect(getToolCount(regA)).toBe(2);
        expect(getToolCount(regB)).toBe(2);
    });

    it('filterByNames retorna registry com apenas as tools especificadas', () => {
        const reg = mergeRegistries(regA, regB);
        const filtered = filterByNames(reg, ['x', 'z']);
        expect(getToolCount(filtered)).toBe(2);
        expect(hasToolByName(filtered, 'x')).toBe(true);
        expect(hasToolByName(filtered, 'y')).toBe(false);
    });

    it('excludeByNames retorna registry sem as tools listadas', () => {
        const reg = mergeRegistries(regA, regB);
        const excluded = excludeByNames(reg, ['x', 'z']);
        expect(getToolCount(excluded)).toBe(2);
        expect(hasToolByName(excluded, 'x')).toBe(false);
        expect(hasToolByName(excluded, 'y')).toBe(true);
        expect(hasToolByName(excluded, 'w')).toBe(true);
    });

    it('inspectRegistry retorna resumo com total, categories e names', () => {
        const info = inspectRegistry(regA);
        expect(info).toHaveProperty('total');
        expect(info.total).toBe(2);
        expect(info).toHaveProperty('categories');
        expect(info).toHaveProperty('names');
    });
});

// ─── F138: zero-bypass audit ────────────────────────────────────────────────

describe('F138 — zero-bypass: nenhum consumidor direto de sdk/tools-registry fora de sdk/', () => {
    it('agent/ não importa alias folha de registry', () => {
        const removedAlias = "from '#copilot/sdk/" + "tools-registry'";
        expect(findFilesContaining(join(ROOT, 'src/copilot/agent'), removedAlias)).toEqual([]);
    });

    it('server/routes/sdk/ não importa alias folha de registry', () => {
        const removedAlias = "from '#copilot/sdk/" + "tools-registry'";
        expect(
            findFilesContaining(join(ROOT, 'src/copilot/server/routes/sdk'), removedAlias),
        ).toEqual([]);
    });
});
