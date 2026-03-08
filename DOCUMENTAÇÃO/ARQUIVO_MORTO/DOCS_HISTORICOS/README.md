# RAG v4.0: Multi-LLM Integration Guide

## 📋 Overview

This project exposes a **unified MCP (Model Context Protocol) server** that provides semantic code
search and Ollama model access to all major LLMs:

- ✅ **Claude Desktop** (MCP native)
- ✅ **GitHub Copilot** (MCP via HTTP)
- ✅ **OpenCode CLI** (MCP native)
- ✅ **Cursor/Codex** (REST API fallback)

**Single Server, Multiple Protocols:**

- MCP Streamable HTTP: `http://localhost:3008/api/mcp` (Claude, OpenCode, Copilot)
- REST API: `http://localhost:3008/api/rag/*` (Cursor, generic HTTP clients)

### 🔗 GitHub MCP Integration

Este servidor pode ser **combinado com o GitHub MCP Server** para acesso completo à API do GitHub.
Veja o guia completo: **[GITHUB_MCP_INTEGRATION.md](./GITHUB_MCP_INTEGRATION.md)**

**Combinação poderosa:**

- 🔍 Nosso MCP: Busca semântica no codebase + Ollama local
- 🐙 GitHub MCP: Criar issues/PRs, buscar repositórios, code review

**Setup rápido:** Ambos os servidores rodam lado a lado - veja exemplos em
[examples/claude_desktop_config_with_github.json](./examples/claude_desktop_config_with_github.json)

---

## 🛠️ Available Tools

### RAG Tools (Semantic Code Search)

**1. `rag_search`** - Hybrid semantic search

- Combines Vector + Full-Text + Reranking + MMR
- Searches 440+ files, 5,645 code chunks
- Example: `"Where is CHROME_PROXY_PORT defined?"`

**2. `rag_health`** - System health check

- LanceDB status
- Ollama connectivity
- Cache statistics

### Ollama Tools (Local LLM Access)

**3. `ollama_generate`** - Text generation

- Models: `qwen2.5-coder:7b`, `qwen2.5-coder:3b`, `qwen2.5:3b-instruct`
- Use cases: Code generation, docstrings, explanations
- Example: `"Generate a docstring for this function"`

**4. `ollama_embed`** - Generate embeddings

- Model: `nomic-embed-text` (768D)
- Use cases: Similarity comparison, clustering

**5. `ollama_models`** - List available models

- Shows all Ollama models on host
- Includes size, parameters, last modified

---

## ⚡ CPU Optimization

### Default Configuration (NEW - v4.1)

The system is now optimized for CPU-only inference:

- **Default model:** `qwen2.5-coder:3b` (changed from 7b)
- **Max tokens:** 1000 (changed from 2000)
- **Timeout:** 60s (changed from 120s)

**Why these changes?** On CPU-only systems (16GB RAM, i5-9600K), the 3b model is:

- **2x faster** than 7b (200 vs 100 tokens/min)
- **50% less RAM** (4 GB vs 8 GB when loaded)
- **Fewer timeouts** (realistic expectations for CPU inference)

### Hardware Recommendations

**Minimum:**

- 8GB RAM
- 4-core CPU
- Models: `nomic-embed-text` (0.27 GB) only

**Recommended:**

- 16GB RAM
- 6-core CPU (i5-9600K or better)
- Models: `nomic-embed-text` + `qwen2.5-coder:3b` (2.2 GB total)

**Optimal:**

- 32GB+ RAM
- 8+ core CPU or GPU
- Models: All models including 7b for maximum quality

### Model Selection Guide

For detailed CPU optimization, model removal instructions, timeout configuration, and
troubleshooting, see:

📖 **[OLLAMA_CPU_OPTIMIZATION.md](./OLLAMA_CPU_OPTIMIZATION.md)**

---

## 🚀 Setup Instructions

### Prerequisites

1. **Server running:** Ensure Express server is running on port 3008

   ```bash
   pm2 status # Check if dashboard-web is running
   # OR start manually:
   npm run dev:server
   ```

2. **Ollama running:** Ollama must be accessible on host

   ```bash
   # On Windows host (outside container):
   ollama list # Verify models are available
   ```

