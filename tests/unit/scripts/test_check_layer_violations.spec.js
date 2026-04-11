// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    checkViolations,
    dynamicImportRegex,
    exportFromRegex,
    extractModule,
    importRegex,
    isInsideJsDoc,
    LAYER_MAP,
    resolveTarget,
} from '../../../scripts/check-layer-violations.mjs';

describe('check-layer-violations — extractModule', () => {
    it('retorna o módulo de primeiro nível', () => {
        assert.equal(extractModule('core/error-handlers.js'), 'core');
        assert.equal(extractModule('agent/lifecycle/session-setup.js'), 'agent');
        assert.equal(extractModule('conversation-hub/index.js'), 'conversation-hub');
    });

    it('retorna null para paths vazios', () => {
        assert.equal(extractModule(''), null);
    });
});

describe('check-layer-violations — resolveTarget', () => {
    it('resolve alias #copilot/xxx', () => {
        assert.equal(resolveTarget('#copilot/config/env', 'core'), 'config');
        assert.equal(resolveTarget('#copilot/hooks/factory', 'sdk'), 'hooks');
        assert.equal(resolveTarget('#copilot/core', 'agent'), 'core');
    });

    it('retorna null para imports relativos no mesmo módulo', () => {
        assert.equal(resolveTarget('./foo.js', 'core'), null);
        assert.equal(resolveTarget('./sub/bar.js', 'sdk'), null);
    });

    it('retorna null para imports de packages externos', () => {
        assert.equal(resolveTarget('node:fs', 'core'), null);
        assert.equal(resolveTarget('@github/copilot-sdk', 'sdk'), null);
    });

    it('resolve relative imports que cruzam módulos', () => {
        assert.equal(resolveTarget('../config/env.js', 'core'), 'config');
        assert.equal(resolveTarget('../hooks/factory.js', 'sdk'), 'hooks');
    });

    it('retorna null para relative imports desconhecidos', () => {
        assert.equal(resolveTarget('../unknown-module/foo.js', 'core'), null);
    });
});

describe('check-layer-violations — isInsideJsDoc', () => {
    it('detecta import dentro de bloco JSDoc', () => {
        const src = '/**\n * @typedef {import("#copilot/hooks/types").Hook} Hook\n */\n';
        const idx = src.indexOf('import(');
        assert.equal(isInsideJsDoc(src, idx), true);
    });

    it('não detecta import fora de JSDoc', () => {
        const src = 'import { foo } from "#copilot/hooks";\n';
        assert.equal(isInsideJsDoc(src, 0), false);
    });
});

describe('check-layer-violations — LAYER_MAP', () => {
    it('core, types e db são L0', () => {
        assert.equal(LAYER_MAP['core'], 0);
        assert.equal(LAYER_MAP['types'], 0);
        assert.equal(LAYER_MAP['db'], 0);
    });

    it('sdk e audit são L1', () => {
        assert.equal(LAYER_MAP['sdk'], 1);
        assert.equal(LAYER_MAP['audit'], 1);
    });

    it('hooks é L3', () => {
        assert.equal(LAYER_MAP['hooks'], 3);
        assert.equal(LAYER_MAP['plugins'], 3);
    });

    it('terminal é L6', () => {
        assert.equal(LAYER_MAP['terminal'], 6);
    });

    it('services é L4', () => {
        assert.equal(LAYER_MAP['services'], 4);
    });

    it('cada layer inferior tem valor menor', () => {
        assert.ok(LAYER_MAP['core'] < LAYER_MAP['config']);
        assert.ok(LAYER_MAP['config'] < LAYER_MAP['hooks']);
        assert.ok(LAYER_MAP['hooks'] < LAYER_MAP['agent']);
        assert.ok(LAYER_MAP['agent'] < LAYER_MAP['api']);
        assert.ok(LAYER_MAP['api'] < LAYER_MAP['terminal']);
    });
});

describe('check-layer-violations — regex patterns', () => {
    it('importRegex captura static import', () => {
        importRegex.lastIndex = 0;
        const m = importRegex.exec("import { foo } from '#copilot/hooks/factory';");
        assert.ok(m);
        assert.equal(m[1], '#copilot/hooks/factory');
    });

    it('exportFromRegex captura named re-export', () => {
        exportFromRegex.lastIndex = 0;
        const m = exportFromRegex.exec("export { bar, baz } from '#copilot/config/env';");
        assert.ok(m);
        assert.equal(m[1], '#copilot/config/env');
    });

    it('exportFromRegex captura star re-export', () => {
        exportFromRegex.lastIndex = 0;
        const m = exportFromRegex.exec("export * from './constants.js';");
        assert.ok(m);
        assert.equal(m[1], './constants.js');
    });

    it('dynamicImportRegex captura dynamic import', () => {
        dynamicImportRegex.lastIndex = 0;
        const m = dynamicImportRegex.exec("const mod = await import('#copilot/agent/loop');");
        assert.ok(m);
        assert.equal(m[1], '#copilot/agent/loop');
    });
});

describe('check-layer-violations — checkViolations (integration)', () => {
    it('retorna 0 violações no estado atual do codebase', () => {
        const v = checkViolations();
        assert.equal(v.length, 0, `Expected 0 violations but found ${v.length}: ${JSON.stringify(v, null, 2)}`);
    });
});
