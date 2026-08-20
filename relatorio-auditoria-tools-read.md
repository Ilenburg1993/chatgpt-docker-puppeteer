# Auditoria Profunda — Tools de Read

**Gerado em**: 2026-05-21T21:40Z **Escopo**: src/copilot/tools/file/read/ + shared.js +
read-tools.js + index-tools.js + scope-tools.js + io-cache.js + read-text.js + safe_read.js
**Status**: Canônico ativo — análise somente, nenhuma alteração aplicada

---

## 1. Situação Atual

### Estrutura canônica

```
src/copilot/tools/file/
├── index.js                  # barrel público (barrel-only ✓)
├── shared.js                 # validatePath + constants + buffer utils
├── read-tools.js             # superfície pública: readFileContentTool + listDirectoryTool + diffFilesTool
├── read/
│   ├── index.js              # barrel interno (barrel-only ✓)
│   ├── read-file-content.js  # handler completo 419 linhas
│   ├── window.js             # parseReadCursor + nextLineCursor
│   ├── metadata.js           # buildReadFileMetadata
│   └── feedback.js           # createReadFileFailure
├── index-tools.js            # workspace_index_* + workspace_parse_file
├── scope-tools.js            # workspace_scope_* (6 tools)
└── README.md
```

### IO associada

```
src/copilot/infra/
├── io-cache.js               # L1 cache (LRU, 128 MiB, 60s TTL, fingerprint)
├── io/fs/read-text.js        # readText / readTextChunks (42 linhas)
├── io/fs/read-bytes.js       # readBytes (25 linhas)
├── shared/buffer.js          # truncate/concat/decode
├── shared/fingerprint-match.js
├── shared/hash.js
├── io/invalidation/bus.js    # event bus invalidation
└── cache/l1/index.js         # makeBytesKey/makeTextKey

src/infra/fs/safe_read.js     # LEGACY — safeReadJSON com retry + quarentena
```

### Status por arquivo

| Arquivo                   | Linhas | Status                                       |
| ------------------------- | ------ | -------------------------------------------- |
| read/index.js             | 13     | ✅ barrel-only puro                          |
| read/read-file-content.js | 419    | ⚠️ handler complexo (5 responsabilidades)    |
| read/window.js            | 58     | ✅ bem separado                              |
| read/metadata.js          | 73     | ✅ builder canônico                          |
| read/feedback.js          | 71     | ✅ estruturado                               |
| read-tools.js             | 206    | ⚠️ truncado runtime, topo 4 linhas não lidas |
| shared.js                 | 296    | ⚠️ truncado runtime                          |
| index-tools.js            | 357    | ⚠️ truncado runtime                          |
| scope-tools.js            | 214    | ✅ bom                                       |
| io-cache.js               | 358    | ⚠️ arquivo grande para componente isolado    |
| read-text.js              | 42     | ✅ perfeito                                  |
| read-bytes.js             | 25     | ✅ perfeito                                  |
| safe_read.js (legacy)     | 83     | ⚠️ quarentena ativa, console.error direto    |

---

## 2. Bugs Encontrados

### BUG-1 — nextCursor ausente no modo stream

**Severidade**: Média **Arquivo**: read/read-file-content.js **Evidência**: nextLineCursor só é
chamado no branch cached. No branch stream o cursor não é calculado nem adicionado ao retorno.
**Impacto**: Paginação interrompida em readStrategy=stream. **Fix**: calcular nextCursor logo após
bloco returnedLines no branch stream; adicionar ao retorno JSON.

### BUG-2 — parseReadCursor retorna ok=true, value=null para cursor ausente

**Severidade**: Baixa **Arquivo**: read/window.js **Evidência**: undefined/null/'' retornam { ok:
true, value: null }. Semântica ambígua: é um valor válido nulo ou ausência de cursor? **Impacto**:
dificulta leitura; caller precisa testar ok && value !== null como condição composta. **Sugestão**:
{ ok: false, reason: 'cursor ausente' } OU documentar explicitamente.

---

## 3. Gaps e Oportunidades

### GAP-1 — io-cache.js 358 linhas em arquivo único

**Severidade**: Alta (manutenibilidade) **Proposta**: decompor em io-cache-config.js,
io-cache-instance.js, io-cache-ops.js, io-cache-stats.js, io-cache-hooks.js.

### GAP-2 — safe_read.js é legacy sem integração canônica

**Severidade**: Média **Proposta**: grep "safe_read" em src/ tests/ scripts/; se zero importadores
em produção arquivar em infra/fs/legacy/ com @deprecated.

### GAP-3 — read-file-content.js handler mistura 5 responsabilidades (419 linhas)

**Severidade**: Média **Proposta**: extrair params.js + handler-text/stream/binary.js +
next-cursor.js.

### GAP-4 — Falta documento de contrato de cursor

**Severidade**: Baixa **Proposta**: criar docs/cursor-contract.md com formato por ferramenta.

### GAP-5 — validatePath acoplada ao boot via WORKSPACE_ROOT

**Severidade**: Baixa (acoplamento intencional) **Proposta**: documentar no JSDoc; adicionar
workspaceRoot opcional para testes.

### GAP-6 — io-cache pub-sub sem subscriber default

**Severidade**: Baixa **Proposta**: registrar subscriber L2 no boot de io-cache; adicionar teste E2E
de invalidation.

### GAP-7 — streamHighWaterMark constraint excessiva (até 16 MiB)

**Severidade**: Baixa **Proposta**: limitar max a 1 MiB; documentar fallback para cache completo.

### GAP-8 —缺少 Zod schema de retorno canônico

**Severidade**: Baixa **Proposta**: adicionar ReadFileContentResponseSchema em shared.js.

---

