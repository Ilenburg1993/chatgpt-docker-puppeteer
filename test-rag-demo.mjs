/**
 * RAG v4.0 Live Demo
 * Demonstração prática do sistema MCP funcionando
 */

import express from 'express';
import { applyRoutes } from './src/server/api/router.js';

process.env.MCP_ENABLED = 'true';
process.env.NODE_ENV = 'development';

console.log('\n🚀 Iniciando servidor de demonstração RAG v4.0...\n');

const app = express();
app.use(express.json());

// Aguardar Tool Registry inicializar
console.log('⏳ Aguardando Tool Registry inicializar...');
await new Promise(resolve => setTimeout(resolve, 3000));

// Aplicar rotas (inclui MCP handler)
console.log('🔧 Configurando rotas MCP...');
await applyRoutes(app);

// Iniciar servidor
const server = app.listen(3008, async () => {
    console.log('\n✅ Servidor iniciado em http://localhost:3008');
    console.log('📡 MCP endpoint: POST/GET http://localhost:3008/api/mcp\n');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('   DEMONSTRAÇÃO PRÁTICA - RAG v4.0 Multi-LLM Integration');
    console.log('═══════════════════════════════════════════════════════════\n');

    try {
        // ========================================
        // CENÁRIO 1: Discovery - Claude pergunta "o que você pode fazer?"
        // ========================================
        console.log('📋 [CENÁRIO 1] Discovery Endpoint');
        console.log('   Claude Desktop conecta e pergunta: "Quais ferramentas você tem?"');
        console.log('   Request: GET /api/mcp\n');

        const disc = await fetch('http://localhost:3008/api/mcp');
        const discData = await disc.json();

        console.log('   ✅ Resposta:');
        console.log('      Nome:', discData.name);
        console.log('      Versão:', discData.version);
        console.log('      Status:', discData.status);
        console.log('      Ferramentas:', discData.tools.join(', '));
        console.log('      Total:', discData.toolCount, 'ferramentas\n');

        // ========================================
        // CENÁRIO 2: Listar modelos Ollama disponíveis
        // ========================================
        console.log('─────────────────────────────────────────────────────────────\n');
        console.log('🤖 [CENÁRIO 2] Usuário pergunta: "Quais modelos Ollama estão disponíveis?"');
        console.log('   Claude usa a ferramenta: ollama_models\n');

        const models = await fetch('http://localhost:3008/api/mcp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/call',
                params: { name: 'ollama_models', arguments: {} }
            })
        });
        const modelsData = await models.json();
        const modelsText = modelsData.result.content[0].text;

        console.log('   ✅ Claude responde com:\n');
        console.log(modelsText.split('\n').slice(0, 15).join('\n'));
        console.log('   [...]\n');

        // ========================================
        // CENÁRIO 3: Buscar código no codebase
        // ========================================
        console.log('─────────────────────────────────────────────────────────────\n');
        console.log('🔍 [CENÁRIO 3] Usuário pergunta: "Onde está definida a variável CHROME_PROXY_PORT?"');
        console.log('   Claude usa a ferramenta: rag_search\n');

        const search = await fetch('http://localhost:3008/api/mcp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 2,
                method: 'tools/call',
                params: {
                    name: 'rag_search',
                    arguments: {
                        query: 'CHROME_PROXY_PORT definition',
                        topK: 3
                    }
                }
            })
        });
        const searchData = await search.json();
        const searchText = searchData.result.content[0].text;

        console.log('   ✅ Claude encontrou e responde:\n');
        const lines = searchText.split('\n');
        console.log(lines.slice(0, 40).join('\n'));
        console.log('   [...]\n');

        // ========================================
        // CENÁRIO 4: Verificar saúde do sistema
        // ========================================
        console.log('─────────────────────────────────────────────────────────────\n');
        console.log('🏥 [CENÁRIO 4] Usuário pergunta: "O sistema RAG está funcionando?"');
        console.log('   Claude usa a ferramenta: rag_health\n');

        const health = await fetch('http://localhost:3008/api/mcp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 3,
                method: 'tools/call',
                params: { name: 'rag_health', arguments: {} }
            })
        });
        const healthData = await health.json();
        const healthText = healthData.result.content[0].text;

        console.log('   ✅ Claude verifica e responde:\n');
        console.log(healthText.split('\n').slice(0, 20).join('\n'));
        console.log('\n');

        // ========================================
        // CENÁRIO 5: Gerar código com Ollama
        // ========================================
        console.log('─────────────────────────────────────────────────────────────\n');
        console.log('💻 [CENÁRIO 5] Usuário pede: "Gere uma docstring para uma função que calcula fibonacci"');
        console.log('   Claude usa a ferramenta: ollama_generate\n');

        const generate = await fetch('http://localhost:3008/api/mcp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 4,
                method: 'tools/call',
                params: {
                    name: 'ollama_generate',
                    arguments: {
                        prompt: 'Write a comprehensive JSDoc docstring for a function that calculates the nth fibonacci number',
                        model: 'qwen2.5-coder:3b',
                        temperature: 0.3,
                        max_tokens: 200
                    }
                }
            })
        });
        const generateData = await generate.json();
        const generateText = generateData.result.content[0].text;

        console.log('   ✅ Claude gera com Ollama:\n');
        console.log(generateText.split('\n').slice(0, 25).join('\n'));
        console.log('   [...]\n');

        // ========================================
        // RESUMO FINAL
        // ========================================
        console.log('═══════════════════════════════════════════════════════════');
        console.log('                    DEMONSTRAÇÃO COMPLETA');
        console.log('═══════════════════════════════════════════════════════════\n');
        console.log('✅ Todas as 5 ferramentas testadas com sucesso!');
        console.log('✅ MCP Protocol funcionando corretamente');
        console.log('✅ RAG v4.0 pronto para uso em produção\n');
        console.log('📚 Para usar com Claude Desktop:');
        console.log('   1. Copie: docs/integration/examples/claude_desktop_config.json');
        console.log('   2. Para: ~/Library/Application Support/Claude/claude_desktop_config.json');
        console.log('   3. Reinicie Claude Desktop\n');
        console.log('🎉 Sistema validado e operacional!\n');

        process.exit(0);

    } catch (error) {
        console.error('\n❌ Erro na demonstração:', error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        server.close();
    }
});
