# Diagnóstico canônico do WORKSPACE e de `src/copilot` — estado atual, estado-alvo e roadmap de máxima autonomia

**Data da auditoria:** 2026-08-14  
**Escopo primário:** `src/copilot`  
**Escopo secundário:** workspace, Git, DevContainer, MCP, OAuth, Cloudflare, índice/IO, validadores e documentação diretamente necessária à operação de `src/copilot`  
**Fonte operacional:** exclusivamente o conector `WORKSPACE` desta sessão  
**Branch observada:** `main`  
**HEAD observado:** `6f2707e5a`  
**Runtime observado:** Node.js `v24.15.0`, Linux  
**Perfil MCP observado:** `chatgpt-max-autonomy-permanent-cloudflare-oauth`  
**Arquivo:** `src/copilot/docs/WORKSPACE_SRC_COPILOT_DIAGNOSTICO_ESTADO_ALVO_E_ROADMAP_2026-08-14.md`

---

## 0. Propósito, autoridade e regra de leitura

Este documento é uma auditoria de **prontidão para trabalho contínuo com ChatGPT via conector WORKSPACE**, com foco em maximizar simultaneamente:

1. autonomia operacional;
2. segurança de mutações;
3. capacidade de navegação e compreensão do código;
4. confiabilidade dos validadores;
5. observabilidade;
6. previsibilidade arquitetural;
7. baixa fricção de autorização;
8. reprodutibilidade do ambiente;
9. qualidade dos contratos entre camadas;
10. capacidade de evoluir `src/copilot` sem aumentar entropia estrutural.

Ele **não substitui** roadmaps especializados de subsistemas, como Model Gateway, MCP/OAuth ou IO. Sua função é ser o diagnóstico transversal atual e a camada de priorização que diz o que deve ser feito primeiro para que esses roadmaps especializados possam ser executados com menor ambiguidade.

### 0.1 Relação com auditorias anteriores

A auditoria ampla de 2026-06-13 continua útil como registro histórico, mas vários achados mudaram materialmente desde então. Este documento deve ser considerado a referência transversal mais recente para o estado observado em 2026-08-14.

Exemplos de mudanças já verificadas:

- o MCP agora opera com runtime **stateful** por política, com TTL e limite de sessões;
- a promoção automática de route switch diferido no limite de turno já existe no código do Model Gateway/terminal;
- o `@github/copilot-sdk` instalado avançou para `1.0.9`;
- o suposto `env-secret-registry.js` ausente não pode ser classificado como bug: o WORKSPACE confirmou que o basename é um **path protegido** e deliberadamente bloqueado ao MCP;
- a superfície MCP permanece com 102 tools e ganhou mecanismos adicionais de planejamento, batch, readiness e observabilidade.

### 0.2 Convenção de checkboxes deste documento

Todo checkbox é estritamente booleano:

- `[x]` = evidência suficiente observada nesta auditoria;
- `[ ]` = trabalho ainda requerido ou não demonstrado nesta auditoria.

Não se usam estados intermediários como checkbox. Progresso parcial é descrito em texto, mantendo o checkbox como `[ ]` até que o critério de aceite esteja integralmente satisfeito.

---

# Parte I — Sumário executivo

## 1. Veredito geral

**Veredito: GO para iniciar trabalho real em `src/copilot`, com hardening inicial obrigatório para atingir o estado de máxima autonomia desejado.**

Não foi encontrado blocker estrutural que impeça o ChatGPT de ler, diagnosticar, planejar, editar de forma controlada, validar e operar o workspace por meio do conector. Ao contrário: o MCP está entre as áreas mais maduras do projeto.

O conector reporta:

- **102 tools** anunciadas;
- **78** read-only/idempotentes;
- **21** bounded-write;
- **3** destrutivas;
- **0** open-world;
- score de autonomia **96/100, grau A**;
- OAuth com escopos `repo:read`, `repo:write`, `repo:validate`, `repo:admin`;
- `mcp_connection_readiness.ready=true`, sem blockers;
- túnel Cloudflare remoto healthy;
- índice local disponível e fresco;
- validações atuais verdes.

O gargalo, portanto, **não é falta de poder do conector**. Os principais limitadores restantes são de governança e engenharia do próprio workspace:

1. worktree suja e baseline causal ambíguo;
2. padrão global `public/` em `.gitignore`, que torna superfícies canônicas invisíveis a scanners que respeitam gitignore;
3. smoke persistido do conector extremamente obsoleto, deixando `post-restart readiness=false` apesar de health real estar verde;
4. `cloudflared` contabilizando ~23,4% de `requestErrors`, provavelmente incluindo cancelamentos de stream, ainda sem classificação semântica suficiente;
5. fallback explícito para `approveAll` quando `onPermissionRequest` não é fornecido;
6. drift relevante entre READMEs/roadmaps e a arquitetura efetivamente implantada;
7. hotspots de código muito grandes, sobretudo `terminal/commands/byok.js`;
8. retenção insuficientemente governada de jobs, rollback sidecars e logs;
9. detector de imports ainda incapaz de distinguir corretamente aliases `package.json#imports` e paths protegidos;
10. documentação abundante sem índice canônico de vigência.

## 1.1 Semáforo de prontidão

| Eixo | Situação atual | Leitura |
| --- | --- | --- |
| Conector WORKSPACE | Verde | 96/100, grau A, sem blockers estruturais |
| Read/write controlado | Verde | plan-first, expectedHash, quarantine e batch disponíveis |
| Validação de código | Verde | typecheck, lint, unit MCP e unit Copilot verdes |
| Índice/símbolos | Verde-amarelo | saudável e fresco, mas gitignore cria pontos cegos de descoberta |
| Arquitetura declarada | Verde | ownership e boundaries bem definidos |
| Arquitetura física | Amarelo | hotspots grandes e dívida de decomposição |
| OAuth | Verde | PKCE S256, JWKS, refresh rotation e reauthRisk baixo |
| Cloudflare remoto | Verde-amarelo | túnel/DNS/origin bons; métricas de request error exigem investigação |
| Pós-restart | Amarelo | health 200, mas smoke persistido velho torna readiness=false |
| Segurança de permissões SDK | Amarelo | `approveAll` ainda é fallback implícito |
| Documentação | Amarelo | boa qualidade local, mas múltiplos caminhos/versionamentos obsoletos |
| Higiene de artefatos | Amarelo | jobs/logs/rollback precisam retenção e rotação |
| Capacidade de iniciar desenvolvimento | Verde | sim, desde que o baseline seja preservado e o roadmap P0/P1 seja seguido |

## 1.2 O que já está suficientemente forte

- A topologia conceitual de `src/copilot` é madura e compreensível.
- O SDK é tratado como fonte vanilla antes de extensões locais.
- `agent`, `presentation`, `terminal`, `observability`, `infra`, `model-gateway` e `mcp` têm responsabilidades explícitas.
- `presentation` não apresenta acoplamento direto atual com `terminal` nas buscas realizadas.
- A superfície MCP é ampla, classificada por risco e desenhada para reduzir confirmações desnecessárias.
- OAuth, Protected Resource Metadata, JWKS e refresh tokens persistentes estão alinhados.
- Apps SDK e Company Knowledge estão detectados como prontos.
- Cloudflare usa túnel permanente, quatro conexões HA e origin HTTPS/HTTP2 com configuração remota coerente.
- O índice tem milhares de símbolos/imports e zero arquivos stale reportados.
- Os gates centrais passam no estado atual.

---

# Parte II — Evidências e situação atual

## 2. Baseline Git e workspace

### 2.1 Estado do Git

Estado observado:

- branch: `main`;
- upstream: `origin/main`;
- HEAD: `6f2707e5a`;
- worktree: suja.

O histórico recente está fortemente concentrado em correções de Model Gateway, route recovery, BYOK e timeline/atividade, por exemplo:

- `fix(copilot): harden llm-b route recovery after sdk update`;
- `fix(copilot): restore llm-b route readiness`;
- `fix(copilot): align live model gateway route projection`;
- `fix(copilot): harden model gateway live recovery`.

Isso mostra que o sistema está ativo e evoluindo rapidamente, mas também aumenta a importância de um checkpoint limpo antes de refactors largos.

### 2.2 Mudanças preexistentes observadas

A auditoria encontrou alterações/untracked anteriores à criação deste documento, incluindo `.vscode/settings.json`, documentos de auditoria e diretórios locais como `src/copilot/.ai/rollback/` e `workspaces/`.

A regra operacional deve ser: **não atribuir essas mudanças ao próximo incremento sem classificá-las primeiro**.

### 2.3 Higiene do root

O root contém grande quantidade de documentos, relatórios, scripts e artefatos históricos. Isso não é necessariamente incorreto, mas reduz a relação sinal/ruído para agentes e humanos. Há ainda coexistência de raízes como `DOCUMENTACAO` e `DOCUMENTAÇÃO`, além de muitos relatórios soltos.

A situação ideal não exige apagar história; exige distinguir claramente:

- fonte canônica;
- documento atual;
- documento histórico;
- artefato gerado;
- experimento local;
- output descartável.

---

## 3. Arquitetura atual de `src/copilot`

### 3.1 Fluxo canônico observado/documentado

A arquitetura central segue a cadeia:

```text
terminal/bootstrap.js
  -> boot/runtime-bootstrap.js
    -> boot plan / runtime wiring
      -> server + REPL

Copilot SDK session
  -> event-handlers
    -> agent
      -> presentation
        -> terminal/frontend
          -> terminal/dialog
            -> terminal/repl

Em paralelo:
  -> observability
  -> server/presentation
  -> conversation-hub
```

### 3.2 Ownership por domínio

| Domínio | Responsabilidade atual/ideal |
| --- | --- |
| `sdk/` | SSOT local das capabilities vanilla do GitHub Copilot SDK |
| `agent/` | runtime contínuo, lifecycle, sessão, dialog loop, health e invariantes |
| `presentation/` | projeções e acesso compartilhado para bordas |
| `terminal/` | UX humana, REPL, render, waiting, comandos e streaming local |
| `event-handlers/` | tradução de eventos vanilla para sinais internos estáveis |
| `observability/` | logs, métricas, timelines, tracing e audit |
| `conversation-hub/` | persistência/orquestração de sessões e turnos |
| `model-gateway/` | providers, catálogo, BYOK, routing, probes, health e control plane |
| `infra/` | I/O, cache, indexação, locks, storage, SSE, policies e primitivas técnicas |
| `mcp/` | servidor MCP, transporte, OAuth, Cloudflare, registry e tools do workspace |
| `tools/` | custom tools locais sobre SDK/infra |
| `config/` | defaults e configuração declarativa |
| `core/` | contratos e primitivas centrais |

### 3.3 Conclusão arquitetural

O problema atual **não é ausência de arquitetura**. O projeto já possui uma arquitetura explícita e, em vários lugares, executável por module maps, gates e testes de boundary.

A dívida principal está em quatro pontos:

1. documentos canônicos não acompanham todas as migrações físicas;
2. hotspots continuam crescendo dentro de boundaries corretos;
3. alguns scanners não compreendem todas as regras reais de resolução/ignore;
4. roadmaps especializados acumulam checkboxes antigos que o código já ultrapassou.

---

## 4. Hotspots físicos e concentração de complexidade

Arquivos representativos observados na árvore atual:

| Arquivo | Tamanho aproximado | Diagnóstico |
| --- | ---: | --- |
| `terminal/commands/byok.js` | 387 KB | hotspot extremo; mais de 8,3 mil linhas observáveis |
| `model-gateway/catalog/sqlite-catalog-store.js` | 170 KB | store amplo; risco de muitas responsabilidades persistentes |
| `mcp/control-plane/dev-oauth.js` | 158 KB | control plane crítico e sensível |
| `terminal/commands/session.js` | 130 KB | comando com superfície muito larga |
| `terminal/commands/sdk.js` | 113 KB | alta densidade operacional |
| `terminal/events/sdk-session-events.js` | 106 KB | event adapter central muito amplo |
| `tools/model-gateway/model-gateway-tools.js` | 101 KB | tool surface extensa |
| `mcp/tools/repo-write.js` | 98 KB | mutações de alto valor e alto risco |
| `mcp/scripts/oauth-smoke.js` | 91 KB | harness operacional muito grande |
| `model-gateway/routing/runtime-selector.js` | 87 KB | política de seleção complexa |
| `sdk/session/provider.js` | 83 KB | provider boundary densa |
| `terminal/dialog/engine.js` | 81 KB | hot path de diálogo |
| `model-gateway/routing/policy-engine.js` | 66 KB | política central |

O próprio `terminal/README.md` declara que arquivos acima de 300 linhas devem ser classificados como hotspot. Portanto, `byok.js` não é apenas “grande”; ele excede em ordem de magnitude o limiar de atenção adotado pelo próprio projeto.

**Conclusão:** não há justificativa para um rewrite. A decomposição deve ser incremental, mantendo barrels, contratos e testes, extraindo casos de uso sem alterar semântica.

---

## 5. Índice, busca, imports e descoberta

### 5.1 Estado do índice

O runtime reportou aproximadamente:

- 2.014 arquivos frescos no índice durante a auditoria;
- 0 stale;
- 0 failed;
- ~14,9 MB indexados;
- ~11.472 símbolos;
- ~3.703 imports;
- ~3.315 chunks.

O auto-build está funcional, com hash verification e prune seguro.

### 5.2 Achado crítico de navegabilidade: `.gitignore` e `public/`

`.gitignore` contém:

```gitignore
# Build outputs
dist/
build/
out/
public/
```

O padrão `public/` é global. Ferramentas de scan que respeitam gitignore podem ocultar qualquer diretório chamado `public`, não apenas o output público de raiz.

Evidência prática desta auditoria:

- `repo_tree path="src/copilot/infra/public"` retornou `count=0`;
- `repo_file_stats src/copilot/infra/public/cache.js` confirmou que o arquivo existe;
- `repo_read_file` leu o facade normalmente;
- código em `tools/` importa diversas surfaces `#copilot/infra/public/*`;
- a busca indexada limitada a `src/copilot/infra/public` não encontrou conteúdo.

Portanto, existe um **blind spot real de descoberta/indexação** para uma superfície que a arquitetura declara canônica.

Não foi possível demonstrar com as tools atuais se esses arquivos estão ou não tracked pelo Git; a conclusão correta é mais estreita: **o padrão de ignore interfere na navegabilidade de scanners e deve ser corrigido ou excepcionado explicitamente**.

### 5.3 Detector de imports órfãos

`repo_find_orphan_imports` reportou 9 aparentes órfãos.

Seis ocorrências eram aliases como:

- `#copilot/sdk/session-runtime`;
- `#copilot/sdk/agents`;
- `#copilot/sdk/di`.

`package.json#imports` prova que eles são válidos e resolvem para:

- `./src/copilot/sdk/session/runtime.js`;
- `./src/copilot/sdk/agent/index.js`;
- `./src/copilot/sdk/di-tokens.js`.

Outros três apontavam para `model-gateway/secrets/env-secret-registry.js`. O WORKSPACE respondeu `ERR_PATH_DENIED` e informou que o basename está protegido pela política do MCP.

Conclusão:

- não há import quebrado comprovado nesses 9 casos;
- o detector precisa distinguir `alias resolvido por package imports`, `path protegido/não auditável` e `órfão real`;
- auditorias futuras não devem transformar “não visível ao MCP” em “arquivo inexistente”.

---

## 6. Validação e qualidade executável

### 6.1 Gates atuais

Nesta data, os checks efetivos estavam verdes:

| Check | Fonte | Resultado |
| --- | --- | --- |
| typecheck | `suite-mcp-full` | passou |
| lint | `suite-mcp-full` | passou |
| unit MCP | `suite-mcp-full` | passou |
| unit Copilot | `suite-copilot-fast` | passou |

A suíte `mcp-full` foi renovada nesta auditoria e concluiu com exit code `0`, sem timeout.

### 6.2 Limite interpretativo

Gates verdes significam que o estado corrente é coerente com os contratos cobertos. Eles **não** eliminam:

- drift documental;
- hotspots;
- política permissiva intencional;
- blind spots de scanner;
- problemas somente live;
- degradação operacional do túnel;
- lacunas de benchmark.

