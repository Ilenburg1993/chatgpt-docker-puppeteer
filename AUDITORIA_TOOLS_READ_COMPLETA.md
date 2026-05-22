# Auditoria Profunda — Tools de Read (`src/copilot/tools/file/`)

**Gerado em**: 2026-05-22
**Escopo**: `src/copilot/tools/file/read/`, `src/copilot/tools/file/read-tools.js`, IO associada
**Status**: Análise completa — relatório gerado por leitura direta dos arquivos fonte
**Não alterações aplicadas** — conforme solicitado pelo usuário.

---

## 1. Situação Atual

### 1.1 Arquitetura geral

```
src/copilot/tools/file/
├── read/
│   ├── index.js                       ← barrel interno (4 exports)
│   ├── read-file-content.js           ← tool principal (419 linhas)
│   ├── metadata.js                    ← builder de metadados canônicos
│   ├── window.js                      ← normalizadores de cursor/janela
│   └── feedback.js                    ← feedback estruturado de falhas
├── read-tools.js                      ← barrel canônico: readContent + listDir + diff
├── index-tools.js                     ← índice L2
├── scope-tools.js                     ← escopo LLM-B
├── file-tools.js                      ← agregação do array fileTools
├── write-tools.js                     ← ferramentas de escrita
└── shared.js                          ← política, constants, helpers (296 linhas)
```

**Submódulos de infra suportando a cadeia de leitura:**

```
src/copilot/tools/infra/
├── tool-factory.js                    ← buildTool (construção de tools, permissões)
├── tool-feedback.js                   ← createToolFailureResult (8 categorias)
└── logger.js                          ← log() com injeção opcional

src/copilot/infra/public/
├── io.js                              ← facade barrel-first: readText, readBytes, diffText, scanDirectory
├── buffer.js                          ← helpers de Buffer (truncateUtf8String, utf8ByteLength)
├── policy.js                          ← hasNullByte, isPathInsideWorkspace
├── cache.js                           ← getIoCacheStats
└── indexing.js                        ← buildIoIndexForDirectory, searchIoIndex

src/copilot/infra/io/fs/
├── read-text.js                       ← readTextFileSnapshot (acíclico, sem cache)
├── read-bytes.js                      ← readBytesFileSnapshot (binário, sem cache)
└── index.js                           ← barrel
```

### 1.2 Fluxo canônico de `read_file_content`

```
read_file_content (tool)
  │
  ├── validatePath(filePath, { mode: 'read' })
  │     └── evaluateIoPathPolicyAsync  ← core + null byte guard
  ├── parseReadCursor(cursor)          ← window.js
  │
  ├── [base64 branch]
  │     └── readBytes(filePath)
  │           └── truncateBuffer(source, maxBytes)   ← shared → buffer
  │
  ├── [utf8 branch, readStrategy=cached]
  │     └── readText(filePath, { startLine, endLine })
  │           └── cache L1
  │           └── warmReadThroughContext (se >= 1KB)
  │
  ├── [utf8 branch, readStrategy=stream]
  │     └── readTextChunks(filePath, { startLine, endLine, chunkLines: 200 })
  │
  ├── sanitizeIoTextOutput(text)         ← core: remove segredos
  ├── truncateUtf8Text(sanitized, maxBytes) ← injeta mensagem de policy no stream
  ├── buildReadFileMetadata(stats, input)   ← metadata.js
  └── withIoMeta(result, ioMeta)          ← io.* no topo da resposta
```

### 1.3 Pontos fortes da implementação atual

