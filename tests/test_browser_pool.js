const BrowserPoolManager = require('../src/infra/browser_pool/pool_manager');

(async () => {
  console.log('🚀 Testando BrowserPoolManager...');
  
  const config = {
    poolSize: 2,
    chromium: {
      mode: 'launcher' // Puppeteer inicia Chrome automaticamente
    }
  };
  
  const pool = new BrowserPoolManager(config);
  
  console.log('✅ Pool criado');
  
  await pool.initialize();
  
  console.log('✅ Pool inicializado:', pool.pool.length, 'instâncias');
  console.log('   IDs:', pool.pool.map(p => p.id).join(', '));
  
  // Testa alocação de página
  const page = await pool.allocate('chatgpt');
  console.log('✅ Página alocada');
  
  await page.goto('https://example.com', { waitUntil: 'networkidle0' });
  const title = await page.title();
  console.log('✅ Navegou para example.com');
  console.log('   Título:', title);
  
  // Libera página
  await pool.release(page);
  console.log('✅ Página liberada');
  
  // Graceful shutdown
  await pool.shutdown();
  console.log('✅ Pool encerrado');
  
  console.log('\n🎉 BrowserPoolManager 100% funcional!');
})();
