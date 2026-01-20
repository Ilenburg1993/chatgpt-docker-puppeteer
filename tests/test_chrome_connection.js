/* ==========================================================================
   tests/test_chrome_connection.js
   Teste de conexão com Chrome externo (Windows host)
   
   Uso:
   1. Iniciar Chrome no Windows:
      chrome.exe --remote-debugging-port=9222 --user-data-dir="C:\chrome-automation-profile"
   
   2. Executar teste:
      node tests/test_chrome_connection.js
========================================================================== */

const puppeteer = require('puppeteer-core');

const CHROME_URL = process.env.CHROME_REMOTE_URL || 'http://host.docker.internal:9222';

async function testChromeConnection() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║          TESTE DE CONEXÃO - CHROME EXTERNO                   ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  
  try {
    // 1. Verificar se URL está acessível
    console.log('1. Verificando URL do Chrome...');
    console.log(`   URL: ${CHROME_URL}`);
    
    const versionUrl = `${CHROME_URL}/json/version`;
    console.log(`   Testando: ${versionUrl}`);
    
    const response = await fetch(versionUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const version = await response.json();
    console.log('   ✅ Chrome acessível');
    console.log(`   Browser: ${version.Browser}`);
    console.log(`   WebSocket: ${version.webSocketDebuggerUrl ? 'disponível' : 'indisponível'}`);
    console.log('');
    
    // 2. Conectar com Puppeteer
    console.log('2. Conectando via Puppeteer...');
    const browser = await puppeteer.connect({
      browserURL: CHROME_URL,
      defaultViewport: {
        width: 1920,
        height: 1080
      },
      ignoreHTTPSErrors: true
    });
    
    console.log('   ✅ Puppeteer conectado!');
    console.log(`   Type: ${browser.constructor.name}`);
    console.log(`   Process: ${browser.process() ? 'gerenciado' : 'remoto (correto)'}`);
    console.log('');
    
    // 3. Listar páginas abertas
    console.log('3. Listando páginas abertas...');
    const pages = await browser.pages();
    console.log(`   Páginas: ${pages.length}`);
    pages.forEach((page, index) => {
      console.log(`     [${index}] ${page.url()}`);
    });
    console.log('');
    
    // 4. Criar nova página
    console.log('4. Criando nova página de teste...');
    const page = await browser.newPage();
    console.log('   ✅ Página criada');
    
    // 5. Navegar para site de teste
    console.log('');
    console.log('5. Navegando para https://example.com...');
    await page.goto('https://example.com', {
      waitUntil: 'networkidle2',
      timeout: 15000
    });
    
    const title = await page.title();
    const url = page.url();
    
    console.log('   ✅ Navegação bem-sucedida');
    console.log(`   Título: ${title}`);
    console.log(`   URL: ${url}`);
    console.log('');
    
    // 6. Extrair conteúdo
    console.log('6. Extraindo conteúdo da página...');
    const content = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      const p = document.querySelector('p');
      return {
        heading: h1 ? h1.textContent : null,
        paragraph: p ? p.textContent.substring(0, 100) : null
      };
    });
    
    console.log(`   H1: ${content.heading}`);
    console.log(`   P: ${content.paragraph}...`);
    console.log('');
    
    // 7. Limpar
    console.log('7. Limpando...');
    await page.close();
    console.log('   ✅ Página fechada');
    
    await browser.disconnect();
    console.log('   ✅ Browser desconectado');
    console.log('');
    
    // Resultado final
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║                  ✅ TESTE CONCLUÍDO COM SUCESSO              ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('Resumo:');
    console.log(`  - Chrome URL: ${CHROME_URL}`);
    console.log(`  - Browser: ${version.Browser}`);
    console.log('  - Conexão: ✅ Funcional');
    console.log('  - Navegação: ✅ Funcional');
    console.log('  - Extração: ✅ Funcional');
    console.log('');
    console.log('🚀 Sistema pronto para automação!');
    
    process.exit(0);
    
  } catch (error) {
    console.error('');
    console.error('╔══════════════════════════════════════════════════════════════╗');
    console.error('║                     ❌ TESTE FALHOU                          ║');
    console.error('╚══════════════════════════════════════════════════════════════╝');
    console.error('');
    console.error('Erro:', error.message);
    console.error('');
    
    if (error.message.includes('ECONNREFUSED') || error.message.includes('fetch failed')) {
      console.error('🔍 DIAGNÓSTICO:');
      console.error('');
      console.error('Chrome não está acessível em:', CHROME_URL);
      console.error('');
      console.error('SOLUÇÃO:');
      console.error('');
      console.error('1. Windows Host - Iniciar Chrome:');
      console.error('   "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" ^');
      console.error('     --remote-debugging-port=9222 ^');
      console.error('     --user-data-dir="C:\\chrome-automation-profile"');
      console.error('');
      console.error('2. Verificar porta está aberta:');
      console.error('   netstat -ano | findstr :9222');
      console.error('');
      console.error('3. Testar conexão:');
      console.error('   curl http://localhost:9222/json/version');
      console.error('');
      console.error('4. Se Docker em Linux, ajustar URL:');
      console.error('   export CHROME_REMOTE_URL="http://172.17.0.1:9222"');
      console.error('');
    } else if (error.message.includes('Target closed')) {
      console.error('🔍 DIAGNÓSTICO:');
      console.error('');
      console.error('Chrome fechou a aba durante navegação.');
      console.error('');
      console.error('SOLUÇÃO:');
      console.error('- Aumentar timeout (atualmente 15s)');
      console.error('- Verificar se site está acessível');
      console.error('- Reiniciar Chrome');
    }
    
    console.error('');
    console.error('📚 Documentação: CHROME_EXTERNAL_SETUP.md');
    console.error('');
    
    process.exit(1);
  }
}

// Executar teste
testChromeConnection();
