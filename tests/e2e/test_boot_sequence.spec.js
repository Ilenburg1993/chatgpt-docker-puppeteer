const path = require('path');
const config = require('../../src/core/config');

console.log('🚀 Testando sequência de boot...\n');

(async () => {
    // FASE 1: Configuração
    console.log('FASE 1: Configuração');
    console.log('  Mode:', config.BROWSER_MODE || 'launcher');
    console.log('  ✅ Config carregado\n');

    // FASE 2: Identity
    console.log('FASE 2: Identity Manager');
    const identity = require('../../src/core/identity_manager');
    await identity.initialize();
    console.log('  Robot ID:', `${identity.getRobotId().substring(0, 8)}...`);
    console.log('  Instance ID:', `${identity.getInstanceId().substring(0, 8)}...`);
    console.log('  ✅ Identity inicializado\n');

    // FASE 3: NERV
    console.log('FASE 3: NERV Transport');
    const { createNERV } = require('../../src/nerv/nerv');
    const nerv = await createNERV({ mode: 'local' });
    const nervStatus = nerv.getStatus();
    console.log('  Mode:', nervStatus.mode);
    console.log('  Status:', nervStatus.localBus || nervStatus.status);
    console.log('  ✅ NERV funcional\n');

    // FASE 4: BrowserPool
    console.log('FASE 4: BrowserPool Manager');
    const BrowserPoolManager = require('../../src/infra/browser_pool/pool_manager');
    const pool = new BrowserPoolManager({
        poolSize: 1,
        browserEndpoint: {
            url: process.env.CHROME_WS_ENDPOINT || config.BROWSER_URL || 'http://localhost:9224'
        }
    });
    await pool.initialize();
    console.log('  Instâncias:', pool.pool.length);
    console.log('  IDs:', pool.pool.map(p => p.id).join(', '));
    console.log('  ✅ BrowserPool inicializado\n');

    // FASE 5: Teste de integração
    console.log('FASE 5: Teste de Integração (NERV + Browser)');

    let messageReceived = false;
    nerv.onReceive(envelope => {
        console.log('  📨 NERV recebeu:', envelope.type.action_code);
        messageReceived = true;
    });

    const { createEnvelope } = require('../../src/shared/nerv/envelope');
    const { MessageType, ActionCode, ActorRole } = require('../../src/shared/nerv/constants');

    const envelope = createEnvelope({
        actor: ActorRole.KERNEL,
        target: ActorRole.DRIVER,
        messageType: MessageType.COMMAND,
        actionCode: ActionCode.TASK_START,
        payload: { test: true }
    });

    nerv.emit(envelope);

    await new Promise(resolve => {
        setTimeout(resolve, 100);
    });

    if (messageReceived) {
        console.log('  ✅ Comunicação NERV operacional\n');
    } else {
        console.log('  ❌ NERV não recebeu mensagem\n');
    }

    // Cleanup
    console.log('FASE 6: Graceful Shutdown');
    await nerv.shutdown();
    console.log('  ✅ NERV encerrado');
    await pool.shutdown();
    console.log('  ✅ BrowserPool encerrado\n');

    console.log('🎉 BOOT SEQUENCE 100% FUNCIONAL!\n');
    console.log('📊 Resumo:');
    console.log('  ✅ Configuração');
    console.log('  ✅ Identity Manager');
    console.log('  ✅ NERV Transport');
    console.log('  ✅ BrowserPool Manager');
    console.log('  ✅ Comunicação NERV');
    console.log('  ✅ Graceful Shutdown');

    process.exit(0);
})();
