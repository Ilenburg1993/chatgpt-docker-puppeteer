#!/usr/bin/env node
import {
    MODEL_GATEWAY_CANONICAL_COMMANDS,
    renderModelGatewayCanonicalCommandLines,
} from '../../../src/copilot/model-gateway/commands/index.js';

const args = new Set(process.argv.slice(2));
const optionValue = (/** @type {string} */ name) => {
    const prefix = `${name}=`;
    const item = process.argv.slice(2).find((value) => value.startsWith(prefix));
    return item ? item.slice(prefix.length) : null;
};

const filters = {
    ...(optionValue('--surface') ? { surface: optionValue('--surface') ?? '' } : {}),
    ...(optionValue('--phase') ? { phase: optionValue('--phase') ?? '' } : {}),
};

if (args.has('--json')) {
    const filtered = MODEL_GATEWAY_CANONICAL_COMMANDS.filter(
        (entry) => (!filters.surface || entry.surface === filters.surface) && (!filters.phase || entry.phase === filters.phase),
    );
    console.log(JSON.stringify({ schema: 'model-gateway-canonical-commands', commands: filtered }, null, 2));
} else {
    console.log('Canonical model-gateway commands');
    console.log('Scope: package.json, Makefile and terminal BYOK cockpit');
    console.log('Build status: pre-build; use prebuild validators before first full build.');
    console.log('');
    for (const line of renderModelGatewayCanonicalCommandLines(filters)) console.log(line);
}
