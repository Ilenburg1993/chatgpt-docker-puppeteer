# Auditoria zero-base e correções — WORKSPACE MCP

**Data:** 2026-05-23
**Contexto:** nova auditoria completa após reinício do servidor MCP e correção de autenticação.
**Escopo:** tools MCP, OAuth, Cloudflare permanent tunnel, runtime health, smoke, index, validação, permissões e fricção operacional do ChatGPT sobre o repo.

---

## 1. Resumo executivo

A nova auditoria foi feita como zero-base, sem assumir que os bugs da auditoria anterior ainda existiam. O servidor reiniciado mostrou avanços relevantes:

- Autenticação MCP voltou a funcionar para chamadas reais após o ajuste externo de autenticação.
- HEAD observado: `1e515dfe feat(copilot-mcp): harden permanent tunnel readiness`.
- `mcp_tools_status` agora mostra **68 tools**.
- A superfície tem **50 tools read-only**, **16 bounded-write**, **2 destrutivas** e **0 open-world**.
- `mcp_runtime_health` agora considera o permanent tunnel como readiness principal e marca o quick tunnel temporário como fallback ignorado para readiness operacional.
- O index auto-build está ativo e concluído, com **998 arquivos**, **5779 símbolos**, **2390 imports** e **1541 chunks**.
- `mcp_last_validation_summary` agora inclui `effectiveChecks`, corrigindo a ambiguidade anterior em que um typecheck antigo falho obscurecia typecheck bem-sucedido dentro de suite.
- OAuth continua ativo em `mode=oauth`, `enforcement=all`, com issuer `https://mcp.aurelin.org` pronto.
- O permanent connector URL continua validado como `https://mcp.aurelin.org/mcp`.

A auditoria encontrou um gap remanescente pequeno porém real: `chatgpt_connector_current_url_status` ainda retornava `recovery` do quick tunnel temporário quando a URL permanente estava válida. Isso podia induzir o ChatGPT/usuário a reiniciar o quick tunnel desnecessariamente.

---

## 2. Alterações realizadas no repo

### 2.1. Arquivo alterado: `src/copilot/mcp/tools/connection.js`

Foi corrigido o handler da tool `chatgpt_connector_current_url_status`.

Antes, mesmo quando:

```text
source = permanent-config
validation.ok = true
currentUrl = https://mcp.aurelin.org/mcp
```

a resposta ainda incluía:

```text
recovery = temporaryTunnel.recovery
```

Ou seja, a tool continuava recomendando ações de recuperação do quick tunnel temporário obsoleto.

Agora o handler calcula:

```js
const permanentReady = source === 'permanent-config' && validation.ok === true;
```

E passa a retornar:

```js
temporaryTunnel: {
  ...temporaryTunnel,
  ignoredForOperationalReadiness: permanentReady,
},
permanentTunnel: {
  ...,
  ready: permanentReady,
},
recovery: permanentReady ? [] : temporaryTunnel.recovery,
```

Efeito prático:

- Quando o permanent tunnel está válido, `recovery` fica vazio.
- O quick tunnel temporário continua visível como diagnóstico/fallback, mas com `ignoredForOperationalReadiness: true`.
- `permanentTunnel.ready` explicita que o caminho principal está pronto.

### 2.2. Arquivo alterado: `tests/unit/copilot/mcp/test_mcp_tools.spec.js`

Foi ampliado o teste existente de `chatgpt_connector_current_url_status`.

O teste agora verifica que, quando a URL vem de `permanent-config` e a validação está OK:

```js
assert.deepEqual(result.structuredContent?.['recovery'], []);
assert.equal(result.structuredContent?.['permanentTunnel']?.['ready'], true);
assert.equal(result.structuredContent?.['temporaryTunnel']?.['ignoredForOperationalReadiness'], true);
```

Isso protege a correção contra regressão.

---

## 3. Auditoria zero-base realizada

### 3.1. Repo status

`repo_status` funcionou após o ajuste de autenticação.

Estado observado:

```text
branch: main
head: 1e515dfe
workspace dirty: true
```

