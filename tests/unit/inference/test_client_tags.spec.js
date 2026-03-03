// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    INFERENCE_CLIENT_TAGS,
    isInferenceClientTag,
    listInferenceClientTags,
    normalizeInferenceClientTag,
    requireInferenceClientTag,
} from '../../../src/inference_gateway/client_tags.js';

test('listInferenceClientTags returns canonical set including audit and rag tags', () => {
    const tags = listInferenceClientTags();
    assert.ok(tags.includes(INFERENCE_CLIENT_TAGS.AUDIT_AGENT_PATCH));
    assert.ok(tags.includes(INFERENCE_CLIENT_TAGS.RAG_EMBED));
    assert.ok(tags.includes(INFERENCE_CLIENT_TAGS.MCP_OLLAMA_GENERATE));
});

test('normalizeInferenceClientTag normalizes valid values and falls back to generic', () => {
    assert.equal(normalizeInferenceClientTag('  AUDIT_AGENT_TRIAGE '), INFERENCE_CLIENT_TAGS.AUDIT_AGENT_TRIAGE);
    assert.equal(normalizeInferenceClientTag('unknown-tag'), INFERENCE_CLIENT_TAGS.FALLBACK_GENERIC);
});

test('requireInferenceClientTag rejects invalid values', () => {
    assert.equal(isInferenceClientTag('audit_agent_patch'), true);
    assert.equal(isInferenceClientTag('invalid'), false);
    assert.throws(() => requireInferenceClientTag('invalid'), /clientTag inválido/);
});
