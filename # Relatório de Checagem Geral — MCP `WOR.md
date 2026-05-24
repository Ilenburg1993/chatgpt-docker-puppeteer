# Relatório de Checagem Geral — MCP `WORKSPACE`

**Data:** 2026-05-22
**Escopo:** análise funcional e arquitetural do MCP `WORKSPACE`, sucessor evoluído do MCP LLM-B anterior.
**Workspace observado:** `/workspaces/chatgpt-docker-puppeteer`
**Branch:** `main`
**HEAD:** `059276c8`
**Estado Git:** dirty, com alteração local em `src/copilot/mcp/tools/repo-write.js`.

---

## 1. Sumário executivo

A evolução do MCP para o nome `WORKSPACE` foi bem-sucedida. A superfície atual está materialmente mais madura que a versão anterior: há melhor descoberta de capacidades, leitura segura com hashes, navegação por chunks, busca com contexto e cursor, busca de símbolos, outline de arquivos, diagnóstico de túnel e contratos de erro mais estruturados.

A experiência geral é agora próxima de uma camada operacional real para desenvolvimento assistido: o modelo consegue descobrir capacidades, navegar o repositório, ler arquivos com integridade, localizar símbolos, executar validadores assíncronos e observar saúde do runtime. Isso reduz bastante a fricção inicial que existia antes.

Ainda há bugs e gaps relevantes. O mais importante é o validator `unit-mcp`, que atualmente falha porque aponta para um glob sem arquivos. Também há inconsistências em metadados de busca/chunks, e um risco de segurança/privacidade em `repo_root_tree`: embora a leitura de `.env.local` esteja bloqueada, a árvore pode listar nomes, tamanhos e fingerprints de arquivos sensíveis quando `showHidden: true`.

---

## 2. Experiência de uso observada

### 2.1. Conexão e descoberta

A primeira chamada a `repo_status` funcionou, confirmando:

- workspace root em `/workspaces/chatgpt-docker-puppeteer`;
- branch `main`;
- HEAD `059276c8`;
- working tree dirty;
- arquivo modificado: `src/copilot/mcp/tools/repo-write.js`.

A enumeração de tools sob o namespace `/WORKSPACE/...` funcionou corretamente. O rename para `WORKSPACE` não degradou a descoberta.

A lista de tools cresceu de forma saudável, com novas capacidades importantes:

- `repo_root_tree`;
- `repo_read_file_chunks`;
- `repo_diff_files`;
- `repo_symbol_search`;
- `repo_file_outline`;
- `mcp_capabilities_summary`;
- `mcp_tunnel_status`.

Essas adições atacam diretamente gaps observados na primeira avaliação do MCP antigo.

### 2.2. Diagnóstico de runtime e túnel

`mcp_runtime_health` agora inclui métricas internas e também estado de túnel. Isso é uma melhoria expressiva.

Estado observado:

- `ok: true`;
- modo do túnel: `temporary-trycloudflare`;
- túnel configurado: sim;
- state válido: sim;
- processo vivo: sim;
- smoke recente: OK;
- URL do conector: `https://hull-grove-hence-departmental.trycloudflare.com/mcp`;
- origin local: `http://127.0.0.1:3333`;
- recomendação: `use`.

Na versão anterior, uma queda de conexão Cloudflare apareceu como erro de rede sem diagnóstico interno suficiente. Agora há `mcp_tunnel_status`, com idade da sessão, stale policy, smoke state e guidance. Isso melhora muito a recuperação operacional.

### 2.3. Navegação de repo

`repo_tree path=""` agora funciona e cai no default `src/copilot`. Esse era um bug/UX gap anterior; está corrigido.

`repo_root_tree` também funciona e permite listar a raiz real do workspace, equivalente a `repo_tree path="."`.

Ponto de atenção: `repo_root_tree showHidden=true` lista arquivos sensíveis por nome e metadados, incluindo `.env.local`, `.env.production`, `.env.schema.json`, `.env.development`, entre outros. A leitura de conteúdo é corretamente bloqueada por `ERR_PATH_DENIED`, mas a enumeração ainda vaza existência, tamanho, mtime e fingerprint.

### 2.4. Leitura de arquivos

`repo_read_file` agora retorna:

- conteúdo;
- `sha256` do arquivo completo;
- `returnedSha256` da janela retornada;
- bytes;
- total de linhas;
- janela de linhas retornada.

Isso corrige um gap anterior importante: agora o fluxo read → patch/write com `expectedHash` é muito mais seguro.

### 2.5. Chunks para arquivos grandes

`repo_read_file_chunks` funcionou bem para navegação de arquivo grande, retornando múltiplos chunks com linhas, bytes, engine e `nextCursor`.

A tool é útil e reduz a necessidade de pedir arquivos inteiros no chat. Porém, há inconsistências de semântica em janelas pequenas. Ao chamar com `chunkLines: 1`, `startLine: 1`, `endLine: 3`, a resposta retornou 3 chunks, mas também:

- `totalLinesKnown: false`;
- `totalLines: 4`;
- `nextCursor: null`.

Esse `totalLines: 4` é ambíguo: parece representar algo diferente de total real do arquivo, ou há off-by-one/contagem parcial. Para consumidores automáticos, isso pode induzir erro.

### 2.6. Busca textual

`repo_search_text` agora aceita:

- `contextLines`;
- `cursor`;
- `nextCursor`;
- `cursorOffset`.

Isso corrige outro gap anterior.

Contudo, ao pesquisar `repo_read_file_chunks` em `src/copilot/mcp/tools/repo-read.js` com contexto, a resposta mostrou output com match visível, `totalMatches: 19`, `truncated: true`, mas `matchCount: 0`.

Esse é um bug de contrato: `matchCount` deveria refletir matches retornados na página atual, ou o campo deveria ser renomeado/documentado. Hoje a resposta mistura match lines e context lines, mas reporta zero matches.

### 2.7. Busca de símbolos e outline

`repo_symbol_search` funcionou corretamente para `registerCanonicalMcpTools`, retornando a função exportada em `src/copilot/mcp/registry.js`.

`repo_file_outline` funcionou bem em `src/copilot/mcp/tools/repo-read.js`, retornando:

- `sha256`;
- símbolos;
- imports;
- exports;
- outline textual.

Observação: em `repo-read.js`, `repo_file_outline` capturou `repoReadTools` como variável exportada, mas retornou `exports: []`. Isso pode ser limitação do parser em `export const`, ou semântica distinta entre `symbols.exported` e lista `exports`. Para consumidores, essa diferença pode confundir.

### 2.8. Segurança de path

A tentativa de ler `.env.local` foi bloqueada corretamente:

```json
{
  "success": false,
  "code": "ERR_PATH_DENIED",
  "error": "Acesso negado: Access to protected path basename \".env.local\" is blocked",
  "hint": "Use a path inside the configured workspace and allowed MCP scope."
}
```

Esse contrato é bom. O erro tem código, mensagem, hint e detalhes. É uma evolução clara sobre erros apenas textuais.

### 2.9. Validators

`typecheck` passou:

- comando: `npm run typecheck:strict:src.copilot`;
- status: `completed`;
- `exitCode: 0`.

`unit-mcp` falhou por ausência de arquivos no glob:

```text
No test files found, exiting with code 1

filter: tests/unit/copilot/mcp/*.spec.js
include: tests/unit/copilot/**/*.spec.js, tests/integration/copilot/**/*.spec.js, tests/regression/copilot/**/*.spec.js
```

Isso não parece uma falha de teste; é uma falha de configuração do validator ou ausência de suíte MCP. O comando allowlisted existe, mas não tem alvo válido.

---

## 3. Melhorias já realizadas desde a primeira avaliação

A comparação com a experiência anterior mostra evolução substancial.

| Gap anterior                        | Estado atual                                                |
| ----------------------------------- | ----------------------------------------------------------- |
| `repo_tree path=""` falhava         | Corrigido; string vazia usa default                         |
| Faltava árvore real da raiz         | Adicionado `repo_root_tree`                                 |
| `repo_read_file` não retornava hash | Agora retorna `sha256` e `returnedSha256`                   |
| Faltava leitura chunked             | Adicionado `repo_read_file_chunks`                          |
| Busca não tinha contexto            | `repo_search_text.contextLines` adicionado                  |
| Paginação era pouco clara           | `cursor`, `nextCursor`, `cursorOffset` adicionados          |
| Faltava busca de símbolos           | Adicionado `repo_symbol_search`                             |
| Faltava outline de arquivo          | Adicionado `repo_file_outline`                              |
| Faltava summary de capacidades      | Adicionado `mcp_capabilities_summary`                       |
| Diagnóstico de túnel era fraco      | Adicionado `mcp_tunnel_status`, integrado ao runtime health |
| Erros eram menos estruturados       | Agora há `code`, `hint`, `details` em casos relevantes      |

