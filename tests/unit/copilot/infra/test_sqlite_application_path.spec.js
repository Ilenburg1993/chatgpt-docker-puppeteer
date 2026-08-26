// @ts-check

import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { describe, it } from 'vitest';

import { resolveApplicationSqlitePath } from '#copilot/infra/public/composition/database/sqlite/path';

describe('application SQLite path authority', () => {
    const workspaceRoot = resolve('/tmp', 'copilot-sqlite-path-workspace');

    it('anchors the default database to the explicit workspace root', () => {
        assert.equal(resolveApplicationSqlitePath({}, workspaceRoot), resolve(workspaceRoot, 'data/copilot.sqlite'));
    });

    it('anchors relative configured database files to the explicit workspace root', () => {
        assert.equal(
            resolveApplicationSqlitePath({ COPILOT_DB_PATH: 'state/custom.sqlite' }, workspaceRoot),
            resolve(workspaceRoot, 'state/custom.sqlite'),
        );
    });

    it('normalizes directory-shaped configured targets to copilot.sqlite', () => {
        assert.equal(
            resolveApplicationSqlitePath({ COPILOT_DB_PATH: 'state/database/' }, workspaceRoot),
            resolve(workspaceRoot, 'state/database/copilot.sqlite'),
        );
    });

    it('preserves absolute files and in-memory databases', () => {
        assert.equal(
            resolveApplicationSqlitePath({ COPILOT_DB_PATH: '/tmp/custom-absolute.sqlite' }, workspaceRoot),
            resolve('/tmp/custom-absolute.sqlite'),
        );
        assert.equal(resolveApplicationSqlitePath({ COPILOT_DB_PATH: ':memory:' }, workspaceRoot), ':memory:');
    });
});
