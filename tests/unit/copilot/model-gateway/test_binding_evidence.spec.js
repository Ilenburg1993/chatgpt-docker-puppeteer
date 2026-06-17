// @ts-check

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { SqliteModelGatewayCatalogStore } from '../../../../src/copilot/model-gateway/catalog/sqlite-catalog-store.js';
import {
    classifyModelGatewayDirectRebindEvidence,
    readModelGatewayDirectRebindEvidence,
} from '../../../../src/copilot/model-gateway/index.js';

/** @type {Database.Database[]} */
const databases = [];

afterEach(() => {
    while (databases.length > 0) databases.pop()?.close();
});

const pair = {
    previousProviderId: 'github-copilot-sdk',
    providerId: 'openrouter',
    bindingStrategy: 'direct',
    wireApi: 'completions',
    selectedRouteKey: 'openrouter:openai/gpt-oss-120b:repo_agent',
};

describe('model gateway direct rebind evidence', () => {
    it('usa a observação significativa mais recente e mantém contagens históricas', () => {
        const evidence = classifyModelGatewayDirectRebindEvidence(
            [
                {
                    ...pair,
                    confirmationId: 'success-old',
                    status: 'route_confirmed_same_session',
                    operationState: 'verified',
                    observedAt: '2026-06-17T10:00:00.000Z',
                },
                {
                    ...pair,
                    confirmationId: 'failure-new',
                    status: 'route_rollback_confirmed_same_session',
                    operationState: 'rolled_back',
                    error: 'SAME_SESSION_ROUTE_SWITCH_NOT_VERIFIED',
                    observedAt: '2026-06-17T11:00:00.000Z',
                },
                {
                    ...pair,
                    providerId: 'groq',
                    confirmationId: 'irrelevant-provider',
                    status: 'route_confirmed_same_session',
                    observedAt: '2026-06-17T12:00:00.000Z',
                },
                {
                    ...pair,
                    wireApi: 'responses',
                    confirmationId: 'irrelevant-wire',
                    status: 'route_confirmed_same_session',
                    observedAt: '2026-06-17T12:00:00.000Z',
                },
            ],
            {
                providerId: 'openrouter',
                previousProviderId: 'github-copilot-sdk',
                wireApi: 'completions',
                now: Date.parse('2026-06-17T12:00:00.000Z'),
            },
        );

        expect(evidence).toMatchObject({
            directRebindReliability: 'unreliable',
            directRebindOk: false,
            sampleSize: 2,
            successCount: 1,
            failureCount: 1,
            latestStatus: 'route_rollback_confirmed_same_session',
            latestOperationState: 'rolled_back',
            latestError: 'SAME_SESSION_ROUTE_SWITCH_NOT_VERIFIED',
        });
    });

    it('permite que uma prova posterior restaure direct como proven', () => {
        const evidence = classifyModelGatewayDirectRebindEvidence(
            [
                {
                    ...pair,
                    status: 'route_switch_failed_same_session',
                    observedAt: '2026-06-17T10:00:00.000Z',
                },
                {
                    ...pair,
                    status: 'route_confirmed_same_session',
                    observedAt: '2026-06-17T11:00:00.000Z',
                },
            ],
            pair,
        );

        expect(evidence).toMatchObject({
            directRebindReliability: 'proven',
            directRebindOk: true,
            sampleSize: 2,
            successCount: 1,
            failureCount: 1,
            latestStatus: 'route_confirmed_same_session',
        });
    });

    it('migra tabela de confirmações legada antes de criar índices v13 e faz backfill relacional', async () => {
        const db = new Database(':memory:');
        databases.push(db);
        db.exec(`
            CREATE TABLE copilot_model_gateway_sdk_session_confirmations (
                confirmation_id  TEXT PRIMARY KEY,
                handoff_id       TEXT,
                decision_id      TEXT,
                session_id       TEXT,
                previous_model   TEXT,
                confirmed_model  TEXT NOT NULL,
                reasoning_effort TEXT,
                status           TEXT NOT NULL,
                observed_at_ms   INTEGER NOT NULL,
                payload_json     TEXT NOT NULL
            ) STRICT;
        `);
        db.prepare(`
            INSERT INTO copilot_model_gateway_sdk_session_confirmations
                (confirmation_id, handoff_id, decision_id, session_id, previous_model, confirmed_model,
                 reasoning_effort, status, observed_at_ms, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            'legacy-confirmation',
            'legacy-handoff',
            null,
            'session-legacy',
            'gpt-5',
            'openai/gpt-oss-120b',
            null,
            'route_confirmed_same_session',
            Date.parse('2026-06-17T09:00:00.000Z'),
            JSON.stringify({
                confirmationId: 'legacy-confirmation',
                previousProviderId: 'github-copilot-sdk',
                providerId: 'openrouter',
                bindingStrategy: 'direct',
                wireApi: 'completions',
                selectedRouteKey: 'openrouter:openai/gpt-oss-120b:repo_agent',
                operationState: 'verified',
                status: 'route_confirmed_same_session',
                observedAt: '2026-06-17T09:00:00.000Z',
            }),
        );

        const store = new SqliteModelGatewayCatalogStore({ db });
        const columns = db
            .prepare(`PRAGMA table_info(copilot_model_gateway_sdk_session_confirmations)`)
            .all()
            .map((row) => /** @type {{ name: string }} */ (row).name);
        const indexes = db
            .prepare(`PRAGMA index_list(copilot_model_gateway_sdk_session_confirmations)`)
            .all()
            .map((row) => /** @type {{ name: string }} */ (row).name);
        const relational = db
            .prepare(`
                SELECT previous_provider_id, provider_id, binding_strategy, wire_api,
                       selected_route_key, operation_state
                FROM copilot_model_gateway_sdk_session_confirmations
                WHERE confirmation_id = ?
            `)
            .get('legacy-confirmation');
        const evidence = await store.readSdkSessionBindingEvidenceRecords({
            providerId: 'openrouter',
            previousProviderId: 'github-copilot-sdk',
            bindingStrategy: 'direct',
            wireApi: 'completions',
            now: Date.parse('2026-06-17T10:00:00.000Z'),
        });

        expect(columns).toEqual(
            expect.arrayContaining([
                'previous_provider_id',
                'provider_id',
                'binding_strategy',
                'wire_api',
                'selected_route_key',
                'operation_state',
            ]),
        );
        expect(indexes).toEqual(
            expect.arrayContaining([
                'idx_mg_sdk_session_confirmations_binding',
                'idx_mg_sdk_session_confirmations_route',
            ]),
        );
        expect(relational).toMatchObject({
            previous_provider_id: 'github-copilot-sdk',
            provider_id: 'openrouter',
            binding_strategy: 'direct',
            wire_api: 'completions',
            selected_route_key: 'openrouter:openai/gpt-oss-120b:repo_agent',
            operation_state: 'verified',
        });
        expect(evidence).toHaveLength(1);
        expect(evidence[0]).toMatchObject({ confirmationId: 'legacy-confirmation' });
    });

    it('materializa e consulta evidência por par de providers e wire API sem scan JSON em memória', async () => {
        const db = new Database(':memory:');
        databases.push(db);
        const store = new SqliteModelGatewayCatalogStore({ db });

        await store.writeSdkSessionConfirmationRecords([
            {
                confirmationId: 'direct-success-old',
                handoffId: 'handoff-success',
                sessionId: 'session-a',
                ...pair,
                previousModel: 'gpt-5',
                confirmedModel: 'openai/gpt-oss-120b',
                operationState: 'verified',
                status: 'route_confirmed_same_session',
                observedAt: '2026-06-17T10:00:00.000Z',
            },
            {
                confirmationId: 'direct-failure-new',
                handoffId: 'handoff-failure',
                sessionId: 'session-a',
                ...pair,
                previousModel: 'gpt-5',
                confirmedModel: 'openai/gpt-oss-120b',
                operationState: 'rolled_back',
                status: 'route_rollback_confirmed_same_session',
                error: 'SAME_SESSION_ROUTE_SWITCH_NOT_VERIFIED',
                observedAt: '2026-06-17T11:00:00.000Z',
            },
            {
                confirmationId: 'responses-success',
                handoffId: 'handoff-responses',
                sessionId: 'session-a',
                ...pair,
                wireApi: 'responses',
                previousModel: 'gpt-5',
                confirmedModel: 'gpt-5.2-codex',
                operationState: 'verified',
                status: 'route_confirmed_same_session',
                observedAt: '2026-06-17T11:30:00.000Z',
            },
        ]);

        const rows = await store.readSdkSessionBindingEvidenceRecords({
            providerId: 'openrouter',
            previousProviderId: 'github-copilot-sdk',
            bindingStrategy: 'direct',
            wireApi: 'completions',
            now: Date.parse('2026-06-17T12:00:00.000Z'),
            limit: 10,
        });
        const evidence = await readModelGatewayDirectRebindEvidence({
            store,
            providerId: 'openrouter',
            previousProviderId: 'github-copilot-sdk',
            wireApi: 'completions',
            now: Date.parse('2026-06-17T12:00:00.000Z'),
        });

        expect(rows.map((row) => row['confirmationId'])).toEqual([
            'direct-failure-new',
            'direct-success-old',
        ]);
        expect(evidence).toMatchObject({
            directRebindReliability: 'unreliable',
            directRebindOk: false,
            sampleSize: 2,
            latestStatus: 'route_rollback_confirmed_same_session',
        });

        const relational = db
            .prepare(`
                SELECT previous_provider_id, provider_id, binding_strategy, wire_api,
                       selected_route_key, operation_state, status
                FROM copilot_model_gateway_sdk_session_confirmations
                WHERE confirmation_id = ?
            `)
            .get('direct-failure-new');
        expect(relational).toMatchObject({
            previous_provider_id: 'github-copilot-sdk',
            provider_id: 'openrouter',
            binding_strategy: 'direct',
            wire_api: 'completions',
            selected_route_key: 'openrouter:openai/gpt-oss-120b:repo_agent',
            operation_state: 'rolled_back',
            status: 'route_rollback_confirmed_same_session',
        });
    });
});
