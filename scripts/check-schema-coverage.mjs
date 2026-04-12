#!/usr/bin/env node
// @ts-check
/**
 * scripts/check-schema-coverage.mjs — FAIXA-L38
 *
 * Script CI que verifica cobertura 100% de schemas para todos os bus events SSOT. Falha (exit 1) se qualquer bus event
 * não tiver schema registrado.
 *
 * Uso: node scripts/check-schema-coverage.mjs
 */

import * as agentEvents from '../src/copilot/events/agent-events.js';
import * as hookEvents from '../src/copilot/events/hook-events.js';
import * as hubEvents from '../src/copilot/events/hub-events.js';
import * as nervEvents from '../src/copilot/events/nerv-events.js';
import { BUILTIN_SCHEMAS } from '../src/copilot/events/schemas/builtin-schemas.js';
import { getEventSchema, registerEventSchemas, schemaCount } from '../src/copilot/events/schemas/registry.js';
import * as serviceEvents from '../src/copilot/events/service-events.js';
import * as systemEvents from '../src/copilot/events/system-events.js';
import * as terminalEvents from '../src/copilot/events/terminal-events.js';

// ── Load schemas ──────────────────────────────────────────
registerEventSchemas(BUILTIN_SCHEMAS);

// ── Collect all SSOT bus event values ─────────────────────
const modules = [agentEvents, hookEvents, hubEvents, terminalEvents, systemEvents, serviceEvents, nervEvents];
const allSSOT = new Set();
for (const mod of modules) {
    for (const [key, value] of Object.entries(mod)) {
        if (typeof value === 'string' && !key.startsWith('EMITTER') && !key.endsWith('_EVENTS')) {
            allSSOT.add(value);
        }
    }
}

const total = allSSOT.size;
const schemaTotal = schemaCount();

// ── Check coverage ────────────────────────────────────────
const uncovered = [];
const orphans = [];

for (const ev of allSSOT) {
    if (!getEventSchema(/** @type {string} */ (ev))) {
        uncovered.push(ev);
    }
}

for (const s of BUILTIN_SCHEMAS) {
    if (!allSSOT.has(s.type)) {
        orphans.push(s.type);
    }
}

// ── Check duplicates ──────────────────────────────────────
const types = BUILTIN_SCHEMAS.map((s) => s.type);
const duplicates = types.filter((t, i) => types.indexOf(t) !== i);

// ── Report ────────────────────────────────────────────────
const pct = total > 0 ? Math.round(((total - uncovered.length) / total) * 100) : 0;

console.log(`Schema Coverage: ${total - uncovered.length}/${total} (${pct}%)`);
console.log(`Schemas registrados: ${schemaTotal}`);
console.log(`Orphans: ${orphans.length}`);
console.log(`Duplicates: ${duplicates.length}`);

let exitCode = 0;

if (uncovered.length > 0) {
    console.error(`\n❌ ${uncovered.length} bus event(s) sem schema:`);
    for (const ev of uncovered.sort()) {
        console.error(`  - ${ev}`);
    }
    exitCode = 1;
}

if (orphans.length > 0) {
    console.error(`\n⚠️  ${orphans.length} schema(s) órfão(s) (sem SSOT):`);
    for (const ev of orphans.sort()) {
        console.error(`  - ${ev}`);
    }
    exitCode = 1;
}

if (duplicates.length > 0) {
    console.error(`\n⚠️  ${duplicates.length} schema(s) duplicado(s):`);
    for (const ev of duplicates) {
        console.error(`  - ${ev}`);
    }
    exitCode = 1;
}

if (exitCode === 0) {
    console.log('\n✅ Schema coverage: 100% — sem orphans, sem duplicatas.');
}

process.exit(exitCode);
