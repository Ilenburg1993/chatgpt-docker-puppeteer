// @ts-check
/**
 * @file Faixa 36 — Session Tools Test Suite (F189-F196)
 *
 *   Testes para src/copilot/tools/session/session-tools.js:
 *
 *   - read_briefing, write_pending_task, get_workspace_info, set_session_context, invoke_skill
 *   - export shape (sessionTools array)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
    mockLog: vi.fn(),
    logSwallowed: vi.fn(),
    toError: vi.fn((error) => (error instanceof Error ? error : new Error(String(error)))),
    buildTool: vi.fn((config) => config),
    withSkipPermission: vi.fn((tool) => Object.assign(tool, { skipPermission: true })),
}));

vi.mock('../../../../src/copilot/tools/infra/logger.js', () => ({
    log: mocks.mockLog,
}));

vi.mock('#copilot/core', async (importOriginal) => {
    const actual = /** @type {Record<string, unknown>} */ (await importOriginal());
    return {
        ...actual,
        logSwallowed: mocks.logSwallowed,
        toError: mocks.toError,
    };
});

/**
 * @type {{
 *     readFile: import('vitest').Mock;
 *     writeFile: import('vitest').Mock;
 *     mkdir: import('vitest').Mock;
 *     stat: import('vitest').Mock;
 *     readdir: import('vitest').Mock;
 * }}
 */
const fsMock = {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    stat: vi.fn(),
    readdir: vi.fn(),
};
vi.mock('node:fs/promises', () => fsMock);

const mockExecFileSync = vi.fn();
vi.mock('node:child_process', () => ({
    execFileSync: mockExecFileSync,
}));

// createTool: passthrough para obter handler
vi.mock('#copilot/sdk', () => ({
    createTool: vi.fn((config) => config),
    SYSTEM_PROMPT_SECTIONS: {},
}));

// withSkipPermission: passthrough
vi.mock('../../../../src/copilot/tools/infra/tool-factory.js', () => ({
    buildTool: mocks.buildTool,
    withSkipPermission: mocks.withSkipPermission,
}));

// ─── Import após mocks ──────────────────────────────────────────────────────

const sessionModuleUrl = new URL('../../../../src/copilot/tools/session/session-tools.js', import.meta.url);
const { sessionTools } = await import(sessionModuleUrl.href);

// Desestruturar tools do array exportado
const [readBriefingTool, writePendingTaskTool, getWorkspaceInfoTool, setSessionContextTool, invokeSkillTool] =
    /** @type {[any, any, any, any, any]} */ (sessionTools);

/** @param {Function} handler @param {Record<string, unknown>} [args] */
const callTool = async (handler, args = {}) => /** @type {any} */ (await handler(args, { sessionId: 'test-session' }));

