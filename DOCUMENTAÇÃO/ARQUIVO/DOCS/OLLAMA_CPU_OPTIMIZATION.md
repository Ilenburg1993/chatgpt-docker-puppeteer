# Ollama CPU Optimization Guide

## Recommended Configuration for 16GB RAM / CPU-only Systems

### Optimal Models

**ESSENTIAL:**
- ✅ `nomic-embed-text:latest` (0.27 GB) - Required for RAG search
  - Purpose: 768D embeddings for semantic code search
  - Speed: 50-200ms per embedding
  - RAM: ~0.5-1 GB

**RECOMMENDED:**
- ✅ `qwen2.5-coder:3b` (1.93 GB) - Default for code generation
  - Purpose: Fast code generation, docstrings, explanations
  - Speed: ~200 tokens/min on i5-9600K (6 cores)
  - RAM: ~3-4 GB when loaded
  - Quality: Good for most coding tasks

**NOT RECOMMENDED (CPU-only systems):**
- ❌ `qwen2.5-coder:7b` (4.68 GB) - Too slow
  - Speed: ~100 tokens/min (2x slower than 3b)
  - RAM: ~6-8 GB
  - Cause of timeouts: 1000 tokens = 10+ minutes

- ❌ `qwen2.5:3b-instruct` (1.93 GB) - Redundant
  - Overlaps with coder:3b capability
  - Not optimized for code

### Removal Instructions

Check current models:
```bash
curl -s http://host.docker.internal:11434/api/tags | jq '.models[].name'
```

Remove slow/redundant models (run on Windows host):
```powershell
# Remove 7b model (too slow)
ollama rm qwen2.5-coder:7b

# Remove redundant model
ollama rm qwen2.5:3b-instruct
```

Verify configuration:
```bash
# Should show only 2 models
ollama list
# nomic-embed-text:latest  0.27 GB
# qwen2.5-coder:3b        1.93 GB
```

### Performance Comparison

| Model | Size | Speed (i5-9600K) | RAM | Recommendation |
|-------|------|------------------|-----|----------------|
| qwen2.5-coder:3b | 1.93 GB | 200 tok/min | 3-4 GB | ✅ Use |
| qwen2.5-coder:7b | 4.68 GB | 100 tok/min | 6-8 GB | ❌ Too slow |
| nomic-embed-text | 0.27 GB | 50-200ms | 0.5-1 GB | ✅ Required |

### System Resource Monitoring

Check RAM usage:
```bash
# During generation
free -h
# Watch for swap usage (bad sign)
```

Expected usage with optimized config:
- Idle: ~2 GB (base + embeddings)
- During generation: ~4-5 GB (embeddings + 3b model)
- Available: 11+ GB free

---

## Model Selection Logic

### Overview: 2 Models, 3 Use Cases

**Models Available:**
1. **nomic-embed-text** (0.27 GB) - Embedding model
2. **qwen2.5-coder:3b** (1.93 GB) - Code-specialized generation model

**Use Cases:**
1. RAG Search (embedding)
2. Code Generation (generation)
3. General Tasks (generation)

### Use Case 1: RAG Search (ALWAYS uses embedding model)

**Model:** `nomic-embed-text:latest` (hardcoded, não configurável)

**Quando:** Toda vez que `rag_search` é chamado
- User: "Where is CHROME_PROXY_PORT?"
- Claude Desktop/Copilot → `rag_search` tool → nomic-embed-text

**Fluxo:**
```
Query: "CHROME_PROXY_PORT"
  ↓
Embedding: nomic-embed-text.embed("CHROME_PROXY_PORT")
  ↓
LanceDB: Search 5,645 chunks by similarity
  ↓
Results: Top 5 code chunks
```

**Seleção Automática:**
- **Código:** `tools/rag/lib/contract.mjs:5` define `DEFAULT_EMBEDDING_MODEL = 'nomic-embed-text:latest'`
- **Não configurável** - modelo fixo (necessário para consistência vetorial)

