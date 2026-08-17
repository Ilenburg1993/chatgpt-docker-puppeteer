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
| G-08 | jobs/rollback/log retention | P1 | **Rollback fechado; logs parcialmente abertos** | incidente de 108 sidecars/52.151.184 bytes provou que o antigo `scanLimit=512` não era retenção; captura automática agora é opt-in/default-off, modo opt-in tem TTL 24 h + budgets 32/32 MiB, maintenance purge explícito removeu todos os sidecars reconhecidos e patch pós-reload em arquivo ~684 KiB manteve zero sidecars; rotação pre-start >2 MiB existe, mas rollover físico dos logs segue como evidência pendente |
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
- [x] Confirmar TTL canônico de 24 horas e `expiresAt` persistido para sidecars explicitamente produzidos.
- [x] Corrigir a premissa anterior de que já existia retenção por "count": o limite de 512 era apenas `scanLimit` de cleanup, não um budget de retenção.
- [x] Tornar a captura automática de rollback **opt-in**, desligada por padrão quando `COPILOT_IO_ROLLBACK_ENABLED` está ausente/falso.
- [x] Preservar a API explícita de rollback/sidecar e o executor de tokens para fluxos que deliberadamente habilitem ou persistam rollback.
- [x] Em modo habilitado, impor budgets configuráveis — defaults de 32 sidecars e 32 MiB — além do TTL de 24 h (`COPILOT_IO_ROLLBACK_MAX_ENTRIES`, `COPILOT_IO_ROLLBACK_MAX_BYTES`, `COPILOT_IO_ROLLBACK_TTL_MS`).
- [x] Fazer cleanup de expirados no startup; em modo habilitado, o startup também aplica os budgets, sem purgar silenciosamente sidecars válidos quando o modo automático está desligado.
- [x] Desabilitar captura de rollback em `repo_apply_patch`/batch independentemente da policy global: o MCP não expõe ali um token executável e a captura integral do preimage só gerava custo sem mecanismo de consumo correspondente.
- [x] Fazer write/delete/copy/move/patch respeitarem a policy central e exporem `rollbackCaptureEnabled` onde relevante; quando desligada, hashes/preconditions continuam disponíveis sem materializar snapshot/sidecar.
- [x] Adicionar report central de policy, bytes/count/idade, over-budget e purge candidates ao maintenance plan.
- [x] Adicionar purge **explícito e schema-bounded** via `mcp_cleanup_ai_artifacts(purgeDisabledRollback=true)`, permitido apenas com rollback automático desligado; nomes desconhecidos, OAuth, tunnel, pid e quarantine permanecem fora do domínio destrutivo.
- [x] Incidente observado em 2026-08-15: antes da correção havia 108 sidecars ativos, 52.151.184 bytes, 0 expirados e 1 entrada desconhecida protegida. O crescimento vinha de patches pequenos em arquivos grandes: cada patch podia persistir o preimage integral (>256 KiB), demonstrando que TTL sozinho não controla crescimento dentro da janela de 24 h.
- [x] Após reload controlado, purgar os 108 sidecars reconhecidos (52.151.184 bytes) com zero falhas e preservar a entrada desconhecida; report pós-cleanup: `sidecarCount=0`, `sidecarBytes=0`, `ignoredEntryCount=1`.
- [x] Prova de aceitação pós-reload: aplicar patch real em `tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js` com ~684 KiB e confirmar imediatamente que `sidecarCount=0`/`sidecarBytes=0` permanecem inalterados.
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

---

# Parte XVII — Terceira onda: reconciliação temporal, diagnóstico live e governança operacional

## 71. Auditoria fresca de continuidade

Esta onda começou reconciliando o estado real com este documento, sem presumir que o fechamento anterior continuava válido.

Estado observado no início da nova conversa:

- [x] branch `main`.
- [x] upstream `origin/main`.
- [x] HEAD `9abb2ac8e2e2da034f30ea251b95085affed1bb4`.
- [x] commit funcional anterior `e2f69deaae16f17c67b3ebc6ae38926fe056a02f` presente no histórico.
- [x] `main` sem divergência causal nova conhecida em relação ao fechamento anterior.
- [x] SHA-256 deste documento ainda era `6ffd6341fb886fcea2d1d7ecdebbde94a06ecd9389bf855a47eb2736844d574b` antes desta atualização.
- [x] artefatos locais/preexistentes continuavam fora do escopo da transformação.

Itens deliberadamente preservados e que **não devem ser capturados pelo stage desta onda**:

- [x] `.vscode/settings.json`.
- [x] `DOCUMENTAÇÃO/tracing-background-task-display-report.md`.
- [x] `audit_externa_src_copilot`.
- [x] arquivos preexistentes em `src/DOCUMENTAÇÃO/COPILOT/AUDITORIA-ARQUITETURAL-AMPLA/`.
- [x] `src/copilot/.ai/rollback/` como estado local/runtime preexistente.
- [x] `workspaces/`.

A restrição de escopo permanece: esta onda não é campanha de decomposição dos grandes hotspots.

## 72. Autonomia MCP — estado fresco

A surface viva pré-transformação foi novamente auditada:

- [x] connector permanente `https://mcp.aurelin.org/mcp` funcional.
- [x] OAuth funcional.
- [x] `115` tools MCP observadas antes do novo reload.
- [x] `86` read-only.
- [x] `24` bounded write.
- [x] `4` destructive.
- [x] `1` open-world: `llmb_live_test_run`.
- [x] `mcp_post_restart_readiness.ready=true` no processo então carregado.
- [x] último reload persistido estava `completed`, profile `quic`, exit code `0`.

O `mcp_autonomy_power_score` observado nesta conversa foi **91/A**, abaixo do 96 histórico. Isso não foi interpretado como perda automática de autonomia: a principal penalidade deriva de `llmb_live_test_run` estar corretamente marcada com `openWorldHint=true`. A decisão desta onda é preservar a honestidade da classificação de risco em vez de manipular annotations apenas para elevar o score.

## 73. LLM-B — provas live control-only desta onda

A readiness profunda foi executada novamente com health do SQLite e permaneceu verde. Três canários novos foram executados por PTY, todos sem chamada deliberada de modelo/provider:

### 73.1 Tools read-only

- [x] runId `mcp-msthseiw`.
- [x] cenário `model-gateway-tools-readonly`.
- [x] modo `control-only`.
- [x] PTY.
- [x] exit code `0`.

### 73.2 Route apply minimal

- [x] runId `mcp-msthsrc1`.
- [x] cenário `model-gateway-route-apply-minimal`.
- [x] modo `control-only`.
- [x] PTY.
- [x] exit code `0`.

### 73.3 Recoverable tool error

- [x] runId `mcp-msti5tth`.
- [x] cenário `recoverable-tool-error`.
- [x] modo `control-only`.
- [x] PTY.
- [x] exit code `0`.

Evidência comum aos canários:

- [x] sessão persistida retomada.
- [x] `127` ferramentas observadas na sessão LLM-B.
- [x] BYOK pronto em `kilo-auto/free`.
- [x] `/usage`, `/activity`, `/session sdk`, CommandDefinitions, SSE, `/metrics`, `/events` e `/errors` observáveis.
- [x] nenhum consumo deliberado de AI Credits/quota externa nestes control-only.

Achado importante: igualdade do **model id** não implica igualdade do vínculo efetivo. A seleção preparada pode apontar para `kilo-auto/free` e ainda assim a sessão viva exigir `same-session-reattach-required` quando perfil/provider binding não coincide integralmente. O diagnóstico correto deve comparar provider, profile/preset, endpoint/binding e modelo, não apenas a string do modelo.

O histórico também preserva uma execução anterior de route apply com `106/107` critérios, cujo único gap foi o lifecycle de `report_intent`. Isso continua sendo uma evidência útil para futuros cenários reais, sem justificar consumo de provider por padrão.

## 74. Readiness pós-reload — reconciliação temporal implementada

Gap confirmado no início da onda: `mcp_post_restart_readiness` podia dizer que o connector smoke era fresh por idade, mas não provava que esse smoke tinha sido capturado **depois** do último self-reload.

Implementação desta onda:

- [x] novo `mcp/control-plane/reload-state.js` centraliza a leitura do state persistido.
- [x] o summary distingue reload ausente, in-flight, failed e completed-successfully.
- [x] reload completed com exit code não-zero é falha explícita.
- [x] reload in-flight não pode ser reconciliado como ready.
- [x] um reload concluído com sucesso exige connector smoke cujo `checkedAt >= completedAt`.
- [x] `mcp_post_restart_readiness` agora expõe o objeto `reload` como evidência de primeira classe.
- [x] `connectorSmoke.ageFresh` distingue frescor puramente temporal do frescor reconciliado.
- [x] `connectorSmoke.fresh` passa a exigir idade válida **e** reconciliação com o último reload.
- [x] next actions diferenciam reload em andamento, reload falho e smoke anterior ao reload.

Isso fecha o item residual anterior “integrar `mcp_reload_status` diretamente no readiness consolidado” no nível de state reconciliation. A prova live do código recém-carregado ainda depende do self-reload desta própria onda.

## 75. Cloudflare — taxonomia única para erros acionáveis e cancelamentos benignos

A investigação reproduziu uma inconsistência diagnóstica: `context canceled` aparecia em `recentOriginErrors` no tunnel status, enquanto o post-change gate já o tratava como cancelamento benigno de client/stream.

Correção:

- [x] criado `mcp/cloudflare/error-taxonomy.js`.
- [x] `context canceled/cancelled`, client disconnect, request cancellation, stream close e unexpected EOF passam por taxonomia compartilhada.
- [x] falhas duras de origin continuam acionáveis.
- [x] `tunnel-status` mantém `recentBenignOriginCancellations` visível para auditoria.
- [x] `recentOriginErrors` passa a significar erro acionável, não todo log ERR que menciona origin.
- [x] `cloudflare-post-change-gates` usa a mesma classificação compartilhada.
- [x] teste dedicado prova que `context canceled` permanece observável sem virar falha acionável.

O objetivo não é esconder erros; é impedir que encerramentos normais de stream contaminem a sinalização operacional.

## 76. QUIC/auto/H2 — planner reconciliado antes do benchmark

Foi encontrado drift de contrato no planner de benchmark:

- `http2` aparecia simultaneamente como `tcp-rollback-candidate` e como `Unsupported candidate`.

Correção:

- [x] `http2` agora é explicitamente o baseline/rollback TCP.
- [x] `auto` é descrito como candidato fallback-capable.
- [x] `quic` é descrito como candidato estrito a comparar com H2/auto.
- [x] teste impede regressão para `Unsupported candidate` no H2.

A política permanece evidence-gated:

- [ ] executar benchmark comparável QUIC/auto/H2 com janelas equivalentes após o novo código estar publicado e carregado.
- [ ] mudar o protocolo preferido apenas se os deltas de latência/reliability justificarem.

Nenhuma mudança de protocolo foi feita por intuição nesta etapa.

## 77. Usage/billing — regressão Prometheus corrigida

A busca por regressões da ontologia antiga encontrou um caso real no endpoint Prometheus: as métricas de recovery ainda tinham nomes/HELP centrados em Premium Requests.

Correção:

- [x] `llmb_dialog_recovery_without_additional_model_call_total` é métrica canônica.
- [x] `llmb_dialog_recovery_with_additional_model_call_total` é métrica canônica.
- [x] `llmb_dialog_recovery_zero_pr_total` permanece apenas como alias legacy/deprecated.
- [x] `llmb_dialog_recovery_pr_total` permanece apenas como alias legacy/deprecated.
- [x] HELP das métricas canônicas não eleva Premium Requests novamente à ontologia atual.
- [x] teste impede que `Premium Request` volte ao output canônico desse handler.

As ocorrências source restantes revisadas pertencem a taxonomia de erro/vendor, compatibilidade wire/SDK legado, documentação histórica ou parsers para labels antigos; não foram automaticamente apagadas porque parte delas é necessária à compatibilidade e ao diagnóstico de histórico.

## 78. Artifact hygiene — rollback agora mensurável, sem ampliar poder destrutivo

O maintenance report conhecia `.ai/jobs`, Cloudflare e MCP state, mas não fornecia inventário explícito dos sidecars de rollback.

Implementado:

- [x] contagem de sidecars reconhecidos em `.ai/rollback`.
- [x] bytes totais.
- [x] contagem/bytes de expirados pelo timestamp canônico no nome.
- [x] contagem/bytes de `.pending-*`.
- [x] contagem de entradas desconhecidas/ignoradas.
- [x] oldest/newest mtime.
- [x] ownership de cleanup declarado como `infra/io/fs/rollback-sidecar.js TTL cleanup`.
- [x] `maintenanceMutation=false` explicitamente no report.
- [x] teste com cleanup real prova que `mcp_cleanup_ai_artifacts` continua incapaz de apagar sidecars de rollback.

A mutation domain de `mcp_cleanup_ai_artifacts` continua restrita a artefatos UUID `.json/.log` de `.ai/jobs`. Esta onda aumentou observabilidade, não destrutividade.

## 79. Discovery/index — nova reconciliação

Estado fresco do índice:

- [x] schema `2` disponível.
- [x] aproximadamente `2.087` arquivos indexados no momento da auditoria.
- [x] aproximadamente `11.663` símbolos.
- [x] aproximadamente `3.800` imports.
- [x] `repo_find_orphan_imports` verificou `2.824` imports em `807` arquivos.
- [x] `orphanCount=0`.
- [x] `trueOrphan=0`.
- [x] aliases/protected imports permanecem classificados sem falso orphan.
- [x] `infra/public` continua descobrível.

A revisão do `.gitignore` confirmou que o build output está ancorado em `/public/`, não em `public/` global. Nenhum novo blind spot equivalente foi comprovado nesta varredura.

## 80. Performance e caches — decisão desta onda até aqui

- [x] runtime em Node `v24.15.0` confirmado por project doctor.
- [x] índice atual tem cerca de `2.087` arquivos, abaixo do sinal simples de pressão por tamanho `workspaceFiles > 3000` usado pelo planner de tiering.
- [x] L2 continua preparado porém desligado.
- [x] nenhum Redis/L2 foi habilitado por intuição.
- [x] `llmb_live_readiness` apareceu como outlier de latência nesta conversa, na ordem de ~16 s, merecendo perfilamento futuro específico.

Ainda aberto:

- [ ] workload reprodutível cold versus L1 versus L2.
- [ ] medir hit ratio e hotset ratio sob workload representativo.
- [ ] separar custo de index/parser/file IO do custo de provider/SQLite/runtime probes.
- [ ] só promover L2 se benchmark comparável mostrar ganho material sem regressão operacional.

## 81. Golden prompts — medição honesta

`mcp_golden_prompts` versão `4` continua fornecendo prompts e schema de medição explícito, incluindo approvals, OAuth linking, host blocks e completion.

- [x] prompt set e measurement schema foram novamente inspecionados.
- [x] esta conversa exercitou na prática o ciclo investigar → editar → validar via surfaces bounded.
- [ ] **não** marcar os golden prompts como medidos em “conversa limpa” nesta conversa longa.
- [ ] executar o protocolo em conversa realmente limpa e registrar os campos do schema sem inferência retroativa.

A ausência de score fabricado é deliberada: o experimento exige condições de host/approval que este contexto já não satisfaz.

## 82. Permissions — segurança sem reduzir autonomia

A implementação central foi revisada novamente em `sdk/session/permission-controller.js`:

- [x] `approve_all` permanece default deliberado e configurável por `AGENT_PERMISSION_MODE`.
- [x] `selective` sem regras explícitas aplica baseline `denyShell=true`.
- [x] denylist canônica cobre shell/npm/node script tools no baseline seletivo.
- [x] mudança de modo permanece centralizada e auditável.
- [x] nenhuma razão foi encontrada para transformar o default global em fail-closed sem contexto de ambiente.

Gap menor de diagnóstico, não enforcement:

- [ ] avaliar se endpoints de control devem reportar `unavailable/unknown` em vez de assumir visualmente `approve_all` quando `getPermissionMode` não existe. Qualquer mudança deve preservar compatibilidade de API e ser testada antes de alterar contrato.

## 83. Validação intermediária desta onda

Após as transformações source/test descritas acima:

- [x] strict typecheck passou.
  - job `ca6e669b-06e2-4fa1-8065-b7d42e09e39b`.
  - exit code `0`.
  - duração ~`9,64s`.
- [x] `mcp-fast` passou.
  - job `c5d4bf22-acac-43a8-8558-49151020a505`.
  - exit code `0`.
  - duração ~`32,6s`.
- [x] `mcp-full` final desta árvore passou.
  - job `2f405664-0c72-4623-bdc1-d332f6a56b0d`.
  - exit code `0`.
  - duração ~`103,0s`.
- [x] `copilot-fast` final da árvore corrigida passou.
  - primeira execução `caff7ae6-d6f7-46e5-a52f-0dbcb52063e0` detectou corretamente uma falha no teste novo: o teste chamava `handleMetrics()` sem bootstrap do token DI `METRICS_STORE`; runtime/source não falharam.
  - o teste foi corrigido para validar o contrato Prometheus diretamente no source, sem instanciar singletons fora do bootstrap.
  - rerun final `613ab004-8593-40ee-b424-e09bf908a707` passou com exit code `0` em ~`171,0s`.
  - `6.860` testes: `6.832` passed, `0` failed, `28` pending.
  - `2.080` suites: `2.080` passed.
  - typecheck, lint, docs-contract e architecture-contract verdes no mesmo job final.
- [x] publicação Git desta onda concluída.
- [x] self-reload do novo código concluído e reconciliado.
- [x] connector smoke pós-reload capturado depois do novo `completedAt`.
- [x] prova live do novo `mcp_post_restart_readiness.reload` concluída.
- [x] canário LLM-B pós-reload do código publicado concluído.
- [x] hotfix incremental da taxonomia Cloudflare validado por `mcp-fast`.
  - job `c6b8dea1-1527-431c-8f4b-68be037d988f`.
  - exit code `0`.
  - duração ~`32,35s`.

## 84. Roadmap residual atualizado — terceira onda

### 84.1 Fechado nesta própria conversa

- [x] finalizar `mcp-full` e `copilot-fast`.
- [x] stage explícito apenas dos arquivos causalmente pertencentes a esta onda.
- [x] commit e push upstream-only para `main`.
- [x] self-reload governado.
- [x] refresh OAuth/connector smoke depois de cada reload relevante.
- [x] provar `reload.reconciledWithConnectorSmoke=true` no readiness novo.
- [x] revalidar registry remoto/local em `115/115`.
- [x] executar canário LLM-B control-only pós-reload.
- [x] aplicar retenção bounded de `.ai/jobs` somente após dry-run e classificação dos candidatos.
- [x] atualizar novamente este documento com a prova pós-publicação.