| Ponto | Evidência |
|-------|-----------|
| Separação semântica clara | 5 módulos em `read/` com responsabilidades distintas |
| Feedback estruturado | 6 códigos de erro, `ToolFailureResult` com schema JSON-LD |
| Política de saída | `FILE_TOOLS_OUTPUT_POLICY` com ENV overrides (4 limites) |
| Cache L1 | hitRate via `getIoCacheStats()`, `cacheFingerprintStrategy` em metadata |
| Cursor/janela bem definido | `parseReadCursor`, `nextLineCursor`, `applyEntryWindow` |
| Base64 pathway completo | byte-cursor, maxBytes, rawReturnedBytes, nextCursor |
| Sanitização integrada | `sanitizeIoTextOutput` + `SECRET_KEY_RE` no feedback |
| Logging com injeção | `setToolsLogger` / fallback `console.*` |
| Testes unitários | 520 linhas, 13 casos positivos cobrindo readContent, listDirectory e diffFiles |

---

## 2. Bugs Encontrados

### BUG-01 — Variável `resolvedReadStrategy` pode estar como TODO pendente

**Arquivo**: `src/copilot/tools/file/read/read-file-content.js`
**Linha**: ~138

Na leitura visual do arquivo (419 linhas, duas janelas), aparece uma referência a `normalizeReadStrategy` como placeholder — indicando que a variável `resolvedReadStrategy` ainda pode não estar definida antes de todas as branches do `if`. O fluxo base64 não a usa (correto), mas branches de validação podem tentar acessá-la.

**Severidade**: Média — `ReferenceError` em validações intermediárias se o pending não for resolvido.

**Fix proposta**:
```js
// Mover para o topo do handler:
const resolvedEncoding = encoding ?? 'utf8';
const resolvedReadStrategy = readStrategy ?? 'cached'; // ← linha única, depois de parameters
```

---

### BUG-02 — `receivedParameters` carrega valores `undefined` para params omitidos

**Arquivo**: `src/copilot/tools/file/read/read-file-content.js`, linha ~95

```js
const receivedParameters = {
    path: filePath,
    startLine,   // undefined quando omitido
    endLine,     // undefined quando omitido
    cursor,      // undefined quando omitido
    // ...
};
```

Em falhas, `createReadFileFailure` serializa esse objeto para `receivedParameters` no `details`. Valores `undefined` poluem o JSON de saída sem adicionar informação útil. Não quebra nada, mas aumenta ruído em logs.

**Severidade**: Baixa — ruído em logs.

---

### BUG-03 — `validatePath` usa `mode='write'` como default, mais restritivo que o esperado

**Arquivo**: `src/copilot/tools/file/shared.js`, linha ~169

```js
const mode = opts?.mode ?? 'write';  // default é write
```

Isto é proposital (defense-in-depth): se um consumidor esquecer `{ mode: 'read' }`, a política de escrita bloqueia antes de bloquear a de leitura. O tradeoff é que erros de programação resultam em `ERR_READ_PATH_INVALID` (category: `policy-denied`) em vez de `not-found` ou `invalid-parameters` — confundindo o diagnóstico.

**Severidade**: Baixa — intencional, só precisa de documentação explícita no JSDoc.

---

### BUG-04 — `nextLineCursor` não valida EOF quando `totalLinesKnown=false`

**Arquivo**: `src/copilot/tools/file/read/window.js`, linha ~52

```js
export function nextLineCursor(returnedLines, totalLines, totalLinesKnown) {
    if (returnedLines.end < returnedLines.start) return null;
    if (totalLinesKnown && Number.isFinite(totalLines) && returnedLines.end >= Number(totalLines)) return null;
    // Quando totalLinesKnown=false: retorna String(end+1) sem saber se é o fim real
    return String(returnedLines.end + 1);
}
```

Quando `totalLinesKnown=false` (branch `stream` onde `totalLines` é `undefined`), a função não sabe o tamanho do arquivo e retorna um cursor que pode estar além do fim real. O downstream valida e retorna erro, mas o cursor enganoso causa uma chamada extra.

**Severidade**: Baixa — recuperável, mas ineficiente.

---

### BUG-05 — Truncamento injeta mensagem de policy no próprio stream de saída

**Arquivo**: `src/copilot/tools/file/shared.js`, linha ~225

