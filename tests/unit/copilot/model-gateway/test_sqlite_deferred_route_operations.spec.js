// @ts-check

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteModelGatewayCatalogStore } from '../../../../src/copilot/model-gateway/catalog/sqlite-catalog-store.js';

/** @type {Database.Database[]} */
const databases = [];

afterEach(() => {
    while (databases.length > 0) databases.pop()?.close();
});

function deferredHandoff() {
    return {
        handoffId: 'same-session-route-switch:sqlite-test',
        routeProfile: 'repo_agent',
        selectedRouteKey: 'ollama-cloud:qwen3-coder-next:repo_agent',
        status: 'deferred_until_turn_boundary',
        sessionId: 'session-a',
        targetModel: 'qwen3-coder-next',
        requestedAt: '2026-06-16T12:00:00.000Z',
        operation: {
            schemaVersion: 'model-gateway.same-session-route-switch.v1',
            operationId: 'same-session-route-switch:sqlite-test',
            idempotencyKey: 'sqlite-deferred-route-key',
            sessionId: 'session-a',
            state: 'deferred_until_turn_boundary',
            requiresNewSession: false,
            retryable: true,
            deferReason: 'ACTIVE_DIALOG_LOOP_ROUTE_REATTACH_DEFERRED',
            createdAt: '2026-06-16T12:00:00.000Z',
            promotionAuthorization: {
                authorized: true,
                policy: 'authorized_after_turn_boundary',
                source: 'confirmed_model_gateway_route_switch_apply',
                expiresAt: '2026-06-16T12:10:00.000Z',
            },
            targetRoute: {
                providerId: 'ollama-cloud',
                providerModel: 'qwen3-coder-next',
                selectedRouteKey: 'ollama-cloud:qwen3-coder-next:repo_agent',
            },
            transitions: [
                { state: 'planned', timestamp: '2026-06-16T12:00:00.000Z' },
                {
                    state: 'deferred_until_turn_boundary',
                    timestamp: '2026-06-16T12:00:00.001Z',
                    deferReason: 'ACTIVE_DIALOG_LOOP_ROUTE_REATTACH_DEFERRED',
                },
            ],
        },
    };
}

describe('SqliteModelGatewayCatalogStore deferred route operations', () => {
    it('consulta operação diferida por sessão e materializa ledger relacional de transições', async () => {
        const db = new Database(':memory:');
        databases.push(db);
        const store = new SqliteModelGatewayCatalogStore({ db });

        await store.writeSdkSessionHandoffRecords([deferredHandoff()]);

        const sameSession = await store.readDeferredSdkSessionHandoffRecords({
            sessionId: 'session-a',
            now: Date.parse('2026-06-16T12:01:00.000Z'),
            includeExpired: true,
            limit: 10,
        });
        const otherSession = await store.readDeferredSdkSessionHandoffRecords({
            sessionId: 'session-b',
            now: Date.parse('2026-06-16T12:01:00.000Z'),
            includeExpired: true,
            limit: 10,
        });
        const transitions = await store.readSdkSessionHandoffTransitionRecords('same-session-route-switch:sqlite-test');

        expect(sameSession).toHaveLength(1);
        expect(otherSession).toHaveLength(0);
        expect(transitions.map((entry) => entry['state'])).toEqual(['planned', 'deferred_until_turn_boundary']);

        const relational = db
            .prepare(
                `
                SELECT operation_kind, idempotency_key, provider_id, provider_model, defer_reason,
                       promotion_policy, promotion_authorized, expires_at_ms
                FROM copilot_model_gateway_sdk_session_handoffs
                WHERE handoff_id = ?
            `,
            )
            .get('same-session-route-switch:sqlite-test');
        expect(relational).toMatchObject({
            operation_kind: 'model-gateway.same-session-route-switch.v1',
            idempotency_key: 'sqlite-deferred-route-key',
            provider_id: 'ollama-cloud',
            provider_model: 'qwen3-coder-next',
            defer_reason: 'ACTIVE_DIALOG_LOOP_ROUTE_REATTACH_DEFERRED',
            promotion_policy: 'authorized_after_turn_boundary',
            promotion_authorized: 1,
            expires_at_ms: Date.parse('2026-06-16T12:10:00.000Z'),
        });
    });

    it('filtra operações expiradas quando solicitado sem desserializar todo o ledger', async () => {
        const db = new Database(':memory:');
        databases.push(db);
        const store = new SqliteModelGatewayCatalogStore({ db });
        await store.writeSdkSessionHandoffRecords([deferredHandoff()]);

        const rows = await store.readDeferredSdkSessionHandoffRecords({
            sessionId: 'session-a',
            now: Date.parse('2026-06-16T12:11:00.000Z'),
            includeExpired: false,
            limit: 10,
        });

        expect(rows).toEqual([]);
    });
});