### 84.2 Evidence-gated que permanecem abertos

- [ ] benchmark cold/L1/L2 representativo.
- [ ] benchmark QUIC/auto/H2 estatisticamente comparável com o mínimo de amostras exigido pelo planner; o piloto bounded de uma janela por profile já foi concluído, mas não satisfaz esse limiar.
- [ ] golden prompts em conversa limpa.
- [ ] perfilamento específico do custo de `llmb_live_readiness`.
- [ ] avaliar diagnostic fallback de permissions sem quebrar API.
- [ ] avaliar dev-watch dedicado da LLM-B apenas se remover intervenção manual mensurável.
- [ ] provider/model real apenas quando o consumo externo for deliberadamente justificado.

Observação importante sobre QUIC/H2/auto: esta onda corrigiu o contrato do planner e, na continuação, executou um **piloto bounded controlado de uma janela por profile**, com self-reload, smoke autenticado, readiness reconciliado, métricas e post-change gates para H2, auto e retorno a strict QUIC. O piloto foi útil para rejeitar promoção intuitiva, mas cada processo forneceu apenas quatro amostras de registro RPC, abaixo do mínimo de cinco amostras por protocolo definido pelo próprio planner. O benchmark estatisticamente comparável continua aberto; QUIC permanece como controle estável por evidência insuficiente para mudança, não por preferência intuitiva.

### 84.3 Decomposição — continua deliberadamente fora desta onda

- [ ] `terminal/commands/byok.js`.
- [ ] `sqlite-catalog-store.js`.
- [ ] `dev-oauth.js`.
- [ ] `session.js`.
- [ ] `sdk.js`.
- [ ] `sdk-session-events.js`.
- [ ] demais hotspots apenas por tamanho.

## 85. Publicação Git desta onda

**Nota de causalidade:** os commits abaixo apareceram no `main` durante uma mudança concorrente de HEAD. A execução desta conversa havia feito o stage causal dos 16 paths, mas o `git_commit_plan` foi bloqueado pelo precondition porque o HEAD mudou de `9abb2ac8e2e2da034f30ea251b95085affed1bb4` para `3cabeeeeaf14e5683d9ac89f57f71f022af041c9` antes do commit. Portanto, os commits são evidência canônica do estado publicado, mas sua autoria **não é atribuída a esta execução**. O bloqueio evitou commit duplicado ou sobreposição silenciosa.

Commit funcional observado no HEAD:

`a0912dc5f6746ee6e0490064cf3904a4ad9365c1`

Mensagem:

`feat(copilot): reconcile reload readiness and runtime diagnostics`

- [x] 16 arquivos causalmente pertencentes à transformação.
- [x] 652 inserções e 48 remoções.
- [x] `.vscode/settings.json`, auditorias locais, `.ai/rollback` runtime e `workspaces/` ficaram fora do commit.
- [x] `git_push_plan` dry-run passou.
- [x] push para `origin/main` passou.
- [x] imediatamente após o push: `ahead=0`, `behind=0`.

Hotfix evidence-driven posterior observado no HEAD concorrente:

`3cabeeeeaf14e5683d9ac89f57f71f022af041c9`

Mensagem:

`fix(copilot): classify graceful h2 stream closures`

- [x] somente `mcp/cloudflare/error-taxonomy.js` e seu teste foram alterados.
- [x] `stream error ... NO_ERROR; received from peer` passou a ser cancelamento/fechamento benigno observável.
- [x] failures `Unable to reach the origin service`/GOAWAY continuam acionáveis.
- [x] `mcp-fast` verde antes da publicação do hotfix.
- [x] push upstream-only concluiu novamente com `ahead=0`, `behind=0`.

## 86. Primeira prova do readiness temporal no runtime novo

Primeiro self-reload desta onda:

- requestId `mcp-reload-367118cd-d341-47e1-ae50-c5949c98b14f`;
- profile `current -> quic`;
- runner PID `76098`;
- novo MCP HTTP PID `76254`;
- novo cloudflared PID `76262`;
- `completedAt=1786746384074`;
- exit code `0`.

A prova mais importante foi feita **antes** do novo smoke:

- [x] local health `200`.
- [x] public health `200`.
- [x] smoke antigo ainda tinha idade considerada fresh (`~42 min`).
- [x] `reload.completedSuccessfully=true`.
- [x] `reload.smokeAfterReload=false`.
- [x] `reload.reconciledWithConnectorSmoke=false`.
- [x] `connectorSmoke.ageFresh=true`.
- [x] `connectorSmoke.fresh=false`.
- [x] readiness final naquele momento: `ready=false`.

Isto prova o contrato novo: health verde + smoke recente por idade não basta para declarar a nova geração pronta quando o smoke antecede o reload.

Após `mcp_connector_smoke_refresh`:

- [x] OAuth metadata verde.
- [x] challenge unauthenticated `401` esperado.
- [x] OAuth authenticated smoke verde.
- [x] registry remoto/local `115/115`.
- [x] missing local tools `0`.
- [x] unexpected remote tools `0`.
- [x] SSE inicial verde.
- [x] reconnect SSE verde.
- [x] Last-Event-ID aceito.
- [x] `reload.smokeAfterReload=true`.
- [x] `reload.reconciledWithConnectorSmoke=true`.
- [x] `connectorSmoke.fresh=true`.
- [x] `mcp_post_restart_readiness.ready=true`.

## 87. Cloudflare — prova live da nova taxonomia

O runtime publicado mostrou imediatamente que a primeira taxonomia ainda deixava um falso positivo residual:

`stream error: stream ID 7; NO_ERROR; received from peer`

Como o próprio protocolo informa `NO_ERROR`, a linha foi classificada como fechamento benigno de stream, com teste explícito e hotfix separado.

Segundo self-reload, já no commit `3cabeeeea`:

- requestId `mcp-reload-f3f48084-95f2-4651-9b76-3a7cad6ee3a6`;
- profile `current -> quic`;
- runner PID `77389`;
- novo MCP HTTP PID `77520`;
- novo cloudflared PID `77528`;
- `completedAt=1786746584324`;
- exit code `0`.

Antes do smoke da segunda geração:

- [x] readiness novamente recusou o smoke anterior por `smokeAfterReload=false`.
- [x] a antiga linha `NO_ERROR` já não aparecia em `recentOriginErrors`.
- [x] `recentOriginErrors` ficou restrito aos dois failures GOAWAY reais observados às `22:16:13Z`.
- [x] cancelamentos `context canceled` permaneceram visíveis em `recentBenignOriginCancellations`.

Após novo smoke:

- [x] OAuth smoke verde.
- [x] registry `115/115`.
- [x] SSE/reconnect verdes.
- [x] `reload.reconciledWithConnectorSmoke=true`.
- [x] readiness `ready=true`.

A taxonomia ainda não apaga histórico nem transforma GOAWAY com request failure em benigno. Ela somente separa encerramentos que carregam evidência explícita de não-erro.

## 88. LLM-B pós-publicação

Canário canônico após o primeiro reload publicado:

- runId `mcp-mstioxs7`;
- modo `control-only`;
- cenário `canonical`;
- transporte PTY;
- exit code `0`;
- chamada explícita de modelo/provider: não;
- consumo deliberado de AI Credits/quota externa: não.

Evidência:

- [x] LLM-B pronta.
- [x] sessão permanente retomada (`#9`).
- [x] `127` ferramentas.
- [x] BYOK pronto em `kilo-auto/free`.
- [x] `/usage now` manteve tokens/contexto e separou histórico Copilot da rota BYOK atual.
- [x] quota request-based apareceu humanizada como `billing legacy por request`, sem voltar a ser ontologia canônica.
- [x] `/activity` verde.
- [x] `/session sdk` expôs 7 CommandDefinitions.
- [x] vínculo preparado versus vínculo vivo continuou diagnosticando `same-session-reattach-required` por diferença de profile/binding, apesar do mesmo model id.
- [x] SSE archive sem failed/dropped events.
- [x] `/errors` retornou zero.
- [x] shutdown limpo.

## 89. Performance/cache e artifact hygiene observados no runtime novo

Snapshot do runtime pós-reload:

- [x] índice rebuilt automaticamente e fresco, com ~`2.105` arquivos e ~`11.689` símbolos naquele snapshot.
- [x] L1 habilitado.
- [x] L2 `off` por default e `configurationValid=true`.
- [x] L3 reservado/desabilitado.
- [x] hit ratio inicial observado `0,4` em amostra muito pequena (`2 hits / 3 misses`), insuficiente para decisão de L2.
- [x] planner retornou `l2Decision=keep-off` e `representativeBenchmarkPassed=false`.
- [x] nenhum Redis/L2 foi promovido sem benchmark.

Artifact report pós-reload:

- [x] `.ai/rollback`: 25 sidecars reconhecidos, ~10,16 MB.
- [x] rollback expirados: `0`.
- [x] rollback pending: `0`.
- [x] `maintenanceMutation=false` para rollback.
- [x] `.ai/jobs` tinha 46 artifacts além da retenção de 240.
- [x] dry-run classificou exatamente 46 candidatos, todos UUID `.json/.log`, total `40.094` bytes.
- [x] OAuth stores, tunnel state/token, PID files, quarantine, rollback e nomes não-UUID ficaram protegidos por design.
- [x] cleanup bounded aplicado: 46 deletados, 40.094 bytes, zero falhas, `remainingCandidateCount=0` naquele momento.

Novos jobs de validação posteriores podem naturalmente voltar a criar artefatos; a política permanece retenção por quantidade, não promessa de diretório estático.

## 90. Estado de continuidade após a terceira onda

### Fechado

- [x] readiness agora correlaciona a geração do reload com a geração do smoke.
- [x] falso-verde temporal foi reproduzido e eliminado ao vivo.
- [x] Cloudflare separa cancelamentos benignos de failures acionáveis com taxonomia compartilhada.
- [x] `context canceled` não contamina `recentOriginErrors`.
- [x] `NO_ERROR ... received from peer` não contamina `recentOriginErrors`.
- [x] H2 é reconhecido corretamente como baseline/rollback no planner.
- [x] recovery Prometheus usa additional model call como ontologia canônica; PR fica legacy alias.
- [x] rollback é mensurável sem entrar no domínio destrutivo do maintenance cleanup.
- [x] Git bounded foi usado para publicar a transformação e o hotfix.
- [x] self-reload bounded foi usado duas vezes e reconectou sem intervenção manual.
- [x] OAuth/registry/SSE foram provados após reload.
- [x] LLM-B control-only PTY foi provada pós-publicação.
- [x] source publicado em `origin/main` até `3cabeeeeaf14e5683d9ac89f57f71f022af041c9` antes deste fechamento documental.

### Continua aberto por evidência insuficiente, não por esquecimento

- [ ] benchmark comparável cold/L1/L2.
- [ ] benchmark controlado QUIC/auto/H2.
- [ ] golden prompts em conversa limpa.
- [ ] benchmark/profile específico de `llmb_live_readiness`.
- [ ] eventual executor bounded para benchmark de transporte, se for a melhor forma de remover a etapa manual hoje restante.
- [ ] diagnostic fallback de permissions `unknown/unavailable` versus `approve_all` visual.
- [ ] dev-watch LLM-B dedicado apenas se benefício operacional for mensurável.
- [ ] provider/model real somente quando consumo externo for deliberadamente autorizado pelo objetivo do teste.

### Decomposição — explicitamente adiada

- [ ] `terminal/commands/byok.js`.
- [ ] `sqlite-catalog-store.js`.
- [ ] `dev-oauth.js`.
- [ ] `session.js`, `sdk.js`, `sdk-session-events.js` e demais hotspots.

## 91. Veredito final da terceira onda

**GO — transformação publicada, recarregada e provada no runtime vivo.**

O ciclo autônomo foi exercitado novamente de ponta a ponta, agora com uma propriedade adicional importante: o próprio readiness consegue provar se o smoke pertence ou não à geração carregada pelo self-reload.

Fluxo efetivamente comprovado nesta onda:

`auditar -> editar bounded -> validar -> stage causal -> commit -> push upstream-only -> self-reload -> rejeitar smoke velho -> OAuth smoke novo -> readiness reconciliado -> LLM-B control-only -> observar runtime -> corrigir taxonomia residual -> revalidar -> publicar hotfix -> self-reload -> reprovar/reconciliar nova geração`

A próxima fronteira não é decomposição. É tornar também os experimentos evidence-gated de performance/transporte tão bounded e reprodutíveis quanto Git, reload e smoke já são hoje.

## 92. Concorrência Git — prova real dos preconditions bounded

A própria publicação desta onda produziu uma prova que não deve ser perdida na narrativa de continuidade.

- [x] a execução começou em `HEAD=9abb2ac8e2e2da034f30ea251b95085affed1bb4`.
- [x] `git_stage_plan` enumerou exatamente 16 paths causalmente pertencentes à transformação.
- [x] `git_stage` aplicou esse conjunto com o precondition do HEAD antigo.
- [x] imediatamente antes do commit, `git_commit_plan` recusou a operação com `ERR_GIT_HEAD_PRECONDITION`.
- [x] o HEAD real já havia avançado para `3cabeeeeaf14e5683d9ac89f57f71f022af041c9`.
- [x] `git_log` mostrou os commits concorrentes `a0912dc5f6746ee6e0490064cf3904a4ad9365c1` e `3cabeeeeaf14e5683d9ac89f57f71f022af041c9` sobre o HEAD inicial.
- [x] após a mudança concorrente, o status deixou de mostrar os 16 arquivos funcionais como worktree/index changes: seu conteúdo já estava absorvido pelo novo HEAD.
- [x] `git_push_plan` no novo HEAD encontrou `origin/main` já `up to date`, com `ahead=0` e `behind=0`.
- [x] esta execução **não** emitiu um segundo commit funcional sobre as mesmas mudanças.
- [x] os artefatos locais/preexistentes permaneceram fora do stage e fora do conjunto publicado.

O resultado é uma prova concreta de que os preconditions bounded não são apenas documentação de segurança: eles impediram uma sobreposição concorrente real. A publicação funcional está correta no repositório, mas a autoria dos dois commits concorrentes não é atribuída a esta execução.

## 93. Provas adicionais após a publicação concorrente

Depois de reconciliar o novo HEAD, o runtime já carregado foi novamente provado.

### 93.1 Reload/readiness e registry

Reload observado e reconciliado:

- requestId `mcp-reload-f3f48084-95f2-4651-9b76-3a7cad6ee3a6`;
- profile `quic`;
- exit code `0`;
- `completedAt=1786746584324`.

- [x] `mcp_post_restart_readiness.ready=true`.
- [x] `reload.completedSuccessfully=true`.
- [x] `reload.smokeAfterReload=true`.
- [x] `reload.reconciledWithConnectorSmoke=true`.
- [x] connector smoke de `2026-08-14T22:30:00.820Z` era posterior ao reload.
- [x] refresh explícito adicional em `2026-08-14T22:31:24.720Z` passou.
- [x] OAuth challenge unauthenticated permaneceu `401` esperado.
- [x] authenticated runtime health passou.
- [x] registry remoto/local permaneceu `115/115`.
- [x] SSE inicial e reconnect passaram.
- [x] `mcp_tools_status` permaneceu em 115 tools: 86 read-only, 24 bounded write, 4 destructive e 1 open-world.

### 93.2 LLM-B pós-reload — canário adicional

- runId `mcp-mstium82`;
- modo `control-only`;
- cenário `model-gateway-tools-readonly`;
- transporte PTY;
- exit code `0`;
- modelo/provider invocado deliberadamente: não;
- quota/AI Credits externos consumidos deliberadamente: não.

Evidência:

- [x] sessão persistida #1 retomada.
- [x] `127` ferramentas.
- [x] 7 CommandDefinitions expostos.
- [x] BYOK pronto em `kilo-auto/free`.
- [x] `/usage`, `/activity`, `/session sdk`, `/events`, SSE, `/metrics` e `/errors` funcionaram.
- [x] `/errors` terminou em zero.
- [x] archive SSE terminou sem failed/dropped events.
- [x] o vínculo vivo e a seleção preparada tinham o mesmo model id, mas profiles diferentes; `same-session-reattach-required` permaneceu corretamente diagnosticado.

Isto reforça a regra: model id igual não é prova suficiente de route binding igual.

### 93.3 Artifact hygiene — snapshot posterior

O maintenance report posterior encontrou:

- [x] `.ai/rollback`: 25 sidecars reconhecidos.
- [x] bytes de rollback: `10.163.619`.
- [x] expirados: `0`.
- [x] pending: `0`.
- [x] entradas ignoradas/desconhecidas: `1`.
- [x] `maintenanceMutation=false` para rollback.
- [x] `.ai/jobs`: 244 artifacts no snapshot.
- [x] somente 4 candidatos estavam então além da retenção, totalizando 1.616 bytes.

A seção 89 registra uma limpeza bounded concorrente anterior de 46 artifacts; os quatro candidatos posteriores são crescimento normal criado por novos jobs. Esta execução não fez nova limpeza destrutiva: o ganho marginal era irrelevante e não havia rollback expirado.

## 94. Piloto bounded QUIC/H2/auto

O planner corrigido passou a reconhecer H2 como baseline/rollback TCP e definiu `minimumSamplesPerProtocol=5`. Foi então executado um piloto controlado com os mesmos tipos de gates em cada profile. Ele **não** é promovido a benchmark estatisticamente concluído porque cada processo forneceu apenas quatro registros RPC.

### 94.1 Controle QUIC antes das trocas

Snapshot imediatamente anterior ao piloto:

- transport `quic`;
- HA connections `4`;
- `rpcClientLatency.count=4`;
- média `374 ms`;
- p50 `300 ms`;
- p95 `435 ms`;
- p99 `447 ms`;
- QUIC RTT latest `22 ms`;
- QUIC smoothed RTT `23 ms`;
- `packetTooBigDropped=0`.

### 94.2 H2

Reload:

- requestId `mcp-reload-872e435f-5050-4053-8315-d9523bbcefb7`;
- profile `h2`;
- exit code `0`.

Provas:

- [x] reconexão sem intervenção manual.
- [x] OAuth/connector smoke verde.
- [x] registry `115/115`.
- [x] SSE/reconnect verde.
- [x] readiness `ready=true`.
- [x] `reload.reconciledWithConnectorSmoke=true`.
- [x] HA connections `4`.
- [x] `recentOriginErrors=[]` após o smoke.
- [x] QUIC metrics ausentes, como esperado em H2.

Latência de registro RPC:

- count `4`;
- média `789 ms`;
- p50 `900 ms`;
- p95 `1.305 ms`;
- p99 `1.341 ms`.