### Use Case 2: Code Generation (uses code-specialized model)

**Model:** `qwen2.5-coder:3b` (default, configurável via ENV ou parâmetro)

**Quando:** Tarefas específicas de código
- "Generate a Python function to calculate Fibonacci"
- "Write a docstring for this function"
- "Explain this code snippet"
- "Refactor this function"
- "Add error handling to this code"

**Seleção:**
1. **Default automático:** `OLLAMA_DEFAULT_MODEL=qwen2.5-coder:3b`
2. **Override via parâmetro:** User pode especificar modelo na chamada

**Exemplo (Claude Desktop):**
```
User: "Generate a function to parse JSON"

Claude → ollama_generate tool with:
  - prompt: "Generate a function to parse JSON"
  - model: "qwen2.5-coder:3b" (default)
  ↓
Ollama → qwen2.5-coder:3b generates code
  ↓
Result: Python/JS function with proper syntax
```

**Por que qwen2.5-coder:3b?**
- ✅ Treinado especificamente para código (Python, JS, Java, etc.)
- ✅ Entende sintaxe, padrões, best practices
- ✅ Melhor para: docstrings, refactoring, code completion
- ✅ 2x mais rápido que 7b em CPU

### Use Case 3: General Tasks (same model, different context)

**Model:** `qwen2.5-coder:3b` (default, mas pode ser override)

**Quando:** Tarefas não específicas de código
- "Explain how neural networks work" (conceitual)
- "Summarize this documentation" (texto)
- "Translate this to Portuguese" (linguagem)
- "Draft an email about this bug" (escrita)

**Seleção:**
- **Default:** qwen2.5-coder:3b (mesmo modelo que código)
- **Alternativa:** User poderia adicionar modelo generalista se quiser

**Por que reusar qwen2.5-coder:3b?**
- ✅ Modelos "coder" modernos são bons em tarefas gerais também
- ✅ Evita ter 2 modelos grandes (economiza RAM)
- ✅ qwen2.5-coder é capaz de explicações conceituais
- ❌ Se precisar de tarefa muito específica (e.g., tradução profissional), user pode adicionar modelo especializado

### How Users Control Model Selection

#### 1. Via Environment Variable (Global Default)
```bash
# .env.development
OLLAMA_DEFAULT_MODEL=qwen2.5-coder:3b  # For all generations
```

#### 2. Via Tool Parameter (Per-Call Override)
```javascript
// Claude Desktop/LLM calls ollama_generate with:
{
  "name": "ollama_generate",
  "arguments": {
    "prompt": "Explain quantum computing",
    "model": "qwen2.5-coder:3b",  // ← Explicit model selection
    "max_tokens": 500
  }
}
```

#### 3. RAG Always Uses Fixed Model (No Override)
```javascript
// RAG embedding model is hardcoded
const EMBEDDING_MODEL = 'nomic-embed-text:latest'; // Not configurable
```

### Decision Matrix

| Scenario | Tool Called | Model Used | Why |
|----------|-------------|------------|-----|
| "Where is X defined?" | `rag_search` | nomic-embed-text | Embedding required for vector search |
| "Generate Python function" | `ollama_generate` | qwen2.5-coder:3b | Code-specialized, fast on CPU |
| "Explain this algorithm" | `ollama_generate` | qwen2.5-coder:3b | Good at technical explanations |
| "Write a poem" | `ollama_generate` | qwen2.5-coder:3b | Can handle, but not optimal |
| "List available models" | `ollama_models` | N/A (metadata only) | No generation needed |

---

## Timeout Configuration

### Layered Timeout Strategy

The system uses 3 layers of timeout protection:

```
Express Server: 120s (outermost)
   ↓
MCP Handler: 90s (middleware)
   ↓
Ollama Client: 60s (API call)
```

**Why layered?**
- Each layer protects the layer above
- Clear hierarchy (inner < outer)
- Helpful error messages at each layer
- Graceful degradation (inner timeout = outer succeeds with error)