Itens dirty existentes foram ignorados conforme instrução explícita, pois estão validados e prontos para commit/push pelo usuário.

### 3.2. Tools e metadados

`mcp_tools_status` retornou:

```text
totalTools: 68
readOnlyCount: 50
boundedWriteCount: 16
destructiveCount: 2
openWorldCount: 0
idempotentReadCount: 50
```

Tools destrutivas reportadas:

```text
repo_apply_file_batch
repo_remove_file
```

Observação: `repo_apply_file_batch` está marcada como destrutiva. Isso parece defensável porque uma batch pode incluir `remove_file`, `move_file` com overwrite ou operações múltiplas de alto impacto. Entretanto, ela deve continuar exigindo confirmação forte e cobertura de testes, especialmente para dry-run/limites/rollback.

### 3.3. OAuth

`mcp_auth_profile` confirmou:

```text
mode: oauth
enforcement: all
protectedResourceMetadataUrl: https://mcp.aurelin.org/.well-known/oauth-protected-resource
expectedAudience: https://mcp.aurelin.org
jwksUriConfigured: true
```

`mcp_oauth_issuer_diagnostics` confirmou:

```text
ready: true
issuer: https://mcp.aurelin.org
selectedMetadataUrl: https://mcp.aurelin.org/.well-known/oauth-authorization-server
PKCE S256: supported
repo scopes: present
client metadata document: ok
```

### 3.4. Tunnel permanente e Cloudflare

`mcp_runtime_health` mostrou:

```text
tunnel.mode: named-permanent
publicMcpUrl: https://mcp.aurelin.org/mcp
recommendedAction: use-permanent-hostname
lastSmokeOk: true
```

Também mostrou `temporaryFallbackTunnel.ignoredForOperationalReadiness = true`, o que confirma que o bug anterior no runtime principal já foi corrigido antes desta rodada.

A correção desta rodada aplicou a mesma lógica para `chatgpt_connector_current_url_status`.

### 3.5. Runtime health

`mcp_runtime_health` retornou `degraded` apenas por workspace dirty:

```text
warnings:
- Workspace has uncommitted or untracked changes.
critical: []
```

Como o usuário pediu para ignorar os dirty items, esse estado não foi tratado como problema operacional.

### 3.6. Smoke

`mcp_smoke_workspace` passou todos os checks funcionais e retornou `degraded` apenas por `WORKSPACE_DIRTY`.

Checks relevantes:

- repo status ok;
- repo tree ok;
- root redaction ok;
- secret read blocked ok;
- file read ok;
- file stats ok;
- text search ok;
- symbol search/usages ok;
- file outline ok;
- index status ok;
- project doctor ok;
- runtime health ok.

### 3.7. Index

`repo_index_status` confirmou auto-build ativo e concluído:

```text
available: true
files: 998
freshFiles: 998
symbols: 5779
imports: 2390
chunks: 1541
autoBuild.status: completed
autoBuild.config.path: src/copilot
```

Isso corrige o gap anterior de index vazio/sem auto-build.

### 3.8. Validação efetiva

`mcp_last_validation_summary` agora inclui `effectiveChecks`:

```text
typecheck: passed via suite-mcp-fast
unit-mcp: passed via suite-mcp-fast
lint: passed via lint
```

Isso corrige o problema anterior em que `typecheck` isolado antigo falho podia ser interpretado como estado efetivo atual.

---

## 4. Problemas operacionais encontrados durante a execução

### 4.1. Bloqueio host em validação real

A tentativa de rodar:

```text
mcp_run_safe_validation_suite suite=mcp-fast timeoutMs=180000
```

foi bloqueada pela camada ChatGPT/OpenAI antes de chegar ao MCP:

```text
Esta ferramenta foi bloqueada pelas configurações de segurança da OpenAI. Verifique novamente o que está enviando.
```

`mcp_host_block_diagnostics` classificou como:

```text
HOST_VALIDATION_JOB_BLOCK
severity: medium
recommendedAlternatives: mcp_validation_plan, mcp_last_validation_summary
mcpReachedServer: false
```

