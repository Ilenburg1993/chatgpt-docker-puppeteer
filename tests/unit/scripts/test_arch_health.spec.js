// @ts-check
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';

describe('scripts/arch-health.mjs', () => {
    it('gera JSON válido com --json --quiet', () => {
        const out = execFileSync('node', ['scripts/arch-health.mjs', '--json', '--quiet'], {
            encoding: 'utf-8',
            cwd: process.cwd(),
        });
        const report = JSON.parse(out);
        assert.ok(report.timestamp);
        assert.ok(report.barrel);
        assert.ok(typeof report.barrel.total === 'number');
        assert.ok(typeof report.barrel.withBarrel === 'number');
        assert.ok(report.singletons);
        assert.ok(typeof report.singletons.total === 'number');
        assert.ok(typeof report.singletons.refined === 'number');
        assert.ok(report.fanOut);
        assert.ok(typeof report.fanOut.max === 'number');
        assert.ok(typeof report.fanOut.avg === 'number');
        assert.ok(report.deepImports);
        assert.ok(typeof report.deepImports.total === 'number');
        assert.ok(typeof report.deepImports.refined === 'number');
        assert.ok(typeof report.diTokens === 'number');
        assert.ok(typeof report.tests === 'number');
        assert.ok(report.health);
        assert.ok(typeof report.health.score === 'number');
        assert.ok(['A', 'B', 'C', 'D', 'E', 'F'].includes(report.health.grade));
    });

    it('score está entre 0 e 100', () => {
        const out = execFileSync('node', ['scripts/arch-health.mjs', '--json', '--quiet'], {
            encoding: 'utf-8',
            cwd: process.cwd(),
        });
        const report = JSON.parse(out);
        assert.ok(report.health.score >= 0);
        assert.ok(report.health.score <= 100);
    });

    it('barrel ratio é 100% (todos os módulos têm index.js)', () => {
        const out = execFileSync('node', ['scripts/arch-health.mjs', '--json', '--quiet'], {
            encoding: 'utf-8',
            cwd: process.cwd(),
        });
        const report = JSON.parse(out);
        assert.equal(report.barrel.total, report.barrel.withBarrel);
        assert.equal(report.barrel.ratio, '100%');
    });

    it('diTokens é >= 13', () => {
        const out = execFileSync('node', ['scripts/arch-health.mjs', '--json', '--quiet'], {
            encoding: 'utf-8',
            cwd: process.cwd(),
        });
        const report = JSON.parse(out);
        assert.ok(report.diTokens >= 13);
    });
});
