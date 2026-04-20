// @ts-check

import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const SRC = readFileSync('/workspaces/chatgpt-docker-puppeteer/src/copilot/terminal/frontend/llm-b-frontend.js', 'utf8');

test('llm-b-frontend depende do gateway runtime em vez de agent/channel/hub/core diretos', () => {
    expect(SRC).toMatch(/from '\.\/llm-b-runtime\.js'/);
    expect(SRC).not.toMatch(/from '#copilot\/agent'/);
    expect(SRC).not.toMatch(/from '#copilot\/channel'/);
    expect(SRC).not.toMatch(/from '#copilot\/conversation-hub'/);
    expect(SRC).not.toMatch(/from '#copilot\/core'/);
});
