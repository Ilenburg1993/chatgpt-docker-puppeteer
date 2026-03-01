# Playbook Completo: RAG + MCP + LSP (Codex/LLM-First)

## 1) Objetivo

Este documento explica, de ponta a ponta, como operar o stack atual de:

- RAG (busca semantica + lexical no codigo)
- MCP (exposicao padronizada de ferramentas via HTTP e stdio)
- LSP/tsserver (navegacao semantica e code actions para JS/TS)
- Ollama (politica cloud-first para nao-embedding, local-only para embedding)

Tambem inclui, no final, um **template padrao para qualquer LLM** usar essas ferramentas com boa
estrategia e qualidade.

---

## 2) Arquitetura atual (estado real)

### 2.1 Endpoint MCP canonico

- HTTP: `http://localhost:3008/api/mcp`
- Arquivo de referencia no workspace: `.vscode/mcp.json`

### 2.2 Ferramentas registradas (core local)

- RAG:
  - `rag_search`
  - `rag_health`
- Ollama:
  - `ollama_generate`
  - `ollama_embed`
  - `ollama_models`
- LSP:
  - `lsp_definition`
  - `lsp_references`
  - `lsp_hover`
  - `lsp_document_symbols`
  - `lsp_workspace_symbols`
  - `lsp_diagnostics`
  - `lsp_code_actions`
  - `lsp_apply_code_action`

### 2.3 Politica Ollama

- Embedding: **sempre local**
- Nao-embedding (geracao/chat): **cloud-first por padrao**
- Fallback local para nao-embedding: habilitavel por env (padrao habilitado)

---

## 3) Prerequisitos e configuracao

## 3.1 Variaveis principais

Defina em `.env`:

```bash
# Ollama non-embedding policy
OLLAMA_NON_EMBEDDING_RUNTIME=auto
OLLAMA_NON_EMBEDDING_LOCAL_FALLBACK=true
OLLAMA_LOCAL_MODEL_PROFILE=light
OLLAMA_LOCAL_ALLOWED_MODELS=

# RAG
RAG_PROFILE_DEFAULT=core
RAG_DEGRADED_MODE_ENABLED=true

# LSP
LSP_ENABLED=true
LSP_TOOL_TIMEOUT_MS=15000
LSP_MUTATIONS_ENABLED=false
LSP_MAX_RESULTS=200

# MCP
MCP_TOOL_TIMEOUT=90000
```

Cloud Ollama (nao-embedding):

```bash
OLLAMA_CLOUD_ENABLED=true
OLLAMA_CLOUD_API_KEY=<sua-chave>
OLLAMA_CLOUD_BASE_URL=https://ollama.com
```

Local Ollama (embedding):

```bash
OLLAMA_LOCAL_BASE_URL=http://host.docker.internal:11434
```

## 3.2 Subir stack

```bash
npm install
npm run dev
```

Checks rapidos:

```bash
curl http://localhost:3008/health
curl http://localhost:3008/api/mcp
npm run mcp:diagnose
```

---

## 4) Contrato de resposta das ferramentas (MCP)

`tools/call` retorna:

- `content[]` (texto para compatibilidade MCP)
- `structuredContent` (quando disponivel), no formato:
  - `data` (payload estruturado)
  - `flags`
    - `degraded` (modo degradado)
    - `mutating` (operacao com escrita)
    - `partial` (resultado parcial/degradado)

Exemplo:

```json
{
  "content": [{ "type": "text", "text": "..." }],
  "structuredContent": {
    "data": { "backend": "lexical", "degraded": true },
    "flags": { "degraded": true, "mutating": false, "partial": true }
  }
}
```

---

## 5) Como usar cada grupo de ferramentas

## 5.1 RAG

### `rag_search`

Parametros:

- `query` (obrigatorio)
- `topK` (1..20, default 5)
- `pathPrefix` (filtro de caminho)
- `ext` (filtro por extensao)
- `profile`: `core | dev | full`
- `mode`: `auto | hybrid | lexical-only`
- `includeDiagnostics`: `true | false`

Semantica de `mode`:

- `auto`: tenta hibrido e pode cair para lexical
- `hybrid`: sem fallback automatico
- `lexical-only`: FTS apenas

