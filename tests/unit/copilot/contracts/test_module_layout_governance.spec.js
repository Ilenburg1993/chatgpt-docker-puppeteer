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

const ROOT = new URL('../../../../src/copilot/', import.meta.url).pathname;
const AGENT_ROOT = join(ROOT, 'agent');
const DIALOG_ROOT = join(ROOT, 'agent/dialog');
const LIFECYCLE_ROOT = join(ROOT, 'agent/lifecycle');
const SESSION_ROOT = join(ROOT, 'agent/session');

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
        assert.equal(seams.length, 3);
        assert.deepEqual(
            seams.map((entry) => entry.public),
            [false, false, false],
        );
        assert.deepEqual(
            seams.map((entry) => entry.tier),
            ['internal', 'internal', 'internal'],
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
        assert.equal(getSessionModuleRole('initializer.js'), 'initializer');
        assert.equal(getSessionModuleRole('boot-wiring.js'), 'boot');
        assert.equal(getSessionModuleRole('index.js'), 'entrypoint');
    });

    it('mantem boot decomposto em runner, barrel e substeps', () => {
        const boot = listSessionModulesByRole('boot')
            .map((entry) => entry.path)
            .sort();
        assert.deepEqual(boot, [
            'boot-dialog-recovery.js',
            'boot-runtime-bind.js',
            'boot-session-prep.js',
            'boot-steps.js',
            'boot-wiring.js',
        ]);
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
        assert.equal(getLifecycleModuleRole('agent-lifecycle.js'), 'orchestrator');
        assert.equal(getLifecycleModuleRole('entry.js'), 'compat-entry');
        assert.equal(getLifecycleModuleRole('runtime-host.js'), 'process-host');
    });

    it('mantem estado separado entre API semantica e I/O cru', () => {
        const state = listLifecycleModulesByRole('state')
            .map((entry) => entry.path)
            .sort();
        assert.deepEqual(state, ['state-file-io.js', 'state-io.js']);
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