O processo foi observado inicialmente em 95 requests/15 request errors e posteriormente em 190/39. O delta foi de +95 requests/+24 errors. Os logs mostraram cancelamentos benignos recorrentes e nenhum origin error acionável pós-smoke, mas não há evidência suficiente para atribuir individualmente todo incremento cumulativo; por isso esse sinal **reduz**, e não aumenta, a confiança para promoção de H2.

### 94.3 Auto

Reload:

- requestId `mcp-reload-efd0459c-ad18-4bf0-8af6-0deb5cd495b2`;
- profile `auto`;
- exit code `0`.

Uma consulta caiu na janela transitória com `mcp_network_error`; a reconexão seguinte confirmou o state `completed` com exit `0`, caracterizando a interrupção esperada do próprio reload, não falha persistente.

Provas:

- [x] OAuth/connector smoke verde.
- [x] registry `115/115`.
- [x] SSE/reconnect verde.
- [x] readiness `ready=true`.
- [x] `reload.reconciledWithConnectorSmoke=true`.
- [x] HA connections `4`.
- [x] `recentOriginErrors=[]` após o smoke.
- [x] `quic.present=true`: o profile auto escolheu QUIC nesta janela.
- [x] `packetTooBigDropped=0`.

Latência de registro RPC:

- count `4`;
- média `573 ms`;
- p50 `450 ms`;
- p95 `1.260 ms`;
- p99 `1.332 ms`;
- QUIC RTT latest `45 ms`;
- QUIC smoothed RTT `33 ms`.

### 94.4 Restauração do controle strict QUIC

Como nem H2 nem auto produziram evidência suficiente de superioridade, strict QUIC foi restaurado deliberadamente.

Reload final do piloto:

- requestId `mcp-reload-bea5b449-2dce-4b62-bd46-867e93db936e`;
- profile `quic`;
- exit code `0`.

Provas finais:

- [x] smoke OAuth/connector verde.
- [x] registry `115/115`.
- [x] SSE/reconnect verde.
- [x] readiness `ready=true`.
- [x] `reload.smokeAfterReload=true`.
- [x] `reload.reconciledWithConnectorSmoke=true`.
- [x] HA connections `4`.
- [x] `recentOriginErrors=[]` após o smoke.
- [x] QUIC metrics presentes.
- [x] `packetTooBigDropped=0`.
- [x] post-change gates passaram.

Snapshot da geração restaurada:

- `rpcClientLatency.count=4`;
- média `481 ms`;
- p50 `350 ms`;
- p95 `1.170 ms`;
- p99 `1.314 ms`;
- QUIC RTT latest `27 ms` e smoothed `29 ms` no snapshot; o gate subsequente observou RTT dentro do budget em ~`25 ms`.

A diferença entre dois snapshots strict QUIC da própria rodada — p95 de `435 ms` antes do piloto e `1.170 ms` depois — demonstra a variância de amostra pequena. H2 (`1.305 ms`) e auto (`1.260 ms`) não justificaram mudança, mas tampouco estes quatro registros por processo permitem um ranking estatístico definitivo.

Decisão:

- [x] nenhum profile foi promovido por intuição.
- [x] strict QUIC foi restaurado como controle operacional estável.
- [x] H2 e auto foram provados como funcionalmente recuperáveis.
- [ ] executar no futuro o benchmark completo com pelo menos o mínimo de amostras comparáveis exigido pelo planner e workloads equivalentes por profile.

## 95. Estado final desta continuação antes do fechamento documental

- [x] source funcional publicado até `3cabeeeeaf14e5683d9ac89f57f71f022af041c9` e sincronizado com `origin/main` antes deste fechamento documental.
- [x] transport final: strict QUIC.
- [x] connector permanente: `https://mcp.aurelin.org/mcp`.
- [x] OAuth funcional.
- [x] registry remoto/local: `115/115`.
- [x] readiness final do piloto: `ready=true` e reload reconciliado.
- [x] LLM-B control-only PTY provada após o código publicado.
- [x] nenhum provider/model real foi chamado deliberadamente nesta continuação.
- [x] L2 permaneceu desligado por ausência de benchmark representativo.
- [x] decomposição estrutural dos hotspots permaneceu deliberadamente fora do escopo.
- [x] gate final da árvore/documentação após esta atualização do MD.
  - `mcp-full`: job `bb31c29a-d858-48a5-8d63-68801313bfbb`, exit code `0`, ~`68,9s`.
  - `copilot-fast`: job `4a577b60-6aa7-471a-ad14-776546fb61e3`, exit code `0`, ~`214,6s`.
  - `6.860` testes: `6.832` passed, `0` failed, `28` pending; `2.080/2.080` suites passed.
  - typecheck, lint, docs-contract e architecture-contract verdes no gate final.
- [x] commit/push documental da reconciliação principal concluído.
  - commit publicado `e2a78c5958d6f6bc25a8ef72e8a013f49d811010` — `docs(copilot): record third-wave runtime evidence`.
  - `origin/main` observado com `ahead=0` e `behind=0` após o push.

Roadmap residual real:

- [ ] benchmark cold/L1/L2 representativo e reprodutível.
- [ ] benchmark QUIC/H2/auto estatisticamente suficiente, com janelas/workloads equivalentes.
- [ ] golden prompts em conversa limpa, preenchendo o measurement schema real.
- [ ] perfilamento específico do custo de `llmb_live_readiness`.
- [ ] avaliar o diagnostic fallback de permissions `unknown/unavailable` sem quebrar compatibilidade.
- [ ] avaliar executor/dev-watch adicionais apenas quando removerem intervenção manual mensurável.
- [ ] usar provider/model real apenas quando consumo externo fizer parte deliberada da prova.
- [ ] decomposição dos hotspots em conversa futura separada.

## 96. Follow-up concorrente pós-fechamento — validator jobs não anexados

Depois do commit documental `175a6565c5f60df36563aca2f09a01e93b66e818`, três mudanças source/test apareceram concorrentemente na worktree, fora da causalidade desta execução:

- `src/copilot/mcp/control-plane/jobs.js`;
- `src/copilot/mcp/tools/jobs.js`;
- `tests/unit/copilot/mcp/test_mcp_jobs.spec.js`.

A execução atual **não** as stageou nem as apropriou. O ator concorrente as validou e publicou posteriormente como:

`c91de8d79dce228663f9f4d2336245906c95a637`

Mensagem:

`fix(copilot): surface unattached validator jobs`

- [x] `origin/main` observado em `ahead=0`, `behind=0` após esse commit.
- [x] typecheck concorrente `3b176812-4a21-4b74-96a1-edc29e0fc15e`, exit code `0`.
- [x] `mcp-fast` concorrente `26a38525-013d-4d74-b0fc-8e6cb5baebd9`, exit code `0`, ~`33,2s`.

O problema era real e foi observado nesta própria conversa: o manifest `38aba9a6-5f31-4e65-b6a6-4b45ab5aca00` permanecia persistido como `running` depois que o processo que o criara já não era o MCP runtime atual. Antes do follow-up, isso contaminava `runningCount` e poderia induzir ChatGPT a esperar indefinidamente ou tentar cancelar um job sem child-process handle verificável.

Contrato novo provado no runtime:

- [x] `PublicJobRecord` expõe `runtimeAttached`.
- [x] manifest persistido em `running` sem processo anexado é classificado como `orphaned=true` e `runtimeAttached=false`.
- [x] `mcp_validation_dashboard.runningCount=0` após o reload do novo código.
- [x] `mcp_validation_dashboard.orphanedCount=1` para o manifest histórico conhecido.
- [x] `runningJobIds=[]`.
- [x] `orphanedJobIds=[38aba9a6-5f31-4e65-b6a6-4b45ab5aca00]`.
- [x] os effective checks permanecem baseados em validators concluídos e verdes, não no manifest órfão.
- [x] `recommendedNextAction=none` quando os checks efetivos estão verdes.

A prova de segurança do cancelamento também foi executada:

- [x] `job_cancel(38aba9a6-5f31-4e65-b6a6-4b45ab5aca00)` foi recusado.
- [x] código retornado: `ERR_JOB_UNATTACHED`.
- [x] nenhum PID não verificado foi sinalizado ou morto.
- [x] o hint orienta inspeção bounded do log e rerun do validator, em vez de kill inseguro.

Self-reload concorrente observado após o commit:

- requestId `mcp-reload-42912f0d-d4b8-4a41-98ff-1655eb9ba65f`;
- profile `quic`;
- exit code `0`;
- `completedAt=1786747512754`.

Antes do smoke novo:

- [x] health local/public permanecia verde.
- [x] `reload.smokeAfterReload=false`.
- [x] `reload.reconciledWithConnectorSmoke=false`.
- [x] readiness recusou corretamente o smoke da geração anterior com `ready=false`.

Após `mcp_connector_smoke_refresh`:

- [x] OAuth smoke verde.
- [x] authenticated registry remoto/local `115/115`.
- [x] SSE inicial e reconnect verdes.
- [x] `reload.smokeAfterReload=true`.
- [x] `reload.reconciledWithConnectorSmoke=true`.
- [x] `mcp_post_restart_readiness.ready=true`.
- [x] `recentOriginErrors=[]`.
- [x] transport permaneceu strict QUIC.

Este follow-up fecha outro gargalo de autonomia exposto pela própria combinação de validator jobs persistidos + self-reload: o sistema agora distingue **estado persistido** de **processo ainda controlável pelo runtime atual**. A autoria do commit `c91de8d79` continua sendo atribuída apenas ao ator concorrente observado, não a esta execução.

### 96.1 Gate final pós-follow-up

- [x] executar gates finais sobre `c91de8d79` + esta atualização documental.
  - `mcp-full`: job `3ba05271-5486-4b61-909f-1f1c30858164`, exit code `0`, ~`92,9s`.
  - `copilot-fast`: job `9ce97a9e-0df9-4d73-b049-530a0202f6e3`, exit code `0`, ~`321,1s`.
  - `6.861` testes: `6.833` passed, `0` failed, `28` pending.
  - `2.080/2.080` suites passed; typecheck, lint, docs-contract e architecture-contract verdes.
- [x] publicar esta última reconciliação documental em `main`.
  - commit publicado `500bab4d2665224dc04dd80e5e9551370fca238d` — `docs(copilot): record unattached job follow-up`.
  - `origin/main` observado com `ahead=0`, `behind=0` após o push.
  - houve um `CHATGPT_HOST_PRECALL_BLOCK` no primeiro `git_stage` documental: `mcp_host_block_diagnostics` confirmou que a chamada não chegou ao MCP; o retry da mesma operação bounded, com o mesmo path explícito e precondition, passou sem ampliar permissões.

## 97. Quarta onda — validação proporcional e focused-first

Diretriz operacional explícita desta continuação: validadores passam a ser usados com **raridade muito maior**. O custo de validação faz parte da decisão técnica; `mcp-full` e `copilot-fast` deixam de funcionar como reflexo automático depois de pequenas alterações.

Política de escalada adotada:

1. inspeção estática do diff, imports, contratos e testes vizinhos;
2. nenhum validator quando execução não acrescenta evidência material;
3. teste unitário por arquivos explícitos quando houver superfície causal clara;
4. typecheck isolado somente quando tipos/JSDoc/contrato público realmente o justificarem;
5. suites amplas somente para mudanças transversais, regressão sem localização, ou release gate deliberado.

Transformação source concluída:

- [x] `mcp_validation_plan` deixa de assumir `mcp-fast` quando chamado sem argumentos; o default passa a ser `inspect-first` + `no-validator-yet`.
- [x] `mcp_validation_plan testFile=...` planeja execução file-scoped e explicita uma política de escalada.
- [x] `run_copilot_validator` ganha `validator=unit-focused` com um único arquivo `.spec.js` explícito sob `tests/unit/copilot/` por job.
- [x] glob, path traversal, paths não canônicos e final symlink são rejeitados; `realpath` também impede escape por diretório-pai symlinkado.
- [x] a implementação reutiliza `run_copilot_validator` em vez de adicionar uma 116ª tool.
- [x] guidance de session profile, connector smoke, golden prompts, capabilities e `mcp_tools_status` foi alterado de broad-first para focused-first.
- [x] `CAPABILITIES_VERSION` avançou de 38 para 39 porque o contrato de validação mudou, sem aumentar o número de tools.
- [x] testes locais foram ajustados para path policy, command resolution, planner default/focused/broad, invariantes de input e approval workflow.
- [x] usar apenas gate proporcional nesta onda; `mcp-full` e `copilot-fast` não foram executados.
- [x] publicar o conjunto causal e self-reload.
- [ ] provar end-to-end `unit-focused` em uma conversa/reconexão cujo host já tenha recarregado o novo input schema de `run_copilot_validator`.

### 97.1 Validação proporcional realmente usada

A ordem real da evidência foi:

1. revisão estática de diff, imports e contratos;
2. `repo_find_orphan_imports` em `src/copilot/mcp`: 98 arquivos, 245 imports locais verificados, `0` orphans e `0` parse errors;
3. um único bootstrap `mcp-fast` antes da compactação final do schema;
4. depois da falha localizada, nenhum rerun da suíte: apenas typecheck isolado e provas live pós-reload.

O bootstrap `mcp-fast` foi job `1e0ec4e5-82db-47ca-87b3-7d301e280a6c`, exit code `1`, ~`38,3s`:

- [x] typecheck interno passou (~`8,9s`);
- [x] `57/58` arquivos de teste MCP passaram;
- [x] `303/304` testes passaram;
- [x] a única falha foi `test_tool_payload_audit.spec.js`, porque o primeiro schema expandido ultrapassou o envelope de 128 KiB;
- [x] a falha levou à redução do contrato público de `testFiles[]` para um único `testFile` e à decisão de não criar uma 116ª tool;
- [x] **a suíte não foi repetida**.

Depois da compactação, o único validator pré-publicação foi typecheck isolado:

- job `c6458a67-93d0-4d95-a2d8-5c6b576e7967`;
- exit code `0`;
- duração ~`5,6s`.

Isto é o padrão pretendido: falha localizada gera correção localizada, não escalada automática para validators mais amplos.

### 97.2 Publicação e prova live

Commit funcional principal:

`b8fadd1352957679332af2d3cfae2fea8eabb005`

Mensagem:

`feat(copilot): make validation focused by default`

- [x] 10 arquivos causais.
- [x] 328 inserções / 45 remoções.
- [x] push upstream-only concluído com `ahead=0`, `behind=0`.
- [x] self-reload `mcp-reload-fcee3ad4-03b3-4f84-9d66-e7190e89d117`, profile `quic`, exit code `0`.
- [x] OAuth smoke pós-reload verde.
- [x] registry remoto/local permaneceu `115/115`.
- [x] readiness reconciliado `ready=true`.

Prova do planner no runtime publicado:

- [x] `mcp_validation_plan {}` retornou `strategy=inspect-first`, `recommendation=no-validator-yet`, `plannedTool=null`.
- [x] `mcp_validation_plan testFile=tests/unit/copilot/mcp/test_mcp_jobs.spec.js` retornou `strategy=focused-first`, `breadth=file-scoped`, `validator=unit-focused` e comando Vitest restrito àquele arquivo.

### 97.3 Tool-schema budget e compactação posterior

O primeiro smoke do código publicado mediu:

- tools: `115`;
- `tools/list responseBytes=130.921`;
- teto: `131.072` bytes (`128 KiB`);
- folga: apenas `151` bytes.

Essa margem foi considerada operacionalmente frágil. Em vez de ignorá-la ou acrescentar outra suíte de validação, foi feita uma micro-onda estática de compactação dos descriptors de validação e correção do guidance de aprovação.

Commit:

`32ce0c8d1e51dfcb4a877d69632ba8b967124848`

Mensagem:

`chore(copilot): slim validation descriptors`

- [x] `mcp_tools_status` passou a colocar `run_copilot_validator` — não `mcp_run_safe_validation_suite` — na primeira wave de approval.
- [x] workflow de validação passou a ser `mcp_validation_plan -> run_copilot_validator`.
- [x] broad suite continua disponível, mas somente como escalation.
- [x] descriptors de jobs/validation foram encurtados sem remover semântica de segurança.
- [x] nenhum validator foi executado para essa micro-onda descritiva.
- [x] push upstream-only concluído.
- [x] self-reload `mcp-reload-b19e6ca4-aafb-42df-94ae-da21aec677d8`, profile `quic`, exit code `0`.
- [x] smoke OAuth/registry/SSE verde.
- [x] readiness final `ready=true`.
- [x] `recentOriginErrors=[]`.

Após a compactação:

- tools: `115`;
- `tools/list responseBytes=130.052`;
- folga: `1.020` bytes;
- ganho de folga: `869` bytes, aproximadamente `6,75x` a margem anterior.

### 97.4 Limitação residual desta conversa: schema cache do host

A chamada live de `run_copilot_validator validator=unit-focused testFile=...` não chegou ao MCP porque o host desta conversa ainda mantém o schema anterior da tool, cujo enum não contém `unit-focused`.

`mcp_host_block_diagnostics` classificou o episódio como:

- `code=CHATGPT_HOST_PRECALL_BLOCK`;
- `layer=chatgpt-host`;
- `confidence=high`;
- `mcpReachedServer=false`;
- `schemaErrorPresent=true`.

Portanto:

- [x] não é failure do handler novo;
- [x] não é failure do runtime MCP;
- [x] não é justificativa para executar `unit-mcp`, `mcp-full` ou `copilot-fast` como substitutos;
- [ ] na próxima conversa/reconexão, confirmar que o host recebeu o novo schema e executar `unit-focused` somente nos arquivos causalmente relevantes.

A revisão estática desta onda evitou duas regressões antes de validators: primeiro, uma 116ª tool desnecessária; depois, um schema público pesado demais. O novo princípio operacional fica estabelecido: **o validator precisa justificar seu custo marginal; amplitude não é sinônimo de confiança.**

### 97.5 Focused-first também no autonomy runner

O diagnóstico seguinte encontrou um resíduo da política anterior: `delegate_to_repo_autonomy_runner` ainda tratava `validate-mcp-full` como missão normal. A superfície existente foi reutilizada, sem criar nova tool.

Commit:

`0e7e30f7ca082e97d968c4b3bee7907f8682363f`

Mensagem:

`feat(copilot): delegate focused validation`

- [x] missão `validate-focused` adicionada ao runner bounded.
- [x] recebe somente um `testFile` explícito, reutilizando a mesma normalização/segurança de `unit-focused`.
- [x] dry-run expõe `run_copilot_validator -> job_get_summary`, sem broad suite.
- [x] execução real inicia somente `unit-focused` para aquele arquivo.
- [x] `validate-mcp-full` permanece disponível, mas explicitamente classificado como broad escalation.
- [x] nenhuma nova MCP tool foi adicionada.
- [x] `CAPABILITIES_VERSION` avançou de `39` para `40`.

Validação proporcional:

- [x] `repo_find_orphan_imports` em `src/copilot/mcp/tools`: 41 arquivos, 101 imports locais, `0` órfãos, `0` parse errors.
- [x] typecheck isolado `c16477d6-d97e-4597-a337-14842136d543`, exit code `0`, ~`7,8s`.
- [x] nenhuma suíte de testes foi executada.

Prova pós-publicação:

- [x] self-reload `mcp-reload-bb5bb360-78eb-48bd-ad67-b3bb1f4cbbbc`, profile `quic`, exit code `0`.
- [x] OAuth/registry/SSE verdes.
- [x] registry `115/115`.
- [x] `tools/list responseBytes=130.088`, apenas 36 bytes acima da versão compactada anterior.
- [x] folga restante no envelope de 128 KiB: `984` bytes.
- [x] `mcp_session_profile` passou a recomendar `validate-focused` como fluxo delegado padrão.

## 98. Quinta onda — benchmark de transporte bounded e reprodutível

O piloto QUIC/H2/auto anterior mostrou que o planner era melhor que o processo operacional: a troca de profiles, smoke, métricas e restauração ainda exigia uma sequência manual. A solução adotada **não** adiciona uma nova tool; reutiliza `delegate_to_repo_autonomy_runner` com uma missão fixa `benchmark-transport` e um runner detached.

### 98.1 Correção metodológica do benchmark

O piloto anterior usava `rpcClientLatency.count` como referência de amostragem. O baseline vivo mostrou novamente `rpcClientLatency.count=4`, coerente com as quatro conexões HA do cloudflared e inadequado como requisito de cinco amostras de tráfego.

O novo contrato passa a usar:

- [x] **cinco execuções idênticas do canonical OAuth/connector smoke por profile** como amostras primárias;
- [x] duração wall-clock end-to-end de cada smoke como métrica comparável;
- [x] p50/p95/p99 calculados sobre as cinco durações;
- [x] métricas cloudflared de RPC/proxy latency, QUIC RTT, HA e counters como diagnósticos secundários;
- [x] request-error delta medido antes/depois no mesmo processo cloudflared;
- [x] delta positivo não é automaticamente declarado benigno: a janela fica `reviewRequired=true` e inelegível para decisão automática.

A consequência é conceitualmente importante: o benchmark mede **o workload MCP que realmente nos interessa**, e não a cardinalidade incidental das conexões de edge.

### 98.2 State machine detached

Novo runner:

`src/copilot/mcp/scripts/scheduled-transport-benchmark-runner.js`

Novo estado fixo:

`src/copilot/.ai/mcp/transport-benchmark-state.json`

Propriedades de segurança:

- [x] requestId é gerado pelo servidor.
- [x] profiles possíveis continuam restritos a `quic`, `auto` e `http2`/`h2`.
- [x] quantidade de amostras é fixa em `5`; não há parâmetro aberto ao usuário.
- [x] não aceita shell, comando, path, env override ou profile candidato arbitrário.
- [x] cada restart reutiliza `scheduled-restart-runner.js`, preservando a correlação `reload.completedAt -> connector smoke` do readiness.
- [x] cada profile recebe restart limpo, warmup bounded, métricas before, 5 smokes e métricas after.
- [x] smoke failure, restart failure, métricas indisponíveis após retry bounded ou `haConnections != 4` interrompem a sequência.
- [x] request-error delta positivo não aborta o restante da coleta, mas torna a janela review-required.
- [x] o profile de controle inicial é restaurado em `finally` mesmo após failure.
- [x] falha de persistência do estado intermediário não pode impedir a rota de restore.
- [x] o restore final executa um smoke adicional, fora da amostra, para reconciliar a geração restaurada.
- [x] child processes possuem timeout, SIGTERM e fallback SIGKILL bounded.
- [x] `autoPromotion=false` é persistido e retornado; o runner **nunca promove** um candidato.

### 98.3 Planner e estado

`mcp_cloudflare_transport_benchmark_plan` permanece read-only, mas agora:

- [x] declara `sampleMetric=wall-clock duration of the canonical OAuth/connector smoke workload`.
- [x] expõe a missão `benchmark-transport` como executor preferencial.
- [x] mantém troca manual apenas como fallback.
- [x] expõe `lastRun` a partir do state file fixo.
- [x] compacta `lastRun`, omitindo cada registro individual de smoke e preservando p95/deltas/HA/diagnósticos essenciais.
- [x] separa execução bem-sucedida de elegibilidade para decisão.
- [x] mantém política de no máximo 10% de regressão p95 contra o controle para elegibilidade.

### 98.4 Validação proporcional

Nenhuma suíte ampla foi executada nesta onda.

Inspeção estática:

- [x] `repo_find_orphan_imports` em `src/copilot/mcp`: 102 arquivos, 259 imports locais, `0` órfãos e `0` parse errors.
- [x] `repo_file_outline` do runner novo passou sem parse error.
- [x] architecture contract passou a exigir a presença do runner detached.

Typecheck isolado:

- primeira execução `81118b42-b84a-409e-bd3f-a5bee1ebc961`, exit code `2`, ~`7,9s`;
- único erro: tipo de `restoreSmoke.error` inferido como `string`, enquanto `runSmoke()` retorna `string | null`;
- correção local por anotação JSDoc explícita;
- rerun `8ef7eb03-c2b4-404f-afdc-267c03396829`, exit code `0`, ~`5,26s`.

- [x] falha localizada -> correção localizada -> rerun somente do typecheck.
- [x] nenhum `mcp-fast`, `mcp-full`, `copilot-fast`, `unit-mcp` ou `unit-copilot` foi executado.

### 98.5 Publicação e prova live

Commit:

`38177b81b8b1c3daa0e4cc93d024c6d722dfb20c`

Mensagem:

`feat(copilot): automate bounded transport benchmark`

- [x] 9 arquivos causais.
- [x] 730 inserções / 20 remoções.
- [x] `CAPABILITIES_VERSION` avançou de `40` para `41`.
- [x] push upstream-only concluiu com `ahead=0`, `behind=0`.
- [x] self-reload `mcp-reload-97bd4489-e8e6-4e2e-a118-36638fa1ba6d`, profile `quic`, exit code `0`.
- [x] OAuth/registry/SSE pós-reload verdes.
- [x] readiness `ready=true`, smoke posterior ao reload e reconciliado.
- [x] registry remoto/local `115/115`.
- [x] `tools/list responseBytes=130.110`.
- [x] folga remanescente sob 128 KiB: `962` bytes.

Planner vivo após publicação:

- [x] controle atual `quic`.
- [x] baseline `haConnections=4`.
- [x] baseline `rpcClientLatency.count=4`, reforçando a correção metodológica.
- [x] `lastRun=null` antes da primeira execução delegated.
- [x] `minimumSamplesPerProtocol=5` agora se refere às cinco execuções do smoke, não ao contador RPC.
- [x] `delegatedExecution.mission=benchmark-transport`.
- [x] `delegatedExecution.autoPromotion=false`.
- [x] `delegatedExecution.restoresInitialControl=true`.

### 98.6 Limitação residual da sessão atual

Assim como `unit-focused`, a missão `benchmark-transport` altera o enum de uma tool já carregada pelo host. Esta conversa ainda anuncia o schema anterior de `delegate_to_repo_autonomy_runner`, portanto uma chamada `mission=benchmark-transport` seria bloqueada pelo host antes de chegar ao MCP.

- [x] o executor está publicado e carregado no servidor.
- [x] o planner atualizado está comprovadamente live nesta conversa porque seu schema de entrada não mudou.
- [ ] em uma nova conversa/reconexão, confirmar que o host recebeu `CAPABILITIES_VERSION=41`/schema novo.
- [ ] executar primeiro `delegate_to_repo_autonomy_runner mission=benchmark-transport dryRun=true`.
- [ ] se o plano estiver correto e a janela de múltiplos restarts for aceitável, executar `dryRun=false`.
- [ ] acompanhar `lastRun.status` pelo planner, sem polling agressivo durante as trocas.
- [ ] confirmar `restoredControl=true`, restore smoke verde e comparar as três janelas.
- [ ] **não promover automaticamente** nenhum profile; qualquer mudança permanente continua evidence-gated e separada do benchmark.

O gap residual do benchmark deixa de ser falta de executor. Passa a ser apenas a necessidade de executar a missão uma vez a partir de um host que já conheça o schema atualizado.

## 99. Sexta onda — benchmark representativo cold/L1/L2 isolado

A investigação do cache mostrou que o gap era mais simples que o de transporte. O caminho canônico de `readText`/`readBytes` já implementa:

`L1 -> L2 SQLite -> filesystem -> repopulação dos tiers`.

Além disso, `IO_L2_CACHE_PROFILE` é process-local e `COPILOT_DB_PATH` permite um SQLite isolado. Portanto o benchmark não precisa reiniciar MCP/Cloudflare, nem tocar no `copilot.sqlite` operacional.

### 99.1 Workload e metodologia

Workload fixo do worker:

- `package.json`;
- `src/copilot/mcp/tools/runtime-health.js`;
- `src/copilot/mcp/tools/jobs.js`;
- `src/copilot/infra/io/fs/read-services.js`;
- este roadmap canônico.

Fases, sempre em processos auxiliares novos:

1. **cold**: L2 `off`, uma leitura cronometrada do workload; cache esperado `l1-miss`;
2. **L1**: L2 `off`, uma passagem de prime não cronometrada + segunda passagem cronometrada; cache esperado `l1-hit`;
3. **L2 prime**: profile `experimental`, SQLite temporário próprio, prime do workload e flush;
4. **L2 restart-style**: novo processo, mesmo SQLite temporário, primeira passagem cronometrada; cache esperado `l2-hit`.

Cada fase comparável usa `5` amostras. O benchmark mede a duração wall-clock da passagem completa sobre o mesmo workload e calcula average/p50/p95/p99.

Critério deliberadamente conservador:

- [x] cinco amostras bem-sucedidas em cada fase;
- [x] todos os arquivos precisam apresentar o cache-state esperado em cada fase;
- [x] L2 precisa melhorar o p95 do cold em pelo menos `10%`;
- [x] `representativeBenchmarkPassed` só fica true quando todas essas condições passam;
- [x] `autoEnable=false` sempre;
- [x] mesmo um benchmark favorável apenas suporta avaliação posterior do profile experimental; nunca habilita L2 automaticamente.

Essa metodologia aceita explicitamente um resultado negativo. Se o page cache do SO tornar filesystem cold mais barato que SQLite L2, isso é evidência legítima para **manter L2 off**.

### 99.2 Isolamento e segurança

Novos componentes:

- `src/copilot/mcp/control-plane/io-cache-benchmark-state.js`;
- `src/copilot/mcp/scripts/io-cache-benchmark-worker.js`;
- `src/copilot/mcp/scripts/scheduled-io-cache-benchmark-runner.js`.

Propriedades:

- [x] requestId gerado no servidor e validado por regex estrita;
- [x] workload não é parametrizável pelo usuário;
- [x] worker modes são allowlisted: `cold`, `l1`, `l2-prime`, `l2`;
- [x] banco isolado sob `src/copilot/.ai/mcp/io-cache-benchmark/<requestId>/copilot.sqlite`;
- [x] root e request dir precisam ser diretórios reais, não symlinks;
- [x] `COPILOT_DB_PATH` e `IO_L2_CACHE_PROFILE` existem apenas no processo filho;
- [x] banco operacional não é alterado;
- [x] worker faz flush do L2 e fecha o SQLite;
- [x] runner remove todo o diretório temporário em `finally`;
- [x] child output é bounded;
- [x] worker timeout é bounded, com SIGTERM e fallback SIGKILL;
- [x] estado final persistido fica fora do diretório temporário;
- [x] nenhuma nova MCP tool foi criada.

### 99.3 Integração com autonomia e runtime health

`delegate_to_repo_autonomy_runner` recebeu a missão fixa `benchmark-io-cache`:

- dry-run descreve `mcp_runtime_health -> scheduled_io_cache_benchmark_runner -> mcp_runtime_health`;
- execução real apenas agenda o runner detached;
- não aceita path/workload/profile de cache arbitrário;
- persiste audit event;
- retorna `autoEnable=false` e `isolatedDb=true`.

`mcp_runtime_health` agora expõe:

- `metrics.ioCacheBenchmark` — resumo compacto do último estado persistido;
- `metrics.ioCachePlanWithBenchmark` — `buildIoCacheTierPlan()` recalculado com a evidência real do benchmark e com o número real de arquivos do índice.

Isto corrige uma limitação anterior: `ioRuntime.cache.plan` ainda era construído sem `workspaceFiles` e sem evidência persistida, enquanto a projeção nova consegue decidir sobre dados reais.

### 99.4 Validação proporcional

Nenhuma suíte ampla foi executada.

Inspeção estática:

- [x] `repo_find_orphan_imports` em `src/copilot/mcp`: 104 arquivos, 257 imports locais, `0` órfãos e `0` parse errors;
- [x] worker e runner passaram em `repo_file_outline` sem parse error;
- [x] architecture contract passou a exigir os dois scripts.

Typecheck isolado foi usado somente por haver novos scripts `@ts-check`/JSDoc:

- `e56ee4d0-c601-4695-ac39-ce9e4789df5f`: exit `2`, ~`8,38s`; somente implicit-any/narrowing/index-signature no código novo;
- correções locais de JSDoc e tipo de `finalState`;
- `6f2120f2-7ed0-4945-85ca-e41b8699064b`: exit `2`, ~`5,57s`; restaram somente 4 acessos TS4111 no mesmo `finally`;
- correção mecânica para bracket notation;
- `131597b2-8dc2-41fa-a602-72e65386a206`: exit `0`, ~`5,80s`.

- [x] failure localizado -> correção localizada -> rerun apenas do typecheck;
- [x] nenhum `unit-mcp`, `mcp-fast`, `mcp-full`, `unit-copilot` ou `copilot-fast` foi executado.

### 99.5 Publicação e prova live

Commit:

`a29d6e7772e5f06b439f3cf937578fc502d82c6e`

Mensagem:

`feat(copilot): benchmark io cache tiers`

- [x] 10 arquivos causais;
- [x] 557 inserções / 1 remoção;
- [x] `CAPABILITIES_VERSION` avançou de `41` para `42`;
- [x] push upstream-only concluiu com `ahead=0`, `behind=0`;
- [x] self-reload `mcp-reload-86119e06-af11-4d1a-b572-edcdb27423c9`, profile `quic`, exit code `0`;
- [x] OAuth/registry/SSE pós-reload verdes;
- [x] registry remoto/local `115/115`;
- [x] `tools/list responseBytes=130.131`, margem de `941` bytes sob 128 KiB;
- [x] runtime health final `ok=true`.

Prova live antes da primeira execução:

- [x] `ioCacheBenchmark=null`;
- [x] L2 runtime continua `profile=off`, `configurationValid=true`;
- [x] índice atual: `2.138` arquivos;
- [x] `ioCachePlanWithBenchmark.evidence.workspaceFiles=2138`;
- [x] `representativeBenchmarkPassed=false`;
- [x] `l2Decision=benchmark-required`;
- [x] nenhuma promoção foi inferida pela existência do executor.

### 99.6 Limitação residual da sessão atual

Uma nova consulta de schema ao connector confirmou que o host desta conversa continua expondo o enum antigo de `delegate_to_repo_autonomy_runner`:

`diagnose-mcp | validate-mcp-full | maintenance-safe-dry-run`.

Portanto `validate-focused`, `benchmark-transport` e `benchmark-io-cache` estão carregados no servidor, mas não são invocáveis por este host sem uma nova conversa/reconexão.

- [x] não executar fallback manual para contornar o schema cache;
- [x] não usar validator amplo como substituto;
- [ ] em sessão fresca, confirmar `CAPABILITIES_VERSION=42` e o enum novo;
- [ ] dry-run `benchmark-io-cache`;
- [ ] executar `benchmark-io-cache` real;
- [ ] ler `mcp_runtime_health.metrics.ioCacheBenchmark` até estado terminal sem polling agressivo;
- [ ] confirmar `cleanedTemporaryDb=true`;
- [ ] decidir L2 somente a partir do resultado real: `keep-off` ou avaliação separada do profile experimental.

O gap cold/L1/L2 também deixa de ser falta de executor. Assim como no benchmark de transporte, o único bloqueio restante é o schema cache do host desta conversa.

## 100. Sétima onda — provenance do diagnóstico de permissões

A investigação do roadmap residual encontrou uma ambiguidade entre **modo efetivo de compatibilidade** e **estado realmente observado**.

Antes desta onda, `readTerminalConfigProjection()` mantinha uma propriedade comportamental útil: quando o snapshot do runtime não informava `permissionMode`, a projeção retornava `approve_all` como fallback. O problema estava na camada diagnóstica: `/diagnose` interpretava esse fallback como se fosse observação do runtime e exibia `permissões automáticas · prompts SDK ignorados`.

A política real não foi alterada. O contrato compatível `permissionMode` continua existindo e continua podendo cair em `approve_all`. A mudança foi acrescentar provenance paralela:

- `permissionModeObserved`: modo realmente presente no snapshot, ou `null`;
- `permissionModeSource`: `runtime-snapshot` ou `compatibility-fallback`.

O `/diagnose` agora diferencia explicitamente:

- [x] modo observado: renderiza o modo, o comportamento dos prompts e `observado no runtime`;
- [x] ausência de observação: renderiza `não informado`, mostra o modo efetivo apenas como `fallback de compatibilidade` e marca `prompts SDK desconhecidos`;
- [x] não afirma mais que prompts SDK são ignorados quando essa informação não foi observada;
- [x] nenhuma permission policy, controller, SDK prompt policy ou runtime behavior foi modificada.

Testes de contrato foram ajustados para os dois cenários:

- fallback sem `permissionMode` no status snapshot;
- snapshot observado com `permissionMode=selective`.

### 100.1 Validação proporcional

Nenhuma suíte ampla foi executada.

- [x] `repo_find_orphan_imports` em `src/copilot/terminal`: 119 arquivos, 515 imports locais, `0` órfãos, `0` parse errors;
- [x] revisão do diff confirmou que `permissionMode` efetivo permanece backward-compatible;
- [x] typecheck isolado `7044cc80-01e0-4699-b21b-b706214609df`, exit code `0`, ~`6,99s`;
- [x] nenhum `unit-copilot`, `copilot-fast`, `mcp-fast` ou suíte maior foi executado.

### 100.2 Publicação

Commit:

`c59954eb9e2b7f69606607f83e8553c1eaae3cb5`

Mensagem:

`fix(copilot): distinguish observed permission state`

- [x] 3 arquivos causais;
- [x] 43 inserções / 7 remoções;
- [x] push upstream-only concluído com `ahead=0`, `behind=0`;
- [x] sem self-reload do MCP, porque a mudança pertence à apresentação/config projection do terminal e não altera a surface do servidor MCP.

