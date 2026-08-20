# Transformações profundas MCP — rodada pós-restart

Data: 2026-06-10  
Workspace: `/workspaces/chatgpt-docker-puppeteer`  
Branch/HEAD observado: `main` / `e69ec3d8`

---

## 1. Resultado executivo

Após o restart, confirmei que o runtime subiu corretamente e que a primeira transformação P1
anterior (`mcp_latency_dashboard`) passou a ser anunciada no conector vivo.

Em seguida apliquei uma segunda onda de transformações profundas focadas em:

1. persistência histórica de latência;
2. comparação contra snapshot anterior;
3. superfícies reduzidas para Claude/research/safe mode;
4. inclusão de `mcp_latency_dashboard` nos modos reduzidos de baixa latência;
5. validação completa `mcp-full`.

Resultado final da validação:

```text
suite: mcp-full
success: true
typecheck: pass
lint: pass
unit-mcp: pass
Test Files: 36 passed
Tests: 174 passed
```

Job final:

```text
bebb7151-1e7e-47be-920e-5520eb8dc4e9
```

---

## 2. Baseline pós-restart

### 2.1 Readiness

`mcp_post_restart_readiness` retornou:

- `ready: true`;
- modo `named-permanent`;
- conector `https://mcp.aurelin.org/mcp`;
- processo MCP vivo;
- processo `cloudflared` vivo;
- local health 200;
- public health 200;
- connector smoke fresh.

Ainda há logs de reconexão de túnel no momento do restart, mas sem impedir readiness.

### 2.2 Capabilities

`mcp_capabilities_summary` confirmou:

- `capabilitiesVersion: 36`;
- `advertisedToolCount: 97`;
- `mcp_latency_dashboard` presente na categoria runtime e na lista anunciada.

### 2.3 Latência inicial

Primeira chamada de `mcp_latency_dashboard` no runtime novo:

- status: `insufficient-data`;
- chamadas observadas: 2;
- erros: 0;
- autorização média: 75 ms;
- handler médio: 36 ms;
- resultSize médio: 0 ms;
- tool mais lenta inicial: `mcp_post_restart_readiness`, 220 ms.

Interpretação: a amostra ainda era pequena, mas saudável.

---

## 3. Transformação 1 — histórico persistente de latência

### 3.1 Novo módulo

Criado:

```text
src/copilot/mcp/control-plane/latency-history.js
```

Exportado em:

```text
src/copilot/mcp/control-plane/index.js
```

### 3.2 O que ele adiciona

Funções novas:

```text
appendMcpLatencyDashboardSnapshot
readMcpLatencyDashboardHistory
compareMcpLatencyDashboardSnapshots
```

Arquivo persistente padrão:

```text
src/copilot/.ai/mcp/latency-dashboard.jsonl
```

Características:

- JSONL compacto;
- não grava payloads de usuário;
- não grava tokens;
- grava apenas resumo de status, sample, budgets, warnings, critical e phaseTotals;
- retenção default de 500 snapshots;
- limite máximo de 10.000 snapshots;
- leitura limitada a 2 MB finais do arquivo para evitar explosão de memória.

### 3.3 Comparação histórica

A comparação calcula deltas de:

- totalCalls;
- totalErrors;
- errorRate;
- slowestAverageToolMs;
- authorizationAverageMs;
- handlerAverageMs;
- resultSizeAverageMs.

Ela também gera interpretação humana, por exemplo:

- regressão de error rate;
- melhora/piora de slowest tool;
- regressão material de autorização;
- ausência de regressão material.

---

## 4. Transformação 2 — evolução da `mcp_latency_dashboard`

Arquivo alterado:

```text
src/copilot/mcp/tools/latency-dashboard.js
```

Novos inputs:

```text
persistSnapshot?: boolean
compareHistory?: boolean
historyLimit?: number
maxHistorySnapshots?: number
```

Comportamento:

- `persistSnapshot=true`: grava snapshot compacto no histórico local.
- `compareHistory=true`: compara o snapshot atual com o último snapshot persistido.
- `historyLimit`: controla quantos snapshots recentes são retornados no resumo.
- `maxHistorySnapshots`: controla retenção máxima ao persistir.

