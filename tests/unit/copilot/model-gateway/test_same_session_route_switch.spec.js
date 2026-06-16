// @ts-check

import { describe, expect, it } from 'vitest';

import {
    createModelGatewaySameSessionRouteSwitchOperationId,
    executeModelGatewayRuntimeRouteSwitch,
    SqliteModelGatewayCatalogStore,
} from '../../../../src/copilot/model-gateway/index.js';

describe('model gateway same-session route switch', () => {
    it('adia reattach durante turno ativo sem chamar a camada de reconnect', async () => {
        const { default: Database } = await import('better-sqlite3');
        const db = new Database(':memory:');
        try {
            const store = new SqliteModelGatewayCatalogStore({ db });
            const idempotencyKey = 'route-switch-deferred-20260616';
            let reattachCalled = false;

            const operation = await executeModelGatewayRuntimeRouteSwitch({
                sessionId: 'sdk-session-1',
                previousRoute: {
                    providerId: 'kilo-code',
                    providerModel: 'nex-agi/nex-n2-pro:free',
                },
                targetRoute: {
                    providerId: 'ollama-cloud',
                    providerModel: 'qwen3-coder-next',
                    selectedRouteKey: 'test-route',
                    routeProfile: 'repo_agent',
                },
                idempotencyKey,
                timeoutMs: 5_000,
                store,
                source: 'test.same-session-route-switch',
                deferReason: 'ACTIVE_DIALOG_LOOP_ROUTE_REATTACH_DEFERRED',
                deferDetails: { dialogLoopActive: true },
                reattach: async () => {
                    reattachCalled = true;
                    throw new Error('reattach should not be called while deferred');
                },
                verify: async () => true,
                commit: async () => {},
            });

            expect(operation.state).toBe('deferred_until_turn_boundary');
            expect(operation.deferred).toBe(true);
            expect(operation.deferReason).toBe('ACTIVE_DIALOG_LOOP_ROUTE_REATTACH_DEFERRED');
            expect(operation.reconciliationRequired).toBe(false);
            expect(operation.rollback).toEqual({
                attempted: false,
                reason: 'target_route_not_applied',
            });
            expect(operation.transitions.map((transition) => transition.state)).toEqual([
                'planned',
                'deferred_until_turn_boundary',
            ]);
            expect(reattachCalled).toBe(false);

            const stored = await store.readSdkSessionHandoffRecord(
                createModelGatewaySameSessionRouteSwitchOperationId(idempotencyKey),
            );
            expect(stored?.operation?.state).toBe('deferred_until_turn_boundary');
            expect(stored?.operation?.deferDetails).toEqual({ dialogLoopActive: true });
        } finally {
            db.close();
        }
    });

    it('não reaproveita committed idempotente de outra sessão SDK', async () => {
        const { default: Database } = await import('better-sqlite3');
        const db = new Database(':memory:');
        try {
            const store = new SqliteModelGatewayCatalogStore({ db });
            const idempotencyKey = 'route-switch-session-scoped-20260616';
            const targetRoute = {
                providerId: 'ollama-cloud',
                providerModel: 'qwen3-coder-next',
                selectorSyntax: 'qwen3-coder-next',
                baseUrl: 'https://ollama.com/v1',
                openAICompatibleBaseUrl: 'https://ollama.com/v1',
                wireApi: 'completions',
                providerProfile: 'ollama-cloud',
                routeProfile: 'repo_agent',
                selectedRouteKey: 'test-route',
            };

            const first = await executeModelGatewayRuntimeRouteSwitch({
                sessionId: 'old-sdk-session',
                previousRoute: { providerId: 'kilo-code', providerModel: 'kilo-auto/free' },
                targetRoute,
                idempotencyKey,
                timeoutMs: 5_000,
                store,
                source: 'test.same-session-route-switch',
                reattach: async () => ({
                    sessionId: 'old-sdk-session',
                }),
                verify: async () => true,
                commit: async () => {},
            });
            expect(first.state).toBe('committed');

            let reattachCalled = false;
            const second = await executeModelGatewayRuntimeRouteSwitch({
                sessionId: 'current-sdk-session',
                previousRoute: { providerId: 'kilo-code', providerModel: 'kilo-auto/free' },
                targetRoute,
                idempotencyKey,
                timeoutMs: 5_000,
                store,
                source: 'test.same-session-route-switch',
                deferReason: 'ACTIVE_DIALOG_LOOP_ROUTE_REATTACH_DEFERRED',
                deferDetails: { dialogLoopActive: true },
                reattach: async () => {
                    reattachCalled = true;
                    throw new Error('reattach should not be called while deferred');
                },
                verify: async () => true,
                commit: async () => {},
            });

            expect(second.state).toBe('deferred_until_turn_boundary');
            expect(second.replayed).toBeUndefined();
            expect(second.sessionId).toBe('current-sdk-session');
            expect(reattachCalled).toBe(false);

            const stored = await store.readSdkSessionHandoffRecord(
                createModelGatewaySameSessionRouteSwitchOperationId(idempotencyKey),
            );
            expect(stored?.operation?.state).toBe('deferred_until_turn_boundary');
            expect(stored?.operation?.sessionId).toBe('current-sdk-session');
        } finally {
            db.close();
        }
    });

    it('promove operação diferida para committed quando a borda pede conclusão explícita', async () => {
        const { default: Database } = await import('better-sqlite3');
        const db = new Database(':memory:');
        try {
            const store = new SqliteModelGatewayCatalogStore({ db });
            const idempotencyKey = 'route-switch-force-deferred-20260616';
            const targetRoute = {
                providerId: 'ollama-cloud',
                providerModel: 'qwen3-coder-next',
                selectedRouteKey: 'test-route',
                routeProfile: 'repo_agent',
            };

            const deferred = await executeModelGatewayRuntimeRouteSwitch({
                sessionId: 'sdk-session-1',
                previousRoute: { providerId: 'kilo-code', providerModel: 'kilo-auto/free' },
                targetRoute,
                idempotencyKey,
                timeoutMs: 5_000,
                store,
                source: 'test.same-session-route-switch',
                deferReason: 'ACTIVE_DIALOG_LOOP_ROUTE_REATTACH_DEFERRED',
                deferDetails: { dialogLoopActive: true },
                reattach: async () => {
                    throw new Error('reattach should not be called while deferred');
                },
                verify: async () => true,
                commit: async () => {},
            });
            expect(deferred.state).toBe('deferred_until_turn_boundary');

            let reattachCalled = false;
            let committedRoute = null;
            const committed = await executeModelGatewayRuntimeRouteSwitch({
                sessionId: 'sdk-session-1',
                previousRoute: { providerId: 'kilo-code', providerModel: 'kilo-auto/free' },
                targetRoute,
                idempotencyKey,
                timeoutMs: 5_000,
                store,
                source: 'test.same-session-route-switch',
                forceApplyDeferred: true,
                reattach: async (route) => {
                    reattachCalled = true;
                    return { sessionId: 'sdk-session-1', route };
                },
                verify: async (session, route) => {
                    committedRoute = route;
                    return session?.sessionId === 'sdk-session-1';
                },
                commit: async () => {},
            });

            expect(committed.state).toBe('committed');
            expect(committed.replayed).toBeUndefined();
            expect(committed.sessionId).toBe('sdk-session-1');
            expect(reattachCalled).toBe(true);
            expect(committedRoute).toMatchObject(targetRoute);
            expect(committed.transitions.map((transition) => transition.state)).toEqual([
                'planned',
                'reattach_requested',
                'reattached',
                'verified',
                'committed',
            ]);

            const stored = await store.readSdkSessionHandoffRecord(
                createModelGatewaySameSessionRouteSwitchOperationId(idempotencyKey),
            );
            expect(stored?.operation?.state).toBe('committed');
            expect(stored?.operation?.sessionId).toBe('sdk-session-1');
        } finally {
            db.close();
        }
    });
});
