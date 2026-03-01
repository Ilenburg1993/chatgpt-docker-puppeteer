# 🔗 GitHub MCP Integration - Quick Start

## TL;DR

✅ **É possível integrar com o GitHub MCP Server oficial!**

O projeto suporta **2 modelos de integração**:

### 🎯 Modelo 1: Direct (Recomendado)

Ambos os servidores MCP rodam lado a lado:

- **Nosso MCP** (`localhost:3008/api/mcp`): RAG search + Ollama
- **GitHub MCP** (stdio via npx): GitHub API (issues, PRs, repos)

**Setup em 3 passos:**

```bash
# 1. Instalar GitHub MCP
npm install -g @modelcontextprotocol/server-github

# 2. Gerar token: https://github.com/settings/tokens/new
# Scopes: repo, read:org, user

# 3. Configurar Claude Desktop
# Edite ~/.config/Claude/claude_desktop_config.json
```

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
        "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_YOUR_TOKEN_HERE"
      }
    }
  }
}
```

**Pronto!** Agora você tem:

- ✅ `rag_search` - Busca no codebase local
- ✅ `ollama_generate` - Geração de código local
- ✅ `create_or_update_file` - Criar arquivos no GitHub
- ✅ `create_issue` - Criar issues
- ✅ `search_repositories` - Buscar repos
- ✅ 25+ tools do GitHub disponíveis

---

### 🔄 Modelo 2: Upstream Proxy (Avançado)

Nosso servidor importa e reexporta tools do GitHub MCP com prefixo `mcp_github__*`.

**Vantagens:**

- Cliente só precisa configurar 1 servidor
- Controle centralizado (rate limiting, audit log)

**Status:** ✅ Suportado (Proxy via stdio + MCP SDK)

**Como habilitar (server-side):**

```bash
# .env.local (recomendado)
MCP_GITHUB_PROXY_ENABLED=true
GITHUB_PERSONAL_ACCESS_TOKEN=ghp_...
```

Opcional (retry best-effort se o upstream falhar no boot):

```bash
MCP_UPSTREAM_RESTART_ENABLED=true
```

**Como validar rapidamente:**

```bash
npm run mcp:diagnose
curl -s http://localhost:3008/ready | jq '.mcp.upstreams'
```

---

## 📚 Documentação Completa

➡️ **[GITHUB_MCP_INTEGRATION.md](./GITHUB_MCP_INTEGRATION.md)** (6,800+ palavras)

**Inclui:**

- Arquitetura detalhada (diagramas)
- Guia de setup passo a passo
- Casos de uso (RAG + GitHub combo)
- Troubleshooting
- Segurança (token management, rate limiting)

---

## 🧪 Testar Integração

```bash
# Test script completo
bash docs/integration/examples/test_github_mcp_integration.sh

# Ou manual:
curl http://localhost:3008/api/mcp | jq '.toolCount'
# Deve mostrar: 5 (ou mais se upstream habilitado)
```

---

## 🎓 Casos de Uso Poderosos

### 1. Buscar + Criar Issue

```
Prompt: "Use rag_search para encontrar todos os TODOs no código,
então crie um GitHub issue com create_issue listando todos"
```

### 2. Gerar + Commit

```
Prompt: "Use ollama_generate para criar uma função de retry,
depois use create_or_update_file para salvar em utils/retry.js"
```

### 3. Search + Context

```
Prompt: "Busque issues abertas com label:bug usando search_issues,
para cada uma use rag_search para achar código relacionado"
```

---

## 🔒 Segurança

**⚠️ NUNCA commite tokens no Git!**

✅ Usar `.env.local` (gitignored):

```bash
echo "GITHUB_PERSONAL_ACCESS_TOKEN=ghp_xxx" > .env.local
echo ".env.local" >> .gitignore
```

✅ Ou secrets manager:

```bash
export GITHUB_PERSONAL_ACCESS_TOKEN=$(pass show github/mcp-token)
```

---

## 📊 Status Atual

| Componente                      | Status       | Detalhes                                   |
| ------------------------------- | ------------ | ------------------------------------------ |
| **Nosso MCP Server**            | ✅ Produção  | 5 tools funcionais                         |
| **GitHub MCP (Direct)**         | ✅ Pronto    | Setup em 3 passos                          |
| **GitHub MCP (Upstream/Proxy)** | ✅ Produção  | Import via stdio + prefixo `mcp_github__*` |
| **Documentação**                | ✅ Completa  | 6,800+ palavras                            |
| **Testes**                      | ✅ Funcional | Script de teste pronto                     |

---

## 🚀 Próximos Passos

1. ✅ **Direct:** use GitHub MCP nativo do cliente (melhor UX)
2. ✅ **Proxy:** use `MCP_GITHUB_PROXY_ENABLED=true` para centralizar o GitHub via nosso MCP
3. 📈 **Futuro:** tools híbridas (ex: `smart_search = RAG + GitHub`)

---

**Criado:** 07/02/2026 **Versão:** 1.0 **Guia Completo:**
[GITHUB_MCP_INTEGRATION.md](./GITHUB_MCP_INTEGRATION.md)
