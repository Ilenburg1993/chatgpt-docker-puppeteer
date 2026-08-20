# Auditoria ampla de `src/copilot` — diagnóstico, bugs, gaps e roadmap complexo

**Data:** 2026-06-13  
**Escopo:** `src/copilot`, testes unitários associados em `tests/unit/copilot`, superfície MCP do
workspace e integrações diretas com Copilot SDK, MCP, OAuth, Cloudflare Tunnel e
BYOK/model-gateway.  
**Branch observada:** `main`  
**HEAD observado:** `c6734351`  
**Runtime observado:** Node.js `v24.15.0` em Linux.  
**Arquivo gerado por auditoria:**
`src/copilot/docs/AUDITORIA-AMPLA-SRC-COPILOT-ROADMAP-2026-06-13.md`.

> **Status em 2026-08-14: HISTÓRICO / SUPERADO PARCIALMENTE.** Este arquivo preserva a fotografia de
> 2026-06-13 e não deve ser usado isoladamente como source of truth do `HEAD`. A coordenação vigente
> está em `WORKSPACE_SRC_COPILOT_DIAGNOSTICO_ESTADO_ALVO_E_ROADMAP_2026-08-14.md` e `docs/INDEX.md`.
> Em particular: (1) o runtime MCP atual é stateful; (2) `env-secret-registry.js` é protegido pela
> policy do WORKSPACE e não pode ser classificado como ausente a partir de uma leitura negada; (3) o
> detector de imports agora resolve `package.json#imports` e separa `protected/unverifiable` de true
> orphan; (4) `approve_all` permanece por decisão de produto o default intencional de permissões,
> mas o fallback foi unificado e pode ser alterado por `AGENT_PERMISSION_MODE=audit_only|selective`;
> (5) o baseline do Copilot SDK avançou para 1.0.9. As afirmações abaixo continuam válidas como
> evidência do estado observado na data original, não como diagnóstico automático atual.

---

## 1. Sumário executivo

A base `src/copilot` está em estado operacionalmente forte: os gates formais executados nesta
auditoria passaram, a superfície MCP está ampla e classificada por risco, o modo OAuth está ativo
com Protected Resource Metadata publicado, e o runtime reporta saúde geral `ok`. A arquitetura já
contém camadas maduras: `sdk/`, `config/`, `mcp/`, `model-gateway/`, `infra/io`, `terminal`,
`conversation-hub`, `observability`, `events`, `tools`, `agent` e `boot`.

Entretanto, a maturidade não é homogênea. Há uma tensão recorrente entre evolução rápida e
fechamento de contratos: alguns recursos recentes do Copilot SDK 1.0 aparecem como passthrough
parcial, mas não como superfície local completa; a governança de imports detecta falsos positivos em
aliases `package.json#imports`, mas também revela pelo menos um import relativo realmente suspeito
no `model-gateway`; permissões de sessão ainda caem em `approveAll` quando faltam handlers
explícitos; e o transport MCP HTTP foi deliberadamente tornado stateless, o que simplifica
compatibilidade com o SDK atual, mas deixa lacunas de sessão, resumability e redelivery face ao
ideal do Streamable HTTP.

O diagnóstico central é: **o projeto já é produtivo e validado, mas precisa atravessar uma faixa de
hardening contratual para reduzir ambiguidade, falsos positivos, permissões implícitas e lacunas de
completude SDK/MCP antes de aumentar autonomia, automação e capacidade multi-runtime.**

---

## 2. Evidências coletadas

### 2.1 Estado do repositório

- Branch: `main`.
- HEAD: `c6734351`.
- Working tree já estava suja antes desta auditoria, com modificações em arquivos de `infra/io`,
  `mcp/cloudflare`, `terminal` e testes, além de artefatos untracked em documentação/testes. Esta
  auditoria não deve ser interpretada como proprietária dessas mudanças.
- Diretório `src/copilot` contém aproximadamente 1.600 arquivos indexados pelo índice MCP, com mais
  de 10.000 símbolos indexados.

### 2.2 Dependências e runtime

- `package.json` declara `type: module`.
- `package-lock.json` registra `@github/copilot-sdk` versão instalada `1.0.0` e dependência
  declarada `^1.0.0`.
- `package.json` declara `@modelcontextprotocol/sdk ^1.29.0`, `cloudflare ^6.3.0`, `openai ^6.42.0`,
  `express ^5.2.1`, `zod ^4.4.3` e demais dependências compatíveis com stack Node 24+.
- O acesso direto a `node_modules` é bloqueado pelo escopo de segurança do conector; portanto, esta
  auditoria não leu arquivos internos do pacote instalado.

### 2.3 Validações executadas nesta auditoria

| Gate                            | Comando canônico                                                     | Resultado  | Job                                    |
| ------------------------------- | -------------------------------------------------------------------- | ---------- | -------------------------------------- |
| Typecheck estrito `src/copilot` | `npm run typecheck:strict:src.copilot`                               | **Passou** | `d1f18d16-54fe-4ad8-a29c-e71554743f52` |
| Lint Copilot                    | `npm run lint:copilot`                                               | **Passou** | `76a123bc-8faa-47f0-89f4-e852dca48491` |
| Unitários Copilot               | `npm run test:copilot:unit`                                          | **Passou** | `70fb8f55-fa01-4182-a01b-5b315b22775e` |
| Suíte MCP completa segura       | `node src/copilot/mcp/scripts/run-safe-validation-suite.js mcp-full` | **Passou** | `1e3bfea8-bfc4-40d2-a9ad-23a2f268f8e1` |