Impacto: a alteração foi aplicada no repo, mas não consegui executar a suíte real nesta sessão pelo host ChatGPT.

### 4.2. Bloqueios variáveis em reads após muitas chamadas

Também ocorreu bloqueio host em pelo menos uma chamada read-only posterior (`repo_search_text`) e uma chamada `git_diff`. Isso sugere fricção variável da camada ChatGPT mesmo com OAuth funcional e tools read-only anotadas.

Impacto: investigação continuou por chamadas alternativas, leitura direta e status tools.

### 4.3. Hot reload ausente

Após alterar `src/copilot/mcp/tools/connection.js`, a chamada runtime de `chatgpt_connector_current_url_status` ainda retornou a resposta antiga. O arquivo no repo foi confirmado com a alteração, mas o processo MCP ativo ainda estava com a versão carregada em memória.

Conclusão: para validar a alteração em runtime, será necessário reiniciar o processo MCP.

---

## 5. Gaps remanescentes

1. **Reiniciar MCP para validar a correção runtime** de `chatgpt_connector_current_url_status`.
2. **Rodar `mcp-fast` após restart**, preferencialmente fora da camada bloqueante do ChatGPT se o host continuar bloqueando validation jobs.
3. **Confirmar comportamento da nova `repo_apply_file_batch`** em dry-run e em casos de limite/erro parcial/rollback.
4. **Reduzir fricção host para validators**, talvez usando remember approval na UI ou uma tool read-only de “validation request manifest” ainda mais estreita.
5. **Manter `repo_apply_file_batch` como destrutiva** salvo se ela for dividida em duas tools: uma batch apenas não-destrutiva e outra destrutiva.

---

## 6. Próximos passos recomendados

Após reiniciar o MCP:

1. Chamar `chatgpt_connector_current_url_status` e confirmar:

```text
recovery: []
permanentTunnel.ready: true
temporaryTunnel.ignoredForOperationalReadiness: true
```

2. Rodar:

```text
mcp_smoke_workspace
mcp_last_validation_summary
mcp_run_safe_validation_suite suite=mcp-fast
```

3. Se `mcp_run_safe_validation_suite` for bloqueado novamente pelo host, rodar a validação localmente no terminal:

```bash
node src/copilot/mcp/scripts/run-safe-validation-suite.js mcp-fast
```

4. Considerar uma futura tool:

```text
mcp_validation_request_manifest
```

read-only, que gera um comando seguro e um hash de intenção para validação fora do host quando ChatGPT bloquear jobs.

---

## 7. Veredito

A nova auditoria zero-base mostra que os bugs principais anteriores foram majoritariamente corrigidos antes desta rodada. O sistema está em estado muito mais maduro:

- OAuth funcional;
- permanent tunnel estabilizado;
- runtime health mais coerente;
- index auto-build ativo;
- validation summary efetivo;
- smoke funcional;
- tool metadata forte;
- 0 open-world tools;
- e surface total ampliada para 68 tools.

A correção aplicada nesta rodada foi pontual e alinhada ao estado atual: remover recovery enganoso do quick tunnel em `chatgpt_connector_current_url_status` quando a URL permanente está válida. Também foi adicionada cobertura de teste para esse comportamento.

A única limitação relevante foi operacional: a camada ChatGPT/OpenAI bloqueou a validação real `mcp_run_safe_validation_suite`, e o MCP ativo não fez hot reload da alteração. Portanto, a alteração está aplicada no repo, mas sua validação runtime depende de restart do MCP e nova execução da suíte.

---

## 8. Continuação pós-restart — upgrades de fluidez operacional

Após o restart do MCP/Cloudflare, foi validado que a correção anterior carregou corretamente em runtime:

```text
chatgpt_connector_current_url_status.recovery = []
permanentTunnel.ready = true
temporaryTunnel.ignoredForOperationalReadiness = true
```

### 8.1. Problema operacional investigado

