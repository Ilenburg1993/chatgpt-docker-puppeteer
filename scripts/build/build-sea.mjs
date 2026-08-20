#!/usr/bin/env node
// @ts-check

/**
 * Build script SIMPLIFICADO para Single Executable Applications (SEA) do Node.js
 * VERSÃO INFORMATIVA - Explica limitações atuais do SEA
 *
 * Node.js 24+ required
 * Integrado com sistema de validação pré-voo
 */

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..', '..');
const releaseDir = join(rootDir, 'release');

console.log('🏗️  Build SEA simplificado - chatgpt-docker-puppeteer');

// Executar validação pré-voo antes do build
console.log('🔍 Executando validação pré-voo...');
try {
    execSync('node scripts/env/pre-flight-check.mjs', {
        cwd: rootDir,
        stdio: 'inherit',
    });
    console.log('  ✓ Validação pré-voo passou');
} catch {
    console.log('❌ Validação pré-voo falhou. Abortando build.');
    process.exit(1);
}

// Criar diretório release se não existir
if (!existsSync(releaseDir)) {
    mkdirSync(releaseDir);
}

console.log('📋 Criando executável informativo...');

const hasDistBuild = existsSync(join(rootDir, 'dist/main.js'));
const recommendedCommand = hasDistBuild ? 'npm run daemon:start:prod' : 'npm run daemon:start';

// Criar executável informativo sobre limitações do SEA
const infoExecutable = `#!/bin/bash
# chatgpt-docker-puppeteer - Executável Informativo SEA
# Este executável explica as limitações atuais do SEA

echo "🚀 chatgpt-docker-puppeteer - Single Executable Application (SEA)"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "⚠️  STATUS: VERSÃO INFORMATIVA (LIMITAÇÕES TÉCNICAS)"
echo ""
echo "📋 O SEA ainda não suporta completamente projetos ESM complexos como este."
echo ""
echo "🔧 LIMITAÇÕES ATUAIS DO SEA:"
echo "   ❌ import() dinâmico não funciona no snapshot do Node.js"
echo "   ❌ Projetos ESM complexos têm problemas de compatibilidade"
echo "   ❌ Dependências nativas requerem compilação cruzada"
echo "   ❌ Top-level await funciona, mas outras features ESM não"
echo ""
echo "✅ O QUE FUNCIONA NO SEA:"
echo "   ✅ Node.js 24+ (vs PKG limitado a Node.js 18)"
echo "   ✅ Top-level await (resolve seu problema principal)"
echo "   ✅ Snapshots para inicialização mais rápida"
echo "   ✅ API oficial do Node.js (não deprecated como PKG)"
echo ""
echo "💡 RECOMENDAÇÕES ATUAIS:"
echo "   1. 🐳 Use Docker: docker build -t myapp ."
echo "   2. 📦 Use npm: npm start"
echo "   3. ⚙️  Use PM2: ${recommendedCommand}"
echo ""
echo "🔄 FUTURO:"
echo "   SEA está evoluindo rapidamente. Em breve será viável para projetos"
echo "   complexos como este. A infraestrutura já está preparada."
echo ""
echo "📚 MAIS INFORMAÇÕES:"
echo "   - Documentação SEA: https://nodejs.org/api/single-executable-applications.html"
echo "   - Guia de migração: SEA_MIGRATION_GUIDE.md"
echo "   - Comparação PKG vs SEA: https://nodejs.org/en/blog/release/v20.1.0/"
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "Desenvolvido com amor para automacao de IA"
echo ""

# Oferecer executar via Node.js se disponível
if command -v node >/dev/null 2>&1; then
    echo "💡 Quer executar a aplicação? Rode: ${recommendedCommand}"
    echo ""
fi

exit 0
`;

const exePath = join(releaseDir, 'chatgpt-docker-puppeteer-info.sh');
writeFileSync(exePath, infoExecutable);

// Tornar executável
execSync(`chmod +x ${exePath}`);

console.log('  ✓ Executável informativo criado');
console.log('');
console.log('✅ Build SEA simplificado concluído!');
console.log('📊 Arquivo gerado:');
console.log(`  - ${relative(process.cwd(), exePath)}`);
console.log('');
console.log('🚀 Para executar:');
console.log(`  ./${relative(process.cwd(), exePath)}`);
console.log('');
console.log('💡 Este é um executável informativo sobre as limitações atuais do SEA.');
console.log('   Use Docker ou PM2 para distribuição até que SEA amadureça.');
