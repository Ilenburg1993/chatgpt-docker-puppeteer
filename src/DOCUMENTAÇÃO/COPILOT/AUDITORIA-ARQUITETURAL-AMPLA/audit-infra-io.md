# Auditoria estrutural — src/copilot/infra/io

**Arquivo:** `src/DOCUMENTAÇÃO/COPILOT/AUDITORIA-ARQUITETURAL-AMPLA/audit-infra-io.md`  
**Escopo:** `src/copilot/infra/io/**`  
**Foco:** parser, I/O filesystem, invalidação, busca textual/simbólica e patch/diff  
**Data:** 2026-06-12

---

## 1. Mapa arquitetural

### 1.1 Owners canônicos

| Módulo                                        | Papel                                            | Estado                            |
| --------------------------------------------- | ------------------------------------------------ | --------------------------------- |
| `src/copilot/infra/io/fs/index.js`            | Barrel puro de filesystem baixo                  | ✅ puro import/export             |
| `src/copilot/infra/io/fs/locked-writes.js`    | Escritas atômicas + append + mkdir sob lock      | ✅ owner único                    |
| `src/copilot/infra/io/fs/locked-mutations.js` | Delete/remove/copy/move/patch sob lock           | ⚠️ monolítico (732 linhas)        |
| `src/copilot/infra/io/fs/read-services.js`    | Leitura unificada (text, bytes, lines, chunks)   | ⚠️ monólito (667 linhas)          |
| `src/copilot/infra/io/fs/rollback-sidecar.js` | Sidecars para rollback                           | ✅ owner claro                    |
| `src/copilot/infra/io/fs/snapshot.js`         | Snapshot binário                                 | ✅ owner claro                    |
| `src/copilot/infra/io/fs/read-chunks.js`      | Leitura em chunks                                | ✅ owner claro                    |
| `src/copilot/infra/io/jsonl-reader.js`        | Leitura/recuperação JSONL                        | ✅ owner único                    |
| `src/copilot/infra/io/jsonl-file-writer.js`   | Writer JSONL serializado com rotação             | ✅ owner único                    |
| `src/copilot/infra/io/invalidation/`          | Bus + cache tiers + eventos de invalidação       | ✅ decomposição clara             |
| `src/copilot/infra/io/search/`                | Busca textual, simbólica, subprocesso, paginação | ⚠️ `text-search.js` é um monólito |
| `src/copilot/infra/io/patch/`                 | Diff e patch textual com observabilidade         | ✅ decomposição clara             |

### 1.2 Fluxo canônico atual

```
Mutação (locked-writes | locked-mutations)
    ↓
invalidateIoCacheTiers() → cache L1 + L2
    ↓
flushIoInvalidationQueue() → bus de invalidação
    ↓
Hook observers (quem usa o dado recebe o sinal)

Leitura (read-services)
    ↓
Cache L1/L2 + stat snapshot
    ↓
Return IoMeta (bytesRead, durationMs, traceId)

Busca (search)
    ↓
subprocess.js ← adapter ← text-search/index-search/symbol-search
    ↓
result-paginator + output-window policy
```

### 1.3 Contratos públicos relevantes

- `#{copilot/core}/io-contracts` ⇒ tipos de `IoMeta`, `IoRiskClass`
- `withIoResourceLock(filePath, operation, target, riskClass)` ⇒ lock canônico
- `publishIoOperation(io, {success, error})` ⇒ telemetria obrigatória

---

## 2. Bugs e gaps confirmados

### 🔴 BUG-IO-01: Caminho perigoso em `repairJsonlTrailingPartial` quando `size > maxTrailingRecordBytes`

**Arquivo:** `src/copilot/infra/io/jsonl-reader.js`  
**Severidade:** Alta  
**Evidência:** linhas ~45–70

```javascript
const readStart = Math.max(0, size - maxTrailingRecordBytes);
const trailing = Buffer.alloc(size - readStart);
await handle.read(trailing, 0, trailing.byteLength, readStart);
if (trailing.at(-1) === 0x0a) return repairResult('newline-terminated', size, size);
const lastNewline = trailing.lastIndexOf(0x0a);
if (readStart > 0 && lastNewline < 0) return repairResult('trailing-record-too-large', size, size);
const recordStart = lastNewline < 0 ? 0 : readStart + lastNewline + 1;
```