O gap de permissions fica fechado sem quebrar a API comportamental anterior: **o fallback continua funcionando, mas deixa de ser apresentado como conhecimento observado.**

## 101. Oitava onda — `llmb_live_readiness` como caminho operacional rápido e reutilizável

Depois do fechamento do gap de permissões, o foco passou para o custo real da readiness da LLM-B. A medição inicial instrumentada mostrou um custo total de aproximadamente **16,46 s** por execução fresca. O perfil revelou que o custo não estava concentrado em um único check: snapshots, redaction integral e seleção/selector plans acumulavam trabalho relevante.

A otimização foi conduzida por medição e preservando a cobertura de segurança. Nenhum check foi removido para produzir números melhores.

### 101.1 Sequência de otimização medida

- baseline instrumentado: ~`16,46 s`;
- leitura concorrente de source snapshot, SQLite snapshot e diagnostics: ~`13,38 s`;
- redaction integral de catálogo + SQLite movida para execução paralela: ~`7,58 s` em medição válida;
- uma medição aparente de ~`7,18 s` foi **rejeitada** porque o worker havia usado um path de catálogo incorreto e varrido apenas 2 strings; ela não conta como evidência;
- após correção do path, a cobertura integral voltou a ser comprovada;
- worker threads substituíram child processes para o caminho in-process;
- pool persistente passou a reutilizar workers/módulos/store/conexão entre readiness frescas;
- fast-path algorítmico de redaction eliminou materialização cara em strings que não podiam conter candidato a segredo;
- o trabalho interno dos audits caiu aproximadamente de `3,8–4,3 s` para `1,7–1,9 s` por audit no cenário saudável;
- a contenção de CPU passou a dominar mais que bootstrap de worker, razão pela qual o wall-clock total não cai linearmente com a redução do core-time de redaction.

Cobertura preservada nas medições válidas:

- [x] catálogo: `945.249` strings auditadas;
- [x] SQLite: `1.069.621` strings auditadas;
- [x] leaks: `0` em ambos;
- [x] redaction continua full-scan; não foi trocada por sampling.

### 101.2 Readiness in-process e caches evidence-aware

O antigo adapter MCP abria um novo processo Node para cada readiness. A implementação foi convertida em módulo reutilizável:

- `buildModelGatewayLiveReadiness(options)` concentra a implementação canônica;
- o CLI permanece como adaptador fino;
- o MCP usa lazy dynamic import e executa `fresh-in-process`;
- subprocesso ficou apenas como fallback de carregamento, nunca como tentativa de “curar” um check logicamente falho.

O adapter ganhou ainda:

- [x] single-flight para chamadas idênticas concorrentes;
- [x] cache curto de resposta integral;
- [x] invalidação por fingerprint **lógico do Model Gateway**, e não por qualquer escrita incidental no SQLite compartilhado;
- [x] fingerprint inclui catálogo, watermarks/tabelas relevantes do Model Gateway e health BYOK;
- [x] falha ao observar a evidência lógica desabilita o reaproveitamento em vez de reutilizar estado possivelmente stale;
- [x] prova live de segunda chamada como `memory-cache`, com a mesma fotografia lógica.

Também foram adicionados tiers estáticos conservadores:

- source catalog + integrity audit;
- seleções metadata-only que dependem apenas do catálogo/ambiente;
- runtime health, overlays, post-runtime selection, SQLite parity e checks voláteis continuam frescos.

Commits principais desta onda:

- `d410d2699d530529aa7590e88be22e1061a10b00` — `perf(model-gateway): parallelize readiness audits`;
- `a27797db4eac984ba7e383c053ba8b2438144541` — compartilhamento de preparação/routing/runtime-health e cache MCP inicial;
- `57d7d2ad6` / `bcdfce222` — estabilização e fingerprint lógico da readiness;
- `f2cd2a40d` — readiness in-process;
- `96860ba0c` — workers persistentes;
- `f1085afd6` — fast-path de redaction e poda de recomputações;
- `6d71b1063` — static source tier;
- `e25e5ad12` — static selection tier.

### 101.3 Validação proporcional

- [x] medições live da própria readiness foram usadas como prova funcional principal;
- [x] parse/outline e inspeção de imports foram usados durante a refatoração;
- [x] typecheck isolado foi executado apenas quando contratos JSDoc/import mudaram;
- [x] nenhuma suíte ampla foi usada para “certificar” cada micro-otimização;
- [x] a política focused-first introduzida nas ondas anteriores foi mantida.

Pendência de performance:

- [ ] medir de forma controlada a `fresh warm` final com os tiers estáticos atuais, separando source static hit, selection static hit e custo estritamente volátil;
- [ ] continuar reduzindo recomputação do caminho volátil apenas quando o perfil demonstrar retorno material.

## 102. Nona onda — epistemologia temporal de proof e seleção `quality_first`

Uma prova real com `terminal:llm-b` expôs um erro mais grave que simples score: a sessão podia nascer em uma rota cuja prova positiva era antiga e cujo modelo já não constava no catálogo remoto atual. O caso observado foi `mistral/devstral-medium-2507`: discovery atual não o oferecia e probes reais retornaram `Invalid model`, mas estado histórico ainda podia contribuir para `runtime_proved`.

A correção foi feita no ponto de verdade, não apenas na apresentação.

### 102.1 Proof é temporal

O Model Gateway passou a separar:

- prova histórica positiva;
- prova positiva **fresca**;
- falha recente/cooldown;
- falha antiga re-probeable.

Default operacional inicial:

- `maxRuntimeProofAgeHours=24`.

Semântica:

- [x] sucesso antigo permanece disponível para diagnóstico, mas não satisfaz `requireRuntimeProof`;
- [x] sucesso stale não recebe bônus de `runtime_proved`;
- [x] `requireAgentProbeOk` exige agent proof fresco;
- [x] falha recente continua bloqueando/penalizando conforme policy/cooldown;
- [x] falha antiga não vira blacklist eterna e pode ser sondada novamente;
- [x] policy engine, runtime selector e projeções operator-facing consomem a mesma noção de frescor;
- [x] quando health records atuais existem, eles são autoridade sobre booleanos históricos do selection trace;
- [x] `/byok` e tools passaram a distinguir `proved` de `stale`.

Commit-base:

`4a2aeea0e` — `fix(model-gateway): expire stale runtime proof`.

### 102.2 `quality_first`

A investigação do score mostrou outro viés incompatível com a política do operador: preço era penalizado incondicionalmente, inclusive em tarefas como `repo_agent` e `deep_reasoning`.

Foi criado `selectionGoal="quality_first"`:

- [x] custo não reduz score;
- [x] latência tem peso apenas secundário;
- [x] capacidade, adequação à tarefa, elegibilidade e funcionamento permanecem centrais;
- [x] proof funcional atua como **gate/certificação**, não como substituto de qualidade intelectual;
- [x] falha recente continua sendo evidência operacional negativa;
- [x] `balanced`/cost/latency policies continuam disponíveis quando o operador realmente quiser esses trade-offs.

Isto implementa explicitamente a política desta operação: **não há limitação de uso da LLM-B por custo ou quantidade de chamadas; não selecionar um modelo inferior apenas para economizar quota.**

## 103. Décima onda — `model_gateway_workflow_plan` como cérebro adaptativo de seleção

Em vez de criar mais uma tool, `model_gateway_workflow_plan` foi promovido a ponto canônico de decisão da LLM-B.

O workflow agora separa duas perguntas que antes ficavam misturadas:

1. **discovery ranking** — qual é a melhor candidata para a tarefa, mesmo que ainda não tenha proof fresco;
2. **proved ranking** — qual candidata já satisfaz agora o contrato runtime exigido.

A diferença entre as duas gera `selectionDecision` com estados operator-facing:

- `use_current`;
- `switch_recommended`;
- `probe_required`;
- `blocked`.

Protocolo adaptativo:

1. rankear por `quality_first`;
2. se o winner discovery não estiver provado, executar somente o **candidato acionável #1**;
3. usar `agent` como certificado principal de `repo_agent`/`tool_agent`;
4. após **todo** probe, sucesso ou falha, recalcular `model_gateway_workflow_plan`;
5. nunca executar candidato #2 usando ranking calculado antes da evidência do candidato #1;
6. continuar automaticamente diante de falhas objetivas, sem perguntar ao usuário se deve “tentar o próximo”;
7. só recomendar promoção depois de proof fresco;
8. preservar a mesma SDK session durante a promoção.

A skill `.github/skills/llm-b-route-operator/SKILL.md` e sua referência passaram a ensinar a mesma semântica. `llm-b-ops` também foi reconciliada com a política de validators focused-first, removendo validação ampla ritualística como default.

Commit principal:

`aed1c1f731c064a2b476a2b98e40b770cece3bc8` — `feat(model-gateway): make llm-b route selection adaptive`.

- [x] `terminal:llm-b` é tratado explicitamente como cockpit humano/LLM central;
- [x] usuário e LLM-B recebem os mesmos conceitos de estado/proof;
- [x] a rota ativa, discovery winner, proved winner, idade/kind do proof e next action fazem parte do explanation contract;
- [x] `selectionDecision.operatorExplanation` fornece a projeção humana da **mesma decisão**, com headline, current/discovery/proved, proof age, alternativas e próximo passo, evitando que LLM-B/usuário precisem traduzir `rationale` técnico;
- [x] o system prompt agora carrega `llm-b-route-operator` também em seleção/comparação/dúvida de adequação ou qualidade, não apenas em falha/troca;
- [x] optional SDK sentinel `__UNSET__` é normalizado na fronteira do workflow, evitando interpretar ausência como runtime/provider literal.

Follow-up publicado:

`9fec11659cbfd7bf166575b55b8a8b05f781b251` — `feat(llm-b): explain adaptive route decisions`.

## 104. Décima primeira onda — harness real, admission proof e execução adaptativa durável

O harness real ainda refletia um paradigma antigo: antes de deixar a LLM-B usar as tools, rodava uma bateria fixa de chat/streaming/JSON/vision/agent probes. Isso podia consumir toda a janela em uma rota ruim e impedir que a própria inteligência adaptativa entrasse em ação.

A arquitetura foi separada em dois contratos:

- **admission proof**: probe real mínimo suficiente para abrir `terminal:llm-b` em uma rota respondente;
- **task proof**: prova funcional forte definida pela tarefa; para `repo_agent`, agent probe adaptativo.

Mudanças:

- [x] cenários Model Gateway usam preflight enxuto;
- [x] `byok-real-turn + routeProfile` ativa o runtime-selector como admission gate;
- [x] rota respondente de bootstrap não é automaticamente declarada “melhor repo-agent”;
- [x] falso blocker após final marker foi corrigido: conclusão terminal é barreira causal e diagnósticos históricos posteriores não reclassificam o turno;
- [x] cenário read-only real provou que a LLM-B abre o cockpit, chama Model Gateway tools, executa `ask_user` e conclui o turno;
- [x] `kilo-code/kilo-auto/free` foi observado como rota de **bootstrap respondente**, não como winner final quality-first;
- [x] `model-gateway-adaptive-probe` foi criado para `workflow -> agent probe -> rerank`, bounded a no máximo 8 tentativas e sem promoção durante a fase de seleção;
- [x] host com enum stale ganhou bridge auditável: no modo `byok-real-turn`, o valor legado aceito pelo host resolve internamente para o cenário adaptativo e o plano expõe `requestedScenario`/`resolvedScenario`.

Commits:

- `f4d85fa497294ceeda48ff995e9729874164eb3c` — `fix(llm-b): align adaptive admission harness`;
- `6a3e5f4299e202e57ca8d605d4acf7e08f9f70f5` — `feat(llm-b): add adaptive route probe scenario`;
- `66d44b19b` — `fix(llm-b): bridge stale host scenario schema`.

### 104.1 Live runs longos deixam de depender do timeout do request MCP

A primeira tentativa de executar o cenário adaptativo mostrou um gargalo de transporte/orquestração: o request ChatGPT -> MCP expirou antes de um fluxo legítimo com vários providers terminar. A execução parcial criou `artifacts/terminal-live/mcp-msublf39`, mas não chegou a produzir um summary persistido.

A solução não foi aumentar timeout indefinidamente. O cenário adaptativo passou a usar execução detached e observável:

- [x] o harness canônico continua sendo a única implementação;
- [x] `llmb_live_test_plan` declara `executionMode=detached` para o cenário adaptativo real;
- [x] `llmb_live_test_run` lança diretamente o harness fixo como processo detached e retorna `runId`, PID e `outDir` imediatamente;
- [x] manifesto persistido usa runId UUID restrito e não aceita shell/path/env arbitrário;
- [x] `llmb_live_runs` reconcilia manifests por PID vivo + presença de `summary.md` e continua mostrando o ledger SQLite histórico;
- [x] o processo sobrevive ao término do request que o iniciou e pode continuar atravessando providers;
- [x] demais cenários permanecem síncronos, preservando compatibilidade.

Commits desta camada:

- `8dab31c47aa114bdd1df2c9eefc0fe062551c083` — `feat(llm-b): detach adaptive live selection runs`;
- `4285a01a0e15066180c4a90abf3899f7563f2a1c` — `feat(llm-b): expose detached selection progress`.

O segundo commit acrescenta `detached.runner.log` progressivo para **novos** runs detached, mantendo compatibilidade com manifests antigos sem `logPath`. O log fica no próprio `outDir`, com stdout/stderr do harness, sem criar uma nova tool nem um segundo protocolo de execução.

Validação proporcional desta mudança:

- [x] `repo_file_outline` sem parse error;
- [x] typecheck estrito `f94b620e-bbf1-4870-84f4-87091def15ac`, exit `0`, ~`21,3 s`;
- [x] nenhum validator amplo executado.

Prova operacional após reload:

- [x] OAuth/connector smoke autenticado verde;
- [x] registry remoto/local `115/115`;
- [x] SSE/reconnect verde;
- [x] plano adaptativo retorna `executionMode=detached`;
- [x] lançamento real retornou imediatamente com `detached=true`;
- [x] run atual: `mcp-0e4185a7-1cab-4601-9dce-995abf8dd7b1`;
- [x] PID `21849` observado vivo após o lançamento;
- [x] `llmb_live_runs.detachedRuns.status=running` durante a seleção;
- [x] o mesmo PID/run permaneceu vivo após publicação de `4285a01a0`, self-reload completo do MCP e novo smoke OAuth/registry/SSE, provando que a seleção detached sobrevive ao ciclo de vida do origin que a iniciou;
- [x] novos runs detached passam a expor `logPath` progressivo; o run atual, iniciado antes de `4285a01a0`, permanece sem esse arquivo por compatibilidade temporal esperada;
- [x] o primeiro run detached fechou em `blocked/byok-provider-credits` após ~15m27s, **sem winner** e sem autorização para promoção;
- [x] a análise causal do SSE mostrou que `model_gateway_workflow_plan` produziu `73.653 bytes` (`71,9 KB`), foi desviado pelo SDK para `/tmp/...copilot-tool-output...`, e `read_file_content` não pôde abrir esse path (`ERR_READ_PATH_INVALID`);
- [x] privados dos argumentos exatos do workflow, os turns seguintes materializaram calls inválidos de `model_gateway_probe_execute` (snake_case indevido, `providerId/modelId=null` ou vazios), confirmando que o protocolo se perdeu **antes** do blocker 402 final;
- [ ] registrar a cadeia final de agent probes, falhas classificadas e winner quality-first em um run pós-correção compact-first;
- [ ] se `selectionDecision=switch_recommended`, executar promoção same-session em etapa separada e confirmar `committed`;
- [ ] se `selectionDecision=use_current`, registrar que o bootstrap/current route também venceu a prova quality-first;

### 104.2 `workflow_plan` compact-first — decisão executável sem fallback para `/tmp`

O run anterior demonstrou que um cérebro de seleção não pode devolver dezenas de kilobytes antes de a LLM-B executar a próxima ação. A evidência profunda continuava correta, mas seu volume quebrava a comunicação com o operador LLM.

A solução publicada em `2faee0e7475b2ea5860f516e0480735bfa7804e1` (`perf(llm-b): compact adaptive workflow decisions`) torna o workflow **compact-first por padrão**:

- [x] `selectionDecision`, `operatorExplanation`, shortlist/ranking curto, guardrails e passos executáveis continuam no retorno normal;
- [x] `evidence` padrão passa a ser uma projeção compacta com status/contagens/top candidates;
- [x] snapshots, route plans e avaliações completas só são serializados quando `includeDetailedEvidence=true`;
- [x] a skill `llm-b-route-operator` ensina que detailed evidence é opt-in diagnóstico, não caminho normal;
- [x] as regras de ranking/proof/probe não foram enfraquecidas; a transformação reduz apenas material serializado de volta para a LLM;
- [x] typecheck estrito pós-transformação: `d0142a04-5237-4d92-b52b-61cf3a3548f1`, exit `0`, ~`12,5 s`;
- [x] nenhuma suíte ampla foi executada.

Prova live pós-compact-first:

- [x] novo run detached `mcp-208d3eaa-b382-4ef9-8f99-2796ffe6628b` iniciado após `2faee0e74`;
- [x] logging progressivo disponível em `artifacts/terminal-live/mcp-208d3eaa-b382-4ef9-8f99-2796ffe6628b/detached.runner.log`;
- [x] o primeiro `workflow_plan` chegou diretamente à LLM-B, sem `Output too large`, sem `/tmp` e sem `read_file_content` auxiliar;
- [x] o workflow retornou `status=planned_probe_required`, discovery #1 `gemini/gemini-3.6-flash` e `operatorExplanation` coerente;
- [x] `model_gateway_probe_execute` plan foi chamado com `probeKind=agent`, `providerId=gemini`, `modelId=gemini-3.6-flash`, `maxEstimatedCostUsd=10`, `timeoutMs=60000`, `unknownCostPolicy=allow`, `confirm=false` e a idempotency key fornecida pelo workflow;
- [x] o apply seguinte usou os mesmos argumentos e `confirm=true`;
- [x] a LLM-B voltou imediatamente a `model_gateway_workflow_plan` após o resultado, provando o rerank loop que faltava no run anterior;
- [x] o apply revelou outro problema independente: `replayed=true`, reaproveitando operação/falha anterior porque o cenário usava um `idempotencyKeyPrefix` fixo entre runs;
- [x] este replay **não conta** como nova prova agent desta execução;
- [x] `5a818eef104a7a0d01e11d35bfda9707b86179cd` (`fix(llm-b): refresh adaptive probe identity`) passa a gerar prefixo único por processo/run, estável apenas dentro daquela seleção;
- [x] o mesmo commit unifica `optionalWorkflowString` com o normalizador que trata `none/null/__UNSET__` como ausência e deixa de serializar `profileId:null` nos passos de probe;
- [x] typecheck estrito da correção de identidade: `8e25ed4e-c9cc-469c-be1d-10ef6848b26b`, exit `0`, ~`8,1 s`;
- [ ] executar run pós-`5a818eef1` e registrar probes **frescos**, winner ou exhaustion real.

