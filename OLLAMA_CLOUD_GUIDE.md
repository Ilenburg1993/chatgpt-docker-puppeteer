# 🚀 Guia de Uso: Ollama Cloud (qwen3-coder-next & qwen3-next:80b-cloud)

## 📋 Visão Geral

Este projeto usa **Ollama Cloud** para geração de código e texto, com dois modelos principais:

| Modelo | Uso | Specs | Velocidade |
|--------|-----|-------|------------|
| **qwen3-coder-next** | 💻 Código | 80B MoE (3B active), 256k context | 0.9-4s |
| **qwen3-next:80b-cloud** | 💬 Chat/Texto | 80B hybrid attention, high-sparsity MoE | 2-5s |

**Arquitetura Dual-URL:**
- **Cloud** (https://ollama.com): Geração de código/texto
- **Local** (host.docker.internal:11434): Embeddings para RAG (nomic-embed-text)

---

## 🔑 1. Configuração Inicial (Uma Vez)

### Passo 1: Obter API Key

1. Acesse: https://ollama.com/settings/api-keys
2. Crie uma nova API key
3. Copie a chave (exemplo: `dfeda74bd5204c93926b70600e5d0a75.dafd...`)

### Passo 2: Configurar .env.local

Crie ou edite o arquivo `.env.local` (gitignored):

```bash
# Ollama Cloud Configuration
OLLAMA_CLOUD_ENABLED=true
OLLAMA_CLOUD_API_KEY=SUA_API_KEY_AQUI
OLLAMA_CLOUD_BASE_URL=https://ollama.com

# Modelos Cloud (v5.0)
OLLAMA_DEFAULT_MODEL=qwen3-coder-next
OLLAMA_CHAT_MODEL=qwen3-next:80b-cloud

# Ollama Local (Embeddings)
OLLAMA_LOCAL_BASE_URL=http://host.docker.internal:11434
OLLAMA_EMBED_MODEL=nomic-embed-text
```

**⚠️ IMPORTANTE:** Nunca commit `.env.local` no git! Ele já está no `.gitignore`.

---

## 🎯 2. Como Usar (3 Formas)

### Forma 1️⃣: Chamadas Diretas via OllamaClient

**Para Código (qwen3-coder-next):**

```javascript
import { ollama } from './tools/ollama/client.mjs';

// Geração de código
const code = await ollama.generate(
    'Write a JavaScript function to validate email',
    'qwen3-coder-next',
    { temperature: 0.3, num_predict: 200 }
);

console.log(code);
// Output: Código JavaScript limpo e funcional
```

**Para Chat/Texto (qwen3-next:80b-cloud):**

```javascript
import { ollama } from './tools/ollama/client.mjs';

// Chat geral
const answer = await ollama.generate(
    'Explain async/await in JavaScript',
    'qwen3-next:80b-cloud',
    { temperature: 0.7, num_predict: 200 }
);

console.log(answer);
// Output: Explicação clara e concisa
```

---

### Forma 2️⃣: Via MCP Server (HTTP)

**Pré-requisito:** Servidor rodando (`npm start` ou PM2)

**Teste Código (qwen3-coder-next):**

```bash
curl -X POST http://localhost:3008/api/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "ollama_generate",
      "arguments": {
        "prompt": "Write a Python function to reverse a string",
        "model": "qwen3-coder-next",
        "temperature": 0.3,
        "max_tokens": 150
      }
    }
  }'
```

**Teste Chat (qwen3-next:80b-cloud):**

```bash
curl -X POST http://localhost:3008/api/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "ollama_generate",
      "arguments": {
        "prompt": "What is the difference between let and const?",
        "model": "qwen3-next:80b-cloud",
        "temperature": 0.7,
        "max_tokens": 100
      }
    }
  }'
```

---

### Forma 3️⃣: Via Claude Desktop (MCP Stdio)

**Configuração `claude_desktop_config.json`:**

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%AppData%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "chatgpt-docker": {
      "command": "node",
      "args": ["/caminho/absoluto/para/tools/mcp/unified-server.mjs"],
      "env": {
        "OLLAMA_CLOUD_ENABLED": "true",
        "OLLAMA_CLOUD_API_KEY": "SUA_API_KEY_AQUI",
        "OLLAMA_DEFAULT_MODEL": "qwen3-coder-next",
        "OLLAMA_CHAT_MODEL": "qwen3-next:80b-cloud"
      }
    }
  }
}
```

**Uso no Claude Desktop:**

```
Humano: @chatgpt-docker use ollama_generate to write a TypeScript interface for User