**Problema:** quando `size > maxTrailingRecordBytes` e o último newline cai exatamente em
`readStart` (ou antes), a função retorna `trailing-record-too-large` sem um fallback explícito para
"pule um bloco e tente novamente". Isso deixa arquivos com registro legítimo > 4MB não reparáveis
por padrão. O contrato atual não documenta essa limitação.

### 🔴 BUG-IO-02: `ENOTDIR` não é distinguível de ENOENT em `writeFileAtomic`

**Arquivo:** `src/copilot/infra/io/fs/locked-writes.js`  
**Severidade:** Média  
**Evidência:** linhas ~88–102

```javascript
if (options.failIfExists) {
    try {
        await fs.access(filePath);
        // throw EEXIST...
    } catch (accessError) {
        const code = accessError?.code;
        if (code !== 'ENOENT' && code !== 'ENOTDIR') throw accessError;
    }
}
```

**Problema:** `ENOTDIR` é swallowado junto com `ENOENT` no mesmo branch silencioso. O caller recebe
sucesso implícito em um caminho que na realidade é erro de path component. Isso pode levar a
overwrite inesperado via `writeAtomicFileUnlocked` depois.

### 🟡 BUG-IO-03: `copyFileUnlocked` não normaliza ROOT/symlinks em COPYFILE_EXCL

**Arquivo:** `src/copilot/infra/io/fs/copy.js`  
**Severidade:** Média  
**Evidência:** linha 30

```javascript
await copyFile(source, tmpDestination, nodeFs.constants.COPYFILE_EXCL);
```

**Problema:**

- `node:fs.copyFile` com `COPYFILE_EXCL` falha com `EEXIST` se o `tmpDestination` já existir.
- Em cenários de retry com `invalidateIoCacheTiers` que não remove temporários antigos, isso causa
  falhas transitórias sem retry automático.
- Não há bound de tempo nem retry antes de falhar.

### 🟡 BUG-IO-04: Inconsistência entre `IoMeta` publicado e resultado real em `mkdirPathLocked`

**Arquivo:** `src/copilot/infra/io/fs/locked-writes.js`  
**Severidade:** Média  
**Evidência:** linhas ~310–330

```javascript
export async function mkdirPathLocked(dirPath, options = {}) {
    // ...
    const { waitMs } = await withIoResourceLock(
        dirPath,
        async () => mkdirPathUnlocked(dirPath, ...),
        { operation: 'mkdir', ... }
    );
    const io = publishAndReturn(
        buildIoMeta({ ..., target: dirPath, ... }),
        true,
    );
    return withIoMeta({ path: dirPath, created: true, lockWaitMs: waitMs }, io);
}
```

**Problema:**

- `mkdirPathUnlocked` com `recursive: true` pode retornar sem criar nada (diretório já existia).
- O `created: true` é hardcoded; o owner baixo `mkdir.js` não retorna `created`.
- O `IoMeta` sempre publica `success: true`, mesmo quando `EEXIST` foi swallowado pelo mkdir
  recursivo.
- Se `EEXIST` for swallowing sem sinalizar, os observers não conseguem distinguir "criado" de "já
  existia".

### 🟡 GAP-IO-01: ` jsonl-file-writer.js` não garante ordenação em cenário concorrente de rotacao

**Arquivo:** `src/copilot/infra/io/jsonl-file-writer.js`  
**Severidade:** Alta  
**Evidência:** linhas ~90–110

```javascript
const batch = queue.splice(0, batchLines);
const filePath = resolveFilePath();
// ...
await appendFile(filePath, data, { encoding: 'utf8', flush: flushToDisk });
```

**Problema:**

- `resolveFilePath()` chama `options.filePath()` novamente no momento do flush, não no enqueue.
- Se `filePath` for dinâmico, batches podem fluir para paths diferentes em ordem enfileirada
  diferente.
- Não há contrato que obrigue `filePath` estável; o builder aceita função sem validar estabilidade
  intra-batch.

### 🟡 GAP-IO-02: Falta status canônico `` em `search/subprocess.js`

**Arquivo:** `src/copilot/infra/io/search/subprocess.js`  
**Severidade:** Baixa  
**Evidência:** linha ~40 (início do módulo)

```javascript
let _rgAvailable = null;
```

**Problema:** há cache de disponibilidade de `rg`, mas `isRipgrepAvailable` não valida freshness
após falhas transitórias (ex: PATH mudou em hot reload). O cache vive enquanto o processo está up.

### 🟢 GAP-IO-03: `formatIndexSearchRows` mascara colchetes em snippets