Logo, “testes verdes” é baseline de segurança, não argumento para encerrar o roadmap.

---

## 7. MCP e autonomia do ChatGPT

### 7.1 Superfície atual

O MCP anuncia 102 tools, distribuídas em leitura, indexação, Git, validação, runtime, conexão e escrita controlada.

A postura de risco é forte:

- read-only por default para investigação;
- plan tools separadas das mutações;
- expected hash em patches/writes;
- quarantine preferível a delete;
- batch controlado para reduzir prompts;
- suites de validação allowlisted;
- nenhuma tool open-world.

### 7.2 Score de autonomia

`mcp_autonomy_power_score` retornou:

- **96/100**;
- **grau A**;
- **blockers: nenhum**.

O ponto que impede perfeição prática é principalmente prompt friction controlada pelo host ChatGPT, não ausência de capacidade no servidor MCP.

### 7.3 Protocolo operacional recomendado

Para futuras sessões, o fluxo canônico deve ser:

```text
mcp_session_profile
  -> repo_status
  -> mcp_tools_status
  -> repo_index_status / navigation
  -> plan-only tool
  -> bounded write com precondição
  -> index invalidate/refresh quando necessário
  -> mcp validation suite
  -> git diff/status
```

Para exclusões:

```text
quarantine plan
  -> quarantine
  -> validar
  -> somente depois considerar remoção definitiva
```

---

## 8. OAuth e segurança de conexão

### 8.1 OAuth

Estado observado:

- `mode=oauth`;
- `enforcement=all`;
- PKCE S256 anunciado;
- JWKS configurado;
- issuer/resource/audience alinhados;
- Protected Resource Metadata disponível;
- access token TTL de 1 hora;
- refresh token TTL de 7 dias;
- rotação one-time persistente;
- persistência somente de hashes de refresh tokens;
- `reauthRisk=low`;
- sem warnings críticos.

Essa é uma base forte.

### 8.2 Problema de permissões dentro da sessão SDK

Apesar da boa governança do MCP, `src/copilot/config/session-config.js` ainda contém:

```text
onPermissionRequest não fornecido -> warning -> approveAll
```

Ou seja, a ausência de handler explícito é convertida em aprovação total.

O mesmo conceito aparece em lifecycle, permission controller, routes e facades.

Isso não significa que todo fluxo esteja inseguro; significa que o **default semântico permanece fail-open** em uma área sensível.

Estado-alvo:

- produção/remoto/OAuth: fail-closed ou política positiva explícita;
- desenvolvimento/probe: `approveAll` somente por intenção explícita e auditada;
- nenhuma sessão mutante deve receber aprovação total apenas porque um callback foi esquecido.

---

## 9. Cloudflare, HTTP/2 e rede

### 9.1 Estado remoto

A auditoria remota reportou:

- tunnel `workspace-mcp-dev`: healthy;
- quatro conexões ativas/HA;
- DNS CNAME correto;
- ingress para `mcp.aurelin.org` apontando a `https://127.0.0.1:3333`;
- `originServerName=mcp.aurelin.org`;
- TLS verification ativa;
- `http2Origin=true`;
- cache bypass para rotas MCP/OAuth dinâmicas;
- rate limit moderado para `/oauth/token`;
- nenhum broad challenge/block sobre `/mcp` detectado.

### 9.2 Smoke persistido obsoleto

O último connector smoke persistido ainda data de 2026-06-14. Sua idade ultrapassava 88 mil minutos nesta auditoria.

Consequência:

- `mcp_connection_readiness.ready=true`;
- health local e público = 200;
- túnel remoto = healthy;
- mas `mcp_post_restart_readiness.ready=false` porque o smoke não é fresh.

Isso é um problema de estado operacional, não de conectividade real.

### 9.3 `context canceled` e request error rate

O log do `cloudflared` apresentou repetidos `context canceled` para o origin HTTPS.

As métricas mostraram aproximadamente:

- ~1.096 requests no momento do snapshot;
- ~257 request errors;
- `requestErrorRate` ~0,234;
- 4 HA connections;
- 0 QUIC closed connections;
- smoothed RTT ~22 ms;
- sem `packetTooBigDropped`.

Não se deve interpretar automaticamente 23,4% como “23,4% das chamadas do usuário falham”. Em MCP/SSE, cancelamentos podem fazer parte do lifecycle do stream. Contudo, o benchmark canônico do próprio projeto define `requestErrorRate=0` como gate ideal.

Portanto, o gap correto é: **classificar semanticamente e reduzir/eliminar a contagem de erros de transporte, separando cancelamento esperado de falha operacional**.

**Reconciliação da execução — 2026-08-14:** a inspeção de `cloudflare-post-change-gates.js` mostrou que o runtime já
classifica `context canceled`, encerramentos normais de stream e disconnects de cliente como eventos não acionáveis
quando smoke, origin, HA e métricas atuais estão saudáveis. O valor bruto `requestErrorRate` é um contador cumulativo da
vida do processo `cloudflared`, e não uma taxa isolada da janela corrente. O planner de benchmark foi atualizado para
comparar deltas before/after da janela de medição e exigir ausência de incrementos **não explicados**, em vez de exigir
que o contador histórico volte magicamente a zero. Os post-change gates atuais passaram sem críticos; o único warning
remanescente é precisamente a presença do agregado histórico.

### 9.4 Edge/config warnings

A edge já possui regras úteis, porém há avisos:

- não foi detectado rate limit explícito para abuso anônimo em `/mcp`;
- Browser Integrity Check está ligado na zona, embora regra MCP o desligue para rotas alvo;
- Rocket Loader/email obfuscation estão explicitamente desligados no passthrough MCP;
- alguns produtos, como Bot Fight Mode/Zaraz, não puderam ser determinados pela auditoria;
- RUM aparece zone-wide e deve ser tratado como irrelevante/bypassado explicitamente onde aplicável.

Nenhum desses avisos é blocker atual.

### 9.5 Rede do DevContainer

O DNS local está operacional:

- resolver local efetivo;
- `/etc/resolv.conf` apontando para cache local;
- warmup OK;
- `dnsmasq` ativo.

Há warnings de conflito de target port e split DNS desabilitado; exigem apenas revisão antes de otimizações de transporte.

---

## 10. Performance e IO

### 10.1 Índice

O índice está em boa condição e é uma das maiores fontes de autonomia do conector.

### 10.2 Cache

O runtime reportou L1 habilitado e L2/L3 desabilitados. O snapshot de uso teve hit ratio baixo (~4,7%), porém essa amostra foi produzida por uma auditoria exploratória com muitas leituras únicas — portanto não é benchmark representativo de workload normal.

A decisão correta é **não habilitar L2 por intuição**.

Estado-alvo:

- benchmark reproduzível de tree/read/search/symbol/import/patch;
- comparar cold, warm L1 e L2;
- só ativar L2 se reduzir latência/IO sem aumentar inconsistência, stale reads ou custo operacional.

### 10.3 Latência das tools MCP

No snapshot:

- handler médio ~71 ms;
- authorization médio ~0 ms;
- result-size phase ~1 ms;
- principal outlier: `mcp_cloudflare_remote_audit` ~3,5 s;
- `repo_find_orphan_imports` também é naturalmente mais caro.

O dashboard marcou error rate alto, mas parte dos erros foi deliberadamente produzida por esta auditoria ao testar paths inexistentes/protegidos. Métricas futuras devem classificar erro esperado de probe separadamente de falha operacional.

---

## 11. Artefatos, rollback e logs

### 11.1 Jobs

O maintenance report mostrou, após as validações desta auditoria:

- ~476 artefatos de job;
- retenção configurada: 240;
- ~236 artefatos acima da retenção;
- ~760 KB de candidatos de cleanup seguro.

O cleanup tool é bem desenhado: restringe-se a UUID `.json/.log` em `.ai/jobs` e não toca OAuth/tunnel/quarantine.

### 11.2 Rollback sidecars

`src/copilot/.ai/rollback` contém 19 arquivos `.rollback` observados, cada um em torno de 672 KB, totalizando aproximadamente **12,8 MB**, além de `.locks`.

O diretório aparece como untracked no status do workspace.

**Correção por inspeção de código — 2026-08-14:** a conclusão inicial de que não havia política equivalente estava
incompleta. `infra/io/fs/rollback-sidecar.js` já implementa TTL canônico de 24 horas, `expiresAt` por sidecar, cleanup
limitado a 512 entradas, execução do cleanup após commits e locks intra/multiprocesso. Portanto, os sidecars atuais não
devem ser removidos apenas por tamanho: enquanto válidos, eles fazem parte da garantia operacional de rollback. A
melhoria apropriada é observabilidade/budget do mecanismo já existente, não um cleanup paralelo que possa invalidar
rollbacks legítimos.

### 11.3 Logs Cloudflare/MCP

Foram reportados logs acima do threshold de 2 MiB:

- `cloudflared.log` ~2,94 MB;
- `mcp-http.log` ~2,99 MB.

Isso pede rotação/retention policy, não remoção ad hoc.

---

# Parte III — Drift documental e conhecimento canônico

## 12. Divergências verificadas

### 12.1 `presentation/agent-runtime.js`

Os READMEs de `src/copilot`, `agent` e `terminal` ainda citam `presentation/agent-runtime.js`.

O arquivo não existe. A arquitetura atual está modularizada sob `presentation/agent/runtime/` e `presentation/runtime/`.

### 12.2 `presentation/runtime-ui-state-store.js`

`terminal/README.md` ainda cita esse path antigo. O estado atual está modularizado sob `presentation/state/ui-store/`.

### 12.3 `mcp/README.md` e origin HTTP

O README ainda contém orientações baseadas em `http://127.0.0.1:3333` como origin remoto canônico em trechos importantes.

O estado atual validado é:

```text
https://127.0.0.1:3333
origin transport: HTTP/2
Cloudflare http2Origin=true
```

### 12.4 `sdk/README.md` e versão do SDK

O README contém histórico de alinhamento com `@github/copilot-sdk@0.3.0` e uma “próxima onda” construída sobre essa época.

O lock atual declara/instala `@github/copilot-sdk` **1.0.9**.

O histórico pode permanecer, mas precisa ser identificado como histórico e separado do contrato vigente.

### 12.5 Roadmap do Model Gateway

O roadmap especializado de 2026-06-15 ainda contém tarefas abertas que já aparecem implementadas no código atual, como promoção segura de operações `deferred_until_turn_boundary` após `assistant.turn_end`.

O código atual possui:

- `model-gateway/control-plane/deferred-route-operation.js`;
- política fail-closed de promoção;
- TTL de autorização;
- validação de mesma sessão;
- `terminal/byok/deferred-route-promotion.js`;
- integração terminal para promoção em boundary seguro.

Logo, o roadmap especializado precisa ser reconciliado por evidência e não apenas continuado linearmente.

### 12.6 Ausência de índice documental

`src/copilot/docs/INDEX.md` não existe.

Com a quantidade atual de relatórios, roadmaps, investigações e runbooks, isso já é uma dívida arquitetural de conhecimento.

---

# Parte IV — Achados priorizados

## 13. P0 — pré-condições de máxima autonomia

### P0-A — Blind spot causado por `public/` no `.gitignore`

**Impacto:** scanners/indexadores podem esconder facades canônicos; o agente perde descoberta, símbolos e contexto.  
**Risco:** navegação incompleta, refactor com contexto parcial, falso diagnóstico de arquivo ausente.  
**Ação:** tornar o ignore root-scoped (`/public/`) ou criar exceções explícitas para source directories canônicos; validar efeito no índice e Git.

### P0-B — Baseline Git ambíguo

**Impacto:** difícil atribuir regressões e diffs a um incremento.  
**Ação:** classificar e checkpointar mudanças atuais antes de refactor amplo.

---

## 14. P1 — hardening de curto prazo

### P1-A — Smoke persistido obsoleto

Atualizar smoke e fazer `mcp_post_restart_readiness.ready=true`.

### P1-B — Request error rate do cloudflared

Separar `context canceled` benigno de falhas reais; executar benchmark QUIC/auto/HTTP2 com gates iguais.

### P1-C — Default de permissões configurável, com `approve_all` preservado

**Decisão de produto confirmada em 2026-08-14:** `approve_all` deve continuar sendo o default intencional. O hardening
não consiste em torná-lo fail-closed, e sim em eliminar fallbacks divergentes: todos os call sites sem override devem
usar uma política única e facilmente configurável por `AGENT_PERMISSION_MODE`, preservando `approve_all` quando a
variável não é definida e oferecendo `audit_only`/`selective` quando desejado.

### P1-D — Drift documental canônico

Corrigir caminhos, transporte, versões e roadmaps que já divergem do código.

### P1-E — Hotspot `terminal/commands/byok.js`

Decompor por casos de uso sem alterar semântica ou ownership.

### P1-F — Retenção e rotação

Normalizar jobs, rollback sidecars e logs.

---

## 15. P2 — qualidade e escala

### P2-A — Resolver aliases/package imports no orphan detector

Evitar falsos positivos e classificar paths protegidos.

### P2-B — Formalizar contrato SDK 1.0.9+

Matriz supported/passthrough/experimental/blocked/deprecated.

### P2-C — Decompor demais hotspots

Model Gateway store/routing, MCP OAuth, tool surfaces e terminal events.

### P2-D — Benchmark L2

Só habilitar cache persistente após prova objetiva.

### P2-E — Governança Cloudflare refinada

Rate-limit anônimo MCP, edge audit e classificação de produtos zone-wide.

### P2-F — Índice documental canônico

Criar `docs/INDEX.md` com status e supersession.

---

# Parte V — Situação ideal proposta

## 16. Estado-alvo arquitetural e operacional

A situação ideal não é “zero arquivos grandes” nem “100% de autonomia sem confirmações”. É um sistema em que o ChatGPT consegue agir com poder elevado **porque** os contratos, limites e rollback são fortes.

### 16.1 Git e causalidade

- Cada incremento começa de um baseline explicitamente classificado.
- Mudanças preexistentes têm owner/intenção.
- Refactors grandes têm checkpoint recuperável.
- Artefatos gerados não poluem `git status`.

### 16.2 Descoberta completa

- Nenhuma pasta de source canônica é ocultada por ignore genérico.
- `repo_tree`, índice, símbolos e import analysis veem a mesma topologia lógica.
- Aliases de `package.json#imports` são resolvidos nativamente pelo scanner.
- Paths protegidos são reportados como `protected/unverifiable`, nunca como `missing`.

### 16.3 Arquitetura

- `sdk` continua SSOT do vanilla.
- `agent` continua source-of-truth do runtime.
- `presentation` continua boundary compartilhada.
- `terminal` continua UX, não domain service.
- `model-gateway` concentra routing/provider policy sem transformar `terminal/commands/byok.js` em segundo control plane.
- Composition roots são explícitos.
- Barrels são puros.
- Hotspots têm owners e planos de decomposição.

### 16.4 Segurança

- `approve_all` continua sendo o default de produto, porém como **policy central explícita e configurável**, não como fallback duplicado em vários call sites.
- `AGENT_PERMISSION_MODE=audit_only|selective` permite alterar a policy sem editar consumidores.
- Bounded writes usam plan + hash/precondition.
- Destrutivo prefere quarantine.
- OAuth permanece max-power no escopo do repo, com write confirmations do host tratadas como boundary externo.

### 16.5 MCP/Cloudflare

- connector smoke fresh após restart/config/auth/DNS changes;
- `mcp_post_restart_readiness.ready=true`;
- 4 HA connections;
- DNS/origin/HTTP2 alinhados;
- request errors classificados por tipo;
- benchmark escolhe transporte por dados, não preferência;
- edge rules versionadas por plan/diff/snapshot/backup.

### 16.6 Validação

- typecheck/lint/unit-copilot/unit-mcp verdes antes de merges relevantes;
- import resolution e docs path checks automatizados;
- contratos de boundary entram no CI;
- live tests são reservados a features realmente live e possuem harness sem critérios obsoletos.

### 16.7 Performance

- índice fresh;
- cache configurado por benchmark;
- latência observada por fase;
- probes deliberadamente inválidos não contaminam SLO de erro operacional.

### 16.8 Conhecimento

