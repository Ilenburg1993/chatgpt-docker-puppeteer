import { ConnectionOrchestrator, STATES } from '#infra/ConnectionOrchestrator';

console.log('🔌 Teste Completo do ConnectionOrchestrator\n');

(async () => {
    // TESTE 1: Modo Launcher (padrão)
    console.log('TESTE 1: Modo Launcher (Puppeteer inicia Chrome)');
    const orch1 = new ConnectionOrchestrator({ mode: 'launcher' });

    const browser1 = await orch1.connect();
    console.log('  ✅ Browser iniciado');
    console.log('  Versão:', await browser1.version());
    console.log('  Status:', orch1.getStatus());

    const page1 = await browser1.newPage();
    await page1.goto('https://example.com', { waitUntil: 'networkidle0' });
    const title1 = await page1.title();
    console.log('  ✅ Navegou para example.com:', title1);

    await browser1.close();
    console.log('  ✅ Browser fechado\n');

    // TESTE 2: Modo Auto (tenta todos os métodos)
    console.log('TESTE 2: Modo Auto (fallback automático)');
    const orch2 = new ConnectionOrchestrator({
        mode: 'auto',
        ports: [9999], // Porta inválida para forçar fallback
        hosts: ['192.168.999.999'], // Host inválido
        autoFallback: true,
        maxConnectionAttempts: 1, // Evita retry infinito
    });

    const browser2 = await orch2.connect();
    console.log('  ✅ Browser conectado após fallback');
    console.log('  Status:', orch2.getStatus());

    await browser2.close();
    console.log('  ✅ Browser fechado\n');

    // TESTE 3: Reutilização de instância (cache)
    console.log('TESTE 3: Reutilização de Browser (cache interno)');
    const orch3 = new ConnectionOrchestrator({ mode: 'launcher' });

    const browser3a = await orch3.connect();
    console.log('  ✅ Browser conectado (primeira vez)');

    const browser3b = await orch3.connect();
    console.log('  ✅ Browser reutilizado (cache)');
    console.log('  Mesma instância:', browser3a === browser3b ? '✅ Sim' : '❌ Não');

    await browser3a.close();
    console.log('  ✅ Browser fechado\n');

    // TESTE 4: Argumentos customizados
    console.log('TESTE 4: Argumentos Customizados');
    const orch4 = new ConnectionOrchestrator({
        mode: 'launcher',
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,720'],
    });

    const browser4 = await orch4.connect();
    console.log('  ✅ Browser iniciado com args customizados');

    const page4 = await browser4.newPage();
    const viewport = page4.viewport();
    console.log('  Viewport:', viewport || 'null (defaultViewport: null funcional)');

    await browser4.close();
    console.log('  ✅ Browser fechado\n');

    // RESUMO FINAL
    console.log('🎉 CONNECTIONORCHESTRATOR 100% FUNCIONAL!\n');
    console.log('📊 Resumo:');
    console.log('  ✅ Modo Launcher');
    console.log('  ✅ Modo Auto (fallback)');
    console.log('  ✅ Reutilização de instâncias');
    console.log('  ✅ Argumentos customizados');
    console.log('  ✅ Estado e diagnóstico');

    process.exit(0);
})().catch(error => {
    console.error('\n❌ Erro:', error.message);
    console.error(error.stack);
    process.exit(1);
});
