---
name: rag-search
description: Search the codebase using semantic RAG (LanceDB + Ollama)
category: code-search
---

# RAG Semantic Search

Searches the codebase using semantic vector search powered by RAG (Retrieval-Augmented Generation).

## Overview

This command uses the local RAG system to perform semantic search across the entire codebase:

- **LanceDB** for vector storage
- **Ollama** (nomic-embed-text:latest) for embeddings
- **Incremental indexing** with fingerprint-based change detection

## Usage

```bash
/rag-search "your semantic query here"
```

### Basic Examples

```bash
# Find where CHROME_PROXY_PORT is defined
/rag-search "CHROME_PROXY_PORT configuration"

# Understand the kernel loop
/rag-search "kernel loop 20Hz execution"

# Find task orchestration code
/rag-search "task orchestration strategy"

# Locate Puppeteer driver implementation
/rag-search "ChatGPT driver Puppeteer automation"
```

### Advanced Filtering

```bash
# Search only in specific file types
/rag-search --ext .js "error handling"
/rag-search --ext .md "API documentation"

# Search in specific directory
/rag-search --path src/kernel/ "policy engine"
/rag-search --path tests/ "integration tests"

# Control number of results
/rag-search --topk 5 "NERV event bus"
/rag-search --topk 20 "configuration"
```

## Parameters

| Parameter        | Type   | Default    | Description                                      |
| ---------------- | ------ | ---------- | ------------------------------------------------ |
| `query`          | string | (required) | Semantic search query                            |
| `--topk N`       | number | 8          | Number of results to return                      |
| `--ext .ext`     | string | all        | Filter by file extension (.js, .md, .json, etc.) |
| `--path prefix/` | string | all        | Filter by path prefix (src/, tests/, etc.)       |

## How It Works

1. **Query Embedding**: Your query is embedded using Ollama (nomic-embed-text:latest)
2. **Vector Search**: LanceDB performs semantic similarity search
3. **Ranking**: Results sorted by relevance (cosine distance)
4. **Formatting**: Output formatted as Markdown with code snippets

## Response Format

````markdown
# RAG Results (8 chunks)

## 1. src/infra/proxy/chromeProxyService.js:42-58

**Score:** 0.12 | **Language:** javascript

```javascript
const CHROME_PROXY_PORT = process.env.CHROME_PROXY_PORT || 9224;
// ...
```
````

---

## 2. docs/CHROME_PROXY.md:10-25

**Score:** 0.18 | **Language:** markdown

...

````

## Integration

This skill calls the RAG API endpoint:
- **Endpoint:** `POST http://localhost:3008/api/rag/ask`
- **Requires:** Express server running (`npm start`)
- **Requires:** RAG indexed (`npm run rag:index`)

## Performance

- **Cold query:** ~500ms (embedding) + ~50ms (search) = ~550ms
- **Cached query:** ~50ms (cache hit on embeddings)
- **Hit rate:** 80-90% for code-related queries

## Troubleshooting

### "RAG search failed: Connection refused"
**Solution:** Start the Express server:
```bash
pm2 start ecosystem.config.cjs
# or
npm start
````

### "No results found"

**Possible causes:**

1. RAG not indexed yet → Run `npm run rag:index`
2. Query too specific → Try broader keywords
3. Code doesn't exist in workspace

### "Ollama connection failed"

**Solution:** Ensure Ollama is running on host:

```bash
# On host machine (not in container):
ollama serve

# Verify from container:
curl http://host.docker.internal:11434/api/version
```

### "Model not found"

**Solution:** Pull the embedding model on host:

```bash
# On host machine:
ollama pull nomic-embed-text:latest
```

## Related Commands

- `/validate` - Check system health (includes RAG health)
- `/ollama-check` - Verify Ollama connectivity
- Run `npm run rag:health` for detailed RAG diagnostics

## Technical Details

- **Index Location:** `/home/node/.local/share/rag-index/`
- **DB Location:** `/home/node/.local/share/rag-db/`
- **Chunking:** Deterministic (same input → same chunks)
- **Incremental:** Only reindexes changed files
- **Offline-first:** No external API calls