A tool `repo_apply_file_batch` é intencionalmente marcada como destrutiva, pois pode agrupar múltiplas operações de arquivo em uma chamada. Isso é correto do ponto de vista de segurança, mas reduz fluidez quando o ChatGPT só precisa planejar/validar uma batch.

Sintoma observado: chamadas envolvendo ferramentas destrutivas ou de validação continuam mais propensas a bloqueios pelo host ChatGPT/OpenAI, mesmo com OAuth funcional.

### 8.2. Upgrade implementado: `repo_apply_file_batch_plan`

Foi adicionada uma nova tool read-only no código:

```text
repo_apply_file_batch_plan
```

Objetivo:

- Validar e pré-visualizar batches de operações de arquivo sem modificar o workspace.
- Permitir ao ChatGPT planejar operações compostas usando uma tool read-only.
- Reduzir a necessidade de chamar `repo_apply_file_batch` apenas para dry-run.
- Diminuir prompts/bloqueios associados a tools destrutivas.

A nova tool usa o mesmo helper interno de preview da batch real:

```text
previewBatchFileOperation
```

E retorna:

```text
plannedTool: repo_apply_file_batch
dryRun: true
operationCount
operations
applied: []
nextCall.tool: repo_apply_file_batch
nextCall.args.dryRun: false
nextCall.args.confirmBatch: true
```

### 8.3. Arquivos alterados nesta continuação

```text
src/copilot/mcp/tools/repo-write.js
src/copilot/mcp/tools/meta.js
tests/unit/copilot/mcp/test_mcp_registry.spec.js
tests/unit/copilot/mcp/test_mcp_repo_write.spec.js
```

Mudanças:

- `repo-write.js`: adicionada a tool `repo_apply_file_batch_plan` antes de `repo_apply_file_batch`.
- `meta.js`: `CAPABILITIES_VERSION` atualizado para 14; `repo_apply_file_batch_plan` adicionada ao grupo read; guidance operacional atualizada para preferir plan tools antes de apply tools.
- `test_mcp_registry.spec.js`: lista esperada de tools atualizada.
- `test_mcp_repo_write.spec.js`: adicionado teste que confirma que `repo_apply_file_batch_plan` planeja sem criar arquivo.

### 8.4. Estado de runtime/discovery

Como a registry ativa é carregada no processo MCP, a nova tool só aparecerá em `list_resources`/discovery depois de novo restart do MCP.

Antes do próximo restart, o código já está no repo, mas a lista ativa ainda mostra apenas `repo_apply_file_batch`.

### 8.5. Próxima validação necessária

Após reiniciar o MCP novamente:

1. Verificar discovery:

```text
repo_apply_file_batch_plan deve aparecer na lista de tools.
```

2. Verificar `mcp_tools_status`:

```text
totalTools deve subir para 69
readOnlyCount deve subir para 51
CAPABILITIES_VERSION deve ser 14
```

3. Rodar validação, se o host permitir:

```text
mcp_run_safe_validation_suite suite=mcp-fast
```

Se o host bloquear, rodar localmente:

```bash
node src/copilot/mcp/scripts/run-safe-validation-suite.js mcp-fast
```

---

## 8. Continuação pós-restart — upgrades de fluidez operacional

Após o restart do MCP/Cloudflare, foi validado que a correção anterior carregou corretamente em runtime:

```text
chatgpt_connector_current_url_status.recovery = []
permanentTunnel.ready = true
temporaryTunnel.ignoredForOperationalReadiness = true
```

### 8.1. Problema operacional investigado

A tool `repo_apply_file_batch` é intencionalmente marcada como destrutiva, pois pode agrupar múltiplas operações de arquivo em uma chamada. Isso é correto do ponto de vista de segurança, mas reduz fluidez quando o ChatGPT só precisa planejar/validar uma batch.

Sintoma observado: chamadas envolvendo ferramentas destrutivas ou de validação continuam mais propensas a bloqueios pelo host ChatGPT/OpenAI, mesmo com OAuth funcional.

### 8.2. Upgrade implementado: `repo_apply_file_batch_plan`

Foi adicionada uma nova tool read-only no código:

```text
repo_apply_file_batch_plan
```