- `src/copilot/docs/INDEX.md` identifica `current`, `runbook`, `roadmap`, `historical`, `superseded`, `investigation`;
- um documento atual nunca referencia path inexistente sem marcar histórico;
- roadmaps são reconciliados com código antes de continuar novas fases.

### 16.9 Retenção

- jobs dentro do limite definido;
- rollback sidecars com TTL/count/bytes policy;
- logs com rotação;
- estado OAuth/tunnel protegido e fora de qualquer cleanup genérico.

---

# Parte VI — Matriz de gaps

## 17. Gap matrix

| ID | Gap | Prioridade | Estado em 2026-08-14 | Evidência / próximo fechamento |
| --- | --- | --- | --- | --- |
| G-01 | `public/` ocultava source canônico a scanners | P0 | **Fechado** | `.gitignore` agora usa `/public/`; `infra/public` aparece em tree e índice; gate anti-regressão criado |
| G-02 | worktree não classificada/limpa | P0 | **Mitigado, aberto** | baseline preexistente foi registrado e protegido; owner de todos os untracked externos ainda não foi formalizado |
| G-03 | connector smoke stale | P1 | **Fechado** | smoke autenticado fresh, 102/102 tools; post-restart readiness true |
| G-04 | `requestErrorRate` Cloudflare ~23% sem semântica de janela | P1 | **Semântica corrigida; benchmark aberto** | contador documentado como cumulativo; gates classificam cancelamentos benignos; benchmark planner usa deltas |
| G-05 | fallback de permissão divergente | P1 | **Fechado na policy central** | `approve_all` preservado como default intencional; `AGENT_PERMISSION_MODE` permite override; call sites e gate unificados |
| G-06 | drift de READMEs/roadmaps | P1 | **Fechado nos hubs prioritários** | READMEs centrais corrigidos; INDEX criado; June audit e Model Gateway roadmap reconciliados; long tail histórico é sob demanda |
| G-07 | `byok.js` extremo | P1 | **Em redução** | primeira extração removeu ~13,7 KB/~344 linhas; rendering ganhou módulo/barrel/testes; ceiling impede regressão |
| G-08 | jobs/rollback/log retention | P1 | **Majoritariamente fechado** | jobs limpos; rollback TTL/count já existiam; rotação pre-start >2 MiB implementada; rollover físico aguarda próximo restart |
| G-09 | orphan detector sem package imports/protected state | P2 | **Source/test fechado; reload live pendente** | aliases/wildcards/conditionals resolvidos e protected separado no código; processo MCP atual ainda serve módulo antigo até restart controlado |
| G-10 | SDK docs/contract defasados | P2 | **Parcialmente fechado** | README 1.0.9 + declared/installed/alias gates; matriz semântica completa de capabilities ainda aberta |
| G-11 | L2 sem benchmark representativo | P2 | **Decisão segura implementada** | default continua off; planner exige benchmark; canary funcional existe; performance cold/L1/L2 ainda aberta |
| G-12 | edge sem rate-limit explícito `/mcp` | P2 | **Mitigado** | edge não tem regra dedicada, mas origin anonymous limiter está ativo 40 req/10s; auth não sofre broad challenge |
| G-13 | docs sem INDEX | P2 | **Fechado** | `src/copilot/docs/INDEX.md` criado, com precedência/status/session-prime |
| G-14 | hotspots secundários | P2 | **Guardrail fechado; refactor aberto** | ceilings para 12 hotspots no CI; decomposição funcional continua incremental |
| G-15 | métricas misturam cancelamentos/probe errors e falhas reais | P2 | **Parcialmente fechado** | Cloudflare post-change classifica benignos; série numérica separada/SLO por família ainda é próximo passo |

---

# Parte VII — Roadmap completo por faixas, fases e subfases

## 18. Faixa 0 — Congelar evidência e proteger causalidade

**Objetivo:** garantir que todo trabalho posterior seja atribuível, reversível e verificável.

### Fase 0.1 — Baseline Git

- [x] Registrar branch `main` e HEAD `6f2707e5a` desta auditoria.
- [x] Registrar que a worktree já estava suja antes do novo documento.
- [x] Separar explicitamente o conjunto preexistente/untracked da lista de arquivos criados ou modificados por esta execução; itens preexistentes foram tratados como `preexisting-protected` quando o propósito não era conhecido.
- [ ] Definir owner/propósito semântico para cada artefato preexistente externo a esta execução; isso exige informação autoral que o Git status sozinho não fornece.
- [ ] Criar checkpoint/branch/commit quando o conjunto atual estiver pronto para integração; nenhum commit automático foi criado sobre a worktree já suja.
- [x] Garantir que nenhum cleanup automático toque mudanças desconhecidas: o cleanup executado ficou restrito aos UUID jobs allowlisted de `.ai/jobs`.

**Critério de saída:**

- [x] A causalidade desta onda está separada do baseline preexistente; a limpeza/ownership do long tail preexistente permanece uma tarefa Git humana/projetual, não um blocker técnico para os patches bounded já aplicados.

### Fase 0.2 — Preservar baseline de validação

- [x] Typecheck atual passou.
- [x] Lint atual passou.
- [x] Unit MCP atual passou.
- [x] Unit Copilot atual passou.
- [x] Reexecutar suites completas após os patches estruturais: Copilot final e MCP final verdes.

**Critério de saída:**

- [x] A onda termina sem gate vermelho conhecido no validation dashboard.

---

## 19. Faixa 1 — Restaurar descoberta completa do source

**Objetivo:** fazer o WORKSPACE enxergar a topologia canônica sem conhecimento prévio de paths ocultos.

### Fase 1.1 — Corrigir o ignore de `public/`

- [x] Confirmar que a regra genérica `public/` produzia blind spot em source canônico.
- [x] Observar o efeito real no Git status após remover o ignore global: `buffer.js`, `locks.js` e `observability.js` já existiam fisicamente e agora aparecem como untracked source candidates; foram preservados sem auto-add/delete por autoria desconhecida.
- [x] Trocar `public/` por regra root-scoped `/public/`.
- [x] Preservar o output de build `public` da raiz como ignored.
- [x] Testar `repo_tree path="src/copilot/infra/public"`: 16 arquivos descobertos.
- [x] Rebuild do índice de `src/copilot`.
- [x] Confirmar conteúdo/símbolos de `infra/public` pesquisáveis no índice FTS.

### Fase 1.2 — Gate de regressão de discoverability

- [x] Adicionar checker que falha se `.gitignore` voltar a conter `public/` global em vez de `/public/`.
- [x] Verificar no gate que a façade canônica `src/copilot/infra/public/cache.js` existe.
- [x] Manter boundary/source checks para `presentation` e budgets das demais surfaces críticas no architecture checker.
- [ ] Generalizar o checker para descobrir automaticamente toda nova source surface canônica declarada no module map.

**Critério de saída:**

- [x] A surface `infra/public` canônica é novamente descobrível por tree/index e possui gate anti-regressão para a causa conhecida.

---

## 20. Faixa 2 — Higiene imediata do conector e do runtime

**Objetivo:** transformar readiness lógica em readiness operacional fresh.

### Fase 2.1 — Connector smoke

- [x] `mcp_connection_readiness` reporta ready=true.
- [x] tunnel remoto está healthy.
- [x] health local responde 200.
- [x] health público responde 200.
- [x] Executar `mcp_connector_smoke_refresh` autenticado.
- [x] Confirmar smoke `ok=true`, 102/102 tools e fresh.
- [x] Confirmar `mcp_post_restart_readiness.ready=true`.

### Fase 2.2 — Classificar `context canceled`

- [x] Correlacionar `context canceled`/stream close com lifecycle MCP/SSE e client disconnect normal nos post-change gates.
- [x] Separar cancelamento esperado de origin/transport failure acionável.
- [x] Documentar no snapshot de métricas que `requestErrorRate` é cumulativo pela vida do processo.
- [x] Alterar o benchmark planner para usar deltas before/after da janela e erros não explicados.
- [x] Validar post-change gates atuais sem críticos, com warning apenas para o agregado histórico.
- [ ] Acrescentar contador separado de cancelamentos benignos no exporter caso a observabilidade por causa exija série própria.
- [ ] Definir SLO numérico final por janela após benchmark controlado de transporte.

### Fase 2.3 — Benchmark de transporte

- [x] Capturar baseline QUIC atual.
- [ ] Executar protocolo `quic` com amostra controlada.
- [ ] Executar protocolo `auto` com a mesma amostra.
- [ ] Executar protocolo `http2` com a mesma amostra.
- [ ] Comparar HA connections, smoke, OAuth, request error class, p50/p95/p99 e RTT.
- [ ] Escolher default por evidência.
- [ ] Registrar rollback explícito para o protocolo escolhido.

**Critério de saída:**

- [ ] Transporte selecionado atende gates de estabilidade e latência documentados.

---

## 21. Faixa 3 — Segurança de permissões e autonomia responsável

**Objetivo:** manter alto poder operacional sem defaults mutantes implícitos.

### Fase 3.1 — Política de `onPermissionRequest`

- [x] Confirmar o comportamento histórico de fallback `approveAll`.
- [x] Mapear os call sites que dependiam implicitamente dele.
- [x] Consolidar a policy em `AGENT_PERMISSION_MODE`/`PermissionController`.
- [x] Tornar builders, lifecycle, AlwaysAlive e rotas SDK explicitamente policy-driven.
- [x] Preservar `approve_all` como **default intencional do produto**, conforme decisão confirmada nesta execução.
- [x] Expor `audit_only` e `selective` como overrides sem mudança de call site.
- [x] Confirmar evento dedicado de mudança de policy no runtime: `EMITTER_PERMISSION_MODE_CHANGED`, consumível pela projeção terminal, além do log do controller.
- [x] Adicionar testes para ausência de handler/default e override `selective`.
- [x] Adicionar gate que impede reintrodução silenciosa de fallback `approveAll` nos call sites centrais.

### Fase 3.2 — Fricção de aprovação do host

- [x] Confirmar OAuth max-power e `reauthRisk=low`.
- [x] Confirmar plan tools e bounded-write annotations.
- [ ] Executar suíte `mcp_golden_prompts` em uma sessão ChatGPT limpa.
- [ ] Registrar número de prompts de aprovação por cenário.
- [ ] Usar remembered approval apenas para bounded writes confiáveis quando oferecido pelo host.
- [ ] Nunca tentar contornar confirmação host de destructive actions.

### Fase 3.3 — Tool contracts

- [ ] Auditar as tools críticas para output schemas específicos, não apenas passthrough mínimo.
- [ ] Priorizar repo write, validation, Cloudflare apply, Model Gateway mutation e quarantine.
- [ ] Garantir erros tipados, exemplos, redaction e idempotência declarada.

**Critério de saída:**

- [ ] Autonomia elevada depende de política explícita, não de permissividade implícita.

---

## 22. Faixa 4 — Reconciliação documental canônica

**Objetivo:** fazer a documentação ensinar a arquitetura que realmente existe hoje.

### Fase 4.1 — Hubs principais

- [x] Atualizar `src/copilot/README.md` para paths atuais de `presentation` e apontar para o índice documental.
- [x] Atualizar `agent/README.md` removendo `presentation/agent-runtime.js` obsoleto.
- [x] Atualizar `terminal/README.md` para `presentation/agent/runtime` e `presentation/state/ui-store` atuais.
- [x] Atualizar `mcp/README.md` para origin HTTPS/HTTP2 atual.
- [x] Separar endpoint HTTP local/compatibilidade do origin remoto HTTPS/HTTP2 canônico.
- [x] Atualizar `sdk/README.md` com baseline 1.0.9, histórico 0.3.0 e política de permissões vigente.

### Fase 4.2 — Índice de documentação

- [x] Criar `src/copilot/docs/INDEX.md`.
- [x] Definir classes de autoridade/status (`CANÔNICO / ATIVO`, `RUNBOOK ATIVO`, `HISTÓRICO / SUPERADO PARCIALMENTE`, `ARQUIVADO`).
- [x] Definir precedência entre código/testes, READMEs, índice, roadmap mestre, runbooks e documentos históricos.
- [x] Linkar este diagnóstico como coordenação transversal ativa.
- [ ] Evoluir o índice para registrar owner nominal de cada roadmap especializado quando esse ownership for formalizado no projeto.

### Fase 4.3 — Checker de paths documentais

- [x] Implementar `docs-contract-check.js` para paths/drifts canônicos conhecidos, versão SDK e origin MCP.
- [x] Excluir o próprio INDEX da proibição de referências obsoletas quando elas aparecem como anti-regressão/histórico.
- [x] Integrar o checker às safe suites e ao CI principal.
- [ ] Generalizar parsing de todos os links/backticks dos documentos canônicos sem elevar falsos positivos históricos.

### Fase 4.4 — Reconciliar roadmaps especializados

- [x] Revisar auditoria ampla de 2026-06-13 e marcá-la como histórica/superada parcialmente.
- [x] Reconciliar o roadmap prioritário do Model Gateway com a promoção automática em `assistant.turn_end`.
- [x] Marcar tarefas comprovadas como `[x]` somente com evidência atual.
- [x] Manter o live harness ainda não repetido como `[ ]`.
- [ ] Reconciliar individualmente todo o long tail de roadmaps históricos quando voltar a ser usado como plano ativo.

**Critério de saída:**

- [x] A topologia vigente pode ser reconstruída pelos READMEs canônicos + `docs/INDEX.md` + WORKSPACE, com histórico separado do contrato atual.

---

## 23. Faixa 5 — Corrigir análise de imports e precisão das ferramentas

**Objetivo:** tornar os diagnósticos do próprio WORKSPACE confiáveis o bastante para virar gates.

### Fase 5.1 — `package.json#imports`

- [x] Fazer `repo_find_orphan_imports` resolver `imports` do package.json.
- [x] Cobrir aliases exatos, wildcards e targets condicionais (`import`/`node`/`default`).
- [x] Adicionar fixtures para `#copilot/sdk/di`, `#copilot/sdk/agents`, `#copilot/sdk/session-runtime`.
- [x] Validar alias dinâmico para `#copilot/infra/public/cache`.
- [x] Usar cache TTL curto de 30 s para o mapa de imports, evitando stale state em processo persistente.

### Fase 5.2 — Paths protegidos

- [x] Introduzir classificação `protected/unverifiable` no detector.
- [x] Nunca reportar `ERR_PATH_DENIED` como `missing`.
- [x] Preservar a política de não revelar conteúdo protegido além do permitido.

### Fase 5.3 — Output do detector

- [x] Separar `trueOrphanCount` de `aliasResolutionGapCount` e `protectedCount`.
- [x] Incluir estratégia de resolução usada por match.
- [x] Criar teste com dynamic imports, package imports e path protegido.
- [x] Adicionar gates de existência para aliases SDK exatos no architecture checker.

**Critério de saída:**

- [x] No source/test state, os falsos positivos conhecidos desta auditoria — aliases de package imports e path protegido — estão cobertos por resolução semântica e testes.
- [ ] Revalidar a tool live depois que o processo MCP carregar o novo módulo em um restart controlado.

---

## 24. Faixa 6 — Decomposição de hotspots sem rewrite

**Objetivo:** reduzir custo cognitivo mantendo comportamento.

### Fase 6.1 — `terminal/commands/byok.js`

- [x] Congelar comportamento por suíte Copilot existente e novo teste dos helpers extraídos.
- [x] Inventariar o hotspot por outline/size antes da primeira extração.
- [ ] Separar parsing de comando de application service.
- [x] Iniciar extração de rendering semântico sem mover estado/routing.
- [ ] Extrair profile management.
- [ ] Extrair probe/evaluation flows.
- [ ] Extrair route switch/auto/reconcile commands.
- [x] Extrair helpers de labels/formatação para `terminal/byok/rendering/labels.js` com barrel próprio.
- [ ] Fazer terminal chamar os mesmos application services usados pelas tools em todos os casos equivalentes.
- [ ] Manter `commands/byok.js` como router/orchestrator fino ao final da decomposição.
- [x] Preservar taxonomia/UX dos labels por testes dedicados.

### Fase 6.2 — Model Gateway storage/routing

