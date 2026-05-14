// @ts-check
/**
 * Contratos de governança de organização física.
 *
 * O objetivo não é congelar a árvore para sempre; é impedir que diretórios críticos voltem a ser opacos. Cada arquivo
 * precisa declarar seu papel antes de novas migrações físicas.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'vitest';

import {
    DIALOG_MODULE_LAYOUT,
    getDialogModuleRole,
    listDialogModulesByRole,
} from '../../../../src/copilot/agent/dialog/module-map.js';
import {
    LIFECYCLE_MODULE_LAYOUT,
    getLifecycleModuleRole,
    listLifecycleModulesByRole,
} from '../../../../src/copilot/agent/lifecycle/module-map.js';
import {
    SESSION_MODULE_LAYOUT,
    getSessionModuleRole,
    listSessionModulesByRole,
} from '../../../../src/copilot/agent/session/module-map.js';
import {
    SERVER_MODULE_LAYOUT,
    getServerModuleRole,
    listServerModulesByRole,
} from '../../../../src/copilot/server/module-map.js';
import {
    SERVER_ROUTE_MODULE_LAYOUT,
    buildServerRouteModuleScorecard,
    getServerRouteModuleRole,
    listServerRouteModulesByRisk,
    listServerRouteModulesBySurface,
} from '../../../../src/copilot/server/routes/module-map.js';
import {
    TERMINAL_HANDLER_MODULE_LAYOUT,
    buildTerminalHandlerModuleScorecard,
    getTerminalHandlerModuleRole,
    listTerminalHandlerModulesByRisk,
    listTerminalHandlerModulesByRole,
} from '../../../../src/copilot/terminal/handlers/module-map.js';
import {
    TERMINAL_MODULE_LAYOUT,
    buildTerminalModuleScorecard,
    getTerminalModuleRole,
    listTerminalModulesByRisk,
    listTerminalModulesByRole,
} from '../../../../src/copilot/terminal/module-map.js';

const ROOT = new URL('../../../../src/copilot/', import.meta.url).pathname;
const AGENT_ROOT = join(ROOT, 'agent');
const DIALOG_ROOT = join(ROOT, 'agent/dialog');
const LIFECYCLE_ROOT = join(ROOT, 'agent/lifecycle');
const SERVER_ROOT = join(ROOT, 'server');
const SERVER_ROUTES_ROOT = join(ROOT, 'server/routes');
const SESSION_ROOT = join(ROOT, 'agent/session');
const TERMINAL_ROOT = join(ROOT, 'terminal');
const TERMINAL_HANDLERS_ROOT = join(ROOT, 'terminal/handlers');

/**
 * @param {string} dir
 * @returns {string[]}
 */
