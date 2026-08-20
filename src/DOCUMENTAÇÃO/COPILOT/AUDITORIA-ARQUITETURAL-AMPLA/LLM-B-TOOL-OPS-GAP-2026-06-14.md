# LLM-B Tool Ops — Gap Analysis

**Data**: 2026-06-14 **Status**: investigação **Escopo**: ferramentas com maior uso operacional da
LLM-B, leitura de código real e contratos, e lacunas sentidas na operação.

---

## 1. Resumo executivo

Esta análise avalia as superfícies de ferramenta mais usadas no dia a dia da LLM-B, com foco em
`src/copilot` e runtime. O objetivo não é fazer auditoria completa de segurança, mas mapear pontos
onde a engenharia atual ajuda, onde frictiona e onde faltam capacidades que reduziriam repetição,
ruído e retrabalho.

Conclusão preliminar: há um núcleo funcional saudável, com boa cobertura de leitura, busca, Git e
lint/typecheck. Os gaps mais relevantes não são “falta de features”, mas sim **opacidade entre
camadas**, **ausência de busca semântica cross-module** e **ausência de operações de qualidade
assistidas por contrato**.

---

## 2. Inventário operacional observado

A telemetria desta sessão mostra concentração em poucas famílias:

- Leitura/IO
  - `read_file_content`
  - `search_in_files` / ripgrep IO (`io.search.io-engine.rg.search`)
  - `list_directory` / `scan.io-scanner.fs.readdir`
- Edição
  - `edit`
- Execução
  - `exec_command`
- Governança/contratos
  - `get_tool_contract_report`
  - `get_tool_health`
  - `get_telemetry`
  - `list_tools`

Isso confirma que o trabalho gira em torno de **leitura, busca, edição cirúrgica e validação**.
Qualquer gap aqui tem impacto direto na produtividade.

---

## 3. O que funciona bem agora

Força atual do tooling atual:

- Leitura com paginação e metadados (`startLine`, `endLine`, `cursor`, cache stats)
- Busca full-text eficiente via ripgrep e fallback indexado
- Edição cirúrgica por ocorrência, preservando invariantes
- Instrumentação disponível: saúde de tools, telemetria, contrato de tools
- Ferramentas Git reais (`git_status`, `git_diff`, `git_commit`, `git_push`) com semântica auditável

---

## 4. Gargalos operacionais observados

Com base na telemetria e no fluxo real:

- Latência de descoberta simbólica
  - `search_in_files` resolve, mas não é lookup simbólico.
  - Há ferramentas de índice simbólico disponíveis, mas o fluxo ainda consulta texto plano.
- Custo de leitura incremental
  - Arquivos grandes exigem janelas manuais (`startLine`/`endLine`).
- Custo de escrita em massa
  - Muitas edições pequenas repetem boilerplate de contexto.
- Falta de validação assistida por tool
  - Lint/typecheck/test não são expostos como command friendly com saída estruturada o suficiente
    para automação.
- Falta de memória operacional estruturada
  - Decisões arquiteturais são registradas em texto ou markdown, não em estrutura de dados
    consultável por tool.
- Fragmentação entre view/edit e shells auxiliares
  - Há shell tools gerais quando o ideal seria um owner específico para diagnósticos/quality gates.

---

## 5. Funcionalidades que sinto falta

Listagem priorizada do mais para o menos impactante:

### 5.1 Busca semântica cross-module (ALTA)

Hoje temos ripgrep e índice FTS5. Falta um lookup estável por **symbol/interface/owner** que
responda em O(1) sem reescan.

### 5.2 Operações de qualidade estruturadas (ALTA)

Hoje confio em `exec_command` para lint/test/typecheck/format. Falta tools com contratos explícitos:

- entrada: path/module/suite
- saída: `{ ok, checks: [...], failingFiles, metrics }`
- sideEffect: `none | write | network`

### 5.3 Memória operacional consultável (MÉDIA)

Hoje uso markdown ou texto para memória. Ideal seria um store com schema:

- decisão arquitetural
- pré/pós evidência
- delta de risco
- owner/módulo

### 5.4 Patch com pré-condições (MÉDIA)

Hoje `edit` requer exact match e não valida invariantes antes de aplicar. Seria valioso um `patch`
com:

- expectedHash
- expectedOccurrences
- dryRun opcional
- diffPreview sempre

### 5.5 Feedback incremental por tool (MÉDIA)

Hoje o retorno é “sucesso” ou erro. Falta o retorno estruturado do tipo:

- `{ status, progress, blockedReason, retryable }` Sem isso, fica difícil planejar retomada autônoma
  segura.

