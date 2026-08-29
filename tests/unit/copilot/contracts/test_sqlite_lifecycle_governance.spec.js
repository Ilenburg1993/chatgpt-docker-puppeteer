// @ts-check

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const LEGACY_DB_ROOT = resolve('src/copilot/db');
const BETTER_RUNTIME = resolve('src/copilot/infra/database/sqlite/better-sqlite3/runtime.js');
const BETTER_ADAPTER = resolve('src/copilot/infra/database/sqlite/better-sqlite3/adapter.js');
const NODE_SQLITE_ADAPTER = resolve('src/copilot/infra/database/sqlite/node-sqlite/runtime.js');
const APPLICATION_HOST = resolve('src/copilot/boot/application-infra-host.js');
const PUBLIC_SQLITE = resolve('src/copilot/infra/public/database/sqlite/index.js');
const PACKAGE_JSON = resolve('package.json');

describe('Copilot SQLite lifecycle governance', () => {
    it('removes the legacy db package and aliases instead of preserving compatibility shims', () => {
        expect(existsSync(LEGACY_DB_ROOT)).toBe(false);
        const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'));
        expect(pkg.imports?.['#copilot/db']).toBeUndefined();
        expect(pkg.imports?.['#copilot/db/node-sqlite']).toBeUndefined();
    });

    it('concrete better-sqlite3 runtime is an instance-owned terminal resource only', () => {
        const source = readFileSync(BETTER_RUNTIME, 'utf8');
        for (const forbidden of [
            "from 'node:fs",
            "from 'node:path'",
            'process.env',
            'process.on(',
            'process.once(',
            'registerApplicationShutdownHandler',
            '#copilot/boot/process-runtime',
            'COPILOT_DB_PATH',
            'configureCopilotSqliteRuntime',
            'getCopilotDb',
            'applicationRuntime',
            'setDbLogger',
            'setSqliteRuntimeLogger',
        ]) {
            expect(source.includes(forbidden), forbidden).toBe(false);
        }
        expect(source).toContain('createBetterSqliteApplicationRuntime');
        expect(source).toContain('ERR_INFRA_SQLITE_RESOURCE_DISPOSED');
        expect(source).toContain('[Symbol.dispose]: close');
        expect(source).toContain('const log = options.log ?? defaultSqliteLog');
    });

    it('public SQLite membrane exposes transaction capability but no driver/path/open authority', () => {
        const source = readFileSync(PUBLIC_SQLITE, 'utf8');
        expect(source).toContain('runSqliteTransaction');
        for (const forbidden of ['better-sqlite3', 'node:sqlite', 'dbPath', 'createBetterSqlite', 'createNodeSqlite']) {
            expect(source.includes(forbidden), forbidden).toBe(false);
        }
    });

    it('application host is the sole canonical path/bootstrap/dispose owner and revokes provider on teardown', () => {
        const source = readFileSync(APPLICATION_HOST, 'utf8');
        expect(source).toContain('const processEnv = options.env ?? process.env');
        expect(source).toContain('const applicationDbPath = resolveApplicationSqlitePath(');
        expect(source).toContain("defaultWorkspaceRoot ?? resolve(import.meta.dirname, '../../..')");
        expect(source).toContain("id: 'boot.application-infra.sqlite-directory'");
        expect(source).toContain("operations: ['mkdir']");
        expect(source).toContain('createApplicationSqliteRuntime({ dbPath })');
        expect(source).toContain('runtime.database.reset()');
        expect(source).toContain('await sqliteDispose?.()');
        expect(source.indexOf('runtime.database.reset()')).toBeLessThan(source.indexOf('await sqliteDispose?.()'));
    });

    it('driver packages are isolated below infra/database and node:sqlite remains explicitly experimental', () => {
        const better = readFileSync(BETTER_ADAPTER, 'utf8') + readFileSync(BETTER_RUNTIME, 'utf8');
        const experimental = readFileSync(NODE_SQLITE_ADAPTER, 'utf8');
        expect(better).toContain('better-sqlite3');
        expect(experimental).toContain("from 'node:sqlite'");
        expect(experimental).toContain('experimental');
        expect(readFileSync(APPLICATION_HOST, 'utf8')).not.toContain("from 'node:sqlite'");
    });

    it('forbids upward domain dependencies from infra/database', () => {
        const databaseRoot = resolve('src/copilot/infra/database');
        expect(existsSync(resolve(databaseRoot, 'index.js'))).toBe(false);
        expect(existsSync(resolve(databaseRoot, 'transaction/index.js'))).toBe(false);
        const files = [
            resolve(databaseRoot, 'port/contract.js'),
            resolve(databaseRoot, 'provider/service.js'),
            resolve(databaseRoot, 'transaction/atomic/service.js'),
            resolve(databaseRoot, 'transaction/optional/service.js'),
            resolve(databaseRoot, 'transaction/required/service.js'),
            resolve(databaseRoot, 'sqlite/pragmas.js'),
            resolve(databaseRoot, 'sqlite/application/index.js'),
            resolve(databaseRoot, 'sqlite/application/migration-runner.js'),
            resolve(databaseRoot, 'sqlite/application/migrations.js'),
            resolve(databaseRoot, 'sqlite/application/model-gateway-schema/schema.js'),
            BETTER_ADAPTER,
            BETTER_RUNTIME,
            NODE_SQLITE_ADAPTER,
        ];
        for (const file of files) {
            const source = readFileSync(file, 'utf8');
            for (const forbidden of [
                '#copilot/model-gateway',
                '#copilot/mcp',
                '#copilot/tools',
                '#copilot/conversation-hub',
                '#copilot/observability',
            ]) {
                expect(source.includes(forbidden), `${file}: ${forbidden}`).toBe(false);
            }
        }
    });
});
