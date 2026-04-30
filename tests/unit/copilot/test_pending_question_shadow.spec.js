// @ts-check

import * as assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
    createPendingQuestionShadow,
    getPendingQuestionShadowAgeMs,
    getPendingQuestionShadowExpiresAt,
    getPendingQuestionShadowExpiringSoonThresholdMs,
    getPendingQuestionShadowRemainingMs,
    getPendingQuestionShadowState,
    getPendingQuestionShadowTtlMs,
    isPendingQuestionShadowExpired,
} from '../../../src/copilot/agent/dialog/state/pending-question-shadow.js';

describe('pending-question-shadow helpers', () => {
    it('cria shadow com restoredAt/expiresAt derivados', () => {
        const shadow = createPendingQuestionShadow(
            'READY: aguardando próxima mensagem',
            {
                kind: 'ready',
                askedAt: 1_000,
                allowFreeform: true,
                protocolControlled: true,
            },
            { now: 5_000, ttlMs: 60_000 },
        );

        assert.equal(shadow.restoredAt, 5_000);
        assert.equal(shadow.expiresAt, 61_000);
        assert.equal(getPendingQuestionShadowExpiresAt(shadow), 61_000);
    });

    it('normaliza askedAt/expiresAt inválidos restaurados de estado antigo', () => {
        const shadow = createPendingQuestionShadow(
            'READY: aguardando próxima mensagem',
            {
                kind: 'ready',
                askedAt: 0,
                allowFreeform: true,
                protocolControlled: true,
            },
            { now: 5_000, ttlMs: 60_000 },
        );

        assert.equal(shadow.meta.askedAt, 5_000);
        assert.equal(shadow.expiresAt, 65_000);
        assert.equal(
            getPendingQuestionShadowExpiresAt({ ...shadow, expiresAt: 0 }),
            5_000 + getPendingQuestionShadowTtlMs('ready'),
        );
    });

    it('calcula idade e expiração corretamente', () => {
        const shadow = createPendingQuestionShadow(
            'READY: aguardando próxima mensagem',
            {
                kind: 'ready',
                askedAt: 1_000,
                allowFreeform: true,
                protocolControlled: true,
            },
            { now: 2_000, ttlMs: 10_000 },
        );

        assert.equal(getPendingQuestionShadowAgeMs(shadow, 8_000), 7_000);
        assert.equal(isPendingQuestionShadowExpired(shadow, { now: 10_999, ttlMs: 10_000 }), false);
        assert.equal(isPendingQuestionShadowExpired(shadow, { now: 11_000, ttlMs: 10_000 }), true);
    });

    it('expõe TTL canônico positivo', () => {
        assert.ok(getPendingQuestionShadowTtlMs() > 0);
        assert.ok(getPendingQuestionShadowTtlMs('ready') > 0);
        assert.ok(getPendingQuestionShadowTtlMs('question') >= getPendingQuestionShadowTtlMs('ready'));
    });

    it('usa TTL semântico por kind quando ttl explícito não é informado', () => {
        const readyShadow = createPendingQuestionShadow(
            'READY: aguardando próxima mensagem',
            {
                kind: 'ready',
                askedAt: 1_000,
                allowFreeform: true,
                protocolControlled: true,
            },
            { now: 2_000 },
        );
        const questionShadow = createPendingQuestionShadow(
            'Qual o próximo passo?',
            {
                kind: 'question',
                askedAt: 1_000,
                allowFreeform: true,
                protocolControlled: false,
            },
            { now: 2_000 },
        );

        assert.ok(readyShadow.expiresAt <= questionShadow.expiresAt);
        assert.equal(getPendingQuestionShadowExpiresAt(readyShadow), 1_000 + getPendingQuestionShadowTtlMs('ready'));
        assert.equal(
            getPendingQuestionShadowExpiresAt(questionShadow),
            1_000 + getPendingQuestionShadowTtlMs('question'),
        );
    });

    it('classifica estados fresh, expiring_soon e expired', () => {
        const shadow = createPendingQuestionShadow(
            'Qual o próximo passo?',
            {
                kind: 'question',
                askedAt: 10_000,
                allowFreeform: true,
                protocolControlled: false,
            },
            { now: 10_100 },
        );

        assert.equal(getPendingQuestionShadowState(shadow, { now: 10_200 }), 'fresh');

        const expiresAt = getPendingQuestionShadowExpiresAt(shadow);
        const expiringSoonAt = expiresAt - getPendingQuestionShadowExpiringSoonThresholdMs('question') + 1000;
        assert.equal(getPendingQuestionShadowState(shadow, { now: expiringSoonAt }), 'expiring_soon');
        assert.equal(getPendingQuestionShadowState(shadow, { now: expiresAt + 1 }), 'expired');
        assert.ok(getPendingQuestionShadowRemainingMs(shadow, expiresAt - 5000) >= 4000);
    });
});