### 5.6 Diagnóstico sem shell genérico (MÉDIA)

`exec_command` é poderosa, mas genérica. Faltam owners:

- `diagnose_runtime`
- `diagnose_git`
- `diagnose_quality_gates`

Isso reduz ambiguidade e risco em fluxos automáticos.

### 5.7 Edição em lote com contrato (BAIXA)

Converter edições repetitivas (N arquivos, mesmo padrão) em uma operation estruturada evitaria
estresse e retrabalho manual.

### 5.8 Diff/patch semântico por módulo (BAIXA)

Hoje temos `diff_files` linha a linha. Falta diff por módulo/symbol/owner, mais alinhado à
arquitetura 2.1.

### 5.9 Alias/Template de ferramenta (BAIXA)

Faltam templates reutilizáveis: `run:lint`, `run:test:unit`, `run:typecheck`, `inspect:tool:health`
como superfícies canônicas nomeáveis.

---

## 6. Propostas de melhoria

Propostas curtas, acionáveis:

### P1 — Melhorar busca semântica

- Priorizar path canônico do índice simbólico antes de ripgrep.
- Adicionar operação `symbol_usages` como primeira classe, com schema fixo.

### P2 — Contratar operações de qualidade

- Criar tools read-only `quality:*` com saída JSON estável.
- Integrar com quality gates existentes sem duplicar runners.

### P3 — Memória operacional

- Criar store mínimo: `architecture_decision_records`.
- Consultável por owner, módulo, data e risco.

### P4 — Patch pré-condicionado

- Estender edições com `expectedHash`, `occurrenceIndex` e `dryRun`.
- Reduzir retrabalho em refactors amplos.

### P5 — Diagnósticos owners

- Separar `diagnose_runtime`, `diagnose_git`, `diagnose_quality_gates`.
- Evitar shell genérico para fluxos recorrentes.

---

## 7. Riscos e restrições

- Qualquer nova tool deve respeitar segurança, side effects explícitos e contratos JSON.
- Não substituir shell genérico onde ele é necessário; complementar, não competir.
- A governança atual (`list_tools`, `get_tool_contract_report`, `get_tool_health`) já é um ativo; a
  evolução deve preservá-la.

---

## 8. Próximos passos arquiteturais

1. Priorizar P1 e P2.
2. Medir latência e taxa de erro simbólica com tool health.
3. Selecionar 1 módulo piloto em `src/copilot` para validar tools novas em produção.
4. Documentar contratos antes de implementar (JSDoc + schema de retorno).
5. Conectar melhorias com `strict-lane-governance` e `typing-node24-esm-tsserver` para endurecer
   retornos.

---

## 9. Atualização LLM-B — investigação adicional sobre o estado real do workspace

**Data da atualização**: 2026-06-14 **Status do roadmap**: atualizado = `true` **Natureza**:
aprofundamento sobre o documento original, confrontado com arquivos reais de `src/copilot`,
`tests/unit/copilot` e `package.json`. **Resultado principal**: os gaps mais relevantes deixaram de
ser apenas “falta de tools” e passaram a ser, sobretudo, **contratos incorretos de risco**, **falsos
negativos em busca simbólica indexada**, **efeitos colaterais ocultos em leitura**, **quality gates
subexpostos como contrato JSON** e **falhas sem envelope operacional uniforme**.

### 9.1 Evidências consultadas

