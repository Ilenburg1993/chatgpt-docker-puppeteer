# Auditoria profunda — WORKSPACE MCP após transformações amplas

**Data:** 2026-05-23
**Endpoint MCP testado:** `/WORKSPACE/link_6a11f5d55abc8191afb3817eb0edfe51`
**Domínio público esperado:** `https://mcp.aurelin.org/mcp`
**Branch:** `main`
**HEAD observado:** `415337b6`
**Objetivo:** avaliar profundamente o estado atual do MCP `WORKSPACE`, com foco em bugs, gaps, oportunidades de upgrade, permissões, liberdade operacional do ChatGPT, OAuth, outputSchema, securitySchemes, túnel permanente, index, validação e ferramentas de autonomia.

---

## Índice

1. [Resumo executivo](#1-resumo-executivo)
2. [Fontes oficiais consultadas](#2-fontes-oficiais-consultadas)
3. [Estado geral observado](#3-estado-geral-observado)
4. [Evolução desde a última auditoria](#4-evolução-desde-a-última-auditoria)
5. [Superfície de tools e metadados](#5-superfície-de-tools-e-metadados)
6. [Autonomia, permissões e poder efetivo](#6-autonomia-permissões-e-poder-efetivo)
7. [OAuth, securitySchemes e autenticação](#7-oauth-securityschemes-e-autenticação)
8. [outputSchema e aderência ao Apps SDK](#8-outputschema-e-aderência-ao-apps-sdk)
9. [Túnel permanente, domínio e URL do conector](#9-túnel-permanente-domínio-e-url-do-conector)
10. [Runtime health, smoke e sinais operacionais](#10-runtime-health-smoke-e-sinais-operacionais)
11. [Index e navegação de código](#11-index-e-navegação-de-código)
12. [Leitura, busca, outline e segurança de path](#12-leitura-busca-outline-e-segurança-de-path)
13. [Escrita, quarantine, delete e rollback](#13-escrita-quarantine-delete-e-rollback)
14. [Validação, jobs e suíte segura](#14-validação-jobs-e-suíte-segura)
15. [Bugs encontrados](#15-bugs-encontrados)
16. [Gaps restantes](#16-gaps-restantes)
17. [Oportunidades de upgrade](#17-oportunidades-de-upgrade)
18. [Prioridades recomendadas](#18-prioridades-recomendadas)
19. [Checklist de próxima validação no ChatGPT real](#19-checklist-de-próxima-validação-no-chatgpt-real)
20. [Veredito](#20-veredito)

---

## 1. Resumo executivo

O MCP `WORKSPACE` passou por uma evolução muito grande desde a última auditoria. A arquitetura atual está substancialmente mais madura, mais alinhada ao Apps SDK e muito mais poderosa para o ChatGPT operar o repositório.

Principais avanços confirmados live:

- O MCP agora expõe **67 tools anunciadas/visíveis**.
- `mcp_tools_status` informa **50 read-only idempotentes**, **16 bounded-write**, **1 destrutiva** e **0 open-world**.
- **100% das tools listadas em `mcp_tools_status` têm `hasOutputSchema=true`**.
- **100% das tools listadas têm `securitySchemes` explícito**, com scopes OAuth (`repo:read`, `repo:write`, `repo:validate`, `repo:admin`).
- `mcp_autonomy_power_score` retornou **95/100, grade A**.
- OAuth agora está ativo: `mcp_auth_profile.mode = oauth`, `enforcement = all`.
- O issuer OAuth em `https://mcp.aurelin.org` passou em diagnóstico: metadata OAuth pronta, escopos presentes, PKCE `S256` suportado e client metadata document funcional.
- O endpoint permanente `https://mcp.aurelin.org/mcp` está configurado como URL principal.
- Plan-only tools foram implementadas: `repo_patch_plan`, `repo_create_file_plan`, `repo_quarantine_file_plan`, `repo_move_file_plan`, `repo_index_refresh_plan`, `mcp_validation_plan`.
- O index build agora funcionou diretamente via ChatGPT/MCP: 45 arquivos indexados, 343 símbolos, 205 imports.
- Escrita real funcionou: criei arquivo temporário, coloquei em quarantine, restaurei e removi com `repo_remove_file(confirm=true)`.
- A validação real funcionou: `mcp_run_safe_validation_suite(mcp-fast)` passou com typecheck e unit-mcp.
- O `unit-mcp` atual passou com **12 arquivos e 85 testes**, indicando expansão importante da suíte.

Principais problemas restantes:

- O repo segue dirty: `.codex/config.toml` modificado e arquivos/docs não rastreados.
- `mcp_runtime_health` ainda mostra ruído do antigo quick tunnel temporário stale, mesmo com permanent tunnel funcionando.
- Há inconsistência de auth entre ferramentas: `mcp_auth_profile` e `chatgpt_connector_current_url_status` indicam OAuth, mas `mcp_tunnel_status.chatgpt.authentication` ainda mostra `none-dev`.
- O index está disponível após build manual, mas `indexAutoBuild.status = disabled`; sem auto-build, o index pode voltar a ficar vazio após restart.
- `mcp_smoke_workspace` não considera index indisponível como warning próprio; esse alerta aparece em `mcp_runtime_health`.
- O workspace tem artefatos de relatórios na raiz e docs não rastreados, mantendo smoke/runtime em `degraded`.
- O OAuth parece pronto tecnicamente, mas ainda precisa ser validado ponta a ponta na UI do ChatGPT com login/linking real e tokens emitidos pelo fluxo OAuth.

---

## 2. Fontes oficiais consultadas

Esta auditoria cruzou os resultados live do MCP com documentação oficial relevante:

- OpenAI Apps SDK Reference: https://developers.openai.com/apps-sdk/reference
  Usada para avaliar `outputSchema`, `securitySchemes`, `readOnlyHint`, `destructiveHint`, `openWorldHint`, `idempotentHint` e metadados de tools.
- ChatGPT Developer Mode: https://developers.openai.com/api/docs/guides/developer-mode
  Usada para avaliar conexão de apps/MCP no ChatGPT, Developer Mode, OAuth/No Authentication/Mixed Authentication e confirmações de write actions.
- Apps SDK Authentication: https://developers.openai.com/apps-sdk/build/auth
  Usada para avaliar OAuth metadata, protected resource metadata, `securitySchemes`, `_meta["mcp/www_authenticate"]` e scopes por tool.
- Apps SDK MCP Server: https://developers.openai.com/apps-sdk/build/mcp-server
  Usada para avaliar server MCP, tools e structured outputs.
- MCP Tools Specification: https://modelcontextprotocol.io/specification/2025-06-18/server/tools
  Usada para avaliar o modelo de tools MCP, humano no loop e contratos de tool.
- Cloudflare Tunnel DNS routing: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/dns/
  Usada para avaliar hostname público `mcp.aurelin.org`, Cloudflare Tunnel permanente e DNS route.

---

## 3. Estado geral observado

### 3.1. Git status

`repo_status` retornou:

```text
branch: main
head: 415337b6

## main...origin/main
 M .codex/config.toml
?? "# Relatório de Checagem Geral — MCP `WOR.md"
?? src/copilot/.ai/quarantine/
?? src/copilot/docs/NEW_AUDIT_AUTONOMIA_GPT.md
?? "src/copilot/docs/Plano consolidado de autonomia máxima.md"
```

O repo está dirty. Isso afeta:

- `mcp_smoke_workspace`, que retorna `degraded`;
- `mcp_runtime_health`, que retorna warnings;
- qualquer avaliação de “pronto para commit/merge”.

### 3.2. Últimos commits

`git_log(limit=12)` retornou:

```text
415337b6 feat(copilot-mcp): surface max-power auth posture
fbdb2056 feat(copilot-mcp): default chatgpt oauth to max scopes
9978c941 feat(copilot-mcp): extend oauth diagnostics to cimd
f0446676 test(copilot-mcp): prove cimd oauth flow
796e4635 feat(copilot-mcp): harden oauth discovery for chatgpt
66c170bd feat(mcp): persist dev OAuth issuer key
f41c3b71 feat(mcp): make OAuth the default connector auth
1a408ff7 fix(mcp): isolate permanent tunnel smoke state
b23da3ce feat(mcp): canonicalize permanent cloudflare hostname
1103a3ac feat(mcp): default Cloudflare tunnel to aurelin domain
be13e1fe feat(mcp): add autonomy power score
3a3e786f feat(mcp): expose auth environment templates
```

A sequência confirma foco recente em OAuth, autenticação/scopes, domínio permanente, tunnel permanente, autonomy score e diagnostics.

---

## 4. Evolução desde a última auditoria

A última auditoria apontava como principais gaps:

- falta/fragilidade de OAuth;
- ausência de outputSchema completo;
- ausência de securitySchemes explícitos por tool;
- dry-run write bloqueado pelo host;
- index vazio e build bloqueado;
- falta de plan-only tools;
- falta de current URL status sem input;
- falta de redaction status seguro;
- falta de last validation summary;
- falta de autonomy/power scoring.

Na auditoria atual, a maioria desses pontos foi corrigida ou melhorada:

| Item anterior                                | Estado atual                                        |
| -------------------------------------------- | --------------------------------------------------- |
| `outputSchema` recomendado pela UI           | `hasOutputSchema=true` para todas as tools listadas |
| `securitySchemes` ausente/fraco              | Scopes OAuth por tool presentes                     |
| Auth “Nenhuma”                               | OAuth default, enforcement all                      |
| URL temporária trycloudflare                 | URL permanente `https://mcp.aurelin.org/mcp`        |
| Plan-only tools ausentes                     | Implementadas                                       |
| Index build bloqueado/vazio                  | Build funcionou; index disponível                   |
| Validators bloqueados                        | `mcp-fast` funcionou                                |
| Writes/quarantine bloqueados                 | Create/quarantine/restore/delete funcionaram        |
| Redaction audit via showHidden problemático  | `repo_root_redaction_status` implementado           |
| Connector URL check com input URL bloqueável | `chatgpt_connector_current_url_status` implementado |
| Sem power score                              | `mcp_autonomy_power_score=95/A`                     |
| Host block diagnostics manual                | `mcp_host_block_diagnostics` implementado           |

---

## 5. Superfície de tools e metadados

### 5.1. Capabilities

`mcp_capabilities_summary` retornou `capabilitiesVersion: 13` e `advertisedToolCount: 67`.

Categorias:

- read;
- index;
- write;
- git;
- validation;
- runtime;
- connection;
- copilotSdk.

### 5.2. Tool status

`mcp_tools_status` retornou:

```json
{
  "totalTools": 67,
  "readOnlyCount": 50,
  "boundedWriteCount": 16,
  "destructiveCount": 1,
  "openWorldCount": 0,
  "idempotentReadCount": 50
}
```

### 5.3. Coverage

`mcp_autonomy_power_score` retornou:

```json
{
  "score": 95,
  "grade": "A",
  "coverage": {
    "outputSchema": 1,
    "securityMetadata": 1
  }
}
```

Isso confirma correção dos maiores gaps de metadados.

### 5.4. Registro MCP

`repo_read_file(src/copilot/mcp/registry.js)` confirmou que o registry passa para `server.registerTool`:

- `inputSchema`;
- `annotations`;
- `outputSchema`;
- `securitySchemes`;
- `_meta`.

Também confirmou que cada tool call passa por:

- `appendMcpAuditEvent`;
- `authorizeMcpToolCall`;
- `recordMcpToolMetric`.

---

## 6. Autonomia, permissões e poder efetivo

### 6.1. Score de autonomia

`mcp_autonomy_power_score`:

```json
{
  "score": 95,
  "grade": "A",
  "scoreParts": {
    "toolSurface": 18,
    "lowFrictionReads": 13,
    "writeSafety": 16,
    "metadata": 20,
    "validation": 12,
    "authPosture": 10,
    "promptFriction": 6
  },
  "blockers": []
}
```

Interpretação:

- A superfície de tools é ampla.
- Metadados estão maduros.
- Auth posture está muito forte.
- O principal espaço de melhoria é prompt friction e validação real na UI do ChatGPT.

### 6.2. Poder efetivo testado live

Diferente da auditoria anterior, agora consegui executar:

- `repo_create_file(dryRun=true)`;
- `repo_create_file(dryRun=false)`;
- `repo_quarantine_file`;
- `repo_restore_quarantined_file`;
- `repo_remove_file(confirm=true)`;
- `repo_index_build`;
- `mcp_run_safe_validation_suite(mcp-fast)`.

Isso é um salto material de liberdade operacional.

### 6.3. Ainda pendente

Mesmo com sucesso via MCP/API tool nesta sessão, ainda falta validar no ChatGPT UI real:

- se o conector OAuth faz login/linking corretamente;
- se write actions oferecem “remember approval”;
- se prompts de confirmação diminuem com plan-only tools;
- se `repo_apply_patch` e `mcp_run_safe_validation_suite` são aceitos sem bloqueios no ChatGPT UI;
- se scopes OAuth chegam corretamente ao MCP em chamadas reais.

---

## 7. OAuth, securitySchemes e autenticação

### 7.1. Auth profile

`mcp_auth_profile` retornou:

```json
{
  "mode": "oauth",
  "enforcement": "all",
  "authorizationServersConfigured": true,
  "expectedAudience": "https://mcp.aurelin.org",
  "jwksUriConfigured": true,
  "staticBearerConfigured": false,
  "challengePreview": "Bearer resource_metadata="https://mcp.aurelin.org/.well-known/oauth-protected-resource", scope="repo:read repo:write repo:validate repo:admin""
}
```

### 7.2. Protected resource metadata

Configurado em:

```text
https://mcp.aurelin.org/.well-known/oauth-protected-resource
```

Com:

- resource: `https://mcp.aurelin.org`;
- authorization server: `https://mcp.aurelin.org`;
- scopes:
  - `repo:read`;
  - `repo:write`;
  - `repo:validate`;
  - `repo:admin`.

### 7.3. Issuer diagnostics

`mcp_oauth_issuer_diagnostics` retornou:

```json
{
  "success": true,
  "ready": true,
  "issuer": "https://mcp.aurelin.org",
  "selectedMetadataUrl": "https://mcp.aurelin.org/.well-known/oauth-authorization-server",
  "metadataSummary": {
    "authorizationEndpointConfigured": true,
    "tokenEndpointConfigured": true,
    "userinfoEndpointConfigured": true,
    "registrationEndpointConfigured": true,
    "clientIdMetadataDocumentSupported": true,
    "tokenEndpointAuthMethodsSupported": ["none"],
    "codeChallengeMethodsSupported": ["S256"],
    "missingRequiredScopes": []
  }
}
```

Isso é muito bom. O OAuth parece pronto em metadata e discovery.

### 7.4. Bug/inconsistência

`chatgpt_connector_current_url_status` indica:

```json
{
  "authentication": "OAuth",
  "auth": {
    "mode": "oauth",
    "enforcement": "all"
  }
}
```

Mas `mcp_tunnel_status.chatgpt.authentication` ainda retornou:

```text
none-dev
```

Esse desalinhamento deve ser corrigido.

---

## 8. outputSchema e aderência ao Apps SDK

### 8.1. Estado atual

`mcp_tools_status` indica `hasOutputSchema: true` para todas as 67 tools. Isso corrige uma recomendação forte da documentação oficial do Apps SDK: tools que retornam `structuredContent` devem declarar `outputSchema`, permitindo validação e raciocínio melhor pelo modelo.

### 8.2. Qualidade atual

`mcp_capabilities_summary.metadataProfile` diz:

```text
outputSchema: registry-wide minimal passthrough schema; tool-specific schemas are the next hardening band
```

Isso significa que a cobertura existe, mas talvez ainda não seja tool-specific em todos os casos.

### 8.3. Próximo nível

Trocar schemas genéricos/passthrough por schemas específicos por tool, especialmente para:

- `repo_read_file`;
- `repo_patch_plan`;
- `repo_apply_patch`;
- `repo_quarantine_file`;
- `mcp_run_safe_validation_suite`;
- `mcp_auth_profile`;
- `mcp_runtime_health`;
- `mcp_smoke_workspace`;
- `mcp_tools_status`;
- `mcp_autonomy_power_score`.

---

## 9. Túnel permanente, domínio e URL do conector

### 9.1. Estado

`chatgpt_connector_current_url_status` retornou:

```json
{
  "currentUrl": "https://mcp.aurelin.org/mcp",
  "source": "permanent-config",
  "validation": { "ok": true },
  "chatgptForm": {
    "name": "LLM-B Workspace MCP",
    "mcpServerUrl": "https://mcp.aurelin.org/mcp",
    "authentication": "OAuth"
  }
}
```

`mcp_tunnel_status` retornou:

```json
{
  "mode": "named-permanent",
  "tunnelName": "workspace-mcp-dev",
  "zone": "aurelin.org",
  "publicHostname": "mcp.aurelin.org",
  "configuredPublicUrl": "https://mcp.aurelin.org/mcp",
  "configuredPublicUrlValidation": { "ok": true }
}
```

### 9.2. Melhorias confirmadas

- Domínio fixo substituiu `trycloudflare.com`.
- Permanent named tunnel está configurado.
- URL pública está estável e validada.

### 9.3. Problema restante

O status ainda carrega o quick tunnel antigo como stale:

```text
temporaryTunnel.processAlive=false
temporaryTunnel.stale=true
temporaryTunnel.recommendedAction=restart
```

Isso aparece tanto em `mcp_tunnel_status` quanto em `mcp_runtime_health`, mesmo que o caminho correto agora seja o permanent tunnel.

### 9.4. Correção proposta

Quando `mode = named-permanent` e `configuredPublicUrlValidation.ok = true`, o temporary tunnel stale deve ser:

- movido para seção `fallback`;
- não gerar recovery principal;
- não afetar estado operacional;
- não induzir “restart temporary quick tunnel”.

---

## 10. Runtime health, smoke e sinais operacionais

### 10.1. Runtime health atual

Depois do index build e smoke:

```json
{
  "status": "degraded",
  "warnings": [
    "Workspace has uncommitted or untracked changes.",
    "No Cloudflare smoke result is recorded for the current tunnel."
  ],
  "critical": []
}
```

### 10.2. Sinais operacionais

`operationalSignals` mostra:

- workspace dirty;
- index disponível;
- index auto-build disabled;
- last workspace smoke `degraded`;
- permanent tunnel configurado;
- no Cloudflare smoke result recorded.

### 10.3. Smoke

`mcp_smoke_workspace` passou todos os 13 checks funcionais:

- repo status;
- repo tree;
- root redaction;
- secret read blocked;
- file read;
- file stats;
- text search;
- symbol usages;
- symbol search;
- file outline;
- index status;
- project doctor;
- runtime health.

Status final do smoke:

```text
degraded
```

por:

```text
WORKSPACE_DIRTY
```

### 10.4. Gap

Agora que index é um componente central, `mcp_smoke_workspace` deveria emitir warning próprio se `repo_index_status.available=false`. No teste inicial, quando index estava indisponível, o smoke detalhou `available=false`, mas não adicionou warning. O runtime health já faz isso melhor.

---

## 11. Index e navegação de código

### 11.1. Estado inicial

Antes do build manual:

```json
{
  "enabled": true,
  "available": false,
  "files": 0,
  "freshness": "empty"
}
```

### 11.2. Build

`repo_index_build(path=src/copilot/mcp, maxFiles=500)` funcionou:

```json
{
  "available": true,
  "candidateFiles": 45,
  "indexed": 45,
  "skipped": 1,
  "failed": 0,
  "durationMs": 676
}
```

Stats:

```json
{
  "files": 45,
  "freshFiles": 45,
  "symbols": 343,
  "imports": 205,
  "chunks": 74,
  "freshness": "fresh-or-aging"
}
```

### 11.3. Search

`repo_index_search("securitySchemes outputSchema")` retornou 4 matches via `fts5-index`.

### 11.4. Gap

Auto-build está desabilitado:

```json
{
  "indexAutoBuild": {
    "status": "disabled",
    "reason": "auto-build-disabled"
  }
}
```

Recomendação: habilitar auto-build para `src/copilot` ou pelo menos `src/copilot/mcp` quando iniciar o MCP server.

---

## 12. Leitura, busca, outline e segurança de path

### 12.1. Leitura

Diferente de auditorias anteriores, `repo_read_file(src/copilot/mcp/registry.js)` funcionou em janelas:

- linhas 1–80;
- linhas 81–168.

Isso permitiu confirmar:

- imports de tools;
- `normalizeMcpToolDefinitions`;
- `outputSchema`;
- `securitySchemes`;
- `_meta`;
- `authorizeMcpToolCall`;
- audit events.

### 12.2. Root tree

`repo_root_tree(showHidden=true)` funcionou, com:

```json
{
  "blockedEntriesCount": 9,
  "truncated": true
}
```

A listagem expõe dotfiles não protegidos, mas redige entradas protegidas.

### 12.3. Redaction status

`repo_root_redaction_status` é uma boa alternativa para auditoria sem expor nomes:

```json
{
  "hiddenNamesReturned": false,
  "protectedNamesReturned": false,
  "protectedOrRedactedTopLevelCount": 12
}
```

### 12.4. Observação de higiene

A raiz tem artefatos com nomes problemáticos:

```text
# Guia focado — Conexão do ChatGPT ao VS.md
# Relatório de Checagem Geral — MCP `WOR.md
${containerUserHome}
60
```

Eles deveriam ser movidos/quarentenados ou documentados.

---

## 13. Escrita, quarantine, delete e rollback

### 13.1. Plan-only

`repo_create_file_plan` funcionou.

### 13.2. Create dry-run

`repo_create_file(dryRun=true)` funcionou.

### 13.3. Create real

`repo_create_file(dryRun=false)` funcionou e criou:

```text
src/copilot/.ai/tmp/audit-plan-only-test.txt
```

### 13.4. Quarantine

`repo_quarantine_file_plan` funcionou depois que o arquivo existia.

`repo_quarantine_file` funcionou e retornou `quarantineId`.

### 13.5. Restore

`repo_restore_quarantined_file` funcionou e restaurou para o path original.

### 13.6. Delete

`repo_remove_file(confirm=true)` funcionou para remover o arquivo temporário, com snapshot de rollback.

### 13.7. Gap

A operação de quarantine deixa metadados em:

```text
src/copilot/.ai/quarantine/
```

O diretório ficou não rastreado. Isso é esperado, mas precisa ser tratado por `.gitignore` ou hygiene policy.

---

## 14. Validação, jobs e suíte segura

### 14.1. Validation plan

`mcp_validation_plan(suite=mcp-fast)` funcionou.

### 14.2. Safe validation suite

`mcp_run_safe_validation_suite(mcp-fast)` funcionou e iniciou job:

```text
45bb25f2-b926-4696-894b-9c22c535a9c9
```

### 14.3. Resultado

O job completou com `exitCode=0`.

Resumo:

```text
typecheck: passed, durationMs=4493
unit-mcp: passed, durationMs=6036
```

Vitest:

```text
Test Files: 12 passed
Tests: 85 passed
Duration: 4.38s
```

### 14.4. Last validation summary

`mcp_last_validation_summary` funcionou e mostrou:

- `suite-mcp-fast`: passed;
- `lint`: último passado;
- `unit-mcp`: último passado;
- `typecheck`: ainda mostra um job antigo falho, embora a suite nova contenha typecheck passado.

### 14.5. Gap

`mcp_last_validation_summary` por validator ainda pode induzir erro porque `typecheck` isolado mais recente é antigo/falho, enquanto `suite-mcp-fast` acabou de passar typecheck. Seria útil agregar “latest effective typecheck result” considerando suites.

---

## 15. Bugs encontrados

### BUG-001 — Inconsistência de auth entre status tools

**Severidade:** P1
**Evidência:** `mcp_auth_profile` e `chatgpt_connector_current_url_status` indicam OAuth/enforcement all, mas `mcp_tunnel_status.chatgpt.authentication` ainda mostra `none-dev`.

**Impacto:** pode orientar incorretamente o usuário na configuração do ChatGPT.

**Correção proposta:** centralizar a fonte de auth display em `mcp_auth_profile` ou config efetiva; `mcp_tunnel_status` não deve manter valor legado.

---

### BUG-002 — Runtime health ainda carrega ruído do quick tunnel temporário

**Severidade:** P2
**Evidência:** `mcp_runtime_health.tunnel` ainda aponta para `temporary-trycloudflare` stale, apesar de `operationalSignals.tunnel.mode = named-permanent`.

**Impacto:** o usuário pode pensar que precisa reiniciar o quick tunnel, mesmo usando `mcp.aurelin.org`.

**Correção proposta:** quando permanent tunnel está validado, mover quick tunnel para `fallbackTemporaryTunnel` e não gerar recovery principal.

---

### BUG-003 — `mcp_last_validation_summary` não agrega resultados equivalentes de suites

**Severidade:** P2
**Evidência:** `typecheck` isolado mais recente é um job antigo falho, mas `suite-mcp-fast` acabou de passar typecheck.

**Impacto:** resumo pode sugerir que typecheck está falho quando o estado efetivo recente está OK dentro da suite.

**Correção proposta:** adicionar campo `effectiveChecks`, extraindo steps internos de `suite-mcp-fast`/`suite-mcp-full`.

---

### BUG-004 — `mcp_smoke_workspace` não eleva warning de index indisponível

**Severidade:** P2
**Evidência:** quando index estava indisponível, smoke detalhou `available=false`, mas warnings só mencionaram workspace dirty.

**Impacto:** smoke pode parecer saudável demais para navegação LLM.

**Correção proposta:** se `repo_index_status.enabled=true && available=false`, adicionar warning `INDEX_UNAVAILABLE`.

---

### BUG-005 — Quarantine/restored metadata suja o workspace

**Severidade:** P2/P3
**Evidência:** após testes, `src/copilot/.ai/quarantine/` aparece como untracked.

**Impacto:** workspace dirty persistente e ruído em auditorias.

**Correção proposta:** adicionar `.gitignore` para `.ai/quarantine/*.data`, `.ai/quarantine/*.json` ou mover quarantine para diretório já ignorado.

---

### BUG-006 — Root tree showHidden expõe muitos nomes não protegidos

**Severidade:** P3
**Evidência:** `repo_root_tree(showHidden=true)` lista dotfiles e artefatos não protegidos.

**Impacto:** não é vazamento de segredo, mas aumenta payload e exposição de metadados.

**Correção proposta:** usar `repo_root_redaction_status` como default em prompts ChatGPT; talvez adicionar `redactHiddenNames=true`.

---

## 16. Gaps restantes

### GAP-001 — OAuth ainda precisa de validação UI ponta a ponta

O issuer está pronto, mas falta confirmar:

- ChatGPT UI mostra OAuth;
- login/linking funciona;
- token chega ao MCP;
- scopes corretos chegam;
- read/write/validate/admin são respeitados.

### GAP-002 — Auto-build de index desabilitado

Sem auto-build, após restart o index pode voltar a estado vazio. Isso reduz autonomia de navegação.

### GAP-003 — Dirty workspace persistente

O estado dirty precisa ser resolvido com:

- commit;
- quarantine;
- `.gitignore`;
- mover relatórios para docs/audits;
- limpar artefatos de raiz.

### GAP-004 — Tool-specific outputSchema ainda é hardening futuro

Há cobertura de outputSchema, mas o próprio metadataProfile indica que schemas específicos por tool são o próximo nível.

### GAP-005 — Sem Cloudflare smoke result para o current permanent tunnel

Runtime health alerta:

```text
No Cloudflare smoke result is recorded for the current tunnel.
```

Criar smoke específico para `mcp.aurelin.org`.

### GAP-006 — No-auth fallback e OAuth strict precisam de runbook

Há templates, mas falta um procedimento claro:

- quando usar OAuth;
- quando usar none-dev fallback;
- como recuperar se OAuth UI falhar;
- como validar issuer/JWKS;
- como reverter sem perder tools.

---

## 17. Oportunidades de upgrade

### UPG-001 — Corrigir status/auth single source of truth

Criar helper único:

```text
getEffectiveMcpConnectorAuthProfile()
```

Usado por:

- `mcp_auth_profile`;
- `mcp_tunnel_status`;
- `chatgpt_connector_current_url_status`;
- `mcp_session_profile`.

### UPG-002 — Habilitar index auto-build para MCP

Config recomendada:

```env
COPILOT_MCP_INDEX_AUTO_BUILD=true
COPILOT_MCP_INDEX_AUTO_BUILD_PATH=src/copilot/mcp
COPILOT_MCP_INDEX_AUTO_BUILD_MAX_FILES=1000
```

Ou para o projeto:

```env
COPILOT_MCP_INDEX_AUTO_BUILD_PATH=src/copilot
COPILOT_MCP_INDEX_AUTO_BUILD_MAX_FILES=5000
```

### UPG-003 — Effective validation summary

Criar:

```text
mcp_effective_validation_summary
```

Que retorna:

- latest typecheck effective result;
- latest unit-mcp effective result;
- latest lint result;
- suite source;
- stale/fresh status.

### UPG-004 — Cloudflare permanent smoke

Adicionar:

```text
mcp_cloudflare_permanent_smoke
```

Ou ampliar `mcp_tunnel_status` com:

- lastPermanentSmokeAt;
- lastPermanentSmokeOk;
- response status;
- auth challenge status;
- `/mcp` reachability.

### UPG-005 — Tool-specific schemas

Priorizar schemas específicos para:

1. `mcp_auth_profile`;
2. `mcp_oauth_issuer_diagnostics`;
3. `mcp_tools_status`;
4. `mcp_autonomy_power_score`;
5. `repo_apply_patch`;
6. `repo_quarantine_file`;
7. `mcp_run_safe_validation_suite`;
8. `mcp_runtime_health`.

### UPG-006 — Hygiene/quarantine management

Adicionar:

```text
repo_hygiene_report
repo_quarantine_prune_restored
repo_move_root_reports_to_docs_plan
repo_move_root_reports_to_docs_apply
```

### UPG-007 — ChatGPT UI OAuth test script

Adicionar `mcp_golden_prompts` casos específicos:

- oauth connect;
- repo:read call;
- repo:write call;
- repo:validate call;
- insufficient_scope;
- remember approval.

### UPG-008 — Power score com observações históricas

`mcp_autonomy_power_score` já é excelente. Próximo passo:

- incluir host block rate;
- incluir golden prompt results;
- incluir OAuth UI status;
- incluir index freshness;
- incluir workspace dirty penalty maior.

---

## 18. Prioridades recomendadas

### P0

1. Corrigir inconsistência de auth em `mcp_tunnel_status`.
2. Testar OAuth ponta a ponta na UI do ChatGPT.
3. Habilitar ou documentar auto-build de index.
4. Limpar/organizar dirty workspace.

### P1

1. Criar permanent tunnel smoke.
2. Criar effective validation summary.
3. Ajustar `mcp_last_validation_summary` para considerar suites.
4. Adicionar warning de index unavailable ao smoke.
5. Ignorar ou gerenciar `.ai/quarantine`.

### P2

1. Expandir schemas específicos por tool.
2. Criar hygiene tools para relatórios de raiz.
3. Criar runbook OAuth/noauth fallback.
4. Expandir golden prompts para OAuth/scopes.

---

## 19. Checklist de próxima validação no ChatGPT real

Na UI do ChatGPT, usando o conector com:

```text
URL: https://mcp.aurelin.org/mcp
Authentication: OAuth
```

Executar:

1. `mcp_auth_profile`
2. `mcp_oauth_issuer_diagnostics`
3. `mcp_session_profile`
4. `mcp_tools_status`
5. `mcp_autonomy_power_score`
6. `repo_status`
7. `repo_index_search`
8. `repo_create_file_plan`
9. `repo_create_file(dryRun=true)`
10. `repo_apply_patch(dryRun=true)` em arquivo temporário
11. `mcp_validation_plan(suite=mcp-fast)`
12. `mcp_run_safe_validation_suite(suite=mcp-fast)`
13. `job_get_output`
14. `mcp_host_block_diagnostics` se qualquer chamada for bloqueada

Registrar:

- se OAuth login apareceu;
- se tokens/scopes chegaram;
- se houve confirmação;
- se houve opção de lembrar aprovação;
- se houve bloqueio externo;
- se o MCP recebeu a chamada.

---

## 20. Veredito

O MCP `WORKSPACE` está agora em seu melhor estado até aqui. A arquitetura saltou de um conector experimental com várias lacunas para uma plataforma MCP com alto grau de maturidade:

```text
Autonomia: A / 95
Tools: 67
OutputSchema coverage: 100%
SecuritySchemes coverage: 100%
OAuth metadata: ready
Permanent domain: configured
Index: working after build
Writes: working
Quarantine/restore/delete: working
Safe validation: working
Smoke: functional
Runtime: degraded only by operational hygiene
```

A principal conclusão é que os maiores gaps anteriores foram resolvidos: outputSchema, securitySchemes, OAuth, plan-only tools, current URL status, redaction status, safe validation e writes reais agora funcionam.

O que resta não é reconstruir a arquitetura, mas endurecer e limpar:

- corrigir inconsistências de status/auth;
- remover ruído do quick tunnel antigo;
- validar OAuth na UI real do ChatGPT;
- habilitar auto-build do index;
- limpar workspace dirty;
- avançar de schemas genéricos para schemas tool-specific;
- criar smoke permanente Cloudflare.

Em termos de liberdade e poder do ChatGPT sobre o repo, o sistema saiu de “parcialmente bloqueado e instável” para “amplo, autenticado, auditável e operacional”, com poucas lacunas remanescentes.