**Arquivo:** `src/copilot/infra/io/search/index-search.js`  
**Severidade:** Baixa  
**Evidência:** linhas ~70–80

```javascript
.replace(/\[([^\]]*)\]/gu, '**$1**')
```

**Problema:** highlights de FTS5 `[match]` são convertidos para markdown bold sem escape. Se o
snippet contiver texto com colchetes legítimos, a formatação pode poluir o display downstream.

---

## 3. Oportunidades de upgrade

### 🚀 UPGRADE-IO-01: Extrair `JsonlParserErrorBoundary` do `jsonl-reader.js`

**Motivo:** `jsonl-reader.js` mistura recuperação estrutural (`repairJsonlTrailingPartial`) com
leitura (`readJsonlTail`). Separar em `jsonl-repair.js` + `jsonl-reader.js` reduz acoplamento e
deixa o parser reutilizável por `jsonl-file-writer.js`.

### 🚀 UPGRADE-IO-02: Tornar `writeFileAtomic` observável em `ENOTDIR`

**Motivo:** Atualmente, `ENOTDIR` é indistinguível de `ENOENT` no branch `failIfExists`. Adicionar
telemetria/retorno semântico de `ENOTDIR` permite diagnósticos mais precisos e reduz falhas
silenciosas.

### 🚀 UPGRADE-IO-03: Introduzir `FilePathStabilityContract` em `jsonl-file-writer.js`

**Motivo:** Garantir que `filePath` dinâmico não cause salto de path mid-batch. Um contrato simples
(`stableForBatch?: boolean`) ou normalização em `enqueueLine` evita dispersão de dados.

### 🚀 UPGRADE-IO-04: Adicionar retry com backoff em `copyFileUnlocked`

**Motivo:** Falhas por `EEXIST` em tmp file devem ser transitórias, não fatais. Adicionar 1–2
retries bounds por `ECOPYMISMATCH`/`EEXIST` aumenta resiliência sem mudar semântica.

### 🚀 UPGRADE-IO-05: Normalizar `mkdirPathLocked.created` via retorno de `mkdirPathUnlocked`

**Motivo:** O owner baixo deve informar se criou ou reaproveitou. Mudar `mkdirPathUnlocked` para
retornar `{path, created}` e propagar elimina o hardcode `created: true` em `locked-writes.js`.

### 🚀 UPGRADE-IO-06: Decompor `text-search.js` (35KB) em `search-driver.js` + adapters

**Motivo:** O arquivo concentra motor de busca, lógica de ripgrep/grep/fzf e definição de
heurísticas. Separar em:

- `text-search-driver.js` (roteamento)
- `text-search-rg.js` (ripgrep)
- `text-search-heuristics.js` (fallbacks) deixa o sistema mais testável e mais próximo da
  arquitetura 2.0/2.1.

### 🚀 UPGRADE-IO-07: Adicionar `IoMeta.freshness` e bind em invalidação

**Motivo:** Hoje, quem invalida não sabe se o cache alvo já estava stale. Acrescentar `freshness` em
`IoMeta` e usar em `cache-tiers.js` permite que hooks reajam apenas quando necessário, reduzindo
custo.

### 🚀 UPGRADE-IO-08: Reviewer formal de `riskClass` em `search/subprocess.js`

**Motivo:** Hoje, `execSearchFile` usa `spawn` com stdin ignorado, mas `riskClass` não é thread-safe
em cross-processo. Introduzir contrato de risk class no subprocesso alinha busca com a modelagem de
risco do resto do I/O.

---

## 4. Recomendação de ordem de execução

1. **Corrigir BUG-IO-01 e BUG-IO-02 primeiro** (falhas silenciosas em parser e writer).
2. **UPGRADE-IO-05** (normalizar `created` no mkdir). Baixo esforço, ganho alto em observabilidade.
3. **UPGRADE-IO-01** (separar parser do reader). Reduz complexidade, melhora testabilidade.
4. **UPGRADE-IO-03/04/06** em sequência. Maior impacto arquitetural, pede validação com testes de
   integração de I/O.

---

## 5. Evidência de estado atual

- `jsonl-reader.js`: 188 linhas, 1 owner, sem shims alternativa conhecida.
- `jsonl-file-writer.js`: 216 linhas, 1 owner, contrato dinâmico de `filePath` sem validação de
  estabilidade.
- `locked-writes.js`: 331 linhas, usa `withIoResourceLock`, publica `IoMeta` para todas as
  operações.