| Área                    | Evidência concreta                                                                      | Leitura arquitetural                                                                                                                                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quality tools           | `src/copilot/tools/code/code-tools.js`                                                  | `lint_check` tem parâmetro `fix`; quando `fix=true`, executa ESLint com `--fix`, portanto pode mutar arquivos.                                                                                                   |
| Bootstrap/metadata      | `src/copilot/tools/bootstrap.js`                                                        | O grupo `codeTools` é registrado com `readOnly: true`; no mesmo fluxo, em modo `approve_all`/`audit_only`, todas as tools efetivamente recebem `skipPermission`.                                                 |
| Inferência de risco     | `src/copilot/tools/introspection/tool-metadata.js`                                      | `readOnly=true` força `risk=low` e `sideEffect=none`, o que mascara tools com mutação dependente de parâmetro.                                                                                                   |
| Verificação de contrato | `src/copilot/tools/introspection/tool-contract-verifier.js`                             | A verificação de `RISKY_SKIP_PERMISSION` ignora tools marcadas como `readOnly`, logo não flagra `lint_check({ fix:true })`.                                                                                      |
| Busca simbólica         | `src/copilot/infra/io/search/text-search.js` + `src/copilot/infra/io-index-sqlite.js`   | `findIoIndexSymbol()` aplica `LIMIT` global no SQL e só depois filtra `targetPath`, `kind` e `exactMatch` no JS.                                                                                                 |
| Paginação de busca      | `src/copilot/infra/policy/output-window.js`                                             | Cursor inválido é normalizado silenciosamente para `0`; isso pode repetir a primeira página sem erro explícito.                                                                                                  |
| Leitura read-through    | `src/copilot/tools/file/read/read-file-content.js` + `src/copilot/infra/io-prefetch.js` | `includeReadThrough` é `true` por padrão para UTF-8 e arquivos acima do limiar; a leitura pode disparar re-read, indexação e prefetch de imports.                                                                |
| Patch                   | `src/copilot/tools/file/write/patch-file.js`                                            | Já existem `expectedHash`, `expectedOccurrences`, `occurrenceIndex`, `dryRun`, `diffPreview`, rollback e auditoria; a tese original de “patch sem pré-condições” está parcialmente superada.                     |
| Scripts de qualidade    | `package.json`                                                                          | Há amplo arsenal (`lint:copilot`, `typecheck:strict:src.copilot`, `test:copilot:unit`, `audit:*`, `check:*`, `copilot:index:*`, `mcp:stateful:*`), mas poucos são expostos como operações Tool-Ops estruturadas. |
| Testes disponíveis      | `tests/unit/copilot/**`                                                                 | Já existe base extensa de testes para file tools, search tools, IO, prefetch, index SQLite, contract verifier, bootstrap e shell. O roadmap deve aproveitar essa malha, não recriá-la.                           |

---

## 10. Diagnóstico atualizado: bugs, gaps e upgrades adicionais

### P0-A — `lint_check` pode mutar o filesystem enquanto é classificado como read-only

**Severidade**: P0 **Status**: `[x] implementado; validado por typecheck/lint e suítes afetadas`
**Arquivos envolvidos**:

- `src/copilot/tools/code/code-tools.js`
- `src/copilot/tools/bootstrap.js`
- `src/copilot/tools/introspection/tool-metadata.js`
- `src/copilot/tools/introspection/tool-contract-verifier.js`
- `tests/unit/copilot/tools/test_code_permission_tools.spec.js`
- `tests/unit/copilot/tools/test_tool_contract_verifier.spec.js`

**Problema**: `lint_check` aceita `{ fix: true }`; o handler adiciona `--fix`. Entretanto
`codeTools` é exportado com `withSkipPermission(...)` e registrado no bootstrap como
`readOnly: true`. A metadata então força risco baixo e side effect nulo. Na prática, uma tool capaz
de escrever no workspace pode passar como operação autônoma de leitura.

**Correção recomendada**:

- Separar `lint_check` e `lint_fix`.
- `lint_check`: sempre read-only, sem parâmetro `fix`.
- `lint_fix`: mutável, `requiresApproval=true`, `readOnly=false`, `risk=high`, com `dryRun`
  obrigatório por padrão e diff/summary estruturados.
- Alternativa mínima: manter uma tool, mas fazer `fix=true` recusar execução quando o registry
  marcar a tool como read-only.

**Critérios de aceite**:

- `[x]` `lint_check` não aceita `fix` ou ignora `fix` com erro claro.
- `[x]` qualquer execução com `--fix` tem tool própria ou metadata mutável.
- `[x]` Contract verifier passa a emitir erro para tool read-only com parâmetros mutáveis (`fix`,
  `apply`, `write`, `delete`, `confirm`, `overwrite`, `mode=write`).
- `[x]` Teste unitário cobre `lint_check({ fix:true })` e prova que não há mutação silenciosa.

---

### P0-B — Busca simbólica indexada pode retornar falso negativo por aplicar `LIMIT` antes do filtro de escopo

**Severidade**: P0 **Status**: `[x] implementado; validado por typecheck/lint e suítes afetadas`
**Arquivos envolvidos**:

- `src/copilot/infra/io/search/text-search.js`
- `src/copilot/infra/io-index-sqlite.js`
- `src/copilot/infra/io-index-registry.js`
- `tests/unit/copilot/infra/test_io_index_sqlite.spec.js`
- `tests/unit/copilot/infra/test_io_search.spec.js`
- `tests/unit/copilot/tools/search/test_search_tools.spec.js`

