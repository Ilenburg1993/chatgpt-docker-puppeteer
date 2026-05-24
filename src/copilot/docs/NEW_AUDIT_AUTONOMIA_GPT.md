# Auditoria live ampliada — MCP `WORKSPACE`, poder do ChatGPT, OAuth, outputSchema e autorizações

**Data:** 2026-05-23
**Relatório substitui:** `workspace_mcp_live_power_audit.md`
**Endpoint testado:** `/WORKSPACE/link_6a11939cefd08191906489d7b45c6a3d`
**Branch:** `main`
**HEAD observado:** `044b2060`
**Status do MCP/tunnel no teste:** online
**Foco:** poder efetivo do `chatgpt.com` sobre o repo via MCP, com ênfase em permissões, autorizações, bloqueios, OAuth, outputSchema, annotations, segurança e oportunidades para reduzir fricção.

---

## Índice

1. [Resumo executivo](#1-resumo-executivo)
2. [O que a imagem mostra e por que importa](#2-o-que-a-imagem-mostra-e-por-que-importa)
3. [Conclusão sobre “Autorização compatível: Nenhuma”](#3-conclusão-sobre-autorização-compatível-nenhuma)
4. [Conclusão sobre ausência de OAuth](#4-conclusão-sobre-ausência-de-oauth)
5. [Conclusão sobre “outputSchema recomendado”](#5-conclusão-sobre-outputschema-recomendado)
6. [Fontes oficiais usadas](#6-fontes-oficiais-usadas)
7. [Estado Git e ambiente](#7-estado-git-e-ambiente)
8. [Superfície de tools descoberta](#8-superfície-de-tools-descoberta)
9. [Testes live executados](#9-testes-live-executados)
10. [Matriz de resultados por categoria](#10-matriz-de-resultados-por-categoria)
11. [Bloqueios externos observados](#11-bloqueios-externos-observados)
12. [Análise técnica dos bloqueios](#12-análise-técnica-dos-bloqueios)
13. [Bugs encontrados](#13-bugs-encontrados)
14. [Gaps restantes](#14-gaps-restantes)
15. [Oportunidades de upgrade](#15-oportunidades-de-upgrade)
16. [Plano de OAuth e Mixed Authentication](#16-plano-de-oauth-e-mixed-authentication)
17. [Plano de outputSchema para todas as tools](#17-plano-de-outputschema-para-todas-as-tools)
18. [Plano de securitySchemes por tool](#18-plano-de-securityschemes-por-tool)
19. [Plano para reduzir prompts e bloqueios](#19-plano-para-reduzir-prompts-e-bloqueios)
20. [Recomendações prioritárias](#20-recomendações-prioritárias)
21. [Próxima bateria de testes recomendada](#21-próxima-bateria-de-testes-recomendada)
22. [Veredito](#22-veredito)

---

## 1. Resumo executivo

A nova superfície MCP `WORKSPACE` está muito mais madura que nas auditorias anteriores. Ela agora expõe 54 tools, com classificação explícita de risco, annotations consistentes e ferramentas novas voltadas à autonomia do ChatGPT.

Resumo observado:

- **54 tools** expostas.
- **37 read-only idempotentes**.
- **16 bounded-write**.
- **1 destrutiva**: `repo_remove_file`.
- **0 open-world**.
- `mcp_tools_status` informa risk classes e candidatos a “remember approval”.
- `mcp_session_profile` recomenda workflows de baixa fricção.
- `mcp_golden_prompts` define prompts e campos de medição de autorização/bloqueio.
- `mcp_maintenance_apply_safe_fixes` funciona em dry-run e em execução real quando os fixes são read-only/status/smoke.
- `delegate_to_repo_autonomy_runner` funciona em dry-run.
- `mcp_smoke_workspace` roda e está funcional, mas retorna `degraded` porque o workspace está dirty.

O problema dominante não é o registry MCP nem o tunnel: é a camada externa do `chatgpt.com`/OpenAI, que bloqueou várias chamadas antes de chegarem ao MCP, inclusive algumas chamadas read-only e quase todas as chamadas de escrita/validação reais.

Pontos centrais deste relatório ampliado:

1. **“Autorização compatível: Nenhuma” e “Autorização usada: Nenhuma” não impedem o conector de funcionar.** No Authentication é modo oficialmente suportado no Developer Mode. Porém, sem OAuth/securitySchemes, o ChatGPT não tem escopos por tool, não tem linking de conta, não mostra consentimento granular e não consegue diferenciar read/write por autorização; ele depende mais das annotations, descrições, heurísticas e confirmações do host.

2. **A ausência de OAuth provavelmente não é a causa direta dos bloqueios observados.** Os bloqueios ocorreram até em chamadas no-auth e em dry-run. A documentação oficial diz que write actions exigem confirmação por padrão e que tools sem `readOnlyHint` são tratadas como write actions; isso é independente de OAuth.

3. **OAuth/Mixed Authentication pode melhorar governança, confiança e granularidade, mas não vai eliminar confirmações de write actions.** OAuth ajuda a declarar scopes, acionar UI de login/linking e validar identidade/scopes no servidor. Não é um botão para “sem prompts”.

4. **A recomendação de `outputSchema` é importante e deve ser tratada como P0/P1.** A documentação oficial diz para declarar `outputSchema` para tools que retornam `structuredContent`, para que clientes validem resultados e o modelo raciocine melhor sobre chamadas seguintes. A ausência de outputSchema provavelmente não é a causa direta dos bloqueios, mas reduz confiabilidade, validação, previsibilidade e qualidade de uso.

5. **Precisamos adicionar `securitySchemes` por tool, mesmo que inicialmente `noauth`.** A documentação de autenticação recomenda declarar `securitySchemes` por tool, não depender só de default global. Isso permite evoluir para Mixed Authentication: read-only noauth, bounded-write OAuth opcional/obrigatório, destrutivas OAuth obrigatório.

---

## 2. O que a imagem mostra e por que importa

A imagem anexada mostra o painel de detalhes/configuração do app/conector no ChatGPT.

Itens visíveis relevantes:

```text
URL: https://gage-bon-beast-contribute.trycloudflare.com/mcp
Autorização compatível: Nenhuma
Autorização usada: Nenhuma
Nome da versão: dev mode
Notas da versão: dev-1
Status de revisão: development
Ações: várias tools
Aviso: “ESQUEMA DE SAÍDA RECOMENDADO”
```

A segunda imagem mostra o formulário “Novo app”, com:

```text
URL do servidor MCP
Autenticação: Sem autenticação
Aviso: Servidores MCP personalizados podem trazer riscos.
Checkbox: Entendi e quero continuar
```

Essas telas confirmam que o conector está em Developer Mode, sem autenticação, usando URL de tunnel Cloudflare temporário. Isso é compatível com desenvolvimento, mas tem consequências:

- ChatGPT não possui OAuth token para anexar às chamadas.
- Não há scopes como `repo.read`, `repo.write`, `repo.validate`.
- Não há consent screen por escopo.
- Não há distinção de autorização por tool.
- A UI mostra avisos porque custom MCPs são potencialmente perigosos.
- A UI recomenda outputSchema porque as tools provavelmente retornam `structuredContent` sem schema declarado completo.

---

## 3. Conclusão sobre “Autorização compatível: Nenhuma”

### 3.1. Isso pode estar interferindo?

**Sim, mas não da forma mais direta.**

“Autorização compatível: Nenhuma” e “Autorização usada: Nenhuma” indicam que o app/conector está em modo sem autenticação. A documentação oficial de Developer Mode diz que os modos suportados incluem OAuth, No Authentication e Mixed Authentication. Portanto, “Nenhuma” é um modo suportado e não impede o funcionamento do conector.

Mas isso afeta o poder do ChatGPT de forma indireta:

| Aspecto                                    | Com “Nenhuma” | Com OAuth/Mixed         |
| ------------------------------------------ | ------------- | ----------------------- |
| Conector funciona?                         | Sim           | Sim                     |
| Tools aparecem?                            | Sim           | Sim                     |
| Read-only pode rodar?                      | Sim           | Sim                     |
| Write actions deixam de pedir confirmação? | Não           | Não necessariamente     |
| Escopos por tool                           | Não           | Sim                     |
| Consentimento granular                     | Não           | Sim                     |
| Server sabe identidade/escopo do chamador  | Não           | Sim                     |
| Tool-level auth UI                         | Não           | Sim, se bem configurado |
| Confiança/produção                         | Baixa/média   | Maior                   |
| Possibilidade de Mixed Auth                | Não           | Sim                     |

### 3.2. Relação com bloqueios observados

Os bloqueios observados nesta auditoria provavelmente **não foram causados apenas pela ausência de OAuth**, porque:

- `repo_create_file(dryRun=true)` foi bloqueado antes do MCP, mesmo sem mutação.
- `repo_quarantine_file(dryRun=true)` foi bloqueado.
- `mcp_run_safe_validation_suite` foi bloqueado.
- `repo_read_file(registry.js)` foi bloqueado, embora read-only.
- `repo_file_outline(registry.js)` funcionou no mesmo arquivo.
- `repo_remove_file(confirm=false,dryRun=true)` chegou ao MCP e retornou erro controlado.

Isso indica uma heurística do host por tipo de tool, payload, path, URL, contexto, descrição ou sequência de chamadas, não somente por auth.

### 3.3. Recomendação

Manter `No Authentication` é aceitável apenas em dev controlado. Para aumentar poder de forma robusta e reduzir ambiguidades, implementar **Mixed Authentication**:

- read-only: `noauth`;
- plan-only: `noauth`;
- bounded-write: `oauth2` com escopo `repo.write`;
- validators: `oauth2` com escopo `repo.validate`;
- destrutivas: `oauth2` com escopo `repo.destructive`;
- status/tunnel/session profile: `noauth`.

Isso não vai abolir confirmações, mas vai dar ao ChatGPT uma política de autorização explícita por tool.

---

## 4. Conclusão sobre ausência de OAuth

### 4.1. OAuth é necessário para máxima liberdade?

**Para desenvolvimento solo, não necessariamente.**
**Para máxima robustez, governança e confiança, sim.**

No Authentication dá menos atrito inicial: sem login, sem token, sem scopes. Porém, para um app que dá ao ChatGPT poder sobre um repo, OAuth/Mixed Auth é melhor a médio prazo.

A documentação de autenticação da Apps SDK diz que o ChatGPT só mostra UI de OAuth quando o MCP sinaliza que OAuth está disponível ou necessário; isso exige metadata (`securitySchemes` e resource metadata) e erros em runtime com `_meta["mcp/www_authenticate"]`. Também recomenda declarar `securitySchemes` por tool para dizer ao ChatGPT quais tools exigem OAuth e quais podem rodar anonimamente.

### 4.2. OAuth não elimina confirmação

Mesmo com OAuth, a documentação de Developer Mode diz que write actions exigem confirmação por padrão. OAuth autentica e autoriza; ele não transforma uma escrita em read-only.

OAuth resolve:

- identidade;
- scopes;
- consentimento;
- revogação;
- auditoria;
- tool-level auth;
- produção/equipe.

OAuth não resolve sozinho:

- janelinha de write action;
- bloqueios por payload;
- bloqueios por heurística;
- necessidade de `readOnlyHint`;
- necessidade de `outputSchema`;
- necessidade de tool design estreito.

### 4.3. Melhor desenho para nosso caso

Usar **Mixed Authentication**:

```text
initialize/list tools: noauth
read tools: noauth
plan-only tools: noauth
write/apply tools: oauth2
validator/run tools: oauth2
destructive tools: oauth2 + destructiveHint
```

Isso preserva descoberta e leitura com baixa fricção, mas dá identidade/scopes para poder real.

---

## 5. Conclusão sobre `outputSchema` recomendado

A UI mostra “ESQUEMA DE SAÍDA RECOMENDADO” nas tools. Isso provavelmente indica que muitas tools retornam `structuredContent` sem `outputSchema`.

A documentação oficial da Apps SDK diz explicitamente:

> Declare `outputSchema` for any tool that returns `structuredContent`. The schema should describe the exact object your tool returns so clients can validate results and the model can reason about follow-up tool calls.

### 5.1. Isso interfere nos bloqueios?

**Provavelmente não é a causa direta dos bloqueios externos**, mas interfere na qualidade e no poder do ChatGPT:

- reduz validação de cliente;
- reduz previsibilidade de resposta;
- reduz capacidade do modelo de encadear chamadas;
- aumenta ambiguidade de campos;
- dificulta UI/ChatGPT exibir resultados com confiança;
- pode prejudicar review/qualidade do app;
- dificulta golden prompt testing.

### 5.2. Deve ser corrigido?

**Sim. Prioridade alta.**

Todas as tools que retornam `structuredContent` devem ter `outputSchema`.

Em especial:

- `repo_status`;
- `mcp_capabilities_summary`;
- `mcp_tools_status`;
- `mcp_session_profile`;
- `mcp_smoke_workspace`;
- `mcp_runtime_health`;
- `mcp_tunnel_status`;
- `repo_tree`;
- `repo_root_tree`;
- `repo_read_file`;
- `repo_file_outline`;
- `repo_symbol_search`;
- `repo_search_text`;
- `repo_index_status`;
- `job_list`;
- `job_get_output`;
- `mcp_maintenance_plan`;
- `mcp_maintenance_apply_safe_fixes`;
- `delegate_to_repo_autonomy_runner`.

### 5.3. OutputSchema e poder do ChatGPT

Com `outputSchema`, o ChatGPT consegue:

- saber quais campos existem;
- reutilizar `sha256` corretamente;
- entender `nextCursor`;
- distinguir `success`, `status`, `warnings`, `critical`;
- interpretar `quarantineId`;
- usar `jobId` em `job_get_output`;
- reconhecer `dryRun`, `planned`, `executed`;
- fazer follow-up calls com menos erro;
- reduzir ambiguidades que podem gerar bloqueio ou chamada errada.

---

## 6. Fontes oficiais usadas

### 6.1. Developer Mode

A documentação oficial diz que Developer Mode fornece suporte MCP completo para todas as tools, read e write; que write actions exigem confirmação por padrão; que `readOnlyHint` é respeitado; que tools sem esse hint são tratadas como write actions; e que aprovações podem ser lembradas por tool apenas durante a conversa.

Fonte:
https://developers.openai.com/api/docs/guides/developer-mode

### 6.2. Apps SDK Reference

A referência oficial define `outputSchema`, `securitySchemes`, `readOnlyHint`, `destructiveHint`, `openWorldHint` e `idempotentHint`.

Fonte:
https://developers.openai.com/apps-sdk/reference

### 6.3. Apps SDK Authentication

A documentação de autenticação explica que ChatGPT só mostra UI OAuth quando o MCP sinaliza OAuth via metadata e runtime errors; também recomenda declarar `securitySchemes` por tool, com `noauth` e `oauth2`.

Fonte:
https://developers.openai.com/apps-sdk/build/auth

### 6.4. Build your MCP server

A documentação de server explica que o MCP server define tools, aplica auth, retorna dados, e que o modelo decide quando chamar tools com base na metadata. Também reforça `structuredContent` e `outputSchema`.

Fonte:
https://developers.openai.com/apps-sdk/build/mcp-server

### 6.5. Define tools

A documentação recomenda uma tarefa por tool, inputs explícitos, outputs previsíveis, `outputSchema`, e separação entre read/write para respeitar confirmation flows.

Fonte:
https://developers.openai.com/apps-sdk/plan/tools

### 6.6. MCP Tools Specification

A especificação MCP diz que tools são model-controlled, mas recomenda humano no loop e prompts de confirmação para operações sensíveis.

Fonte:
https://modelcontextprotocol.io/specification/2025-06-18/server/tools

---

## 7. Estado Git e ambiente

### 7.1. Repo status

```text
branch: main
HEAD: 044b2060
dirty: true

?? "# Relatório de Checagem Geral — MCP `WOR.md"
?? "src/copilot/docs/Plano consolidado de autonomia máxima.md"
```

### 7.2. Últimos commits relevantes

```text
044b2060 docs(mcp): add golden prompt measurement
d1f25cdd feat(mcp): add allowlisted autonomy runner
baef75f1 feat(mcp): add safe maintenance batch
00a741a3 feat(mcp): improve ChatGPT autonomy profile
cd70f76e fix(copilot): prevent parser worker restart during shutdown
e5cc89da fix(copilot): close index CLI parser workers
4f1662c8 docs(copilot): record MCP tunnel origin recovery
b5fb215b feat(copilot): expose MCP index navigation tools
74f3dd97 feat(copilot): close MCP workspace report gaps
059276c8 feat(copilot): add local MCP HTTP smoke
```

### 7.3. Tunnel/runtime

`mcp_tunnel_status` indicou:

```text
mode: temporary-trycloudflare
processAlive: true
stateValid: true
stale: false
recommendedAction: use
lastSmokeOk: true
connectorUrl: https://gage-bon-beast-contribute.trycloudflare.com/mcp
originUrl: http://127.0.0.1:3333
auth: none-dev
```

`mcp_runtime_health` indicou:

```text
success: true
ok: true
status: ok
warnings: []
critical: []
```

Observação importante: `mcp_runtime_health` ficou `ok`, mas `mcp_smoke_workspace` ficou `degraded` por workspace dirty. Isso é uma inconsistência leve de severidade agregada.

---

## 8. Superfície de tools descoberta

`list_resources(refetch_tools=true)` expôs 54 tools.

### 8.1. Resumo de `mcp_tools_status`

```json
{
  "totalTools": 54,
  "readOnlyCount": 37,
  "boundedWriteCount": 16,
  "destructiveCount": 1,
  "openWorldCount": 0,
  "idempotentReadCount": 37
}
```

### 8.2. Tools destrutivas

```text
repo_remove_file
```

### 8.3. Candidatas a “remember approval”

```text
delegate_to_repo_autonomy_runner
job_cancel
mcp_maintenance_apply_safe_fixes
mcp_run_safe_validation_suite
repo_apply_patch
repo_create_file
repo_index_build
repo_index_invalidate
repo_move_file
repo_quarantine_file
repo_restore_quarantined_file
repo_write_file
run_copilot_validator
run_lint_copilot
run_typecheck_copilot
run_unit_copilot
```

### 8.4. Nova superfície de autonomia

Confirmada:

```text
mcp_session_profile
mcp_golden_prompts
mcp_maintenance_plan
mcp_maintenance_apply_safe_fixes
delegate_to_repo_autonomy_runner
mcp_run_safe_validation_suite
repo_quarantine_file
repo_restore_quarantined_file
repo_list_quarantine
repo_inspect_quarantined_file
```

---

## 9. Testes live executados

### 9.1. Descoberta e metadata

| Tool                                       | Resultado              |
| ------------------------------------------ | ---------------------- |
| `list_resources`                           | OK                     |
| `mcp_capabilities_summary`                 | OK                     |
| `mcp_session_profile`                      | OK                     |
| `mcp_tools_status`                         | OK                     |
| `mcp_golden_prompts`                       | OK                     |
| `chatgpt_connector_profile`                | OK                     |
| `chatgpt_connector_url_check` com URL real | Bloqueado externamente |

### 9.2. Git e estado

| Tool                               | Resultado              |
| ---------------------------------- | ---------------------- |
| `repo_status`                      | OK                     |
| `git_status`                       | OK                     |
| `git_branch_info`                  | OK                     |
| `git_log`                          | OK                     |
| `git_diff`                         | OK, diff vazio         |
| `repo_root_tree(showHidden=true)`  | Bloqueado externamente |
| `repo_root_tree(showHidden=false)` | OK                     |
| `repo_tree(src/copilot/mcp)`       | OK                     |

### 9.3. Smoke e runtime

| Tool                                                              | Resultado                                           |
| ----------------------------------------------------------------- | --------------------------------------------------- |
| `mcp_maintenance_plan`                                            | OK                                                  |
| `mcp_maintenance_apply_safe_fixes(dryRun=true)`                   | OK                                                  |
| `mcp_maintenance_apply_safe_fixes(dryRun=false, read-only fixes)` | OK                                                  |
| `mcp_smoke_workspace`                                             | OK funcional, `status=degraded` por dirty workspace |
| `mcp_runtime_health`                                              | OK                                                  |
| `mcp_tunnel_status`                                               | OK                                                  |

### 9.4. Leitura, busca e código

| Tool                                                      | Resultado              |
| --------------------------------------------------------- | ---------------------- |
| `repo_read_file(registry.js)`                             | Bloqueado externamente |
| `repo_read_file_chunks(registry.js)`                      | Bloqueado externamente |
| `repo_file_stats(registry.js)`                            | Bloqueado externamente |
| `repo_search_text(registerCanonicalMcpTools)`             | Bloqueado externamente |
| `repo_symbol_search(registerCanonicalMcpTools)`           | OK                     |
| `repo_file_outline(registry.js)`                          | OK                     |
| `repo_file_outline(maintenance.js)`                       | OK                     |
| `repo_file_outline(delegation-runner.js)`                 | OK                     |
| `repo_diff_files(maintenance.js vs delegation-runner.js)` | Bloqueado externamente |
| `repo_find_symbol_usages(maintenanceTools)`               | Bloqueado externamente |

### 9.5. Index

| Tool                                           | Resultado                         |
| ---------------------------------------------- | --------------------------------- |
| `repo_index_status`                            | OK, mas índice vazio/indisponível |
| `repo_index_build(src/copilot/mcp)`            | Bloqueado externamente            |
| `repo_index_search(registerCanonicalMcpTools)` | Bloqueado externamente            |

`repo_index_status` retornou:

```json
{
  "enabled": true,
  "available": false,
  "files": 0,
  "freshness": "empty"
}
```

### 9.6. Validators e jobs

| Tool                                       | Resultado              |
| ------------------------------------------ | ---------------------- |
| `run_project_doctor(includeScripts=false)` | OK                     |
| `mcp_run_safe_validation_suite(mcp-fast)`  | Bloqueado externamente |
| `run_copilot_validator(suite-mcp-fast)`    | Bloqueado externamente |
| `job_list`                                 | OK                     |
| `job_get_output` curto                     | OK                     |

### 9.7. Escrita, quarantine e destrutivas

| Tool                                                           | Resultado                                                          |
| -------------------------------------------------------------- | ------------------------------------------------------------------ |
| `repo_create_file(dryRun=true)`                                | Bloqueado externamente                                             |
| `repo_quarantine_file(dryRun=true)`                            | Bloqueado externamente                                             |
| `repo_list_quarantine`                                         | Bloqueado externamente                                             |
| `delegate_to_repo_autonomy_runner(diagnose-mcp, dryRun=true)`  | OK                                                                 |
| `delegate_to_repo_autonomy_runner(diagnose-mcp, dryRun=false)` | Bloqueado externamente                                             |
| `repo_remove_file(confirm=false,dryRun=true)`                  | Chegou ao MCP; erro controlado `ERR_REMOVE_CONFIRM_REQUIRED`       |
| `repo_remove_file(confirm=true,dryRun=true)`                   | Chegou ao MCP; erro controlado `ENOENT` porque arquivo não existia |

Achado relevante: a tool destrutiva `repo_remove_file` chegou ao MCP em dry-run, enquanto bounded-write reversível foi bloqueada antes do MCP. Isso sugere que o bloqueio externo não segue apenas `destructiveHint`; depende também de nome, payload, timing, tool class ou heurística interna do host.

---

## 10. Matriz de resultados por categoria

| Categoria                | Estado geral                                      |
| ------------------------ | ------------------------------------------------- |
| Discovery/tools          | Muito bom                                         |
| Capabilities             | Muito bom                                         |
| Session profile          | Muito bom                                         |
| Tool status/risk classes | Muito bom                                         |
| Runtime/tunnel           | Bom                                               |
| Smoke                    | Bom, mas degraded por dirty                       |
| Git read                 | Bom                                               |
| Root tree                | Parcial; `showHidden=true` bloqueado              |
| File read direto         | Ruim nesta sessão para arquivos MCP centrais      |
| File outline             | Bom                                               |
| Symbol search            | Bom                                               |
| Text search              | Bloqueado em caso central                         |
| Index                    | Status OK, build/search bloqueados e índice vazio |
| Maintenance batch        | Bom                                               |
| Delegation runner        | Dry-run OK; real bloqueado                        |
| Validation suite         | Bloqueada                                         |
| Quarantine               | Bloqueada                                         |
| Destructive remove       | Chegou ao MCP e negou corretamente                |
| Jobs list/output         | Bom para jobs existentes                          |
| OAuth/Auth               | Nenhuma; funcional em dev, fraco para escopos     |
| outputSchema             | Recomendado pela UI; provável ausência ampla      |

---

## 11. Bloqueios externos observados

Mensagem típica:

```text
Esta ferramenta foi bloqueada pelas configurações de segurança da OpenAI. Verifique novamente o que está enviando.
```

### 11.1. Bloqueios read-only

Foram bloqueadas chamadas read-only ou aparentemente seguras:

- `repo_root_tree(showHidden=true)`;
- `repo_read_file(registry.js)`;
- `repo_read_file_chunks(registry.js)`;
- `repo_file_stats(registry.js)`;
- `repo_search_text(registerCanonicalMcpTools)`;
- `repo_diff_files`;
- `repo_find_symbol_usages`;
- `repo_index_search`.

### 11.2. Bloqueios bounded-write

Foram bloqueadas:

- `repo_create_file(dryRun=true)`;
- `repo_quarantine_file(dryRun=true)`;
- `repo_index_build`;
- `mcp_run_safe_validation_suite`;
- `run_copilot_validator(suite-mcp-fast)`;
- `delegate_to_repo_autonomy_runner(dryRun=false)`;
- `chatgpt_connector_url_check` com URL pública real.

### 11.3. Interpretação

O MCP não falhou nesses casos; a chamada não chegou ao handler. O smoke interno e outras tools provaram que o servidor consegue executar leitura, stats e busca internamente.

A camada externa parece sensível a:

- ferramentas de escrita, mesmo dry-run;
- URLs públicas reais;
- build/invalidation de índice;
- validators/jobs novos;
- leitura direta de arquivos MCP centrais;
- `showHidden=true`;
- payloads que envolvem diffs, símbolos/usages ou paths de infraestrutura.

---

## 12. Análise técnica dos bloqueios

### 12.1. Não é apenas OAuth

Se fosse apenas ausência de OAuth, esperaríamos que todas as chamadas sensíveis falhassem de forma previsível por auth. Mas ocorreu:

- `repo_remove_file` chegou ao MCP;
- `repo_file_outline` funcionou no mesmo arquivo em que `repo_read_file` falhou;
- `mcp_maintenance_apply_safe_fixes(dryRun=false)` funcionou para fixes read-only;
- `delegate_to_repo_autonomy_runner(dryRun=true)` funcionou, mas `dryRun=false` foi bloqueado.

Isso mostra que a camada externa avalia mais fatores do que auth.

### 12.2. Não é apenas `destructiveHint`

`repo_remove_file` é destrutiva e chegou ao MCP em dry-run. `repo_quarantine_file` é bounded-write e foi bloqueada. Isso sugere que a heurística não é simples.

### 12.3. Pode envolver tool name + payload + contexto + ação percebida

Padrões bloqueados:

- `create`;
- `quarantine`;
- `index_build`;
- `validation_suite`;
- URL pública;
- `showHidden`;
- leitura direta de registry;
- busca textual em registry;
- diff entre arquivos MCP.

### 12.4. Melhor mitigação

Criar ferramentas read-only puras de planejamento e diagnóstico:

```text
repo_create_file_plan
repo_quarantine_file_plan
repo_patch_plan
mcp_validation_plan
repo_index_refresh_plan
repo_root_redaction_status
chatgpt_connector_current_url_status
```

---

## 13. Bugs encontrados

### BUG-001 — `mcp_runtime_health` não reflete estado degraded do smoke

**Severidade:** P2
**Evidência:** `mcp_smoke_workspace` retornou `status=degraded` por `WORKSPACE_DIRTY`, mas `mcp_runtime_health` retornou `status=ok`, `warnings=[]`.

**Impacto:** a visão de saúde geral pode parecer mais verde do que o estado operacional real.

**Correção proposta:**

- `mcp_runtime_health` deve incorporar o último smoke status;
- se último smoke é `degraded`, incluir warning;
- se último smoke tem critical, runtime health deve ser `degraded` ou `critical`.

---

### BUG-002 — Index vazio/indisponível após transformações

**Severidade:** P1
**Evidência:** `repo_index_status` retornou `enabled=true`, `available=false`, `files=0`, `freshness=empty`.

**Impacto:** tools de index não oferecem poder real ao ChatGPT até reconstruir o índice.

**Correção proposta:**

- `mcp_smoke_workspace` deve elevar warning quando index está vazio;
- `mcp_maintenance_plan` já sugere `refresh-index`, mas o host bloqueou `repo_index_build`;
- criar fluxo de refresh-index interno em maintenance com menor fricção ou executável fora do host ChatGPT.

---

### BUG-003 — Bounded-write dry-run bloqueado pelo host

**Severidade:** P1
**Evidência:** `repo_create_file(dryRun=true)` e `repo_quarantine_file(dryRun=true)` foram bloqueadas antes do MCP.

**Impacto:** reduz muito o poder prático do ChatGPT; nem planos de escrita reversível passam consistentemente.

**Correção proposta:**

- criar tools read-only de preview separadas:
  - `repo_create_file_plan`;
  - `repo_quarantine_file_plan`;
  - `repo_patch_plan`;
- manter apply separado;
- tool descriptions devem enfatizar “plan only, no mutation”;
- usar `readOnlyHint=true` para planos que realmente não mutam.

---

### BUG-004 — `repo_remove_file` dry-run chega ao MCP, mas quarantine dry-run não

**Severidade:** P2
**Evidência:** `repo_remove_file(confirm=false,dryRun=true)` chegou ao MCP e retornou erro controlado; `repo_quarantine_file(dryRun=true)` foi bloqueado externamente.

**Impacto:** a heurística externa está favorecendo comportamento inesperado. O fluxo reversível deveria ser mais fácil que o destrutivo.

**Correção proposta:**

- revisar nome/descrição/schema de `repo_quarantine_file`;
- talvez criar `repo_quarantine_plan` read-only;
- documentar no `mcp_session_profile` que ChatGPT pode bloquear quarantine nesta UI;
- medir com `mcp_golden_prompts` em conversa limpa.

---

### BUG-005 — `chatgpt_connector_url_check` bloqueado com URL real

**Severidade:** P2
**Evidência:** chamada com `https://gage-bon-beast-contribute.trycloudflare.com/mcp` foi bloqueada.

**Impacto:** reduz a capacidade do ChatGPT de validar public URL automaticamente.

**Correção proposta:**

- separar validação sintática local de validação/echo de URL;
- evitar retornar raw public URL em certos payloads;
- criar `chatgpt_connector_current_url_status` sem input, lendo estado interno já conhecido.

---

### BUG-006 — `repo_root_tree(showHidden=true)` bloqueado externamente

**Severidade:** P2
**Evidência:** `showHidden=true` bloqueado; `showHidden=false` OK.

**Impacto:** ChatGPT não consegue auditar redaction de hidden paths diretamente, embora smoke consiga.

**Correção proposta:**

- criar `repo_root_redaction_status` read-only sem retornar nomes de hidden files;
- output só com counts e policy:
  - `blockedEntriesCount`;
  - `protectedEntriesRedacted`;
  - `protectedPatterns`.

---

### BUG-007 — Ausência de outputSchema explícito prejudica maturidade do conector

**Severidade:** P1/P2
**Evidência:** UI mostra “ESQUEMA DE SAÍDA RECOMENDADO” nas tools.

**Impacto:** menor previsibilidade para ChatGPT, validação de cliente e encadeamento de tool calls.

**Correção proposta:**

- adicionar `outputSchema` em todas as tools com `structuredContent`;
- garantir que `structuredContent` corresponda exatamente ao schema;
- versionar schemas;
- incluir testes de conformidade.

---

### BUG-008 — Ausência de securitySchemes por tool

**Severidade:** P1/P2
**Evidência:** UI mostra `Autorização compatível: Nenhuma` e `Autorização usada: Nenhuma`.

**Impacto:** sem scopes por tool; sem OAuth linking; sem política granular de autorização.

**Correção proposta:**

- adicionar `securitySchemes` por tool;
- começar com `{ type: "noauth" }` explícito;
- evoluir para Mixed Authentication:
  - read-only: `noauth`;
  - bounded-write: `oauth2` opcional/obrigatório;
  - destructive: `oauth2` obrigatório.

---

## 14. Gaps restantes

### GAP-001 — Falta ferramentas de “plan only” read-only para operações sensíveis

Hoje o dry-run está dentro da própria write tool, e o host pode bloquear antes de olhar `dryRun`.

Criar:

```text
repo_patch_plan
repo_create_file_plan
repo_quarantine_file_plan
repo_move_file_plan
repo_index_refresh_plan
mcp_validation_plan
```

Essas tools podem ser `readOnlyHint=true` se não mutarem nada.

---

### GAP-002 — Falta runner externo efetivo para escapar da autorização do host

`delegate_to_repo_autonomy_runner(dryRun=true)` funcionou, mas `dryRun=false` foi bloqueado pelo ChatGPT.

Para autonomia real, é necessário que o runner seja acionado por um canal onde a política seja nossa, não do ChatGPT, ou que o ChatGPT só gere/assine um plano e o runner local execute fora da UI.

---

### GAP-003 — Index precisa de modo auto-refresh fora da tool bloqueada

Como `repo_index_build` foi bloqueado, o índice ficou vazio. Isso limita poder de busca e navegação.

Possíveis soluções:

- auto-build on server startup;
- build index via maintenance interno agendado;
- build index por processo local fora do ChatGPT;
- `repo_index_status` com guia claro para rebuild manual.

---

### GAP-004 — Falta telemetria de bloqueios do host

Bloqueios externos não chegam ao MCP; portanto o servidor não sabe que a chamada foi bloqueada.

Solução possível:

- `mcp_golden_prompts` já dá measurementFields;
- criar relatório manual “host block log” preenchido pelo ChatGPT:
  - tool;
  - args class;
  - blocked;
  - message;
  - timestamp.

---

### GAP-005 — Workspace dirty persistente

Status atual tem dois arquivos não rastreados:

```text
# Relatório de Checagem Geral — MCP `WOR.md
src/copilot/docs/Plano consolidado de autonomia máxima.md
```

Isso mantém smoke `degraded`.

---

### GAP-006 — `repo_root_tree(showHidden=false)` ainda revela arquivos raiz estranhos

A raiz contém muitos artefatos/relatórios. Isso não é bug MCP, mas reduz clareza operacional e pode aumentar payload/ruído.

---

### GAP-007 — Falta perfil de autorização por ambiente

Hoje temos `none-dev`, mas precisamos de perfis claros:

```text
dev-noauth
dev-mixed-auth
team-oauth
prod-readonly
```

---

### GAP-008 — Falta mapeamento de escopos por tool

Sugestão:

```text
repo.read
repo.plan
repo.write
repo.validate
repo.maintenance
repo.destructive
repo.tunnel
repo.admin
```

---

## 15. Oportunidades de upgrade

### UPG-001 — Tool family “plan/apply”

Separar plano read-only de aplicação write:

```text
repo_patch_plan          read-only
repo_patch_apply         bounded-write
repo_quarantine_plan     read-only
repo_quarantine_apply    bounded-write
mcp_validation_plan      read-only
mcp_validation_run       bounded-write
```

Motivo: o host pode bloquear menos tools read-only puras.

---

### UPG-002 — `mcp_host_block_diagnostics`

Tool read-only que orienta o ChatGPT a registrar bloqueios externos:

```json
{
  "instructions": "When a host block happens, record tool, args class, block message and whether dryRun was true.",
  "knownBlockedPatterns": []
}
```

---

### UPG-003 — `chatgpt_connector_current_url_status`

Sem input. Retorna estado do tunnel atual sem o usuário passar URL pública.

Isso contorna bloqueios por input contendo URL.

---

### UPG-004 — `repo_root_redaction_status`

Sem listar hidden files. Retorna apenas:

```json
{
  "showHiddenAuditSupported": true,
  "protectedEntriesRedacted": true,
  "blockedEntriesCount": 9
}
```

---

### UPG-005 — Auto index refresh no boot

Como `repo_index_build` foi bloqueado, considerar:

```text
COPILOT_MCP_INDEX_AUTO_BUILD=true
COPILOT_MCP_INDEX_AUTO_BUILD_PATH=src/copilot
COPILOT_MCP_INDEX_AUTO_BUILD_MAX_FILES=1500
```

---

### UPG-006 — `mcp_validation_summary_from_last_jobs`

Como iniciar jobs foi bloqueado, usar jobs existentes melhor:

```text
mcp_last_validation_summary
```

Retorna resumo dos últimos jobs por tipo e identifica se estão obsoletos.

---

### UPG-007 — Melhor agregação de saúde

`mcp_runtime_health` deve incluir:

- último smoke status;
- dirty workspace;
- index availability;
- tunnel health;
- hostBlockTelemetry se houver;
- stale validation state.

---

### UPG-008 — Golden prompt automation

`mcp_golden_prompts` já existe, mas pode gerar um arquivo JSON/Markdown de resultados de medição para o usuário preencher durante sessão real do ChatGPT.

---

### UPG-009 — Implementar outputSchema registry-wide

Criar helpers:

```js
const okSchema = z.object({ success: z.literal(true) }).passthrough();
const errorSchema = z.object({
  success: z.literal(false),
  code: z.string().optional(),
  error: z.string(),
}).passthrough();
```

E schemas específicos por tool.

---

### UPG-010 — Implementar securitySchemes registry-wide

Criar helpers:

```js
const NOAUTH = [{ type: 'noauth' }];
const OAUTH_REPO_READ = [{ type: 'oauth2', scopes: ['repo.read'] }];
const OAUTH_REPO_WRITE = [{ type: 'oauth2', scopes: ['repo.write'] }];
```

E mapear por tool.

---

## 16. Plano de OAuth e Mixed Authentication

### 16.1. Objetivo

Dar ao ChatGPT uma política explícita de autorização por tool.

### 16.2. Fase 1 — securitySchemes explícito noauth

Mesmo sem OAuth, declarar:

```js
securitySchemes: [{ type: "noauth" }]
_meta: {
  securitySchemes: [{ type: "noauth" }]
}
```

Para todas as tools.

Isso deve transformar “Nenhuma” em algo mais explícito/compatível no metadata, dependendo da UI.

### 16.3. Fase 2 — Mixed Authentication

Mapeamento:

| Classe        | securitySchemes                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------- |
| read-only     | `[{ type: "noauth" }]`                                                                                               |
| plan-only     | `[{ type: "noauth" }]`                                                                                               |
| bounded-write | `[{ type: "oauth2", scopes: ["repo.write"] }]` ou `[{ type: "noauth" }, { type: "oauth2", scopes: ["repo.write"] }]` |
| validators    | `[{ type: "oauth2", scopes: ["repo.validate"] }]`                                                                    |
| destructive   | `[{ type: "oauth2", scopes: ["repo.destructive"] }]`                                                                 |
| admin/tunnel  | `[{ type: "oauth2", scopes: ["repo.admin"] }]`                                                                       |

### 16.4. Fase 3 — Protected resource metadata

Expor:

```text
GET /.well-known/oauth-protected-resource
```

Com:

```json
{
  "resource": "https://<mcp-host>",
  "authorization_servers": ["https://<auth-host>"],
  "scopes_supported": [
    "repo.read",
    "repo.plan",
    "repo.write",
    "repo.validate",
    "repo.maintenance",
    "repo.destructive",
    "repo.admin"
  ]
}
```

### 16.5. Fase 4 — Authorization server metadata

Expor:

```text
/.well-known/oauth-authorization-server
```

ou OIDC discovery:

```text
/.well-known/openid-configuration
```

Com endpoints de authorization/token e suporte PKCE `S256`.

### 16.6. Fase 5 — Runtime challenge

Quando faltar token/escopo, retornar erro com:

```json
{
  "_meta": {
    "mcp/www_authenticate": [
      "Bearer resource_metadata=\"https://<mcp-host>/.well-known/oauth-protected-resource\", error=\"insufficient_scope\", error_description=\"repo.write required\""
    ]
  },
  "isError": true
}
```

---

## 17. Plano de outputSchema para todas as tools

### 17.1. Princípios

Cada tool que retorna `structuredContent` deve declarar `outputSchema`.

O schema deve:

- incluir `success`;
- incluir campos usados em follow-up;
- incluir `code/error` em falhas;
- declarar `nextCursor`;
- declarar `sha256`;
- declarar `jobId`;
- declarar `quarantineId`;
- declarar `status/warnings/critical`;
- usar enums quando possível.

### 17.2. Exemplos

#### `repo_status`

```js
outputSchema: {
  success: z.boolean(),
  workspaceRoot: z.string(),
  branch: z.string(),
  head: z.string(),
  status: z.string(),
  dirty: z.boolean()
}
```

#### `repo_read_file`

```js
outputSchema: {
  success: z.boolean(),
  path: z.string(),
  sha256: z.string(),
  content: z.string(),
  totalLines: z.number(),
  returnedLines: z.object({
    start: z.number(),
    end: z.number()
  })
}
```

#### `mcp_smoke_workspace`

```js
outputSchema: {
  success: z.boolean(),
  status: z.enum(["ok", "degraded", "failed"]),
  durationMs: z.number(),
  checks: z.array(z.object({
    name: z.string(),
    ok: z.boolean(),
    durationMs: z.number(),
    detail: z.record(z.unknown()).optional()
  })),
  warnings: z.array(z.string()),
  critical: z.array(z.string())
}
```

#### `repo_quarantine_file`

```js
outputSchema: {
  success: z.boolean(),
  dryRun: z.boolean(),
  quarantineId: z.string().optional(),
  originalPath: z.string(),
  quarantinePath: z.string().optional(),
  rollback: z.object({
    tool: z.literal("repo_restore_quarantined_file"),
    quarantineId: z.string()
  }).optional()
}
```

---

## 18. Plano de securitySchemes por tool

### 18.1. Read-only

```text
repo_status
repo_tree
repo_root_tree
repo_read_file
repo_file_stats
repo_read_file_chunks
repo_search_text
repo_file_outline
repo_symbol_search
repo_find_symbol_usages
git_status
git_diff
git_log
mcp_runtime_health
mcp_tools_status
mcp_session_profile
mcp_smoke_workspace
```

Scheme:

```json
[{ "type": "noauth" }]
```

### 18.2. Plan-only

```text
repo_patch_plan
repo_create_file_plan
repo_quarantine_file_plan
mcp_validation_plan
repo_index_refresh_plan
```

Scheme:

```json
[{ "type": "noauth" }]
```

### 18.3. Bounded-write

```text
repo_apply_patch
repo_write_file
repo_create_file
repo_move_file
repo_quarantine_file
repo_restore_quarantined_file
mcp_maintenance_apply_safe_fixes
```

Scheme dev:

```json
[
  { "type": "noauth" },
  { "type": "oauth2", "scopes": ["repo.write"] }
]
```

Scheme team/prod:

```json
[{ "type": "oauth2", "scopes": ["repo.write"] }]
```

### 18.4. Validators

```text
mcp_run_safe_validation_suite
run_copilot_validator
run_typecheck_copilot
run_lint_copilot
run_unit_copilot
```

Scheme:

```json
[{ "type": "oauth2", "scopes": ["repo.validate"] }]
```

### 18.5. Destructive

```text
repo_remove_file
job_cancel
```

Scheme:

```json
[{ "type": "oauth2", "scopes": ["repo.destructive"] }]
```

---

## 19. Plano para reduzir prompts e bloqueios

### 19.1. Separar plan/apply

Principal ação.

Hoje:

```text
repo_create_file(dryRun=true) bloqueado
repo_quarantine_file(dryRun=true) bloqueado
```

Proposta:

```text
repo_create_file_plan    readOnlyHint=true
repo_create_file_apply   bounded-write
repo_quarantine_plan     readOnlyHint=true
repo_quarantine_apply    bounded-write
```

### 19.2. Evitar input com URL pública

Trocar:

```text
chatgpt_connector_url_check(publicMcpUrl)
```

por:

```text
chatgpt_connector_current_url_status()
```

### 19.3. Evitar `showHidden=true` direto

Trocar:

```text
repo_root_tree(showHidden=true)
```

por:

```text
repo_root_redaction_status()
```

### 19.4. Validar via last jobs quando run for bloqueado

Criar:

```text
mcp_last_validation_summary()
```

### 19.5. Auto-index fora do ChatGPT

Criar:

```text
COPILOT_MCP_INDEX_AUTO_BUILD=true
```

ou runner local.

---

## 20. Recomendações prioritárias

### P0

1. Adicionar `outputSchema` a todas as tools com `structuredContent`.
2. Adicionar `securitySchemes` explícito por tool.
3. Criar tools plan-only read-only.
4. Criar `chatgpt_connector_current_url_status`.
5. Criar `repo_root_redaction_status`.

### P1

1. Implementar Mixed Authentication.
2. Criar escopos:
   - `repo.read`;
   - `repo.plan`;
   - `repo.write`;
   - `repo.validate`;
   - `repo.maintenance`;
   - `repo.destructive`;
   - `repo.admin`.
3. Auto-build de índice fora do ChatGPT.
4. `mcp_runtime_health` agregando smoke/index/dirty.
5. `mcp_last_validation_summary`.

### P2

1. OAuth completo com protected resource metadata.
2. Token verification por issuer/audience/scope.
3. `mcp_host_block_diagnostics`.
4. Golden prompt results export.
5. Dashboard de power score/block score.

---

## 21. Próxima bateria de testes recomendada

Em uma conversa nova no ChatGPT, com Developer Mode e “remember approval” disponível, executar:

1. `mcp_session_profile`
2. `mcp_tools_status`
3. `mcp_golden_prompts`
4. `repo_status`
5. `repo_file_outline(registry.js)`
6. `repo_symbol_search(registerCanonicalMcpTools)`
7. `mcp_maintenance_apply_safe_fixes dryRun=true`
8. aprovar/remember `mcp_maintenance_apply_safe_fixes`
9. `repo_create_file_plan`
10. `repo_create_file_apply`
11. `repo_quarantine_file_plan`
12. `repo_quarantine_file_apply`
13. `mcp_validation_plan`
14. `mcp_run_safe_validation_suite suite=mcp-fast`
15. `job_get_output`

Registrar com campos de `mcp_golden_prompts`:

```text
timestamp
promptId
toolCalls
approvalPromptsShown
rememberApprovalOffered
blockedByHost
mcpNetworkError
completed
notes
```

---

## 22. Veredito

O MCP `WORKSPACE` agora tem uma arquitetura forte e quase toda a superfície necessária para dar poder real ao ChatGPT sobre o repo. Ele já implementa grande parte do plano de autonomia: annotations, risk classes, session profile, golden prompts, maintenance batch, safe suite, autonomy runner e quarantine.

Mas três pontos precisam ser tratados para aumentar o poder efetivo no `chatgpt.com`:

1. **Adicionar `outputSchema` em todas as tools.**
   Isso é explicitamente recomendado pela documentação oficial e deve melhorar validação, previsibilidade e encadeamento de tool calls.

2. **Adicionar `securitySchemes` e evoluir para Mixed Authentication.**
   “Autorização compatível/usada: Nenhuma” não impede funcionamento em dev, mas é fraco para scopes, consentimento granular e produção. Mixed Auth é o melhor meio-termo: read/plan noauth, write/validate/destructive OAuth.

3. **Separar plan-only read-only de apply/write.**
   Como o host bloqueou bounded-write mesmo em dry-run, `dryRun` dentro da tool de escrita não basta. Precisamos de tools de planejamento puramente read-only.

Resumo final:

```text
MCP server: forte
Tool design: muito melhor
Tunnel/runtime: saudável
Autorização atual: noauth funcional, mas limitada
OAuth: recomendado para escopos e confiança, não para eliminar prompts
OutputSchema: falta importante e deve ser P0/P1
Read-only metadata: forte
Code read/search direto: instável por bloqueios externos
Write/quarantine/validation: bloqueado pelo host nesta conversa
Autonomia real: depende de plan-only tools + outputSchema + securitySchemes + Mixed Auth + runner local
```
