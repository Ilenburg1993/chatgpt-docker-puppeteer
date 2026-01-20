#!/usr/bin/env node

/**
 * Script de manutenção do Puppeteer
 * Limpa profiles temporários e valida cache
 * 
 * Uso:
 *   npm run maintenance
 *   node scripts/puppeteer_maintenance.js
 *   node scripts/puppeteer_maintenance.js --clean-cache (remove cache completo)
 */

const { ConnectionOrchestrator } = require('../src/infra/ConnectionOrchestrator');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const cleanCache = args.includes('--clean-cache');

console.log('🔧 Puppeteer Maintenance Tool\n');

(async () => {
  // 1. Informações do cache
  console.log('📦 Cache Status:');
  const cacheInfo = ConnectionOrchestrator.getCacheInfo();
  console.log('  Path:', cacheInfo.path);
  console.log('  Exists:', cacheInfo.exists ? '✅' : '❌');
  
  if (cacheInfo.exists) {
    console.log('  Chrome:', cacheInfo.chrome ? '✅' : '❌');
    console.log('  Chrome Headless:', cacheInfo.chromeHeadless ? '✅' : '❌');
    
    // Tamanho do cache
    try {
      const { execSync } = require('child_process');
      const size = execSync(`du -sh ${cacheInfo.path} 2>/dev/null | cut -f1`).toString().trim();
      console.log('  Size:', size);
    } catch (e) {
      console.log('  Size: (não disponível)');
    }
  }
  console.log();
  
  // 2. Profiles temporários
  console.log('🗑️  Temporary Profiles:');
  const tmpDir = '/tmp';
  const profiles = fs.readdirSync(tmpDir).filter(f => f.startsWith('puppeteer_dev_chrome_profile-'));
  
  console.log('  Found:', profiles.length);
  
  if (profiles.length > 0) {
    console.log('  Profiles:');
    for (const profile of profiles) {
      const profilePath = path.join(tmpDir, profile);
      try {
        const stats = fs.statSync(profilePath);
        const size = execSync(`du -sh ${profilePath} 2>/dev/null | cut -f1`).toString().trim();
        console.log(`    - ${profile} (${size})`);
      } catch (e) {
        console.log(`    - ${profile} (size unknown)`);
      }
    }
    
    console.log('\n  Cleaning...');
    const cleaned = await ConnectionOrchestrator.cleanupTempProfiles();
    console.log('  ✅ Removed:', cleaned, 'profiles');
  } else {
    console.log('  ✅ No temporary profiles found');
  }
  console.log();
  
  // 3. Limpeza do cache (opcional)
  if (cleanCache) {
    console.log('⚠️  Cache Cleanup (--clean-cache):');
    
    if (!cacheInfo.exists) {
      console.log('  Cache não existe, nada a fazer');
    } else {
      console.log('  Removing:', cacheInfo.path);
      
      try {
        fs.rmSync(cacheInfo.path, { recursive: true, force: true });
        console.log('  ✅ Cache removed');
        console.log('  ⚠️  Chromium será baixado novamente na próxima execução');
      } catch (error) {
        console.log('  ❌ Erro:', error.message);
      }
    }
    console.log();
  }
  
  // 4. Recomendações
  console.log('💡 Recommendations:');
  
  if (profiles.length > 10) {
    console.log('  ⚠️  Muitos profiles temporários detectados');
    console.log('     Execute este script regularmente ou adicione ao cron');
  }
  
  if (!cacheInfo.chrome || !cacheInfo.chromeHeadless) {
    console.log('  ⚠️  Cache incompleto');
    console.log('     Execute: npm install (para baixar Chromium)');
  }
  
  if (!cleanCache) {
    console.log('  ℹ️  Para remover cache completamente: --clean-cache');
  }
  
  console.log();
  console.log('✅ Maintenance complete!');
  
  process.exit(0);
})().catch(error => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});