- [ ] Decompor `sqlite-catalog-store.js` por ledger/store bounded contexts.
- [ ] Separar migrations/schema, queries, operations, handoffs e health history.
- [ ] Reduzir `runtime-selector.js` em policy + evidence + projection.
- [ ] Reduzir `policy-engine.js` em regras composáveis e testáveis.

### Fase 6.3 — MCP hotspots

- [ ] Decompor `dev-oauth.js` por metadata, token issuance, DCR/client store, DPoP/private-key-jwt e persistence.
- [ ] Decompor `repo-write.js` por mutation primitives/patch/batch/quarantine contracts.
- [ ] Modularizar `oauth-smoke.js` em cenários reutilizáveis.

### Fase 6.4 — Terminal events/dialog

- [ ] Decompor `sdk-session-events.js` por grupos de eventos sem alterar registration semantics.
- [ ] Isolar lifecycle/tool/task/assistant projections.
- [ ] Revisar `dialog/engine.js` para manter apenas orchestration hot path.

### Fase 6.5 — Guardrail de tamanho

- [ ] Tornar o module-map/scorecard a fonte única de thresholds por tipo de módulo; nesta onda os ceilings foram codificados no checker para proteção imediata.
- [x] Criar gate que aceita legacy hotspots dentro do baseline atual, mas impede crescimento acima dos ceilings definidos.
- [x] Cobrir os doze hotspots prioritários identificados nesta auditoria.
- [x] Integrar o architecture checker à safe suite e ao CI.
- [ ] Migrar os ceilings do script para metadata arquitetural compartilhada quando o module-map oferecer contrato apropriado.

**Critério de saída:**

- [x] O CI agora impede crescimento silencioso dos hotspots priorizados; a decomposição completa continua incremental.

---

## 25. Faixa 7 — Model Gateway: consolidar o control plane real

**Objetivo:** fechar a distância entre código atual, live behavior e roadmap especializado.

### Fase 7.1 — Reconciliação do estado implementado

- [x] Existe classificação fail-closed de deferred route operation.
- [x] Existe promoção terminal de route switch diferido em boundary seguro.
- [x] Integrar a promoção automática ao `assistant.turn_end`, antes do drain da próxima mensagem.
- [x] A promoção preserva mesma sessão e idempotency key por design.
- [x] Atualizar roadmap especializado com essas evidências e cobertura de testes.
- [x] Manter como abertas apenas as provas live/reconcile ainda não repetidas formalmente no HEAD atual.

### Fase 7.2 — Live proof atual

- [ ] Reexecutar cenário mínimo de route switch com harness atual.
- [ ] Confirmar PASS formal, não apenas evidência operacional.
- [ ] Validar continuidade da mesma SDK session.
- [ ] Validar operation ledger final `committed`.
- [ ] Confirmar `/errors` sem regressão.
- [ ] Confirmar health/tools/usage projections coerentes.

### Fase 7.3 — Terminal/tools unificados

- [ ] Identificar casos ainda implementados diretamente em `terminal/commands/byok.js`.
- [ ] Migrar cada caso para application/control-plane service compartilhado.
- [ ] Manter terminal como adapter humano.
- [ ] Manter tools como adapter estruturado para LLM.

### Fase 7.4 — Legacy removal

- [ ] Medir uso de caminhos env/preset legados.
- [ ] Remover apenas caminhos com telemetria de não uso ou substituição comprovada.
- [ ] Preservar compatibilidade explicitamente necessária.

**Critério de saída:**

- [ ] Model Gateway possui uma semântica única para humano e LLM-B.

---

## 26. Faixa 8 — Contrato SDK 1.0.9+ e typing hardening

**Objetivo:** impedir que upgrades do SDK produzam drift silencioso.

### Fase 8.1 — Matriz de versão

- [x] Registrar SDK instalado 1.0.9 e separar esse baseline do histórico 0.3.0.
- [x] Adicionar gate `declared (^1.0.9) <-> installed (1.0.9)` no architecture checker.
- [x] Verificar que os aliases exatos `#copilot/sdk*` do `package.json#imports` apontam para targets existentes.
- [ ] Inventariar semanticamente todas as capabilities 1.0.9 usadas localmente.
- [ ] Classificar cada capability como `supported`, `passthrough`, `experimental`, `blocked`, `deprecated`.
- [ ] Registrar version floor/ceiling além do alinhamento da versão instalada atual.

### Fase 8.2 — Config e schemas

- [ ] Validar campos recentes do SessionConfig/CustomAgentConfig contra surfaces locais.
- [ ] Criar schemas para campos que hoje passam crus.
- [ ] Adicionar snapshots de contrato de config.
- [ ] Falhar de forma explícita para campo não suportado em vez de ignorar silenciosamente.

### Fase 8.3 — TypeScript progressivo

- [ ] Priorizar conversão de módulos pequenos/estáveis do SDK para TS.
- [ ] Preservar `erasableSyntaxOnly` e NodeNext.
- [ ] Reduzir dependência de JSDoc complexo nos hot paths.
- [ ] Medir impacto antes de converter módulos gigantes.

### Fase 8.4 — `skipLibCheck`

- [ ] Reavaliar incompatibilidade de `vscode-jsonrpc` com TS 6.
- [ ] Atualizar/isolar dependência quando possível.
- [ ] Tornar `skipLibCheck=false` viável sem quebrar por typing externo.

**Critério de saída:**

- [ ] Upgrade do Copilot SDK produz diff de contrato explícito e testável.

---

## 27. Faixa 9 — IO, cache e índice orientados a benchmark

**Objetivo:** melhorar performance sem sacrificar frescor e simplicidade.

### Fase 9.1 — Workload canônico

- [ ] Definir workload de `repo_tree`.
- [ ] Definir workload de `repo_read_file` hot/cold.
- [ ] Definir workload de text search.
- [ ] Definir workload de symbol/index search.
- [ ] Definir workload de orphan import scan.
- [ ] Definir workload de patch plan/diff.

### Fase 9.2 — Baselines

- [ ] Medir cold start.
- [ ] Medir L1 warm.
- [ ] Medir com L2 em canary.
- [ ] Medir memória, CPU, bytes e stale risk.
- [ ] Medir após restart do MCP.

### Fase 9.3 — Decisão L2

- [x] Manter L2 desativado por default até existir evidência representativa.
- [x] Tornar `buildIoCacheTierPlan` evidence-gated: pressão de files/hotset gera `benchmark-required`, não recomendação automática de enable.
- [x] Só retornar `enable-supported-by-benchmark` quando `representativeBenchmarkPassed=true`.
- [x] Confirmar que já existe canary funcional cross-process/SQLite para perfil experimental L2 no CI.
- [ ] Executar benchmark de performance representativo cold/L1/L2 antes de promover o perfil experimental.
- [ ] Definir/revalidar TTL/eviction pelo workload vencedor.
- [ ] Expandir testes de invalidação para writes, moves e quarantine no benchmark de integração.
- [x] Manter fallback para filesystem/índice canônico e default L1.

### Fase 9.4 — Métricas

- [ ] Separar erro deliberado de probe de erro de produção.
- [ ] Persistir snapshots de latência em janelas comparáveis.
- [ ] Definir SLO por família de tool.

**Critério de saída:**

- [ ] Cache e índice têm ganho mensurável e não introduzem ambiguidade de estado.

---

## 28. Faixa 10 — Cloudflare edge e transporte como infraestrutura versionada

**Objetivo:** garantir que mudanças externas sejam auditáveis e reversíveis.

### Fase 10.1 — Edge desired state

- [x] Cache bypass MCP/OAuth existe.
- [x] `/oauth/token` possui rate limit.
- [x] Não foi detectado broad challenge/block em `/mcp`.
- [x] Confirmar mitigação de abuso anônimo no origin MCP: limiter habilitado em 40 requests/10 s, até 10.000 buckets.
- [x] Confirmar no edge audit ausência de regra ampla que estrangule sessões autenticadas MCP.
- [x] Confirmar overrides MCP para BIC/Rocket Loader/email obfuscation nas rotas alvo.
- [ ] Obter/registrar estado de Bot Fight/Zaraz quando a API/auditoria disponibilizar essa leitura; não é blocker atual.

### Fase 10.2 — Mutation discipline

- [ ] Exigir edge snapshot antes de qualquer change.
- [ ] Exigir backup persistido antes de apply.
- [ ] Executar diff desired vs actual.
- [ ] Aplicar em dry-run antes de real mutation.
- [ ] Executar post-change gates.

### Fase 10.3 — Transport observability

- [x] Documentar que `requestErrorRate` bruto é cumulativo pela vida do processo.
- [x] Tornar o plano de benchmark derivado por deltas before/after da janela e erro acionável.
- [x] Reusar classificação de `context canceled`/stream disconnect dos post-change gates.
- [ ] Expor série/exporter derivado por janela, além da semântica documentada no snapshot.
- [ ] Correlacionar logs com request/session IDs sem expor tokens quando o transport fornecer identificador estável.
- [ ] Definir alerta persistido para queda de HA connections.
- [x] `mcp_post_restart_readiness` já alerta smoke stale; manter esse gate como contrato operacional.

**Critério de saída:**

- [ ] Nenhuma mudança Cloudflare relevante depende apenas de dashboard manual ou memória operacional.

---

## 29. Faixa 11 — Retenção, logs e rollback governance

**Objetivo:** impedir crescimento silencioso de estado local sem perder rollback útil.

### Fase 11.1 — Jobs

- [x] Retenção-alvo de 240 existe.
- [x] Cleanup de jobs é restrito e seguro por design.
- [x] Executar dry-run do cleanup e revisar exatamente os candidatos.
- [x] Remover 240 candidatos UUID além da retenção, totalizando 773.341 bytes na primeira limpeza desta execução.
- [x] Confirmar zero falhas e exclusão explícita de OAuth/tunnel/pid/quarantine do cleanup genérico.
- [ ] Reexecutar cleanup bounded ao final de grandes ondas de validação quando novos jobs ultrapassarem a retenção.

### Fase 11.2 — Rollback sidecars

- [x] Identificar owner/lifecycle em `infra/io/fs/rollback-sidecar.js`.
- [x] Confirmar TTL canônico existente de 24 horas e `expiresAt` persistido.
- [x] Confirmar cleanup limitado a 512 entradas e executado sob locks após commits.
- [x] Preservar sidecars ainda válidos; não apagar por tamanho isoladamente.
- [ ] Adicionar report explícito de bytes/count/idade dos sidecars ao maintenance plan para observabilidade centralizada.
- [ ] Definir budget de bytes apenas se medições mostrarem necessidade além do TTL/count já existentes.
- [x] Preferir preservação/quarantine quando houver incerteza sobre rollback ainda utilizável.

### Fase 11.3 — Logs

- [x] Implementar rotação pré-start/restart para logs de processos detached acima de 2 MiB, cobrindo `cloudflared.log`.
- [x] A mesma primitive cobre `mcp-http.log` quando iniciado pelo supervisor detached.
- [x] Preservar uma geração `.1` para incident analysis.
- [x] Executar a rotação somente quando o processo ainda não está vivo, evitando renomear inode de processo saudável.
- [ ] Confirmar rollover físico dos logs atuais no próximo restart controlado; não reiniciar serviço saudável apenas para truncar log.

**Critério de saída:**

- [ ] `.ai` possui budgets explícitos e nenhum arquivo operacional cresce indefinidamente.

---

## 30. Faixa 12 — CI e governança contínua

**Objetivo:** transformar os principais achados desta auditoria em regressões impossíveis ou visíveis.

### Fase 12.1 — Gates de source discovery

- [x] Gate anti-regressão para `public/` global no `.gitignore` e existência da façade `infra/public/cache.js`.
- [x] Gate para aliases SDK exatos do `package.json#imports` apontarem para targets reais.
- [x] Gate documental para referências canônicas obsoletas, baseline SDK e origin MCP.
- [ ] Generalizar source discovery gate a qualquer nova surface canônica declarada futuramente no module map.

### Fase 12.2 — Gates arquiteturais

- [x] Criar file-size ceilings para os hotspots prioritários e impedir crescimento além do baseline autorizado.
- [x] Integrar architecture/docs checks às safe suites e ao CI principal.
- [x] Detectar `presentation -> terminal` como violação da fronteira compartilhada.
- [ ] Generalizar bypass checks de `presentation` para todos os contratos em que uma projection compartilhada seja obrigatória.

### Fase 12.3 — Gates de segurança

- [x] Testar/impedir fallback oculto `approveAll` nos call sites centrais sem alterar o default intencional `approve_all` da policy.
- [x] Preservar destructive tools fora de cleanup/mutation genérico e sem contornar confirmações do host.
- [x] Cobrir path protegido no detector sem convertê-lo em ausência nem revelar conteúdo.
- [ ] Adicionar suite negativa específica para todas as famílias destructive quando novos tools forem adicionados.

### Fase 12.4 — Gates de readiness

- [x] Validar registry remoto/local no connector smoke: 102/102 tools nesta execução.
- [x] Validar OAuth metadata/fluxo autenticado no smoke e audit atuais.
- [x] Validar stateful session contract em `mcp_post_restart_readiness`.
- [x] Validar Cloudflare desired-state de forma read-only por remote/edge audit + policy diff + post-change gates.
- [ ] Levar todos esses audits externos para CI somente quando houver credentials/read-only environment adequado; no repo CI local, mantê-los doctor/runtime gates.

### Fase 12.5 — Freshness

- [x] O validation dashboard/jobs já expõe idade/estado dos últimos gates executados.
- [x] `mcp_post_restart_readiness` expõe/usa idade do connector smoke e falha quando stale.
- [x] `docs-contract-check.js` falha quando o README SDK não menciona a versão instalada do lock atual.
- [ ] Consolidar essas três idades em um único snapshot de session-prime.

**Critério de saída:**

- [ ] Os maiores riscos atuais deixam de depender de memória humana para não regressar.

---

## 31. Faixa 13 — Consolidação de máxima autonomia para ChatGPT/LLM-B

**Objetivo:** reduzir o custo operacional de cada novo incremento.

### Fase 13.1 — Session prime automática/documentada

- [x] `mcp_session_profile` existe.
- [x] `mcp_tools_status` existe.
- [x] `mcp_autonomy_power_score` existe.
- [x] Documentar sequência mínima de início de sessão no `docs/INDEX.md`.
- [ ] Tornar `repo_status + index status + validation freshness + readiness` uma única tool/snapshot compacto; hoje a sequência está documentada e cada surface existe separadamente.

### Fase 13.2 — Approval minimization

- [x] Recuperar `mcp_golden_prompts` v4 e confirmar os oito cenários/métricas canônicos.
- [ ] Medir prompts de aprovação em sessão ChatGPT realmente limpa; a UI do host não é observável com fidelidade a partir desta execução backend.
- [x] Preferir plan-only antes de writes — disciplina usada nesta implementação.
- [x] Preferir batch somente quando os alvos são inequívocos e confiáveis.
- [x] Preservar quarantine/reversibilidade sobre delete quando aplicável.
- [x] Não contornar confirmações host de destructive tools nem incluí-las em remembered approvals.

### Fase 13.3 — Diagnóstico delegável

- [ ] Consolidar `diagnose-mcp` com checks de discovery, docs freshness e artifact budgets.
- [ ] Manter runner allowlisted, sem arbitrary shell.
- [ ] Produzir resumo compacto antes de logs longos.

### Fase 13.4 — Score alvo

- [ ] Manter autonomia >=96 após hardening.
- [ ] Buscar ganho de score somente se não reduzir segurança.
- [ ] Tratar prompts obrigatórios do host como boundary, não como bug do servidor MCP.

**Critério de saída:**

- [ ] Uma nova conversa consegue iniciar trabalho seguro em poucos calls, com contexto suficiente e sem arqueologia manual.

---

# Parte VIII — Ordem recomendada de execução

## 32. Sequência crítica

A ordem recomendada é:

```text
Faixa 0 — baseline Git
  -> Faixa 1 — discovery/public ignore
    -> Faixa 2 — smoke + transport classification
      -> Faixa 3 — permission hardening
        -> Faixa 4/5 — docs + import tooling
          -> Faixa 6/7 — decomposição + Model Gateway
            -> Faixa 8/9 — SDK typing + IO performance
              -> Faixa 10/11 — edge + retention
                -> Faixa 12/13 — CI + autonomia contínua
```

