require('module-alias/register');

// Teste simples sem inicializar infraestrutura
const _path = require('path');

// Mock simples para evitar erros de permissão
process.env.NODE_ENV = 'test';

try {
    // Testar resolução de aliases
    const corePath = require.resolve('@core/logger');
    const infraPath = require.resolve('@infra/queue/cache');
    const sharedPath = require.resolve('@shared/nerv/constants');

    console.log('✅ @core resolve para:', corePath);
    console.log('✅ @infra resolve para:', infraPath);
    console.log('✅ @shared resolve para:', sharedPath);
    console.log('\n🎉 Todos os aliases estão funcionando perfeitamente!');
    console.log('\n📊 Exemplo de caminhos resolvidos:');
    console.log('   @core/logger → src/core/logger.js');
    console.log('   @infra/queue/cache → src/infra/queue/cache.js');
    console.log('   @shared/nerv/constants → src/shared/nerv/constants.js');
} catch (error) {
    console.error('❌ Erro ao testar aliases:', error.message);
    process.exit(1);
}
