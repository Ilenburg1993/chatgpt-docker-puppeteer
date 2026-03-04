// @ts-check
// NOTE: This test requires external Chrome proxy availability.

import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert';
import config from '#core/config';

// This file currently assumes an external proxy configuration.
// It is kept as E2E-only and not part of the default `npm test` run.

console.log('🚀 Testando sequência de boot...\n');

const PROXY_PORT = 9224;

const log = {
    section: msg => console.log(`\n=== ${msg} ===`),
};

function ok(cond, msg) {
    assert.ok(cond, msg);
    console.log(`✅ ${msg}`);
}

(async () => {
    log.section('FASE 1: Configuração');
    console.log('  Mode:', config.BROWSER_MODE || 'launcher');
    ok(!!config, 'Config carregado');

    log.section('FASE 2: Arquivos de Configuração');
    const projectRoot = process.cwd();

    // config.json exists
    const cfgPath = path.join(projectRoot, 'config.json');
    ok(fs.existsSync(cfgPath), 'config.json existe');

    // chrome-config.json exists
    const chromeCfgPath = path.join(projectRoot, 'chrome-config.json');
    ok(fs.existsSync(chromeCfgPath), 'chrome-config.json existe');

    // sanity: expected ports are mentioned (best-effort)
    const chromeCfg = JSON.parse(fs.readFileSync(chromeCfgPath, 'utf8'));
    ok(chromeCfg?.connection?.ports?.includes(PROXY_PORT), `chrome-config.json prioriza proxy port ${PROXY_PORT}`);

    console.log('\n✅ Boot sequence checks OK (E2E preflight)');
})();