function listJsFilesRecursive(dir) {
    /** @type {string[]} */
    const files = [];
    for (const entry of readdirSync(dir)) {
        const abs = join(dir, entry);
        const stat = statSync(abs);
        if (stat.isDirectory()) {
            files.push(...listJsFilesRecursive(abs));
        } else if (stat.isFile() && entry.endsWith('.js')) {
            files.push(abs);
        }
    }
    return files;
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function listTopLevelJsFiles(dir) {
    return readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
        .map((entry) => entry.name)
        .sort();
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function listTopLevelDirectories(dir) {
    return readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `${entry.name}/`)
        .sort();
}

/**
 * @param {string} file
 * @returns {number}
 */
function countLines(file) {
    return readFileSync(file, 'utf8').split('\n').length;
}

describe('W109 — module layout governance: agent/dialog', () => {
    it('declara todos os arquivos JS existentes no module-map', () => {
        const expected = listJsFilesRecursive(DIALOG_ROOT)
            .map((abs) => relative(DIALOG_ROOT, abs).replace(/\\/g, '/'))
            .sort();
        const declared = DIALOG_MODULE_LAYOUT.map((entry) => entry.path).sort();

        assert.deepEqual(declared, expected, 'agent/dialog/module-map.js deve cobrir todos os arquivos JS');
    });

    it('nao declara arquivos inexistentes', () => {
        const missing = DIALOG_MODULE_LAYOUT.filter((entry) => !existsSync(join(DIALOG_ROOT, entry.path))).map(
            (entry) => entry.path,
        );
        assert.deepEqual(missing, [], `Arquivos declarados e ausentes: ${missing.join(', ')}`);
    });

    it('mantem trio primario navegavel: controller, loop manager e turn executor', () => {
        assert.equal(getDialogModuleRole('controllers/agent-dialog-controller.js'), 'controller');
        assert.equal(getDialogModuleRole('orchestrators/loop-manager.js'), 'orchestrator');
        assert.equal(getDialogModuleRole('executors/turn-executor.js'), 'executor');
    });

    it('nao preserva shims no dialog apos migracao para owners reais', () => {
        assert.equal(getDialogModuleRole('agent-dialog-controller.js'), undefined);
        assert.equal(getDialogModuleRole('loop-manager.js'), undefined);
        assert.equal(getDialogModuleRole('turn-executor.js'), undefined);
    });

    it('mantem seams internos fora da superficie publica', () => {
        const seams = listDialogModulesByRole('seam');
        assert.equal(seams.length, 4);
        assert.deepEqual(
            seams.map((entry) => entry.public),
            [false, false, false, false],
        );
        assert.deepEqual(
            seams.map((entry) => entry.tier),
            ['secondary', 'internal', 'internal', 'internal'],
        );
    });

    it('README local documenta os papeis arquiteturais declarados', () => {
        const readme = readFileSync(join(DIALOG_ROOT, 'README.md'), 'utf8');
        const roles = [...new Set(DIALOG_MODULE_LAYOUT.map((entry) => entry.role))];
        const missingRoles = roles.filter((role) => !readme.includes(`\`${role}\``));

        assert.deepEqual(missingRoles, [], `README sem papel declarado: ${missingRoles.join(', ')}`);
    });

    it('sub-barrel publico exporta o mapa de layout', () => {
        const index = readFileSync(join(DIALOG_ROOT, 'index.js'), 'utf8');
        assert.match(index, /DIALOG_MODULE_LAYOUT/);
        assert.match(index, /getDialogModuleRole/);
        assert.match(index, /listDialogModulesByRole/);
    });

    it('codigo de producao importa owners reais em vez de shims de compatibilidade', () => {
        const shimNames = [
            'agent-dialog-controller',
            'loop-manager',
            'turn-executor',
            'loop-boot-runner',
            'loop-boot-circuit',
            'loop-runtime-kit',
            'compaction-policy',
            'resume-policy',
            'model-fallback',
            'state-machine',
            'pending-question-shadow',
            'cost-ledger',
            'backpressure',
            'event-wiring',
            'user-input-handler',
            'watchdog',
            'watchdog-supervisor',
        ];
        const shimPattern = new RegExp(
            String.raw`(?:from\s+|import\()\s*['"][^'"]*dialog\/(${shimNames.join('|')})\.js['"]`,
        );
        const offenders = listJsFilesRecursive(AGENT_ROOT)
            .filter((abs) => !relative(AGENT_ROOT, abs).replace(/\\/g, '/').startsWith('dialog/'))
            .filter((abs) => shimPattern.test(readFileSync(abs, 'utf8')))
            .map((abs) => relative(AGENT_ROOT, abs).replace(/\\/g, '/'))
            .sort();

        assert.deepEqual(offenders, [], `Imports de shims detectados em codigo de producao: ${offenders.join(', ')}`);
    });
});

describe('W113 — module layout governance: agent/session', () => {
    it('declara todos os arquivos JS existentes no module-map', () => {
        const expected = listJsFilesRecursive(SESSION_ROOT)
            .map((abs) => relative(SESSION_ROOT, abs).replace(/\\/g, '/'))
            .sort();
        const declared = SESSION_MODULE_LAYOUT.map((entry) => entry.path).sort();

        assert.deepEqual(declared, expected, 'agent/session/module-map.js deve cobrir todos os arquivos JS');
    });

    it('nao declara arquivos inexistentes', () => {
        const missing = SESSION_MODULE_LAYOUT.filter((entry) => !existsSync(join(SESSION_ROOT, entry.path))).map(
            (entry) => entry.path,
        );
        assert.deepEqual(missing, [], `Arquivos declarados e ausentes: ${missing.join(', ')}`);
    });

    it('mantem arquivos primarios navegaveis', () => {
        assert.equal(getSessionModuleRole('initializers/initializer.js'), 'initializer');
        assert.equal(getSessionModuleRole('boot/boot-wiring.js'), 'boot');
        assert.equal(getSessionModuleRole('index.js'), 'entrypoint');
    });

    it('mantem boot decomposto em runner, barrel e substeps', () => {
        const boot = listSessionModulesByRole('boot')
            .map((entry) => entry.path)
            .sort();
        assert.deepEqual(boot, [
            'boot/boot-dialog-recovery.js',
            'boot/boot-runtime-bind.js',
            'boot/boot-session-prep.js',
            'boot/boot-steps.js',
            'boot/boot-wiring.js',
            'boot/index.js',
            'boot/steps/index.js',
        ]);
    });

    it('nao preserva shims na raiz de session apos migracao para subpastas semanticas', () => {
        const oldRootFiles = [
            'initializer.js',
            'boot-wiring.js',
            'boot-steps.js',
            'boot-session-prep.js',
            'boot-dialog-recovery.js',
            'boot-runtime-bind.js',
            'keepalive.js',
            'cleanup.js',
            'rotation.js',
            'event-wirer.js',
            'history-sync.js',
            'hook-context.js',
            'ownership.js',
            'snapshot.js',
            'snapshot-store.js',
        ];

        assert.deepEqual(
            oldRootFiles.filter((file) => getSessionModuleRole(file) !== undefined),
            [],
        );
    });

    it('README local documenta os papeis arquiteturais declarados', () => {
        const readme = readFileSync(join(SESSION_ROOT, 'README.md'), 'utf8');
        const roles = [...new Set(SESSION_MODULE_LAYOUT.map((entry) => entry.role))];
        const missingRoles = roles.filter((role) => !readme.includes(`\`${role}\``));

        assert.deepEqual(missingRoles, [], `README sem papel declarado: ${missingRoles.join(', ')}`);
    });

    it('sub-barrel publico exporta o mapa de layout', () => {
        const index = readFileSync(join(SESSION_ROOT, 'index.js'), 'utf8');
        assert.match(index, /SESSION_MODULE_LAYOUT/);
        assert.match(index, /getSessionModuleRole/);
        assert.match(index, /listSessionModulesByRole/);
    });
});

describe('W113 — module layout governance: agent/lifecycle', () => {
    it('declara todos os arquivos JS existentes no module-map', () => {
        const expected = listJsFilesRecursive(LIFECYCLE_ROOT)
            .map((abs) => relative(LIFECYCLE_ROOT, abs).replace(/\\/g, '/'))
            .sort();
        const declared = LIFECYCLE_MODULE_LAYOUT.map((entry) => entry.path).sort();

        assert.deepEqual(declared, expected, 'agent/lifecycle/module-map.js deve cobrir todos os arquivos JS');
    });

    it('nao declara arquivos inexistentes', () => {
        const missing = LIFECYCLE_MODULE_LAYOUT.filter((entry) => !existsSync(join(LIFECYCLE_ROOT, entry.path))).map(
            (entry) => entry.path,
        );
        assert.deepEqual(missing, [], `Arquivos declarados e ausentes: ${missing.join(', ')}`);
    });

    it('mantem lifecycle primario e entrypoint compat explicitos', () => {
        assert.equal(getLifecycleModuleRole('orchestrators/agent-lifecycle.js'), 'orchestrator');
        assert.equal(getLifecycleModuleRole('entrypoints/entry.js'), 'compat-entry');
        assert.equal(getLifecycleModuleRole('process-host/runtime-host.js'), 'process-host');
    });

    it('mantem estado separado entre API semantica e I/O cru', () => {
        const state = listLifecycleModulesByRole('state')
            .map((entry) => entry.path)
            .sort();
        assert.deepEqual(state, ['state/file/index.js', 'state/index.js', 'state/state-file-io.js', 'state/state-io.js']);
    });

    it('nao preserva shims na raiz de lifecycle apos migracao para subpastas semanticas', () => {
        const oldRootFiles = [
            'agent-lifecycle.js',
            'entry.js',
            'runtime-host.js',
            'session-setup.js',
            'reconnect-policy.js',
            'runtime-teardown.js',
            'state-io.js',
            'state-file-io.js',
        ];

        assert.deepEqual(
            oldRootFiles.filter((file) => getLifecycleModuleRole(file) !== undefined),
            [],
        );
    });

    it('README local documenta os papeis arquiteturais declarados', () => {
        const readme = readFileSync(join(LIFECYCLE_ROOT, 'README.md'), 'utf8');
        const roles = [...new Set(LIFECYCLE_MODULE_LAYOUT.map((entry) => entry.role))];
        const missingRoles = roles.filter((role) => !readme.includes(`\`${role}\``));

        assert.deepEqual(missingRoles, [], `README sem papel declarado: ${missingRoles.join(', ')}`);
    });

    it('sub-barrel publico exporta o mapa de layout', () => {
        const index = readFileSync(join(LIFECYCLE_ROOT, 'index.js'), 'utf8');
        assert.match(index, /LIFECYCLE_MODULE_LAYOUT/);
        assert.match(index, /getLifecycleModuleRole/);
        assert.match(index, /listLifecycleModulesByRole/);
    });
});

describe('W114 — module layout governance: terminal root', () => {
    it('declara todos os arquivos JS da raiz no module-map', () => {
        const expected = listTopLevelJsFiles(TERMINAL_ROOT);
        const declaredRoot = TERMINAL_MODULE_LAYOUT.filter((entry) => entry.kind === 'file')
            .map((entry) => entry.path)
            .filter((path) => !path.includes('/'))
            .sort();
        const missingDeclared = TERMINAL_MODULE_LAYOUT.filter((entry) => entry.kind === 'file')
            .filter((entry) => !existsSync(join(TERMINAL_ROOT, entry.path)))
            .map((entry) => entry.path)
            .sort();

        assert.deepEqual(declaredRoot, expected, 'terminal/module-map.js deve cobrir todos os JS da raiz');
        assert.deepEqual(missingDeclared, [], `Arquivos declarados e ausentes: ${missingDeclared.join(', ')}`);
    });

    it('declara os subdiretorios arquiteturais da raiz', () => {
        const expected = [
            'commands/',
            'dialog/',
            'events/',
            'frontend/',
            'frontend/gateways/',
            'frontend/operational-guidance/',
            'frontend/projections/',
            'handlers/',
            'repl/',
            'state/',
            'state/boot/',
            'state/dialog/',
            'state/events/',
            'state/projections/',
            'state/sdk/',
            'state/repl/',
            'state/repl-runtime/',
            'state/ui/',
            'stores/',
            'terminal-phases/',
            'wiring/',
            'wiring/mailbox/',
        ].sort();
        const declared = TERMINAL_MODULE_LAYOUT.filter((entry) => entry.kind === 'directory')
            .map((entry) => entry.path)
            .sort();
        const expectedTopLevel = expected.filter((path) => !path.slice(0, -1).includes('/'));

        assert.deepEqual(declared, expected);
        assert.deepEqual(
            expectedTopLevel.filter((path) => !listTopLevelDirectories(TERMINAL_ROOT).includes(path)),
            [],
        );
    });

    it('mantem barrel root, composition root, REPL e adapters navegaveis', () => {
        assert.equal(getTerminalModuleRole('bootstrap.js'), 'entrypoint');
        assert.equal(getTerminalModuleRole('index.js'), 'barrel');
        assert.equal(getTerminalModuleRole('runtime-root.js'), 'orchestrator');
        assert.equal(getTerminalModuleRole('repl/repl.js'), 'repl');
        assert.equal(getTerminalModuleRole('events/agent-runtime-events.js'), 'event-adapter');
        assert.equal(getTerminalModuleRole('wiring/terminal-agent-wiring.js'), 'wiring');
    });

    it('nao preserva leafs legados na raiz apos mover owners para submodulos nomeados', () => {
        assert.equal(getTerminalModuleRole('auto-briefing.js'), undefined);
        assert.equal(getTerminalModuleRole('mailbox-drain.js'), undefined);
    });

    it('README local documenta os papeis arquiteturais declarados', () => {
        const readme = readFileSync(join(TERMINAL_ROOT, 'README.md'), 'utf8');
        const roles = [...new Set(TERMINAL_MODULE_LAYOUT.map((entry) => entry.role))];
        const missingRoles = roles.filter((role) => !readme.includes(`\`${role}\``));

        assert.deepEqual(missingRoles, [], `README sem papel declarado: ${missingRoles.join(', ')}`);
    });

    it('index publico exporta o mapa de layout', () => {
        const index = readFileSync(join(TERMINAL_ROOT, 'index.js'), 'utf8');
        assert.match(index, /TERMINAL_MODULE_LAYOUT/);
        assert.match(index, /getTerminalModuleRole/);
        assert.match(index, /listTerminalModulesByRole/);
        assert.match(index, /listTerminalModulesByRisk/);
        assert.match(index, /buildTerminalModuleScorecard/);
    });

    it('mantem passthrough SSE explicitamente fora da superficie publica', () => {
        const passthroughs = listTerminalModulesByRole('passthrough');
        assert.equal(passthroughs.length, 1);
        assert.equal(passthroughs[0]?.public, false);
        assert.equal(passthroughs[0]?.tier, 'internal');
    });

    it('marca arquivos grandes da raiz como watch ou hotspot', () => {
        const offenders = TERMINAL_MODULE_LAYOUT.filter((entry) => entry.kind === 'file')
            .filter((entry) => entry.path !== 'module-map.js')
            .filter((entry) => countLines(join(TERMINAL_ROOT, entry.path)) > 220)
            .filter((entry) => entry.risk === 'stable')
            .map((entry) => entry.path)
            .sort();

        assert.deepEqual(offenders, [], `Arquivos grandes do terminal marcados como stable: ${offenders.join(', ')}`);
    });

    it('marca arquivos muito grandes da raiz como hotspot', () => {
        const offenders = TERMINAL_MODULE_LAYOUT.filter((entry) => entry.kind === 'file')
            .filter((entry) => entry.path !== 'module-map.js')
            .filter((entry) => countLines(join(TERMINAL_ROOT, entry.path)) > 300)
            .filter((entry) => entry.risk !== 'hotspot')
            .map((entry) => entry.path)
            .sort();

        assert.deepEqual(offenders, [], `Arquivos muito grandes do terminal sem hotspot: ${offenders.join(', ')}`);
    });

    it('scorecard beta expõe hotspots reais do terminal root', () => {
        const scorecard = buildTerminalModuleScorecard();

        assert.equal(scorecard.total, TERMINAL_MODULE_LAYOUT.length);
        assert.equal(scorecard.byRisk['hotspot'], listTerminalModulesByRisk('hotspot').length);
        assert.deepEqual(scorecard.watch, [
            'events/tool-activity-presenter.js',
            'runtime-root.js',
            'state/activity-state.js',
            'stores/',
            'stores/alias-store.js',
            'terminal-phases/',
        ]);
        assert.deepEqual(scorecard.hotspots, [
            'commands/',
            'dialog/',
            'events/',
            'events/agent-runtime-events.js',
            'events/io-activity-events.js',
            'events/sdk-session-events.js',
            'frontend/',
            'frontend/gateways/sdk-session.js',
            'repl/',
            'repl/repl-command-router.js',
            'repl/repl-lifecycle.js',
            'repl/repl.js',
            'state/',
            'state/display-policy.js',
            'state/sdk-interactions.js',
            'state/turn-trace-state.js',
            'wiring/',
            'wiring/terminal-agent-wiring.js',
        ]);
    });
});

describe('W114 — module layout governance: server root', () => {
    it('declara todos os arquivos JS da raiz no module-map', () => {
        const expected = listTopLevelJsFiles(SERVER_ROOT);
        const declared = SERVER_MODULE_LAYOUT.filter((entry) => entry.kind === 'file')
            .map((entry) => entry.path)
            .sort();

        assert.deepEqual(declared, expected, 'server/module-map.js deve cobrir todos os JS da raiz');
    });

    it('declara os subdiretorios arquiteturais da raiz', () => {
        const expected = ['middleware/', 'routes/', 'runtime-state/', 'socket/'];
        const declared = SERVER_MODULE_LAYOUT.filter((entry) => entry.kind === 'directory')
            .map((entry) => entry.path)
            .sort();

        assert.deepEqual(declared, expected);
        assert.deepEqual(
            expected.filter((path) => !listTopLevelDirectories(SERVER_ROOT).includes(path)),
            [],
        );
    });

    it('mantem server owner, app factory e router navegaveis', () => {
        assert.equal(getServerModuleRole('index.js'), 'entrypoint');
        assert.equal(getServerModuleRole('app.js'), 'app-factory');
        assert.equal(getServerModuleRole('router.js'), 'router');
        assert.equal(getServerModuleRole('handler-bridge.js'), undefined);
    });

    it('mantem adapter canônico de presentation separado na árvore de routes', () => {
        const descriptor = SERVER_ROUTE_MODULE_LAYOUT.find((entry) => entry.path === 'presentation-route.js');

        assert.equal(getServerRouteModuleRole('presentation-route.js'), 'route-adapter');
        assert.equal(descriptor?.risk, 'stable');
    });

    it('README local documenta os papeis arquiteturais declarados', () => {
        const readme = readFileSync(join(SERVER_ROOT, 'README.md'), 'utf8');
        const roles = [...new Set(SERVER_MODULE_LAYOUT.map((entry) => entry.role))];
        const missingRoles = roles.filter((role) => !readme.includes(`\`${role}\``));

        assert.deepEqual(missingRoles, [], `README sem papel declarado: ${missingRoles.join(', ')}`);
    });

    it('index publico exporta o mapa de layout', () => {
        const index = readFileSync(join(SERVER_ROOT, 'index.js'), 'utf8');
        assert.match(index, /SERVER_MODULE_LAYOUT/);
        assert.match(index, /getServerModuleRole/);
        assert.match(index, /listServerModulesByRole/);
        assert.match(index, /SERVER_ROUTE_MODULE_LAYOUT/);
        assert.match(index, /getServerRouteModuleRole/);
    });

    it('mantem runtime-state separado da superficie de router', () => {
        const runtimeState = listServerModulesByRole('runtime-state');
        assert.equal(runtimeState.length, 1);
        assert.equal(runtimeState[0]?.kind, 'directory');
        assert.equal(runtimeState[0]?.public, false);
    });
});

describe('W114.4 — module layout governance: terminal/handlers', () => {
    it('declara todos os arquivos JS existentes no module-map', () => {
        const expected = listJsFilesRecursive(TERMINAL_HANDLERS_ROOT)
            .map((abs) => relative(TERMINAL_HANDLERS_ROOT, abs).replace(/\\/g, '/'))
            .sort();
        const declared = TERMINAL_HANDLER_MODULE_LAYOUT.map((entry) => entry.path).sort();

        assert.deepEqual(declared, expected, 'terminal/handlers/module-map.js deve cobrir todos os arquivos JS');
    });

    it('nao declara arquivos inexistentes', () => {
        const missing = TERMINAL_HANDLER_MODULE_LAYOUT.filter(
            (entry) => !existsSync(join(TERMINAL_HANDLERS_ROOT, entry.path)),
        ).map((entry) => entry.path);

        assert.deepEqual(missing, [], `Arquivos declarados e ausentes: ${missing.join(', ')}`);
    });

    it('mantem o diretorio como adapter fino de presentation', () => {
        assert.equal(getTerminalHandlerModuleRole('index.js'), 'barrel');
        assert.equal(getTerminalHandlerModuleRole('module-map.js'), 'inventory');
        assert.equal(getTerminalHandlerModuleRole('shared.js'), 'type-contract');

        const adapters = listTerminalHandlerModulesByRole('presentation-adapter')
            .map((entry) => entry.path)
            .sort();
        assert.deepEqual(adapters, ['agent.js', 'dialog.js', 'system-config.js', 'system-metrics.js']);
    });

    it('nao normaliza hotspots no terminal handlers', () => {
        assert.deepEqual(listTerminalHandlerModulesByRisk('hotspot'), []);
        assert.deepEqual(listTerminalHandlerModulesByRisk('watch'), []);
    });

    it('README local documenta os papeis arquiteturais declarados', () => {
        const readme = readFileSync(join(TERMINAL_HANDLERS_ROOT, 'README.md'), 'utf8');
        const roles = [...new Set(TERMINAL_HANDLER_MODULE_LAYOUT.map((entry) => entry.role))];
        const missingRoles = roles.filter((role) => !readme.includes(`\`${role}\``));

        assert.deepEqual(missingRoles, [], `README sem papel declarado: ${missingRoles.join(', ')}`);
    });

    it('barrel publico exporta o mapa de layout', () => {
        const index = readFileSync(join(TERMINAL_HANDLERS_ROOT, 'index.js'), 'utf8');
        assert.match(index, /TERMINAL_HANDLER_MODULE_LAYOUT/);
        assert.match(index, /getTerminalHandlerModuleRole/);
        assert.match(index, /listTerminalHandlerModulesByRole/);
        assert.match(index, /buildTerminalHandlerModuleScorecard/);
    });

    it('scorecard beta confirma maturidade de adapter fino', () => {
        const scorecard = buildTerminalHandlerModuleScorecard();

        assert.equal(scorecard.total, TERMINAL_HANDLER_MODULE_LAYOUT.length);
        assert.equal(scorecard.byRisk['stable'], TERMINAL_HANDLER_MODULE_LAYOUT.length);
        assert.deepEqual(scorecard.hotspots, []);
        assert.deepEqual(scorecard.adapters, ['agent.js', 'dialog.js', 'system-config.js', 'system-metrics.js']);
    });
});

describe('W114.4 — module layout governance: server/routes', () => {
    it('declara todos os arquivos JS existentes no module-map recursivo', () => {
        const expected = listJsFilesRecursive(SERVER_ROUTES_ROOT)
            .map((abs) => relative(SERVER_ROUTES_ROOT, abs).replace(/\\/g, '/'))
            .sort();
        const declared = SERVER_ROUTE_MODULE_LAYOUT.filter((entry) => entry.kind === 'file')
            .map((entry) => entry.path)
            .sort();

        assert.deepEqual(declared, expected, 'server/routes/module-map.js deve cobrir todos os arquivos JS');
    });

    it('nao declara arquivos ou diretorios inexistentes', () => {
        const missing = SERVER_ROUTE_MODULE_LAYOUT.filter(
            (entry) => !existsSync(join(SERVER_ROUTES_ROOT, entry.path)),
        ).map((entry) => entry.path);

        assert.deepEqual(missing, [], `Arquivos declarados e ausentes: ${missing.join(', ')}`);
    });

    it('mantem sub-superficies copilot-api e sdk explicitas', () => {
        assert.equal(getServerRouteModuleRole('module-map.js'), 'inventory');
        assert.equal(getServerRouteModuleRole('copilot-api/'), 'surface');
        assert.equal(getServerRouteModuleRole('sdk/'), 'surface');
        assert.equal(getServerRouteModuleRole('sdk/deps.js'), 'sdk-deps');
        assert.equal(getServerRouteModuleRole('sdk/session-middleware.js'), 'sdk-middleware');
        assert.equal(getServerRouteModuleRole('sdk/session-schemas.js'), 'sdk-schema');
        assert.equal(getServerRouteModuleRole('sdk/session-core-routes.js'), 'sdk-session-route-family');
        assert.equal(getServerRouteModuleRole('sdk/session-route-helpers.js'), 'sdk-session-helper');
        assert.equal(getServerRouteModuleRole('sdk/session-rpc-routes.js'), 'sdk-session-route-family');
        assert.equal(getServerRouteModuleRole('sdk/session-stream-state.js'), 'sdk-session-stream');
    });

    it('separa rotas por surface para orientar decomposicao futura', () => {
        const root = listServerRouteModulesBySurface('root');
        const copilotApi = listServerRouteModulesBySurface('copilot-api');
        const sdk = listServerRouteModulesBySurface('sdk');

        assert.ok(root.length > 8);
        assert.ok(copilotApi.some((entry) => entry.path === 'copilot-api/control.js'));
        assert.ok(sdk.some((entry) => entry.path === 'sdk/session-messaging.js'));
    });

    it('marca arquivos grandes como watch ou hotspot', () => {
        const offenders = SERVER_ROUTE_MODULE_LAYOUT.filter((entry) => entry.kind === 'file')
            .filter((entry) => entry.path !== 'module-map.js')
            .filter((entry) => countLines(join(SERVER_ROUTES_ROOT, entry.path)) > 220)
            .filter((entry) => entry.risk === 'stable')
            .map((entry) => entry.path)
            .sort();

        assert.deepEqual(offenders, [], `Arquivos grandes marcados como stable: ${offenders.join(', ')}`);
    });

    it('marca arquivos muito grandes como hotspot', () => {
        const offenders = SERVER_ROUTE_MODULE_LAYOUT.filter((entry) => entry.kind === 'file')
            .filter((entry) => entry.path !== 'module-map.js')
            .filter((entry) => countLines(join(SERVER_ROUTES_ROOT, entry.path)) > 300)
            .filter((entry) => entry.risk !== 'hotspot')
            .map((entry) => entry.path)
            .sort();

        assert.deepEqual(offenders, [], `Arquivos muito grandes sem hotspot: ${offenders.join(', ')}`);
    });

    it('hotspots atuais ficam nomeados para as proximas subondas', () => {
        const hotspots = listServerRouteModulesByRisk('hotspot')
            .map((entry) => entry.path)
            .sort();

        assert.deepEqual(hotspots, [
            'copilot-api/control.js',
            'copilot-api/tasks.js',
            'sdk/',
            'sdk/agent.js',
            'sdk/client.js',
            'sdk/deps.js',
            'sdk/observability.js',
            'sdk/session-crud.js',
            'sdk/session-workspace-routes.js',
        ]);
    });

    it('scorecard beta torna risco e surfaces consultaveis por contrato', () => {
        const scorecard = buildServerRouteModuleScorecard();

        assert.equal(scorecard.total, SERVER_ROUTE_MODULE_LAYOUT.length);
        assert.equal(scorecard.bySurface['root'], listServerRouteModulesBySurface('root').length);
        assert.equal(scorecard.bySurface['sdk'], listServerRouteModulesBySurface('sdk').length);
        assert.equal(scorecard.byRisk['hotspot'], listServerRouteModulesByRisk('hotspot').length);
        assert.ok((scorecard.byRisk['watch'] ?? 0) >= 1);
        assert.ok(scorecard.watch.includes('sdk/session-core-routes.js'));
        assert.ok(scorecard.watch.includes('sdk/session-middleware.js'));
    });

    it('README local documenta os papeis arquiteturais declarados', () => {
        const readme = readFileSync(join(SERVER_ROUTES_ROOT, 'README.md'), 'utf8');
        const roles = [...new Set(SERVER_ROUTE_MODULE_LAYOUT.map((entry) => entry.role))];
        const missingRoles = roles.filter((role) => !readme.includes(`\`${role}\``));

        assert.deepEqual(missingRoles, [], `README sem papel declarado: ${missingRoles.join(', ')}`);
    });

    it('router publico exporta o mapa de rotas', () => {
        const router = readFileSync(join(SERVER_ROOT, 'router.js'), 'utf8');
        assert.match(router, /SERVER_ROUTE_MODULE_LAYOUT/);
        assert.match(router, /getServerRouteModuleRole/);
        assert.match(router, /listServerRouteModulesBySurface/);
        assert.match(router, /buildServerRouteModuleScorecard/);
    });
});
