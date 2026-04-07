// @ts-check
import assert from 'node:assert/strict';

import { buildQualityExecutionPlan } from '../../../scripts/audit/lib/impact_classifier.mjs';

test('impact classifier: docs-only quick smart skips lint/typecheck and keeps prettier delta', () => {
    const plan = buildQualityExecutionPlan(
        /** @type {any} */ ({
            profile: 'quick',
            qualityMode: 'smart',
            changedFiles: ['README.md', 'DOCUMENTAÇÃO/AUDITORIAS/BUGS/foo.md'],
        }),
    );

    assert.equal(plan.strategy, 'changed-only');
    assert.equal(plan.risk, 'low');
    assert.equal(plan.steps.lint.mode, 'skip');
    assert.equal(plan.steps.typecheck_node.mode, 'skip');
    assert.equal(plan.steps.typecheck_browser.mode, 'skip');
    assert.equal(plan.steps.prettier_check.mode, 'changed-only');
});

test('impact classifier: server/domain change triggers node typecheck only', () => {
    const plan = buildQualityExecutionPlan(
        /** @type {any} */ ({
            profile: 'quick',
            qualityMode: 'smart',
            changedFiles: ['src/server/domain/task_control_service.js'],
        }),
    );

    assert.equal(plan.steps.lint.mode, 'changed-only');
    assert.equal(plan.steps.typecheck_node.mode, 'full');
    assert.equal(plan.steps.typecheck_browser.mode, 'skip');
    assert.equal(plan.steps.node_check.mode, 'changed-only');
});

test('impact classifier: shared/types change triggers node + browser typecheck', () => {
    const plan = buildQualityExecutionPlan(
        /** @type {any} */ ({
            profile: 'quick',
            qualityMode: 'smart',
            changedFiles: ['src/shared/page_stability/stabilizer.js', 'src/types/guards.js'],
        }),
    );

    assert.equal(plan.steps.typecheck_node.mode, 'full');
    assert.equal(plan.steps.typecheck_browser.mode, 'full');
    assert.equal(plan.risk, 'medium');
});

test('impact classifier: package.json forces full quality strategy with fallback reason', () => {
    const plan = buildQualityExecutionPlan(
        /** @type {any} */ ({
            profile: 'quick',
            qualityMode: 'smart',
            changedFiles: ['package.json'],
        }),
    );

    assert.equal(plan.strategy, 'full');
    assert.equal(plan.risk, 'high');
    assert.ok(plan.reasons.includes('high-risk quality config changed'));
    assert.ok(plan.fallbacks.includes('config-change => full lint/typecheck/prettier'));
    assert.equal(plan.steps.lint.mode, 'full');
    assert.equal(plan.steps.prettier_check.mode, 'full');
    assert.equal(plan.steps.typecheck_node.mode, 'full');
    assert.equal(plan.steps.typecheck_browser.mode, 'full');
});
