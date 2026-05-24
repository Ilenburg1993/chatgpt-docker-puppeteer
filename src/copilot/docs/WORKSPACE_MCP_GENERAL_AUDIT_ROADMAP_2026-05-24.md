# Auditoria geral — WORKSPACE MCP após mudanças de autonomia/OAuth

**Data:** 2026-05-24
**Escopo:** MCP `WORKSPACE` conectado ao ChatGPT via Cloudflare Tunnel permanente e OAuth.
**Modo desta auditoria:** predominantemente read-only. Não foram feitas alterações no código-fonte durante a coleta desta auditoria, exceto consultas e leitura de histórico.
**Observação:** um `typecheck` e um `unit-mcp` haviam sido iniciados imediatamente antes da solicitação de “não rode mais validadores”; o histórico indica que ambos terminaram com sucesso. Após essa solicitação, a auditoria não depende de novos validadores.

---

## 1. Resumo executivo

O estado geral do MCP está forte e significativamente melhor que nas auditorias anteriores. O conector está em OAuth, com túnel permanente, resource/audience alinhados, issuer pronto, refresh-token anunciado pelo issuer, TTL de access token em 24h, refresh token em 30 dias, score de autonomia `95/A`, 71 ferramentas expostas e apenas 2 ferramentas classificadas como destrutivas.

Ainda assim, há gaps importantes. O status runtime continua `degraded`, mas agora por razões operacionais leves: smoke Cloudflare stale e ausência de smoke in-process após restart. O dirty workspace foi corretamente rebaixado para `informational`, não mais causa degradação. A nova ferramenta `mcp_oauth_friction_audit` indica `reauthRisk: low`, confirmando que a camada OAuth melhorou bastante.

O maior problema observado agora não é OAuth nem Cloudflare propriamente dito: é a interrupção do stream do ChatGPT web durante operações longas, especialmente validações e leituras de output. A captura de tela mostra “Conexão interrompida. Aguardando resposta completa”. Esse padrão é compatível com interrupção na camada host/browser/streaming do ChatGPT, não necessariamente falha do MCP. A evidência forte é que o job `unit-mcp` terminou com sucesso no servidor, mesmo quando a interface pareceu travar/interromper.

---

## 2. Evidências coletadas

### 2.1 Repo

- Branch: `main`
- HEAD: `28b80e06`
- Dirty: `true`
- Status principal:
  - `.codex/config.toml` modificado.
  - Vários documentos de auditoria não rastreados.

Interpretação: o dirty workspace ainda existe, mas está corretamente tratado como informativo no runtime health.

### 2.2 Runtime health

Estado atual:

```json
{
  "status": "degraded",
  "critical": [],
  "warnings": [
    "Cloudflare connector smoke is 593 minutes old; refresh smoke after tunnel, auth or DNS changes.",
    "No in-process mcp_smoke_workspace result has been recorded."
  ],
  "informational": [
    "Workspace has uncommitted or untracked changes."
  ]
}
```

Interpretação:

- Não há `critical`.
- O `dirty workspace` não degrada mais health; isso está correto.
- O `degraded` atual vem de:
  1. smoke Cloudflare antigo;
  2. ausência de `mcp_smoke_workspace` após restart.

### 2.3 Tunnel

Estado atual:

```json
{
  "mode": "named-permanent",
  "publicMcpUrl": "https://mcp.aurelin.org/mcp",
  "validation": { "ok": true },
  "lastSmokeOk": true,
  "lastSmokeFresh": false,
  "lastSmokeStaleAfterMinutes": 60,
  "recommendedAction": "refresh-connector-smoke"
}
```

Interpretação:

- O túnel permanente está configurado corretamente.
- A URL está correta: `https://mcp.aurelin.org/mcp`.
- O problema não é rota permanente; é frescor de smoke.
- O tunnel temporário antigo ainda aparece como fallback stale, mas está marcado como `ignoredForOperationalReadiness: true`.

### 2.4 OAuth

`mcp_auth_profile`:

```json
{
  "mode": "oauth",
  "enforcement": "all",
  "resource": "https://mcp.aurelin.org",
  "expectedAudience": "https://mcp.aurelin.org",
  "protectedResourceMetadataUrl": "https://mcp.aurelin.org/.well-known/oauth-protected-resource",
  "token_endpoint_auth_methods_supported": ["none"],
  "initialScopes": ["repo:read", "repo:write", "repo:validate", "repo:admin"]
}
```

`mcp_oauth_issuer_diagnostics`:

```json
{
  "ready": true,
  "issuer": "https://mcp.aurelin.org",
  "clientIdMetadataDocumentSupported": true,
  "tokenEndpointAuthMethodsSupported": ["none"],
  "codeChallengeMethodsSupported": ["S256"],
  "missingRequiredScopes": []
}
```

`mcp_oauth_friction_audit`:

```json
{
  "reauthRisk": "low",
  "resourceMatchesAudience": true,
  "issuerMatchesResource": true,
  "issuerGrantTypes": ["authorization_code", "refresh_token"],
  "cimdSupported": true,
  "pkceS256Advertised": true,
  "accessTokenTtlSeconds": 86400,
  "refreshTokenTtlSeconds": 2592000,
  "publicDiagnostic": true
}
```

Interpretação:

- OAuth está em bom estado.
- Resource/audience estão corretos e sem `/mcp`.
- Token endpoint auth methods agora estão alinhados em `["none"]`, removendo ambiguidade anterior.
- O issuer anuncia `refresh_token`.
- TTL de access token está em 24h.
- Refresh token TTL está em 30 dias.
- Risco de reauth agora é baixo.
- A camada OAuth não elimina approval prompts de tool-call; reduz reauth/401/consentimentos.

### 2.5 Tool surface

`mcp_tools_status`:

```json
{
  "totalTools": 71,
  "readOnlyCount": 53,
  "boundedWriteCount": 16,
  "destructiveCount": 2,
  "openWorldCount": 0,
  "idempotentReadCount": 53
}
```

Interpretação:

- Boa proporção de tools read-only.
- `openWorldCount = 0` é correto para repo-scoped MCP.
- Existem 8 plan-only tools.
- Destructive tools:
  - `repo_apply_file_batch`
  - `repo_remove_file`

### 2.6 Apps SDK readiness

Estado:

```json
{
  "hasWidgetResource": false,
  "cspApplicable": false,
  "hasCsp": false,
  "searchFetchToolsDetected": false
}
```

Interpretação:

- CSP de Apps SDK não é fonte dos prompts/bloqueios atuais.
- Não há widgets/UI resources.
- Company Knowledge `search/fetch` não está implementado; isso é opcional e depende do objetivo futuro.

### 2.7 Autonomy score

`mcp_autonomy_power_score`:

```json
{
  "score": 95,
  "grade": "A",
  "blockers": []
}
```

### 2.8 Histórico de validação

Últimos checks efetivos:

```json
{
  "typecheck": "passed",
  "unit-mcp": "passed",
  "lint": "passed"
}
```

Detalhes:

- `typecheck`:
  - Job: `73137bc4-c209-4c16-9f2f-5e1ba42fa716`
  - Status: completed
  - Exit code: 0

- `unit-mcp`:
  - Job: `4b0270ea-bc37-4856-8361-fac52995d48a`
  - Status: completed
  - Exit code: 0

- `suite-mcp-fast`:
  - Job anterior: `3bd23eed-ef14-4790-ae92-bf1b2c74064d`
  - Status: completed
  - Exit code: 0

Interpretação: apesar da interrupção visual no ChatGPT, o job unit-MCP terminou com sucesso no servidor.

---

## 3. Análise profunda da mensagem “Conexão interrompida. Aguardando resposta completa”

### 3.1 O que a imagem mostra

A captura mostra o ChatGPT web em modo desenvolvedor, com tool call em andamento e a mensagem:

> “Conexão interrompida. Aguardando resposta completa”

O botão de parar estava disponível e foi acionado antes de aguardar o eventual retry/continuação.

