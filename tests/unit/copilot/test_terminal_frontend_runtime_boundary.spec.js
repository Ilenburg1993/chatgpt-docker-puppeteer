// @ts-check

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const SRC = readFileSync(new URL('../../../src/copilot/terminal/frontend/llm-b-frontend.js', import.meta.url), 'utf8');

test('llm-b-frontend depende do gateway runtime em vez de agent/channel/hub/core diretos', () => {
    assert.match(SRC, /from '\.\/llm-b-runtime\.js'/);
    assert.doesNotMatch(SRC, /from '#copilot\/agent'/);
    assert.doesNotMatch(SRC, /from '#copilot\/channel'/);
    assert.doesNotMatch(SRC, /from '#copilot\/conversation-hub'/);
    assert.doesNotMatch(SRC, /from '#copilot\/core'/);
});
