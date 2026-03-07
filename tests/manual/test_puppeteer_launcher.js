// @ts-check
import puppeteer from 'puppeteer-core';

(async () => {
    console.log('🚀 Teste rápido: connect-only (puppeteer-core)...');

    const browserURL =
        process.env.CHROME_WS_ENDPOINT ||
        process.env.CHROME_URL ||
        `http://localhost:${process.env.CHROME_PROXY_PORT || 9224}`;
    const browser = await puppeteer.connect(
        /** @type {any} */ ({
            browserURL,
            defaultViewport: { width: 1280, height: 800 },
            ignoreHTTPSErrors: true,
        })
    );

    console.log('✅ Puppeteer conectado (connect-only)');
    console.log('   Versão:', await browser.version());

    const page = await browser.newPage();
    console.log('✅ Página criada');

    await page.goto('https://example.com', { waitUntil: 'networkidle0', timeout: 10000 });
    console.log('✅ Navegou para example.com');

    const title = await page.title();
    console.log('✅ Título:', title);

    await page.close();
    await browser.disconnect();
    console.log('✅ Desconectado (não encerra o Chrome remoto)');

    process.exit(0);
})().catch(err => {
    console.error('❌ Erro no teste:', err);
    process.exit(1);
});
