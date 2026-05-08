import assert from 'node:assert/strict';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import express from 'express';
import request from 'supertest';

const workspaceRouteMocks = vi.hoisted(() => {
    const emitSdkOperationMetric = vi.fn();
    const createHandler = vi.fn(async (args) => ({
        success: true,
        path: String(args.path ?? ''),
        io: { operation: 'write', engine: 'io-engine.atomic-write' },
    }));
    const writeHandler = vi.fn(async (args) => ({
        success: true,
        path: String(args.path ?? ''),
        io: { operation: 'write', engine: 'io-engine.atomic-write' },
    }));
    const readHandler = vi.fn(async (args) => ({
        success: true,
        path: String(args.path ?? ''),
        content: `LOCAL:${String(args.path ?? '')}`,
        io: { operation: 'read', engine: 'io-engine.fs.readFile.text' },
    }));

    const routeDeps = {
        allTools: [
            { name: 'read_file_content', handler: readHandler },
            { name: 'create_file', handler: createHandler },
            { name: 'write_file_content', handler: writeHandler },
        ],
        sdkSession: {
            getClientSession: vi.fn(() => ({ session: { id: 'sdk-1' } })),
        },
        sdkRuntimeSession: {
            resolveAgentSdkActiveSessionEntry: vi.fn(() => null),
        },
        sdkSessionRpc: {
            workspaceReadFile: vi.fn(async (_session, path) => ({ path, content: `SDK:${path}` })),
            workspaceListFiles: vi.fn(async () => ({ files: ['notes/one.md', 'notes/two.md'] })),
            workspaceCreateFile: vi.fn(async (_session, path, content) => ({ success: true, path, content })),
        },
        sdkRuntimeProjection: {
            buildRuntimeRouteMetaPayload: vi.fn(() => ({ runtimeId: 'default', runtimeFound: true })),
        },
        sdkSessionOwnership: {
            attachSdkSessionOwnership: vi.fn((payload) => payload),
        },
        sdkTelemetry: {
            emitOperationMetric: emitSdkOperationMetric,
        },
        requestedRuntimeId: null,
        runtimeId: 'default',
    };

    return {
        emitSdkOperationMetric,
        createHandler,
        readHandler,
        writeHandler,
        routeDeps,
        resolveSdkRouteSharedDeps: vi.fn(() => routeDeps),
    };
});

vi.mock('#copilot/sdk', async (importOriginal) => {
    const actual = /** @type {Record<string, unknown>} */ (await importOriginal());
    return {
        ...actual,
        emitSdkOperationMetric: workspaceRouteMocks.emitSdkOperationMetric,
    };
});

vi.mock('../../../src/copilot/server/routes/sdk/deps.js', () => ({
    resolveSdkRouteSharedDeps: workspaceRouteMocks.resolveSdkRouteSharedDeps,
}));

import { registerSessionWorkspaceRoutes } from '../../../src/copilot/server/routes/sdk/session-workspace-routes.js';

/**
 * @returns {import('express').Express}
 */
function createApp() {
    const app = express();
    app.use(express.json());
    const router = express.Router();
    registerSessionWorkspaceRoutes(router);
    app.use('/', router);
    return app;
}

