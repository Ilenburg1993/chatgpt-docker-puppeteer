#!/usr/bin/env node
// @ts-check

/**
 * Build script personalizado para agente-gpt
 * Estratégia: Copy + minimal bundling para dependências problemáticas
 *
 * Node.js 24+ required
 */

import { execSync } from 'child_process';
import { cpSync, rmSync, mkdirSync, existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..', '..');
const distDir = join(rootDir, 'dist');

console.log('🏗️  Iniciando build do agente-gpt (Node.js 24+)...');

// Limpar dist anterior
if (existsSync(distDir)) {
    console.log('🧹 Limpando build anterior...');
    rmSync(distDir, { recursive: true, force: true });
}
mkdirSync(distDir);

// Copiar arquivos essenciais
console.log('📋 Copiando arquivos essenciais...');
const essentialFiles = ['index.js', 'package.json', 'package-lock.json', 'config.json', 'ecosystem.config.cjs'];

essentialFiles.forEach(file => {
    const srcPath = join(rootDir, file);
    if (existsSync(srcPath)) {
        cpSync(srcPath, join(distDir, file));
        console.log(`  ✓ ${file}`);
    }
});

// Copiar diretórios necessários
console.log('📁 Copiando diretórios...');
const directories = ['src', 'scripts'];
directories.forEach(dir => {
    const srcPath = join(rootDir, dir);
    if (existsSync(srcPath)) {
        cpSync(srcPath, join(distDir, dir), { recursive: true });
        console.log(`  ✓ ${dir}/`);
    }
});

// Instalar dependências em dist
console.log('📦 Instalando dependências de produção...');
try {
    execSync('npm ci --omit=dev --no-audit --no-fund', {
        cwd: distDir,
        stdio: 'inherit',
    });
    console.log('  ✓ Dependências instaladas');
} catch {
    console.log('⚠️  Falha na instalação de dependências, tentando continuar...');
}

// Bundle apenas dos arquivos que podem ser bundled
console.log('🔗 Criando bundle otimizado...');
try {
    execSync(
        `npx esbuild src/main.js --bundle --minify --sourcemap --outfile=${join(distDir, 'main.bundle.js')} --platform=node --format=esm --external:@pm2/blessed --external:term.js --external:pty.js --external:@lancedb/lancedb-*`,
        {
            cwd: rootDir,
            stdio: 'pipe', // Não mostrar output para reduzir ruído
        }
    );
    console.log('  ✓ Bundle criado com sucesso');
} catch {
    console.log('⚠️  Bundle parcial falhou, continuando com cópia direta...');
    console.log('   Isso é esperado para algumas dependências nativas');
}

// Criar script de inicialização otimizado
console.log('📝 Criando script de inicialização...');
const launcherScript = `#!/usr/bin/env node
/**
 * Launcher otimizado para produção
 * Node.js 24+ required
 */
import('./index.js').catch(console.error);
`;

writeFileSync(join(distDir, 'start.js'), launcherScript);
console.log('  ✓ Script de inicialização criado');

// Criar entrada específica para pkg (sem aliases e sem top-level await)
console.log('📦 Criando entrada para executável...');
const pkgEntryScript = `#!/usr/bin/env node
/**
 * Entrada específica para pkg (executável)
 * Compatível com limitações do pkg (sem top-level await)
 * Node.js 24+ required
 */
import { main } from './src/main.js';

(async () => {
    try {
        await main();
    } catch (error) {
        console.error('Erro fatal:', error);
        process.exit(1);
    }
})();
`;

writeFileSync(join(distDir, 'pkg-entry.js'), pkgEntryScript);
console.log('  ✓ Entrada para pkg criada');

console.log('✅ Build concluído!');
console.log('📊 Estatísticas:');
try {
    execSync(`du -sh ${distDir}`, { stdio: 'inherit' });
} catch {
    // Windows não tem du, usar dir
    try {
        execSync(`dir /s ${distDir}`, { stdio: 'inherit' });
    } catch {
        console.log('  Tamanho do build: desconhecido');
    }
}

console.log('🚀 Para executar:');
console.log('  Desenvolvimento: cd dist && node index.js');
console.log('  Produção: cd dist && node start.js');
console.log('  PM2: cd dist && npx pm2 start ecosystem.config.cjs');
