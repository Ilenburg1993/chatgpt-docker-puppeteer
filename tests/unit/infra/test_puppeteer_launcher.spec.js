const puppeteer = require('puppeteer');

(async () => {
    console.log('🚀 Iniciando Puppeteer (modo launcher)...');

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });

    console.log('✅ Browser iniciado!');
    console.log('   Versão:', await browser.version());

    const page = await browser.newPage();
    console.log('✅ Página criada');

    await page.goto('https://example.com', { waitUntil: 'networkidle0', timeout: 10000 });
    console.log('✅ Navegou para example.com');

    const title = await page.title();
    console.log('✅ Título:', title);

    await browser.close();
    console.log('✅ Browser fechado');

    console.log('\n🎉 Puppeteer funcional! Use modo launcher no código.');

    // Força encerramento do processo
    process.exit(0);
})().catch(err => {
    console.error('❌ Erro no teste:', err);
    process.exit(1);
});
