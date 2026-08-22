#!/usr/bin/env node
// @ts-check
/**
 * Deterministic documentation projection for the governed Infra public API.
 *
 * The semantic source is INFRA_PUBLIC_API_MANIFEST. Cost data is measured from the current static import closure by the
 * same governance code used by architecture gates. This script intentionally consumes only the public diagnostic
 * governance surface so documentation tooling cannot become a new internal-API bypass.
 *
 * @module scripts/analysis/infra-public-api-reference
 */

import { buildInfraPublicApiCostReport, INFRA_PUBLIC_API_MANIFEST } from '#copilot/infra/public/diagnostic/governance';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TARGET = path.join(REPO_ROOT, 'src', 'copilot', 'infra', 'public', 'API_REFERENCE.md');
const COLD_IMPORT_BASELINE = path.join(
    REPO_ROOT,
    'config',
    'architecture',
    'infra-public-api-cold-import-baseline.json',
);

/** @param {unknown} value */
function markdownCell(value) {
    return String(value ?? '—')
        .replaceAll('|', '\\|')
        .replaceAll('\r', ' ')
        .replaceAll('\n', ' ');
}

/** @param {number} bytes */
function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`;
}

/** @param {number | undefined} value @param {string} unit */
function formatColdMetric(value, unit) {
    return Number.isFinite(value) ? `${Number(value).toFixed(1)} ${unit}` : '—';
}

/**
 * @returns {Promise<string>}
 */
export async function renderInfraPublicApiReference() {
    const coldImportBaseline =
        /** @type {{entries?:Array<{alias:string;metrics?:{importMs?:number;wallMs?:number;rssMiB?:number}}>} } */ (
            JSON.parse(await readFile(COLD_IMPORT_BASELINE, 'utf8'))
        );
    const coldByAlias = new Map((coldImportBaseline.entries ?? []).map((entry) => [entry.alias, entry.metrics]));
    const costReport = await buildInfraPublicApiCostReport();
    if (!costReport.success) {
        const details = costReport.violations
            .map((entry) => `${entry.alias}: ${entry.violations.join(', ')}`)
            .join('; ');
        throw new Error(`Cannot render Infra public API reference while cost governance is failing: ${details}`);
    }

    const costByAlias = new Map(costReport.entries.map((entry) => [entry.alias, entry]));
    const rows = [...INFRA_PUBLIC_API_MANIFEST].sort((left, right) => left.alias.localeCompare(right.alias));
    const lines = [
        '# Infra public API reference',
        '',
        '> **Generated file — do not edit manually.** Semantic metadata comes from',
        '> `src/copilot/infra/governance/public-api-manifest.js`; static cost columns are measured from the current import',
        '> closure and cold columns come from the versioned fresh-process baseline. Regenerate with `npm run copilot:infra:public-api-docs`.',
        '',
        `Entrypoints governados: **${rows.length}**.`,
        '',
        '| Alias | Audience | Privilege | Path authority | Raw path | Issuer | Lifecycle | Stability | Cost tier | Modules | Source | Cold import | Cold wall | Cold RSS | External packages | Exports |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |',
    ];

    for (const descriptor of rows) {
        const cost = costByAlias.get(descriptor.alias);
        if (!cost) throw new Error(`Missing cost projection for ${descriptor.alias}.`);
        const cold = coldByAlias.get(descriptor.alias);
        lines.push(
            `| \`${markdownCell(descriptor.alias)}\` | ${markdownCell(descriptor.audience)} | ${markdownCell(descriptor.privilege)} | ${markdownCell(descriptor.pathAuthority)} | ${descriptor.acceptsOperationalRawPath ? 'yes' : 'no'} | ${descriptor.issuer ? 'yes' : 'no'} | ${markdownCell(descriptor.lifecycle)} | ${markdownCell(descriptor.stability)} | ${markdownCell(descriptor.costTier)} | ${cost.moduleCount} | ${formatBytes(cost.sourceBytes)} | ${formatColdMetric(cold?.importMs, 'ms')} | ${formatColdMetric(cold?.wallMs, 'ms')} | ${formatColdMetric(cold?.rssMiB, 'MiB')} | ${markdownCell(cost.externalPackages.join(', ') || '—')} | ${markdownCell(descriptor.exports.join(', '))} |`,
        );
    }

    lines.push(
        '',
        '## Interpretação',
        '',
        '- **Privilege** descreve a autoridade máxima exposta pelo entrypoint; `authority` e `lifecycle` exigem composição deliberada.',
        '- **Path authority / Raw path / Issuer** projetam diretamente o contrato semântico de authority: onde raw paths podem entrar e quais entrypoints materializam capabilities/resources bound.',
        '- **Lifecycle** declara o scope que deve possuir o estado (`none`, `process`, `runtime` ou `workspace`).',
        '- **Modules / Source** medem closure estática; **Cold import / Cold wall / Cold RSS** são medianas da baseline fresh-process com compile-cache desabilitado.',
        '- Cold ratchet cobre apenas audiences `runtime`/`composition`; `diagnostic`/`test` permanecem fora do hot-path dinâmico, mas continuam bounded pela closure estática.',
        '- A lista resolvível efetiva continua sendo `package.json#imports`; o gate arquitetural exige bijeção entre esses aliases e os barrels em `infra/public/**/index.js`.',
        '',
    );
    // `lines` intentionally ends with one empty item, so join() already emits exactly one final newline.
    return lines.join('\n');
}

async function main() {
    const output = await renderInfraPublicApiReference();
    const write = process.argv.includes('--write');
    const check = process.argv.includes('--check');
    if (write && check) throw new Error('Use either --write or --check, not both.');

    if (write) {
        await writeFile(TARGET, output, 'utf8');
        process.stdout.write(`Updated ${path.relative(REPO_ROOT, TARGET)}\n`);
        return;
    }
    if (check) {
        let current = '';
        try {
            current = await readFile(TARGET, 'utf8');
        } catch {
            throw new Error(`Generated reference is missing: ${path.relative(REPO_ROOT, TARGET)}.`);
        }
        if (current !== output) {
            throw new Error(`Infra public API reference is stale. Run: npm run copilot:infra:public-api-docs`);
        }
        process.stdout.write('Infra public API reference: OK\n');
        return;
    }
    process.stdout.write(output);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
    main().catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
