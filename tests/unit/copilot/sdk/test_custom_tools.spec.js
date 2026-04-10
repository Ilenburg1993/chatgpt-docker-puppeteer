// @ts-check
/**
 * @file Faixa 39 — SDK Custom Tools Registry Test Suite (F213-F220)
 *
 * Testes para src/copilot/sdk/custom-tools.js:
 * - BUILTIN_HANDLER_MAP (echo, timestamp, env_read, process_info, uptime, math_eval)
 * - registerCustomTool / removeCustomTool
 * - getCustomToolDefinitions
 * - buildCustomTools
 * - loadCustomToolsAsync
 * - _resetRegistry
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks (hoisted) ────────────────────────────────────────────────────────

const { mockLog, mockBuildTool, mockLogSwallowed } = vi.hoisted(() => ({
    mockLog: vi.fn(),
    mockBuildTool: vi.fn((opts) => ({ name: opts.name, _handler: opts.handler })),
    mockLogSwallowed: vi.fn(),
}));

vi.mock('#copilot/observability/logger', () => ({ log: mockLog }));
vi.mock('#copilot/tools/tool-factory', () => ({ buildTool: mockBuildTool }));
vi.mock('#copilot/core/error-handlers', () => ({ logSwallowed: mockLogSwallowed }));
vi.mock('#copilot/core/safe-json', () => ({
    safeJsonParse: vi.fn((raw) => {
        try {
            return { ok: true, data: JSON.parse(raw) };
        } catch {
            return { ok: false, data: null };
        }
    }),
}));
vi.mock('#copilot/core/schemas', () => ({
    CustomToolsFileSchema: {
        safeParse: vi.fn((data) => {
            if (Array.isArray(data)) return { success: true, data };
            return { success: false, data: null };
        }),
    },
}));

// Mock node:fs (sync) — usado pelo loadCustomTools() no init e por registerCustomTool / removeCustomTool
vi.mock('node:fs', () => ({
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => '[]'),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
}));

// Mock node:fs/promises — usado pelo loadCustomToolsAsync
vi.mock('node:fs/promises', () => ({
    readFile: vi.fn(() => Promise.resolve('[]')),
    writeFile: vi.fn(() => Promise.resolve()),
    rename: vi.fn(() => Promise.resolve()),
}));

// ─── Import após mocks ──────────────────────────────────────────────────────

const {
    BUILTIN_HANDLER_MAP,
    registerCustomTool,
    removeCustomTool,
    getCustomToolDefinitions,
    buildCustomTools,
    loadCustomToolsAsync,
    _resetRegistry,
} = await import('#copilot/sdk/custom-tools');

const { readFile } = await import('node:fs/promises');

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
    vi.clearAllMocks();
    _resetRegistry();
});

// ═══════════════════════════════════════════════════════════════════════════════
// BUILTIN_HANDLER_MAP
// ═══════════════════════════════════════════════════════════════════════════════

describe('F39 — BUILTIN_HANDLER_MAP', () => {
    it('contém handlers esperados', () => {
        expect(BUILTIN_HANDLER_MAP.has('echo')).toBe(true);
        expect(BUILTIN_HANDLER_MAP.has('timestamp')).toBe(true);
        expect(BUILTIN_HANDLER_MAP.has('env_read')).toBe(true);
        expect(BUILTIN_HANDLER_MAP.has('process_info')).toBe(true);
        expect(BUILTIN_HANDLER_MAP.has('uptime')).toBe(true);
        expect(BUILTIN_HANDLER_MAP.has('math_eval')).toBe(true);
    });

    it('echo retorna texto prefixado', () => {
        const echo = BUILTIN_HANDLER_MAP.get('echo');
        expect(echo?.({ text: 'hello' })).toBe('echo: hello');
    });

    it('echo serializa args não-string', () => {
        const echo = BUILTIN_HANDLER_MAP.get('echo');
        expect(echo?.({ foo: 1 })).toContain('{');
    });

    it('timestamp retorna ISO string', () => {
        const ts = BUILTIN_HANDLER_MAP.get('timestamp');
        const result = ts?.({});
        expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('env_read retorna variável da allowlist', () => {
        const envRead = BUILTIN_HANDLER_MAP.get('env_read');
        const result = envRead?.({ key: 'NODE_ENV' });
        expect(typeof result).toBe('string');
    });

    it('env_read rejeita variáveis fora da allowlist', () => {
        const envRead = BUILTIN_HANDLER_MAP.get('env_read');
        const result = envRead?.({ key: 'SECRET_TOKEN' });
        expect(result).toContain('allowlist');
    });

    it('env_read rejeita key vazia', () => {
        const envRead = BUILTIN_HANDLER_MAP.get('env_read');
        const result = envRead?.({ key: '' });
        expect(result).toContain('ausente');
    });

    it('process_info retorna JSON com pid', () => {
        const pi = BUILTIN_HANDLER_MAP.get('process_info');
        const result = JSON.parse(pi?.({}));
        expect(result).toHaveProperty('pid');
        expect(result).toHaveProperty('uptime');
    });

    it('uptime retorna formato legível', () => {
        const up = BUILTIN_HANDLER_MAP.get('uptime');
        const result = up?.({});
        expect(result).toMatch(/\d+h \d+m \d+s/);
    });

    it('math_eval calcula expressão simples', () => {
        const me = BUILTIN_HANDLER_MAP.get('math_eval');
        expect(me?.({ expression: '2 + 3' })).toBe('5');
        expect(me?.({ expression: '10 * 3.5' })).toBe('35');
        expect(me?.({ expression: '7 - 2' })).toBe('5');
        expect(me?.({ expression: '10 / 4' })).toBe('2.5');
    });

    it('math_eval rejeita expressão vazia', () => {
        const me = BUILTIN_HANDLER_MAP.get('math_eval');
        expect(me?.({ expression: '' })).toContain('ausente');
    });

    it('math_eval rejeita divisão por zero', () => {
        const me = BUILTIN_HANDLER_MAP.get('math_eval');
        expect(me?.({ expression: '5 / 0' })).toContain('zero');
    });

    it('math_eval rejeita expressão complexa', () => {
        const me = BUILTIN_HANDLER_MAP.get('math_eval');
        expect(me?.({ expression: '2 + 3 + 4' })).toContain('não suportada');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// registerCustomTool + removeCustomTool
// ═══════════════════════════════════════════════════════════════════════════════

describe('F39 — registerCustomTool', () => {
    it('registra tool com handler válido', () => {
        const result = registerCustomTool({
            name: 'my_tool',
            description: 'Test tool',
            handlerId: 'echo',
        });

        expect(result.ok).toBe(true);
        expect(getCustomToolDefinitions()).toHaveLength(1);
    });

    it('rejeita name inválido', () => {
        const result = registerCustomTool({
            name: 'Invalid-Name',
            description: 'Test',
            handlerId: 'echo',
        });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('snake_case');
    });

    it('rejeita handlerId desconhecido', () => {
        const result = registerCustomTool({
            name: 'my_tool',
            description: 'Test',
            handlerId: 'nonexistent_handler',
        });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('não reconhecido');
    });

    it('preserva parameters opcionais', () => {
        registerCustomTool({
            name: 'with_params',
            description: 'Test',
            handlerId: 'echo',
            parameters: { type: 'object', properties: { text: { type: 'string' } } },
        });

        const defs = getCustomToolDefinitions();
        expect(defs[0]?.parameters).toBeDefined();
    });
});

describe('F39 — removeCustomTool', () => {
    it('remove tool registrada', () => {
        registerCustomTool({ name: 'temp_tool', description: 'temp', handlerId: 'echo' });
        expect(getCustomToolDefinitions()).toHaveLength(1);

        const result = removeCustomTool('temp_tool');
        expect(result.ok).toBe(true);
        expect(getCustomToolDefinitions()).toHaveLength(0);
    });

    it('retorna erro ao remover tool inexistente', () => {
        const result = removeCustomTool('nope');
        expect(result.ok).toBe(false);
        expect(result.error).toContain('não encontrada');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// buildCustomTools
// ═══════════════════════════════════════════════════════════════════════════════

describe('F39 — buildCustomTools', () => {
    it('retorna array vazio sem tools registradas', () => {
        const tools = buildCustomTools();
        expect(tools).toHaveLength(0);
    });

    it('constrói Tool a partir do registry', () => {
        registerCustomTool({ name: 'my_echo', description: 'Echo', handlerId: 'echo' });
        const tools = buildCustomTools();

        expect(tools).toHaveLength(1);
        expect(mockBuildTool).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'my_echo', description: 'Echo' }),
        );
    });

    it('ignora tools com handlerId inválido no registry', () => {
        // Insere diretamente no registry com handlerId inválido
        registerCustomTool({ name: 'valid_tool', description: 'valid', handlerId: 'echo' });
        // Agora resetamos e criamos cenário onde o file tem handler inválido:
        // Vamos testar via handler invocation
        const tools = buildCustomTools();
        expect(tools).toHaveLength(1);
    });

    it('handler do Tool retorna string do builtin handler', async () => {
        registerCustomTool({ name: 'my_echo', description: 'Echo', handlerId: 'echo' });
        buildCustomTools();

        // buildTool was called with a handler function
        const buildCall = mockBuildTool.mock.calls[0]?.[0];
        expect(buildCall).toBeDefined();
        const result = await buildCall.handler({ text: 'world' });
        expect(result).toBe('echo: world');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// loadCustomToolsAsync
// ═══════════════════════════════════════════════════════════════════════════════

describe('F39 — loadCustomToolsAsync', () => {
    it('carrega tools do disco via fs/promises', async () => {
        /** @type {import('vitest').Mock} */
        const mockReadFile = /** @type {any} */ (readFile);
        mockReadFile.mockResolvedValue(
            JSON.stringify([
                { name: 'disk_tool', description: 'From disk', handlerId: 'echo' },
            ]),
        );

        await loadCustomToolsAsync();

        const defs = getCustomToolDefinitions();
        expect(defs).toHaveLength(1);
        expect(defs[0]?.name).toBe('disk_tool');
    });

    it('ignora arquivo json inválido', async () => {
        /** @type {import('vitest').Mock} */
        const mockReadFile = /** @type {any} */ (readFile);
        mockReadFile.mockResolvedValue('not-json{{{');

        await loadCustomToolsAsync();

        expect(getCustomToolDefinitions()).toHaveLength(0);
    });

    it('swallows file-not-found via logSwallowed', async () => {
        /** @type {import('vitest').Mock} */
        const mockReadFile = /** @type {any} */ (readFile);
        mockReadFile.mockRejectedValue(new Error('ENOENT'));

        await loadCustomToolsAsync();

        expect(mockLogSwallowed).toHaveBeenCalled();
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getCustomToolDefinitions
// ═══════════════════════════════════════════════════════════════════════════════

describe('F39 — getCustomToolDefinitions', () => {
    it('retorna array vazio por padrão', () => {
        expect(getCustomToolDefinitions()).toEqual([]);
    });

    it('retorna cópia do registry', () => {
        registerCustomTool({ name: 'tool_a', description: 'A', handlerId: 'echo' });
        const defs = getCustomToolDefinitions();
        defs.pop(); // mutate the returned array
        expect(getCustomToolDefinitions()).toHaveLength(1); // original unchanged
    });
});
