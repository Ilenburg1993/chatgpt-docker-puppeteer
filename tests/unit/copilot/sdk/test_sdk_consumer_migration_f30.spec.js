// @ts-check
/**
 * @file Faixa 30 — Consumer Migration Pass
 *
 *   Verifica que consumidores de submodules do SDK foram migrados para o barrel #copilot/sdk. Cobre:
 *
 *   - F146: tools/ usa #copilot/sdk para createTool (não sdk/tools.js diretamente)
 *   - F147: bridges/ usa barrel (não sdk/events.js nem sdk/tools.js)
 *   - F148: agent/lifecycle/ usa barrel (não sdk/event-helpers)
 *   - F149: agent/session/ usa barrel (não sdk/session, sdk/tools-state, sdk/utils)
 *   - F150: observability/ usa barrel (não sdk/events.js)
 *   - F151: terminal/ usa barrel (não sdk/models/*, sdk/tools-state, sdk/custom-tools)
 *   - F152: zero-bypass completo — varredura de submodules críticos em todo src/copilot/
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = '/workspaces/chatgpt-docker-puppeteer';

/** @param {string} relPath */
const src = (relPath) => readFileSync(join(ROOT, 'src/copilot', relPath), 'utf8');

// ─── F146: tools/ usa barrel para createTool ───────────────────────────────

describe('F146 — tools/ usa #copilot/sdk para createTool', () => {
    const toolFiles = [
        'tools/session-rpc-tools.js',
        'tools/git/index.js',
        'tools/introspection-tools.js',
        'tools/task-tools.js',
        'tools/session-tools.js',
        'tools/todo/bulk-tools.js',
        'tools/todo/crud-tools.js',
        'tools/shell/index.js',
        'tools/tool-factory.js',
    ];

    for (const file of toolFiles) {
        it(`${file.split('/').pop()} não importa de '#copilot/sdk/tools.js'`, () => {
            expect(src(file)).not.toContain("from '#copilot/sdk/tools.js'");
        });

        it(`${file.split('/').pop()} importa createTool de #copilot/sdk`, () => {
            expect(src(file)).toMatch(/import\s*\{[^}]*createTool[^}]*\}\s*from\s*'#copilot\/sdk'/);
        });
    }
});

// ─── F147: bridges/ usa barrel ─────────────────────────────────────────────

describe('F147 — bridges/ usa barrel para onSessionEvent e createTool', () => {
    it('mcp-tool-bridge.js não importa de #copilot/sdk/tools.js', () => {
        expect(src('bridges/mcp-tool-bridge.js')).not.toContain("from '#copilot/sdk/tools.js'");
    });

    it('mcp-tool-bridge.js importa createTool de #copilot/sdk', () => {
        expect(src('bridges/mcp-tool-bridge.js')).toMatch(/import\s*\{[^}]*createTool[^}]*\}\s*from\s*'#copilot\/sdk'/);
    });

    it('nerv-bridge.js não importa de #copilot/sdk/events.js', () => {
        expect(src('bridges/nerv-bridge.js')).not.toContain("from '#copilot/sdk/events.js'");
    });

    it('nerv-bridge.js importa onSessionEvent de #copilot/sdk', () => {
        expect(src('bridges/nerv-bridge.js')).toMatch(/from\s*'#copilot\/sdk'/);
    });
});

// ─── F148: agent/lifecycle/ usa barrel ─────────────────────────────────────

describe('F148 — agent/lifecycle/ usa barrel para event-helpers', () => {
    it('agent-lifecycle.js não importa de #copilot/sdk/event-helpers', () => {
        expect(src('agent/lifecycle/agent-lifecycle.js')).not.toContain("from '#copilot/sdk/event-helpers'");
    });

    it('agent-lifecycle.js importa raceEvents de #copilot/sdk', () => {
        expect(src('agent/lifecycle/agent-lifecycle.js')).toContain("from '#copilot/sdk'");
    });

    it('loop-manager.js não importa de #copilot/sdk/event-helpers', () => {
        expect(src('agent/dialog/loop-manager.js')).not.toContain("from '#copilot/sdk/event-helpers'");
    });

    it('loop-manager.js importa waitForEvent de #copilot/sdk', () => {
        expect(src('agent/dialog/loop-manager.js')).toContain("from '#copilot/sdk'");
    });
});

// ─── F149: agent/session/ usa barrel ───────────────────────────────────────