### 32.1 Por que essa ordem

- Não se deve decompor hotspots antes de garantir que o agente vê todos os source files relevantes.
- Não se deve fazer grande refactor sobre uma worktree causalmente ambígua.
- Não se deve “otimizar” Cloudflare antes de separar cancelamento benigno de erro real.
- Não se deve ampliar autonomia mutante enquanto `approveAll` ainda pode surgir como fallback implícito.
- Não se deve atualizar roadmaps especializados sem reconciliá-los com o código que já avançou além deles.

---

# Parte IX — Definition of Done global

## 33. Critérios para declarar “workspace ideal para trabalho contínuo”

### 33.1 Git e descoberta

- [x] Baseline Git desta onda separado das mudanças/untracked preexistentes e tratado como `preexisting-protected` quando sem owner conhecido.
- [ ] Owner/propósito semântico de todos os artefatos preexistentes ainda precisa ser formalizado antes de uma limpeza/commit global da worktree.
- [x] Nenhum blind spot conhecido de source canônico permanece causado pela regra `public/`.
- [x] Índice cobre `infra/public` e demais surfaces descobertas; busca FTS confirmou a façade pública.
- [x] Orphan detector resolve package aliases e distingue paths protegidos corretamente para os casos conhecidos.

### 33.2 Validação

- [x] Typecheck verde — suite MCP final `43c4def6-772b-4ce0-a586-5f1d78b7e864`.
- [x] Lint verde — mesma suite MCP final.
- [x] Unit MCP verde — mesma suite MCP final.
- [x] Unit Copilot verde — suite `5fd7f596-c222-4716-baf5-4a4d7e9c780f`, 6.849 testes Copilot.
- [x] Docs-contract e architecture-contract verdes nas duas safe suites finais.

### 33.3 MCP

- [x] `mcp_connection_readiness.ready=true` no baseline operacional.
- [x] `mcp_post_restart_readiness.ready=true` no fechamento, sem restart artificial do serviço saudável.
- [x] Connector smoke fresh: OAuth autenticado, SSE/reconnect e 102/102 tools alinhadas ao registry local.
- [x] Autonomy score 96/A sem relaxar safety: 78 read-only, 21 bounded-write, 3 destructive, 0 open-world.

### 33.4 OAuth/segurança

- [x] OAuth metadata/flows alinhados nas auditorias e smoke atuais.
- [x] Reauth risk baixo no perfil OAuth max-power.
- [x] Não há fallback `approveAll` duplicado por ausência acidental de handler nos call sites centrais.
- [x] `approve_all` permanece deliberadamente o **default central da policy**, com `audit_only`/`selective` configuráveis via `AGENT_PERMISSION_MODE`.
- [x] Destructive actions continuam fora de bypass/remembered approval e o cleanup genérico não toca estado protegido.

### 33.5 Cloudflare

- [x] Túnel named/permanent healthy.
- [x] 4 HA connections estáveis no fechamento.
- [x] `context canceled`/stream disconnect benigno está separado de origin failures acionáveis nos post-change gates.
- [ ] SLO numérico final de error-delta por janela será fechado após benchmark controlado de transporte; o agregado histórico não é usado como falha corrente.
- [x] Edge desired-state sem gap crítico; post-change gates finais passaram, com warning apenas para contador histórico cumulativo.

### 33.6 Arquitetura

- [x] READMEs centrais refletem paths/origin/SDK atuais nas superfícies priorizadas.
- [x] Hotspots prioritários possuem ceilings no CI; `byok.js` recebeu a primeira decomposição real com testes próprios.
- [ ] Terminal/tools ainda precisam convergir em application services para todo o long tail BYOK; a promoção deferred no turn boundary já usa o control plane compartilhado.
- [x] SDK vanilla permanece SSOT para capabilities análogas e o contrato de versão/aliases SDK ganhou gates explícitos.

### 33.7 Documentação

- [x] `src/copilot/docs/INDEX.md` existe, com precedência, status e session-prime.
- [x] Auditoria ampla de 13/06 está marcada como histórica/superada parcialmente.
- [x] Roadmap prioritário do Model Gateway foi reconciliado com o `HEAD`; itens live sem prova continuam abertos.
- [ ] Long tail de roadmaps históricos será reconciliado individualmente quando voltar a ser promovido a plano ativo.
- [x] Checker de path/version/origin drift está automatizado e integrado às safe suites/CI.

### 33.8 Higiene operacional

- [x] Jobs retornaram à retenção-alvo após duas limpezas bounded nesta execução: 240 arquivos antigos + 8 arquivos gerados durante a própria onda.
- [x] Rollback sidecars têm TTL de 24 h, `expiresAt`, cleanup limitado e locking já implementados; sidecars válidos foram preservados.
- [x] Logs detached ganharam rotação preventiva >2 MiB antes de novo start/restart, mantendo uma geração `.1`.
- [ ] Os dois logs vivos já acima do threshold só serão fisicamente rotacionados no próximo restart controlado; não houve restart artificial apenas para truncá-los.
- [x] Estado protegido de OAuth/tunnel/pid/quarantine fica fora do cleanup genérico por design.

---

# Parte X — Protocolo operacional recomendado para trabalhos futuros

## 34. Início de uma nova sessão ChatGPT

1. carregar `mcp_session_profile`;
2. consultar `repo_status`;
3. consultar `mcp_tools_status` quando o trabalho for amplo;
4. consultar `repo_index_status`;
5. checar `mcp_validation_dashboard` ou última validação;
6. quando a tarefa depender da conexão externa, consultar readiness/tunnel.

## 35. Navegação

Preferência:

```text
repo_symbol_search / repo_file_outline
  -> repo_find_symbol_usages
  -> repo_read_file ou chunks
  -> repo_search_text apenas quando textual for melhor
```

Usar índice para descoberta rápida, mas filesystem/read direto como verdade final quando houver risco de ignore/blind spot.

## 36. Escrita

Preferência:

```text
read + sha256
  -> plan-only
    -> apply com expectedHash
      -> invalidate index path
        -> validar
```

Para múltiplas operações confiáveis, usar batch plan e batch apply. Para remoções, preferir quarantine.

## 37. Validação

Para mudanças MCP:

```text
mcp_validation_plan suite=mcp-full
  -> mcp_run_safe_validation_suite
  -> dashboard
  -> job summary
  -> log somente se falhar
```

Para mudança ampla de `src/copilot`, combinar com unit Copilot e gates de boundary relevantes.

## 38. Encerramento de incremento

- revisar `git diff` focado;
- revisar `repo_status`;
- confirmar que somente arquivos intencionais mudaram;
- atualizar roadmap/documento canônico se a arquitetura ou estado operacional mudou;
- registrar validações executadas;
- nunca marcar checkbox como concluído sem evidência.

---

# Parte XI — Recomendações de primeira execução

## 39. Primeiro pacote de trabalho recomendado

Este é o pacote de maior retorno e menor risco para começar:

### Pacote A — Visibilidade e baseline

- [x] Classificar a worktree atual e proteger mudanças/untracked anteriores à execução.
- [x] Corrigir `public/` no `.gitignore`, tornando o ignore root-scoped (`/public/`).
- [x] Rebuildar o índice com a nova superfície visível.
- [x] Confirmar `src/copilot/infra/public` descoberto e pesquisável no índice.
- [x] Corrigir orphan detector para `package.json#imports`, wildcards/conditionals e paths protegidos.
- [x] Adicionar cache curto e renovável para `package.json#imports`, evitando stale state em processo MCP persistente.

### Pacote B — Readiness operacional

- [x] Refresh connector smoke autenticado.
- [x] Confirmar `mcp_post_restart_readiness.ready=true` com smoke fresh.
- [x] Capturar nova janela de métricas Cloudflare e estado do tunnel.
- [x] Classificar `context canceled` e disconnects benignos separadamente de erros acionáveis.
- [x] Corrigir a semântica do planner de benchmark para deltas da janela, não contador cumulativo absoluto.
- [ ] Executar benchmark controlado QUIC/auto/HTTP2 em janelas equivalentes; não necessário para manter o QUIC atual saudável.

### Pacote C — Permissões e autonomia

- [x] Mapear os consumidores que dependiam de fallback de permissão.
- [x] Consolidar fallback em `createConfiguredPermissionHandler()`/`AGENT_PERMISSION_MODE`.
- [x] Preservar `approve_all` como default intencional, conforme decisão de produto desta execução.
- [x] Disponibilizar `audit_only`/`selective` sem mudança de call site.
- [x] Adicionar testes de default e override.
- [x] Adicionar gate arquitetural que impede a volta de `approveAll` como fallback oculto nos call sites centrais.
- [ ] Acrescentar evento de auditoria dedicado para mudança de modo em runtime além de logs/hooks atuais.

### Pacote D — Conhecimento

- [x] Criar `docs/INDEX.md` com precedência documental explícita.
- [x] Corrigir READMEs centrais.
- [x] Reconciliar o roadmap prioritário do Model Gateway com o `HEAD`.
- [x] Marcar auditoria de 13/06 como histórica/superada parcialmente.
- [x] Automatizar checker de drift documental/versionamento e integrá-lo à safe suite/CI.

### Pacote E — Primeiro refactor estrutural

- [x] Iniciar decomposição incremental de `terminal/commands/byok.js` somente após A-D.
- [x] Extrair helpers puros de rendering/labels para `terminal/byok/rendering/` com barrel e testes próprios.
- [x] Reduzir o hotspot de ~387 KB/8.999 linhas para ~374 KB/8.655 linhas sem rewrite de estado/routing.
- [x] Criar budgets automáticos para `byok.js` e outros hotspots prioritários.
- [ ] Continuar a decomposição de `byok.js` por responsabilidades com extrações pequenas e cobertas por testes.

---

# Parte XII — Conclusão

## 40. Diagnóstico final

`src/copilot` já é uma base sofisticada. O desenho arquitetural é muito mais maduro do que a média de um runtime local de agente: há boundaries, facades, module maps, observabilidade, stateful MCP, OAuth completo, control plane de modelos, ferramentas de workspace, indexação local, rollback, validação allowlisted e integração Cloudflare.

A maior oportunidade agora não é adicionar mais superfícies. É **reduzir discrepância entre poder e governança**:

- fazer o agente enxergar todos os source files canônicos;
- fazer os diagnósticos distinguirem ausência real de invisibilidade intencional;
- fazer os docs refletirem o código atual;
- fazer permissões serem explícitas;
- fazer métricas distinguirem cancelamento normal de falha;
- fazer hotspots perderem responsabilidades sem rewrite;
- fazer artefatos e logs obedecerem budgets;
- fazer cada novo incremento começar e terminar com evidência reprodutível.

Após a execução contínua de 2026-08-14, o caminho crítico inicial das Faixas 0 a 5 foi **materialmente executado**: a causalidade da onda está separada do baseline preexistente, discovery foi corrigida, smoke/readiness foi restaurado, permissões foram centralizadas sem reduzir o default `approve_all`, documentação prioritária foi reconciliada e o detector de imports deixou de confundir aliases/protected paths com ausência real. A transformação também avançou além do mínimo: primeira decomposição BYOK, promoção automática de rota no turn boundary, budgets arquiteturais no CI, L2 evidence-gated, semântica Cloudflare corrigida e governança de artifacts/logs endurecida.

O estado atual já é melhor descrito como **plataforma operacionalmente pronta e governada para trabalho contínuo, com hardening estrutural de longo prazo em curso**. As pendências restantes não são bloqueios básicos de autonomia: concentram-se em provas live controladas, benchmarks representativos, decomposição incremental de hotspots e reconciliação do long tail histórico.

---

## 41. Snapshot booleano final após a execução contínua

- [x] WORKSPACE conectado e funcional.
- [x] Autonomy score A/96.
- [x] OAuth pronto e reauth risk baixo.
- [x] Tunnel remoto healthy.
- [x] Origin HTTPS/HTTP2 alinhado.
- [x] Índice disponível e fresco para a superfície que ele consegue descobrir.
- [x] Typecheck verde.
- [x] Lint verde.
- [x] Unit MCP verde.
- [x] Unit Copilot verde.
- [x] Arquitetura central explicitamente documentada.
- [x] Stateful MCP runtime habilitado.
- [x] Apps SDK/Company Knowledge readiness detectada.
- [x] Causalidade desta onda separada da worktree preexistente; mudanças anteriores foram preservadas.
- [ ] Worktree global totalmente limpa e com owner semântico de todos os artefatos preexistentes.
- [x] Discovery/indexação sem o blind spot conhecido de `public/`.
- [x] Connector smoke fresh, autenticado, com 102/102 tools e SSE/reconnect válidos.
- [x] Post-restart readiness true.
- [x] Semântica Cloudflare de `context canceled`/request errors normalizada nos gates; contador cumulativo documentado.
- [ ] SLO numérico final por janela e benchmark controlado QUIC/auto/HTTP2 executados.
- [x] Permissões SDK policy-driven, com `approve_all` preservado como default intencional e `audit_only`/`selective` testados.
- [x] READMEs centrais prioritários reconciliados com paths/origin/SDK atuais.
- [x] Roadmap prioritário do Model Gateway reconciliado com o HEAD.
- [ ] Long tail de roadmaps históricos individualmente reconciliado; permanece histórico até reativação.
- [x] Primeira decomposição real de `byok.js` concluída e ceilings de 12 hotspots integrados ao CI.
- [ ] Hotspots prioritários completamente decompostos em application services finos.
- [x] Retenção de jobs executada; rollback TTL/cleanup verificado; rotação preventiva de logs implementada.
- [ ] Logs vivos atuais fisicamente rotacionados no próximo restart controlado.
- [x] Source/test do orphan detector corrigido para os falsos positivos conhecidos de alias/protected path.
- [ ] Processo MCP live recarregado e `repo_find_orphan_imports` revalidado com a nova implementação; o connector atual não oferece hot-reload/restart via tool nesta sessão.
- [x] Docs index canônico criado e session-prime documentada.
- [x] L2 mantido off e planner bloqueia enable sem benchmark representativo; canary funcional já existe.
- [ ] Benchmark de performance cold/L1/L2 concluído.
- [x] Golden prompts v4 e schema de medição recuperados.
- [ ] Golden prompts medidos em sessão ChatGPT realmente limpa.

**Estado geral:** pronto para trabalho contínuo com governança substancialmente endurecida. As pendências restantes são sobretudo estruturais/evidence-gated — benchmarks controlados, decomposição incremental do long tail e reconciliação histórica — e não bloqueios básicos de conectividade, discovery, validação ou autonomia.

---

# Parte XIII — Revisão da execução contínua de 2026-08-14

## 42. Escopo efetivamente implementado

Esta onda não se limitou a atualizar checkboxes. Foram alterados source, testes, CI, documentação canônica e estado
operacional por meio do próprio WORKSPACE. A worktree que já estava suja foi tratada como baseline protegido; os
artefatos externos preexistentes não foram sobrescritos nem usados como justificativa para cleanup amplo.

### 42.1 Discovery e tooling

- [x] `.gitignore` alterado de `public/` global para `/public/` root-scoped.
- [x] `src/copilot/infra/public/` voltou a aparecer em `repo_tree` e no índice.
- [x] `repo_find_orphan_imports` passou a resolver `package.json#imports` exatos, wildcards e conditionals.
- [x] Paths bloqueados por policy passaram a ser `protected/unverifiable`, não `missing`.
- [x] Output do detector ganhou contadores separados para true orphan, protected e alias-gap.
- [x] Cache do mapa de package imports ganhou TTL curto para não ficar stale durante um processo MCP longevo.

### 42.2 Permissões

- [x] `approve_all` foi preservado como default intencional, conforme decisão explícita desta execução.
- [x] `createConfiguredPermissionHandler()` virou a primitive de fallback central.
- [x] Builder, lifecycle, AlwaysAlive e rotas SDK passaram a consumir a mesma policy.
- [x] `AGENT_PERMISSION_MODE=audit_only|selective` permite mudar o default sem editar call sites.
- [x] Evento `EMITTER_PERMISSION_MODE_CHANGED` já fornece sinalização de runtime para mudança de modo.
- [x] Testes e architecture gate impedem regressão para fallbacks `approveAll` espalhados.