## 4. Proposta de Situação Ideal

### Estrutura alvo

```
src/copilot/tools/file/
├── index.js                 # barrel-only inalterado
├── shared.js                # validatePath + constants + Zod retornos
├── read-tools.js            # superfície canônica única
└── read/
    ├── index.js             # barrel-only
    ├── params.js            # validação Zod entrada
    ├── window.js            # inalterado
    ├── metadata.js          # inalterado
    ├── feedback.js          # inalterado
    ├── handler-text.js      # utf8 cached branch
    ├── handler-stream.js    # utf8 stream branch
    ├── handler-binary.js    # base64 branch
    └── next-cursor.js       # cursor L1 isolado
```

### Objetivos

| Objetivo                   | Critério                                     |
| -------------------------- | -------------------------------------------- |
| Handler ≤ 80 linhas        | Cada handler especializado                   |
| Zero duplicação            | Todos usam readText/readBytes/readTextChunks |
| Cursor canônico            | parseReadCursor tipo documentado             |
| Schema de retorno          | ReadFileContentResponseSchema em shared.js   |
| safe_read arquivado        | zero importadores em src/copilot/            |
| io-cache ≤ 100 linhas/file | 4 arquivos no lugar de 1                     |
| Testes isolados            | Cada handler com teste próprio               |

---

## 5. Roadmap

### Faixa A — Correção de bugs

#### Fase A1 — Cursores no modo stream

- A1.1 Adicionar nextLineCursor no branch stream
- A1.2 nextCursor no retorno JSON
- A1.3 Teste unitário stream 300 linhas
- A1.4 Smoke test canônico

#### Fase A2 — Clarificar parseReadCursor

- A2.1 Decidir semântica (manter ou mudar)
- A2.2 Documentar ou migrar callers

**Fecho Faixa A**: test:unit verde, lint verde, BUG-1 e BUG-2 fechados ou documentamente adiados.

---

### Faixa B — Decomposição de handlers

#### Fase B1 — params.js

- B1.1 Extrair validação/normalização
- B1.2 Zod schemas exportados
- B1.3 read-file-content.js importa params
- B1.4 Testes confirmam códigos de erro inalterados

#### Fase B2 — Handlers especializados

- B2.1 handler-text.js (utf8 cached)
- B2.2 handler-stream.js (utf8 stream)
- B2.3 handler-binary.js (base64)
- B2.4 read-file-content.js vira dispatcher puro ≤60 linhas

#### Fase B3 — next-cursor.js

- B3.1 Mover nextLineCursor + parseReadCursor
- B3.2 Documentar contrato no JSDoc
- B3.3 Atualizar read/index.js barrel

#### Fase B4 — Schema de retorno canônico

- B4.1 ReadFileContentResponseSchema em shared.js
- B4.2 Usar em feedback + mocks de teste

**Fecho Faixa B**: read-file-content.js ≤80 linhas; cada handler tem teste; lint+typecheck verdes.

---

### Faixa C — io-cache decomposição

#### Fase C1 — Tipos e config

- C1.1 io-cache-config.js (env + defaults)
- C1.2 io-cache-types.js (typedefs export)

#### Fase C2 — Instance e ops

- C2.1 io-cache-instance.js (factory singleton)
- C2.2 io-cache-ops.js (CRUD + getVerified + invalidate)

#### Fase C3 — Stats e subscriber default

- C3.1 io-cache-stats.js (stats + reset)
- C3.2 io-cache-hooks.js (pub-sub + subscriber default L2)

#### Fase C4 — Validação

- C4.1 Atualizar todos importadores
- C4.2 lint:copilot + test:unit

**Fecho Faixa C**: io-cache.js deletado; 4 arquivos novos; todos importadores atualizados.

---

### Faixa D — safe_read.js arquivamento

#### Fase D1 — Mapear importadores

- D1.1 grep "safe_read" em src/ tests/ scripts/

#### Fase D2 — Decisão

- D2.1 Sem importadores produção → infra/fs/legacy/safe_read.js @deprecated
- D2.2 Se em uso → integrar ao io-cache como fallback

#### Fase D3 — Migrar logs

- D3.1 console.error/warn → log() canônico

---

### Faixa E — Documentação

#### Fase E1 — Cursor contract

- E1.1 Criar docs/cursor-contract.md
- E1.2 Referenciar em file/README.md

#### Fase E2 — Update file/README.md

- E2.1 Seção "Cursor Contract"
- E2.2 Documentar decomposição params + handler-*
- E2.3 Link para este relatório

#### Fase E3 — Module map

- E3.1 Atualizar module-map.js
- E3.2 npm run audit:quick

---

## 6. Resumo de Priorização

| Faixa                | Prioridade | Esforço | Dependências |
| -------------------- | ---------- | ------- | ------------ |
| A1 cursors no stream | 🔴 Crítica | 1-2h    | Nenhuma      |
| A2 parseReadCursor   | 🟡 Média   | 0.5h    | Decisão      |
| B4 schema retorno    | 🟡 Baixa   | 1h      | Independente |
| B1 params.js         | 🟡 Média   | 2-3h    | A1 fechado   |
| B2 handlers          | 🟡 Média   | 3-4h    | B1           |
| B3 cursor.js         | 🟢 Baixa   | 1h      | B2           |
| C1-C3 io-cache       | 🟡 Média   | 4-6h    | Independente |
| D safe_read          | 🟢 Baixa   | 1-2h    | D1 primeiro  |
| E docs               | 🟢 Baixa   | 2-3h    | Após B e C   |

**Ordem sugerida**: A1 → A2/B4 → B1 → B2 → B3 → C1 → E1 → E2 → C2-C3 → D → E3

---

_Análise somente — nenhuma alteração aplicada._
