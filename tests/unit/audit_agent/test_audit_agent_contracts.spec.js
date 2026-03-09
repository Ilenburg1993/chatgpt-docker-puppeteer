// @ts-check
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    AUDIT_JOB_KIND,
    AUDIT_JOB_STATUS,
    AUDIT_JOB_TRIGGER_TYPE,
    isAuditJobKind,
    isAuditJobStatus,
    isAuditJobTriggerType,
} from '../../../src/audit_agent/contracts.js';

test('audit job contracts expose canonical statuses/kinds/triggers', () => {
    assert.equal(AUDIT_JOB_STATUS.WAITING_APPROVAL, 'WAITING_APPROVAL');
    assert.equal(AUDIT_JOB_KIND.PATCH_SUGGEST, 'patch_suggest');
    assert.equal(AUDIT_JOB_TRIGGER_TYPE.RUNTIME_EVENT, 'runtime_event');
});

test('validators accept only canonical values', () => {
    assert.equal(isAuditJobStatus('RUNNING'), true);
    assert.equal(isAuditJobStatus('running'), false);
    assert.equal(isAuditJobKind('quick_audit'), true);
    assert.equal(isAuditJobTriggerType('api'), true);
    assert.equal(isAuditJobTriggerType('other'), false);
});