### 3.2 Diagnóstico provável

A evidência sugere uma interrupção no canal de streaming da interface ChatGPT, não uma falha direta do MCP.

Motivos:

1. `repo_status`, `mcp_runtime_health`, `mcp_tunnel_status`, `mcp_auth_profile`, `mcp_tools_status` e outras tools responderam normalmente.
2. O `unit-mcp`, que parecia associado ao momento de instabilidade, consta no histórico como `completed/passed`.
3. O health não mostra `critical`.
4. O túnel permanente está válido.
5. A mensagem aparece mais frequentemente quando há validações ou outputs longos, que são operações com maior chance de exceder janelas/limites/tempos do host.

### 3.3 Camadas possíveis

| Camada | Probabilidade | Evidência | Observação |
|---|---:|---|---|
| ChatGPT web/browser streaming | Alta | UI mostra “aguardando resposta completa” enquanto job server-side termina | Principal hipótese |
| ChatGPT host MCP orchestration | Alta | Ocorre em chamadas longas/validator output | Host pode perder/abortar stream mesmo com backend trabalhando |
| MCP server | Baixa a média | Health ok; jobs concluem | Não parece queda generalizada |
| Cloudflare Tunnel | Baixa a média | túnel ok, smoke antigo mas último ok | Smoke stale aumenta incerteza, mas não indica outage |
| OAuth | Baixa | OAuth ready e reauthRisk low | Não é o padrão de erro observado |
| Browser local/rede local | Média | UI web em navegador; operações longas são sensíveis | Pode agravar, mas não explica sozinho |

### 3.4 Por que validadores pioram isso

Validadores geram um conjunto de fatores ruins para ChatGPT web:

- tempo de execução maior;
- polling ou espera;
- outputs grandes;
- logs com muitas linhas;
- múltiplos tool calls encadeados;
- risco de host interromper streaming;
- risco de usuário clicar “parar” quando a UI parece travada, mesmo que o job continue server-side.

### 3.5 Conclusão prática

Não devemos rodar validadores de modo síncrono/verboso dentro do ChatGPT web quando o objetivo é estabilidade. O padrão ideal é:

1. iniciar job apenas quando necessário;
2. não aguardar log completo;
3. consultar `mcp_last_validation_summary`;
4. só ler tail pequeno em caso de falha;
5. preferir dashboards curtos a `job_get_output` grande.

---

## 4. Bugs e inconsistências detectadas

### BUG-1 — Runtime degraded por smoke antigo sem ferramenta clara de refresh

**Severidade:** Média
**Estado:** atual

O `mcp_runtime_health` está `degraded` por:

- connector smoke 593 minutos antigo;
- ausência de smoke in-process.

Existe recomendação `refresh-connector-smoke`, mas a tool surface não evidencia uma ferramenta dedicada `mcp_connector_smoke_refresh`.

**Impacto:** a saúde fica degradada mesmo com túnel permanente ok.

**Correção sugerida:**

Criar uma tool bounded/read-safe:

```text
mcp_connector_smoke_refresh
```

Ela deve:

- executar smoke HTTP mínimo contra a URL permanente;
- atualizar `connector-smoke.json`;
- ser curta e com output pequeno;
- não rodar unit tests;
- não retornar logs longos.

---

### BUG-2 — No in-process smoke após restart degrada health

**Severidade:** Baixa a média
**Estado:** atual

Após restart, `lastWorkspaceSmoke` fica `null`. Isso degrada health até que `mcp_smoke_workspace` seja chamado.

**Correção sugerida:**

Adicionar uma das opções:

1. `mcp_startup_smoke_summary`: startup smoke leve e automático; ou
2. `mcp_maintenance_apply_safe_fixes` incluir `run-mcp-smoke`; ou
3. documentar que após restart deve-se chamar `mcp_smoke_workspace`.

Melhor opção: startup smoke leve com timeout curto e sem tocar repo.

---

### BUG-3 — `job_cancel` aparece como remember candidate e também never remember