### 2.4 Superfície MCP observada

- Total de tools anunciadas: `102`.
- Read-only/idempotentes: `78`.
- Escrita limitada/bounded-write: `21`.
- Destrutivas: `3`.
- Open-world: `0`.
- OAuth ativo: `mode=oauth`, `enforcement=all`.
- Escopos iniciais: `repo:read`, `repo:write`, `repo:validate`, `repo:admin`.
- Protected Resource Metadata publicado para `https://mcp.aurelin.org` e
  `https://mcp.aurelin.org/mcp`.
- `mcp_runtime_health`: `ok`, com warnings vazios, mas com informações sobre worktree suja e 96
  artefatos `.ai/jobs` além da retenção.

### 2.5 Documentação oficial consultada

- MCP Specification 2025-06-18 — Transports: Streamable HTTP, Origin validation, session management,
  `MCP-Protocol-Version`, resumability e redelivery.
- MCP Specification 2025-06-18 — Authorization: OAuth 2.1, RFC 8414, RFC 7591, RFC 9728, Protected
  Resource Metadata e `WWW-Authenticate`.
- Cloudflare Tunnel run parameters: `--protocol auto|http2|quic`, fallback `auto` de QUIC para
  HTTP/2 e `--token-file` para túneis remotamente gerenciados.

---

## 3. Leitura arquitetural atual

### 3.1 Mapa de domínios

| Domínio          | Papel atual                                                                                              | Observação                                                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `sdk/`           | Adaptador local para Copilot SDK: client, sessão, lifecycle, hooks, telemetry, permissions, BYOK/config. | Já contém passthroughs de SDK 1.0, mas a superfície pública local ainda não cobre todos os recursos com métodos, schemas e testes dedicados. |
| `config/`        | Builders e configuração de sessão, custom agents, system prompt, MCP servers, BYOK e env.                | Forte centralização, porém builder ainda tem fallback permissivo e cobertura incompleta de campos recentes.                                  |
| `mcp/`           | Servidor MCP canônico do workspace, adapters HTTP/HTTP2/stdio, OAuth, Cloudflare, registry de tools.     | Muito maduro; principal gap é a decisão stateless frente a sessão/resume/redelivery do Streamable HTTP.                                      |
| `model-gateway/` | Catálogo, health, routing, probes, BYOK, adapters e elegibilidade de modelos/providers.                  | Amplo e ambicioso; há indício de migração incompleta no secret registry e risco de complexidade excessiva.                                   |
| `infra/io`       | I/O engine, locks, cache, índice, parser, search, diffs e sessão de escopo.                              | Uma das áreas críticas de performance. Runtime mostra L1 ativa, L2/L3 desabilitadas.                                                         |
| `terminal/`      | REPL/UX local, comandos, projections, bootstrap, state, BYOK UI.                                         | Rico, mas acumula comandos grandes e risco de acoplamento com model-gateway.                                                                 |
| `agent/`         | Facades, runtime contracts, sessão, contexto, delegação, orchestration.                                  | Bom isolamento por facades, mas depende de contratos SDK e tools bem fechados.                                                               |
| `observability/` | Logger, metrics, audit trail, error alerting e bootstrap.                                                | Métricas existem; oportunidade é conectar achados de compliance/roadmap a SLOs e budgets.                                                    |
| `events/`        | Schemas e EventBus.                                                                                      | Há indício de cobertura ampla; deve seguir como SSOT de eventos.                                                                             |
| `tools/`         | Tools locais e bridges para file/git/search/shell/todo.                                                  | Forte utilidade; precisa manter tool contracts e output schemas semanticamente estritos.                                                     |

### 3.2 Pontos fortes reais

1. **Validação verde em múltiplas camadas.** Typecheck, lint, unitários Copilot e suíte MCP completa
   passaram nesta auditoria.
2. **MCP com classificação de risco.** A superfície não expõe tools open-world; a maioria é
   read-only/idempotente.
3. **OAuth bem posicionado.** O perfil atual publica Protected Resource Metadata, authorization
   server metadata e challenge `WWW-Authenticate` compatível com o desenho MCP/OAuth moderno.
4. **HTTP adapter endurecido.** `http-shared.js` valida `Origin`, restringe CORS, exige `Accept`,
   valida `Content-Type`, aplica `no-store`, controla body size, rate-limit anônimo e rejeita bearer
   token na URI.
5. **Cloudflare operacional.** Runtime reporta túnel permanente `https://mcp.aurelin.org/mcp`,
   protocolo `quic`, smoke recente `ok`.
6. **Model-gateway existe como domínio próprio.** Catálogo, probes, routing, health, eligibility e
   adapters não estão espalhados aleatoriamente.
7. **Índice do workspace está ativo.** Search/index/symbol tooling está funcional e fresco.
8. **Apps SDK readiness positivo.** Há widget resource, CSP, frame domains e tools `search`/`fetch`
   de Company Knowledge read-only.

---

## 4. Bugs e riscos encontrados

### BUG-01 — Import relativo quebrado ou migração incompleta em `model-gateway/secrets`