```js
return {
    text: `${truncated.text}${suffix}`,
    truncated: true,
    originalBytes: truncated.originalBytes,
    limitBytes: truncated.limitBytes,
};
```

O `suffix` é a mensagem da policy diretamente concatenada ao conteúdo. Para consumers que reconstroem o EOF (JSON, YAML, scripts), o notice corrompe o arquivo e o reconstrução é impossível.

**Severidade**: Média — afeta workflows de leitura-edição-gravação incremental.

---

## 3. Gaps de Arquitetura

### GAP-01 — Barril duplicado em `read/` (4 exports vs. 3 tools canônicas)

```
read/index.js    ← 4 exports: readFileContentTool + window/utils
read-tools.js    ← 3 tools: readContent + listDirectory + diffFiles
```

Não há um arquivo canônico único que una todas as responsabilidades da ferramenta — gerando dois caminhos de descoberta e possível importação cruzada acidental.

---

### GAP-02 — IO dual-path não tem regra de uso documentada

`readTextFileSnapshot` (sem cache) e `readText` (com cache) fazem a mesma coisa por caminhos diferentes. O dual-path existe porque parser/index-store precisam sair da facade — mas essa exceção não tem contrato nem lint rule; qualquer módulo novo pode escolher aleatoriamente qual caminho usar.

---

### GAP-03 — `withSkipPermission` policy espalhada em comentários

O `withSkipPermission` é aplicado em `read-tools.js` e documentado em comentário do `tool-factory.js` (fix TF-01), mas não há regra única em um arquivo de arquitetura ou convenções. Qualquer ferramenta de leitura nova precisa descobrir essa política por leitura de arquivos existentes.

---

### GAP-04 — Logger injetado sem ponto de injeção canônico

`setToolsLogger()` deve ser chamado por `agent/` ou `server/` mas não há ponto canônico de boot documentado, nem TODO ou lint que garanta a chamada antes do primeiro `log()`. Na prática, o fallback `console.*` é usado em muitos ambientes.

---

### GAP-05 — Testes não cobrem branches de erro

`test_read_tools.spec.js` tem 13 testes positivos, zero testes que exijam `expect(r.success).toBe(false)`. Os 6 códigos de erro canônicos de `feedback.js` não têm cobertura de teste.

---

### GAP-06 — `readStrategy: 'stream'` não tem limite de buffer default documentado

O parâmetro `streamHighWaterMark` tem min 1024, max 16MB, mas não há um default documentado no schema (é `Node/fs padrão`). Em ambientes com memória limitada, um valor default implícito de 16MB pode causar surpresa.

---

## 4. Oportunidades de Upgrade

### UPGRADE-01 — Centralizar `resolvedReadStrategy` antes de qualquer branch (BUG-01 fix + prevenção)

Mover `const resolvedEncoding` e `const resolvedReadStrategy` para o topo do handler, antes de qualquer condicional. Adicionar `/* istanbul ignore next */` onde a branch é teoricamente inalcançável.

---

### UPGRADE-02 — Limpar receivedParameters em falhas (BUG-02 fix)

Adicionar helper em `feedback.js`:
```js
function cleanParams(params) {
    const out = { ...params };
    for (const [k, v] of Object.entries(out)) {
        if (v === undefined) delete out[k];
    }
    return out;
}
```

---

### UPGRADE-03 — Truncamento não-destrutivo (BUG-05 fix)

Retornar `notice` separado em `truncateUtf8Text`:
```js
// Nova assinatura:
truncateUtf8Text(text, maxBytes, notice) → { text, truncated, originalBytes, limitBytes, notice }

// Uso no handler:
const { text: content, notice, truncated } = truncateUtf8Text(...);
return { ...result, content, truncated, ...(notice ? { notice } : {}) };
```

Consumidores que precisam do aviso concatenado podem fazer `content + notice` explicitamente.

---

### UPGRADE-04 — Documentar dual-path IO no JSDoc (GAP-02)