Objetivo:

- Validar e pré-visualizar batches de operações de arquivo sem modificar o workspace.
- Permitir ao ChatGPT planejar operações compostas usando uma tool read-only.
- Reduzir a necessidade de chamar `repo_apply_file_batch` apenas para dry-run.
- Diminuir prompts/bloqueios associados a tools destrutivas.

A nova tool usa o mesmo helper interno de preview da batch real:

```text
previewBatchFileOperation
```

E retorna:

```text
plannedTool: repo_apply_file_batch
dryRun: true
operationCount
operations
applied: []
nextCall.tool: repo_apply_file_batch
nextCall.args.dryRun: false
nextCall.args.confirmBatch: true
```

### 8.3. Arquivos alterados nesta continuação

```text
src/copilot/mcp/tools/repo-write.js
src/copilot/mcp/tools/meta.js
tests/unit/copilot/mcp/test_mcp_registry.spec.js
tests/unit/copilot/mcp/test_mcp_repo_write.spec.js
```

Mudanças:

- `repo-write.js`: adicionada a tool `repo_apply_file_batch_plan` antes de `repo_apply_file_batch`.
- `meta.js`: `CAPABILITIES_VERSION` atualizado para 14; `repo_apply_file_batch_plan` adicionada ao grupo read; guidance operacional atualizada para preferir plan tools antes de apply tools.
- `test_mcp_registry.spec.js`: lista esperada de tools atualizada.
- `test_mcp_repo_write.spec.js`: adicionado teste que confirma que `repo_apply_file_batch_plan` planeja sem criar arquivo.

### 8.4. Estado de runtime/discovery

Como a registry ativa é carregada no processo MCP, a nova tool só aparecerá em `list_resources`/discovery depois de novo restart do MCP.

Antes do próximo restart, o código já está no repo, mas a lista ativa ainda mostra apenas `repo_apply_file_batch`.

### 8.5. Próxima validação necessária

Após reiniciar o MCP novamente:

1. Verificar discovery:

```text
repo_apply_file_batch_plan deve aparecer na lista de tools.
```

2. Verificar `mcp_tools_status`:

```text
totalTools deve subir para 69
readOnlyCount deve subir para 51
CAPABILITIES_VERSION deve ser 14
```

3. Rodar validação, se o host permitir:

```text
mcp_run_safe_validation_suite suite=mcp-fast
```

Se o host bloquear, rodar localmente:

```bash
node src/copilot/mcp/scripts/run-safe-validation-suite.js mcp-fast
```

---

## 8. Continuação pós-restart — upgrades de fluidez operacional

Após o restart do MCP/Cloudflare, foi validado que a correção anterior carregou corretamente em runtime:

```text
chatgpt_connector_current_url_status.recovery = []
permanentTunnel.ready = true
temporaryTunnel.ignoredForOperationalReadiness = true
```

### 8.1. Problema operacional investigado

A tool `repo_apply_file_batch` é intencionalmente marcada como destrutiva, pois pode agrupar múltiplas operações de arquivo em uma chamada. Isso é correto do ponto de vista de segurança, mas reduz fluidez quando o ChatGPT só precisa planejar/validar uma batch.

Sintoma observado: chamadas envolvendo ferramentas destrutivas ou de validação continuam mais propensas a bloqueios pelo host ChatGPT/OpenAI, mesmo com OAuth funcional.

### 8.2. Upgrade implementado: `repo_apply_file_batch_plan`

Foi adicionada uma nova tool read-only no código:

```text
repo_apply_file_batch_plan
```

Objetivo:

- Validar e pré-visualizar batches de operações de arquivo sem modificar o workspace.
- Permitir ao ChatGPT planejar operações compostas usando uma tool read-only.
- Reduzir a necessidade de chamar `repo_apply_file_batch` apenas para dry-run.
- Diminuir prompts/bloqueios associados a tools destrutivas.

A nova tool usa o mesmo helper interno de preview da batch real:

```text
previewBatchFileOperation
```

E retorna:

```text
plannedTool: repo_apply_file_batch
dryRun: true
operationCount
operations
applied: []
nextCall.tool: repo_apply_file_batch
nextCall.args.dryRun: false
nextCall.args.confirmBatch: true
```

### 8.3. Arquivos alterados nesta continuação

```text
src/copilot/mcp/tools/repo-write.js
src/copilot/mcp/tools/meta.js
tests/unit/copilot/mcp/test_mcp_registry.spec.js
tests/unit/copilot/mcp/test_mcp_repo_write.spec.js
```

Mudanças:

- `repo-write.js`: adicionada a tool `repo_apply_file_batch_plan` antes de `repo_apply_file_batch`.
- `meta.js`: `CAPABILITIES_VERSION` atualizado para 14; `repo_apply_file_batch_plan` adicionada ao grupo read; guidance operacional atualizada para preferir plan tools antes de apply tools.
- `test_mcp_registry.spec.js`: lista esperada de tools atualizada.
- `test_mcp_repo_write.spec.js`: adicionado teste que confirma que `repo_apply_file_batch_plan` planeja sem criar arquivo.

### 8.4. Estado de runtime/discovery

Como a registry ativa é carregada no processo MCP, a nova tool só aparecerá em `list_resources`/discovery depois de novo restart do MCP.

Antes do próximo restart, o código já está no repo, mas a lista ativa ainda mostra apenas `repo_apply_file_batch`.

### 8.5. Próxima validação necessária

Após reiniciar o MCP novamente:

1. Verificar discovery:

```text
repo_apply_file_batch_plan deve aparecer na lista de tools.
```

2. Verificar `mcp_tools_status`:

```text
totalTools deve subir para 69
readOnlyCount deve subir para 51
CAPABILITIES_VERSION deve ser 14
```

3. Rodar validação, se o host permitir:

```text
mcp_run_safe_validation_suite suite=mcp-fast
```

Se o host bloquear, rodar localmente:

```bash
node src/copilot/mcp/scripts/run-safe-validation-suite.js mcp-fast
```

---

## 8. Continuação pós-restart — upgrades de fluidez operacional

Após o restart do MCP/Cloudflare, foi validado que a correção anterior carregou corretamente em runtime:

```text
chatgpt_connector_current_url_status.recovery = []
permanentTunnel.ready = true
temporaryTunnel.ignoredForOperationalReadiness = true
```

### 8.1. Problema operacional investigado

A tool `repo_apply_file_batch` é intencionalmente marcada como destrutiva, pois pode agrupar múltiplas operações de arquivo em uma chamada. Isso é correto do ponto de vista de segurança, mas reduz fluidez quando o ChatGPT só precisa planejar/validar uma batch.

Sintoma observado: chamadas envolvendo ferramentas destrutivas ou de validação continuam mais propensas a bloqueios pelo host ChatGPT/OpenAI, mesmo com OAuth funcional.

### 8.2. Upgrade implementado: `repo_apply_file_batch_plan`

Foi adicionada uma nova tool read-only no código:

```text
repo_apply_file_batch_plan
```

Objetivo:

- Validar e pré-visualizar batches de operações de arquivo sem modificar o workspace.
- Permitir ao ChatGPT planejar operações compostas usando uma tool read-only.
- Reduzir a necessidade de chamar `repo_apply_file_batch` apenas para dry-run.
- Diminuir prompts/bloqueios associados a tools destrutivas.

A nova tool usa o mesmo helper interno de preview da batch real:

```text
previewBatchFileOperation
```

E retorna:

```text
plannedTool: repo_apply_file_batch
dryRun: true
operationCount
operations
applied: []
nextCall.tool: repo_apply_file_batch
nextCall.args.dryRun: false
nextCall.args.confirmBatch: true
```

### 8.3. Arquivos alterados nesta continuação

```text
src/copilot/mcp/tools/repo-write.js
src/copilot/mcp/tools/meta.js
tests/unit/copilot/mcp/test_mcp_registry.spec.js
tests/unit/copilot/mcp/test_mcp_repo_write.spec.js
```