### 42.3 Documentação e contratos

- [x] READMEs de `src/copilot`, `agent`, `terminal`, `mcp` e `sdk` foram reconciliados com a topologia atual.
- [x] `src/copilot/docs/INDEX.md` foi criado com precedência, status documental e session-prime.
- [x] Auditoria ampla de 13/06 foi marcada como histórica/superada parcialmente.
- [x] Roadmap do Model Gateway foi reconciliado com o código real de deferred-route promotion.
- [x] `docs-contract-check.js` foi criado e integrado às safe suites/CI.
- [x] `architecture-contract-check.js` foi criado e integrado às safe suites/CI.

### 42.4 Model Gateway e terminal

- [x] `assistant.turn_end` agora promove route switch explicitamente deferido antes de drenar a próxima mensagem.
- [x] A promoção continua fail-closed: mesma sessão SDK, autorização, TTL e idempotency key; sem fallback implícito para nova sessão.
- [x] O maior hotspot recebeu a primeira extração incremental: helpers puros de rendering/labels saíram de `terminal/commands/byok.js`.
- [x] O novo módulo recebeu barrel e testes próprios.
- [x] `byok.js` caiu aproximadamente de 387 KB/8.999 linhas para 374 KB/8.655 linhas.
- [x] Doze hotspots prioritários receberam ceilings para impedir crescimento silencioso no CI.

### 42.5 I/O, Cloudflare e manutenção

- [x] Planner L2 deixou de recomendar enable por hit ratio/file count isolados; enablement agora exige benchmark representativo.
- [x] Canary funcional L2 existente foi preservado no CI.
- [x] Rationales do origin Cloudflare foram alinhados ao HTTPS/HTTP2 real.
- [x] `requestErrorRate` foi documentado como contador cumulativo da vida do processo.
- [x] Benchmark planner passou a exigir deltas da janela e ausência de erros não explicados.
- [x] Jobs antigos foram removidos somente pelo cleanup allowlisted/UUID.
- [x] Rollback sidecars foram preservados após confirmação de TTL/cleanup/locking já implementados.
- [x] Supervisor detached ganhou rotação preventiva >2 MiB antes de start/restart, preservando uma geração `.1`.

## 43. Evidência de validação final

- [x] `suite-copilot-fast` final: job `5fd7f596-c222-4716-baf5-4a4d7e9c780f`, exit 0.
- [x] Nessa suite: typecheck, lint, docs-contract, architecture-contract e 6.849 unit Copilot verdes.
- [x] `suite-mcp-full` final: job `43c4def6-772b-4ce0-a586-5f1d78b7e864`, exit 0.
- [x] Nessa suite: typecheck, lint, docs-contract, architecture-contract e unit MCP verdes.
- [x] `mcp_validation_dashboard` final reportou typecheck/lint/unit-copilot/unit-mcp efetivamente `passed` e zero jobs rodando/falhando.
- [x] Autonomy score final permaneceu 96/A: 102 tools, 78 read-only, 21 bounded-write, 3 destructive, 0 open-world.

## 44. Evidência operacional final

- [x] Connector smoke atualizado em 2026-08-14 com OAuth autenticado e 102/102 tools alinhadas.
- [x] SSE inicial e reconnect passaram no smoke.
- [x] `mcp_post_restart_readiness.ready=true` no fechamento.
- [x] Local/public health 200; runtime stateful habilitado, TTL 600 s, máximo 256 sessões.
- [x] Cloudflare named tunnel permaneceu saudável e com 4 HA connections.
- [x] Post-change gates finais passaram sem críticos.
- [x] O warning remanescente é o agregado histórico `requestErrorRate`; latest smoke, HA, origin diagnostics e QUIC estão saudáveis.
- [x] Cleanup final removeu mais 8 artefatos de jobs/15.841 bytes gerados durante as validações, retornando à retenção.
- [x] Índice foi invalidado/rebuildado ao final: 2.052 arquivos, 2.052 fresh, 0 stale, 0 failed, 11.562 symbols e 3.765 imports.

## 45. Correções de diagnóstico produzidas durante a implementação

- [x] O problema de `infra/public` era **discovery/index blindness**, não diretório ausente.
- [x] `env-secret-registry.js` não pode ser declarado ausente: o path é protegido pelo WORKSPACE.
- [x] O runtime MCP atual é stateful; a afirmação stateless da auditoria de junho é histórica.
- [x] Rollback sidecars já tinham governança substantiva de TTL/cleanup; não deveriam receber cleanup paralelo agressivo.
- [x] `approve_all` não é um bug a ser removido: é o default de produto confirmado; o bug era a duplicação do fallback fora da policy central.
- [x] `requestErrorRate` Cloudflare não equivale diretamente a taxa de falhas percebidas pelo usuário na janela atual.

## 46. Pendências reais após esta onda

As caixas abaixo permanecem abertas deliberadamente porque dependem de evidência live, trabalho estrutural incremental ou
informação externa que não deve ser inventada:

- [ ] Formalizar owner/propósito de todos os artefatos preexistentes da worktree e escolher estratégia de commit/checkpoint.
- [ ] Executar benchmark controlado QUIC/auto/HTTP2 com amostras equivalentes e fechar SLO numérico por janela.
- [ ] Executar o live harness do Model Gateway para comprovar provider/model switch de ponta a ponta após a promoção automática.
- [ ] Continuar decomposição de `terminal/commands/byok.js`, extraindo profile/probe/route application services.
- [ ] Decompor os hotspots secundários sob os ceilings já instalados, sem rewrite massivo.
- [ ] Executar benchmark representativo cold/L1/L2 antes de considerar promoção do L2 experimental.
- [ ] Reconciliar roadmaps históricos adicionais somente quando forem reativados como planos correntes.
- [ ] Medir golden prompts em sessão ChatGPT realmente limpa, pois a fricção da UI do host não é observável de forma confiável desta execução backend.
- [ ] No próximo restart controlado do processo MCP, confirmar simultaneamente: carregamento live do novo orphan detector/planner Cloudflare, `repo_find_orphan_imports` sem os falsos positivos antigos e rollover dos logs >2 MiB. Esta sessão não expõe tool de restart/hot-reload e não deve simular um reload inexistente.

## 47. Próxima ordem de execução recomendada

A próxima onda deve preservar o princípio adotado aqui: **não ampliar monólitos e não promover hipótese sem benchmark**.

1. **Model Gateway live proof:** repetir o harness same-session e fechar o item live ainda aberto no roadmap especializado.
2. **BYOK decomposition II:** extrair um bounded context por vez de `commands/byok.js`, começando por profile/probe ou route orchestration, sempre com teste antes/depois.
3. **Performance:** materializar workloads canônicos e medir cold/L1/L2; manter L2 off se o ganho não justificar complexidade/stale risk.
4. **Transport:** executar benchmark QUIC/auto/HTTP2 por deltas de janela; só mudar o default se houver vantagem estável e rollback claro.
5. **Hotspots secundários:** atacar `sqlite-catalog-store.js`, `dev-oauth.js`, `session.js`, `sdk.js`, `sdk-session-events.js` e demais arquivos sob ceiling.
6. **Knowledge long tail:** promover um documento histórico a ativo somente junto da reconciliação com o `HEAD`.
7. **Operational restart:** no próximo restart necessário por motivo funcional/operacional, validar carregamento live do orphan detector/planner Cloudflare atualizados, a nova rotação de logs e então repetir detector, smoke/readiness e post-change gates.

**Conclusão da execução:** a primeira grande onda do roadmap deixou de ser um plano abstrato e virou infraestrutura,
contratos, testes, CI, código e estado operacional verificável. O foco seguinte pode migrar com segurança de “corrigir a
base” para “reduzir complexidade e comprovar performance/live behavior por evidência”.

---

# Parte XIV — Investigação pós-restart e roadmap da segunda onda de autonomia

## 48. Escopo e decisão de execução

Esta parte registra a investigação executada **após restart/reconnect do MCP em 2026-08-14** e redefine a próxima onda.
Por decisão explícita do operador, a decomposição física dos hotspots — `terminal/commands/byok.js` e demais arquivos
monolíticos — fica **adiada para outra oportunidade**. Os ceilings já instalados continuam protegendo contra crescimento,
mas esta onda se concentra em contratos, autonomia operacional, Git, reload, LLM-B, billing/usage, SDK, Model Gateway,
MCP e validação.

Princípios desta onda:

- [x] Investigar amplamente antes de novos patches de código.
- [x] Atualizar este roadmap antes da implementação da segunda onda.
- [x] Não usar decomposição de arquivos como objetivo desta onda.
- [x] Preservar `approve_all` como default intencional, com overrides configuráveis já implementados.
- [x] Tratar Premium Requests como **billing legado**, não como modelo canônico de uso corrente.
- [x] Priorizar AI Credits, tokens e `copilotUsage`/`totalNanoAiu` como sinais modernos do SDK quando disponíveis.
- [x] Não inferir conversões financeiras ou AI Credits a partir de campos internos sem contrato oficial.
- [x] Expandir autonomia apenas por operações allowlisted, bounded, auditáveis e reversíveis.

## 49. Estado pós-restart comprovado

### 49.1 MCP e discovery

O restart carregou corretamente os patches da primeira onda:

- [x] `mcp_post_restart_readiness.ready=true`.
- [x] MCP HTTP e `cloudflared` estão vivos.
- [x] health local e público retornam 200.
- [x] runtime stateful continua ativo com TTL de 10 minutos e limite de 256 sessões.
- [x] `repo_find_orphan_imports` live retornou `orphanCount=0`.
- [x] `trueOrphanCount=0`.
- [x] `aliasResolutionGapCount=0`.
- [x] Três imports de `env-secret-registry.js` são classificados como `protected/unverifiable`, não como missing.
- [x] Índice permanece fresh para 2.052 arquivos, sem stale/failed.

Isso fecha a pendência de “source corrigido mas processo antigo ainda carregado” registrada na Parte XIII.

### 49.2 Higiene pós-restart

- [x] `.ai/jobs` está exatamente no alvo de retenção de 240 artefatos.
- [x] Não há candidatos de cleanup além da retenção.
- [x] Não existem mais logs Cloudflare/MCP acima do threshold de 2 MiB após o restart.
- [x] A rotação preventiva implementada anteriormente foi, portanto, exercida operacionalmente.
- [x] Estado protegido OAuth/tunnel permaneceu intacto.

### 49.3 Cloudflare

Post-change gates pós-restart:

- [x] tunnel named-permanent healthy.
- [x] 4 HA connections.
- [x] QUIC presente.
- [x] RTT QUIC dentro do budget observado (~22 ms).
- [x] RPC client p95 dentro do budget atual (~1.170 ms).
- [x] nenhum erro de origin acionável após o smoke.
- [x] nenhum erro recente de transporte do tunnel.
- [ ] `requestErrorRate` bruto continua cumulativo (~23,9%); benchmark por deltas/janelas ainda deve substituir leitura do contador histórico.

Não há evidência que justifique trocar QUIC por HTTP/2/auto nesta etapa.

## 50. Autonomia Git — capacidade atual e estado-alvo

### 50.1 Capacidade exposta atualmente

A surface MCP pós-restart oferece apenas Git read-only:

- `git_status`;
- `git_diff`;
- `git_log`;
- `git_branch_info`.

Evidência atual:

- [x] branch `main`.
- [x] upstream `origin/main`.
- [x] HEAD `6f2707e5a` no início desta investigação.
- [x] Git binário é funcional dentro do workspace.
- [x] helper interno `execGit(args)` já usa `execFile('git', args)` com `cwd` fixo no workspace, sem shell interpolation.
- [ ] Não existe tool MCP para stage.
- [ ] Não existe tool MCP para commit.
- [ ] Não existe tool MCP para push.
- [ ] Credencial/permissão efetiva de push ainda não foi comprovada por `push --dry-run`.

A limitação atual é de **surface/control plane**, não de ausência de Git.

### 50.2 Estado-alvo Git

Adicionar uma camada `git-write` bounded, sem arbitrary shell:

- [ ] `git_stage_plan`: validar paths exatos e mostrar o que seria staged.
- [ ] `git_stage`: aceitar somente paths workspace-relative explícitos; proibir `-A`, `.` implícito e pathspecs perigosos por default.
- [ ] `git_commit_plan`: mostrar staged diff summary, HEAD esperado, identidade Git e mensagem proposta.
- [ ] `git_commit`: exigir `confirmCommit=true`, staged changes não vazios e `expectedHead` opcional/fortemente recomendado.
- [ ] `git_push_plan`: resolver exclusivamente o upstream da branch atual e executar/testar `--dry-run` sem aceitar URL arbitrária.
- [ ] `git_push`: exigir `confirmPush=true`, upstream canônico, worktree/HEAD preconditions e nenhum force por default.
- [ ] bloquear `--force`, `--force-with-lease`, refspec arbitrário e remote arbitrário nesta primeira versão.
- [ ] auditar stage/commit/push no append-only MCP audit log.
- [ ] adicionar testes de path traversal, option injection (`--...`), branch mismatch, HEAD mismatch, empty commit e upstream ausente.

Meta: permitir que ChatGPT prepare, valide, versione e publique **um conjunto explicitamente selecionado** sem jamais
capturar automaticamente a worktree preexistente inteira.

## 51. Hot reload e restart — investigação e arquitetura-alvo

### 51.1 LLM-B

A LLM-B já possui infraestrutura de reload própria:

- `src/copilot/terminal/dev-watch.js` suporta `COPILOT_DEV_WATCH=notify|auto`;
- `terminal:llm-b:dev` já usa `COPILOT_DEV_WATCH=auto` + `node --watch`;
- a tool SDK `reload_agent_process` executa shutdown gracioso e depende de PM2/VS Code/`node --watch` para respawn;
- o próprio código documenta reload de processo como a forma confiável de atualizar módulos ESM vivos.

Portanto:

- [x] primitiva de reload da LLM-B existe.
- [ ] MCP ainda não consegue consultar diretamente o estado do dev-watch de um processo LLM-B externo.
- [ ] MCP ainda não consegue solicitar um reload a uma sessão LLM-B externa por um canal controlado.
- [ ] ausência de sessão LLM-B no registry **deste processo MCP** impede `copilot_sessions_list` de representar o terminal externo.

### 51.2 MCP remoto

O MCP possui scripts canônicos de restart:

- `copilot:mcp:restart` -> `mcp:stateful:restart`;
- `mcp:stateful:restart` -> stateful env -> `copilot:mcp:quic:restart`;
- Cloudflare CLI `restart` chama `startManagedStack(..., restart: true)`.

Porém nenhuma tool MCP expõe isso hoje.

Estado-alvo:

- [ ] criar `mcp_reload_plan` read-only.
- [ ] criar `mcp_reload_schedule` com confirmação explícita.
- [ ] o handler deve persistir intenção/nonce/status e iniciar helper **detached** com delay curto.
- [ ] a resposta JSON-RPC deve ser entregue antes do processo atual ser encerrado.
- [ ] helper aceita somente o restart canônico stateful/QUIC; nenhum comando ou path arbitrário.
- [ ] após restart, readiness deve expor estado do último reload e recomendar smoke quando necessário.
- [ ] criar teste que prova que o helper não aceita arbitrary command/env injection.

Este desenho oferece “hot reload operacional” por restart controlado de processo, sem fingir que o ESM do Node pode ser
recarregado de forma segura em-place.

## 52. Contato atual com a LLM-B

### 52.1 Estado efetivo

`copilot_sessions_list` retornou `count=0` após o reconnect. Isso significa que o processo MCP atual não possui sessão
SDK/LLM-B ativa em seu registry local. Não significa que o terminal nunca possa existir; significa que **MCP e terminal
LLM-B são processos separados sem um control plane compartilhado suficiente**.

- [x] surface MCP consegue ler sessões que existam no seu próprio processo.
- [ ] nenhuma sessão está ativa neste processo na investigação atual.
- [ ] MCP não possui tool allowlisted para iniciar o harness LLM-B.
- [ ] MCP não possui tool para consultar as execuções live persistidas sem navegar manualmente pelo SQLite/script.
- [ ] MCP não possui canal explícito de request/reload para um terminal LLM-B externo já vivo.