Campos estruturados relevantes:

- `backend`: `hybrid | lexical`
- `degraded`: boolean
- `reason_code` (ex.: `OLLAMA_UNAVAILABLE`, `EMBEDDING_TIMEOUT`)
- `degraded_reason` (mensagem detalhada)

### `rag_health`

Retorna status de:

- diretorios/manifests
- conectividade Ollama
- LanceDB
- cache

### Perfis RAG

- `core`: `src/**`, `tests/**`, configs principais
- `dev`: `core` + `scripts/**` + `tools/rag/**` + `README.md`
- `full`: escopo amplo (com regras de exclusao/denylist)

Uso recomendado:

- codar e debugar rapido: `core`
- mudancas de build/scripts/docs tecnicos: `dev`
- investigacao ampla: `full`

## 5.2 Ollama

### `ollama_generate`

- Aceita `runtime`: `auto | cloud | local`
- Default `auto` => cloud-first para nao-embedding
- Se cloud falhar e fallback habilitado => tenta local

### `ollama_embed`

- Sempre local (por design)

### `ollama_models`

Retorna inventario separado:

- `cloud_models`
- `local_models`
- prioridade efetiva: `cloud-first-non-embedding`

## 5.3 LSP/tsserver

Operacoes de leitura:

- `lsp_definition`
- `lsp_references`
- `lsp_hover`
- `lsp_document_symbols`
- `lsp_workspace_symbols`
- `lsp_diagnostics`
- `lsp_code_actions`

Observacao importante:

- `line`/`character` sao esperados como **1-based**.

### Mutacao controlada: `lsp_apply_code_action`

Fluxo correto:

1. Buscar acoes com `lsp_code_actions`
2. Executar `lsp_apply_code_action` com `mode=preview`
3. Somente se aprovado, executar `mode=apply` com:
   - `LSP_MUTATIONS_ENABLED=true`
   - `confirmationToken` nao vazio

Protecoes:

- bloqueio fora do workspace
- limite de patch por requisicao: ~200KB

---

## 6) Cancelamento, timeout e resiliencia

## 6.1 Cancelamento MCP

Envie notificacao JSON-RPC:

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/cancelled",
  "params": { "requestId": 123 }
}
```

Suporta `requestId`, `id` ou `request_id`.

## 6.2 Timeouts

- MCP tool call: `MCP_TOOL_TIMEOUT` (default 90000)
- LSP por operacao: `LSP_TOOL_TIMEOUT_MS` (default 15000)
- RAG tem timeouts internos por operacao (`health`, `query`, `hybrid`, `index`)

## 6.3 Modo degradado (RAG)

Com `RAG_DEGRADED_MODE_ENABLED=true`, `mode=auto` pode retornar sucesso com:

- `backend=lexical`
- `degraded=true`
- `reason_code` detalhando causa de degradacao

Isso evita hard-fail quando embedding/ollama estiver indisponivel.

---

## 7) Fluxos recomendados para programacao assistida

## 7.1 Fluxo para entender uma funcionalidade

1. `rag_search` com `profile=core`, `mode=auto`, `topK=6..10`
2. Identificar simbolos-chave
3. `lsp_definition` nesses simbolos
4. `lsp_references` para mapear impacto real
5. `lsp_diagnostics` nos arquivos alterados

## 7.2 Fluxo para bugfix

1. Reproduzir erro
2. `rag_search` focado (`pathPrefix`, `ext`)
3. `lsp_hover` + `lsp_definition` no ponto exato
4. `lsp_code_actions` para opcoes de correcao
5. `lsp_apply_code_action` (`preview` -> `apply` com token, se habilitado)
6. Rodar testes/lint

## 7.3 Fluxo para refactor seguro

1. `lsp_workspace_symbols` para descobrir superficie
2. `lsp_references` em funcoes centrais
3. Planejar mudancas por cluster
4. Aplicar por etapas curtas e validar continuamente

---

## 8) Exemplo de chamadas MCP HTTP (JSON-RPC)

### Listar tools

```bash
curl -s http://localhost:3008/api/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

### Executar `rag_search`