Claude Desktop: [Chama a ferramenta ollama_generate com qwen3-coder-next]

Resultado:
interface User {
  id: number;
  name: string;
  email: string;
}
```

---

## 🧪 3. Teste Rápido (Verificação)

Execute este script para verificar se tudo está funcionando:

```bash
node test-qwen3-final.mjs
```

**Saída esperada:**

```
✅ TESTE 1: CÓDIGO com qwen3-coder-next
════════════════════════════════════════
```python
def factorial(n):
    if n == 0 or n == 1:
        return 1
    return n * factorial(n - 1)
```
⏱️  Duração: 0.93s | 📏 Tamanho: 105 chars

✅ TESTE 3: CÓDIGO COMPLEXO com qwen3-coder-next
════════════════════════════════════════
[ApiClient class completa com error handling]
⏱️  Duração: 4.07s | 📏 Tamanho: 1253 chars
```

---

## 📖 4. Para LLMs: Como Usar Programaticamente

### Importar e Usar

```javascript
// 1. Importar cliente Ollama
import { ollama } from './tools/ollama/client.mjs';

// 2. Para geração de CÓDIGO (use qwen3-coder-next)
const codeResult = await ollama.generate(
    'Write a function to [tarefa]',
    'qwen3-coder-next',
    { temperature: 0.3, num_predict: 200 }
);

// 3. Para CHAT/TEXTO (use qwen3-next:80b-cloud)
const chatResult = await ollama.generate(
    'Explain [conceito]',
    'qwen3-next:80b-cloud',
    { temperature: 0.7, num_predict: 150 }
);

// 4. Para EMBEDDINGS (sempre local)
const embedding = await ollama.embed(
    'texto para embedding',
    'nomic-embed-text'
);
// Returns: Array[768] (dimensões)
```

### Parâmetros Importantes

| Parâmetro | Tipo | Descrição | Padrão |
|-----------|------|-----------|--------|
| `prompt` | string | Texto/pergunta/tarefa | (obrigatório) |
| `model` | string | `qwen3-coder-next` ou `qwen3-next:80b-cloud` | `qwen3-coder-next` |
| `temperature` | number | 0-1 (0=determinístico, 1=criativo) | 0.7 |
| `num_predict` | number | Máximo de tokens a gerar (1-4000) | 1000 |

### Escolha de Modelo

**Use qwen3-coder-next quando:**
- ✅ Precisa gerar código (qualquer linguagem)
- ✅ Precisa completar código existente
- ✅ Precisa refatorar código
- ✅ Precisa gerar testes unitários
- ✅ Precisa documentar código (docstrings)

**Use qwen3-next:80b-cloud quando:**
- ✅ Precisa explicar conceitos
- ✅ Precisa responder perguntas gerais
- ✅ Precisa gerar texto/documentação
- ✅ Precisa fazer análise de texto
- ✅ Precisa fazer tradução/resumo

---

## 🐛 5. Troubleshooting

### Erro: "model 'qwen3-next' not found"

**Problema:** Você usou `qwen3-next` sem a tag `:80b-cloud`

**Solução:** Use `qwen3-next:80b-cloud` (com a tag completa)

```javascript
// ❌ Errado
await ollama.generate('Hello', 'qwen3-next');