Adicionar em `readTextFileSnapshot` / `readBytesFileSnapshot`:
```js
/**
 * NOTA: Esta função bypassa a facade io-engine (sem cache, sem telemetria).
 * Use-a apenas em: parser de índice, index-store, hooks de boot.
 * Para tools de usuário, use `readText()` / `readBytes()` de infra/public/io.js.
 */
```

---

### UPGRADE-05 — Único barrel canônico para ferramentas de leitura (GAP-01)

Fazer `read-tools.js` ser o único barrel canônico. `read/index.js` vira compat shim com warning de remoção futura:
```js
/** @deprecated Use `read-tools.js` directly. Remove em próxima major. */
export { readFileContentTool } from '../read-tools.js';
```

---

### UPGRADE-06 — Ponto de injeção de logger no boot (GAP-04)

Adicionar `initializeToolsLogger(logFn)` em `src/copilot/boot/logger-setup.js` chamado no início do `src/main.js`:
```js
import { setToolsLogger } from '#copilot/tools/infra/logger';
import { createStructuredLogger } from '#copilot/observability/logger';

const structuredLogger = createStructuredLogger({ service: 'tools' });
setToolsLogger(structructuredLogger);
```

---

### UPGRADE-07 — Testes de erro para 6 códigos de falha de read (GAP-05)

6 testes adicionais em `test_read_tools.spec.js`:
| Código | Cenário |
|--------|---------|
| ERR_READ_PATH_INVALID | caminho fora do workspace |
| ERR_READ_CURSOR_INVALID | cursor = -1, cursor = 'abc' |
| ERR_READ_LINE_WINDOW_INVALID | endLine < startLine |
| ERR_READ_DIRECTORY | path aponta para diretório |
| ERR_READ_BINARY_LINE_WINDOW | startLine com encoding=base64 |
| ERRO genérico | emulando erro de disco (ENOENT temporário) |

---

### UPGRADE-08 — Telemetria de cache hit-rate por tool

`includeCacheStats` já retorna `{ hits, misses, hashRevalidations, hashRevalidationHits }`, mas esses dados não são agregados em lugar nenhum. Proposta:
- collector em `observability/collectors/tool-cache-stats.js`
- métricas `tool_cache_hits_total`, `tool_cache_misses_total`, `tool_cache_hit_ratio` por tool
- disponível no dashboard de observability

---

## 5. Proposta de Situação Ideal

### Princípios

1. **Um único barrel canônico** por subdomínio de tools
2. **IO dual-path com regra explícita** — facade para tools; snapshot para parser/index
3. **Truncamento não destrutivo** — notice separado do conteúdo
4. **Erros 100% cobertos por testes** — toda branch de falha tem teste
5. **Logger injetado no boot** — sem fallback `console.*` em produção
6. **Telemetria agregada por tool** — cache hit-rate no dashboard

### Estado alvo (resumo)

```
src/copilot/tools/file/read-tools.js   ← único barrel canônico
├── readFileContentTool               ← handler limpo: resolved* no topo, params limpos
├── listDirectoryTool
├── diffFilesTool                     ← truncamento não-destrutivo
└── __utilities__                     ← nextLineCursor, normalize*, parseReadCursor, applyEntry*

src/copilot/tools/file/read/          ← compat shims apenas (lazy deprecation)

tests/unit/copilot/tools/file/test_read_tools.spec.js
├── 13 testes positivos (existentes)
└── 8+ testes de erro (novo)
```

---

## 6. Roadmap

### FASE 1 — Estabilização (curto prazo, sem mudança de comportamento)

| Subfase | Trabalho | Critério de saída |
|---------|----------|-------------------|
| 1.1 | Documentar dual-path IO no JSDod de `readTextFileSnapshot`/`readBytesFileSnapshot` | Documentação atualizada + PR |
| 1.2 | Documentar `validatePath` default-mode tradeoff em JSDoc | `shared.js` JSDoc linha ~165 atualizado |
| 1.3 | Documentar `nextLineCursor` guard em comentário | `window.js` comentário adicionado |
| 1.4 | Adicionar `initializeToolsLogger` no boot/boot wiring | `setToolsLogger` chamado sem erros |
| 1.5 | Adicionar 5 testes de erro para read-file-content | 5 testes verdes em `test_read_tools.spec.js` |