**Problema**: `searchWorkspaceSymbols()` usa o índice quando possível, mas chama
`findIoIndexSymbol(name, { maxResults })` sem `pathPrefix`, sem `kind`, sem `exactMatch` e sem
política explícita de case. Só depois filtra os resultados no JS. Se há muitos símbolos homônimos
fora do diretório pesquisado, o `LIMIT` SQL pode cortar os resultados corretos antes do filtro,
produzindo “nenhuma declaração encontrada”.

**Correção recomendada**:

- Mover `pathPrefix`, `kind`, `exactMatch` e `caseSensitive` para a consulta SQL.
- Adicionar método
  `findSymbolScoped(name, { pathPrefix, kind, exactMatch, caseSensitive, maxResults })`.
- Enquanto não houver SQL scoped, usar overfetch controlado e indicar
  `indexFallbackReason='post-filter-underfilled'` quando o pós-filtro ficar vazio.

**Critérios de aceite**:

- `[x]` Busca em subdiretório retorna símbolos mesmo com centenas de homônimos fora dele.
- `[x]` `maxResults` passa a ser limite pós-filtro, não pré-filtro global.
- `[x]` `exactMatch` respeita `caseSensitive=false` com comparação normalizada.
- `[x]` Telemetria indica `engine`, `indexFallback`, `scopedIndex=true` e contadores pré/pós-filtro.

---

### P0-C — `exactMatch` em busca simbólica ignora semântica case-insensitive no ramo indexado

**Severidade**: P0/P1 **Status**: `[x] implementado; validado por typecheck/lint e suítes afetadas`
**Arquivos envolvidos**:

- `src/copilot/infra/io/search/text-search.js`
- `tests/unit/copilot/infra/test_io_search.spec.js`

**Problema**: quando `caseSensitive` é falso, o ramo indexado entra; porém `exactMatch` compara
`row.symbolName === options.symbolName`, isto é, case-sensitive. Assim, uma chamada case-insensitive
exata pode falhar indevidamente.

**Correção recomendada**:

- Normalizar ambos os lados quando `caseSensitive !== true`.
- Expor explicitamente no resultado `caseSensitiveEffective`.

**Critérios de aceite**:

- `[x]` `workspace_symbol_search({ name:'foo', exactMatch:true, caseSensitive:false })` encontra
  `Foo`.
- `[x]` `caseSensitive:true` preserva comportamento estrito.

---

### P1-A — Leitura com `includeReadThrough=true` tem efeitos colaterais ocultos de latência e indexação

**Severidade**: P1 **Status**: `[x] implementado; validado por typecheck/lint` **Arquivos
envolvidos**:

- `src/copilot/tools/file/read/read-file-content.js`
- `src/copilot/infra/io-prefetch.js`
- `tests/unit/copilot/tools/file/test_read_tools.spec.js`
- `tests/unit/copilot/infra/test_io_prefetch.spec.js`

**Problema**: a leitura UTF-8 acima de `MIN_READ_THROUGH_BYTES` dispara `warmReadThroughContext` por
padrão. Esse caminho pode reabrir o arquivo, popular L1, indexar conteúdo e aquecer imports
relativos. Isso é útil, mas a semântica de uma tool chamada `read_file_content` deixa de ser
puramente leitura “barata”; ela passa a ser leitura + prefetch + indexação oportunista.

**Upgrade recomendado**:

- Trocar `includeReadThrough` de boolean para enum: `'off' | 'auto' | 'force'`.
- Fazer `auto` respeitar orçamento: tamanho, extensão, cache health, latência recente e
  `AbortSignal`.
- Retornar subobjeto `readThrough` sempre que tentado:
  `{ attempted, indexed, relatedPaths, durationMs, skippedReason }`.
- Permitir política por env: `COPILOT_READ_THROUGH_DEFAULT=off|auto|force`.

**Critérios de aceite**:

- `[x]` Leitura simples não dispara indexação quando `includeReadThrough='off'`.
- `[x]` Modo `auto` tem limite de duração e registra skip reason.
- `[x]` Telemetria separa `read.durationMs` de `readThrough.durationMs`.

---

### P1-B — Falhas de tools ainda não têm envelope operacional uniforme

**Severidade**: P1 **Status**: `[ ] aberto` **Arquivos envolvidos**:

- `src/copilot/tools/search/text-search-tools.js`
- `src/copilot/tools/search/symbol-search-tools.js`
- `src/copilot/tools/code/code-tools.js`
- `src/copilot/tools/infra/tool-factory.js`

**Problema**: muitas tools retornam falha como `{ success:false, error }`. Isso é funcional, mas
pobre para retomada autônoma: falta `retryable`, `category`, `blockedReason`, `suggestedNextAction`,
`terminalSummary`, `io.traceId`, `durationMs`, `exitCode` quando aplicável e truncamento explícito
de stdout/stderr.