---

## 4. Bugs encontrados

### BUG-001 — `unit-mcp` aponta para glob sem testes

**Severidade:** alta para CI/QA do MCP
**Área:** validators/jobs
**Evidência:** `run_copilot_validator validator="unit-mcp"` executou:

```text
npx vitest --config vitest.copilot.config.js run tests/unit/copilot/mcp/*.spec.js
```

e falhou com:

```text
No test files found, exiting with code 1
```

**Impacto:** o validator dedicado do MCP não valida nada e sempre falha se não houver arquivos nesse path. Isso reduz confiança exatamente na superfície que está sendo evoluída.

**Proposta de correção:**

1. Criar suíte dedicada em `tests/unit/copilot/mcp/*.spec.js`; ou
2. Ajustar o glob para onde os testes MCP realmente residem; ou
3. Tornar ausência de testes um erro explícito de configuração no `project_doctor`, antes de rodar o job.

**Patch conceitual:**

```js
case 'unit-mcp':
  return {
    command: 'npx',
    args: [
      'vitest',
      '--config',
      'vitest.copilot.config.js',
      'run',
      'tests/unit/copilot/**/mcp*.spec.js',
      'tests/unit/copilot/mcp/**/*.spec.js'
    ],
  };
```

Melhor ainda: declarar o glob em constante e testá-lo com fixture.

---

### BUG-002 — `repo_search_text.matchCount` inconsistente com output

**Severidade:** média
**Área:** busca textual / contrato de resposta
**Evidência:** busca por `repo_read_file_chunks` retornou output com match visível e `totalMatches: 19`, mas `matchCount: 0`.

**Impacto:** clientes automáticos podem concluir que não houve match na página, apesar de output conter match.

**Hipótese provável:** quando `contextLines > 0`, a contagem de linhas de match está sendo perdida ou confundida com contagem de registros após paginação/contexto.

**Proposta de correção:**

Separar campos:

```json
{
  "returnedMatchCount": 1,
  "returnedLineCount": 5,
  "totalMatches": 19,
  "contextLines": 4
}
```

Ou corrigir `matchCount` para contar matches retornados, não blocos ou contexto.

---

### BUG-003 — `repo_read_file_chunks` tem semântica ambígua para `totalLines` em janelas pequenas

**Severidade:** média
**Área:** leitura chunked / contrato de resposta
**Evidência:** chamada com `startLine: 1`, `endLine: 3`, `chunkLines: 1` retornou 3 linhas, mas reportou `totalLinesKnown: false` e `totalLines: 4`.

**Impacto:** `totalLines` parece significar “linhas observadas até parar” em vez de total real do arquivo. O nome induz erro.

**Proposta de correção:**

Trocar contrato para:

```json
{
  "returnedLineCount": 3,
  "lastScannedLine": 4,
  "fileTotalLines": null,
  "fileTotalLinesKnown": false
}
```

Se o total real for conhecido, usar:

```json
{
  "fileTotalLines": 385,
  "fileTotalLinesKnown": true
}
```

---

### BUG-004 — `repo_root_tree showHidden=true` enumera arquivos sensíveis bloqueados

**Severidade:** média a alta, dependendo do threat model
**Área:** segurança / privacidade
**Evidência:** `repo_root_tree showHidden=true` listou `.env.local`, `.env.production`, `.env.development`, etc., com tamanho e fingerprint. A leitura posterior de `.env.local` foi bloqueada corretamente.

**Impacto:** mesmo sem conteúdo, nomes, tamanhos e mtimes de arquivos sensíveis podem revelar configuração, ambientes disponíveis e presença de credenciais.

**Proposta de correção:**

Aplicar a mesma política de path bloqueado na enumeração de diretórios:

- ocultar entradas bloqueadas por default;
- se necessário, mostrar placeholder sem nome exato: `[blocked-secret-file]`;
- incluir campo agregado `blockedEntriesCount`;
- nunca retornar fingerprint/tamanho de arquivos protegidos.

Exemplo:

```json
{
  "entries": [...],
  "blockedEntriesCount": 7,
  "policy": {
    "hiddenProtectedPaths": true
  }
}
```

---

### BUG-005 — `repo_file_outline` reporta símbolo exportado, mas `exports` vazio

**Severidade:** baixa a média
**Área:** parser/outline
**Evidência:** `repo_file_outline` em `repo-read.js` retornou `repoReadTools` como `exported: true`, mas `exports: []`.

**Impacto:** consumidores que dependem de `exports` podem não enxergar exports declarados por `export const`.

**Proposta de correção:**

Garantir que `exports` inclua exports nomeados diretos:

```js
export const repoReadTools = [...]
export function registerCanonicalMcpTools(...) {}
export class Foo {}
```

E alinhar `symbols[].exported` com `exports[]`.

---

### BUG-006 — alteração local em `repo-write.js` aumenta default diff para 2000, mas schema ainda limita `maxDiffLines` a 500

**Severidade:** baixa a média
**Área:** repo-write / UX de diff
**Evidência:** diff local:

```diff
-const DEFAULT_MAX_DIFF_LINES = 160;
+const DEFAULT_MAX_DIFF_LINES = 2000;
```

mas o schema de `maxDiffLines` permanece:

```js
z.number().int().min(1).max(500)
```

**Impacto:** default interno pode exceder o limite aceito para override explícito. Isso pode ser intencional, mas é semanticamente estranho.

**Proposta de correção:**

Escolher uma das opções:

1. Se 2000 é desejado: aumentar schema para `.max(2000)`.
2. Se 500 é limite deliberado para clientes: reduzir default para 500.
3. Separar `defaultMaxDiffLines` interno de `clientMaxDiffLines` e documentar.

---

## 5. Gaps restantes

### GAP-001 — falta `jobs_list`

Hoje é possível iniciar job, ler output por `jobId` e cancelar job por `jobId`, mas não vi uma tool para listar jobs ativos/recentes.

**Impacto:** se o cliente perde o `jobId`, não consegue recuperar a execução.

**Proposta:** adicionar:

```text
job_list
```

Com filtros:

- `status`;
- `validator`;
- `limit`;
- `includeCompleted`;
- `sinceMs`.

---

### GAP-002 — jobs são apenas in-memory, apesar de logs persistirem

O job manager guarda records em `Map`. Os logs ficam em arquivo, mas se o processo reiniciar, `job_get_output` não encontra records anteriores.

**Impacto:** perda de histórico operacional após restart.

**Proposta:** persistir manifest JSON por job:

```text
src/copilot/.ai/jobs/<jobId>.json
src/copilot/.ai/jobs/<jobId>.log
```

E reconstruir records read-only em startup ou sob demanda.

---

### GAP-003 — falta smoke validator específico para MCP connector

Há `mcp_tunnel_status` e smoke state do túnel, mas seria útil uma tool de smoke completa que teste a própria experiência do conector:

```text
mcp_smoke_workspace
```

Deveria executar, em sequência:

1. `repo_status`;
2. `repo_tree path=""`;
3. `repo_root_tree`;
4. `repo_read_file` de arquivo permitido;
5. `repo_search_text` com contexto;
6. `repo_symbol_search`;
7. `repo_file_outline`;
8. `project_doctor`;
9. `mcp_runtime_health`.

E retornar um relatório estruturado.

---

### GAP-004 — falta classificação de severidade em `mcp_runtime_health`

`mcp_runtime_health` retorna métricas por tool, mas não resume riscos.

**Proposta:** adicionar:

```json
{
  "status": "ok" | "degraded" | "failed",
  "warnings": [],
  "critical": []
}
```

Critérios:

- túnel stale → `degraded`;
- último smoke falhou → `degraded` ou `failed`;
- erro rate alto em tool crítica → `degraded`;
- repo dirty → warning;
- validator unit-mcp sem testes → warning ou failed check.

---