**Severidade:** P1  
**Evidência:** `src/copilot/model-gateway/registry/env-byok-compat-importer.js` importa
`../secrets/env-secret-registry.js`. A árvore listada de `src/copilot/model-gateway` não mostra
diretório `secrets`, e o scanner de imports marcou o alvo
`src/copilot/model-gateway/secrets/env-secret-registry.js` como ausente. Além disso, adapters como
`openrouter-adapter.js` e `gemini-adapter.js` referenciam o mesmo módulo em JSDoc.

**Impacto provável:** fluxos BYOK/model-gateway que invocam `importConfiguredByokFromEnv()` podem
falhar em runtime, apesar de typecheck/lint passarem se a rota não for exercitada ou se
aliases/typings mascararem o problema.

**Correção proposta:** localizar a implementação real de `createEnvSecretRegistry`; mover/criar
`model-gateway/secrets/env-secret-registry.js` como owner explícito ou corrigir imports para o owner
real. Adicionar teste unitário que importe todos os barrels e importers do `model-gateway` em
ambiente isolado.

### BUG-02 — Scanner de imports gera falsos positivos em aliases `package.json#imports`

**Severidade:** P2  
**Evidência:** `repo_find_orphan_imports` marcou `#copilot/sdk/session-runtime`, `#copilot/sdk/di` e
`#copilot/sdk/agents` como órfãos. Porém `package.json` mapeia esses aliases para
`./src/copilot/sdk/session/runtime.js`, `./src/copilot/sdk/di-tokens.js` e
`./src/copilot/sdk/agent/index.js`.

**Impacto provável:** ruído em auditorias, risco de bloquear PRs corretos, e perda de confiança no
gate de imports. O achado do `model-gateway/secrets` é real/suspeito; os aliases são falsos
positivos do próprio detector.

**Correção proposta:** ensinar `repo_find_orphan_imports` a resolver `imports` do `package.json`,
incluindo subpaths `#copilot/*`, ou criar allowlist derivada automaticamente do mapa de imports.

### BUG-03 — Fallback implícito para `approveAll` em sessão SDK

**Severidade:** P1  
**Evidência:** `SessionConfigBuilder.build()`, `sanitizeResumeSessionConfig()` e
`buildSessionConfig()` preenchem `onPermissionRequest` com `approveAll` quando não fornecido; o
código loga warning, mas segue aprovando.

**Impacto provável:** em perfis de produção, testes de probes ou sessões com tools mutantes, a
ausência de handler explícito pode virar aprovação automática. Isso é perigoso porque permissões
deveriam falhar fechado, não aberto, exceto em perfil de desenvolvimento ou probe controlado.

**Correção proposta:** trocar default global por `denyByDefault` em perfis
`production`/`oauth`/`remote`, mantendo `approveAll` somente sob flag explícita
(`COPILOT_SDK_PERMISSION_FALLBACK=approve-all-dev`) e com métrica/audit event.

### BUG-04 — `CustomAgentConfig` local parece defasado frente à evolução do SDK 1.0

**Severidade:** P2  
**Evidência:** `config/custom-agents.js` e `core/schemas.js` validam campos como `name`,
`displayName`, `description`, `tools`, `toolTiers`, `prompt`, `mcpServers`, `infer`, `skills`,
`priority`. A busca por recursos recentes não encontrou cobertura local clara para campos como
`model`, `agentMode`, `displayPrompt` ou instruções runtime específicas de agente.

**Impacto provável:** recursos do SDK podem ser aceitos apenas por passthrough cru ou nem sequer
chegar às custom agents. Isso reduz capacidade de agentes especializados usarem modelos, modos e
prompts de exibição distintos.

**Correção proposta:** criar matriz `SDK_AGENT_CONTRACT_1_0` com campos aceitos, schemas Zod, testes
de snapshot e adapters de compatibilidade. Evitar aceitar campos invisíveis sem validação.

### BUG-05 — Streamable HTTP opera stateless por decisão explícita

**Severidade:** P2  
**Evidência:** `readMcpHttpSessionPolicy()` retorna `enabled: false` e justifica que sessões
stateful estão desabilitadas para preservar compatibilidade JSON-RPC com o SDK. `handleMcpRequest()`
cria novo `McpServer` e `StreamableHTTPServerTransport` por request com
`sessionIdGenerator: undefined` e `enableJsonResponse: true`.

**Impacto provável:** a implementação é pragmaticamente robusta para ChatGPT/Cloudflare no presente,
mas não implementa o ideal de `Mcp-Session-Id`, terminação por `DELETE`, cursor `Last-Event-ID`,
replay por stream e redelivery. Isso limita streaming avançado, notificações servidor→cliente e
recuperação de conexões interrompidas.

**Correção proposta:** manter stateless como default estável, mas criar uma faixa experimental
`stateful-transport-lab` com body tee seguro, session store com TTL, `Mcp-Session-Id`, replay buffer
por stream, teste de `Last-Event-ID` e rollback rápido.

### BUG-06 — Versão de protocolo MCP default à frente da especificação consultada

**Severidade:** P2  
**Evidência:** `http-shared.js` define `MCP_PROTOCOL_VERSION = '2025-11-25'` e suporta `2025-11-25`,
`2025-06-18`, `2025-03-26`. A documentação oficial consultada está em `2025-06-18`; a escolha pode
ser válida se antecipada pelo SDK/cliente, mas precisa de rastreabilidade documental.

