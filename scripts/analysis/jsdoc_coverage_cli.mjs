#!/usr/bin/env node
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { analyzeJSDocCoverage, collectJsSourceFiles } from './jsdoc_coverage_engine.mjs';

const { values } = parseArgs({
  options: {
    scope: { type: 'string', default: 'full' },
    files: { type: 'string', default: '' },
    roots: { type: 'string', default: 'src,scripts,tests' },
    format: { type: 'string', default: 'console' },
    'output-json': { type: 'string', default: 'jsdoc-coverage-report.json' },
  },
});

const scope = String(values.scope || 'full').toLowerCase() === 'changed' ? 'changed' : 'full';
const format = String(values.format || 'console').toLowerCase();
const filesArg = String(values.files || '').trim();
const roots = String(values.roots || 'src,scripts,tests').split(',').map(s => s.trim()).filter(Boolean);

const files = filesArg ? filesArg.split(',').map(s => s.trim()).filter(Boolean) : collectJsSourceFiles(roots);
const report = analyzeJSDocCoverage({ files, scope });

if (String(values['output-json'] || '').trim()) {
  fs.writeFileSync(String(values['output-json']), JSON.stringify(report, null, 2), 'utf8');
}

if (format === 'json') {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('='.repeat(80));
  console.log('JSDOC COVERAGE REPORT (v2)');
  console.log('='.repeat(80));
  console.log(`scope: ${report.scope}`);
  console.log(`files_scanned: ${report.files_scanned}`);
  console.log(`files_with_exports: ${report.files_with_exports}`);
  console.log(`exports_total: ${report.exports_total}`);
  console.log(`exports_with_jsdoc: ${report.exports_with_jsdoc}`);
  console.log(`coverage_pct: ${report.coverage_pct}%`);
  console.log('');
  const worstFiles = [...report.files]
    .sort((a, b) => a.coverage_pct - b.coverage_pct || a.file.localeCompare(b.file))
    .slice(0, 25);
  for (const item of worstFiles) {
    if (item.coverage_pct >= 100) continue;
    console.log(`- ${item.file}: ${item.coverage_pct}% (${item.exports_with_jsdoc}/${item.exports_total})`);
  }
}