**Severidade:** Média
**Estado:** detectado em `mcp_tools_status`

`approvalFrictionProfile` informa:

```json
{
  "rememberApprovalCandidates": ["job_cancel", "..."],
  "neverRememberApproval": ["job_cancel", "repo_apply_file_batch", "repo_remove_file"]
}
```

Isso é contraditório.

**Correção sugerida:**

Filtrar `job_cancel` de `rememberApprovalCandidates`.

Regra recomendada:

```text
rememberApprovalCandidates = bounded-write não admin, não destructive, não cancel/remove
neverRememberApproval = destructive + admin-cancel + raw batch destructive
```

---

### BUG-4 — `repo_apply_file_batch` é destrutivo porque mistura operações seguras e remove

**Severidade:** Média/alta
**Estado:** atual

`repo_apply_file_batch` aparece como destructive. Isso faz sentido se a ferramenta aceita `remove_file`, mas penaliza batches seguros como create/move/quarantine.

**Correção sugerida:**

Separar em duas tools:

```text
repo_apply_safe_file_batch
repo_apply_destructive_file_batch
```

`repo_apply_safe_file_batch`:

- create_file;
- move_file sem overwrite;
- quarantine_file;
- restore sem overwrite.

`repo_apply_destructive_file_batch`:

- remove_file;
- overwrite;
- qualquer operação irreversível.

---

### BUG-5 — Diagnóstico OAuth público ainda é limitado

**Severidade:** Média
**Estado:** parcial

`mcp_oauth_friction_audit` já tem `securitySchemes: noauth + oauth2`, ótimo. Mas outras ferramentas úteis continuam só OAuth:

- `mcp_auth_profile`
- `mcp_oauth_issuer_diagnostics`
- `mcp_tunnel_status`
- `chatgpt_connector_current_url_status`

**Correção sugerida:**

Criar versões sanitizadas:

```text
mcp_public_auth_snapshot
mcp_public_connector_snapshot
```

Sem expor:

- paths locais;
- logs;
- tokens;
- arquivos;
- dados de repo.

Com expor:

- issuer;
- resource;
- protected metadata URL;
- scopes suportados;
- metadata readiness;
- recommended action.

---

### BUG-6 — Refresh token é in-memory, então restart pode causar reauth

**Severidade:** Média
**Estado:** inferido de `mcp_oauth_friction_audit`

A auditoria informa:

```text
refreshTokenRotation: in-memory one-time rotation for the built-in development issuer
```

**Impacto:** restart do MCP pode invalidar refresh tokens e forçar reauth mesmo com TTL de 30 dias.

**Correção sugerida:**

Persistir refresh tokens com hash, não plaintext:

```text
src/copilot/.ai/mcp/oauth-refresh-tokens.json
```

Com cleanup automático e rotação one-time.

---

### BUG-7 — DCR clients parecem in-memory

**Severidade:** Baixa/média
**Estado:** provável pelo desenho atual

CIMD está pronto, então isso não é grave. Mas clientes DCR podem se perder no restart.

**Correção sugerida:**

Persistir DCR clients sanitizados ou preferir explicitamente CIMD em docs e diagnostics.

---

### BUG-8 — Output de job é longo e causa instabilidade na UI

**Severidade:** Alta para uso real no ChatGPT web
**Estado:** observado

`job_get_output` com tails grandes e validadores podem interromper o stream da UI.

**Correção sugerida:**

Criar:

```text
job_get_summary
mcp_validation_dashboard
```

Eles devem retornar:

- status;
- exitCode;
- duração;
- última etapa;
- contagem de testes;
- 10–20 linhas finais no máximo;
- caminho do log, sem despejar o log.

---

### BUG-9 — `mcp_last_validation_summary` é bom, mas poderia ser a ferramenta padrão pós-validator

**Severidade:** Média
**Estado:** atual

Já existe e funciona bem, mas o fluxo recomendado ainda inclui `job_get_output`.

**Correção sugerida:**

Atualizar `mcp_session_profile`:

Fluxo atual:

```text
mcp_run_safe_validation_suite -> job_get_output
```

Fluxo recomendado:

```text
mcp_run_safe_validation_suite -> mcp_last_validation_summary -> job_get_output tail pequeno só se falhar
```

---

### BUG-10 — `mcp_oauth_issuer_diagnostics` tem nextSteps genérico

**Severidade:** Baixa
**Estado:** atual

Mesmo com JWKS configurado, retorna:

```text
Set COPILOT_MCP_OAUTH_JWKS_URI if it differs from the issuer default JWKS URL.
```

**Correção sugerida:**

Quando `ready=true` e `jwks` está ok, nextSteps deve dizer:

```text
OAuth issuer is ready. No issuer metadata fix is required.
```

---

## 5. Gaps de arquitetura

### GAP-1 — Falta modo “ChatGPT-stream-safe” para operações longas

Proposta:

```text
MCP_CHATGPT_STREAM_SAFE=1
```

Efeito:

- outputs truncados por padrão;
- job output sempre resumo;
- validator flow sempre assíncrono;
- tool calls com `tailBytes` grande recebem warning;
- tools longas retornam jobId rapidamente.

---

### GAP-2 — Falta “post-restart readiness sequence”

Após restart, o sistema precisa de sequência curta:

```text
mcp_runtime_health
mcp_oauth_friction_audit
mcp_tunnel_status
mcp_smoke_workspace
mcp_connector_smoke_refresh
```

Proposta:

```text
mcp_post_restart_readiness
```

Read-only/safe, com output curto.

---

### GAP-3 — Falta persistência robusta para OAuth dev issuer

O issuer dev agora é funcional, mas ainda há pontos dev-only:

- refresh tokens in-memory;
- DCR clients in-memory;
- key rotation sem overlap de JWKS antigo;
- sem revocation endpoint;
- sem token introspection endpoint.

Para um dev MCP pessoal isso é aceitável, mas para reduzir reauth ao máximo, persistência é melhor.

---

### GAP-4 — Falta medição estruturada real de prompts/bloqueios

`mcp_golden_prompts` existe, mas precisamos transformar observações em dados.

Proposta:

```text
mcp_prompt_friction_experiment_report
```

Entrada manual/sanitizada:

```json
{
  "promptId": "...",
  "tool": "...",
  "approvalShown": true,
  "hostBlocked": false,
  "rememberOffered": true,
  "rememberUsed": true
}
```

Saída:

- approval rate;
- block rate;
- best workflows;
- tools mais problemáticas.

---

### GAP-5 — Output schemas ainda são genéricos em muitas ferramentas

`coverage.outputSchema = 1`, mas o `metadataProfile` diz “registry-wide minimal passthrough schema; tool-specific schemas are the next hardening band”.

Proposta:

- schema específico para tools principais;
- `structuredContent` enxuto;
- mensagens previsíveis;
- menos campos gigantes por default.

---

## 6. Oportunidades de upgrade

### OPP-1 — Validation dashboard compacto

Criar:

```text
mcp_validation_dashboard
```

Retorna:

```json
{
  "lastTypecheck": "passed",
  "lastUnitMcp": "passed",
  "lastLint": "passed",
  "runningJobs": [],
  "recommendedNextAction": "none"
}
```

Sem logs completos.

### OPP-2 — Connector smoke refresh tool

Criar:

```text
mcp_connector_smoke_refresh
```

Benefícios:

- remove warning de smoke stale;
- reduz health degraded;
- evita confundir tunnel health com ChatGPT stream interruption.

### OPP-3 — Safe batch split

Criar:

```text
repo_apply_safe_file_batch
repo_apply_destructive_file_batch
```

Benefícios:

- menos prompts;
- melhor risk class;
- menos bloqueios host;
- `repo_apply_file_batch` atual pode virar deprecated.

### OPP-4 — Auth public snapshot

Criar:

```text
mcp_public_auth_snapshot
```

Benefícios:

- diagnosticar OAuth quebrado sem OAuth;
- reduzir loops de reauth.