**Upgrade recomendado**:

- Criar envelope canônico `ToolOperationResult` para sucesso e falha.
- Integrar `withToolFailureFeedback` para enriquecer retornos já capturados, não apenas exceções.
- Normalizar `codeTools` com
  `{ command, args, exitCode, stdout, stderr, truncated, durationMs, checks[] }`.

**Critérios de aceite**:

- `[x]` Toda tool de `search/` e `code/` retorna `terminalSummary` em sucesso e falha.
- `[ ]` Falhas possuem `retryable` e `blockedReason`.
- `[ ]` Saídas grandes respeitam orçamento e informam `originalBytes`.

---

### P1-C — Scripts de qualidade existem, mas falta uma tool `quality_gate` com allowlist e saída JSON estável

**Severidade**: P1 **Status**: `[x] implementado; validado por typecheck/lint` **Arquivos
envolvidos**:

- `package.json`
- `src/copilot/tools/code/code-tools.js`
- `src/copilot/tools/shell/sandbox.js`
- `tests/unit/copilot/tools/test_code_permission_tools.spec.js`

**Problema**: o `package.json` já possui scripts ricos (`lint:copilot`,
`typecheck:strict:src.copilot`, `test:copilot:unit`, `audit:quick`, `audit:security`,
`copilot:index:status`, `mcp:stateful:restart-ready`, etc.). Porém a superfície de tool expõe apenas
`lint_check`, `run_tests` e `typecheck` com retorno simples. A LLM-B ainda depende de shell genérico
para gates mais sofisticados.

**Upgrade recomendado**:

- Criar `quality_gate` com
  `gate: 'lint' | 'typecheck' | 'unit' | 'integration' | 'copilot-index' | 'arch' | 'mcp-fast' | 'mcp-full'`.
- Internamente mapear para scripts allowlisted.
- Sempre retornar JSON:
  `{ ok, gate, script, durationMs, exitCode, checks, failingFiles, summary, artifacts }`.
- Nunca aceitar comando arbitrário.

**Critérios de aceite**:

- `[x]` `quality_gate({ gate:'typecheck', scope:'src/copilot' })` executa
  `typecheck:strict:src.copilot`.
- `[x]` `quality_gate({ gate:'lint', scope:'src/copilot' })` executa lint sem fix.
- `[x]` Mutating gates (`format:fix`, `lint:fix`) são outra categoria, com aprovação e diff.

---

### P1-D — Cursor inválido em busca deveria falhar, não voltar silenciosamente para zero

**Severidade**: P1/P2 **Status**: `[x] implementado; validado por typecheck/lint` **Arquivos
envolvidos**:

- `src/copilot/infra/policy/output-window.js`
- `src/copilot/infra/io/search/result-paginator.js`
- `tests/unit/copilot/infra/test_output_window_policy.spec.js`

**Problema**: `normalizeCursorOffset()` transforma cursor inválido em `0`. Para a LLM-B, isso parece
uma página válida e pode causar loop de paginação ou repetição de resultados.

**Correção recomendada**:

- Adicionar modo estrito: `normalizeCursorOffset(value, { strict:true })`.
- Search tools devem rejeitar cursor inválido com `ERR_INVALID_CURSOR`.
- Manter fallback permissivo apenas para APIs internas legadas.

**Critérios de aceite**:

- `[x]` `cursor:'abc'` em `search_in_files` retorna erro estruturado.
- `[x]` `cursor:null` e cursor ausente preservam comportamento atual.

---

### P1-E — Bootstrap de tools tolera falha de categoria sem sinal de degradação forte

**Severidade**: P1 **Status**: `[x] implementado; validado por typecheck/lint` **Arquivos
envolvidos**:

- `src/copilot/tools/bootstrap.js`
- `src/copilot/tools/introspection/tool-contract-verifier.js`
- `tests/unit/copilot/test_bootstrap.spec.js`
- `tests/unit/copilot/tools/test_tool_contract_verifier.spec.js`

**Problema**: `bootstrapTools()` captura erro por categoria e continua. Isso melhora resiliência,
mas pode ocultar ausência de uma superfície inteira. A LLM-B pode operar com registry degradado sem
saber que faltam tools críticas.

**Upgrade recomendado**:

- Registrar `bootstrapDegraded=true` quando qualquer categoria falhar.
- Expor `failedToolCategories[]` em introspecção/health.
- Em CI/testes, falhar se categoria primária (`file`, `search`, `code`, `shell`, `introspection`)
  não registrar.