beforeEach(() => {
    vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════════
// F189-F190: read_briefing
// ═══════════════════════════════════════════════════════════════════════════════

describe('F36 — read_briefing (F189-F190)', () => {
    const handler = /** @type {Function} */ (readBriefingTool.handler);

    it('retorna conteúdo do briefing quando existe', async () => {
        fsMock.readFile.mockResolvedValue('# Session Briefing\nclose_key: abc123');

        const result = await callTool(handler, {});

        expect(result.content).toContain('close_key: abc123');
    });

    it('retorna null quando briefing não existe', async () => {
        fsMock.readFile.mockRejectedValue(new Error('ENOENT'));

        const result = await callTool(handler, {});

        expect(result.content).toBeNull();
        expect(result.message).toContain('não encontrado');
    });

    it('possui skipPermission=true', () => {
        expect(readBriefingTool.skipPermission).toBe(true);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F191-F192: write_pending_task
// ═══════════════════════════════════════════════════════════════════════════════

describe('F36 — write_pending_task (F191-F192)', () => {
    const handler = /** @type {Function} */ (writePendingTaskTool.handler);

    it('adiciona tarefa ao pending-tasks.md', async () => {
        fsMock.mkdir.mockResolvedValue(undefined);
        fsMock.readFile.mockResolvedValue('# Tarefas Pendentes\n\n');
        fsMock.writeFile.mockResolvedValue(undefined);

        const result = await callTool(handler, { title: 'Fix bug', description: 'Corrigir bug X', priority: 'high' });

        expect(result.success).toBe(true);
        expect(result.title).toBe('Fix bug');
        expect(fsMock.writeFile).toHaveBeenCalledOnce();
        const written = fsMock.writeFile.mock.calls[0]?.[1];
        expect(written).toBeDefined();
        expect(written).toContain('[HIGH] Fix bug');
        expect(written).toContain('Corrigir bug X');
    });

    it('cria arquivo quando não existe', async () => {
        fsMock.mkdir.mockResolvedValue(undefined);
        fsMock.readFile.mockRejectedValue(new Error('ENOENT'));
        fsMock.writeFile.mockResolvedValue(undefined);

        const result = await callTool(handler, { title: 'Nova tarefa' });

        expect(result.success).toBe(true);
        const written = fsMock.writeFile.mock.calls[0]?.[1];
        expect(written).toBeDefined();
        expect(written).toContain('# Tarefas Pendentes');
    });

    it('usa prioridade medium por default', async () => {
        fsMock.mkdir.mockResolvedValue(undefined);
        fsMock.readFile.mockResolvedValue('');
        fsMock.writeFile.mockResolvedValue(undefined);

        await callTool(handler, { title: 'Default priority' });

        const written = fsMock.writeFile.mock.calls[0]?.[1];
        expect(written).toBeDefined();
        expect(written).toContain('[MEDIUM]');
    });

    it('retorna erro em falha de escrita', async () => {
        fsMock.mkdir.mockRejectedValue(new Error('EACCES'));

        const result = await callTool(handler, { title: 'Will fail' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('EACCES');
    });

    it('loga a adição de tarefa', async () => {
        fsMock.mkdir.mockResolvedValue(undefined);
        fsMock.readFile.mockResolvedValue('');
        fsMock.writeFile.mockResolvedValue(undefined);

        await callTool(handler, { title: 'Logged task' });

        expect(mocks.mockLog).toHaveBeenCalledWith('INFO', expect.stringContaining('write_pending_task'));
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F193: get_workspace_info
// ═══════════════════════════════════════════════════════════════════════════════

describe('F36 — get_workspace_info (F193)', () => {
    const handler = /** @type {Function} */ (getWorkspaceInfoTool.handler);

    it('retorna info básica do workspace com git', async () => {
        mockExecFileSync
            .mockReturnValueOnce('main\n') // branch
            .mockReturnValueOnce('/workspaces/project\n') // root
            .mockReturnValueOnce('abc1234\n'); // commit

        const result = await callTool(handler, {});

        expect(result.cwd).toBeDefined();
        expect(result.nodeVersion).toBe(process.version);
        expect(result.platform).toBe(process.platform);
        expect(result.git).toEqual({
            branch: 'main',
            commit: 'abc1234',
            root: '/workspaces/project',
        });
    });

    it('retorna git=null quando git falha', async () => {
        mockExecFileSync.mockImplementation(() => {
            throw new Error('not a git repo');
        });

        const result = await callTool(handler, {});

        expect(result.git).toBeNull();
        expect(result.nodeVersion).toBeDefined();
    });

    it('possui skipPermission=true', () => {
        expect(getWorkspaceInfoTool.skipPermission).toBe(true);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F194: set_session_context
// ═══════════════════════════════════════════════════════════════════════════════

describe('F36 — set_session_context (F194)', () => {
    const handler = /** @type {Function} */ (setSessionContextTool.handler);

    it('armazena contexto e retorna contagem', async () => {
        const result = await callTool(handler, { key: 'current_task', value: 'fixing bugs' });

        expect(result.success).toBe(true);
        expect(result.key).toBe('current_task');
        expect(result.stored).toBeGreaterThanOrEqual(1);
    });

    it('sobrescreve valor existente', async () => {
        await callTool(handler, { key: 'mykey', value: 'v1' });
        const result = await callTool(handler, { key: 'mykey', value: 'v2' });

        expect(result.success).toBe(true);
    });

    it('loga a operação', async () => {
        await callTool(handler, { key: 'log_test', value: 'x' });

        expect(mocks.mockLog).toHaveBeenCalledWith('INFO', expect.stringContaining('set_session_context'));
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F195: invoke_skill
// ═══════════════════════════════════════════════════════════════════════════════

describe('F36 — invoke_skill (F195)', () => {
    const handler = /** @type {Function} */ (invokeSkillTool.handler);

    it('lista skills disponíveis quando name omitido', async () => {
        fsMock.stat.mockResolvedValue({});
        fsMock.readdir.mockResolvedValue([
            { name: 'code-audit', isDirectory: () => true },
            { name: 'jsdoc-authoring', isDirectory: () => true },
            { name: 'README.md', isDirectory: () => false },
        ]);

        const result = await callTool(handler, {});

        expect(result.available).toEqual(['code-audit', 'jsdoc-authoring']);
    });

    it('carrega conteúdo de uma skill existente', async () => {
        fsMock.stat.mockResolvedValue({});
        fsMock.readdir.mockResolvedValue([{ name: 'code-audit', isDirectory: () => true }]);
        fsMock.readFile.mockResolvedValue('# Code Audit Skill\nInstruções...');

        const result = await callTool(handler, { name: 'code-audit' });

        expect(result.name).toBe('code-audit');
        expect(result.content).toContain('Code Audit Skill');
    });

    it('retorna erro se skill não encontrada', async () => {
        fsMock.stat.mockResolvedValue({});
        fsMock.readdir.mockResolvedValue([]);
        fsMock.readFile.mockRejectedValue(new Error('ENOENT'));

        const result = await callTool(handler, { name: 'nonexistent' });

        expect(result.error).toContain("'nonexistent'");
    });

    it('retorna erro se diretório skills/ não existe', async () => {
        fsMock.stat.mockRejectedValue(new Error('ENOENT'));

        const result = await callTool(handler, { name: 'test' });

        expect(result.error).toContain('.github/skills/');
    });

    it('possui skipPermission=true', () => {
        expect(invokeSkillTool.skipPermission).toBe(true);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// F196: Export shape
// ═══════════════════════════════════════════════════════════════════════════════

describe('F36 — sessionTools export shape (F196)', () => {
    it('exporta array com 5 tools', () => {
        expect(sessionTools).toHaveLength(5);
    });

    it('cada tool tem name, description, handler', () => {
        for (const tool of sessionTools) {
            expect(tool).toHaveProperty('name');
            expect(tool).toHaveProperty('description');
            expect(tool).toHaveProperty('handler');
        }
    });

    it('tools com skipPermission são marcadas', () => {
        const readBriefing = sessionTools.find((/** @type {any} */ t) => t.name === 'read_briefing');
        const getInfo = sessionTools.find((/** @type {any} */ t) => t.name === 'get_workspace_info');
        const skill = sessionTools.find((/** @type {any} */ t) => t.name === 'invoke_skill');

        expect(readBriefing?.skipPermission).toBe(true);
        expect(getInfo?.skipPermission).toBe(true);
        expect(skill?.skipPermission).toBe(true);
    });

    it('nomes de tools corretos', () => {
        const names = sessionTools.map((/** @type {any} */ t) => t.name);
        expect(names).toContain('read_briefing');
        expect(names).toContain('write_pending_task');
        expect(names).toContain('get_workspace_info');
        expect(names).toContain('set_session_context');
        expect(names).toContain('invoke_skill');
    });
});
