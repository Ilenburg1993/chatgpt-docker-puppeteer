# 🔗 Integração com GitHub MCP Server

## 📋 Visão Geral

Este guia explica como integrar o servidor MCP do GitHub oficial com nosso servidor MCP unificado,
permitindo que todas as LLMs (Claude, Copilot, OpenCode) acessem funcionalidades do GitHub através
de uma única interface.

### O Que É o GitHub MCP Server?

O **GitHub MCP Server** é um servidor oficial mantido pelo GitHub que expõe funcionalidades da API
do GitHub como ferramentas MCP:

- 🔍 Buscar repositórios, issues, PRs, código
- 📝 Criar/atualizar issues e PRs
- 👥 Gerenciar colaboradores, reviews
- 📊 Acessar estatísticas e insights

**Repositório:**
[modelcontextprotocol/servers/github](https://github.com/modelcontextprotocol/servers/tree/main/src/github)

---

## 🏗️ Arquitetura da Integração

### Modelo 1: Direct (Recomendado para Desenvolvimento)

Cada LLM conecta diretamente aos 2 servidores MCP:

```
┌─────────────────────────────────────────────────────────────┐
│  LLM (Claude Desktop, Copilot, etc.)                        │
└────────┬───────────────────────────────────┬────────────────┘
         │                                   │
         │ MCP HTTP                          │ MCP Stdio
         ↓                                   ↓
┌──────────────────────────────┐  ┌──────────────────────────┐
│  Nosso MCP Server            │  │  GitHub MCP Server       │
│  localhost:3008/api/mcp      │  │  (npx @modelcontext...)  │
├──────────────────────────────┤  ├──────────────────────────┤
│ Tools:                       │  │ Tools:                   │
│ • rag_search                 │  │ • create_or_update_file  │
│ • rag_health                 │  │ • search_repositories    │
│ • ollama_generate            │  │ • create_issue           │
│ • ollama_embed               │  │ • fork_repository        │
│ • ollama_models              │  │ • push_files             │
└──────────────────────────────┘  │ • ... (25+ tools)        │
                                  └──────────────────────────┘
```

**Vantagens:**

- ✅ Simples de configurar
- ✅ Sem overhead de proxy
- ✅ Ferramentas nativas de cada servidor

**Desvantagens:**

- ⚠️ Cliente precisa configurar ambos os servidores
- ⚠️ Nomenclatura de tools pode colidir (improvável)

---

### Modelo 2: Upstream Proxy (Recomendado para Produção)

Nosso servidor importa tools do GitHub MCP via upstream e reexporta tudo unificado:

```
┌─────────────────────────────────────────────────────────────┐
│  LLM (Claude Desktop, Copilot, etc.)                        │
└────────────────────────────┬────────────────────────────────┘
                             │ MCP HTTP
                             ↓
┌─────────────────────────────────────────────────────────────┐
│  Nosso MCP Server (Unified Proxy)                           │
│  localhost:3008/api/mcp                                     │
├─────────────────────────────────────────────────────────────┤
│ NATIVE Tools:                       UPSTREAM Tools:         │
│ • rag_search                        • mcp_github__create_*  │
│ • rag_health                        • mcp_github__search_*  │
│ • ollama_*                          • mcp_github__fork_*    │
│                                     • ... (prefixadas)      │
└────────────────────────┬────────────────────────────────────┘
                         │ MCP Stdio (interno)
                         ↓
                ┌──────────────────────┐
                │ GitHub MCP Server    │
                │ (child process)      │
                └──────────────────────┘
```

**Vantagens:**

- ✅ Cliente configura apenas 1 servidor
- ✅ Controle centralizado (rate limiting, audit log)
- ✅ Namespace claro (`mcp_github__*`)

**Desvantagens:**

- ⚠️ Mais complexo de implementar
- ⚠️ Overhead de proxy (mínimo)

---

## 🚀 Setup: Modelo 1 (Direct) - Recomendado

### Step 1: Instalar GitHub MCP Server

```bash
# Instalar globalmente (recomendado)
npm install -g @modelcontextprotocol/server-github

# OU instalar localmente no projeto
cd /workspaces/chatgpt-docker-puppeteer
npm install --save-dev @modelcontextprotocol/server-github
```

### Step 2: Obter GitHub Token

1. Acesse: https://github.com/settings/tokens/new
2. Selecione scopes:
   - ✅ `repo` (acesso full a repositórios)
   - ✅ `read:org` (listar organizações)
   - ✅ `user` (informações do usuário)
3. Gere o token e copie (ex: `ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`)

**⚠️ Segurança:** Nunca commite tokens no Git! Use `.env` local.

### Step 3: Configurar Cliente MCP

#### Claude Desktop

Edite `~/.config/Claude/claude_desktop_config.json` (Linux):

```json
{
  "mcpServers": {
    "chatgpt-docker": {
      "url": "http://localhost:3008/api/mcp",
      "transport": "http"
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

**Windows:** `%AppData%/Claude/claude_desktop_config.json` **macOS:**
`~/Library/Application Support/Claude/claude_desktop_config.json`

#### GitHub Copilot (VSCode)

**GitHub MCP Server já está integrado nativamente!** Apenas habilite:

`.vscode/settings.json`:

```json
{
  "github.copilot.chat.githubMcpServer.enabled": true
}
```

⚠️ **Nota:** O GitHub MCP do Copilot usa seu token do GitHub automaticamente, sem necessidade de
configuração manual.

#### OpenCode CLI

Edite `~/opencode/config.json`:

```json
{
  "mcpServers": {
    "chatgpt-docker": {
      "command": "node",
      "args": ["/workspaces/chatgpt-docker-puppeteer/tools/mcp/unified-server.mjs"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

### Step 4: Reiniciar Cliente e Testar

**Claude Desktop:**

```bash
# Feche e reabra Claude Desktop
# Teste no chat:
"List all tools available"
# Deve mostrar: rag_search, rag_health, ollama_*, create_or_update_file, search_repositories, etc.
```

**VSCode Copilot:**

```bash
# Reload VSCode: Ctrl+Shift+P → "Developer: Reload Window"
# Teste no Copilot Chat:
"@github search repositories with topic:mcp in:name"
"@workspace use rag_search to find CHROME_PROXY_PORT"
```

### Step 5: Validar Integração

Teste ambos os servidores:

```bash
# 1. Nosso servidor MCP
curl http://localhost:3008/api/mcp | jq '.tools[]'
# Deve retornar: rag_search, rag_health, ollama_*

# 2. GitHub MCP Server (via LLM - não tem HTTP endpoint direto)
# No Claude/Copilot:
"Use create_issue to create a test issue in myrepo"
"Search for repositories with stars > 1000"
```

---

## 🔧 Setup: Modelo 2 (Upstream Proxy) - Avançado

Este modo faz o **cliente conectar apenas no nosso MCP HTTP**, enquanto o nosso servidor:

- spawna um servidor MCP upstream (ex.: GitHub MCP) via **stdio**
- importa `tools/list` do upstream
- reexporta as tools no nosso MCP com um prefixo (ex.: `mcp_github__*`)

A implementação é feita com o **MCP SDK oficial** e um “manager” único:

- `src/integration/mcp/upstream-manager.mjs`
- `src/integration/mcp/upstream-stdio-sdk.mjs`

### Opção A (preset oficial): GitHub Proxy via ENV

No servidor:

```bash
# .env.local (recomendado)
MCP_GITHUB_PROXY_ENABLED=true
MCP_GITHUB_TOOL_PREFIX=mcp_github__
GITHUB_PERSONAL_ACCESS_TOKEN=ghp_...
```

Notas:

- Se `MCP_GITHUB_PROXY_ENABLED=true` e o token estiver vazio, o servidor **não cai**: o upstream
  fica **not-ready** e aparece em `/ready`.
- As tools importadas aparecem como `mcp_github__<toolName>` (ex.:
  `mcp_github__search_repositories`).

### Opção B (genérico): múltiplos upstreams via `MCP_UPSTREAMS_JSON`

Você pode integrar **outros MCPs** (HTTP ou stdio) além do GitHub:

```bash
MCP_UPSTREAMS_JSON=[
  {"alias":"core","transport":"http","url":"http://localhost:4000/api/mcp","toolPrefix":"mcp_core__"},
  {"alias":"github","transport":"stdio","command":"npx","args":["-y","@modelcontextprotocol/server-github"],"envFrom":["GITHUB_PERSONAL_ACCESS_TOKEN"],"toolPrefix":"mcp_github__"}
]
```

Notas:

- Se `MCP_UPSTREAMS_JSON` estiver setado, ele **tem precedência** sobre o legado `MCP_UPSTREAM_*`.
- Para stdio, use `envFrom` para repassar variáveis do processo (ex.:
  `GITHUB_PERSONAL_ACCESS_TOKEN`) sem hardcode.

### Compatibilidade (legado): `MCP_UPSTREAM_ENABLED` (1 upstream HTTP)

Se você já usa o modo legado:

```bash
MCP_UPSTREAM_ENABLED=true
MCP_UPSTREAM_URL=http://localhost:4000/api/mcp
MCP_UPSTREAM_ALIAS=upstream
MCP_UPSTREAM_TOOL_PREFIX=mcp_upstream__
```

### Diagnóstico e “defesas”

1. Diagnóstico automático:

```bash
npm run mcp:diagnose
```

2. Readiness com upstreams:

```bash
curl -s http://localhost:3008/ready | jq '.mcp.upstreams'
```

3. Retry best-effort (opcional):

```bash
MCP_UPSTREAM_RESTART_ENABLED=true
MCP_UPSTREAM_RESTART_BACKOFF_MS=5000
MCP_UPSTREAM_RESTART_MAX=10
```

---

## 🧪 Casos de Uso: RAG + GitHub

### 1. Buscar código localmente e criar issue

**Prompt (Claude/Copilot):**

```
1. Use rag_search to find all occurrences of "CHROME_PROXY_PORT" in the codebase
2. Analyze the results
3. Use create_issue to create a GitHub issue suggesting we document this configuration better
```

**Resultado:**

- ✅ RAG encontra 15 ocorrências em 8 arquivos
- ✅ LLM analisa e identifica falta de documentação
- ✅ GitHub MCP cria issue automaticamente

### 2. Gerar código e fazer commit

**Prompt:**

```
1. Use ollama_generate to create a new utility function for parsing Chrome URLs
2. Save the code to a new file using create_or_update_file
3. Create a PR using create_pull_request with the implementation
```

**Resultado:**

- ✅ Ollama gera código TypeScript
- ✅ GitHub MCP cria arquivo no repo
- ✅ GitHub MCP abre PR automático

### 3. Buscar Issues + Context

**Prompt:**

```
1. Search for open issues with label "bug" using search_issues
2. For each issue, use rag_search to find relevant code in our codebase
3. Suggest fixes using ollama_generate
```

**Resultado:**

- ✅ Encontra 5 bugs abertos
- ✅ RAG localiza código relevante
- ✅ Ollama sugere correções específicas

---

## 📊 Comparação: Nosso MCP vs GitHub MCP

| Feature             | Nosso MCP                       | GitHub MCP               |
| ------------------- | ------------------------------- | ------------------------ |
| **Codebase Search** | ✅ Hybrid (Vector+FTS)          | ❌                       |
| **Local LLM**       | ✅ Ollama (3+ modelos)          | ❌                       |
| **GitHub API**      | ❌                              | ✅ 25+ operations        |
| **File Operations** | ❌ (apenas search)              | ✅ CRUD completo         |
| **PR Management**   | ❌                              | ✅ Create, review, merge |
| **Transport**       | HTTP (melhor para multi-client) | Stdio (mais seguro)      |

**Conclusão:** São **complementares**, não competidores. Use ambos!

---

## 🔒 Segurança & Boas Práticas

### Gerenciamento de Tokens

**✅ FAZER:**

```bash
# Usar .env.local (não commitado)
echo "GITHUB_PERSONAL_ACCESS_TOKEN=ghp_xxx" > .env.local
source .env.local

# OU usar secret manager
export GITHUB_PERSONAL_ACCESS_TOKEN=$(pass show github/mcp-token)
```

**❌ NÃO FAZER:**

```bash
# NUNCA commitar tokens
git add .env.development  # Se contém token real

# NUNCA logar tokens
console.log(process.env.GITHUB_PERSONAL_ACCESS_TOKEN)
```

### Rate Limiting

GitHub API tem limites:

- **Authenticated:** 5,000 requests/hora
- **Search API:** 30 requests/minuto

**Implementar cache:**

```javascript
// Cachear resultados de search_repositories por 5 minutos
const GITHUB_CACHE_TTL = 300000; // 5 min
```

### Audit Log

Todas as operações GitHub devem ser auditadas:

```javascript
// Em cada tool call
registry.on('tool:execute', ({ name, params, user }) => {
  if (name.startsWith('mcp_github__')) {
    auditLog.write({
      timestamp: Date.now(),
      user,
      tool: name,
      params: sanitize(params), // Remove tokens
      ip: getClientIP(),
    });
  }
});
```

---

## 🐛 Troubleshooting

### Erro: "GitHub token not configured"

**Causa:** Token não foi passado para o GitHub MCP Server.

**Solução:**

```bash
# Verificar se token existe
echo $GITHUB_PERSONAL_ACCESS_TOKEN

# Se vazio, configurar
export GITHUB_PERSONAL_ACCESS_TOKEN="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# Reiniciar cliente (Claude Desktop, etc.)
```

### Erro: "API rate limit exceeded"

**Causa:** Muitas requests à API do GitHub.

**Soluções:**

1. Implementar cache (TTL 5-10 min)
2. Usar `conditional requests` (ETag/If-Modified-Since)
3. Aguardar reset do rate limit (header `X-RateLimit-Reset`)

### Tool não aparece na lista

**Causa:** Upstream import falhou.

**Debug:**

```bash
# Ver logs do servidor
pm2 logs dashboard-web | grep "MCP Upstream"

# Deve mostrar:
# [MCP Upstream] Starting: npx -y @modelcontextprotocol/server-github
# [MCP Upstream] Ready
# [Tool Registry] Found 25 upstream tools
# [Tool Registry] Registered 25 upstream tools
```

---

## 📈 Métricas & Monitoring

### Tools mais usadas

```javascript
// Adicionar em tool-registry.mjs
const toolUsageStats = new Map();

registry.on('tool:execute', ({ name }) => {
  toolUsageStats.set(name, (toolUsageStats.get(name) || 0) + 1);
});

// Expor via /api/mcp/stats
app.get('/api/mcp/stats', (req, res) => {
  const sorted = Array.from(toolUsageStats.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  res.json({
    topTools: Object.fromEntries(sorted),
    totalCalls: Array.from(toolUsageStats.values()).reduce((a, b) => a + b, 0),
  });
});
```

---

## 🎓 Conclusão

### ✅ Implementação Recomendada

Para **desenvolvimento/prototipagem:**

- Use **Modelo 1 (Direct)**: Simples, rápido, sem overhead

Para **produção:**

- Use **Modelo 2 (Upstream Proxy)**: Controle centralizado, audit log, rate limiting

### 📚 Próximos Passos

1. ✅ Proxy/Upstream via stdio (MCP SDK) + `/ready` com upstreams
2. ⏳ Adicionar cache para chamadas do GitHub MCP (opcional)
3. ⏳ Implementar audit log de operações GitHub (opcional)
4. ⏳ Criar tools híbridas (ex: `smart_search` = rag_search + search_code GitHub)
5. ⏳ Dashboard UI para visualizar tools disponíveis

---

**Versão:** 1.0 **Data:** 07/02/2026 **Autor:** GitHub Copilot **Status:** ✅ Guia Completo
