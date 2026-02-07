#!/usr/bin/env node
import fs from 'node:fs';

const data = JSON.parse(fs.readFileSync('typescript-diagnostics.json', 'utf8'));
const byFile = {};

data.errors.forEach(d => {
  const file = d.file;
  if (!byFile[file]) byFile[file] = [];
  byFile[file].push(d.code);
});

const sorted = Object.entries(byFile)
  .map(([file, codes]) => ({ file, count: codes.length, codes: [...new Set(codes)] }))
  .sort((a, b) => b.count - a.count)
  .slice(0, 40);

console.log('📊 Top 40 arquivos com MAIS erros:\n');
sorted.forEach(({ file, count, codes }) => {
  const shortFile = file.replace('/workspaces/chatgpt-docker-puppeteer/', '');
  console.log(`${count.toString().padStart(3)} erros - ${shortFile}`);
  console.log(`        Códigos: ${codes.join(', ')}\n`);
});

// Categorização de erros
const errorCategories = {
  browser: ['TS2304', 'TS2584'], // document, window, HTMLElement
  types: ['TS2339'],              // Property does not exist
  schemas: ['TS2769'],            // No overload matches (Object.freeze)
  assignments: ['TS2322', 'TS2345'], // Type mismatches
};

console.log('\n📈 Categorização de erros:');
console.log('\nBrowser globals (TS2304, TS2584):');
const browserErrors = data.errors.filter(d =>
  d.code === 2304 || d.code === 2584
);
console.log(`   Total: ${browserErrors.length} erros`);

const browserFiles = new Set(browserErrors.map(d => d.file.replace('/workspaces/chatgpt-docker-puppeteer/', '')));
console.log(`   Arquivos afetados: ${browserFiles.size}`);
browserFiles.forEach(f => console.log(`      - ${f}`));