**Impacto provável:** clientes estritos podem rejeitar versões não esperadas ou operar com fallback.
Sem documentação interna explicando o motivo da versão `2025-11-25`, há risco de regressões em
interop.

**Correção proposta:** adicionar ADR curta: “MCP protocol versions supported by server”, com fonte,
matriz de clientes testados, e teste que verifica comportamento para header ausente, inválido,
`2025-03-26`, `2025-06-18` e `2025-11-25`.

### BUG-07 — Worktree suja dificulta auditoria causal

**Severidade:** P2  
**Evidência:** `repo_status` apontou múltiplos arquivos modificados e untracked antes desta
auditoria, incluindo `infra/io`, `mcp/cloudflare`, `terminal` e testes.

**Impacto provável:** achados podem se misturar com mudanças em andamento; validações verdes podem
depender de worktree local não commitada; regressões podem ser atribuídas ao diagnóstico errado.

**Correção proposta:** antes de aplicar correções, classificar mudanças existentes em:
`intencionais`, `experimento`, `stale`, `não auditadas`. Criar branch ou commit checkpoint antes de
refactors.

---

## 5. Gaps arquiteturais e oportunidades de upgrade

### GAP-01 — Completude SDK 1.0 ainda não é produto local

Há bom trabalho de passthrough em `sdk/session/lifecycle.js` e whitelist em
`config/session-config.js`, incluindo `reasoningSummary`, `contextTier`, `largeOutput`,
`mcpOAuthTokenStorage`, `instructionDirectories`, `enableSessionStore`, `enableSkills`,
`remoteSession` e outros. Ainda assim, parte desses campos não tem:

- métodos fluent dedicados;
- schema Zod de validação;
- testes unitários por campo;
- documentação operacional;
- CLI/terminal projection;
- telemetria de uso;
- defaults por profile.

**Upgrade ideal:** transformar SDK 1.0 em matriz formal de contrato: `supported`, `passthrough`,
`blocked`, `experimental`, `deprecated`, com testes que falhem quando o contrato divergir.

### GAP-02 — Tool output schemas existem, mas precisam endurecer semanticamente

O status das tools reporta `hasOutputSchema=true`, porém o perfil de capabilities indica que a
estratégia ainda é “registry-wide minimal passthrough” e que schemas tool-specific são a próxima
faixa de hardening. Isso é aceitável para compatibilidade, mas insuficiente para agentes autônomos
fortes.

**Upgrade ideal:** cada tool crítica deve ter `inputSchema`, `outputSchema`, exemplos, erro tipado,
risk class, idempotência, audit event e contrato de redaction.

### GAP-03 — Model-gateway está poderoso, mas com risco de hipertrofia

`model-gateway` já tem catálogos, importers, probes, health, routing, selection audit, runtime
selector, account access e adapters. O diretório é valioso, mas contém arquivos muito grandes
(`sqlite-catalog-store.js`, `runtime-selector.js`, `policy-engine.js`, comandos BYOK no terminal), o
que aumenta custo cognitivo.

**Upgrade ideal:** separar `catalog-core`, `provider-adapters`, `runtime-routing`, `operator-ui` e
`health-ledger` com limites de dependência explícitos e testes por domínio.

### GAP-04 — MCP stateless sacrifica recursos avançados do Streamable HTTP

A implementação atual é coerente e segura, mas não entrega estado de sessão, resume, redelivery e
multi-stream server push como capacidade plena. O ideal é não quebrar o presente, e sim abrir
laboratório controlado.

**Upgrade ideal:** feature flag experimental, sem substituir default, com capacidade de medir
compatibilidade real com ChatGPT, Claude e clientes SDK.

### GAP-05 — Permissões precisam virar política positiva, não fallback

O projeto usa classificação de risco nas tools MCP, mas a sessão Copilot SDK local ainda pode
aprovar tudo por fallback. A decisão de permissão precisa ser declarativa, auditável e alinhada ao
perfil operacional.

**Upgrade ideal:** `PermissionPolicy` central com `deny`, `ask`, `allow-read`,
`allow-bounded-write-with-plan`, `never-destructive-without-confirmation`, e integração com
EventBus/audit.

### GAP-06 — Documentação abundante, mas sem índice canônico de estado atual

Há muitos documentos em `src/copilot/docs`, incluindo diagnósticos anteriores de
MCP/OAuth/Cloudflare e BYOK. Isso é bom historicamente, mas cria risco de “arqueologia documental”:
documentos antigos podem parecer atuais.

**Upgrade ideal:** `src/copilot/docs/INDEX.md` com status de cada diagnóstico: `current`,
`superseded`, `historical`, `runbook`, `ADR`, `roadmap`.

### GAP-07 — Performance I/O pronta para próxima camada, mas L2/L3 desligadas

`mcp_runtime_health` mostra L1 ativa, L2 desabilitada e L3 reservada para escala multi-runtime. O
hit ratio observado do aggregate estava baixo no momento da auditoria, mas amostra de uso não é
benchmark.

**Upgrade ideal:** benchmark canônico de workload real: repo tree, read file, search, symbol, import
scan, patch plan e validation dashboard. Só então habilitar L2 sob critério objetivo.

### GAP-08 — Cloudflare edge precisa permanecer governada por snapshots/gates

