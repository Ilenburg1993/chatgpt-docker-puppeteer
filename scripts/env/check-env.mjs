#!/usr/bin/env node
// @ts-check

if (process.env['FORCE_COLOR'] && process.env['NO_COLOR']) {
    delete process.env['NO_COLOR'];
}

// Verificar se estamos executando de dentro da pasta dist
const cwd = process.cwd();
const isInDist = cwd.includes('/dist') || cwd.endsWith('/dist');

console.log('🔍 Verificação de Ambiente');
console.log('═══════════════════════════');
console.log(`📍 Local atual: ${cwd}`);

if (isInDist) {
    console.log('📦 Você está na pasta DIST (produção)');
    console.log('   ✅ Ambiente: PRODUÇÃO');
    console.log('   ✅ Código: Otimizado/Bundled');
    console.log('   ⚠️  Use apenas para deploy/execução');
    console.log('   ❌ NÃO edite arquivos aqui!');
} else {
    console.log('💻 Você está na pasta RAIZ (desenvolvimento)');
    console.log('   ✅ Ambiente: DESENVOLVIMENTO');
    console.log('   ✅ Código: Source completo');
    console.log('   ✅ Pode editar arquivos');
}

console.log('');
console.log('🧭 Runtime atual:');
console.log(`   node: ${process.execPath}`);
if (process.env['npm_execpath']) {
    console.log(`   npm:  ${process.env['npm_execpath']}`);
}

const windowsMountPattern = /^\/mnt\/[a-z]\//i;
const isWindowsMountedNode = windowsMountPattern.test(process.execPath);
const isWindowsMountedNpm = Boolean(
    process.env['npm_execpath'] && windowsMountPattern.test(process.env['npm_execpath']),
);

if (isWindowsMountedNode || isWindowsMountedNpm) {
    console.log('   ⚠️  Runtime misto detectado: node/npm estão vindo de um path do Windows.');
    console.log('   ⚠️  Isso pode quebrar Codex, npm scripts, subprocessos e caminhos UNC no WSL.');
    console.log('   ✅ Recomendado: usar instalações Linux de node/npm dentro do WSL ou do container.');
    console.log('');
}

console.log('🚀 Comandos recomendados:');
if (isInDist) {
    console.log('   node start.js              # Executar');
    console.log('   npx pm2 start ecosystem.config.cjs  # PM2');
    console.log('   cd ..                      # Voltar para raiz');
} else {
    console.log('   npm start                  # Desenvolvimento');
    console.log('   npm run build             # Criar dist/');
    console.log('   npm run daemon:start      # PM2 (desenvolvimento)');
    console.log('   npm run daemon:start:prod # PM2 (produção)');
    console.log('   cd dist && npm run check:env  # Verificar dist/');
}

console.log('═══════════════════════════');
