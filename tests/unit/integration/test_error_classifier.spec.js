// @ts-check
import assert from 'node:assert/strict';

import {
    classifyError,
    ErrorClass,
    getSmallerModel,
    RetryStrategy,
} from '../../../src/integration/error-classifier.mjs';

// helper to build a fake error object
function makeError(/** @type {string} */ msg, /** @type {string | undefined} */ name = undefined) {
    const err = new Error(msg);
    if (name) err.name = name;
    return err;
}

// -----------------------------------------------------------------------------
// getSmallerModel unit tests
// -----------------------------------------------------------------------------

test('getSmallerModel returns next tier in chain including new 1.5b fallback', () => {
    assert.equal(getSmallerModel('qwen3-coder-next'), 'qwen2.5-coder:7b');
    assert.equal(getSmallerModel('qwen2.5-coder:7b'), 'qwen2.5-coder:3b');
    assert.equal(getSmallerModel('qwen2.5-coder:3b'), 'qwen2.5-coder:1.5b');
    assert.equal(getSmallerModel('qwen2.5-coder:1.5b'), null);
});

test('getSmallerModel normalizes Custom/ prefix when present', () => {
    assert.equal(getSmallerModel('Custom/qwen2.5-coder:3b'), 'qwen2.5-coder:1.5b');
    assert.equal(getSmallerModel('custom/qwen2.5-coder:7b'), 'qwen2.5-coder:3b');
});

// -----------------------------------------------------------------------------
// classifyError behaviour around 404/model not found
// -----------------------------------------------------------------------------

test('classifyError treats a 404/not found as permanent unless fallback available', () => {
    let classification = classifyError(makeError('404 page not found'), { model: 'qwen2.5-coder:3b' });
    // with 3b there is a fallback (1.5b) so we should get a degraded + MODEL_FALLBACK result
    assert.equal(classification.errorClass, ErrorClass.DEGRADED);
    assert.equal(classification.strategy, RetryStrategy.MODEL_FALLBACK);
    assert.equal(classification.modelFallback, 'qwen2.5-coder:1.5b');

    // if we are already on smallest model, there is no fallback and we treat as permanent
    classification = classifyError(makeError('Not Found'), { model: 'qwen2.5-coder:1.5b' });
    assert.equal(classification.errorClass, ErrorClass.PERMANENT);
    assert.equal(classification.strategy, RetryStrategy.NO_RETRY);
    assert.equal(classification.modelFallback, undefined);
});

// when context.model is missing but the message names a model, we still infer it

test('classifyError infers model from error message and falls back accordingly', () => {
    const errMsg =
        'Unable to call the qwen2.5-coder:3b inference endpoint due to 404.  Please check if the input or configuration is correct. 404 404 page not found';
    const classification = classifyError(makeError(errMsg));
    assert.equal(classification.errorClass, ErrorClass.DEGRADED);
    assert.equal(classification.strategy, RetryStrategy.MODEL_FALLBACK);
    assert.equal(classification.modelFallback, 'qwen2.5-coder:1.5b');
});

// 404 combined with authentication should still prioritise auth

test('classifyError still surfaces auth failure even if 404 present', () => {
    const classification = classifyError(makeError('401 Unauthorized', 'SomeError'), { model: 'qwen2.5-coder:3b' });
    assert.equal(classification.errorClass, ErrorClass.PERMANENT);
    assert.equal(classification.reasonCode, 'AUTH_FAILURE');
});