**Critérios de aceite**:

- `[x]` `get_tool_health` mostra categorias ausentes/degradadas.
- `[x]` Teste força erro numa categoria e valida o estado degradado.

---

### P2-A — `patch_file` já é robusta; o próximo salto é patch transacional multi-arquivo

**Severidade**: P2 **Status**: `[ ] aberto` **Arquivos envolvidos**:

- `src/copilot/tools/file/write/patch-file.js`
- `src/copilot/infra/runtime/transaction.js`
- `src/copilot/infra/io/fs/locked-mutations.js`
- `tests/unit/copilot/tools/file/test_write_tools.spec.js`

**Diagnóstico atualizado**: o documento original listava “patch com pré-condições” como gap médio.
Isso está parcialmente resolvido: `patch_file` já usa `expectedHash`, `expectedOccurrences`,
`occurrenceIndex`, `dryRun`, diff preview, rollback snapshot e audit mutation. O gap remanescente é
transacional e semântico.

**Upgrade recomendado**:

- Criar `patch_bundle` ou `apply_patch_plan` com N operações atômicas.
- Modo `dryRun` obrigatório por padrão.
- Falhar tudo se qualquer arquivo não satisfizer `expectedHash`/`expectedOccurrences`.
- Retornar diff agregado e plano de rollback.

**Critérios de aceite**:

- `[ ]` Patch multi-arquivo aplica tudo ou nada.
- `[ ]` Dry-run retorna preview por arquivo e total de linhas alteradas.
- `[ ]` Rollback sidecar é emitido para cada arquivo mutado.

---

### P2-B — Falta diff semântico por módulo/símbolo/owner

**Severidade**: P2 **Status**: `[ ] aberto` **Arquivos envolvidos**:

- `src/copilot/infra/io/patch/text-diff-service.js`
- `src/copilot/infra/io-parser.js`
- `src/copilot/tools/file/write/patch-file.js`

**Upgrade recomendado**:

- `diff_symbol({ file, symbol })` para mostrar mudanças no bloco lógico.
- `diff_owner({ ownerPath })` para agrupar mudanças por domínio (`tools/search`, `infra/io`,
  `mcp/cloudflare`).
- Integração com parser de símbolos já existente.

**Critérios de aceite**:

- `[ ]` Diffs podem ser agregados por símbolo JS/TS exportado.
- `[ ]` Resultado preserva fallback textual quando parser falha.

---

### P2-C — Memória operacional precisa de schema, não apenas Markdown

**Severidade**: P2 **Status**: `[ ] aberto` **Arquivos envolvidos**:

- `src/copilot/tools/todo/**`
- `src/copilot/infra/storage/**`
- `src/copilot/docs/**`

**Upgrade recomendado**:

- Criar store `architecture_decision_records` com campos: `id`, `date`, `owner`, `decision`,
  `riskBefore`, `riskAfter`, `evidencePaths`, `tests`, `supersedes`.
- Expor tools read-only de consulta e tool mutável com aprovação para registrar ADR.
- Permitir export Markdown para docs.

**Critérios de aceite**:

- `[ ]` ADR pode ser consultado por owner/módulo.
- `[ ]` Roadmaps conseguem referenciar ADRs por ID estável.

---

## 11. Roadmap completo por fases

### Faixa 0 — Correções de segurança operacional e falsos negativos

- `[x]` **F0.1** Remover `fix` de `lint_check` ou torná-lo erro explícito.
- `[x]` **F0.2** Criar `lint_fix` mutável, com aprovação, diff e dry-run.
- `[x]` **F0.3** Alterar metadata/verifier para detectar parâmetros mutáveis em tools read-only.
- `[x]` **F0.4** Adicionar testes para `lint_check({ fix:true })` e para
  `readOnly + mutating parameter`.
- `[x]` **F0.5** Implementar busca simbólica indexada com filtro SQL scoped (`pathPrefix`, `kind`,
  `exactMatch`, `caseSensitive`).
- `[x]` **F0.6** Corrigir `exactMatch` case-insensitive no ramo indexado.
- `[x]` **F0.7** Adicionar testes de falso negativo com muitos símbolos homônimos fora do path.

### Faixa 1 — Tool-Ops structured quality

- `[x]` **F1.1** Criar enum allowlisted de gates (`lint`, `typecheck`, `unit`, `integration`,
  `arch`, `mcp-fast`, `mcp-full`, `index-status`).
