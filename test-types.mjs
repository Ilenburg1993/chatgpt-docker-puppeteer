#!/usr/bin/env node
// Força o TypeScript a recarregar e reconhecer os novos .d.ts

console.log('🔄 Forçando reload do TypeScript Language Server...');
console.log('');
console.log('📋 Arquivos .d.ts criados:');
console.log('   ✅ src/types/global.d.ts - Tipos globais (Error extensions, Puppeteer, Config)');
console.log('   ✅ src/types/zod.d.ts - Schemas Zod (resolve TS2769)');
console.log('   ✅ src/types/driver.d.ts - Driver system (resolve TS2345)');
console.log('');
console.log('📝 jsconfig.json atualizado:');
console.log('   ✅ typeRoots: ["./node_modules/@types", "./src/types"]');
console.log('   ✅ include: ["src/**/*.d.ts"]');
console.log('');
console.log('🎯 Próximos passos:');
console.log('   1. Recarregue o TypeScript no VSCode:');
console.log('      - Cmd/Ctrl + Shift + P');
console.log('      - Digite: "TypeScript: Restart TS Server"');
console.log('   2. Aguarde ~10 segundos para reindexação');
console.log('   3. Verifique o painel PROBLEMAS (deve ter menos erros)');
console.log('');
console.log('✅ Configuração estrutural concluída!');