O projeto já tem edge audit, policy plan, diff, snapshot e backup. Como MCP HTTP exige `Accept`,
`no-store`, SSE potencial e OAuth discovery, cache/WAF/transform/rate-limit podem quebrar interop de
modo sutil.

**Upgrade ideal:** tratar Cloudflare como infraestrutura versionada: desired policy, diff, backup
obrigatório e post-change gates antes/depois de qualquer mutação.

---

## 6. Situação ideal

A situação ideal para `src/copilot` não é simplesmente “mais ferramentas”; é um runtime com
autonomia maior e superfície menor de ambiguidade:

1. **SDK contract completo:** todo campo relevante do Copilot SDK 1.0 é classificado, validado,
   testado, documentado ou explicitamente bloqueado.
2. **Permissões fail-closed:** nenhuma sessão com tools mutantes aprova por acidente; dev/probe é
   exceção explícita e auditada.
3. **MCP protocol-grade:** Streamable HTTP stateless continua como baseline, mas stateful/resumable
   existe em laboratório com métricas e testes reais.
4. **OAuth sem fricção e sem atalhos perigosos:** Protected Resource Metadata, Authorization Server
   Metadata, DCR, PKCE, token validation, scopes e challenge permanecem como gates.
5. **Cloudflare reproduzível:** túnel, DNS, edge rules, cache bypass e protocolos são auditados por
   snapshot/diff antes de mudar.
6. **Model gateway governado:** roteamento por capability/health/custo/latência, com provas de
   runtime e sem importers quebrados.
7. **Observabilidade por decisão:** cada decisão sensível — modelo, tool, permissão, Cloudflare,
   OAuth, filesystem — gera evento rastreável.
8. **Docs como sistema vivo:** docs atuais têm índice, status e owner; documentos históricos não
   competem com runbooks atuais.
9. **CI como contrato:** lint/typecheck/unit passam, mas também import-resolution, SDK-contract,
   MCP-protocol, OAuth-metadata e Cloudflare-desired-policy.

---

## 7. Roadmap complexo por faixas, fases e subfases

### Faixa 0 — Estabilização imediata e fechamento de evidência

**Objetivo:** remover riscos óbvios antes de ampliar capacidades.

#### Fase 0.1 — Classificar worktree

- **Subfase 0.1.1:** listar mudanças atuais e atribuir owner/intenção.
- **Subfase 0.1.2:** separar mudanças em branch/checkpoint.
- **Subfase 0.1.3:** decidir se untracked docs/testes entram no roadmap ou são descartados.
- **Critério de aceite:** `git status` compreensível; nenhuma correção feita sobre base ambígua.

#### Fase 0.2 — Corrigir import real de secret registry

- **Subfase 0.2.1:** localizar implementação real de `createEnvSecretRegistry`.
- **Subfase 0.2.2:** criar owner `model-gateway/secrets/env-secret-registry.js` ou corrigir imports.
- **Subfase 0.2.3:** adicionar teste “barrel/import all” para `model-gateway`.
- **Critério de aceite:** `repo_find_orphan_imports` sem import relativo quebrado real; runtime
  import do BYOK compat passa.

#### Fase 0.3 — Corrigir detector de imports

- **Subfase 0.3.1:** resolver `package.json#imports` no scanner.
- **Subfase 0.3.2:** adicionar fixture para `#copilot/sdk/session-runtime`, `#copilot/sdk/di`,
  `#copilot/sdk/agents`.
- **Subfase 0.3.3:** separar relatório entre `true orphan`, `alias unresolved by scanner`,
  `dynamic skipped`.
- **Critério de aceite:** falsos positivos não aparecem como bug de runtime.

#### Fase 0.4 — Revalidar baseline

- **Subfase 0.4.1:** `npm run typecheck:strict:src.copilot`.
- **Subfase 0.4.2:** `npm run lint:copilot`.
- **Subfase 0.4.3:** `npm run test:copilot:unit`.
- **Subfase 0.4.4:** `npm run copilot:mcp:safe-suite -- mcp-full`.
- **Critério de aceite:** todos verdes após correções.

---

### Faixa 1 — Contrato Copilot SDK 1.0 completo

**Objetivo:** transformar integração SDK em contrato explícito, não em compatibilidade difusa.

#### Fase 1.1 — Inventário formal de campos

- **Subfase 1.1.1:** criar `src/copilot/sdk/contract/sdk-1-contract.js`.
- **Subfase 1.1.2:** classificar campos por: client options, session config, resume config, provider
  config, custom agents, hooks, MCP Apps, remote sessions, skills, instructions.
- **Subfase 1.1.3:** marcar cada campo como `first-class`, `passthrough`, `unsupported`,
  `experimental`, `deprecated`.
- **Critério de aceite:** relatório gerado por teste mostra cobertura do contrato.

#### Fase 1.2 — Builder e sanitize completos

- **Subfase 1.2.1:** adicionar métodos fluent faltantes para `reasoningSummary`, `contextTier`,
  `largeOutput`, `mcpOAuthTokenStorage`, `instructionDirectories`, `pluginDirectories`,
  `enableSessionStore`, `enableSkills`, `remoteSession`, `enableMcpApps`, `enableFileHooks`,
  `enableHostGitOperations`.
- **Subfase 1.2.2:** separar `create` e `resume` onde campos diferirem.
- **Subfase 1.2.3:** impedir que campos desconhecidos passem silenciosamente fora do modo
  passthrough explícito.