- `[x]` **F1.2** Implementar `quality_gate` com retorno JSON estável.
- `[x]` **F1.3** Normalizar stdout/stderr com truncamento, `exitCode`, `durationMs` e
  `failingFiles`.
- `[x]` **F1.4** Conectar `quality_gate` aos scripts existentes sem duplicar runners.
- `[x]` **F1.5** Adicionar testes para sucesso, falha, timeout e comando não allowlisted.

### Faixa 2 — Observabilidade e envelope de falhas

- `[x]` **F2.1** Definir `ToolOperationResult` canônico.
- `[x]` **F2.2** Aplicar envelope em `search_in_files`, `workspace_symbol_search`,
  `find_symbol_usages` e code tools.
- `[x]` **F2.3** Acrescentar `retryable`, `blockedReason`, `suggestedNextAction` e `terminalSummary`
  em falhas.
- `[x]` **F2.4** Expor `traceId`/`durationMs` também quando handler captura erro e retorna
  `success:false`.
- `[x]` **F2.5** Atualizar contract verifier para validar campos mínimos por categoria.

### Faixa 3 — Read-through adaptativo

- `[x]` **F3.1** Trocar `includeReadThrough` para enum `'off' | 'auto' | 'force'` mantendo
  compatibilidade com boolean temporariamente.
- `[x]` **F3.2** Separar telemetria de leitura e read-through.
- `[x]` **F3.3** Implementar orçamento por tamanho, extensão, duração e cache health.
- `[x]` **F3.4** Adicionar `readThrough.skippedReason` quando não executado.
- `[x]` **F3.5** Criar teste de latência/side-effect: leitura simples não deve indexar quando off.

### Faixa 4 — Patch transacional e diffs semânticos

- `[x]` **F4.1** Desenhar contrato de `patch_bundle`/`apply_patch_plan`.
- `[x]` **F4.2** Implementar dry-run agregado com diff por arquivo.
- `[ ]` **F4.3** Integrar rollback sidecar por arquivo.
- `[ ]` **F4.4** Criar `diff_symbol` usando parser de símbolos quando disponível.
- `[ ]` **F4.5** Adicionar testes de atomicidade: se uma operação falha, nenhuma mudança persiste.

### Faixa 5 — Bootstrap e saúde de registry

- `[x]` **F5.1** Registrar `bootstrapDegraded` e `failedToolCategories`.
- `[x]` **F5.2** Expor degradação em health/introspection.
- `[x]` **F5.3** Em modo CI, falhar se categoria primária não registrar.
- `[x]` **F5.4** Adicionar teste de categoria quebrada com registry parcialmente montado.

### Faixa 6 — Memória operacional estruturada

- `[ ]` **F6.1** Definir schema ADR operacional.
- `[ ]` **F6.2** Criar storage e tools read/write com aprovação para ADR.
- `[ ]` **F6.3** Exportar ADR para Markdown.
- `[ ]` **F6.4** Integrar roadmaps com IDs de ADR.

---

## 12. Sequência recomendada de implementação

1. **Começar por P0-A (`lint_check`)**: é bug de segurança operacional e classificação de risco.
2. **Em seguida P0-B/P0-C (busca simbólica)**: reduz falsos negativos que atrapalham refactors e
   auditorias.
3. **Depois P1-C (`quality_gate`)**: há scripts maduros no `package.json`; o ganho é grande e o
   risco é baixo se a allowlist for fechada.
4. **Só então P1-A (read-through adaptativo)**: mexe em caminho quente de leitura, precisa de testes
   e telemetria fina.
5. **Por fim patch transacional e memória ADR**: são upgrades estruturais com bom ROI, mas menos
   urgentes que os bugs acima.

---

## 13. Definition of Done por item do roadmap

Cada item só deve ser marcado como concluído quando atender simultaneamente a:

- `[ ]` Código implementado no owner correto, sem bypass de facade canônica.
- `[ ]` Teste unitário ou contrato cobrindo sucesso e falha.
- `[ ]` Retorno de tool documentado com schema estável.
- `[ ]` Side effect declarado corretamente (`none`, `filesystem`, `process`, `network`, `session`).
- `[ ]` Telemetria mínima emitida (`traceId`, duração, engine, cache/exit quando aplicável).
- `[ ]` Roadmap deste documento atualizado com checkbox boolean correspondente.

---

## 14. Estado booleano do roadmap