```bash
curl -s http://localhost:3008/api/mcp \
  -H 'content-type: application/json' \
  -d '{
    "jsonrpc":"2.0",
    "id":2,
    "method":"tools/call",
    "params":{
      "name":"rag_search",
      "arguments":{
        "query":"where is MCP timeout handled",
        "profile":"core",
        "mode":"auto",
        "topK":5,
        "includeDiagnostics":true
      }
    }
  }'
```

### Executar `lsp_definition`

```bash
curl -s http://localhost:3008/api/mcp \
  -H 'content-type: application/json' \
  -d '{
    "jsonrpc":"2.0",
    "id":3,
    "method":"tools/call",
    "params":{
      "name":"lsp_definition",
      "arguments":{
        "filePath":"src/server/handlers/mcp-handler.js",
        "line":100,
        "character":20
      }
    }
  }'
```

---

## 9) Troubleshooting objetivo

- `rag_search` sempre degradado:
  - validar Ollama local no host e endpoint acessivel do container
  - verificar `OLLAMA_LOCAL_BASE_URL`
- `ollama_generate` nao usa cloud:
  - validar `OLLAMA_CLOUD_ENABLED=true`
  - validar `OLLAMA_CLOUD_API_KEY`
- tools LSP ausentes:
  - validar `LSP_ENABLED=true`
  - reiniciar servidor
- `lsp_apply_code_action` negado:
  - setar `LSP_MUTATIONS_ENABLED=true`
  - enviar `confirmationToken`
- cancelamento nao surte efeito:
  - conferir `requestId` da notificacao

---

## 10) Template padrao para qualquer LLM (copiar e colar)

Use este bloco como instrucao-base para LLMs que vao programar neste repositrio via MCP:

```md
# Tool-Usage Policy (RAG + MCP + LSP)

Voce esta conectado ao MCP HTTP deste projeto em: `http://localhost:3008/api/mcp`

## Objetivo

Programar com precisao e velocidade, usando:

- RAG para descoberta de contexto
- LSP para navegacao semantica e impacto real
- Ollama para geracao/embedding conforme politica

## Regras de uso (obrigatorias)

1. Antes de propor mudanca, busque contexto com `rag_search`.
2. Para simbolos JS/TS, prefira `lsp_definition` e `lsp_references` em vez de suposicoes.
3. Sempre validar diagnosticos com `lsp_diagnostics` nos arquivos alterados.
4. Operacoes de escrita por LSP sao controladas:
   - executar `lsp_apply_code_action` em `preview` primeiro
   - so aplicar com `mode=apply` quando houver confirmacao explicita e token
5. Trate `degraded=true` como sinal operacional:
   - continue com `backend=lexical` quando necessario
   - explicite limitacoes de confianca

## Politica Ollama

- Embedding: sempre local (`ollama_embed`)
- Nao-embedding: cloud-first por padrao (`ollama_generate runtime=auto`)
- Fallback local para nao-embedding pode ocorrer se cloud falhar

## Estrategia recomendada por tarefa

1. Descoberta:
   - `rag_search(query, profile=core, mode=auto, topK=8)`
2. Aprofundamento:
   - `lsp_definition`, `lsp_references`, `lsp_hover`
3. Correcao:
   - `lsp_diagnostics` -> `lsp_code_actions`
4. Mudanca controlada:
   - `lsp_apply_code_action(mode=preview)`
   - se aprovado: `lsp_apply_code_action(mode=apply, confirmationToken=...)`
5. Validacao:
   - rodar lint/testes relevantes

## Qualidade de resposta

- Sempre cite arquivos e linhas quando possivel.
- Separe fato observado de inferencia.
- Nao invente simbolos/metodos sem verificar no codigo.
- Se MCP retornar erro/cancelamento/timeout, reportar causa e proximo passo.
```

---

## 11) Referencias de implementacao

- `src/integration/tool-registry.mjs`
- `src/server/handlers/mcp-handler.js`
- `src/integration/tools/rag-tools.mjs`
- `tools/rag/lib/facade.mjs`
- `tools/rag/lib/scan.mjs`
- `src/integration/lsp/tsserver-daemon.mjs`
- `src/integration/tools/lsp-tools.mjs`
- `src/integration/tools/ollama-tools.mjs`
- `tools/ollama/client.mjs`
- `.vscode/mcp.json`