- **Critério de aceite:** snapshots de `build()` e `sanitizeResumeSessionConfig()` cobrem todos os
  campos classificados.

#### Fase 1.3 — Custom agents 1.0

- **Subfase 1.3.1:** atualizar typedef e schema para campos recentes de agente, incluindo `model`,
  `agentMode`, `displayPrompt` se confirmados no contrato oficial/local.
- **Subfase 1.3.2:** adicionar validação de compatibilidade entre tools, modelo e modo.
- **Subfase 1.3.3:** permitir agents com modelo preferido, mas manter maestro com fallback seguro.
- **Critério de aceite:** cada agent builtin passa por schema estrito; campos desconhecidos falham
  com mensagem útil.

#### Fase 1.4 — Hooks e MCP tool interception

- **Subfase 1.4.1:** mapear hooks SDK usados e não usados.
- **Subfase 1.4.2:** criar hook policy para `preMcpToolCall`/equivalente se confirmado.
- **Subfase 1.4.3:** integrar hook a audit trail e permission policy.
- **Critério de aceite:** uma chamada de tool sensível gera decisão prévia, evento e métrica.

---

### Faixa 2 — Segurança de permissões e autonomia responsável

**Objetivo:** aumentar liberdade operacional sem aprovações implícitas perigosas.

#### Fase 2.1 — PermissionPolicy central

- **Subfase 2.1.1:** criar política declarativa por profile: `dev`, `test`, `production`,
  `oauth-remote`, `probe`.
- **Subfase 2.1.2:** substituir fallback `approveAll` por `denyByDefault` fora de dev/probe
  explícito.
- **Subfase 2.1.3:** emitir evento `permission.fallback_used` quando qualquer fallback ocorrer.
- **Critério de aceite:** ausência de `onPermissionRequest` em produção falha fechado.

#### Fase 2.2 — Harmonizar risco MCP e SDK

- **Subfase 2.2.1:** reutilizar risk classes MCP (`read-only`, `bounded-write`, `destructive`) em
  sessões SDK.
- **Subfase 2.2.2:** exigir plano/dry-run antes de mutação sempre que tool oferecer.
- **Subfase 2.2.3:** bloquear destrutivas sem confirmação explícita e contexto de usuário.
- **Critério de aceite:** mesma tool tem mesma semântica de risco em MCP, terminal e SDK.

#### Fase 2.3 — Auditoria de permissões

- **Subfase 2.3.1:** persistir decisões com hash de argumentos, não payload sensível integral.
- **Subfase 2.3.2:** criar dashboard de decisões por tool/model/session.
- **Subfase 2.3.3:** alertar sobre allow-all em janelas longas.
- **Critério de aceite:** auditor consegue explicar por que uma ação foi permitida.

---

### Faixa 3 — MCP protocol-grade e transporte

**Objetivo:** preservar o baseline stateless e explorar stateful/resumable com segurança.

#### Fase 3.1 — Documentar e testar stateless baseline

- **Subfase 3.1.1:** ADR para `sessionIdGenerator: undefined` e `enableJsonResponse: true`.
- **Subfase 3.1.2:** testes para `Accept`, `Content-Type`, `Origin`, body size, bearer na URI,
  rate-limit anônimo.
- **Subfase 3.1.3:** testes para `MCP-Protocol-Version` ausente/inválido/suportado.
- **Critério de aceite:** stateless é decisão explícita, não lacuna acidental.

#### Fase 3.2 — Lab stateful/resumable

- **Subfase 3.2.1:** feature flag `COPILOT_MCP_HTTP_STATEFUL_SESSIONS=experimental`.
- **Subfase 3.2.2:** session store com TTL, limite e cleanup.
- **Subfase 3.2.3:** `Mcp-Session-Id` no initialize e exigência posterior.
- **Subfase 3.2.4:** `DELETE /mcp` para terminar sessão ou `405` documentado.
- **Subfase 3.2.5:** replay buffer por stream com `Last-Event-ID`.
- **Critério de aceite:** compatibilidade medida contra ChatGPT/Claude/cliente SDK sem regressão no
  default.

#### Fase 3.3 — OAuth e metadata gates

- **Subfase 3.3.1:** smoke de `/.well-known/oauth-protected-resource` e `/mcp` path-specific.
- **Subfase 3.3.2:** validar `WWW-Authenticate` com `resource_metadata`.
- **Subfase 3.3.3:** testar DCR, PKCE S256, JWKS, refresh rotation e hash-only storage.
- **Critério de aceite:** falha de qualquer metadata crítica bloqueia release.

#### Fase 3.4 — Cloudflare edge como contrato

- **Subfase 3.4.1:** manter `quic`/`http2` policy documentada.
- **Subfase 3.4.2:** snapshot obrigatório antes de ruleset mutation.
- **Subfase 3.4.3:** desired policy para bypass de cache em `/mcp`, OAuth endpoints e
  SSE/event-stream.
- **Subfase 3.4.4:** post-change gates com smoke remoto e protocol headers.
- **Critério de aceite:** nenhuma mudança Cloudflare sem diff/backup/rollback.

---

### Faixa 4 — Model Gateway, BYOK e roteamento inteligente

**Objetivo:** tornar seleção de modelo/provedor confiável, verificável e barata.

#### Fase 4.1 — Sanear migração de secrets