### 52.2 Harness canônico

O arquivo requerido pelo operador foi inspecionado diretamente:

`scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`

Ele continua sendo o **runner live canônico** do terminal LLM-B:

- ~427 KB;
- ~8,7 mil linhas;
- cenários canonical/freeform/error/file/model-gateway;
- BYOK fixture e BYOK real;
- route execution e selection policies;
- ciclos structured-input/menu/picker/UX/audit/operator;
- SSE collector;
- session-cycle e same-session evidence;
- persisted live scenario records no SQLite;
- análise de tool lifecycle e transcript materialization;
- redaction/secret-leak checks.

Não foi encontrado outro arquivo equivalente que substitua esse runner. Existe, sim, um **ecossistema complementar**:

- `model-gateway-live-plan.mjs` — preparação/planejamento;
- `model-gateway-live-readiness.mjs` — readiness, catálogo, health, seleção e redaction;
- `model-gateway-live-runs.mjs` — leitura read-only das execuções persistidas;
- `model-gateway-operator-ready.mjs`;
- `model-gateway-auto-*`;
- `model-gateway-runtime-selector.mjs`;
- demais comandos especializados.

Roadmap LLM-B desta onda:

- [ ] expor readiness do Model Gateway/LLM-B como tool MCP allowlisted.
- [ ] expor histórico `live-runs` como tool MCP read-only.
- [ ] criar plan tool para live test que classifique se haverá chamada real de modelo/provider.
- [ ] criar runner MCP/job allowlisted para cenários live, com timeout e artifacts sob `.ai/jobs`/SQLite.
- [ ] default do runner MCP deve ser **control-only/no-model-turn** quando a intenção não exigir uma chamada real.
- [ ] qualquer cenário que efetivamente invoque modelo deve exigir confirmação explícita de usage externo.
- [ ] registrar session IDs, route identity, result summary e artifacts sem secrets.
- [ ] conectar reload/status da LLM-B ao MCP sem arbitrary shell.

## 53. Migração Premium Requests -> AI Credits/token usage

### 53.1 Verdade de produto em agosto de 2026

A documentação oficial atual do GitHub estabelece:

- em **1º de junho de 2026**, a cobrança padrão do GitHub Copilot migrou de request-based para usage-based billing;
- o uso normal passa a ser medido em **GitHub AI Credits**;
- o custo depende do modelo e dos tokens consumidos;
- Premium Requests/model multipliers permanecem apenas no regime **legacy** para assinantes Pro/Pro+ anuais já existentes que optaram por permanecer temporariamente no modelo antigo;
- as páginas atuais de Premium Requests estão explicitamente classificadas como `legacy`.

Logo, o runtime local não deve continuar modelando “Premium Request” como unidade canônica universal.

### 53.2 Contrato SDK moderno já disponível

O SDK atual oferece sinais mais adequados:

- `assistant.usage`: input/output/cache tokens, modelo, duration, initiator, ids e `copilotUsage` quando disponível;
- `copilotUsage.totalNanoAiu`: unidade bruta de usage/cost retornada pela CAPI;
- `session.session_limits_changed` com `sessionLimits.maxAiCredits`;
- `session.usage_checkpoint` com `totalNanoAiu` e campo PR apenas de compatibilidade;
- `session_limits_exhausted.requested/completed` com `maxAiCredits`/`usedAiCredits`;
- `sessionLimits: { maxAiCredits }` suportado pelo SDK desde a linha 1.0.x anterior ao baseline instalado 1.0.9.

### 53.3 Drift atual no repositório

A busca encontrou dezenas de referências de domínio ainda centradas em PR:

- `event-handlers/usage-classifier.js` classifica user message como `premium_request`;
- `event-handlers/usage.js` emite `pr.consumed`;
- `agent/dialog/state/cost-ledger.js` conta `resumesWithPR`, `resumesZeroPR`, `totalPR`;
- terminal possui mensagens “sem Premium Request” e “Pedido premium”;
- métricas apresentam `pr`/`zero_pr`;
- `/pr-budget` ainda existe;
- live harness usa `--no-pr` e linguagem de PR budget;
- auto-model policy ainda possui critério `premium_multiplier_lte_1`;
- SDK RPC docs ainda descrevem `premium_interactions` como quota canônica;
- testes codificam explicitamente a semântica antiga.

Há também usos de `premium` que **não são necessariamente Premium Requests** — por exemplo um `costTier` genérico de modelo.
Esses casos devem ser avaliados semanticamente e não renomeados por busca/replace cego.

### 53.4 Estado-alvo de usage

- [ ] `assistant.usage` deve ser classificado por **origem/attribution**, não por presunção de billing PR.
- [ ] categorias sugeridas: `user_turn`, `byok_user_turn`, `ask_user_continuation`, `tool_originated`, `non_user_initiated`, `unattributed`.
- [ ] remover `premiumRequest:boolean` como sinal primário de domínio.
- [ ] manter campos PR somente em uma subestrutura `legacyBilling` quando recebidos explicitamente do SDK/runtime.
- [ ] preservar tokens e `copilotUsage` completos de forma redacted/estruturada.
- [ ] introduzir `totalNanoAiu`/AI usage aggregates quando suportados pelos eventos.
- [ ] adaptar ledger de dialog para `modelCalls`/`resumesWithModelCall`/`resumesWithoutModelCall`, sem afirmar custo por inferência.
- [ ] substituir `/pr-budget` por `/usage-budget`/AI-credit-aware UX; alias antigo pode existir apenas como deprecated compatibility shim.
- [ ] substituir `--no-pr` do live harness por `--control-only` ou `--no-model-turn`; alias antigo pode ser aceito temporariamente e marcado deprecated.
- [ ] adicionar `sessionLimits.maxAiCredits` à configuração create/resume.
- [ ] suportar e renderizar `session_limits_exhausted.*` e `session.usage_checkpoint`.
- [ ] atualizar recovery policy/metrics para `additional_usage` versus `no_additional_usage`, não PR versus zero-PR.
- [ ] atualizar documentação e testes para a taxonomia moderna.
- [ ] tratar `premium_interactions` recebido de `account.getQuota` apenas como chave legacy vendor, sem promovê-la na UX moderna.

## 54. Roadmap da segunda onda — sem decomposição

### Faixa 14 — Billing/usage contract 2026

**Objetivo:** retirar Premium Requests do núcleo sem quebrar compatibilidade vendor necessária.

#### 14.1 Usage attribution

- [ ] refatorar `usage-classifier` para attribution moderna.
- [ ] manter compatibilidade apenas quando um campo legado for recebido explicitamente.
- [ ] atualizar emitter/event contract de usage.
- [ ] atualizar terminal narration/metrics/activity.

#### 14.2 AI-credit session limits

- [ ] expor `SessionLimitsConfig`/`sessionLimits` na config port.
- [ ] aceitar `maxAiCredits` em create e resume.
- [ ] permitir env/config explícita para limite quando desejado; default sem cap permanece permitido.
- [ ] normalizar eventos de limit changed/checkpoint/exhausted.
- [ ] projetar status/usage atuais para terminal e observabilidade.

#### 14.3 Compatibilidade legacy

- [ ] não remover campos SDK `totalPremiumRequests` que possam existir na wire schema.
- [ ] não usar esses campos para decisões modernas salvo perfil legacy explicitamente detectado/configurado.
- [ ] manter alias `/pr-budget` e `--no-pr` apenas temporariamente, com deprecation clara.
- [ ] eliminar model-multiplier criteria da policy moderna.

### Faixa 15 — Control plane MCP <-> LLM-B

**Objetivo:** tornar o harness e o estado live operáveis a partir do conector.

- [ ] tool de `llmb_live_readiness`.
- [ ] tool de `llmb_live_runs`.
- [ ] tool de `llmb_live_test_plan`.
- [ ] job allowlisted `llmb_live_test_run` com cenários parametrizados de forma fechada.
- [ ] confirmação explícita para turn/provider real.
- [ ] artifacts e status consultáveis por job id.
- [ ] bridge/status para runtime LLM-B externo ou, se isso não for seguro, processo live isolado como autoridade de teste.

### Faixa 16 — Git mutation control plane

**Objetivo:** permitir checkpoint/commit/push com causalidade preservada.

- [ ] stage plan + stage bounded.
- [ ] commit plan + commit bounded.
- [ ] push plan + push confirmado.
- [ ] upstream-only, no force, no arbitrary remote/refspec.
- [ ] expected HEAD e staged-diff evidence.
- [ ] audit events e tests.
- [ ] comprovar `push --dry-run` antes do primeiro push real.

### Faixa 17 — Reload/autorreload

**Objetivo:** reduzir a necessidade de restart manual após mudanças de MCP/runtime.

- [ ] `mcp_reload_plan`.
- [ ] `mcp_reload_schedule` detached/confirmed.
- [ ] persisted reload state.
- [ ] integrar último reload ao readiness.
- [ ] LLM-B dev-watch/reload status exposto de forma segura.
- [ ] live test sempre nasce com ESM fresco; terminal dev mantém `node --watch` como modo de desenvolvimento.

### Faixa 18 — Observabilidade, Cloudflare e performance

- [ ] introduzir deltas/janelas de request errors para benchmark.
- [ ] manter QUIC até benchmark controlado demonstrar alternativa melhor.
- [ ] benchmark cold/L1/L2 permanece obrigatório antes de habilitar L2.
- [ ] golden prompts ainda devem ser medidos em conversa limpa.

### Faixa 19 — Gates e validação

- [ ] testes unitários de toda taxonomia AI-credit-first.
- [ ] gates anti-reintrodução de PR como domínio canônico.
- [ ] tests de Git mutation safety.
- [ ] tests de reload helper safety.
- [ ] tests do LLM-B control plane sem provider real por default.
- [ ] `copilot-fast` verde.
- [ ] `mcp-full` verde.
- [ ] live readiness verde.
- [ ] pelo menos um cenário control-only do harness executado via nova surface MCP.
- [ ] cenário provider/model real somente se explicitamente permitido e com resultado persistido.

### Faixa 20 — Integração Git da onda

- [ ] classificar exatamente os arquivos desta onda.
- [ ] evitar stage de artefatos preexistentes desconhecidos.
- [ ] gerar `git_commit_plan` com staged diff limpo/explicável.
- [ ] criar commit atômico somente depois dos gates verdes.
- [ ] executar `git_push_plan`/dry-run.
- [ ] push real somente se credencial/upstream estiverem válidos e `confirmPush=true`.

## 55. Itens explicitamente fora desta onda

- [ ] decomposição adicional de `terminal/commands/byok.js`.
- [ ] decomposição de `sqlite-catalog-store.js`.
- [ ] decomposição de `dev-oauth.js`.
- [ ] decomposição de `session.js`, `sdk.js`, `sdk-session-events.js` e demais hotspots.

Esses itens **não estão abandonados**. Estão conscientemente adiados para evitar misturar mudança de topologia física com
uma migração ampla de contratos, billing, live control plane e Git autonomy.

## 56. Definition of Done da segunda onda

A segunda onda será considerada concluída quando:

- [ ] Premium Requests não forem mais o domínio canônico de usage/billing no runtime atual.
- [ ] AI Credits/session limits forem configuráveis e observáveis sem impor cap por default.
- [ ] tokens e `copilotUsage` forem preservados como telemetria primária.
- [ ] compatibilidade PR estiver isolada e explicitamente legacy.
- [ ] MCP conseguir planejar e executar live harness LLM-B por allowlist.
- [ ] MCP conseguir consultar live readiness/runs sem shell manual.
- [ ] MCP conseguir stage/commit/push de forma bounded e auditável.
- [ ] MCP possuir restart/reload programático seguro e verificável.
- [ ] nenhuma operação nova aceitar arbitrary shell, arbitrary remote Git ou arbitrary restart command.
- [ ] Cloudflare/readiness permanecerem verdes.
- [ ] typecheck, lint, unit MCP e unit Copilot estiverem verdes.
- [ ] roadmap for revisado novamente com evidência pós-implementação.

**Estado desta Parte XIV no momento da criação:** investigação concluída; implementação da segunda onda ainda não iniciada.

---

# Parte XV — Fechamento técnico pós-implementação da segunda onda

> **Autoridade temporal:** esta Parte XV supersede os checkboxes abertos da Parte XIV para o estado corrente. A Parte XIV é preservada como fotografia do planejamento pré-implementação; os itens abaixo registram o que foi efetivamente implementado e provado depois dela.

## 57. Veredito pós-implementação

A segunda onda alcançou o objetivo técnico principal sem ampliar a decomposição física dos hotspots:

- o runtime passou a ser **AI-credit/token-usage-first**;
- Premium Requests deixaram de ser inferidos a partir de `assistant.usage` e ficaram confinados a compatibilidade vendor/persistida legacy;
- a LLM-B ganhou control plane MCP allowlisted e prova live real em PTY;
- Git stage/commit/push passou a existir como capability bounded, sem shell arbitrário, force, remote ou refspec livres;
- o próprio MCP ganhou um caminho de self-reload detached e allowlisted;
- os gates finais de MCP e Copilot estão verdes na mesma árvore de source;
- decomposição adicional de hotspots continua conscientemente fora desta onda.

**Estado antes da publicação Git:** GO para commit/push governado.

## 58. Billing e usage — estado final desta onda

### 58.1 Contrato moderno

- [x] `assistant.usage` é classificado por attribution, não convertido em uma unidade request-based.
- [x] `billingSource` diferencia GitHub Copilot de BYOK/provider.
- [x] tokens de entrada/saída, reasoning tokens e metadata de modelo permanecem disponíveis.
- [x] `copilotUsage.totalNanoAiu` é preservado quando fornecido pelo SDK.
- [x] `session.usage_checkpoint` é normalizado e observado.
- [x] `session_limits_changed` é normalizado e observado.
- [x] `session_limits_exhausted.*` é normalizado e observado.
- [x] `SessionLimitsConfig`/`sessionLimits.maxAiCredits` existe no wrapper local.
- [x] `COPILOT_MAX_AI_CREDITS` permite cap explícito sem impor cap por default.
- [x] caminhos BYOK não recebem cap GitHub por inferência.

### 58.2 Lifecycle e persistência

- [x] recovery diferencia reuso sem chamada adicional de modelo de recovery com chamada adicional.
- [x] `usageMetrics` é a leitura moderna do ledger de lifecycle.
- [x] `prMetrics`/`prConsumed` e equivalentes permanecem somente como aliases de compatibilidade onde estado histórico exige.
- [x] `/usage-budget` é a surface moderna.
- [x] `/pr-budget` é alias deprecated e aponta para replacement.
- [x] Auto model policy deixou de usar premium-request multiplier como critério moderno.

### 58.3 Premium Requests — fronteira legacy

- [x] nenhum turno moderno fabrica `pr.consumed` a partir de `assistant.usage`.
- [x] `premium_interactions` vindo de APIs/wire antigas é rotulado como **billing legacy por request**.
- [x] fingerprints textuais de Premium Requests permanecem somente onde são necessários para reconhecer erro/vendor legacy.
- [x] documentos históricos permanecem intactos quando descrevem evidência de sua época.
- [x] novos textos operacionais não ensinam Premium Requests como billing corrente.

## 59. Harness LLM-B e Model Gateway

### 59.1 Runner canônico

O runner canônico permanece:

`scripts/model-gateway/commands/model-gateway-terminal-llm-b-live-test.mjs`

Não foi criado um segundo runner concorrente. `model-gateway-live-plan.mjs`, `model-gateway-live-readiness.mjs`, `model-gateway-live-runs.mjs`, `model-gateway-operator-ready.mjs`, `auto-*` e selectors continuam como auxiliares/orquestradores.

- [x] `--control-only` é o modo canônico sem turno explícito de modelo.
- [x] `--no-pr` existe apenas como alias deprecated no parser/help.
- [x] identificadores internos `noPr`/`NoPr` foram removidos do runner.
- [x] critérios live modernos usam attribution/AI Credits/tokens/BYOK, não Premium Request como verdade do produto.
- [x] cenário real/model/provider continua exigindo opt-in explícito quando puder consumir AI Credits ou quota externa.

### 59.2 Readiness profundo