describe('sdk session workspace routes — materialize', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('materializa arquivo SDK para FS local via create_file quando overwrite=false', async () => {
        const res = await request(createApp())
            .post('/sessions/sdk-1/workspace/materialize')
            .send({ path: 'notes/plan.md', destinationPath: 'tmp/plan.md' })
            .expect(200);

        expect(workspaceRouteMocks.routeDeps.sdkSessionRpc.workspaceReadFile).toHaveBeenCalledWith(
            expect.any(Object),
            'notes/plan.md',
        );
        expect(workspaceRouteMocks.createHandler).toHaveBeenCalledWith(
            expect.objectContaining({
                path: 'tmp/plan.md',
                content: 'SDK:notes/plan.md',
                overwrite: false,
                createParentDirs: true,
            }),
        );
        expect(workspaceRouteMocks.writeHandler).not.toHaveBeenCalled();
        assert.equal(res.body.ok, true);
        assert.equal(res.body.result.localPath, 'tmp/plan.md');
        assert.equal(res.body.result.overwrite, false);
        assert.equal(typeof res.body.result.traceId, 'string');
        assert.ok(res.body.result.traceId.length > 10);
        expect(workspaceRouteMocks.emitSdkOperationMetric).toHaveBeenCalled();
    });

    it('materializa arquivo SDK para FS local via write_file_content quando overwrite=true', async () => {
        const res = await request(createApp())
            .post('/sessions/sdk-1/workspace/materialize')
            .send({ path: 'notes/plan.md', overwrite: true })
            .expect(200);

        expect(workspaceRouteMocks.writeHandler).toHaveBeenCalledWith(
            expect.objectContaining({
                path: 'notes/plan.md',
                content: 'SDK:notes/plan.md',
                encoding: 'utf8',
            }),
        );
        assert.equal(res.body.ok, true);
        assert.equal(res.body.result.localPath, 'notes/plan.md');
        assert.equal(res.body.result.overwrite, true);
        assert.equal(typeof res.body.result.traceId, 'string');
    });

    it('rejeita path SDK inválido com 400', async () => {
        const res = await request(createApp())
            .post('/sessions/sdk-1/workspace/materialize')
            .send({ path: '../escape.md' })
            .expect(400);

        assert.equal(res.body.ok, false);
        expect(String(res.body.error)).toMatch(/workspace SDK/);
        expect(workspaceRouteMocks.createHandler).not.toHaveBeenCalled();
        expect(workspaceRouteMocks.writeHandler).not.toHaveBeenCalled();
    });

    it('espelha workspace SDK para FS local via endpoint mirror', async () => {
        workspaceRouteMocks.routeDeps.sdkSessionRpc.workspaceListFiles.mockResolvedValueOnce({
            files: ['notes/one.md', 'notes/two.md'],
        });

        const res = await request(createApp())
            .post('/sessions/sdk-1/workspace/mirror')
            .send({ destinationRoot: 'tmp/sdk-mirror', overwrite: false })
            .expect(200);

        expect(workspaceRouteMocks.routeDeps.sdkSessionRpc.workspaceListFiles).toHaveBeenCalled();
        expect(workspaceRouteMocks.createHandler).toHaveBeenCalledTimes(2);
        assert.equal(res.body.ok, true);
        assert.equal(res.body.result.summary.ok, 2);
        assert.equal(res.body.result.summary.failed, 0);
        assert.equal(res.body.result.summary.skipped, 0);
        expect(res.body.result.items[0]).toMatchObject({
            sdkPath: 'notes/one.md',
            localPath: 'tmp/sdk-mirror/notes/one.md',
            status: 'ok',
        });
        assert.equal(typeof res.body.result.items[0].traceId, 'string');
        expect(workspaceRouteMocks.emitSdkOperationMetric).toHaveBeenCalled();
    });

    it('pagina mirror HTTP quando pageSize/cursor são fornecidos sem impor teto default', async () => {
        workspaceRouteMocks.routeDeps.sdkSessionRpc.workspaceListFiles.mockResolvedValueOnce({
            files: ['notes/one.md', 'notes/two.md', 'notes/three.md'],
        });

        const res = await request(createApp())
            .post('/sessions/sdk-1/workspace/mirror')
            .send({ destinationRoot: 'tmp/sdk-mirror-page', pageSize: 1, cursor: '1', maxFiles: 99 })
            .expect(200);

        expect(workspaceRouteMocks.createHandler).toHaveBeenCalledTimes(1);
        expect(workspaceRouteMocks.createHandler).toHaveBeenCalledWith(
            expect.objectContaining({ path: 'tmp/sdk-mirror-page/notes/two.md' }),
        );
        assert.equal(res.body.result.pagination.enabled, true);
        assert.equal(res.body.result.pagination.totalFiles, 3);
        assert.equal(res.body.result.pagination.returnedFiles, 1);
        assert.equal(res.body.result.pagination.offset, 1);
        assert.equal(res.body.result.pagination.nextCursor, '2');
        assert.equal(res.body.result.pagination.advisoryMaxFiles, 99);
    });

    it('rejeita cursor de mirror sem pageSize explícito', async () => {
        const res = await request(createApp())
            .post('/sessions/sdk-1/workspace/mirror')
            .send({ destinationRoot: 'tmp/sdk-mirror-page', cursor: '1' })
            .expect(400);

        assert.equal(res.body.ok, false);
        assert.equal(res.body.code, 'INVALID_CURSOR');
    });

    it('marca item como skipped quando conteúdo SDK não é textual no mirror', async () => {
        workspaceRouteMocks.routeDeps.sdkSessionRpc.workspaceListFiles.mockResolvedValueOnce({
            files: ['notes/text.md', 'notes/bin.dat'],
        });
        workspaceRouteMocks.routeDeps.sdkSessionRpc.workspaceReadFile.mockImplementationOnce(
            async (_session, path) => ({
                path,
                content: 'SDK:notes/text.md',
            }),
        );
        workspaceRouteMocks.routeDeps.sdkSessionRpc.workspaceReadFile.mockImplementationOnce(
            async (_session, path) => /** @type {any} */ ({ path, content: null }),
        );

        const res = await request(createApp())
            .post('/sessions/sdk-1/workspace/mirror')
            .send({ destinationRoot: 'tmp/sdk-mirror-2' })
            .expect(200);

        assert.equal(res.body.ok, true);
        assert.equal(res.body.result.summary.ok, 1);
        assert.equal(res.body.result.summary.skipped, 1);
        expect(res.body.result.items[1]).toMatchObject({
            sdkPath: 'notes/bin.dat',
            status: 'skipped',
            reason: 'non-textual-content',
        });
        assert.equal(typeof res.body.result.items[0].traceId, 'string');
        assert.equal(typeof res.body.result.items[1].traceId, 'string');
    });

    it('promove arquivo local para workspace SDK quando destino não existe', async () => {
        workspaceRouteMocks.routeDeps.sdkSessionRpc.workspaceReadFile.mockRejectedValueOnce(
            new Error('ENOENT: no such file'),
        );

        const res = await request(createApp())
            .post('/sessions/sdk-1/workspace/promote')
            .send({ sourcePath: 'tmp/local-plan.md', destinationPath: 'notes/promoted.md' })
            .expect(200);

        expect(workspaceRouteMocks.readHandler).toHaveBeenCalledWith(
            expect.objectContaining({ path: 'tmp/local-plan.md', encoding: 'utf8' }),
        );
        expect(workspaceRouteMocks.routeDeps.sdkSessionRpc.workspaceCreateFile).toHaveBeenCalledWith(
            expect.any(Object),
            'notes/promoted.md',
            'LOCAL:tmp/local-plan.md',
        );
        assert.equal(res.body.ok, true);
        assert.equal(res.body.result.audit.action, 'created');
        assert.equal(res.body.result.audit.checked, true);
        assert.equal(res.body.result.audit.requested, 'fail-if-exists');
        assert.equal(typeof res.body.result.traceId, 'string');
        expect(workspaceRouteMocks.emitSdkOperationMetric).toHaveBeenCalledWith(
            expect.objectContaining({
                operation: 'workspace.promote',
                status: 'succeeded',
                attributes: expect.objectContaining({ phase: 'write_sdk' }),
            }),
        );
    });

    it('bloqueia promoção local para SDK quando destino existe e overwrite=false', async () => {
        workspaceRouteMocks.routeDeps.sdkSessionRpc.workspaceReadFile.mockResolvedValueOnce({
            path: 'notes/existing.md',
            content: 'already-there',
        });

        const res = await request(createApp())
            .post('/sessions/sdk-1/workspace/promote')
            .send({ sourcePath: 'tmp/local-plan.md', destinationPath: 'notes/existing.md' })
            .expect(409);

        assert.equal(res.body.ok, false);
        assert.equal(res.body.code, 'SDK_DESTINATION_CONFLICT');
        assert.equal(res.body.result.audit.action, 'conflict');
        assert.equal(res.body.result.audit.reason, 'destination-exists');
        expect(workspaceRouteMocks.routeDeps.sdkSessionRpc.workspaceCreateFile).not.toHaveBeenCalled();
    });

    it('promove arquivo local para SDK com auditoria de overwrite explícita', async () => {
        const res = await request(createApp())
            .post('/sessions/sdk-1/workspace/promote')
            .send({ sourcePath: 'tmp/local-plan.md', destinationPath: 'notes/overwritten.md', overwrite: true })
            .expect(200);

        expect(workspaceRouteMocks.routeDeps.sdkSessionRpc.workspaceReadFile).not.toHaveBeenCalled();
        expect(workspaceRouteMocks.routeDeps.sdkSessionRpc.workspaceCreateFile).toHaveBeenCalledWith(
            expect.any(Object),
            'notes/overwritten.md',
            'LOCAL:tmp/local-plan.md',
        );
        assert.equal(res.body.ok, true);
        assert.equal(res.body.result.audit.action, 'overwritten');
        assert.equal(res.body.result.audit.checked, false);
        assert.equal(res.body.result.audit.requested, 'overwrite');
    });
});