### OPP-5 — Persistent refresh tokens

Persistir hashes com rotação.

Benefícios:

- menos reauth após restart;
- tokens longos de verdade;
- compatível com refresh TTL de 30 dias.

### OPP-6 — Streaming-safe job output

Alterar fluxo recomendado:

```text
Nunca ler log grande no ChatGPT web por padrão.
```

Novo fluxo:

```text
start job -> summary -> small tail only on failure
```

### OPP-7 — Prompts de início de conversa mais fortes

Atualizar `mcp_session_profile` e `mcp_golden_prompts` com:

```text
Não rode validadores sem pedir confirmação explícita.
Use summaries, não logs completos.
Se uma validação estiver rodando, consulte mcp_last_validation_summary.
```

### OPP-8 — Degraded severity tuning

Separar health em:

```text
status: ok | degraded | failed
readiness: ready | stale-smoke | needs-smoke | failed
informational: [...]
```

O sistema hoje fica degraded por smoke stale; isso é tecnicamente correto, mas pode causar ruído. Talvez `status=ok` e `readinessWarnings` separado faça mais sentido quando:
- tunnel está válido;
- OAuth ok;
- último smoke ok, embora stale.

---

## 7. Roadmap recomendado

### Fase 0 — Agora, sem validators

1. Não rodar novos validadores no ChatGPT web por enquanto.
2. Gerar e salvar esta auditoria.
3. Rodar apenas diagnósticos read-only.
4. Refresh manual do connector smoke fora do ChatGPT, se possível.
5. Reiniciar MCP só quando necessário.

### Fase 1 — Estabilidade da UI / conexão interrompida

Prioridade máxima para uso prático.

Itens:

- `mcp_validation_dashboard`
- `job_get_summary`
- limitar `job_get_output` por default
- atualizar `mcp_session_profile` para summaries first
- adicionar warnings quando `tailBytes` grande
- criar guideline “validator sem log grande”

Critério de sucesso:

- validações não causam mais “Conexão interrompida” com frequência;
- ChatGPT mostra jobId e resumo;
- logs completos ficam para uso local.

### Fase 2 — Health limpo pós-restart

Itens:

- `mcp_connector_smoke_refresh`
- `mcp_post_restart_readiness`
- startup smoke leve opcional
- diferenciar stale smoke de degraded operacional real.

Critério de sucesso:

- após restart, health fica `ok` ou `ready-with-info` em menos de 1 minuto.

### Fase 3 — OAuth hardening

Itens:

- persistir refresh tokens por hash;
- persistir DCR clients;
- revocation endpoint opcional;
- JWKS key rotation com overlap;
- melhorar nextSteps do issuer diagnostics;
- public sanitized auth snapshot.

Critério de sucesso:

- reauth raro mesmo após restart;
- diagnóstico OAuth disponível mesmo se token expirar;
- `mcp_oauth_friction_audit.reauthRisk = low` sem warnings.

### Fase 4 — Redução de approval prompts

Itens:

- remover `job_cancel` de remember candidates;
- split safe/destructive batch;
- tornar `repo_apply_safe_file_batch` bounded-write;
- manter remove/overwrite isolados;
- refinar `approvalFrictionProfile`.

Critério de sucesso:

- menos prompts em operações multi-file;
- host classifica safe batch como menos arriscado;
- destructive prompts ficam reservados para remoção real.

### Fase 5 — Schemas e UX de tools

Itens:

- outputSchema específico por ferramenta de alto uso;
- structuredContent menor por default;
- mode verbose opcional;
- campos `summary`, `details`, `nextActions`.

Critério de sucesso:

- menos output excessivo;
- menos blocks por payload;
- ferramentas mais previsíveis para o modelo.

### Fase 6 — Medição real

Itens:

- `mcp_prompt_friction_experiment_report`;
- tabela de golden prompts;
- métricas por tool:
  - approval shown;
  - remember approval offered;
  - host block;
  - stream interruption;
  - completion success.

Critério de sucesso:

- otimização guiada por dados reais do ChatGPT web.

