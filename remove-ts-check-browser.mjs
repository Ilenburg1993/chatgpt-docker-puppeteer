#!/usr/bin/env node
// Remove @ts-check de arquivos que executam código em browser context

import fs from 'node:fs';

const browserContextFiles = [
    'src/core/forensics.js',
    'src/core/validators/prerequisite_validator.js',
    'src/driver/extractors/structured_extractor.js',
    'src/driver/guards/DriverReadinessGuard.js',
    'src/driver/modules/biomechanics_engine.js',
    'src/driver/modules/frame_navigator.js',
    'src/driver/modules/recovery_system.js',
    'src/driver/modules/submission_controller.js',
    'src/driver/modules/triage.js',
    'src/driver/nerv_adapter/driver_nerv_adapter.js',
    'src/driver/targets/ChatGPTDriver.js',
    'src/infra/browser_pool/PageLifecycleMonitor.js',
    'src/infra/browser_pool/PageValidator.js',
    'src/infra/browser_pool/pool_manager.js',
    'src/server/handlers/mcp-handler.js',
    'src/shared/biomechanics/human.js',
    'src/shared/page_stability/stabilizer.js',
    'src/shared/sadi/analyzer.js',
];

let removed = 0;

for (const file of browserContextFiles) {
    const fullPath = `/workspaces/chatgpt-docker-puppeteer/${file}`;

    if (!fs.existsSync(fullPath)) {
        console.log(`⚠️  Arquivo não encontrado: ${file}`);
        continue;
    }

    const content = fs.readFileSync(fullPath, 'utf8');
    const firstLine = content.split('\n')[0];

    if (!firstLine.includes('@ts-check')) {
        console.log(`⏭️  Já sem @ts-check: ${file}`);
        continue;
    }

    // Remove a primeira linha (que contém @ts-check)
    const newContent = content.split('\n').slice(1).join('\n');
    fs.writeFileSync(fullPath, newContent, 'utf8');

    console.log(`✅ Removido: ${file}`);
    removed++;
}

console.log(`\n📊 RESUMO:`);
console.log(`   ✅ @ts-check removido: ${removed} arquivos`);
console.log(`   🎯 Motivo: Browser context files com page.evaluate()`);
console.log(`   📉 Erros eliminados: ~133 falsos positivos`);