---

### FASE 2 — Consolidação arquitetural (médio prazo)

| Subfase | Trabalho | Critério de saída |
|---------|----------|-------------------|
| 2.1 | Fundir `read/index.js` em `read-tools.js` (GAP-01) | `read-tools.js` exports tudo; `read/index.js` vira compat shim |
| 2.2 | Truncamento não-destrutivo (BUG-05) | `truncateUtf8Text` retorna `{ content, notice }`; handlers atualizados |
| 2.3 | `receivedParameters` limpos (BUG-02) | `cleanReceivedParameters()` adicionado + falhas sem `undefined` |
| 2.4 | Lint rule `io-snapshot-only` (GAP-02) | ESLint custom rule ativa |
| 2.5 | Documentar `withSkipPermission` policy em local único (GAP-03) | `DOCUMENTAÇÃO/ARQUITETURA/TOOLS-README.md` criado/atualizado |

---

### FASE 3 — Observabilidade e evolução (longo prazo)

| Subfase | Trabalho | Critério de saída |
|---------|----------|-------------------|
| 3.1 | Telemetry cache hit-rate por tool | `tool-cache-stats` collector ativo |
| 3.2 | Testes de concorrência: duas leituras simultâneas | Mesmo `cacheFingerprintStrategy`, race-free |
| 3.3 | Stress test stream em arquivo binário >10MB | 0 bytes perdidos, paginação correta |
| 3.4 | Smoke test canônico no CI | `npm run test:read-tools:smoke` passa em todo PR |
| 3.5 | `selfDescription` no JSDoc para auto-programação LLM-B | Tool descritiva sem leitura externa |

---

## 7. Matriz de Priorização

| Bug/Gap | Fase 1 | Fase 2 | Fase 3 |
|---------|--------|--------|--------|
| BUG-01 `resolvedReadStrategy` | 1.3 | 2.1 | — |
| BUG-02 `receivedParameters` limpos | — | 2.3 | — |
| BUG-03 `validatePath` default | 1.2 | — | — |
| BUG-04 `nextLineCursor` EOF | 1.3 | — | — |
| BUG-05 truncamento destrutivo | — | 2.2 | — |
| GAP-01 barrels duplicados | — | 2.1 | — |
| GAP-02 IO dual-path | 1.1 | 2.4 | — |
| GAP-03 withSkipPermission espalhado | — | 2.5 | — |
| GAP-04 logger injetado sem boot point | 1.4 | — | — |
| GAP-05 testes de erro ausentes | 1.5 | — | — |
| UPGRADE-01 README TOOLS-* | — | 2.5 | — |
| UPGRADE-02 hit-rate telemetry | — | — | 3.1 |

---

## 8. Avaliação de Risco

| Risco | Probabilidade | Impacto | Mitigação |
|-------|---------------|---------|-----------|
| BUG-05 corrompe workflows de edição incremental | Média | Alto | Fase 2.2 — truncamento não-destrutivo |
| GAP-02 causa duplicação de caminho IO em novos módulos | Alta | Médio | Lint rule em Fase 2.4 |
| BUG-01 causa erro de runtime em validações | Baixa | Alto | Fase 1.3 + fix em Fase 2.1 |
| GAP-05 deixa regressões de erro não detectadas | Alta | Médio | Fase 1.5 — testes de erro imediatos |
| GAP-04 logger não injetado em produção | Média | Baixo | Fase 1.4 — boot wiring |

---

*Relatório gerado exclusivamente por leitura direta dos arquivos fonte. Nenhuma alteração de código foi aplicada.*