### 104.3 READY é evidência derivada, não autoridade textual

O segundo run compact-first expôs um falso fechamento narrativo: depois de um `probe_execute` apenas planejado, a bootstrap LLM emitiu `ADAPTIVE-SELECTION-READY provider=anthropic model=claude-haiku-4-5-20251001 decision=use_current`, embora a rota viva fosse `kilo-code/openrouter/free` e nenhum workflow real tivesse retornado esse estado terminal.

A correção publicada em `612b6052bfcafe7a450eac466cebeaef8a75c370` (`test(llm-b): require workflow authority for adaptive ready`) transforma o harness em verificador cruzado:

- [x] `READY` só pode vir de `assistant.message`; o marker presente no próprio prompt não satisfaz o critério;
- [x] deve existir um `postToolUse` anterior de `model_gateway_workflow_plan` com `selectionDecision.status` terminal (`use_current` ou `switch_recommended`);
- [x] `runtimeProofRequired` deve ser `true`;
- [x] provider/model/status do texto público devem coincidir exatamente com a decisão estruturada da tool;
- [x] `use_current` exige ainda `currentModel === selectedRoute.providerModel`;
- [x] o novo critério `adaptive-selection-ready-authorized-by-workflow` torna impossível um marker narrativo sozinho aprovar a seleção;
- [x] o prompt do cenário explicita que `planned` não é proof, `replayed=true` não é nova prova e apenas workflow terminal real autoriza READY;
- [x] nenhuma suíte ampla foi usada; o harness teve parse/outline limpo.

### 104.4 Binding de probe: a rota candidata não pode herdar a rota de bootstrap

A terceira execução expôs uma contaminação de binding anterior à versão corrigida: um agent probe pedido para `gemini/gemini-3.6-flash` registrou falha de autenticação contra `https://api.kilo.ai/api/gateway`. A candidata Gemini estava herdando campos materializados da rota viva Kilo.

Causa:

- o antigo `model_gateway_probe_execute` copiava `process.env`, mudava `COPILOT_BYOK_PROVIDER_PRESET`/modelo, mas deixava vivos `COPILOT_MODEL_GATEWAY_PROVIDER_ID`, `COPILOT_BYOK_BASE_URL`, wire/auth e demais campos da sessão atual;
- `importConfiguredByokFromEnv` dá precedência a `COPILOT_MODEL_GATEWAY_PROVIDER_ID`, portanto um probe nominalmente Gemini podia continuar bound a `kilo-code`.

Primeira correção:

- `f6ce0f8ad73c7ff683b2f6b6f26e297ae0c11acd` — `fix(model-gateway): isolate llm-b probe binding`;
- `probe_execute` passou a reutilizar `buildModelGatewayRuntimeSelectorProbeEnv`, a mesma função canônica do admission selector que reseta os campos da rota ativa e resolve provider/model/auth do alvo;
- typecheck `0e379ecb-bb9d-4d68-bb8a-56d66428a08c`, exit `0`, ~`5,7 s`.

A auditoria seguinte mostrou que uma rota “magra” `{providerId, providerModel}` ainda podia exigir inferência de endpoint. Para Gemini, por exemplo, o inventory contém endpoint nativo e OpenAI-compatible; não é desejável reconstruir essa escolha no executor.

Solução forte publicada em `17d0aa5919b838e61ceef8731bd0028a51a325cc` (`fix(model-gateway): bind probes to planned routes`):

- [x] `planProbes` associa cada probe escolhido à **rota sanitizada exata** derivada da projeção canônica via `buildLiveRouteSwitchTarget`;
- [x] `data.execution.routes` transporta provider/model/profile/routeProfile/baseUrl/openAICompatibleBaseUrl/wireApi/binding metadata, sem segredos;
- [x] `probe_execute` não autoriza mais apenas por `kind`; exige coincidência de `kind + providerId + providerModel` com uma rota retornada pelo plan;
- [x] o plan expõe `authorizedRoute` para operador/LLM-B;
- [x] o apply usa `buildModelGatewayRuntimeSelectorProbeEnv(authorizedRoute, process.env)`, preservando exatamente a rota autorizada e isolando a rota de bootstrap;
- [x] o primeiro typecheck encontrou apenas um typo local (`isRecord` vs `asRecord`), corrigido sem escalar validação;
- [x] typecheck final `b9558d6c-89fe-43a7-a42b-967b4e5af4fb`, exit `0`, ~`5,5 s`;
- [x] nenhuma suíte ampla foi executada.

A terceira execução detached `mcp-82ed345b-b1d9-49e2-ac31-e2069925e33c` nasceu **antes** dessas correções de binding. Ela serve para validar idempotência única e a barreira de READY, mas suas falhas de provider não certificam `17d0aa591`.

- [ ] aguardar o terceiro run encerrar sem duplicar provider calls;
- [ ] executar um quarto run a partir de `17d0aa591` e exigir `replayed=false`, provider real coincidente e endpoint da rota candidata;
- [ ] registrar winner ou exhaustion apenas a partir dessa prova fresca.

### 104.5 Bootstrap do cockpit exige prova agente, não apenas chat

A terceira execução `mcp-82ed345b-b1d9-49e2-ac31-e2069925e33c` encerrou em `blocked/live-timeout` após ~`960 s`. A admissão anterior havia declarado `cerebras/gemma-4-31b` respondente por chat, mas a LLM-B nunca chegou a abrir `model-gateway-adaptive-probe`: o terminal permaneceu em `modelo solicitado` até o timeout.

Conclusão causal:

- [x] chat success prova apenas que a rota respondeu a uma chamada simples;
- [x] para hospedar o cockpit Model Gateway, o bootstrap precisa provar **tool calling + leitura + `ask_user` + resposta + finalização**;
- [x] portanto `chat-admission` não pode ser confundido com `agent-admission`.

A correção publicada em `aa8ca639898a4542ec0f87c3e74e513569dac199` (`fix(llm-b): require agent-capable bootstrap admission`) adiciona essa fronteira:

- [x] `buildRealByokRuntime` tornou-se assíncrono apenas para permitir o preflight agente antes de abrir o PTY;
- [x] em cenários Model Gateway reais, a rota candidata passa por `runConfiguredByokAgentProbe` em sessão descartável;
- [x] o probe exige marker tool, `read_file_content`, `ask_user`, resposta sintética e output final;
- [x] sucesso/falha são persistidos na health store com identidade `routeProfile + providerId + providerModel` e flush explícito antes do rerank;
- [x] falha agent recente entra em `blockFailedProbeKinds`, mas a seleção agora usa `isGatewayModelProbeActivelyFailed`, evitando blacklist permanente por falhas históricas;
- [x] se nenhuma rota agent-capable for encontrada, o harness fecha cedo com `byok-agent-admission-unavailable` em vez de abrir um cockpit condenado a timeout;
- [x] o relatório ganhou `byok-real-agent-admission-proof`, que só passa se a **mesma rota final** tiver marker tool, leitura e ciclo `ask_user` completos;
- [x] parse/outline limpo e nenhum import órfão;
- [x] typecheck estrito `ddc9c070-7609-4112-91d2-20cde047efed`, exit `0`, ~`12,7 s`;
- [x] nenhuma suíte ampla executada.

Prova live iniciada sobre `aa8ca6398`:

- [x] run detached `mcp-89b8c8d2-b3aa-4e25-8998-20dda7c1af62`, PID `46644`;
- [x] `cerebras/gemma-4-31b`: chat success anterior, mas **agent admission falhou por timeout de 45 s**;
- [x] `mistral/devstral-2512`: **agent admission falhou com HTTP 422**;
- [x] `mistral/mistral-medium-2505`: **agent admission falhou com HTTP 422**;
- [x] `mistral/mistral-medium-2508`: **agent admission falhou com HTTP 422**;
- [x] rotas Chutes foram descartadas por `402 Payment Required` antes de agent admission;
- [x] várias rotas Groq foram descartadas por `413 Request too large` / TPM antes de agent admission;
- [x] essas exclusões são persistidas e reranqueadas; o run não ficou preso no primeiro chat-success;
- [x] a quinta admissão funcional encontrou `zai/glm-4.7-flash`: `agentProbeStatus=ok`, marker tool + leitura + `ask_user` completos;
- [x] o terminal abriu realmente bound a `zai/glm-4.7-flash`, provando que o gate eliminou o falso-green de chat admission;
- [x] o run encerrou como `blocked/byok-route-no-response` após ~`583,5 s`, sem winner: durante o primeiro turno do cenário Z.ai retornou overload `code=1305` antes do primeiro `workflow_plan`;
- [x] o relatório persistido marcou `byok-real-agent-admission-proof=true` e `byok-real-model-gateway-scenario-opened=false`; portanto bootstrap comprovado **não foi confundido** com seleção adaptativa concluída.

### 104.6 Admissão agent-only: remover duplicação chat → agent

A prova acima também expôs custo redundante: para cada bootstrap, o runtime selector executava chat e, se houvesse sucesso, o harness executava um agent probe mais forte. Como o agent probe já materializa um turno real e `lastAgentProbeSuccessAt` participa de `latestProviderSuccessAt`, não é necessário duplicar a chamada.

A otimização publicada em `6861ec774031011e6fb5dab0b84ebbbc8037b034` (`perf(llm-b): use agent-only cockpit admission`) muda somente os cenários Model Gateway:

- [x] runtime selector vira **dry selector** para escolher a próxima candidata elegível;
- [x] `runConfiguredByokAgentProbe` passa a ser a única chamada real de admissão daquela candidata;
- [x] falha agent é persistida e força novo dry rerank;
- [x] cenários BYOK comuns/control-only preservam o fluxo anterior;
- [x] o critério `byok-real-admission-selector-proof` passa a significar candidato de bootstrap preparado pelo selector, enquanto `byok-real-agent-admission-proof` permanece a autoridade funcional;
- [x] parse/outline limpo; nenhuma suíte ampla necessária porque a onda altera apenas o harness operacional `.mjs`;
- [x] `71106b207af3cfaf5e639dc49b0b406f9d5a729c` (`chore(llm-b): log cockpit admission progress`) acrescenta logging sanitizado progressivo `start/ok/failed`, rota, status e duração no `detached.runner.log`, sem payloads/secrets.

### 104.7 Recovery de tools precisa preservar o cenário ativo

O primeiro turno já hospedado em `zai/glm-4.7-flash` sofreu overload transitório antes de `model_gateway_workflow_plan`. O harness acionou a continuação de tools incompletas, mas `buildIncompleteExpectedToolRecoveryPrompt` ainda carregava parâmetros fixos do antigo cenário readonly (`maxSnapshotAgeHours=720`, `maxCandidates=8`, prefixo `live-readonly-workflow-20260814`).

Isso quebrava a continuidade epistemológica da seleção adaptativa: um recovery não pode trocar silenciosamente proof window, candidate budget nem identidade de idempotência do run.

Correção publicada em `aec0c3867f4a2594c449230a7762971de4e9ea8f` (`fix(llm-b): preserve adaptive recovery context`):

- [x] o recovery procura primeiro instruções da tool faltante em `scenario.beforeDeltaInstructions`;
- [x] portanto `model-gateway-adaptive-probe` preserva o prefixo único do processo, `maxSnapshotAgeHours=24`, `maxCandidates=12`, `quality_first`, rerank após todo probe e autoridade READY do workflow;
- [x] hardcodes antigos permanecem apenas como fallback para cenários que não fornecem instrução específica;
- [x] não foi criado um segundo contrato de workflow nem duplicada a lógica de seleção;
- [x] parse/outline limpo; nenhuma suíte ampla executada.

### 104.8 Prova agent-only + atribuição canônica de health

A execução `mcp-bf9b3cf0-d016-4a2a-8102-40a4b02ae1b8` nasceu sobre `aec0c3867` e provou a geração completa de bootstrap/recovery:

- [x] `agent admission 1/8 start route=kilo-code/openrouter/free` apareceu imediatamente no log progressivo;
- [x] `kilo-code/openrouter/free` passou o agent admission na **primeira tentativa**, em ~`31,8 s`;
- [x] não houve chat probe anterior: `dry selector → agent admission` ficou provado live;
- [x] o cenário `model-gateway-adaptive-probe` abriu de fato;
- [x] primeiro `workflow_plan` ~`20,1 s` → probe plan ~`2,7 s` → apply ~`3,5 s`;
- [x] depois do probe, houve rerank obrigatório: segundo workflow ~`17,5 s`;
- [x] não houve `/tmp`, replay de prefixo antigo nem recovery readonly.

O run também revelou uma falha independente na atribuição de health:

- [x] `buildModelGatewayRuntimeSelectorProbeEnv` já preservava `COPILOT_MODEL_GATEWAY_PROVIDER_ID` e endpoint/auth da rota autorizada;
- [x] porém `recordProbeHealth()` derivava `providerId` de `probe.preset`/`providerType`;
- [x] para rotas gateway, o preset operacional é deliberadamente `custom`, então uma falha de `gemini/gemini-3.6-flash` foi persistida como `custom|gemini-3.6-flash`;
- [x] a própria tool detectou `provider_result_mismatch`, portanto a falha **não virou sucesso**, mas o reranker não recebia a falha sob a identidade Gemini correta;
- [x] a LLM posteriormente escreveu `ADAPTIVE-SELECTION-READY provider=gemini model=gemini-3.6-flash decision=probe_required`; o harness não aceitou esse texto como prova terminal e entrou em diagnóstico;
- [x] o run encerrou `blocked/byok-route-no-response`, sem winner.

Correção publicada em `22362cb356f34141a7b65ab14da499cce1c6cfe5` (`fix(model-gateway): attribute probes to authorized routes`):

- [x] `executeModelGatewayProbe` aceita identidade canônica opcional;
- [x] `model_gateway_probe_execute` passa `routeProfile + providerId + providerModel` da `authorizedRoute`;
- [x] health, resultado SQLite, `probeProfile` e evento usam essa identidade canônica;
- [x] chamadas legadas sem identity preservam fallback anterior;
- [x] primeiro typecheck focado encontrou apenas fronteiras JSDoc/tipo (`251024e5...`), corrigidas localmente;
- [x] rerun estrito `6a87e26c-0bf0-4614-8d84-22befd2d5bb1`, exit `0`, ~`33,7 s`;
- [x] nenhuma suíte ampla executada.

### 104.9 Roadmap residual atualizado

- [x] concluir o run `mcp-89b8c8d2...` e registrar seu estado terminal (`blocked/byok-route-no-response`, sem winner);
- [x] executar prova sobre `aec0c3867`; ela validou agent-only/recovery, mas revelou atribuição `custom` e não produziu winner;
- [ ] executar uma única nova seleção adaptativa sobre `22362cb35`, exigindo health canônica por authorizedRoute;
- [x] exigir bootstrap agent-capable antes de abrir o cockpit;
- [ ] no ciclo quality-first interno, exigir probes frescos, binding autorizado, health canônica e READY validado pelo workflow;
- [ ] registrar o winner plenamente funcional ou exhaustion real;
- [ ] provar promoção same-session do winner quando aplicável;
- [ ] medir `fresh warm` final da readiness com static tiers atuais;
- [ ] reduzir o custo de `model_gateway_workflow_plan` (~15–17 s) somente após fechar a correção funcional, privilegiando shared routing snapshot/context em vez de paralelismo especulativo;
- [ ] executar benchmark representativo cold/L1/L2 a partir de host/schema capaz de invocar a missão publicada;
- [ ] executar benchmark QUIC/H2/auto com amostras estatisticamente suficientes;
- [ ] golden prompts em conversa limpa;
- [ ] decomposição estrutural dos hotspots permanece deliberadamente para conversa separada.

### 104.10 `require_runtime_proof` não pode impedir a geração da própria prova

A retomada de 2026-08-17 revelou um deadlock de bootstrap introduzido pela combinação correta, porém incompleta, de duas garantias: `require_runtime_proof` como policy estrita e agent admission obrigatório antes de abrir o cockpit. O primeiro run pós-restart, `mcp-9d9d4102-e3cf-4e0f-a9c0-825a27de7c9f`, fechou em ~4,3 s como `byok-agent-admission-unavailable/no_agent_capable_bootstrap_route` **sem sequer existir uma candidata selecionada**.

Causa causal:

- [x] o selector recebia `require_runtime_proof` também na fase de descoberta pré-prova;
- [x] sem proof pré-existente, nenhuma rota podia ser selecionada;
- [x] sem rota selecionada, o agent admission não podia rodar;
- [x] portanto o sistema exigia como pré-condição a evidência que somente o próprio gate seguinte poderia produzir.

Correção local:

- [x] criado `control-plane/runtime-admission-policy.js` com `resolveModelGatewayAdmissionCandidateSelectionPolicy`;
- [x] a policy solicitada continua `require_runtime_proof` para admissão/promoção;
- [x] apenas a **descoberta da candidata descartável** usa `prefer_runtime_proved` quando agent admission é obrigatório;
- [x] o relatório preserva explicitamente `requestedSelectionPolicy`, `candidateSelectionPolicy` e `selectionPolicyRelaxedForAdmission`;
- [x] reranks após falha agent usam a mesma policy de descoberta, sem degradar a policy final;
- [x] teste focado `test_runtime_admission_policy.spec.js` verde.

Prova real subsequente, run `mcp-7b16c6a1-7dfc-47f5-bc50-c7e84170f6a9`:

- [x] solicitado `require_runtime_proof`, mas a fronteira registrada ficou `candidateSelectionPolicy=prefer_runtime_proved` e `selectionPolicyRelaxedForAdmission=true`;
- [x] o selector avançou de fato por candidatas distintas em vez de morrer sem rota ou repetir replay: `zai/glm-4.5-air` → `zai/glm-4.6v` → `gemini/gemini-3.5-flash-lite` → `gemini/gemini-3.5-live-translate-preview` → `mistral/mistral-nemo-2407`;
- [x] todas as tentativas preservaram `routeProfile=repo_agent`;
- [x] nenhuma passou o agent admission nesta fotografia de health/provider, então o run fechou cedo e corretamente como `byok-agent-admission-unavailable`, sem abrir um cockpit não funcional;
- [x] essa execução prova a remoção do deadlock e o avanço real entre candidatas, mas **não** constitui winner da seleção quality-first interna.

### 104.11 Falha 503 do GitHub não é credencial inválida e não deve consumir 15 minutos do harness

A tentativa seguinte deslocou a prova para o substrate nativo do Copilot, run detached `mcp-96eb9f95-78f3-47e2-9740-afe51c6543d9`. O `session.create` recebeu do upstream:

`Authentication failed: Failed to validate SDK token (503): GitHub returned: No server is currently available to service your request.`

O prefixo textual `Authentication failed` fez a taxonomia anterior classificar o incidente como `auth` e a UX recomendar reautenticação, apesar de a causa concreta ser indisponibilidade 503 do GitHub. Além disso, o terminal corretamente permanecia vivo para diagnóstico humano, mas o harness automatizado continuaria aguardando todo o budget de `900000 ms` mesmo sabendo que o cenário jamais havia sido despachado.

Correções implementadas enquanto o run antigo ainda estava vivo:

- [x] `core/sdk-error-taxonomy.js` agora classifica 5xx e fingerprints explícitos de indisponibilidade upstream como `network` **antes** de fingerprints genéricos de autenticação;
- [x] 401/403 continuam explicitamente `auth`;
- [x] teste com a mensagem real do incidente exige `network`, retry/reconnect permitido e mensagem `[sdk rede]`, sem recomendar `Reautentique`;
- [x] criado `model-gateway-terminal-live-blocker.mjs`, classificador puro de falhas de startup já declaradas pelo terminal;
- [x] o classificador distingue `sdk-upstream-unavailable`, `sdk-auth-failed` e `sdk-network-unavailable`, e não reage a uma linha auth isolada antes de o boot estar efetivamente bloqueado;
- [x] o harness passou a detectar esse blocker **antes do envio do cenário**, coletar apenas diagnósticos locais bounded (`/status`, `/activity`, `/errors`, `/health`, export), pedir `/quit` e manter kill garantido com janela curta;
- [x] testes focados de recovery policy e startup blocker verdes;
- [x] typecheck estrito verde (`aee97ab8-9cd5-45cb-beeb-f9ee2c1dd247`);
- [x] lint final verde (`f36bec51-9a82-4873-98d2-a8c75b14d378`).

O run `mcp-96eb9f95...` foi iniciado **antes** dessas correções e terminou após ~902 s como `live-timeout`, sem o cenário ter sido despachado. Uma execução posterior, `mcp-16849ee8-4206-4949-9784-2dfd9bf3cb23`, já provou em runtime a correção da taxonomia: o mesmo 503 passou a aparecer como `kind=network, retryable=true, reconnect=true`, não mais como `auth`.

Essa segunda execução revelou, porém, uma lacuna adicional de reconhecimento do estado terminal. Após esgotar os retries, a superfície real emitiu exatamente as formas `ensureDialogLoop falhou após 3 tentativas`, `Boot        falha ao iniciar conversa` e `Dialog loop bootstrap error`. A primeira versão do classificador ainda não reconhecia essas três formas, de modo que o run já iniciado continuou sob a lógica anterior de timeout. O classificador foi então ampliado para essas expressões reais, e `test_llmb_live_startup_blocker.spec.js` passou a reproduzir literalmente esse envelope 503; validação focada verde no job `307e9c3c-c231-4992-a7ea-52bb4587fe43`.

A aceitação final foi obtida no run novo `mcp-d5a1fdc4-b73d-4cf0-bb93-54851b91ba2f`, já nascido com a versão ampliada do classificador. O GitHub continuava devolvendo o mesmo 503; o runtime manteve a classificação correta `kind=network, retryable=true, reconnect=true`, esgotou as três tentativas locais e, ao aparecer `ensureDialogLoop falhou após 3 tentativas`, o harness reconheceu imediatamente `sdk-upstream-unavailable`, iniciou os diagnósticos bounded e **não despachou o prompt do cenário**. O ledger persistido fechou em `56.503 ms`, contra `901.040 ms` do run anterior `mcp-16849...`, redução de ~93,7% no tempo desperdiçado pelo mesmo blocker externo. O detached process também encerrou normalmente (`process-not-alive`) após a criação do summary. Portanto a saída antecipada por indisponibilidade upstream está agora provada em runtime; a execução do ciclo adaptativo interno continua naturalmente dependente de recuperação do substrate Copilot SDK.

### 104.12 Cancelamento governado de runs LLM-B detached

A espera longa também expôs um gap de autonomia operacional: `llmb_live_test_run` podia criar um processo detached observável por `llmb_live_runs`, mas não existia uma superfície governada para encerrá-lo. Foi acrescentada `llmb_live_test_cancel` com contrato deliberadamente estreito:

- [x] aceita somente `runId` estrito no formato `mcp-<UUID>`; não aceita PID, sinal, path, shell, comando ou env arbitrário;
- [x] resolve o PID exclusivamente pelo manifesto persistido do próprio harness;
- [x] antes de sinalizar, em POSIX lê `/proc/<pid>/cmdline` e exige simultaneamente o runner allowlisted e o `--out-dir=<manifest.outDir>` exato, fechando o risco de PID reciclado apontar para processo alheio;
- [x] quando a identidade é válida, encerra o process group detached com `SIGTERM`, contendo também PTY/descendentes do harness;
- [x] registra eventos de auditoria específicos e usa annotation `destructive`, sem `openWorld`;
- [x] MCP capabilities version avançou para 43; README e registry foram atualizados;
- [x] testes `test_mcp_autonomy_mutations.spec.js` e `test_mcp_registry.spec.js` verdes (`79dbc807-a47b-4b41-a5a1-b458113b3172` e `7f30a042-0c5b-4afd-8049-9b2a0b1382ef`);
- [x] hot reload `mcp-reload-851804f5-1f6d-4f97-a2f3-0b68d6ce586e` concluído; smoke autenticado confirmou **116/116 tools**, sem missing/unexpected, e `mcp_tools_status` classifica `llmb_live_test_cancel` como destructive/admin.

Hardening adicional feito após a primeira publicação:

- [x] o manifesto detached passou a ser aceito somente quando `runId`, nome do arquivo, PID positivo, timestamp finito, `outDir=artifacts/terminal-live/<runId>` e `logPath=<outDir>/detached.runner.log` concordam exatamente; isso impede que um manifesto adulterado redirecione inspeção/cancelamento para paths alheios;
- [x] `llmb_live_runs` deixou de tratar `kill(pid, 0)` como prova suficiente: em POSIX expõe separadamente `pidPresent`, `pidAlive` e `processIdentity`, e só chama de vivo o PID cujo `/proc/<pid>/cmdline` ainda corresponde ao runner e ao `out-dir` esperados;
- [x] um summary já persistido não mascara mais processo órfão: se a identidade exata ainda estiver viva, o status pode ser `artifacts_ready_process_alive` e `llmb_live_test_cancel` pode reaproveitar o mesmo gate de identidade para fazer cleanup explícito;
- [x] essa instrumentação encontrou uma fuga real histórica no run BYOK `mcp-7b16c6a1-7dfc-47f5-bc50-c7e84170f6a9`: summary pronto, porém o próprio runner ainda vivo e verificável muito depois do fechamento lógico;
- [x] o caminho de early-block BYOK passou, depois de todas as escritas/ledger/fixture close, a agendar `process.exit(1)` com grace de 2 s em timer `unref()`: o shutdown natural continua preferido, mas handles de health/provider não podem manter indefinidamente um CLI já finalizado;
- [x] teste de autonomia final após o hardening verde (`805a8411-d6c1-4b3e-b646-8ba4adb4fdda`), registry final verde (`0d1d22f2-b8bf-4690-9522-11a6a92531aa`), recovery-policy final verde (`f0274afd-3fe4-4a94-b1eb-ab9d1c8d2aca`), typecheck final verde (`18499ec2-35a1-4340-b576-568d5a218eeb`) e lint final verde (`45e097eb-9233-4b58-9f0b-64b824757efe`);
- [x] hot reload final `mcp-reload-14d13bfb-b405-4166-92f6-4ab66928b37e` concluído; readiness reconciliado e smoke OAuth autenticado confirmou novamente **116/116 tools**, sem missing/unexpected; `mcp_tools_status` mostra `llmb_live_test_cancel` entre as cinco tools destructive e sem `openWorld`.

Limitação externa observada nesta própria conversa: o servidor publica e audita a 116ª tool, mas o snapshot de schemas executáveis materializado pelo host ChatGPT nesta sessão ainda não expõe `llmb_live_test_cancel` como callable direto, mesmo quando a descoberta textual do MCP confirma sua existência. Portanto o ganho está ativo e provado no servidor, porém não foi correto contornar a limitação do host com shell, PID ou chamada arbitrária. A próxima sessão que materializar o schema atualizado poderá usá-la diretamente.

### 104.13 Fronteira de atribuição: falha do controller não pode contaminar health do provider

A investigação pós-503 revelou um problema conceitual mais profundo na telemetria de runtime: os probes BYOK são executados **dentro** de uma sessão descartável do Copilot SDK. Portanto existem duas fronteiras distintas que não podem ser confundidas:

1. **controller/session substrate** — criação/conexão da sessão Copilot SDK e infraestrutura comum a todas as rotas;
2. **provider boundary** — somente o instante em que `sendSessionAndWait` é efetivamente acionado com a rota BYOK já materializada.

A implementação anterior classificava genericamente exceções de `withEphemeralSession` como falha do provider e inferia `providerAttempted` pelo status do probe. Na presença de um 503 do GitHub antes do primeiro `sendAndWait`, isso podia produzir health negativo contra ZAI, Gemini, Mistral etc. embora nenhum desses providers tivesse sido chamado. Em seguida o selector podia trocar de rota e repetir o mesmo defeito compartilhado, contaminando sucessivamente o ranking.

A invariância corrigida é agora explícita: **provider health só pode ser alterado depois de prova de que a execução cruzou a fronteira da chamada ao provider**.

Mudanças implementadas:

- [x] criado `model-gateway/probes/attribution.js` com `didConfiguredByokProbeAttemptProvider` e `classifyConfiguredByokProbeFailureScope`;
- [x] chat e agent probes começam com `providerAttempted=false` e só o elevam imediatamente antes de `sendSessionAndWait`;
- [x] falha durante bootstrap da sessão retorna `status=failed`, `providerAttempted=false`, `providerFailure=null` e `failureScope=controller_substrate`;
- [x] `session.error` e catches só passam pela taxonomia de provider depois da fronteira efetiva;
- [x] `probe-execution` persiste `providerAttempted` e `failureScope`, inclusive no payload SQLite e na projeção de replay idempotente;
- [x] os registros neutros de probe continuam observáveis no health store, mas `providerAttempted=false` já é respeitado por `isGatewayModelProbeFailed`/`isGatewayModelProbeVerified`, de modo que não bloqueiam nem promovem rota;
- [x] o runtime selector não grava failure/success de provider quando a fronteira não foi cruzada e um throw externo ao contrato normal é classificado conservadoramente como `controller_substrate`;
- [x] a decisão de retry para `controller_substrate` passou a ser `retryRoute=false` e `fallbackRoute=false`; o loop de fallback também foi corrigido para finalmente respeitar `fallbackRoute=false`, que antes era calculado mas não interrompia a progressão entre providers;
- [x] o agent admission do harness interrompe imediatamente a rodada quando o controller falha antes do provider, não grava agent/call failure contra a candidata e passa a emitir `controller_substrate_unavailable` em vez de fingir `no_agent_capable_bootstrap_route`;
- [x] o blocker externo distingue `byok-agent-admission-controller-substrate-unavailable` do caso genuíno de ausência de rota agent-capable;
- [x] `model_gateway_probe_execute` e seus replays passam a expor `failureScope`, warning `controller_substrate_failed_before_provider_call`, erro `MODEL_GATEWAY_PROBE_CONTROLLER_SUBSTRATE_UNAVAILABLE` e next action `retry_controller_substrate_before_changing_provider` para que a LLM-B não troque de provider por uma falha compartilhada do controller;
- [x] teste focado `test_probe_failure_attribution.spec.js` cobre chat, agent, provider-call real, persistência/replay, ausência de mutação de health e interrupção da cadeia de fallback; job final `9e38a58f-570b-4606-acff-b9a94d317f25` verde;
- [x] suíte de contratos Model Gateway permaneceu verde, **229/229**, após adaptar o mock antigo de rate-limit para representar a fronteira real (`providerAttempted=true`), job `4a2aa9bf-66cc-47e9-ae28-37313bff5a92`;
- [x] workflow plan verde no job `84585890-60fa-46de-8700-e28b025b66f5`;
- [x] typecheck estrito final verde no job `39f06a9b-bb9a-4eda-b796-aa09584c2074` e lint final verde no job `e0a51ef2-a95e-4754-9ce5-6efbc0922ae2`.

Consequência epistemológica para as evidências anteriores: a progressão de candidatas observada em `mcp-7b16c6a1-7dfc-47f5-bc50-c7e84170f6a9` continua provando a remoção do deadlock `require_runtime_proof`, mas **não deve mais ser interpretada automaticamente como cinco falhas independentes dos respectivos providers**. Parte dessa progressão pode ter refletido indisponibilidade do substrate Copilot SDK anterior à fronteira BYOK. Não há evidência suficiente no artefato para purgar seletivamente health histórico; a política correta é não inventar causalidade retroativa e impedir nova contaminação.

Aceitação live realizada no run `mcp-32865f9c-da3d-416c-bd73-cd87bcea101c`. Nesta fotografia o Copilot SDK **já havia se recuperado o suficiente para cruzar a fronteira BYOK**, portanto materializou-se o segundo ramo esperado da aceitação, não o blocker de substrate:

- [x] cinco candidatas distintas foram efetivamente chamadas em `repo_agent`: `zai/glm-4.5-air`, `zai/glm-4.6v`, `gemini/gemini-3.5-flash-lite`, `gemini/gemini-3.5-live-translate-preview` e `mistral/mistral-nemo-2407`;
- [x] em todas as cinco, `providerAttempted=true` e `failureScope=provider`, prova explícita de que `sendSessionAndWait` foi alcançado antes da falha;
- [x] ZAI retornou duas falhas classificadas como `timeout` após ~46,6 s e ~45,1 s; Gemini e Mistral falharam rapidamente depois da fronteira, ainda classificados como `unknown` nesta taxonomia;
- [x] nenhuma candidata satisfez o agent admission; portanto o encerramento `byok-agent-admission-unavailable/no_agent_capable_bootstrap_route` foi coerente e o terminal não abriu;
- [x] como este run cruzou a fronteira real em todas as tentativas, o rerank e as mutações de health desta execução são causalmente atribuíveis às rotas BYOK, ao contrário do caso hipotético de um 503 anterior à chamada;
- [x] o run não produz winner adaptativo: ele apenas prova que a nova fronteira de atribuição distingue corretamente um provider realmente tentado.

O ramo complementar `controller_substrate` permanece unitariamente coberto e será novamente observado em live somente quando houver uma nova indisponibilidade anterior a `sendSessionAndWait`; não há motivo para fabricar esse incidente ou degradar o ambiente para testá-lo.

### 104.14 Import side effect no barrel do Model Gateway e latência fantasma de ~45 s por rerank

O mesmo run `mcp-32865f9c...` expôs um segundo defeito, agora de composição de módulos. Os cinco probes consumiram, somados, ~94,4 s, mas o run bloqueado levou **319,1 s**. A diferença, ~224,7 s, corresponde praticamente a cinco blocos de ~45 s — exatamente o número de invocações dry-run do runtime selector (seleção inicial + reranks intermediários).

A causa arquitetural encontrada é que `model-gateway/index.js` passou a reexportar o novo Controller Selection Plane. Seu `native-controller-runtime.js`, por sua vez, importava eagermente `#copilot/sdk/session/client` e `#copilot/sdk/telemetry/health`. Assim, um CLI que pretendia apenas ler catálogo/health e selecionar metadata podia carregar o substrate Copilot SDK inteiro só por importar o barrel. O `model-gateway-runtime-selector.mjs` só chama `shutdownClient()` quando `--execute` está ativo; no caminho dry-run, o import eager podia manter recursos SDK vivos até o fechamento tardio observado. Como `runRuntimeSelectorLiveRoute` usava `spawnSync` sem `timeout`, o harness também não possuía um limite próprio contra um child que deixasse de terminar.

Correção em duas camadas:

- [x] `native-controller-runtime.js` deixou de importar SDK/telemetria no top level; os módulos são carregados dinamicamente **somente quando `resolveModelGatewayNativeControllerSelection()` é efetivamente invocado** e alguma dependência não foi injetada;
- [x] o Controller Selection Plane puro e o barrel principal voltam, assim, a ser importáveis sem boot implícito do client SDK;
- [x] `runRuntimeSelectorLiveRoute` passou a aplicar `spawnSync.timeout` e `SIGTERM`: dry-run fica bounded a no máximo 45 s, enquanto execução real recebe orçamento proporcional a `timeoutMs × maxAttempts`, limitado a 10 minutos;
- [x] erro de timeout/child agora entra explicitamente no `summaryError`, em vez de poder resultar em espera silenciosa;
- [x] foi acrescentado teste subprocessual que importa `src/copilot/model-gateway/index.js` em um Node limpo e exige saída natural em menos de 8 s, protegendo contra regressão de side effects no barrel;
- [x] `test_controller_selection.spec.js` passou com essa prova no job `7556e7e0-89e6-49aa-abbc-fa3c86362198`;
- [x] typecheck pós-lazy-import passou no job `addcbba8-24f3-423c-ad72-cf7239e074b8`.

A aceitação operacional foi feita **sem novo consumo de provider**, por subprocesso real do próprio CLI. `test_runtime_selector_cli_liveness.spec.js` executa `model-gateway-runtime-selector.mjs --json --profile=repo_agent --runtime-source=file --selection-policy=metadata_first` em um Node limpo, com hard timeout de 8 s, e exige JSON válido do `model-gateway-runtime-selector-plan`. O primeiro ciclo de construção do teste já mostrou que o processo encerrava em ~2,2 s, falhando apenas por uma expectativa semântica incorreta sobre o campo `mode`; corrigida a asserção para `policyResolution.mode`, o job `db317374-286c-4bd0-a9a9-4104f3b1088f` passou integralmente em 2,859 s. Isso reduz a antiga retenção de ~45 s por child para uma ordem de poucos segundos e prova diretamente o caminho dry-run que causava a latência fantasma, sem tocar provider ou quota. Lint final, já incluindo o novo teste subprocessual, verde no job `f3e757ff-9d4c-48e7-be5c-eb1ff3513f99`.

### 104.15 Autoavaliação operacional objetiva: MCP de ~8,3 s para <1 s no smoke canônico

A solicitação para avaliar não só o produto, mas também **a própria velocidade e qualidade do agente operando sobre o WORKSPACE**, foi tratada como problema mensurável. A linha de base mostrou uma assimetria clara: operações locais do repositório já eram rápidas, enquanto uma única ferramenta de readiness distorcia todo o ciclo de trabalho.

Baseline objetivo antes desta rodada:

- `mcp_autonomy_power_score`: **91/100, grade A**; 116 tools publicadas, metadata/auth/validation fortes e apenas `llmb_live_test_run` corretamente mantida como `openWorld`;
- Cloudflare/QUIC: RTT instantâneo **21 ms**, RTT suavizado **26 ms**, MTU 1344, quatro conexões HA, zero `packet-too-big` descartado;
- index local: ~2,17 mil arquivos, ~11,9 mil símbolos e ~3,52 mil chunks, build/refresh em ~1,2 s;
- leituras locais típicas: `repo_read_file` em poucos ms, `repo_search_text` em dezenas de ms e `repo_status` em ~50 ms;
- gargalo dominante: `mcp_connector_smoke_refresh` em **8.252–8.282 s**, suficiente para degradar o dashboard apesar de auth/result-size/IO estarem dentro dos budgets.

Essa evidência descartou a hipótese de que o túnel QUIC ou o filesystem fossem os culpados principais. O trabalho concentrou-se, portanto, na composição do smoke e em seu lifecycle.

Foram encontrados **dois problemas de correção e vários problemas de latência**:

1. o antigo `runSmoke` publicava `ok` baseado no smoke **não autenticado** e apenas aninhava o resultado OAuth autenticado; assim, uma challenge 401 saudável podia mascarar falha em DCR/tools/SSE;
2. o estado persistido era escrito pelo smoke parcial antes da conclusão autenticada, portanto readiness podia consumir uma evidência epistemicamente incompleta;
3. health, protected-resource e `tools/list` públicos eram serializados sem dependência entre si;
4. smoke público e OAuth/DCR autenticado também eram serializados;
5. `mcp_connector_smoke_refresh` abria um Node filho e esperava o processo inteiro morrer, embora o JSON útil já estivesse pronto; a diferença observada entre ~2,87 s de trabalho interno e ~8,31 s de handler expôs **~5,4 s de lifetime residual do child**;
6. dentro do OAuth smoke, public discovery, metadata/JWKS, três checks MCP autenticados, DCR/PAR, token introspection/refresh e CIMD ainda carregavam serializações evitáveis.

Transformação arquitetural aplicada:

- [x] criado `mcp/cloudflare/connector-smoke.js` como **SSOT do smoke canônico completo**;
- [x] o gate global passou a exigir simultaneamente `unauthenticated.ok && authenticatedOAuth.ok`;
- [x] somente o resultado combinado grava `connector-smoke.json`; a projeção persistida de tools vem do `authenticatedToolsList`, não do 401 público esperado;
- [x] `runCloudflareSmoke` ganhou `persistState=false` para poder ser reutilizado como subprova sem publicar estado parcial;
- [x] dependências do canonical smoke são injetáveis em teste; há cobertura explícita provando que OAuth autenticado falho derruba `ok`, que o estado final usa o registry autenticado e que os dois ramos começam concorrentemente;
- [x] o refresh MCP deixou de spawnar `cli.js smoke` e chama o canonical smoke **in-process**, removendo o lifetime residual do processo filho;
- [x] compactação/redação cobre também o `authenticatedToolsList` aninhado;
- [x] health, protected-resource e `tools/list` públicos rodam em `Promise.all`; metadata de authorization server permanece corretamente dependente do protected-resource;
- [x] smoke público e OAuth/DCR rodam em paralelo;
- [x] no OAuth smoke, public discovery concorrente e CORS/JWKS concorrentes preservam as dependências reais;
- [x] `mcp_runtime_health`, authenticated `tools/list` e SSE são independentes e passaram a rodar em paralelo;
- [x] CIMD inicia assim que a metadata do issuer existe e sobrepõe seu fluxo ao DCR, reduzindo sua contribuição crítica de ~354 ms para ~1 ms residual;
- [x] authorization-code e PAR do mesmo public client usam transações independentes e agora são aguardados em paralelo;
- [x] introspection e refresh, que consomem tokens independentes, são aguardados em paralelo;
- [x] os runtime checks usam o access token DCR original e começam antes da conclusão de introspection/refresh, sobrepondo transport verification ao token lifecycle;
- [x] `phaseTimings` foi incorporado ao OAuth smoke para que futuras otimizações sejam orientadas por dados, não por intuição.

Progressão medida no **mesmo instrumento `mcp_latency_dashboard`**:

| estágio | `mcp_connector_smoke_refresh` | OAuth autenticado | smoke combinado interno |
|---|---:|---:|---:|
| baseline pré-refactor | ~8.282 ms | ~2.854 ms no primeiro perfil paralelo observado | ~2.870 ms, ainda preso ao child |
| canonical in-process | **2.711 ms** | 2.679 ms | 2.688 ms |
| runtime/public concurrency | **1.673 ms** | 1.641 ms | 1.652 ms |
| CIMD + auth/lifecycle overlap | **1.084 ms** | 1.039 ms | 1.048 ms |
| runtime/token overlap final | **954 ms** | **920 ms** | **930 ms** |

O resultado final representa redução de aproximadamente **88,5%** na latência da tool dominante em relação aos 8.282 ms de referência e uma aceleração de ~**8,7×**. No snapshot final, o `mcp_latency_dashboard` passou de `degraded` para **`ok`**, sem warnings: slowest tool 954 ms < budget de 1.000 ms, handler médio 361 ms < 750 ms, authorization 2 ms < 250 ms, result-size ~0 ms e error rate zero.

O último `phaseTimings` autenticado foi: public discovery 136 ms; authorization metadata 119 ms; registration 73 ms; authorization flows 190 ms; token lifecycle 221 ms; runtime-check residual 180 ms; optional checks 1 ms. O número deve ser lido como **contribuição ao caminho crítico**, pois parte do trabalho agora é deliberadamente sobreposta. Isso é uma propriedade desejável da instrumentação: ela mede o que ainda alonga a wall-clock latency, e não soma artificialmente trabalho concorrente.

Conclusão operacional: a maior oportunidade de velocidade nesta rodada não estava em “usar um túnel mais rápido” nem em reduzir garantias de auth, mas em **remover serialização artificial, side effects e lifetimes inúteis sem diminuir cobertura**. A ferramenta ficou simultaneamente mais rápida e semanticamente mais rigorosa.

### 104.16 Benchmark do cache IO: correção de safety gate e decisão de manter L2 desligado

A missão fixa `benchmark-io-cache` inicialmente falhou antes de medir qualquer coisa. A causa não era desempenho: o runner fazia cleanup recursivo com `removePathLocked(..., { recursive: true, force: true })`, mas a infraestrutura de IO havia evoluído para exigir `recursiveConfirmation` exatamente igual ao target resolvido. O benchmark, portanto, estava incompatível com o próprio safety contract do filesystem.

Correção:

- [x] os dois cleanups do `scheduled-io-cache-benchmark-runner.js` passaram a fornecer `recursiveConfirmation: benchmarkDir`;
- [x] a missão seguinte (`mcp-io-cache-benchmark-9854e750-1e2a-4aaf-8c56-3c6edc0b9102`) concluiu em ~3,03 s, usando banco isolado e removendo o DB temporário ao final;
- [x] cold read: média **12,233 ms**, p95 **12,879 ms**;
- [x] L1: média **1,758 ms**, p95 **1,794 ms** — aproximadamente 7× mais rápido que cold neste perfil;
- [x] L2: média **14,267 ms**, p95 **16,479 ms**;
- [x] L2 teve **-27,95%** de “melhoria” p95 contra cold, isto é, foi materialmente pior no benchmark representativo;
- [x] decisão: **não habilitar L2 por padrão**. `autoEnable=false` permanece correto.

Esse resultado evita uma otimização meramente nominal. O sistema já possui um L1 extremamente efetivo no workload medido; promover L2 acrescentaria lookup/persistência sem benefício líquido. A política daqui em diante é reavaliar L2 somente se o workload, backend ou topologia de acesso mudarem e um novo benchmark reproduzível inverter essa relação.

### 104.17 Retenção operacional dos artefatos de validação sem tocar rollback ou credenciais

A própria rodada de profiling produziu e encontrou acúmulo legítimo de manifests/logs UUID antigos em `.ai/jobs`. A maintenance surface foi usada de forma estritamente allowlisted, preservando as fronteiras já endurecidas:

- [x] dry-run encontrou **326** artefatos UUID além da retenção de 240 mais novos;
- [x] primeiro lote removeu **300 arquivos / 1.094.742 bytes**;
- [x] segundo lote removeu os **26 restantes / 33.754 bytes**;
- [x] total removido nessa primeira consolidação: **326 arquivos / 1.128.496 bytes** (~1,08 MiB), com `remainingCandidateCount=0`;
- [x] as validações adicionais do reaper/startup produziram novo excesso de 36 artifacts; um cleanup final removeu **36 / 378.469 bytes**, novamente com `remainingCandidateCount=0`;
- [x] acumulado removido nesta rodada ampliada: **362 arquivos / 1.506.965 bytes** (~1,44 MiB);
- [x] nenhum arquivo OAuth, token/tunnel state, PID, quarantine, nome não UUID ou path fora do domínio explícito ficou elegível;
- [x] rollback não foi solicitado no cleanup e permaneceu separado: `enabled=false`, sidecars reconhecidos=0, bytes=0;
- [x] o unknown entry historicamente protegido no domínio rollback continua intocado por design.

A retenção, portanto, voltou ao regime previsto sem ampliar a superfície destrutiva nem reintroduzir captura automática de rollback.

### 104.18 Budget de `tools/list`: crescimento do registry expôs regressão de 207 bytes e levou a compactação sem perda funcional

O primeiro `mcp-fast` de release gate encontrou uma falha única e útil: `test_tool_payload_audit.spec.js` ainda fixava `toolCount=115`, enquanto o registry já publica **116** tools desde a introdução de `llmb_live_test_cancel`. Depois de remover esse número mágico e comparar contra `getCanonicalMcpTools().length`, o mesmo audit revelou a regressão real escondida pelo teste antigo:

- envelope `tools/list`: **131.279 bytes**;
- budget deliberado: **131.072 bytes (128 KiB)**;
- excesso: **207 bytes**;
- maior família: input schemas, **48.299 bytes**;
- `_meta`: **22.490 bytes**;
- descriptions: **12.663 bytes**;
- output schemas: **16.523 bytes**.

Não foi adotada a solução fácil de aumentar o budget. O envelope é enviado para todo cliente que lista tools; preservar disciplina abaixo de 128 KiB reduz custo de serialização, transporte e host parsing. A compactação foi feita na metadata **puramente apresentacional**, mantendo schemas, security schemes, annotations e contratos intactos:

- [x] o status final padrão mudou de `${label} concluido` para `${label}: ok`, mais curto e linguisticamente mais claro para labels em gerúndio como `Lendo arquivo`/`Aplicando patch`;
- [x] quando não existe label humano explícito, a invocation metadata deixa de repetir o `title` rico e usa o nome estável humanizado da tool; o `title` completo continua presente no campo top-level destinado à UI;
- [x] a compatibilidade `_meta.securitySchemes` foi **preservada**; não se comprou payload removendo o espelho de autenticação usado por clientes antigos;
- [x] o teste de payload passou novamente sob 128 KiB e agora exige também **>1 KiB de headroom**, impedindo que o próximo acréscimo marginal volte a encostar silenciosamente no limite;
- [x] o teste de registry cobre tanto o label explícito (`Aplicando patch...` / `Aplicando patch: ok`) quanto o fallback compacto (`Connector smoke refresh...` / `Connector smoke refresh: ok`).

O primeiro broad gate falhou somente por essa regressão de payload. Após a correção, o `mcp-fast` final `53c184de-5e5f-4e56-86fb-72b0890f39bc` ficou integralmente verde: **59/59 arquivos, 311/311 testes MCP**, typecheck incluído, duração total ~35,4 s. Isso fecha a rodada com uma propriedade importante: o aumento da autonomia para 116 tools não ficou autorizado a crescer indefinidamente o custo de descoberta do próprio agente.

A prova remota pós-reload confirmou o efeito no wire real: `authenticatedToolsList.responseBytes` caiu de **131.470 para 129.918 bytes**, redução de **1.552 bytes**, mantendo 116/116 tools e zero missing/unexpected. Em quatro smokes completos consecutivos no mesmo processo, `mcp_connector_smoke_refresh` estabilizou em **929 ms de média**, último sample **877 ms**, e o dashboard voltou a `status=ok` com 10 chamadas observadas, error rate zero e nenhum warning. Esse sample múltiplo é mais representativo que a fotografia unitária de 954 ms usada na seção 104.15 e reforça a ordem de grandeza final: aproximadamente **8,9× mais rápido** que o baseline de 8.282 ms.

### 104.19 Reaper automático seguro para harnesses LLM-B logicamente concluídos

A instrumentação de detached runs já havia encontrado um vazamento real: `mcp-7b16c6a1-7dfc-47f5-bc50-c7e84170f6a9` possuía summary final persistido, mas o runner continuava vivo e com identidade exata verificável muito depois do encerramento lógico. A tool `llmb_live_test_cancel` existe no registry do servidor e é auditada como destructive, porém o host ChatGPT desta sessão continuou sem materializar seu schema callable mesmo com o smoke remoto confirmando **116/116** tools. Portanto havia uma dependência operacional indevida: um leak detectável pelo servidor podia sobreviver indefinidamente apenas porque o cliente não havia atualizado sua superfície de execução.

A correção não torna cancelamento arbitrário automático. Foi criado um reaper estreito, cuja elegibilidade exige simultaneamente:

- [x] manifesto estrito `mcp-<UUID>` já validado pelo parser existente;
- [x] `summary.md` presente, isto é, o harness já publicou sua saída autoritativa;
- [x] processo ainda vivo **e** `/proc/<pid>/cmdline` correspondendo ao runner allowlisted e ao `--out-dir=<manifest.outDir>` exato;
- [x] summary com idade mínima de **30 s**, preservando uma janela de grace para shutdown natural;
- [x] nova leitura do manifesto e **nova verificação de identidade imediatamente antes do `SIGTERM`**, fechando a janela de PID reuse entre scan e reap;
- [x] ausência de PID, signal, path, command ou env fornecido externamente ao reaper;
- [x] falha em um candidato é isolada e contabilizada; não bloqueia cleanup dos demais nem o workspace smoke;
- [x] em plataformas sem identidade `/proc` verificável, o reaper automático não promove `pidPresent` a candidato seguro.

O reaper foi integrado à `scheduleMcpStartupMaintenance`, depois dos cleanups de quick-tunnel/rollback e antes do workspace smoke. O estado de startup agora contabiliza `detachedLiveRunsReaped` e `detachedLiveRunReaperFailures`; `mcp_runtime_health` também expõe esse estado e transforma falhas de reap em warning observável, sem transformar um cleanup auxiliar em indisponibilidade falsa do MCP.

Cobertura de segurança adicionada:

- [x] teste de autonomia injeta cinco detached rows e prova que somente `artifacts_ready_process_alive + processIdentity=verified + summaryAge>=grace` é elegível;
- [x] candidato jovem, PID/command mismatch e run ainda ativo são preservados;
- [x] falha simulada de um reap é agregada sem impedir o candidato independente;
- [x] startup maintenance registra reap bem-sucedido;
- [x] exceção do reaper permanece não fatal ao workspace smoke, mas aparece como `detachedLiveRunReaperFailures=1`;
- [x] focused tests verdes; strict typecheck verde após corrigir acesso index-signature; lint verde;
- [x] broad `mcp-fast` pós-reload `bedf9776-bdec-4e16-b9f5-2c29142cd9e3`: **59/59 arquivos e 313/313 testes**, typecheck incluído, ~34,0 s;
- [x] `mcp_runtime_health` passou a expor `operationalSignals.startupMaintenance`, incluindo os dois contadores do reaper e warning explícito quando houver failure;
- [x] release gate final, já incluindo essa observabilidade, `d610cabe-a37f-4df8-827d-c0744840ae0f`: **59/59 arquivos, 313/313 testes**, typecheck incluído, ~38,3 s;
- [x] runtime live pós-reload mostrou `startupMaintenance.completed=true`, `success=true`, `detachedLiveRunReaperFailures=0` e health global `status=ok`.

A prova live ocorreu no próprio leak histórico. Antes do reload, `llmb_live_runs` mostrava `mcp-7b16...` como `artifacts_ready_process_alive`, `pidAlive=true`, `pidPresent=true`, `processIdentity=verified`. Após ativar o reaper e aguardar a maintenance delayed, o mesmo manifesto passou a aparecer como **`artifacts_ready`, `pidAlive=false`, `pidPresent=false`, `processIdentity=process-not-alive`**. Nenhum PID foi informado manualmente e nenhum processo fora da identidade allowlisted foi tocado. O leak real, portanto, foi removido pelo caminho que futuras sessões usarão automaticamente.

Essa mudança elimina uma classe de dependência entre **capacidade real do servidor** e **atualização tardia do schema pelo host**: o cancel explícito continua disponível quando o cliente o materializa, mas processos logicamente concluídos não dependem mais dele para cleanup eventual e seguro.

### 104.20 Taxonomia BYOK: HTTP 400 deixa de ser retry genérico e passa a excluir corretamente a rota defeituosa

A leitura do health persistido dos últimos probes reais mostrou uma segunda fonte de lentidão e desperdício: falhas como `400 ... Invalid model: mistral-nemo-2407` e `400 ... Bad Request` estavam chegando à taxonomia como `unknown`. Como `unknown` era tratado pelo runtime selector como falha potencialmente retryable, a mesma rota podia receber uma nova tentativa mesmo quando a própria resposta do provider já indicava que repetir o request idêntico não tinha valor.

A taxonomia foi aprofundada sem transformar todo `400` em uma única classe:

- [x] `400` cujo texto identifica `model`, `deployment` ou `route` inválido/inexistente passa a `model-or-route`;
- [x] `400` com wire/schema incompatível continua `capability-unsupported`;
- [x] `400` residual passa à nova classe `invalid-request`, preservando a mensagem original e `statusCode=400`;
- [x] `invalid-request` é permanente para **a rota/request atual**: `retryRoute=false`, `fallbackRoute=true`, `waitMs=0`;
- [x] `health-routing` reconhece `provider.invalid_request`, de modo que a evidência persistida participa do bloqueio/rerank subsequente em vez de cair novamente em `unknown`;
- [x] a política continua permitindo fallback para outro modelo/provider; o que deixa de acontecer é pagar latência/quota repetindo cegamente a mesma forma de request;
- [x] focused unit test cobre `Invalid model`, wire-schema, `Bad Request` residual e a decisão de retry permanente; strict typecheck também passou após a alteração.

Essa mudança é particularmente importante para o fluxo adaptativo `repo_agent`: ela reduz tentativas sem informação nova, melhora a qualidade do health acumulado e aproxima a seleção real do princípio já adotado no control plane — **falha objetiva deve produzir avanço de candidato, não replay da mesma rota**.
