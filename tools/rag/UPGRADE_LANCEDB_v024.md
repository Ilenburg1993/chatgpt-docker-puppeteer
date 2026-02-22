# LanceDB v0.24 Upgrade Plan

## Current Implementation (v0.18)

- Basic vector search
- SQL WHERE filtering
- Client-side tag filtering
- No FTS, no hybrid search

## Proposed Improvements

### 1. Distance Range Filtering ⭐ **QUICK WIN**

**Why:** Discard irrelevant results (distance > 0.8) **Code Change:** Add
`.distanceRange(minDist, maxDist)` to search

```javascript
// Before (v0.18)
let q = table.search(vector).limit(topK * 5);

// After (v0.24)
let q = table
  .search(vector)
  .distanceRange(0, 0.8) // Only results with distance < 0.8
  .limit(topK);
```

**Benefit:** Better precision, faster queries (less client filtering)

---

### 2. Full-Text Search (FTS) Index ⭐ **HIGH VALUE**

**Why:** Enable text-based search (keywords, phrases) **Code Change:** Create FTS index on `text`
column

```javascript
// Create FTS index (one-time setup)
await table.createIndex({
  column: 'text',
  type: 'fts',
  options: {
    tokenizer: 'code', // Code-aware tokenizer
    stemmer: false, // Preserve exact terms (better for code)
  },
});
```

**Usage:**

```javascript
// FTS-only search
const results = await table.search().fullText('async function', { column: 'text' }).limit(10);
```

**Benefit:** Find exact keywords (e.g., "CHROME_PROXY_PORT", "async/await")

---

### 3. Hybrid Search (FTS + Vector) ⭐⭐ **BEST FEATURE**

**Why:** Combine semantic similarity + keyword matching **Code Change:** Use both FTS and vector in
single query

```javascript
export async function hybridSearch(table, vector, textQuery, options = {}) {
  const { topK = 8, alpha = 0.7 } = options;

  // alpha = weight for vector search (0.7 = 70% vector, 30% FTS)
  const results = await table
    .search(vector)
    .fullText(textQuery, { column: 'text', boost: 1 - alpha })
    .limit(topK)
    .toArray();

  return results;
}
```

**Example Query:**

```javascript
// Find code semantically similar to "error handling"
// AND containing keyword "try/catch"
hybridSearch(table, errorHandlingVector, 'try catch', { topK: 5, alpha: 0.8 });
```

**Benefit:** Best of both worlds - semantic + exact match

---

### 4. Query Debugging (explain_plan) 🔍

**Why:** Diagnose slow queries, optimize performance **Code Change:** Add debug mode to search

```javascript
export async function searchWithDebug(table, vector, options) {
  const q = table.search(vector).limit(options.topK);

  // Explain query execution plan
  const plan = await q.explainPlan();
  console.log('[RAG Debug] Query Plan:', plan);

  // Execute and analyze
  const start = Date.now();
  const results = await q.toArray();
  const elapsed = Date.now() - start;

  console.log(`[RAG Debug] Query took ${elapsed}ms for ${results.length} results`);

  return results;
}
```

---

### 5. Scalar Index for chunk_id (UUID optimization)

**Why:** Faster lookups by chunk_id (SHA256 hash) **Code Change:** Create scalar index

```javascript
// One-time index creation
await table.createIndex({
  column: 'chunk_id',
  type: 'scalar',
  options: { replace: false },
});
```

**Benefit:** 10-100x faster chunk_id lookups (for deduplication, updates)

---

## Implementation Priority

| Feature            | Priority  | Complexity | Impact    | When      |
| ------------------ | --------- | ---------- | --------- | --------- |
| **Distance Range** | 🔴 High   | Low        | High      | Now       |
| **Hybrid Search**  | 🔴 High   | Medium     | Very High | Phase 2   |
| **FTS Index**      | 🟡 Medium | Low        | High      | Phase 2   |
| **Query Debug**    | 🟢 Low    | Low        | Medium    | As needed |
| **Scalar Index**   | 🟢 Low    | Low        | Medium    | Phase 3   |

---

## Migration Steps

### Phase 1: Distance Range (IMMEDIATE)

1. Update `search()` in lancedb.mjs
2. Add `.distanceRange(0, 0.8)`
3. Test with `npm run rag:ask -- "test"`
4. Commit

### Phase 2: Hybrid Search (AFTER INDEXING)

1. Create FTS index on existing table
2. Add `hybridSearch()` function
3. Expose via API `/api/rag/hybrid`
4. Update OpenCode skill to support hybrid mode

### Phase 3: Optimization (OPTIONAL)

1. Add scalar index for chunk_id
2. Implement query debugging
3. Performance profiling

---

## Breaking Changes?

**NO** - All changes are additive:

- Existing `search()` still works
- New features are opt-in
- No reindexing required (except for FTS)

---

## Testing Checklist

- [ ] Distance range filtering works
- [ ] FTS index created successfully
- [ ] Hybrid search returns relevant results
- [ ] Query performance improved
- [ ] Backward compatible with existing code
