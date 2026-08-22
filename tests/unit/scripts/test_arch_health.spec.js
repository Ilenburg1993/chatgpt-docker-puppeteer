// @ts-check
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';

const report = JSON.parse(
    execFileSync('node', ['scripts/arch-health.mjs', '--json', '--quiet'], {
        encoding: 'utf-8',
        cwd: process.cwd(),
    }),
);

describe('scripts/arch-health.mjs — arquitetura 2.1', () => {
    it('gera schema atual com métricas estruturais explícitas', () => {
        assert.ok(report.timestamp);
        assert.ok(report.boundaries);
        assert.ok(report.imports);
        assert.ok(report.moduleMutableState);
        assert.ok(report.fanOut);
        assert.ok(report.architecture);
        assert.ok(report.health);
        assert.ok(typeof report.health.score === 'number');
        assert.ok(['A', 'B', 'C', 'D', 'E', 'F'].includes(report.health.grade));
    });

    it('todos os módulos top-level possuem boundary deliberado sem exigir mega-barrel de infra', () => {
        assert.equal(report.boundaries.total, report.boundaries.covered);
        assert.equal(report.boundaries.ratio, 100);
        assert.deepEqual(report.boundaries.uncovered, []);
        assert.equal(report.boundaries.details.infra.rootBarrel, false);
        assert.ok(report.boundaries.details.infra.exactEntrypoints > 0);
    });

    it('todo uso #copilot ativo resolve por alias exato e não há wildcard', () => {
        assert.equal(report.imports.success, true);
        assert.equal(report.imports.nonExactUsageCount, 0);
        assert.deepEqual(report.imports.nonExactSpecifiers, []);
        assert.deepEqual(report.imports.wildcardAliases, []);
        assert.deepEqual(report.imports.parseErrors, []);
        assert.deepEqual(report.imports.forbiddenUsages, []);
        assert.equal(report.imports.exactUsageCount, report.imports.usageCount);
    });

    it('mede somente mutabilidade de module scope e usa o checker arquitetural canônico', () => {
        assert.ok(report.moduleMutableState.bindings >= report.moduleMutableState.files);
        assert.deepEqual(report.moduleMutableState.parseErrors, []);
        assert.equal(report.architecture.hard, 0);
        assert.equal(report.architecture.soft, 0);
    });

    it('score permanece entre 0 e 100 e DI inventory continua materializado', () => {
        assert.ok(report.health.score >= 0 && report.health.score <= 100);
        assert.ok(report.diTokens >= 13);
    });
});