3. **MCP enabled:** Check environment variable

   ```bash
   grep MCP_ENABLED .env.development
   # Should output: MCP_ENABLED=true
   ```

4. **(Optional) Import tools from an existing MCP server (upstream):**

   ```bash
   # Enable upstream import
   MCP_UPSTREAM_ENABLED=true
   MCP_UPSTREAM_URL=http://localhost:4000/api/mcp
   MCP_UPSTREAM_ALIAS=core
   # Optional: MCP_UPSTREAM_HEADERS_JSON={"Authorization":"Bearer ..."}
   ```

   Upstream tools are registered locally with a prefix to avoid collisions:
   - Example: `mcp_core__<upstreamToolName>`

---

## 1️⃣ Claude Desktop Setup

**Platform:** Windows, macOS, Linux

### Step 1: Locate config file

**macOS:**

```bash
~/Library/Application Support/Claude/claude_desktop_config.json
```

**Windows:**

```bash
%AppData%\Claude\claude_desktop_config.json
# Typically: C:\Users\<YourName>\AppData\Roaming\Claude\claude_desktop_config.json
```

**Linux:**

```bash
~/.config/Claude/claude_desktop_config.json
```

### Step 2: Add MCP server configuration

Edit `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "chatgpt-docker": {
      "url": "http://localhost:3008/api/mcp",
      "transport": "http"
    }
  }
}
```

### Step 3: Restart Claude Desktop

Completely quit Claude Desktop and reopen it.

### Step 4: Verify tools are available

In Claude chat, type:

```
"Where is CHROME_PROXY_PORT defined in the codebase?"
```

Claude should automatically discover and use the `rag_search` tool.

**Expected behavior:**

- Claude will show "Using rag_search tool..."
- Results will include code snippets with file paths and line numbers
- Markdown formatted with syntax highlighting

---

## 2️⃣ GitHub Copilot Setup (VS Code)

**Platform:** VS Code (Dev Container or local)

### Option A (recommended): Repo-level auto config

This repo includes a workspace MCP config at `.vscode/mcp.json` pointing to
`http://localhost:3008/api/mcp`.

Open the workspace and Copilot should discover the server automatically (you may need to reload VS
Code once).

### Step 1: Open VS Code in Dev Container

Ensure you're running in the dev container where the Express server is accessible.

### Step 2: Add MCP Server to Copilot

1. Open **Copilot Chat** panel (Ctrl/Cmd + Shift + I)
2. Click the **Tools** button (🔧 icon)
3. Select **"Add MCP Server"**
4. Choose **"HTTP (Server-Sent Events)"**
5. Enter URL: `http://localhost:3008/api/mcp`
6. Click **"Add Server"**

### Step 3: Test integration

In Copilot Chat, ask:

```
"List available Ollama models"
```

Copilot should use the `ollama_models` tool and show the model list.

**Note:** Copilot has a built-in GitHub MCP server that provides GitHub-specific tools (`@github`).
Our MCP server runs independently and provides codebase search + Ollama tools.

---

## 3️⃣ OpenCode CLI Setup

**Platform:** Linux, macOS, WSL

### Step 1: Install OpenCode (if not installed)

```bash
npm install -g @opencode/cli
```

### Step 2: Configure MCP server

Edit OpenCode config:

**Linux/macOS:**

```bash
~/.config/opencode/config.json
```

**Windows/WSL:**

```bash
%AppData%/opencode/config.json
```

Add MCP server:

```json
{
  "mcpServers": {
    "chatgpt-docker": {
      "url": "http://localhost:3008/api/mcp",
      "type": "http"
    }
  }
}
```

### Step 3: Start OpenCode

```bash
opencode
```

### Step 4: Test tools

In OpenCode TUI, ask:

```
"Find adaptive throttling implementation in the codebase"
```

OpenCode LLM will automatically discover and use the `rag_search` tool.

**Expected behavior:**