- `locked-mutations.js`: 732 linhas, mesma facade, divide-se em copy/move/remove/patchText.
- `text-search.js`: 836 linhas, maior arquivo do IO; concentra motor de busca.
- `invalidation/bus.js`: usa debounce variável por runtime; hooks são best-effort.

---

## 6. Status de execução — 2026-06-13

Após revisão da base atual, foram aplicadas correções pequenas e compatíveis com os contratos
existentes:

- `src/copilot/mcp/cloudflare/config.js`: `DEFAULT_QUICK_TUNNEL_STALE_AFTER_MS` elevado de 6h para
  24h (`24 * 60 * 60 * 1000`). Isso muda o default de stale/reconexão do quick tunnel para pelo
  menos 24 horas. O processo MCP em execução ainda reporta 6h até ser reiniciado, pois ele carrega a
  configuração em memória.
- `src/copilot/infra/io/fs/locked-writes.js`: `writeFileAtomic(..., { failIfExists: true })` deixou
  de tratar `ENOTDIR` como se fosse `ENOENT`; `ENOTDIR` agora é propagado, evitando mascarar path
  component inválido.
- `src/copilot/infra/io/fs/mkdir.js` e `locked-writes.js`: `mkdirPathLocked()` agora propaga
  `created` e `createdPath` reais retornados por `fs.mkdir`, em vez de publicar sempre
  `created: true`.
- `src/copilot/terminal/module-map.js`: `state/transcript-state.js` passou de `stable` para `watch`,
  refletindo o tamanho/complexidade real do módulo.
- `src/copilot/terminal/state/index.js` e `terminal-phases/boot-shutdown.js`:
  `flushTerminalTranscriptArchive` passou pelo barrel de `state/`, removendo import cross-folder
  interno direto.
- `tests/unit/copilot/infra/test_io_engine.spec.js` e contratos do terminal/cloudflare foram
  atualizados para cobrir os novos comportamentos.

Validação executada:

- `typecheck:strict:src.copilot`: PASS (`95cde898-0d57-49bf-8e25-01fe85e998ce`).
- `lint:copilot`: PASS (`c7f94088-4ebc-446a-a34e-ac57991dd732`).
- `unit-copilot`: PASS (`7221452d-0104-415d-b9a8-a00129eaeb0f`).

### 6.1 Status adicional — BUG-IO-01 corrigido em 2026-06-13

Foi corrigido o comportamento de `repairJsonlTrailingPartial()` para a última linha JSONL maior que
a janela rápida de reparo:

- `src/copilot/infra/io/jsonl-reader.js` ganhou uma varredura reversa limitada por
  `maxRepairScanBytes`, com default de 16 MiB.
- A janela rápida `maxTrailingRecordBytes` continua servindo como orçamento conservador para linhas
  sem newline conhecido.
- Quando existe newline anterior dentro da varredura limitada, o reparo agora consegue validar
  registros finais legítimos maiores que a janela rápida ou truncar partials grandes no ponto
  correto.
- Quando não há newline conhecido e a linha excede `maxTrailingRecordBytes`, o arquivo permanece
  intacto e o resultado segue `trailing-record-too-large`, evitando alocação/truncate de linha única
  sem boundary seguro.
- Foram adicionados testes em `tests/unit/copilot/infra/test_jsonl_reader.spec.js` e a suíte
  existente `test_io_jsonl_reader.spec.js` permaneceu verde, cobrindo o caso de linha única acima do
  orçamento.

Validação após BUG-IO-01:

- `typecheck:strict:src.copilot`: PASS (`c6dc8cc8-8edf-4d31-bb29-339f9efa4f4a`).
- `lint:copilot`: PASS (`f6770d09-98df-4b0d-a78e-9d9a25f7d3bf`).
- `unit-copilot`: PASS (`4d8dd283-3647-492e-adc1-a349c32631a5`).

## 7. Riscos residuais

- Se `locked-mutations.js` ou `read-services.js` crescerem mais sem decomposição, a tendência é
  voltar ao formato `io-engine` monolítico de onde foram extraídos.
- A invalidação atual é best-effort silenciosa; se houver disputa entre L1 e L2 por stale data, o
  sistema atual não tem mecanismo de reconciliação.
- A janela live de stale do tunnel só muda para 24h após restart do processo MCP/Cloudflare que
  carrega `readCloudflareTunnelConfig()`.

---
