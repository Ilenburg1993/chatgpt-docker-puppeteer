#!/usr/bin/env node
/**
 * VS Code Extensions Checker
 * Verifica status das extensões recomendadas vs instaladas
 */

const fs = require('fs');
const { execSync } = require('child_process');

// Remove comentários do JSONC
function parseJSONC(content) {
    const lines = content.split('\n').filter(line => {
        const trimmed = line.trim();
        return !trimmed.startsWith('//');
    });
    return JSON.parse(lines.join('\n'));
}

try {
    // Ler extensões recomendadas
    const extensionsFile = fs.readFileSync('.vscode/extensions.json', 'utf-8');
    const config = parseJSONC(extensionsFile);

    // Obter extensões instaladas
    let installed = [];
    try {
        const output = execSync('code --list-extensions', { encoding: 'utf-8' });
        installed = output
            .split('\n')
            .filter(e => e.trim())
            .map(e => e.toLowerCase());
    } catch (error) {
        console.log('⚠️  Aviso: Não foi possível obter lista de extensões instaladas');
        installed = [];
    }

    const recommended = config.recommendations || [];
    const unwanted = config.unwantedRecommendations || [];

    // Calcular estatísticas
    const installedCount = recommended.filter(ext => installed.includes(ext.toLowerCase())).length;

    const missingCount = recommended.length - installedCount;
    const percentage = Math.round((installedCount / recommended.length) * 100);

    // Output
    console.log('📊 VS Code Extensions Status\n');
    console.log(`✅ Recommended: ${recommended.length}`);
    console.log(`❌ Unwanted: ${unwanted.length}`);
    console.log(`📦 Installed: ${installedCount} / ${recommended.length} (${percentage}%)`);
    console.log(`⚠️  Missing: ${missingCount}`);

    if (missingCount > 0) {
        console.log('\n💡 Para instalar extensões faltando:');
        console.log('   npm run vscode:extensions');
        console.log('   (ou) make install-extensions');
        process.exit(1);
    } else {
        console.log('\n✅ Todas as extensões recomendadas estão instaladas!');
        process.exit(0);
    }
} catch (error) {
    console.error('❌ Erro ao verificar extensões:', error.message);
    process.exit(1);
}