---

## 8. Regras operacionais recomendadas a partir de agora

### 8.1 Para ChatGPT

Use este fluxo:

```text
mcp_session_profile
mcp_tools_status
mcp_oauth_friction_audit
mcp_runtime_health
```

Evitar por padrão:

```text
job_get_output com tail grande
validadores longos sem necessidade
repo_apply_file_batch destrutivo
repo_remove_file
job_cancel
```

### 8.2 Para validação

Quando necessário:

```text
mcp_run_safe_validation_suite
mcp_last_validation_summary
job_get_output tailBytes pequeno somente se falhar
```

Evitar:

```text
logs completos no ChatGPT web
várias validações consecutivas
esperar output síncrono longo
```

### 8.3 Para escrita

Usar sempre plan-first:

```text
repo_patch_plan -> repo_apply_patch
repo_create_file_plan -> repo_create_file
repo_move_file_plan -> repo_move_file
repo_quarantine_file_plan -> repo_quarantine_file
repo_apply_file_batch_plan -> repo_apply_file_batch
```

### 8.4 Para OAuth

Após alterações:

```text
mcp_auth_profile
mcp_oauth_issuer_diagnostics
mcp_oauth_friction_audit
```

Critérios:

```text
reauthRisk = low
resourceMatchesAudience = true
issuerMatchesResource = true
pkceS256Advertised = true
cimdSupported = true
issuerGrantTypes inclui refresh_token
```

---

## 9. Checklist de bugs/gaps por prioridade

### P0

- [x] Não usar logs longos/validators síncronos no ChatGPT web.
- [x] Criar `mcp_validation_dashboard`.
- [x] Criar `job_get_summary`.
- [x] Ajustar fluxo recomendado para summary-first.

### P1

- [x] Criar `mcp_connector_smoke_refresh`.
- [ ] Criar `mcp_post_restart_readiness`.
- [x] Remover `job_cancel` de `rememberApprovalCandidates`.
- [ ] Separar batch seguro/destrutivo.

Atualizacao 2026-05-24:

- [x] `make copilot-mcp-smoke-refresh` validou 74/74 tools remotas e persistiu smoke fresco.
- [x] `make copilot-mcp-status` confirmou `ready=true` no tunnel permanente.
- [x] `make copilot-mcp-oauth-smoke` confirmou OAuth, DCR, CIMD, refresh token, id token e `/oauth/userinfo`.
- [x] Restart MCP/Cloudflare corrigido para aguardar liberacao real da porta `127.0.0.1:3333`.

### P2

- [ ] Persistir refresh tokens por hash.
- [ ] Persistir DCR clients ou reforçar CIMD-only.
- [ ] Criar `mcp_public_auth_snapshot`.
- [ ] Melhorar nextSteps de `mcp_oauth_issuer_diagnostics`.

### P3

- [ ] Refino de output schemas.
- [ ] Medição real de prompt friction.
- [ ] Apps SDK widget/CSP apenas se algum widget for adicionado.
- [ ] Company Knowledge `search/fetch` apenas se esse MCP precisar virar fonte universal de conhecimento.

---

## 10. Conclusão

O MCP está em estado bom/forte:

```text
Autonomy score: 95/A
OAuth reauth risk: low
Tools: 71
Read-only tools: 53
Destructive tools: 2
Open-world tools: 0
Typecheck: passed
Unit MCP: passed
```

Os principais problemas restantes não são de “poder” bruto, mas de confiabilidade e fricção operacional:

1. stream do ChatGPT web interrompe com operações longas;
2. validator/log output precisa ser resumido;
3. health fica degraded por smoke stale;
4. batch destrutivo é amplo demais;
5. diagnósticos públicos/sanitizados ainda podem melhorar;
6. refresh token precisa persistir para sobreviver a restart.

A prioridade mais eficiente é atacar a experiência de uso real no ChatGPT: dashboards curtos, summary-first, smoke refresh dedicado e batch seguro. Isso tende a reduzir mais interrupções e prompts do que novas expansões de ferramenta.
