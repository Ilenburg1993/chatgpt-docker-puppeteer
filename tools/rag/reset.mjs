// @ts-check
import './lib/env-bootstrap.mjs';
import { parseArgs } from 'node:util';
import { ragReset } from './lib/facade.mjs';

const { values } = parseArgs({
    options: {
        yes: { type: 'boolean', default: false },
    },
});

await ragReset({ yes: values.yes });
console.log('[RAG] reset OK');