### Environment Variables

All timeouts are configurable via `.env`:

```bash
# Ollama Client Timeouts
OLLAMA_GENERATE_TIMEOUT=60000    # 60s for text generation
OLLAMA_EMBED_TIMEOUT=30000       # 30s for embeddings
OLLAMA_LIST_TIMEOUT=10000        # 10s for listing models
OLLAMA_HEALTH_TIMEOUT=5000       # 5s for health checks

# MCP Handler Timeout
MCP_TOOL_TIMEOUT=90000           # 90s (wraps Ollama calls)

# Express Server Timeout
SERVER_REQUEST_TIMEOUT=120000    # 120s (outermost protection)
```

### Expected Response Times

With `qwen2.5-coder:3b` on i5-9600K:

| Tokens | Expected Time | Will Timeout? |
|--------|---------------|---------------|
| 50 | 5-10s | ❌ No |
| 200 | 20-30s | ❌ No |
| 500 | 50-60s | ⚠️ Close (may timeout) |
| 1000 | 90-120s | ✅ Yes (by design) |
| 2000 | 180-240s | ✅ Yes (by design) |

**Recommendation:** Use `max_tokens=500` or less for reliable responses.

---

## Troubleshooting

### Symptom: "Generation timed out after 60s"

**Cause:** Model too large or prompt too complex

**Solutions:**
1. Use 3b model instead of 7b:
   ```bash
   # In .env
   OLLAMA_DEFAULT_MODEL=qwen2.5-coder:3b
   ```

2. Reduce max_tokens:
   ```bash
   # In .env
   OLLAMA_MAX_TOKENS=500
   ```

3. Simplify the prompt (shorter, more specific)

### Symptom: System becomes unresponsive during generation

**Cause:** Running out of RAM, swapping to disk

**Solutions:**
1. Remove large models:
   ```powershell
   ollama rm qwen2.5-coder:7b
   ```

2. Check RAM usage:
   ```bash
   free -h
   # If swap is being used, you're out of RAM
   ```

3. Close other applications during generation

### Symptom: "Model not found" error

**Cause:** Default model (7b) was removed but ENV not updated

**Solution:** ENV already set to 3b, restart server:
```bash
pm2 restart dashboard-web
pm2 logs dashboard-web --lines 20
```

### Symptom: Responses are low quality

**Cause:** 3b model has limitations compared to 7b

**Solutions:**
1. For critical tasks, use 7b explicitly:
   ```javascript
   ollama_generate("complex task", model="qwen2.5-coder:7b", max_tokens=500)
   ```

2. Break complex tasks into smaller prompts

3. Add more context to the prompt

---

## Advanced Configuration

### If User Wants to Add Generalista Model (Optional)

**Scenario:** User wants better non-code results

**Option:** Install `qwen2.5:3b-instruct` (1.93 GB)
```powershell
# On Windows host
ollama pull qwen2.5:3b-instruct
```

**Usage:**
```bash
# Via ENV (change global default)
OLLAMA_DEFAULT_MODEL=qwen2.5:3b-instruct

# Via parameter (per-call)
ollama_generate("Write a poem", model="qwen2.5:3b-instruct")
```

**Trade-offs:**
- ✅ Better for: creative writing, general chat, translations
- ❌ Worse for: code generation, technical docs
- ❌ Extra RAM: +2 GB when loaded (total 4-5 GB vs 3-4 GB)

**Recommendation:**
- **Keep only qwen2.5-coder:3b** for CPU-only systems (2.2 GB total)
- Add generalista only if:
  - RAM allows (20GB+)
  - User frequently does non-code tasks
  - Quality difference matters for use case

### Using 7b Model Occasionally

If you have 20GB+ RAM and want best quality occasionally:

1. Keep 7b installed but DON'T make it default
2. Use 3b as default (fast, always works)
3. Override to 7b when needed:
   ```javascript
   // For complex tasks only
   ollama_generate("complex reasoning task", model="qwen2.5-coder:7b", max_tokens=500)
   ```

4. Increase timeout for 7b calls:
   ```bash
   # Temporary override
   OLLAMA_GENERATE_TIMEOUT=180000  # 3 minutes for 7b
   ```

---

## Verification Procedure

### Step 1: Check Models
```bash
# List installed models
curl -s http://host.docker.internal:11434/api/tags | jq '.models[] | {name, size}'
```

**Expected output:**
```json
{
  "name": "nomic-embed-text:latest",
  "size": 274000000
}
{
  "name": "qwen2.5-coder:3b",
  "size": 1930000000
}
```

### Step 2: Test Small Generation
```bash
curl -X POST http://localhost:3008/api/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":1,
    "method":"tools/call",
    "params":{
      "name":"ollama_generate",
      "arguments":{
        "prompt":"Say hello in one sentence",
        "max_tokens":50
      }
    }
  }' | jq -r '.result.content[0].text'
```

**Expected:** Response within 5-10 seconds

### Step 3: Test Timeout Enforcement
```bash
# This should timeout or complete within 90s (MCP timeout)
time curl -X POST http://localhost:3008/api/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":2,
    "method":"tools/call",
    "params":{
      "name":"ollama_generate",
      "arguments":{
        "prompt":"Write a very long detailed essay about artificial intelligence",
        "max_tokens":2000
      }
    }
  }'
```

**Expected:** Timeout error within 90s or successful completion

### Step 4: Monitor Performance
```bash
# Watch RAM usage during generation
watch -n 1 free -h

# Check Ollama process
ps aux | grep ollama
```

---

## Summary

**Optimized Configuration (2.2 GB total):**
- ✅ nomic-embed-text:latest (0.27 GB) - RAG search
- ✅ qwen2.5-coder:3b (1.93 GB) - Code generation + general tasks
- ✅ 60s timeout for generation (realistic for CPU)
- ✅ 1000 max tokens (5 minutes on 3b)
- ✅ ENV-configurable (easy tuning)

**Performance Gains vs. Previous Config:**
- **2x faster inference** (3b vs 7b on CPU)
- **50% less RAM usage** (4 GB vs 8 GB)
- **Better timeout handling** (layered: 120s → 90s → 60s)
- **Fewer timeouts** (realistic expectations)
- **Clear error messages** (includes hints to use 3b model)

**Next Steps:**
1. Remove unnecessary models (`ollama rm qwen2.5-coder:7b`)
2. Restart server (`pm2 restart dashboard-web`)
3. Test with real tasks
4. Monitor performance and adjust timeouts if needed

---

## Code References

**Where embedding model is defined:**
- [tools/rag/lib/contract.mjs:5](../../tools/rag/lib/contract.mjs#L5) - `DEFAULT_EMBEDDING_MODEL = 'nomic-embed-text:latest'`
- [tools/rag/lib/embeddings/ollama.mjs:34](../../tools/rag/lib/embeddings/ollama.mjs#L34) - Uses `this.model = options.model || DEFAULT_EMBEDDING_MODEL`

**Where generation model is defined:**
- [tools/ollama/client.mjs:52](../../tools/ollama/client.mjs#L52) - `defaultModel = process.env.OLLAMA_DEFAULT_MODEL || 'qwen2.5-coder:3b'`
- [src/integration/tools/ollama-tools.mjs:34](../../src/integration/tools/ollama-tools.mjs#L34) - Uses ENV-based default

**Timeout configuration:**
- [src/server/handlers/mcp-handler.js:43](../../src/server/handlers/mcp-handler.js#L43) - MCP layer timeout (90s)
- [src/server/engine/server.js:60](../../src/server/engine/server.js#L60) - Express server timeout (120s)
- [tools/ollama/client.mjs:30](../../tools/ollama/client.mjs#L30) - Ollama client timeout (60s)
