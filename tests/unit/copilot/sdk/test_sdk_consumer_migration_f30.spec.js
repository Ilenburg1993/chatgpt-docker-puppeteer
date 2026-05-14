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
    const toolFiles = ['tools/infra/tool-factory.js'];

    for (const file of toolFiles) {
        it(`${file.split('/').pop()} não importa de '#copilot/sdk/tools'`, () => {
            expect(src(file)).not.toContain("from '#copilot/sdk/tools'");
        });

        it(`${file.split('/').pop()} importa createTool de #copilot/sdk`, () => {
            expect(src(file)).toMatch(/import\s*\{[^}]*createTool[^}]*\}\s*from\s*'#copilot\/sdk'/);
        });
    }

    it('sub-barrels de tools não importam createTool diretamente', () => {
        const shellBarrel = src('tools/shell/index.js');
        const gitBarrel = src('tools/git/index.js');
        expect(shellBarrel).not.toMatch(/createTool/);
        expect(gitBarrel).not.toMatch(/createTool/);
    });
});

// ─── F147: bridges/ usa barrel ─────────────────────────────────────────────

describe('F147 — bridges/ converge para a factory canônica sem bypass de SDK', () => {
    it('mcp-tool-bridge.js não importa de #copilot/sdk/tools', () => {
        expect(src('bridges/mcp-tool-bridge.js')).not.toContain("from '#copilot/sdk/tools'");
    });

    it('mcp-tool-bridge.js não importa createTool de #copilot/sdk', () => {
        expect(src('bridges/mcp-tool-bridge.js')).not.toMatch(
            /import\s*\{[^}]*createTool[^}]*\}\s*from\s*'#copilot\/sdk'/,
        );
    });

    it('mcp-tool-bridge.js importa buildTool da factory canônica', () => {
        expect(src('bridges/mcp-tool-bridge.js')).toMatch(
            /import\s*\{[^}]*buildTool[^}]*\}\s*from\s*'#copilot\/tools'/,
        );
    });

    // nerv-bridge.js removido em L36 — testes migrados
});

// ─── F148: agent/lifecycle/ usa barrel ─────────────────────────────────────

describe('F148 — agent/lifecycle/ usa barrel para event-helpers', () => {
    it('agent-lifecycle.js não importa de #copilot/sdk/event-helpers', () => {
        expect(src('agent/lifecycle/orchestrators/agent-lifecycle.js')).not.toContain(
            "from '#copilot/sdk/event-helpers'",
        );
    });

    it('agent-lifecycle.js usa façade agent-sdk-access para raceAgentSdkEvents', () => {
        const content = src('agent/lifecycle/orchestrators/agent-lifecycle.js');
        expect(content).toContain("from '../../facades/index.js'");
        expect(content).toContain('raceAgentSdkEvents');
        expect(content).not.toContain("from '#copilot/sdk'");
    });

    it('loop-manager.js não importa de #copilot/sdk/event-helpers', () => {
        expect(src('agent/dialog/orchestrators/loop-manager.js')).not.toContain("from '#copilot/sdk/event-helpers'");
    });

    it('loop-manager.js não importa waitForEvent diretamente de #copilot/sdk', () => {
        expect(src('agent/dialog/orchestrators/loop-manager.js')).not.toContain("from '#copilot/sdk'");
    });

    it('loop-manager.js mantém o SDK fora do orquestrador principal', () => {
        expect(src('agent/dialog/orchestrators/loop-manager.js')).not.toContain(
            "from '../facades/agent-sdk-runtime.js'",
        );
        expect(src('agent/dialog/orchestrators/loop-manager.js')).not.toContain('waitForAgentSdkEvent');
    });

    it('loop-boot-runner.js usa a façade agent-sdk-runtime para waitForAgentSdkEvent', () => {
        expect(src('agent/dialog/boot/loop-boot-runner.js')).toContain("from '../../facades/index.js'");
        expect(src('agent/dialog/boot/loop-boot-runner.js')).toContain('waitForAgentSdkEvent');
    });

    it('resume-policy.js usa a façade agent-sdk-runtime para waitForAgentSdkEvent', () => {
        expect(src('agent/dialog/policies/resume-policy.js')).toContain("from '../../facades/index.js'");
        expect(src('agent/dialog/policies/resume-policy.js')).toContain('waitForAgentSdkEvent');
        expect(src('agent/dialog/policies/resume-policy.js')).not.toContain("from '#copilot/sdk'");
    });
});

// ─── F149: agent/session/ usa barrel ───────────────────────────────────────

describe('F149 — agent/session/ converge para façades do agent', () => {
    it('cleanup.js não importa de #copilot/sdk/session', () => {
        expect(src('agent/session/lifecycle/cleanup.js')).not.toContain("from '#copilot/sdk/session'");
    });

    it('cleanup.js usa façade agent-sdk-access', () => {
        const content = src('agent/session/lifecycle/cleanup.js');
        expect(content).toContain("from '../../facades/index.js'");
        expect(content).toContain('listAgentSdkSessionsByClient');
        expect(content).toContain('deleteAgentSdkSessionByClient');
        expect(content).not.toContain("from '#copilot/sdk'");
    });

    it('initializer.js não importa de #copilot/sdk/tools-state', () => {
        expect(src('agent/session/initializers/initializer.js')).not.toContain("from '#copilot/sdk/tools-state'");
    });

    it('initializer.js não importa de #copilot/sdk/utils', () => {
        expect(src('agent/session/initializers/initializer.js')).not.toContain("from '#copilot/sdk/utils'");
    });

    it('initializer.js usa façade agent-sdk-access', () => {
        const content = src('agent/session/initializers/initializer.js');
        expect(content).toContain("from '../../facades/index.js'");
        expect(content).toContain('resumeOrCreateAgentSdkSession');
        expect(content).toContain('createAgentSdkSessionByClient');
        expect(content).not.toContain("from '#copilot/sdk'");
    });
});

// ─── F150: observability/ usa barrel ───────────────────────────────────────

describe('F150 — observability/ usa barrel para onSessionEvent', () => {
    it('event-collector.js não importa de #copilot/sdk/events', () => {
        expect(src('observability/event-collector.js')).not.toContain("from '#copilot/sdk/events'");
    });

    it('event-collector.js importa de #copilot/sdk', () => {
        const content = src('observability/event-collector.js');
        expect(content.includes("from '#copilot/sdk'") || content.includes("from '#copilot/events'")).toBe(true);
    });

    it('dialog-task-handlers.js não importa de #copilot/sdk/models/registry', () => {
        expect(src('observability/observers/dialog-task-handlers.js')).not.toContain(
            "from '#copilot/sdk/models/registry'",
        );
    });

    it('dialog-task-handlers.js não depende mais do sdk barrel para modelStatsTracker', () => {
        expect(src('observability/observers/dialog-task-handlers.js')).not.toContain("from '#copilot/sdk'");
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

    it('commands/config.js não reabre o sdk; usa frontend compartilhado', () => {
        const content = src('terminal/commands/config.js');
        expect(content).not.toContain("from '#copilot/sdk'");
        expect(content).toContain("from '../frontend/index.js'");
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
        '#copilot/sdk/event-helpers',
        '#copilot/sdk/events',
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