Mudanças:

- `repo-write.js`: adicionada a tool `repo_apply_file_batch_plan` antes de `repo_apply_file_batch`.
- `meta.js`: `CAPABILITIES_VERSION` atualizado para 14; `repo_apply_file_batch_plan` adicionada ao grupo read; guidance operacional atualizada para preferir plan tools antes de apply tools.
- `test_mcp_registry.spec.js`: lista esperada de tools atualizada.
- `test_mcp_repo_write.spec.js`: adicionado teste que confirma que `repo_apply_file_batch_plan` planeja sem criar arquivo.

### 8.4. Estado de runtime/discovery

Como a registry ativa é carregada no processo MCP, a nova tool só aparecerá em `list_resources`/discovery depois de novo restart do MCP.

Antes do próximo restart, o código já está no repo, mas a lista ativa ainda mostra apenas `repo_apply_file_batch`.

### 8.5. Próxima validação necessária

Após reiniciar o MCP novamente:

1. Verificar discovery:

```text
repo_apply_file_batch_plan deve aparecer na lista de tools.
```

2. Verificar `mcp_tools_status`:

```text
totalTools deve subir para 69
readOnlyCount deve subir para 51
CAPABILITIES_VERSION deve ser 14
```

3. Rodar validação, se o host permitir:

```text
mcp_run_safe_validation_suite suite=mcp-fast
```

Se o host bloquear, rodar localmente:

```bash
node src/copilot/mcp/scripts/run-safe-validation-suite.js mcp-fast
```

---

## 9. Continuação pós-reconexão — melhorias de conexão e smoke freshness

Após uma nova reconexão de autenticação, foi retomada a correção que havia sido interrompida por `401: Reauthentication required`.

### 9.1. Problema identificado

O permanent tunnel podia ter `lastSmokeOk=true`, mas o smoke do conector estar antigo. Isso é sutil: um smoke antigo pode parecer suficiente para dizer que a conexão está saudável, mesmo depois de mudanças em DNS, Cloudflare, OAuth, rota `/mcp` ou restart do servidor.

Estado observado nesta rodada:

```text
permanentTunnel.lastSmoke.ok = true
lastSmokeAgeMinutes ~= 77
```

Esse valor ainda era reportado como OK, sem sinal explícito de frescor.

### 9.2. Upgrade implementado em `runtime-health.js`

Foi adicionado:

```js
const CONNECTOR_SMOKE_STALE_AFTER_MINUTES = 60;
```

E `mcp_runtime_health` agora gera warning quando o último smoke da Cloudflare/connector está OK, mas antigo demais:

```text
Cloudflare connector smoke is <N> minutes old; refresh smoke after tunnel, auth or DNS changes.
```

Isso evita uma falsa sensação de saúde após mudanças de conexão.

### 9.3. Upgrade implementado em `tunnel-status.js`

Foi adicionado também:

```js
const CONNECTOR_SMOKE_STALE_AFTER_MINUTES = 60;
```

E `mcp_tunnel_status.permanentTunnel` agora expõe:

```text
lastSmokeFresh: boolean
lastSmokeStaleAfterMinutes: 60
```

Assim o ChatGPT pode distinguir:

```text
lastSmoke.ok = true
```

de:

```text
lastSmokeFresh = true/false
```

### 9.4. Teste atualizado

Foi atualizado o teste de `mcp_tunnel_status` em:

```text
tests/unit/copilot/mcp/test_mcp_tools.spec.js
```

Agora ele verifica:

```js
typeof permanentTunnel.lastSmokeFresh === 'boolean'
permanentTunnel.lastSmokeStaleAfterMinutes === 60
```

### 9.5. Impacto esperado

Essas mudanças reduzem problemas silenciosos de conexão porque o status passa a mostrar quando um smoke antigo deve ser refeito. Isso ajuda especialmente após:

- restart do MCP;
- reconexão OAuth;
- alteração de Cloudflare tunnel;
- troca de DNS/hostname;
- alterações em auth mode/scopes;
- suspeita de rota stale no ChatGPT connector.
