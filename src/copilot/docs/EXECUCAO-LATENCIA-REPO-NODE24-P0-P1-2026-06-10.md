# Execução — latência estrutural repo tools / Node 24 / P0-P1

Data: 2026-06-10  
Workspace: `/workspaces/chatgpt-docker-puppeteer`  
Branch/HEAD observado: `main` / `e69ec3d8`

## 1. Objetivo

Atualizar o roadmap assumindo Node 24 e iniciar transformações estruturais para reduzir a latência média das repo tools sem perda funcional.

## 2. Roadmap atualizado

Criado:

```text
src/copilot/docs/ROADMAP-LATENCIA-REPO-MCP-NODE24-2026-06-10.md
```

O roadmap agora prioriza:

1. P0 auth hot path seguro;
2. P1 Node 24 startup/jobs acceleration;
3. P2 result-size byte accounting;
4. P3 repo read/cache estrutural;
5. P4 search/tree index-first;
6. P5 patch/write batching;
7. P6 HTTP/2/Cloudflare experiments;
8. P7 workers só para CPU-bound.

## 3. P0 implementado — cache positivo de autorização

Criado:

```text
src/copilot/mcp/control-plane/auth-decision-cache.js
```

Alterados:

```text
src/copilot/mcp/control-plane/auth.js
src/copilot/mcp/tools/runtime-health.js
```

Características:

- retém apenas decisões positivas recentes de OAuth/JWKS;
- não retém falhas;
- TTL default de 60s e máximo de 5min;
- respeita expiração do JWT com margem de segurança;
- inclui escopos e fingerprint da configuração OAuth na chave;
- bypass para DPoP e payloads com confirmação criptográfica;
- limite LRU de 4096 entradas;
- métricas expostas em `mcp_runtime_health` como `authorizationCache`.

## 4. P1 implementado — compile cache Node 24 para validators/jobs

Criado:

```text
src/copilot/mcp/runtime/node-compile-cache.js
```

Alterado:

```text
src/copilot/mcp/scripts/run-safe-validation-suite.js
```

Características:

- ativa compile cache no safe validation runner;
- propaga `NODE_COMPILE_CACHE` para subprocessos `npm`/`npx`;
- usa `/tmp/node-compile-cache` por default;
- usa modo portátil por default;
- respeita `COPILOT_NODE_COMPILE_CACHE_DISABLED=true`;
- permite override por `NODE_COMPILE_CACHE` ou `COPILOT_NODE_COMPILE_CACHE_DIR`.

## 5. Validação final

Job final:

```text
b892cdad-ed4b-4b8d-95bc-32f0a1896b59
```

Resultado:

```text
mcp-full: success true
exitCode: 0
typecheck: pass, 5455 ms
lint: pass, 7553 ms
unit-mcp: pass, 15704 ms
Test Files: 36 passed
Tests: 174 passed
```

O log também mostrou compile cache ativo no runner:

```text
[safe-suite:node-compile-cache] status=0 dir=/tmp/node-compile-cache
```

## 6. Pendência operacional

É necessário reiniciar o MCP para o processo vivo carregar:

- o cache positivo no hot path;
- a seção `authorizationCache` em `mcp_runtime_health`.

O compile cache já opera para novos validator jobs.

## 7. Próxima rodada recomendada

Avançar para:

1. result-size byte accounting;
2. line-offset cache de `repo_read_file`;
3. invalidation de caches por write/patch;
4. `hashMode` opcional mantendo default seguro;
5. `repo_apply_patch_batch`.
