/* ============================================================================
   test-proxy-final.js
   Teste End-to-End: Puppeteer → Chrome Proxy PM2 → Chrome Windows

   Valida:
   - Conexão através do proxy gerenciado por PM2
   - Navegação em página web
   - Captura de screenshot
   - Desconexão limpa
============================================================================ */

const puppeteer = require('puppeteer-core');

const CONFIG = {
    PROXY_URL: 'http://localhost:9224',
    TEST_URL: 'https://example.com',
    TIMEOUT: 15000,
};

async function runTest() {
    console.log('\n🧪 TESTE END-TO-END: Puppeteer → Chrome Proxy (PM2) → Chrome Windows\n');
    console.log('═'.repeat(70));

    let browser = null;
    let testsPassed = 0;
    const totalTests = 5;

    try {
        // Test 1: Get browser WebSocket endpoint
        console.log('\n[1/5] Obtendo WebSocket endpoint do Chrome via proxy...');
        const versionResponse = await fetch(`${CONFIG.PROXY_URL}/json/version`);
        const versionData = await versionResponse.json();
        console.log(`✓ Chrome Version: ${versionData.Browser}`);
        console.log(`✓ WebSocket: ${versionData.webSocketDebuggerUrl}`);
        testsPassed++;

        // Test 2: Connect Puppeteer to Chrome
        console.log('\n[2/5] Conectando Puppeteer ao Chrome...');
        browser = await puppeteer.connect({
            browserWSEndpoint: versionData.webSocketDebuggerUrl,
            defaultViewport: null,
        });
        console.log(`✓ Conectado! Browser: ${await browser.version()}`);
        testsPassed++;

        // Test 3: Navigate to page
        console.log(`\n[3/5] Navegando para ${CONFIG.TEST_URL}...`);
        const page = await browser.newPage();
        await page.goto(CONFIG.TEST_URL, {
            waitUntil: 'networkidle2',
            timeout: CONFIG.TIMEOUT,
        });
        const title = await page.title();
        console.log(`✓ Página carregada: "${title}"`);
        testsPassed++;

        // Test 4: Execute JavaScript
        console.log('\n[4/5] Executando JavaScript na página...');
        const headingText = await page.evaluate(() => {
            const h1 = document.querySelector('h1');
            return h1 ? h1.textContent : 'N/A';
        });
        console.log(`✓ Heading encontrado: "${headingText}"`);
        testsPassed++;

        // Test 5: Take screenshot
        console.log('\n[5/5] Capturando screenshot...');
        const screenshotPath = '/workspaces/chatgpt-docker-puppeteer/test-proxy-screenshot.png';
        await page.screenshot({ path: screenshotPath });
        console.log(`✓ Screenshot salvo: ${screenshotPath}`);
        testsPassed++;

        await page.close();
    } catch (error) {
        console.error(`\n❌ ERRO: ${error.message}`);
        console.error(error.stack);
    } finally {
        if (browser) {
            console.log('\n[CLEANUP] Desconectando do Chrome...');
            await browser.disconnect();
            console.log('✓ Desconectado com sucesso');
        }
    }

    console.log('\n' + '═'.repeat(70));
    console.log(`\n📊 RESULTADO: ${testsPassed}/${totalTests} testes passaram`);

    if (testsPassed === totalTests) {
        console.log('\n🎉 SUCESSO! Integração completa funcionando:');
        console.log('   ✓ Chrome Proxy (PM2) → Online');
        console.log('   ✓ Container → host.docker.internal → Windows Chrome');
        console.log('   ✓ Puppeteer → Proxy → Chrome → Navegação OK');
        console.log('   ✓ Screenshot capturado com sucesso');
    } else {
        console.log(`\n⚠️  ${totalTests - testsPassed} teste(s) falharam`);
        process.exit(1);
    }
}

runTest().catch((err) => {
    console.error('\n💥 Falha catastrófica:', err);
    process.exit(1);
});