- **Subfase 4.1.1:** resolver `createEnvSecretRegistry`.
- **Subfase 4.1.2:** padronizar referências de segredo por `ref`, nunca valor.
- **Subfase 4.1.3:** testes para OpenRouter/Gemini/Ollama/OpenAI-compatible adapters.
- **Critério de aceite:** adapters não dependem de módulo ausente e não expõem segredo.

#### Fase 4.2 — Contratos de provider/model

- **Subfase 4.2.1:** schema estrito para provider record e model record.
- **Subfase 4.2.2:** provenance obrigatória: `remote_catalog`, `docs_scrape`, `env_compat`,
  `manual_override`.
- **Subfase 4.2.3:** confidence obrigatória por capability.
- **Critério de aceite:** roteador sabe diferenciar fato verificado, heurística e fallback.

#### Fase 4.3 — Health e probes como ledger

- **Subfase 4.3.1:** probes text/json/streaming/vision/tools/reasoning.
- **Subfase 4.3.2:** backoff por provider/model/falha.
- **Subfase 4.3.3:** health mirror SQLite e dashboard terminal.
- **Critério de aceite:** roteamento não escolhe modelo quebrado sem justificar.

#### Fase 4.4 — Runtime selector policy

- **Subfase 4.4.1:** perfis de tarefa: audit, refactor, codegen, research, terminal, cheap,
  private-local.
- **Subfase 4.4.2:** ranking por capability, quota, custo, latência, health e privacidade.
- **Subfase 4.4.3:** explicação determinística da escolha.
- **Critério de aceite:** toda troca de modelo tem razão audível e rollback.

---

### Faixa 5 — Performance, IO e escala multi-runtime

**Objetivo:** reduzir latência sem sacrificar correção de leitura/escrita.

#### Fase 5.1 — Benchmark canônico

- **Subfase 5.1.1:** definir workloads: tree, read chunks, search text, symbol search, orphan
  imports, patch plan, validation dashboard.
- **Subfase 5.1.2:** capturar p50/p95/p99 e tamanho de resposta.
- **Subfase 5.1.3:** publicar dashboard `mcp_latency_dashboard` como gate de regressão.
- **Critério de aceite:** mudanças de cache são guiadas por métrica.

#### Fase 5.2 — L2 cache sob critério

- **Subfase 5.2.1:** habilitar L2 apenas se miss-rate/latência justificar.
- **Subfase 5.2.2:** invalidation por EventBus e hash.
- **Subfase 5.2.3:** teste de stale read em escrita concorrente.
- **Critério de aceite:** cache não retorna conteúdo antigo após patch/write.

#### Fase 5.3 — Worker pool e parser

- **Subfase 5.3.1:** budgets por tamanho/linhas/tempo.
- **Subfase 5.3.2:** fila adaptativa e backpressure.
- **Subfase 5.3.3:** fallback controlado quando parser falha.
- **Critério de aceite:** parser não derruba operações interativas.

#### Fase 5.4 — Multi-runtime L3

- **Subfase 5.4.1:** definir quando L3 é necessário.
- **Subfase 5.4.2:** escolher backend e modelo de invalidação.
- **Subfase 5.4.3:** testar dois runtimes MCP concorrentes.
- **Critério de aceite:** coerência entre processos ou L3 explicitamente desabilitado.

---

### Faixa 6 — Observabilidade, auditoria e governança

**Objetivo:** transformar estado operacional em conhecimento acionável.

#### Fase 6.1 — SLOs de runtime

- **Subfase 6.1.1:** SLO de disponibilidade do MCP.
- **Subfase 6.1.2:** SLO de latência por classe de tool.
- **Subfase 6.1.3:** SLO de validação pós-mudança.
- **Critério de aceite:** incidentes têm orçamento e severidade.

#### Fase 6.2 — Eventos como SSOT

- **Subfase 6.2.1:** mapear todos os eventos críticos.
- **Subfase 6.2.2:** garantir schema para cada evento.
- **Subfase 6.2.3:** manter compatibilidade evolutiva.
- **Critério de aceite:** dashboards e testes consomem os mesmos eventos.

#### Fase 6.3 — Redaction e dados sensíveis

- **Subfase 6.3.1:** revisar logs de Cloudflare debug, OAuth, provider headers, BYOK.
- **Subfase 6.3.2:** padronizar `secretRef`/hash em vez de valor.
- **Subfase 6.3.3:** fuzz tests de redaction.
- **Critério de aceite:** nenhum segredo aparece em logs, docs geradas ou audit trail.

#### Fase 6.4 — Docs vivas

- **Subfase 6.4.1:** criar `src/copilot/docs/INDEX.md`.
- **Subfase 6.4.2:** marcar docs antigas como `current`, `superseded`, `historical`, `runbook`,
  `ADR`.
- **Subfase 6.4.3:** cada roadmap deve apontar para gates e owners.
- **Critério de aceite:** leitor sabe qual documento seguir hoje.

---

### Faixa 7 — Developer Experience e autonomia para agentes

**Objetivo:** dar mais liberdade aos agentes sem aumentar caos operacional.

#### Fase 7.1 — Perfis de sessão

- **Subfase 7.1.1:** `dev-fast`, `audit-deep`, `prod-safe`, `cloudflare-maintenance`,
  `model-gateway-refresh`.
- **Subfase 7.1.2:** cada profile define tools, permissions, model policy, context tier e validation
  gates.
