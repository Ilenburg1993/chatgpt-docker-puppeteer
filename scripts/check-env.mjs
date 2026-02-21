#!/usr/bin/env node

import { readFileSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
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