describe('F149 — agent/session/ usa barrel para session, tools-state, utils', () => {
    it('cleanup.js não importa de #copilot/sdk/session', () => {
        expect(src('agent/session/cleanup.js')).not.toContain("from '#copilot/sdk/session'");
    });

    it('cleanup.js importa deleteSession de #copilot/sdk', () => {
        expect(src('agent/session/cleanup.js')).toContain("from '#copilot/sdk'");
    });

    it('initializer.js não importa de #copilot/sdk/tools-state', () => {
        expect(src('agent/session/initializer.js')).not.toContain("from '#copilot/sdk/tools-state'");
    });

    it('initializer.js não importa de #copilot/sdk/utils', () => {
        expect(src('agent/session/initializer.js')).not.toContain("from '#copilot/sdk/utils'");
    });

    it('initializer.js importa do barrel #copilot/sdk', () => {
        expect(src('agent/session/initializer.js')).toContain("from '#copilot/sdk'");
    });
});

// ─── F150: observability/ usa barrel ───────────────────────────────────────

describe('F150 — observability/ usa barrel para onSessionEvent', () => {
    it('event-collector.js não importa de #copilot/sdk/events.js', () => {
        expect(src('observability/event-collector.js')).not.toContain("from '#copilot/sdk/events.js'");
    });

    it('event-collector.js importa de #copilot/sdk', () => {
        expect(src('observability/event-collector.js')).toContain("from '#copilot/sdk'");
    });

    it('dialog-task-handlers.js não importa de #copilot/sdk/models/registry', () => {
        expect(src('observability/observers/dialog-task-handlers.js')).not.toContain(
            "from '#copilot/sdk/models/registry'",
        );
    });

    it('dialog-task-handlers.js importa modelStatsTracker de #copilot/sdk', () => {
        expect(src('observability/observers/dialog-task-handlers.js')).toContain("from '#copilot/sdk'");
    });
});

// ─── F151: terminal/ usa barrel ────────────────────────────────────────────

describe('F151 — terminal/ usa barrel para models e tools-state', () => {
    it('commands/config.js não importa de #copilot/sdk/models/registry', () => {
        expect(src('terminal/commands/config.js')).not.toContain("from '#copilot/sdk/models/registry'");
    });

    it('commands/config.js não importa de #copilot/sdk/models/helpers', () => {
        expect(src('terminal/commands/config.js')).not.toContain("from '#copilot/sdk/models/helpers'");
    });

    it('commands/config.js importa de #copilot/sdk', () => {
        expect(src('terminal/commands/config.js')).toContain("from '#copilot/sdk'");
    });

    it('handlers/system-config.js não importa de #copilot/sdk/custom-tools', () => {
        expect(src('terminal/handlers/system-config.js')).not.toContain("from '#copilot/sdk/custom-tools'");
    });

    it('handlers/system-config.js não importa de #copilot/sdk/tools-state', () => {
        expect(src('terminal/handlers/system-config.js')).not.toContain("from '#copilot/sdk/tools-state'");
    });
});

// ─── F152: zero-bypass completo ────────────────────────────────────────────

describe('F152 — zero-bypass: submodules críticos não importados fora de sdk/', () => {
    const CRITICAL_SUBMODULES = [
        '#copilot/sdk/tools.js',
        '#copilot/sdk/event-helpers',
        '#copilot/sdk/events.js',
        '#copilot/sdk/models/registry',
        '#copilot/sdk/models/helpers',
        '#copilot/sdk/utils',
        '#copilot/sdk/client',
        '#copilot/sdk/tools-registry',
    ];

    for (const mod of CRITICAL_SUBMODULES) {
        it(`nenhum consumer usa "${mod}" fora de sdk/`, () => {
            const { execSync } = /** @type {typeof import('node:child_process')} */ (
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                require('node:child_process')
            );
            let count = 0;
            try {
                const result = execSync(`grep -rl "from '${mod}'" ${ROOT}/src/copilot/ --include='*.js'`, {
                    encoding: 'utf8',
                });
                // Filtra resultados: ignora arquivos dentro de sdk/ (são os próprios barrel/re-exports)
                const lines = result
                    .trim()
                    .split('\n')
                    .filter((l) => l && !l.includes('/src/copilot/sdk/'));
                count = lines.length;
            } catch {
                count = 0;
            }
            expect(count).toBe(0);
        });
    }
});