| Fase                          | Status booleano | Motivo                                                                                                                                                                           |
| ----------------------------- | --------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F0 — Correções P0             |          `true` | P0-A/P0-B/P0-C implementados; `typecheck:strict:src.copilot` e `lint:copilot` passaram; as 13 falhas observadas na suíte ampla foram corrigidas e as suítes afetadas passaram.   |
| F1 — Quality gate estruturado |          `true` | `quality_gate` allowlisted já existe e está conectada aos scripts; inclui truncamento explícito stdout/stderr e testes de sucesso/falha/timeout.                                 |
| F2 — Envelope uniforme        |          `true` | Envelope canônico implementado em search/code tools; falhas expõem retryable, blockedReason, durationMs/traceId quando disponível; verifier valida campos mínimos por categoria. |
| F3 — Read-through adaptativo  |          `true` | Enum compatível, relatório separado, timeout e testes implementados.                                                                                                             |
| F4 — Patch transacional       |         `false` | `patch_file` robusta; multi-arquivo transacional pendente.                                                                                                                       |
| F5 — Bootstrap health         |          `true` | Degradação exposta em health/introspection e policy CI strict implementada.                                                                                                      |
| F6 — Memória ADR              |         `false` | Proposta definida; store/tool pendentes.                                                                                                                                         |

**Roadmap completo atualizado**: `true` **Implementação concluída**: `false`

---

## 15. Log de implementação — 2026-06-14

### 15.1 F0 executada

- `[x]` `lint_check` tornou-se estritamente read-only; chamadas legadas com `fix` retornam bloqueio
  explícito.
- `[x]` `lint_fix` foi criada como tool separada e mutável, com `dryRun=true` por padrão e sem
  `skipPermission` declarado.
- `[x]` `bootstrapTools` passou a registrar `codeReadTools` como `readOnly:true` e `codeWriteTools`
  como `readOnly:false`.
- `[x]` `tool-contract-verifier` passou a emitir `READONLY_MUTATING_PARAMETERS` quando uma tool
  read-only expõe parâmetros mutáveis.
- `[x]` `findIoIndexSymbol()` passou a aceitar `pathPrefix`, `kind`, `exactMatch` e `caseSensitive`
  no nível SQL, evitando `LIMIT` global antes do filtro de escopo.
- `[x]` `workspace_symbol_search` passou a usar o índice scoped e expor
  `scopedIndex`/`caseSensitiveEffective` no retorno indexado.
- `[x]` Foram adicionados testes de contrato para `lint_check`/`lint_fix`, verifier read-only
  mutável, busca simbólica scoped e `exactMatch` case-insensitive.

### 15.2 Validação executada

- `[x]` `npm run typecheck:strict:src.copilot` — passou
  (`jobId=4ba47b01-f790-4ef9-bf70-56729d1ba667`).
- `[x]` `npm run lint:copilot` — passou (`jobId=cbc917b4-b6b3-406e-9b69-be0dfe874652`).
- `[ ]` `npm run test:copilot:unit` — a rodada ampla mais recente encontrou 13 assertions em
  `test_arch_contracts.spec.js`/`test_write_tools.spec.js`; elas foram corrigidas, e a validação
  focada posterior passou com 142/142 testes. Rerodada ampla ainda pendente.

### 15.3 Próximo bloco recomendado

- `[x]` Prosseguir para **F1 — Tool-Ops structured quality**, começando por `quality_gate`
  allowlisted, porque os scripts canônicos já existem e a validação desta F0 reforçou a necessidade
  de retorno JSON estável para jobs.

### 15.4 F1 iniciada

- `[x]` `quality_gate` criada em `src/copilot/tools/code/code-tools.js` com enum fechado de gates.
- `[x]` A tool mapeia apenas scripts allowlisted do `package.json` e bloqueia gates fora da lista.
- `[x]` Retorno JSON inclui ok, gate, scope, script, command, durationMs, exitCode, checks,
  failingFiles, artifacts e terminalSummary.
- `[x]` `quality_gate` foi registrada em `codeReadTools`; `lint_fix` permanece separada em
  `codeWriteTools`.
- `[x]` Teste defensivo adicionado para rejeição de gate não allowlisted.

### 15.5 Validação após F1 parcial

- `[x]` `npm run typecheck:strict:src.copilot` — passou
  (`jobId=c36f377a-b3c8-470d-8e5e-a0e2878cb443`).
- `[x]` `npm run lint:copilot` — passou (`jobId=0360fb34-4463-459e-b830-ffe8c3d172cc`).
- `[x]` F1.3 concluída: truncamento explícito stdout/stderr, bytes originais e extração de
  `failingFiles` implementados.
- `[x]` F1.5 concluída: ampliar testes de sucesso/falha/timeout para `quality_gate` sem depender de
  suíte global.