// ✅ Correto
await ollama.generate('Hello', 'qwen3-next:80b-cloud');
```

---

### Erro: "Cloud authentication failed (401)"

**Problema:** API key não configurada ou inválida

**Solução:**

1. Verifique se `.env.local` existe
2. Verifique se `OLLAMA_CLOUD_API_KEY` está preenchida
3. Gere nova API key em: https://ollama.com/settings/api-keys

```bash
# Verificar configuração
cat .env.local | grep OLLAMA_CLOUD
```

---

### Erro: Timeout / Muito lento

**Problema:** Modelo cloud pode estar sobrecarregado

**Soluções:**

1. **Aumente timeout:**
   ```bash
   # Em .env.local
   OLLAMA_GENERATE_TIMEOUT=120000  # 2 minutos
   ```

2. **Use modelo local como fallback:**
   ```bash
   # Em .env.local
   OLLAMA_CLOUD_ENABLED=false  # Temporariamente
   ```

---

## 📊 6. Métricas de Performance

**Baseado em testes reais:**

| Operação | Modelo | Duração Média | Tokens |
|----------|--------|---------------|--------|
| Código simples | qwen3-coder-next | 0.9-2s | 50-100 |
| Código complexo | qwen3-coder-next | 3-5s | 200-300 |
| Chat simples | qwen3-next:80b-cloud | 2-3s | 50-100 |
| Embedding | nomic-embed-text (local) | <0.5s | 768D |

**Comparação Cloud vs Local:**

| Aspecto | Cloud (qwen3) | Local (qwen2.5:3b) |
|---------|---------------|--------------------|
| Velocidade | 0.9-5s | 30-120s |
| Qualidade | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| Custo | Subscription | Grátis |
| Hardware necessário | Nenhum (cloud GPUs) | 8GB+ RAM |

---

## 🔒 7. Segurança

### ✅ Boas Práticas

1. **Nunca commit API keys:**
   - Use `.env.local` (gitignored)
   - Nunca coloque keys em `.env.example`

2. **Rotacione API keys periodicamente:**
   - Gere novas keys a cada 3-6 meses
   - Revogue keys antigas

3. **Monitore uso:**
   - Verifique dashboard: https://ollama.com/dashboard
   - Configure alertas de quota

### ❌ Evite

- ❌ Logar API keys completas
- ❌ Compartilhar keys em mensagens/emails
- ❌ Usar mesma key em múltiplos projetos (se possível)

---

## 📚 8. Recursos Adicionais

**Documentação Oficial:**
- [Ollama Cloud Docs](https://docs.ollama.com/cloud)
- [qwen3-coder-next Library](https://ollama.com/library/qwen3-coder-next)
- [qwen3-next Library](https://ollama.com/library/qwen3-next)
- [Ollama Pricing](https://ollama.com/pricing)

**Exemplos de Código:**
- `test-qwen3-final.mjs` - Teste completo de ambos os modelos
- `tools/ollama/client.mjs` - Cliente Ollama (código-fonte)
- `src/integration/tools/ollama-tools.mjs` - Ferramentas MCP

---

## 🎓 9. Resumo para LLMs

**Regra simples:**

1. **Tarefa é CÓDIGO?** → Use `qwen3-coder-next`
2. **Tarefa é TEXTO/CHAT?** → Use `qwen3-next:80b-cloud`
3. **Tarefa é EMBEDDING?** → Use `nomic-embed-text` (local)

**Exemplo completo:**

```javascript
import { ollama } from './tools/ollama/client.mjs';

// Geração de código
const code = await ollama.generate(
    'Write a factorial function in Python',
    'qwen3-coder-next',
    { temperature: 0.3, num_predict: 100 }
);

// Chat/explicação
const explanation = await ollama.generate(
    'Explain recursion in simple terms',
    'qwen3-next:80b-cloud',
    { temperature: 0.7, num_predict: 150 }
);

// Embedding (RAG)
const vector = await ollama.embed(
    'search query text',
    'nomic-embed-text'
);
```

**Pronto! 🎉**