### GAP-005 — falta cobertura explícita de segurança para listagem

A política bloqueia leitura de `.env.local`, mas não há indicação clara de que a listagem de diretórios respeita ou não a mesma política.

**Proposta:** criar seção de policy:

```json
{
  "securityPolicy": {
    "readProtectedPaths": "blocked",
    "listProtectedPaths": "redacted",
    "writeProtectedPaths": "blocked"
  }
}
```

E expor isso em `mcp_capabilities_summary`.

---

### GAP-006 — `mcp_capabilities_summary` é ótimo, mas poderia incluir versionamento

A tool resume capacidades, mas falta versão do contrato.

**Proposta:**

```json
{
  "protocolVersion": "workspace-mcp/0.2.0",
  "capabilitiesVersion": 3,
  "deprecated": [],
  "experimental": ["repo_symbol_search", "repo_file_outline"]
}
```

Isso ajuda clientes a adaptar prompts e fluxos.

---

### GAP-007 — falta diff/patch preview para múltiplos arquivos

As tools de escrita são seguras e controladas, mas ainda parecem operar em arquivo único.

**Proposta:** adicionar uma tool transacional em dry-run:

```text
repo_plan_patch
```

Entrada: lista de patches exatos por arquivo.
Saída: diff agregado, hashes esperados, arquivos afetados, validação de ocorrência.
Execução real separada e confirmada.

---

## 6. Propostas de upgrade

### UPG-001 — suíte unitária MCP dedicada

Criar testes para:

- `repo_tree path=""`;
- `repo_root_tree` com e sem hidden;
- bloqueio de `.env.local`;
- `repo_read_file` com hash;
- `repo_read_file_chunks` com janelas e cursor;
- `repo_search_text` com contexto e cursor;
- `repo_symbol_search`;
- `repo_file_outline`;
- `mcp_capabilities_summary`;
- `mcp_tunnel_status`;
- error contracts.

Prioridade: **P0**.

---

### UPG-002 — redaction policy na árvore

Implementar redaction consistente em `scanDirectory` ou no wrapper MCP.

Exemplo de entry redigida:

```json
{
  "name": "[redacted]",
  "type": "file",
  "path": "[redacted]",
  "blocked": true,
  "reasonCode": "ERR_PROTECTED_PATH"
}
```

Ou omitir completamente e retornar contagem agregada.

Prioridade: **P0/P1**.

---

### UPG-003 — normalização dos contratos de contagem

Unificar nomenclatura:

Busca:

```json
{
  "returnedMatchCount": 1,
  "totalMatchCount": 19,
  "returnedBlockCount": 1,
  "returnedLineCount": 5
}
```

Chunks:

```json
{
  "returnedChunkCount": 3,
  "returnedLineCount": 3,
  "fileTotalLines": null,
  "fileTotalLinesKnown": false,
  "nextCursor": null
}
```

Prioridade: **P1**.

---

### UPG-004 — `job_list` + persistência de job manifest

Adicionar listagem de jobs e reconstrução pós-restart.

Formato sugerido:

```json
{
  "jobs": [
    {
      "id": "...",
      "validator": "typecheck",
      "status": "completed",
      "startedAt": 1779479159351,
      "endedAt": 1779479163443,
      "exitCode": 0,
      "logFile": "..."
    }
  ]
}
```

Prioridade: **P1**.

---

### UPG-005 — `mcp_smoke_workspace`

Criar uma tool de smoke end-to-end, que gere relatório sintético e status agregado.

Saída sugerida:

```json
{
  "success": true,
  "status": "ok",
  "checks": [
    { "name": "repo_status", "ok": true, "durationMs": 50 },
    { "name": "repo_tree_default", "ok": true, "durationMs": 20 },
    { "name": "secret_read_blocked", "ok": true, "durationMs": 5 }
  ],
  "warnings": []
}
```

Prioridade: **P1**.

---

### UPG-006 — `repo_file_stats`

Adicionar uma tool barata para metadados não sensíveis de arquivo permitido:

```text
repo_file_stats(path)
```

Retorna:

- tamanho;
- linhas;
- sha256;
- isText;
- parser disponível;
- protected/blocked.

Isso evita ler conteúdo só para obter hash/linhas.

