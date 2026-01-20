const puppeteer = require('puppeteer');

(async () => {
  try {
    console.log('[TEST] Iniciando teste isolado do Puppeteer');

    // Endpoint obtido do curl (com Host: localhost)
    const wsEndpoint =
      'ws://host.docker.internal:9223/devtools/browser/d5a443e3-2e26-4463-a462-141ef57b9d90';

    console.log('[TEST] Conectando via WebSocket direto...');
    const browser = await puppeteer.connect({
      browserWSEndpoint: wsEndpoint,
      defaultViewport: null
    });

    console.log('[TEST] Conectado com sucesso');

    const page = await browser.newPage();
    console.log('[TEST] Página criada');

    await page.goto('https://example.com', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    console.log('[TEST] Página carregada');

    const title = await page.title();
    console.log('[TEST] Título:', title);

    await page.close();
    console.log('[TEST] Página fechada');

    console.log('[TEST] Teste finalizado com sucesso');
  } catch (err) {
    console.error('[TEST] ERRO:', err);
    process.exit(1);
  }
})();
