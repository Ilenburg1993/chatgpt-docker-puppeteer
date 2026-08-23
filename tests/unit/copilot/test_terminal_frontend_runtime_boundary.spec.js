// @ts-check

import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const SRC = readFileSync('/workspaces/chatgpt-docker-puppeteer/src/copilot/terminal/frontend/index.js', 'utf8');

const SRC_NOW = readFileSync(
    '/workspaces/chatgpt-docker-puppeteer/src/copilot/terminal/frontend/projections/now.js',
    'utf8',
);
const SRC_TIMELINE = readFileSync(
    '/workspaces/chatgpt-docker-puppeteer/src/copilot/terminal/frontend/projections/timeline.js',
    'utf8',
);

test('frontend/index.js reexporta apenas famílias canônicas do frontend', () => {
    // Barrel deve apontar apenas para os sub-barrels públicos do frontend.
    expect(SRC).toMatch(/from '\.\/projections\/index\.js'/);
    expect(SRC).toMatch(/from '\.\/gateways\/index\.js'/);
    expect(SRC).not.toMatch(/from '\.\/projections\/(?!index\.js)/);
    expect(SRC).not.toMatch(/from '\.\/gateways\/(?!index\.js)/);
    // Não deve conter nenhuma implementação direta (função export function)
    expect(SRC).not.toMatch(/^export\s+(async\s+)?function\s+/m);
    // Não deve importar de agentes/canais/hubs/core diretamente
    expect(SRC).not.toMatch(/from '#copilot\/agent'/);
    expect(SRC).not.toMatch(/from '#copilot\/channel'/);
    expect(SRC).not.toMatch(/from '#copilot\/conversation-hub'/);
    expect(SRC).not.toMatch(/from '#copilot\/core'/);
    expect(SRC).not.toMatch(/readTerminalHistoryFeed/);
    expect(SRC).not.toMatch(/seedTerminalHistoryFeed/);
    expect(SRC).not.toMatch(/clearTerminalHistoryFeed/);
    expect(SRC).not.toMatch(/readTerminalTurnCount/);
});

test('projections/now.js e timeline.js cruzam fronteiras via barrels do frontend', () => {
    expect(SRC_NOW).toMatch(/from '\.\.\/gateways\/index\.js'/);
    expect(SRC_TIMELINE).toMatch(/from '\.\.\/gateways\/index\.js'/);
    expect(SRC_NOW).not.toMatch(/from '\.\.\/gateways\/(?!index\.js)/);
    expect(SRC_TIMELINE).not.toMatch(/from '\.\.\/gateways\/(?!index\.js)/);
    expect(SRC_NOW).not.toMatch(/from '#copilot\/agent'/);
    expect(SRC_NOW).not.toMatch(/from '#copilot\/channel'/);
    expect(SRC_NOW).not.toMatch(/from '#copilot\/conversation-hub'/);
    expect(SRC_NOW).not.toMatch(/from '#copilot\/core'/);
    expect(SRC_TIMELINE).not.toMatch(/from '#copilot\/agent'/);
    expect(SRC_TIMELINE).not.toMatch(/from '#copilot\/channel'/);
    expect(SRC_TIMELINE).not.toMatch(/from '#copilot\/conversation-hub'/);
    // timeline pode usar primitives puras do owner semântico (ex.: resilience/sleep e error normalization),
    // desde que não atravesse para agent/channel/hub diretamente.
});