- Tools are lazy-loaded (don't consume tokens until used)
- Results appear inline in the terminal UI
- Supports all 5 tools (RAG + Ollama)

---

## 4️⃣ Cursor/Codex Setup (REST API Fallback)

**Platform:** Cursor IDE, any HTTP client

### Option A: Cursor IDE

1. Open **Settings** → **Features** → **Custom Context Provider**
2. Set **URL:** `http://localhost:3008/api/rag/hybrid`
3. Enable **"Use for @codebase mentions"**

Now you can use:

```
@codebase Where is CHROME_PROXY_PORT?
```

### Option B: Generic HTTP Client

Use the REST API directly:

```bash
# Hybrid search
curl -X POST http://localhost:3008/api/rag/hybrid \
  -H "Content-Type: application/json" \
  -d '{
    "query": "CHROME_PROXY_PORT",
    "topK": 5,
    "rerank": true,
    "mmr": true
  }'

# Health check
curl http://localhost:3008/api/rag/health

# Cache stats
curl http://localhost:3008/api/rag/stats
```

**Available REST endpoints:**

- `POST /api/rag/ask` - Search with Markdown output
- `POST /api/rag/query` - Raw vector search
- `POST /api/rag/hybrid` - Hybrid search (recommended)
- `GET /api/rag/health` - Health check
- `GET /api/rag/stats` - Cache statistics
- `POST /api/rag/index` - Trigger reindexing (background)

---

## 🔌 Optional: Integrate with an Existing MCP Server (Upstream)

If you already have an MCP server and want this project to **consume its tools** and expose them
through the same Tool Registry (and `/api/mcp`), enable the upstream importer:

**ENV:**

- `MCP_UPSTREAM_ENABLED=true`
- `MCP_UPSTREAM_URL=http://localhost:4000/api/mcp`
- `MCP_UPSTREAM_ALIAS=core` (optional)
- `MCP_UPSTREAM_TOOL_PREFIX=mcp_core__` (optional)
- `MCP_UPSTREAM_HEADERS_JSON={"Authorization":"Bearer ..."}`

**Naming:** upstream tools are registered with a prefix to avoid collisions:

- Upstream tool `tools_list` → local tool `mcp_core__tools_list`

---

## 🧪 Testing Your Setup

### Quick Test: MCP Discovery

```bash
# Test GET endpoint (discovery)
curl http://localhost:3008/api/mcp
```

**Expected output:**

```json
{
  "name": "chatgpt-docker-unified",
  "version": "4.0.0",
  "protocol": "MCP/JSON-RPC 2.0",
  "endpoint": "/api/mcp",
  "methods": [
    "initialize",
    "notifications/initialized",
    "ping",
    "tools/list",
    "tools/call",
    "resources/list",
    "resources/read"
  ],
  "tools": ["rag_search", "rag_health", "ollama_generate", "ollama_embed", "ollama_models"],
  "toolCount": 5,
  "status": "ready"
}
```

### Full Test: List Tools

```bash
# Test POST endpoint (tools/list)
curl -X POST http://localhost:3008/api/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }'
```

**Expected output:**

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [
      {
        "name": "rag_search",
        "description": "Search the chatgpt-docker-puppeteer codebase...",
        "inputSchema": {...}
      },
      // ... 4 more tools
    ]
  }
}
```

### Execute Tool Test

```bash
# Test ollama_models tool
curl -X POST http://localhost:3008/api/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "ollama_models",
      "arguments": {}
    }
  }'
```

**Expected output:**

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "# Available Ollama Models\n\nFound **4** models:\n\n..."
      }
    ]
  }
}
```

---

## 🔧 Troubleshooting

### Issue: "MCP server not responding"

**Cause:** Express server not running or MCP disabled

**Fix:**

```bash
# Check if server is running
pm2 status | grep dashboard-web

# Check MCP_ENABLED
grep MCP_ENABLED .env.development

# Restart server
pm2 restart dashboard-web
```

### Issue: "Ollama tools fail"

**Cause:** Ollama not accessible on host

**Fix:**

```bash
# On Windows host, verify Ollama is running
ollama list

# Check connectivity from container
curl http://host.docker.internal:11434/api/tags
```

### Issue: "RAG search returns empty results"

**Cause:** Database not indexed or query mismatch

**Fix:**

```bash
# Check health
curl http://localhost:3008/api/rag/health

# Trigger reindexing
curl -X POST http://localhost:3008/api/rag/index

# Wait ~30s for indexing to complete, then retry search
```

### Issue: "404 on /api/mcp"

**Cause:** Routes not applied or server not started correctly

**Fix:**

