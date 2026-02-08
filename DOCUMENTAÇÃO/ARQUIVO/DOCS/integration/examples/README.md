# MCP Integration - Configuration Examples

This directory contains ready-to-use configuration files for integrating the chatgpt-docker-puppeteer MCP server with various LLMs.

## 📁 Files

### 1. `claude_desktop_config.json`
Configuration for Claude Desktop app.

**Location:**
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%AppData%\Claude\claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

**Usage:**
```bash
# Copy to Claude config location
cp claude_desktop_config.json ~/Library/Application\ Support/Claude/claude_desktop_config.json

# Restart Claude Desktop
```

---

### 2. `vscode_settings_copilot.json`
Configuration for GitHub Copilot in VS Code.

**Location:** `.vscode/settings.json` (workspace) or `~/Library/Application Support/Code/User/settings.json` (global)

**Usage:**
```bash
# Merge into your existing VS Code settings.json
# Add the "github.copilot.chat.mcpServers" section

# Reload VS Code window
# Press Ctrl/Cmd + Shift + P → "Developer: Reload Window"
```

**Alternative:** Add via UI:
1. Open Copilot Chat panel
2. Click Tools button (🔧)
3. Select "Add MCP Server"
4. Choose "HTTP (Server-Sent Events)"
5. Enter URL: `http://localhost:3008/api/mcp`

---

### 3. `opencode_config.json`
Configuration for OpenCode CLI.

**Location:**
- **Linux/macOS:** `~/.config/opencode/config.json`
- **Windows:** `%AppData%/opencode/config.json`

**Usage:**
```bash
# Copy to OpenCode config location
mkdir -p ~/.config/opencode
cp opencode_config.json ~/.config/opencode/config.json

# Start OpenCode
opencode
```

---

### 4. `test_mcp_endpoint.sh`
Comprehensive test script for MCP endpoint.

**Tests:**
1. Discovery endpoint (GET /api/mcp)
2. tools/list (list all available tools)
3. ollama_models tool
4. rag_health tool
5. rag_search tool
6. resources/read (rag://stats)

**Usage:**
```bash
# Ensure server is running on localhost:3008
pm2 status | grep dashboard-web

# Run tests
./test_mcp_endpoint.sh

# Or with verbose output
bash -x test_mcp_endpoint.sh
```

**Expected Output:**
```
=========================================
MCP Endpoint Test Script
=========================================

[1/6] Testing Discovery Endpoint...
{
  "name": "chatgpt-docker-unified",
  "version": "4.0.0",
  ...
  "toolCount": 5,
  "status": "ready"
}

[2/6] Testing tools/list...
5

[3/6] Testing ollama_models tool...
"# Available Ollama Models\n\nFound **4** models:\n\n..."

✅ All tests completed successfully!
=========================================
```

---

## 🚀 Quick Start

### Prerequisites

1. **Express server running:**
   ```bash
   pm2 start ecosystem.config.cjs --only dashboard-web
   # OR
   npm run dev:server
   ```

2. **Ollama accessible:**
   ```bash
   # On host (outside container)
   ollama list
   ```

3. **MCP_ENABLED=true:**
   ```bash
   grep MCP_ENABLED .env.development
   # Should output: MCP_ENABLED=true
   ```

### Test the Endpoint

```bash
# Quick test
curl http://localhost:3008/api/mcp | jq

# Full test suite
cd docs/integration/examples
./test_mcp_endpoint.sh
```

### Configure Your LLM

Choose your LLM and follow the instructions above:
- 🤖 Claude Desktop → `claude_desktop_config.json`
- 💻 GitHub Copilot → `vscode_settings_copilot.json`
- ⌨️ OpenCode CLI → `opencode_config.json`
- 📡 Cursor/Codex → Use REST API at `http://localhost:3008/api/rag/*`

---

## 🔧 Troubleshooting

### Server not responding
```bash
# Check if server is running
pm2 status | grep dashboard-web

# Check logs
pm2 logs dashboard-web --lines 50

# Look for:
# [MCP] MCP_ENABLED=true, setting up MCP handler...
# [MCP Handler] MCP endpoint ready at POST/GET /api/mcp
```

### Ollama tools failing
```bash
# Check Ollama connectivity from container
curl http://host.docker.internal:11434/api/tags

# On Windows host, ensure Ollama is running
ollama list
```

### LLM not discovering tools
- **Claude Desktop:** Completely quit and reopen the app
- **Copilot:** Reload VS Code window (Ctrl/Cmd + Shift + P → "Reload Window")
- **OpenCode:** Restart OpenCode CLI

---

## 📚 Additional Resources

- **Main Integration Guide:** [../README.md](../README.md)
- **Implementation Report:** [../../../RAG_V4_IMPLEMENTATION_REPORT.md](../../../RAG_V4_IMPLEMENTATION_REPORT.md)
- **Test Suite:** [../../../tests/integration/rag/test_multi_llm_integration.spec.js](../../../tests/integration/rag/test_multi_llm_integration.spec.js)

---

## 🎯 Success Criteria

- [ ] `curl http://localhost:3008/api/mcp` returns server info with 5 tools
- [ ] `./test_mcp_endpoint.sh` runs without errors
- [ ] Your chosen LLM successfully executes a tool (e.g., `ollama_models`)
- [ ] Search for "CHROME_PROXY_PORT" in LLM returns code results

**Ready to code with AI assistance!** 🚀