- **Subfase 7.1.3:** terminal e MCP expõem profile ativo.
- **Critério de aceite:** agente sabe o que pode fazer antes de operar.

#### Fase 7.2 — Golden prompts e approval friction

- **Subfase 7.2.1:** golden prompts para leitura, patch, validação, Cloudflare, OAuth, BYOK.
- **Subfase 7.2.2:** medir prompts de aprovação por workflow.
- **Subfase 7.2.3:** substituir sequências longas por tools plan/batch seguras.
- **Critério de aceite:** menos fricção sem reduzir segurança.

#### Fase 7.3 — Autonomy runner governado

- **Subfase 7.3.1:** missões allowlisted: diagnose, validate, maintenance, sdk-contract,
  model-gateway-health.
- **Subfase 7.3.2:** dry-run obrigatório para missões write-like.
- **Subfase 7.3.3:** relatório final com diffs, gates e rollback.
- **Critério de aceite:** automação longa é reproduzível e auditável.

---

## 8. Matriz de prioridades

| Prioridade | Item                                                    | Motivo                                        |
| ---------- | ------------------------------------------------------- | --------------------------------------------- |
| P1         | Resolver `model-gateway/secrets/env-secret-registry.js` | Possível falha runtime em BYOK/model-gateway. |
| P1         | Remover `approveAll` como fallback em produção          | Segurança e autonomia responsável.            |
| P2         | Corrigir falsos positivos de aliases no scanner         | Qualidade dos gates e confiança na auditoria. |
| P2         | Formalizar contrato SDK 1.0                             | Evita drift e passthrough invisível.          |
| P2         | ADR/testes para MCP stateless vs stateful               | Interoperabilidade e futuro Streamable HTTP.  |
| P2         | Tool-specific output schemas semânticos                 | Reduz erro de agentes e melhora integração.   |
| P2         | Docs indexadas por status                               | Evita decisões com documentos obsoletos.      |
| P3         | Limpeza de `.ai/jobs` além da retenção                  | Higiene operacional; não é bloqueante.        |

---

## 9. Gates recomendados por etapa

### Antes de qualquer correção

```bash
git status --short
npm run typecheck:strict:src.copilot
npm run lint:copilot
npm run test:copilot:unit
npm run copilot:mcp:safe-suite -- mcp-full
```

### Após mexer em SDK/config/agents

```bash
npm run typecheck:strict:src.copilot
npm run test:copilot:unit
npm run lint:copilot
```

Adicionar também testes específicos:

```bash
npx vitest --config vitest.copilot.config.js run tests/unit/copilot/sdk tests/unit/copilot/config tests/unit/copilot/contracts
```

### Após mexer em MCP/OAuth/Cloudflare

```bash
npm run copilot:mcp:safe-suite -- mcp-full
npm run copilot:mcp:oauth:smoke
npm run copilot:mcp:cloudflare:remote-audit
npm run copilot:mcp:cloudflare:edge-policy-diff
```

### Após mexer em model-gateway/BYOK

```bash
npm run typecheck:strict:src.copilot
npm run test:copilot:unit
# adicionar teste focused de importers/adapters/model-gateway
```

---

## 10. Plano de execução recomendado

### Próximas 48 horas

1. Congelar worktree em checkpoint.
2. Corrigir ou criar `model-gateway/secrets/env-secret-registry.js`.
3. Corrigir scanner de imports para `package.json#imports`.
4. Trocar fallback `approveAll` para política explícita em produção.
5. Rodar gates completos.

### Próximos 7 dias

1. Criar matriz de contrato SDK 1.0.
2. Atualizar schema de custom agents.
3. Criar ADR para MCP stateless.
4. Criar `docs/INDEX.md` com status documental.
5. Adicionar tests de protocol headers, OAuth metadata e permission fallback.

### Próximos 30 dias

1. Tool-specific output schemas semânticos para top 30 tools.
2. Model-gateway secret registry e provider adapters estabilizados.
3. Benchmarks de IO/index/latência.
4. Cloudflare desired policy com snapshot/diff/rollback obrigatório.
5. Dashboard de permissions/audit/model routing.

### Próximos 90 dias

1. Lab stateful/resumable MCP com `Mcp-Session-Id` e `Last-Event-ID`.
2. Runtime selector baseado em health/custo/quota/capability.
3. L2 cache sob SLO real.
4. Autonomy runner com missões complexas e rollback.
5. Release governance com SDK/MCP/Cloudflare drift detection.

---

## 11. Observações finais

O projeto não está “quebrado”; pelo contrário, está suficientemente sofisticado para que os
principais riscos agora sejam de contrato, segurança implícita e governança de evolução. A melhor
próxima etapa não é uma reescrita, mas uma sequência disciplinada de fechamento: imports reais,
permissões, contrato SDK, schemas, docs vivas e provas de protocolo.

A regra estratégica deve ser: **preservar o runtime verde, tornar explícito o que hoje é implícito,
e só então ampliar autonomia.**

---

## 12. Fontes externas consultadas

- Model Context Protocol Specification 2025-06-18 — Transports:
  `https://modelcontextprotocol.io/specification/2025-06-18/basic/transports`
- Model Context Protocol Specification 2025-06-18 — Authorization:
  `https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization`
- Cloudflare Tunnel run parameters:
  `https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/`
