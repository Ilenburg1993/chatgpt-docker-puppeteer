#!/usr/bin/env node
// @ts-check
import fs from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * Remove comentários do formato JSONC para converter para JSON válido.
 * @param {string} content - Conteúdo JSONC como string.
 * @returns {object} Objeto JSON resultante após remoção dos comentários.
 */
function parseJSONC(content) {
    const lines = content.split('\n').filter(line => {
        const trimmed = line.trim();
        return !trimmed.startsWith('//');
    });
    return JSON.parse(lines.join('\n'));
}

/**
 * Script principal para verificar o status das extensões do VS Code.
 * Lê o arquivo .vscode/extensions.json e compara com as extensões instaladas.
 * Exibe estatísticas e sai com código 1 se houver extensões faltando.
 * Side-effects: Lê arquivos do sistema, executa comando 'code', imprime resultados no console.
 */
function main() {
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
        } catch (_error) {
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
            console.log('   1. Abra o Command Palette: Ctrl+Shift+P (Windows/Linux) ou Cmd+Shift+P (Mac)');
            console.log('   2. Digite: "Extensions: Show Recommended Extensions"');
            console.log('   3. Clique em "Install" nas extensões desejadas');
            console.log('\n   Ou instale via DevContainer rebuild (auto-install)');
            process.exit(1);
        } else {
            console.log('\n✅ Todas as extensões recomendadas estão instaladas!');
            process.exit(0);
        }
    } catch (error) {
        console.error('❌ Erro ao verificar extensões:', error.message);
        process.exit(1);
    }
}

// Executar função principal
main();
