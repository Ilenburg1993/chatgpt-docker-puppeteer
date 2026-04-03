# Auditoria — `mcp-tool-bridge.js`

**Módulo**: `src/copilot/bridges/mcp-tool-bridge.js` **LOC**: 344 **Data**: 2026-06-10 **Auditor**:
Copilot Full-Audit MF-II

---

## 1. Propósito

Bridge entre o MCP Tool Registry (servidor HTTP JSON-RPC local em `PORT/api/mcp`) e o SDK do Copilot
(`defineTool`). Descobre dinamicamente ferramentas MCP e as expõe como Copilot tools com Zod schema
gerado a partir do JSON Schema de cada ferramenta.

---

## 2. Arquitetura

```
buildMcpTools()
  ├── circuitBreaker: if open (60s), return []
  ├── bootDelay: _BOOT_BACKOFF_MS[count] (0, 200, 1000, 5000)
  ├── listMcpTools() → rpcCall('tools/list')
  │     └── rpcCall: MAX_ATTEMPTS=3, AbortSignal.timeout(8s), exp backoff + jitter
  └── createSdkToolFromMcp(tool) per resultado
        ├── buildZodSchema(inputSchema) → Zod schema recursivo
        └── defineTool('mcp_' + name, { overridesBuiltInTool: true, handler })
```

---

## 3. Achados

### FINDING-P4-1 — `buildZodSchema` trata `allOf` pegando apenas o primeiro elemento **[FIXED]**

**Severidade**: P4 — Médio **Localização**: `buildZodSchema()` linhas ~175-185

```js
case 'allOf': {
    const first = inputSchema.allOf[0];
    return first ? buildZodSchema(first, parentRequired, key) : z.unknown();
}
```

Para `allOf` com múltiplos schemas (e.g.,
`{ allOf: [{$ref: '#/defs/Base'}, {properties: {extra}}]}`), apenas o primeiro schema é convertido.
Todos os constraints adicionais são silenciosamente descartados. O SDK aceitará payloads que violam
os schemas extras.

**Proposta**: para o caso simples de múltiplos `properties`, merge recursivo:

```js
case 'allOf': {
    const merged = {type: 'object', properties: {}, required: []};
    for (const s of inputSchema.allOf) {
        Object.assign(merged.properties, s.properties ?? {});
        merged.required.push(...(s.required ?? []));
    }
    return buildZodSchema(merged, parentRequired, key);
}
```

---

### FINDING-P4-2 — `MCP_BASE` usa `process.env['PORT']` (porta genérica) **[FIXED]**

**Severidade**: P4 — Médio **Localização**: linha ~48

```js
const PORT = process.env['PORT'] ?? '3008';
const MCP_BASE = `http://127.0.0.1:${PORT}/api/mcp`;
```

`PORT` é uma variável de ambiente genérica frequentemente usada por plataformas de hosting (e.g.,
Railway, Heroku, Cloud Run) para injetar a porta exposta do serviço web. Usar essa mesma variável
para o endereço MCP pode resultar em `MCP_BASE` apontando para a porta errada se o servidor for
executado em ambiente de cloud com `PORT` diferente de 3008.

**Proposta**: usar `MCP_PORT` dedicado com fallback para `PORT`:

```js
const PORT = process.env['MCP_PORT'] ?? process.env['PORT'] ?? '3008';
```

---

### FINDING-P5-1 — Circuit breaker sem estado half-open — reconecta blindly ao atingir 60s

**Severidade**: P5 — Baixo **Localização**: `buildMcpTools()` linhas ~260-275

```js
if (_mcpCircuitOpen && Date.now() - _mcpCircuitOpenAt < CIRCUIT_RESET_MS) return [];
```

Ao expirar os 60s, a próxima chamada tenta reconectar sem nenhuma sinalização de "half-open". Se o
MCP server ainda estiver down, o circuit abre novamente com novo timer. Para uso como ferramenta de
terminal, isso é aceitável — mas o padrão correto seria um estado probe.

---

### FINDING-P5-2 — `rpcCall` não retenta em EPIPE / EHOSTUNREACH / ENETUNREACH

**Severidade**: P5 — Baixo **Localização**: `rpcCall()` linhas ~100-135

```js
const TRANSIENT = new Set(['ECONNRESET', 'ECONNREFUSED', 'TimeoutError']);
if (!TRANSIENT.has(err.code ?? err.name)) throw err;
```

Erros como `EPIPE`, `EHOSTUNREACH` e `ENETUNREACH` são transientes e deveriam ser retentados, mas
atualmente são relançados imediatamente como falha.

---

## 4. Pontos positivos

- **UPG-02 circuit breaker**: previne flood de requisições quando o servidor MCP está down.
- **BUG-MED-09 boot backoff**: crescimento exponencial do delay em tentativas iniciais.
- **MELHORIA-11**: retry com exponential backoff + jitter — anti-thundering-herd.
- `buildZodSchema` recursivo com suporte a `oneOf`/`anyOf`, `enum`, nested objects, arrays —
  robusto.
- `overridesBuiltInTool: true` — MCP tools têm precedência sobre Copilot built-ins.
- `_resetMcpState()` para isolamento de testes.
- `rpcCall` usa `AbortSignal.timeout(8000)` — não bloqueia indefinidamente.

---

## 5. Score

| Dimensão                      | Nota       |
| ----------------------------- | ---------- |
| Resiliência (circuit + retry) | 9/10       |
| Correção do schema Zod        | 7.5/10     |
| Configurabilidade             | 7.5/10     |
| **Global**                    | **8.0/10** |

---

_Arquivo gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
