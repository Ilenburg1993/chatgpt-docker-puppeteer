#!/usr/bin/env node
// @ts-check
/**
 * scripts/validate-event-map-coverage.mjs
 *
 * F34.4: Valida cobertura do EVENT_MAP do NERV bridge contra eventos registrados no agent-event-observer e vice-versa.
 *
 * Detecta:
 *
 * - Eventos no observer que faltam no EVENT_MAP (não são propagados para NERV)
 * - Eventos no EVENT_MAP sem handler correspondente no observer
 *
 * Uso: node scripts/validate-event-map-coverage.mjs Exit code: 0 se cobertura completa, 1 se há gaps.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const BRIDGE_FILE = path.join(root, 'src/copilot/bridges/nerv-bridge.js');
const OBSERVER_FILE = path.join(root, 'src/copilot/observability/agent-event-observer.js');

/**
 * Extrai nomes de eventos do EVENT_MAP no nerv-bridge.js.
 *
 * @param {string} src
 * @returns {Set<string>}
 */
function extractEventMapEvents(src) {
    const events = new Set();
    const re = /\{\s*event:\s*'([^']+)'/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        events.add(m[1]);
    }
    return events;
}

/**
 * Extrai nomes de eventos ouvidos no agent-event-observer.js.
 *
 * @param {string} src
 * @returns {Set<string>}
 */
function extractObserverEvents(src) {
    const events = new Set();
    // Padrão: _on(\n  agent,\n  'event.name',
    const re = /_on\(\s*\n?\s*agent,\s*\n?\s*'([^']+)'/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        events.add(m[1]);
    }
    return events;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const bridgeSrc = fs.readFileSync(BRIDGE_FILE, 'utf-8');
const observerSrc = fs.readFileSync(OBSERVER_FILE, 'utf-8');

const bridgeEvents = extractEventMapEvents(bridgeSrc);
const observerEvents = extractObserverEvents(observerSrc);

const missingInBridge = [...observerEvents].filter((e) => !bridgeEvents.has(e)).sort();
const missingInObserver = [...bridgeEvents].filter((e) => !observerEvents.has(e)).sort();

let exitCode = 0;

console.log('═══ F34.4: EVENT_MAP Coverage Validation ═══\n');
console.log(`  NERV Bridge events: ${bridgeEvents.size}`);
console.log(`  Observer events:    ${observerEvents.size}\n`);

if (missingInBridge.length > 0) {
    console.log('⚠️  Eventos no Observer sem mapeamento no NERV Bridge:');
    for (const e of missingInBridge) {
        console.log(`   - ${e}`);
    }
    exitCode = 1;
} else {
    console.log('✅ Todos os eventos do Observer estão mapeados no NERV Bridge.');
}

console.log('');

if (missingInObserver.length > 0) {
    console.log('ℹ️  Eventos no NERV Bridge sem handler no Observer (pode ser intencional):');
    for (const e of missingInObserver) {
        console.log(`   - ${e}`);
    }
} else {
    console.log('✅ Todos os eventos do NERV Bridge têm handler no Observer.');
}

console.log(`\n═══ Resultado: ${exitCode === 0 ? '✅ PASS' : '⚠️  GAPS DETECTADOS'} ═══`);
process.exit(exitCode);