Observação operacional: essa evolução precisa de novo restart para aparecer no runtime vivo, porque
foi implementada depois do restart que carregou a versão inicial da dashboard.

---

## 5. Transformação 3 — tool surface segura para Claude/research

Arquivo alterado:

```text
src/copilot/mcp/tool-surface.js
```

Antes:

```text
COPILOT_MCP_TOOL_SURFACE=full|latency|minimal|cloudflare|readonly
```

Depois:

```text
COPILOT_MCP_TOOL_SURFACE=full|latency|minimal|cloudflare|readonly|claude|safe|research
```

### 5.1 Novos modos

Os novos modos são:

```text
claude
safe
research
```

Eles apontam para a mesma superfície segura:

```text
SAFE_RESEARCH_SURFACE_TOOL_NAMES
```

### 5.2 Filosofia da superfície segura

A superfície segura prioriza:

- leitura de repo;
- busca/index;
- git read-only;
- status/runtime;
- validação plan/read;
- OAuth diagnostics;
- Claude connector profile;
- métricas Cloudflare read-only.

Ela exclui, por padrão:

- `repo_apply_patch`;
- `repo_create_file`;
- `repo_remove_file`;
- ferramentas destructive;
- ferramentas write/admin.

### 5.3 Teste adicionado

Arquivo:

```text
tests/unit/copilot/mcp/test_mcp_registry.spec.js
```

Novo teste:

```text
supports a safe Claude/research tool surface without write tools
```

Ele verifica que:

- `mcp_latency_dashboard` está presente;
- `claude_connector_profile` está presente;
- `repo_read_file` está presente;
- `repo_apply_patch`, `repo_create_file` e `repo_remove_file` ficam ausentes;
- nenhuma tool exposta tem `destructiveHint=true`.

---

## 6. Transformação 4 — inclusão da dashboard em superfícies reduzidas

`mcp_latency_dashboard` foi incluída em:

- `latency`;
- `minimal`;
- `cloudflare`;
- `safe/claude/research`.

Racional: a própria tool de observabilidade de latência precisa continuar disponível justamente
quando a superfície é reduzida para melhorar startup, reduzir `tools/list` e diminuir atrito.

---

## 7. Validação final

Job final validado:

```text
bebb7151-1e7e-47be-920e-5520eb8dc4e9
```

Resultado:

```text
success: true
exitCode: 0
```

Detalhes:

```text
typecheck: pass, 5782 ms
lint: pass, 14919 ms
unit-mcp: pass, 18014 ms
```

Resumo Vitest:

```text
Test Files: 36 passed
Tests: 174 passed
```

---

## 8. Estado operacional após a rodada

O repo continua `dirty`, como esperado, porque esta rodada aplicou mudanças reais e também já havia
alterações anteriores. Arquivos novos desta rodada:

```text
src/copilot/mcp/control-plane/latency-history.js
src/copilot/docs/TRANSFORMACOES-PROFUNDAS-MCP-2026-06-10.md
```

Arquivos relevantes alterados nesta rodada:

```text
src/copilot/mcp/control-plane/index.js
src/copilot/mcp/tool-surface.js
src/copilot/mcp/tools/latency-dashboard.js
tests/unit/copilot/mcp/test_mcp_registry.spec.js
```

---

## 9. Próximo gate recomendado

Para ativar tudo no runtime vivo:

1. reiniciar MCP novamente;
2. chamar `mcp_latency_dashboard` com:

```json
{
  "persistSnapshot": true,
  "compareHistory": true,
  "historyLimit": 5
}
```

3. testar modo seguro em processo/ambiente separado com:

```text
COPILOT_MCP_TOOL_SURFACE=claude
```

4. rodar `mcp-full` novamente após qualquer mudança de env/runtime.

---

## 10. Veredito

A plataforma avançou de observabilidade instantânea para observabilidade com memória. Também passou
a ter uma superfície segura explicitamente pensada para Claude, Research e uso read/validate, sem
sacrificar o perfil full/max-autonomy usado no ChatGPT principal.

Essas mudanças melhoram latência e compatibilidade em duas frentes: reduzem a superfície anunciável
quando desejado e criam um mecanismo persistente para medir regressões em vez de depender de
impressões subjetivas.