Prioridade: **P2**.

---

### UPG-007 — `repo_semantic_index_status`

Como já há parser, symbols e outline, o próximo passo é um índice local:

- estado do índice;
- arquivos indexados;
- stale count;
- tempo da última indexação;
- erros por arquivo.

Prioridade: **P2**.

---

### UPG-008 — `repo_symbol_references`

`repo_symbol_search` acha declarações. Para refactors, seria útil achar referências.

```text
repo_symbol_references(name, path?, includePattern?)
```

Prioridade: **P2**.

---

### UPG-009 — modo “safe transcript” para respostas longas

Como o MCP consegue ler arquivos grandes, seria útil uma tool que retorna conteúdo já segmentado para LLMs:

```text
repo_read_for_llm(path, budgetChars, strategy)
```

Estratégias:

- `head-tail`;
- `outline-first`;
- `chunks-with-line-ranges`;
- `markdown-sections`.

Prioridade: **P3**.

---

## 7. Priorização recomendada

### P0 — corrigir antes de considerar estável

1. Corrigir `unit-mcp` ou criar testes no glob atual.
2. Redigir/ocultar arquivos protegidos em `repo_root_tree`.
3. Corrigir `matchCount` em busca com contexto.

### P1 — melhorar robustez operacional

1. Corrigir semântica de `totalLines` em chunks.
2. Adicionar `job_list`.
3. Persistir manifest de jobs.
4. Criar `mcp_smoke_workspace`.
5. Alinhar `DEFAULT_MAX_DIFF_LINES` com schema de `maxDiffLines`.

### P2 — melhorar navegação e refactor

1. Melhorar `repo_file_outline.exports`.
2. Adicionar `repo_file_stats`.
3. Adicionar status de índice/símbolos.
4. Adicionar busca de referências.

### P3 — UX avançada para LLMs

1. Adicionar leitura orientada por orçamento.
2. Adicionar planos de patch multi-arquivo.
3. Adicionar relatório de capacidades versionado.

---

## 8. Sugestão de issues

### Issue 1 — Fix `unit-mcp` validator target

**Title:** `fix(mcp): point unit-mcp validator to existing MCP test suite`

**Description:**
`run_copilot_validator({ validator: "unit-mcp" })` currently fails with `No test files found` because it targets `tests/unit/copilot/mcp/*.spec.js`. Add tests at that path or update the validator glob.

---

### Issue 2 — Redact protected paths from repo tree

**Title:** `fix(mcp): redact protected files from repo_root_tree output`

**Description:**
Reading `.env.local` is blocked, but `repo_root_tree({ showHidden: true })` still exposes `.env*` names, sizes and fingerprints. Apply protected path policy during directory scans.

---

### Issue 3 — Correct search count contract

**Title:** `fix(mcp): return accurate match counts for repo_search_text with context`

**Description:**
When searching with `contextLines`, output includes matches but `matchCount` can be zero. Add `returnedMatchCount`, `returnedLineCount`, or fix `matchCount`.

---

### Issue 4 — Clarify chunk line metadata

**Title:** `fix(mcp): clarify totalLines semantics in repo_read_file_chunks`

**Description:**
For partial windows, `totalLinesKnown: false` with `totalLines: 4` is ambiguous. Split into `returnedLineCount`, `lastScannedLine`, and `fileTotalLines`.

---

### Issue 5 — Add job listing and persistence

**Title:** `feat(mcp): add job_list and persist job manifests`

**Description:**
Jobs are currently stored in memory, while logs are persisted. Add manifest files and a `job_list` tool for recovery after lost job IDs or process restart.

---

## 9. Veredito

O MCP `WORKSPACE` está claramente mais evoluído que a versão anterior. Ele já oferece uma superfície muito competente para desenvolvimento assistido por LLM: leitura segura, busca contextual, navegação estrutural, diagnósticos de túnel, validadores e métricas.

As correções mais importantes agora são de maturidade operacional e contrato: garantir que o validator MCP realmente valide MCP, impedir vazamento de metadados de arquivos sensíveis, e ajustar inconsistências em contagens de busca/chunks.

Com os P0 resolvidos, o `WORKSPACE` fica apto a ser tratado como conector de desenvolvimento confiável em rotina diária.