```bash
# Check server logs
pm2 logs dashboard-web --lines 50

# Look for:
# [MCP] MCP_ENABLED=true, setting up MCP handler...
# [MCP Handler] MCP endpoint ready at POST/GET /api/mcp

# If not found, restart:
pm2 restart dashboard-web
```

---

## 📊 Performance Tips

### Cache Optimization

The RAG system uses an LRU cache (100 entries) for query embeddings.

**Monitor cache performance:**

```bash
curl http://localhost:3008/api/rag/stats
```

**Expected hit rate:** 40-60% after warm-up

**Clear cache** (if needed):

```bash
# Restart server to clear cache
pm2 restart dashboard-web
```

### Query Optimization

**Use specific queries for better results:**

❌ Bad: `"find code"` ✅ Good: `"Where is CHROME_PROXY_PORT defined?"`

❌ Bad: `"show me functions"` ✅ Good: `"Functions that handle adaptive CPU throttling"`

**Use filters to narrow search:**

```json
{
  "query": "error handling",
  "pathPrefix": "src/driver",
  "ext": ".js",
  "topK": 3
}
```

---

## 🎯 Example Workflows

### Workflow 1: Code Discovery with Claude Desktop

**User goal:** Find where a specific variable is used

**Steps:**

1. Open Claude Desktop
2. Ask: `"Where is CHROME_PROXY_PORT defined and how is it used?"`
3. Claude uses `rag_search` tool automatically
4. Review results with file paths and line numbers
5. Click on files to open in VS Code (if configured)

**Expected time:** <5 seconds

---

### Workflow 2: Code Generation with Copilot

**User goal:** Generate a docstring using local LLM

**Steps:**

1. Select a function in VS Code
2. Open Copilot Chat
3. Ask: `"Generate a comprehensive docstring for this function using deepseek-coder"`
4. Copilot uses `ollama_generate` tool
5. Review and insert generated docstring

**Models to try:**

- `qwen2.5-coder:7b` - Best quality, slower
- `qwen2.5-coder:3b` - Balanced
- `qwen2.5:3b-instruct` - General-purpose

---

### Workflow 3: Codebase Analysis with OpenCode

**User goal:** Understand how a feature works

**Steps:**

1. Start OpenCode: `opencode`
2. Ask: `"How does the kernel loop work? Find relevant code and explain"`
3. OpenCode uses `rag_search` to find implementation
4. LLM analyzes code and provides explanation
5. Ask follow-up questions

**OpenCode advantages:**

- Terminal-based (no GUI needed)
- Can run on remote servers
- Supports long conversations with context

---

## 🔐 Security Considerations

**Network exposure:**

- MCP server binds to `0.0.0.0:3008` (accessible from network)
- In production, use firewall rules to restrict access
- Consider adding authentication (API key, OAuth)

**Rate limiting:**

- Already configured: 100 req/min per IP
- Skipped for local development (127.0.0.1)
- Adjust in `src/server/engine/app.js` if needed

**CORS:**

- Enabled for `localhost:*` origins
- Modify `allowedOrigins` in `app.js` for custom origins

---

## 📚 Additional Resources

**Documentation:**

- [MCP Specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [RAG v3.0 Architecture](../../tools/rag/README.md)
- [Tool Registry Pattern](../../src/integration/README.md)

**Related Files:**

- MCP Handler: `src/server/handlers/mcp-handler.js`
- Tool Registry: `src/integration/tool-registry.mjs`
- RAG Tools: `src/integration/tools/rag-tools.mjs`
- Ollama Tools: `src/integration/tools/ollama-tools.mjs`

**Need help?**

- Check logs: `pm2 logs dashboard-web`
- Health check: `curl http://localhost:3008/api/rag/health`
- GitHub Issues: [Report a bug](https://github.com/anthropics/claude-code/issues)

---

## 🎉 Success Checklist

- [ ] Express server running on port 3008
- [ ] Ollama accessible (test: `curl http://host.docker.internal:11434/api/tags`)
- [ ] MCP_ENABLED=true in .env
- [ ] GET `/api/mcp` returns discovery info
- [ ] Claude Desktop configured (if using)
- [ ] GitHub Copilot configured (if using)
- [ ] OpenCode configured (if using)
- [ ] Test query successful in at least one LLM

**Ready to start coding with AI assistance!** 🚀