`llmb_live_readiness({ includeSqliteRuntimeHealth: true })` passou após boundedness do sample SQLite ser ajustado de 1.500 para 500 registros recentes.

Evidência observada:

- [x] catalog integrity verde.
- [x] SQLite parity verde.
- [x] redaction audit verde.
- [x] 7/7 perfis selecionáveis nos planos relevantes.
- [x] terminal live selector 3/3 rotas selecionadas.
- [x] `runtimeRows=293309`.
- [x] `healthObservations=161503`.
- [x] `runtimeProbeResults=128940`.
- [x] `runtimeHealthReadLimit=500`.
- [x] runner canônico presente.

### 59.3 Live control-only

Uma tentativa inicial via `stdio` demonstrou que o transporte headless é inadequado para o harness interativo: o boot chegava a ready, mas critérios REPL falhavam por construção.

Correção aplicada:

- [x] adapter MCP passou a usar `pty` como default canônico.
- [x] `stdio` continua disponível explicitamente para diagnósticos headless.

Prova live positiva mais recente antes desta publicação:

- run MCP: `mcp-mstgkywh`;
- artifacts: `artifacts/terminal-live/mcp-mstgkywh`;
- modo: `control-only`;
- cenário: `canonical`;
- transporte: PTY;
- model/provider explícito: **não invocado**;
- resultado: **PASS**.

Cobertura observada:

- [x] LLM-B chegou a ready.
- [x] sessão SDK foi retomada.
- [x] `/usage now` passou.
- [x] `/activity` passou.
- [x] cockpit `/session sdk` passou.
- [x] catálogo de CommandDefinitions passou.
- [x] waits/events SDK passaram.
- [x] `/metrics` passou.
- [x] archive SSE default/raw/JSON passou.
- [x] SSE conectou sem erros.
- [x] nenhum turno explícito foi aberto.
- [x] nenhuma tool de modelo foi iniciada.
- [x] tracker de erros ficou em zero.
- [x] shutdown por `/quit` foi limpo.

## 60. Autonomia MCP adicionada

### 60.1 Git mutation

Capabilities vivas após o restart do operador:

- [x] `git_stage_plan`.
- [x] `git_stage`.
- [x] `git_commit_plan`.
- [x] `git_commit`.
- [x] `git_push_plan`.
- [x] `git_push`.

Invariantes:

- [x] stage exige paths explícitos.
- [x] `git add -A`/`.` implícito não é oferecido.
- [x] pathspec magic/globs/options são rejeitados.
- [x] commit trabalha sobre index já staged.
- [x] expected HEAD pode ser exigido.
- [x] push usa somente upstream existente da branch atual.
- [x] remote/refspec arbitrários não são parâmetros da tool.
- [x] force push não é oferecido.
- [x] push real faz dry-run interno antes da publicação.

Prova remota pré-commit:

- branch: `main`;
- upstream: `origin/main`;
- HEAD de baseline: `6f2707e5a`;
- ahead/behind antes do commit: `0/0`;
- `git push --dry-run`: **PASS**;
- credencial/upstream: válidos.

### 60.2 Self-reload MCP

Capabilities vivas:

- [x] `mcp_reload_plan`.
- [x] `mcp_reload_schedule`.
- [x] `mcp_reload_status`.
- [x] runner detached fixo em `src/copilot/mcp/scripts/scheduled-restart-runner.js`.
- [x] state file fixo em `src/copilot/.ai/mcp/mcp-reload-state.json`.
- [x] profiles executáveis limitados a `quic`, `h2` e `auto`.
- [x] arbitrary shell = false.
- [x] arbitrary command = false.
- [x] arbitrary path = false.
- [x] resposta da tool precede o restart.
- [x] `mcp_reload_plan(profile=current)` resolveu corretamente para QUIC no processo vivo.
- [ ] executar o primeiro self-reload real após o commit principal e provar reconexão/readiness sem restart manual.

## 61. Validação final de source antes da publicação

Árvore final congelada, sem patches durante as execuções vencedoras.

### 61.1 MCP

Job final:

`e6dfada1-57f2-47f3-9fed-206ac0ebde75`

Resultado: **PASS**.

- [x] typecheck.
- [x] lint.
- [x] docs-contract.
- [x] architecture-contract.
- [x] unit MCP.

### 61.2 Copilot

Job final:

`fbf3af3b-3ea1-4115-8f99-fef3d8232742`

Resultado: **PASS**.

- [x] typecheck.
- [x] lint.
- [x] docs-contract.
- [x] architecture-contract.
- [x] 6.854 testes Copilot passaram.

### 61.3 Gates arquiteturais destacados

- [x] usage não infere Premium Requests.
- [x] Auto policy é usage-based.
- [x] `--control-only` é canônico.
- [x] Git mutation control plane existe.
- [x] LLM-B MCP control plane existe.
- [x] reload control plane existe.
- [x] permission default continua `approve_all` via policy central configurável.
- [x] ceilings dos hotspots permanecem respeitados.

## 62. Causalidade Git e classificação do stage

### 62.1 Arquivos preexistentes que NÃO pertencem ao commit desta transformação

Permanecem fora do stage por padrão:

- [x] `.vscode/settings.json` — modificação preexistente não atribuída a esta execução.
- [x] `DOCUMENTAÇÃO/tracing-background-task-display-report.md` — artefato preexistente/untracked.
- [x] `audit_externa_src_copilot` — artefato preexistente/untracked.
- [x] `src/DOCUMENTAÇÃO/COPILOT/AUDITORIA-ARQUITETURAL-AMPLA/LLM-B-TOOL-OPS-ANALISE-PROFUNDA-2026-06-14.md` — preexistente/untracked.
- [x] `src/DOCUMENTAÇÃO/COPILOT/AUDITORIA-ARQUITETURAL-AMPLA/model-gateway-route-switch-study.md` — preexistente/untracked.
- [x] `src/copilot/.ai/rollback/` — estado operacional/rollback; não versionar nesta onda.
- [x] `workspaces/` — árvore local preexistente fora do escopo.

### 62.2 `infra/public` revelado pela correção do `.gitignore`

A remoção do ignore global `public/` revelou três façades que já existiam fisicamente mas não apareciam no status Git.

Decisão final:

- [x] `src/copilot/infra/public/buffer.js` deve entrar no commit: há **20 imports reais** apontando para essa façade; um clone limpo sem ela ficaria incompleto.
- [x] `src/copilot/infra/public/locks.js` deve entrar no commit como façade canônica coerente com `infra/public`.
- [x] `src/copilot/infra/public/observability.js` deve entrar no commit como façade canônica coerente com `infra/public`.

Isso transforma a correção de discovery em uma correção reprodutível de source, e não apenas em uma melhoria do scanner local.

## 63. Roadmap residual — excluindo decomposição

### 63.1 Fechado nesta publicação

- [x] stage explícito do conjunto desta transformação: 145 arquivos, sem capturar artefatos locais preexistentes.
- [x] `git_commit_plan` revisado com staged diff explicável.
- [x] commit principal atômico criado: `e2f69deaae16f17c67b3ebc6ae38926fe056a02f`.
- [x] `git_push_plan` no novo HEAD passou via dry-run.
- [x] push real para `origin/main` concluído; imediatamente após o push, ahead/behind = `0/0`.
- [x] self-reload real executado via `mcp_reload_schedule`.
- [x] reconexão automática + `mcp_reload_status` comprovados.
- [x] post-restart smoke/readiness ficaram verdes após refresh do smoke OAuth.
- [x] adapter LLM-B carregado usa PTY por default.
- [x] live control-only pós-reload executado pelo default recém-carregado: `mcp-msth759q`, exitCode `0`.
- [x] fechamento documental pós-publicação registrado nesta seção.

### 63.2 Permanecem como otimizações evidence-gated futuras

- [ ] benchmark comparável cold/L1/L2 antes de qualquer ativação de L2.
- [ ] benchmark controlado QUIC/auto/H2 por deltas de janela antes de mudar o protocolo atual.
- [ ] medir golden prompts em conversa limpa.
- [ ] ampliar correlação de reload state no readiness consolidado.
- [ ] expor telemetria específica do dev-watch da LLM-B no control plane, se trouxer valor operacional mensurável.

### 63.3 Decomposição — deliberadamente adiada

- [ ] decomposição adicional de `terminal/commands/byok.js`.
- [ ] decomposição de `sqlite-catalog-store.js`.
- [ ] decomposição de `dev-oauth.js`.
- [ ] decomposição de `session.js`, `sdk.js`, `sdk-session-events.js` e demais hotspots.

Esses itens não bloqueiam a publicação concluída.

## 64. Definition of Done — estado pós-publicação

- [x] Premium Requests não são mais domínio canônico de usage/billing atual.
- [x] AI Credits/session limits são configuráveis sem cap por default.
- [x] tokens e `copilotUsage` são preservados como telemetria primária.
- [x] compatibilidade request-based está isolada e rotulada como legacy.
- [x] MCP consegue planejar/executar harness LLM-B por allowlist.
- [x] MCP consulta readiness/runs LLM-B sem shell manual.
- [x] MCP possui stage/commit/push bounded e auditável.
- [x] MCP possui self-reload programático allowlisted.
- [x] nenhuma capability nova aceita arbitrary shell, arbitrary Git remote/refspec/force ou arbitrary restart command.
- [x] `mcp-full` final está verde.
- [x] `copilot-fast` final está verde.
- [x] deep live readiness está verde.
- [x] live control-only PTY está verde antes e depois do self-reload.
- [x] decomposição adicional permaneceu fora do escopo conforme decisão do operador.
- [x] publicação Git principal concluída.
- [x] self-reload pós-publicação comprovado.
- [x] roadmap fechado com SHA principal/upstream pós-publicação.

---

# Parte XVI — Prova de publicação, self-reload e autonomia operacional fechada

## 65. Git publicado

Commit funcional principal:

`e2f69deaae16f17c67b3ebc6ae38926fe056a02f`

Mensagem:

`feat(copilot): expand autonomous control plane and modernize usage`

- [x] 145 arquivos pertencentes à transformação entraram no commit.
- [x] 6.062 inserções e 1.271 remoções no commit principal.
- [x] `origin/main` recebeu `6f2707e5a..e2f69deaa`.
- [x] após o push: `ahead=0`, `behind=0`.
- [x] `.vscode/settings.json` e artefatos locais preexistentes permaneceram deliberadamente fora do commit.

Este fechamento documental será publicado em commit docs-only subsequente. O SHA desse próprio commit não é autoembutido no arquivo para evitar uma cadeia autorreferente de commits apenas para registrar o próprio hash; o Git history é a autoridade para o SHA documental final.

## 66. Self-reload real

Request:

`mcp-reload-c8ec34c2-9f24-4c1a-9e42-afabcd05ae0c`

- [x] profile solicitado: `current`.
- [x] profile resolvido: `quic`.
- [x] delay: `2500ms`.
- [x] runner detached PID: `60873`.
- [x] houve janela 502 transitória durante a troca do origin/tunnel, como esperado.
- [x] o conector voltou sem restart/reconnect manual do operador.
- [x] `mcp_reload_status.status=completed`.
- [x] runner exitCode `0`.
- [x] novo MCP HTTP PID: `60956`.
- [x] novo cloudflared PID: `60962`.

Isso fecha o bootstrap operacional: mudanças futuras do MCP podem ser publicadas e carregadas pelo próprio control plane, desde que o processo atual ainda contenha a surface de reload válida.

## 67. Smoke e readiness pós-reload

`mcp_connector_smoke_refresh` após o reload:

- [x] health público `200`.
- [x] OAuth protected resource `200`.
- [x] OAuth authorization server `200`.
- [x] challenge unauthenticated `401` esperado e aceito.
- [x] smoke OAuth autenticado passou.
- [x] tools/list autenticado retornou **115 tools**.
- [x] registry remoto = registry local: `115/115`.
- [x] nenhuma tool local ausente.
- [x] nenhuma tool remota inesperada.
- [x] SSE inicial passou.
- [x] reconnect SSE passou.
- [x] Last-Event-ID foi aceito.

`mcp_post_restart_readiness` depois do smoke refresh:

- [x] `ready=true`.
- [x] local health `200`.
- [x] public health `200`.
- [x] stateful runtime habilitado.
- [x] connector smoke fresh.

Os `context canceled` históricos permanecem classificados como ruído/stream cancellation a observar; os transport errors registrados às 21:44:18 coincidem com a própria janela deliberada de restart e não impediram reconnect, smoke ou readiness pós-reload.

## 68. LLM-B pós-reload

Primeiro, `llmb_live_test_plan` sem `transport` explícito retornou:

`--transport=pty --control-only`

Isso prova que o novo default foi realmente carregado pelo processo MCP reiniciado.

Em seguida foi executado o harness sem especificar `transport`:

- runId: `mcp-msth759q`;
- artifacts: `artifacts/terminal-live/mcp-msth759q`;
- modo: `control-only`;
- cenário: `canonical`;
- transporte efetivo: PTY;
- model/provider explícito: não invocado;
- exitCode: `0`.

Evidência operacional:

- [x] LLM-B ready.
- [x] sessão SDK retomada.
- [x] `127 ferramentas` disponíveis na sessão LLM-B observada.
- [x] BYOK pronto em `kilo-auto/free`.
- [x] `/usage now` moderno, sem Premium Requests como domínio corrente.
- [x] `/metrics` mostra `Copilot histórico` e separa a rota BYOK atual.
- [x] eventos legacy de quota aparecem humanizados como `billing legacy por request`.
- [x] `/activity` verde.
- [x] `/session sdk` verde.
- [x] CommandDefinitions observáveis.
- [x] `/events` default/raw/JSON verde.
- [x] SSE archive íntegro.
- [x] `/errors`: zero.
- [x] `/quit`: shutdown limpo.
- [x] nenhum turno explícito de modelo foi enviado.
- [x] nenhuma quota provider/AI Credit foi deliberadamente consumida por este control-only.

## 69. Estado operacional final desta onda

### Concluído

- [x] discovery/index blind spot corrigido.
- [x] aliases/protected imports diagnosticados corretamente.
- [x] default `approve_all` preservado e centralmente configurável.
- [x] billing/usage modernizado para AI Credits/tokens/attribution.
- [x] Premium Requests isolados como compatibilidade legacy.
- [x] Git stage/commit/push governado disponível e usado com sucesso.
- [x] self-reload governado disponível e usado com sucesso.
- [x] MCP OAuth/Cloudflare retornou após self-reload sem intervenção manual.
- [x] LLM-B control plane disponível via MCP.
- [x] live readiness profundo verde.
- [x] live control-only pós-reload verde.
- [x] source principal publicado em `origin/main`.

### Próximos passos que NÃO exigem decomposição

- [ ] benchmark cold/L1/L2 com workload representativo.
- [ ] benchmark QUIC/auto/H2 com amostras iguais e deltas por janela.
- [ ] golden prompts em conversa limpa e métricas comparáveis.
- [ ] integrar `mcp_reload_status` diretamente no readiness consolidado para tornar a evidência de reload de primeira classe.
- [ ] avaliar uma surface dedicada para dev-watch/reload da LLM-B se houver ganho operacional real além do harness atual.
- [ ] opcionalmente executar cenário LLM-B com modelo/provider real quando houver desejo explícito de consumir AI Credits/quota externa.

### Decomposição — continuar adiada

- [ ] `terminal/commands/byok.js`.
- [ ] `sqlite-catalog-store.js`.
- [ ] `dev-oauth.js`.
- [ ] `session.js`, `sdk.js`, `sdk-session-events.js` e demais hotspots.

## 70. Veredito final da segunda onda

**GO — autonomia operacional ampliada e publicada.**

O principal ganho não é apenas a adição de tools. O sistema agora possui um ciclo operacional fechado e comprovado:

`investigar -> editar bounded -> validar -> stage explícito -> commit -> push upstream-only -> self-reload -> OAuth smoke -> readiness -> LLM-B live control-only`

Esse ciclo reduz de forma material a dependência de intervenção manual sem abrir shell, force-push, remote arbitrário ou restart arbitrário. A próxima fronteira de melhoria, excluída conscientemente desta onda, é performance evidence-gated e, em outra oportunidade, decomposição dos hotspots.
