# 68 — Roadmap de revolução contínua da Arquitetura 2.1 (`src/copilot`)

**Data:** 2026-04-30 **Status:** roadmap executivo expandido (continuidade dos docs 23/24 +
checkpoints 57–64)

---

## 1) Diretriz do roadmap

Este roadmap assume que a base 2.0 está operacionalmente comprovada e define as próximas ondas para
transformação ampla/profunda, com foco em reduzir densidade, fortalecer ownership e preservar
estabilidade multi-runtime.

---

## 2) Faixas estratégicas 2.1

## F1 — Simplificação estrutural de `agent/`

### Subfaixas

- F1.1 Mapear hotspots de fan-in/fan-out por subdomínio interno (`lifecycle`, `dialog`, `facades`,
  `ports`)
- F1.2 Extrair seams semânticos adicionais onde houver concentração indevida
- F1.3 Reduzir dependências cruzadas `agent -> core/config` não essenciais
- F1.4 Introduzir score de complexidade por pacote interno do agent

### Pronto quando

- redução mensurável de arestas nos hotspots priorizados sem perda de contrato público.

---

## F2 — Monopólio final de projection em `presentation/`

### Subfaixas

- F2.1 Catalogar todas as projections runtime-aware ativas
- F2.2 Padronizar shape ownership por projection
- F2.3 Eliminar montagem ad hoc residual em rotas/comandos
- F2.4 Criar testes de regressão por família de payload

### Pronto quando

- payload compartilhado de runtime/health/session/capabilities é 100% originado em `presentation/*`.

---

## F3 — Bordas operacionais de baixa entropia (`server`/`terminal`)

### Subfaixas

- F3.1 Reclassificar rotas/comandos por taxonomia arquitetural única
- F3.2 Extrair adapters infra-only para reduzir controllers mistos
- F3.3 Refinar fronteira terminal UX vs orchestration
- F3.4 Reduzir acoplamento interno entre comandos/frontend/repl listeners

### Pronto quando

- bordas são majoritariamente adapters finos, sem ownership indevido de domínio.

---

## F4 — Multi-runtime pleno (estado, concorrência, streaming, quotas)

### Subfaixas

- F4.1 Revisar todos os estados vivos restantes fora de `server/runtime-state`
- F4.2 Consolidar política por-runtime para concorrência de turnos e streams
- F4.3 Endurecer governança de fallback/default runtime
- F4.4 Ampliar testes com cenários de múltiplos runtimes simultâneos em carga

### Pronto quando

- runtime isolation fica comprovada em contratos + cenários operacionais estendidos.

---

## F5 — SDK boundary 2.1 (evolução sem drift)

### Subfaixas

- F5.1 Auditoria contínua de capacidades novas do SDK vendor
- F5.2 Promoção tipada/observável de capabilities faltantes
- F5.3 Hardening de taxonomy de erro/recovery por operação
- F5.4 Revisão periódica de ports/adapters de model/session

### Pronto quando

- nenhuma capacidade relevante do SDK fica fora de boundary canônico sem decisão explícita.

---

## F6 — Observability e audit com ownership estrito

### Subfaixas

- F6.1 Fatiar agregados de observability por domínio de sinal
- F6.2 Separar claramente collector vs projection vs governança
- F6.3 Evitar que observability vire bypass de domínio
- F6.4 Evoluir score operacional de health arquitetural por módulo

### Pronto quando

- observability observa o sistema sem capturar ownership de runtime/payload.

---

## F7 — Governança institucional (contratos, ADRs, scorecards)

### Subfaixas

- F7.1 Expandir `test_arch_contracts` para novas fronteiras 2.1
- F7.2 Congelar inventário de registries/seams por domínio
- F7.3 Atualizar ADRs curtas por decisão estrutural relevante
- F7.4 Criar scorecard de maturidade contínua no CI (faseada)

### Pronto quando

- regressões arquiteturais críticas quebram automaticamente com feedback rápido.

---

## F8 — Artefatos, plugins, extensibilidade e descomissionamento

### Subfaixas

- F8.1 Revisitar mandato de `plugins/` na topologia 2.1
- F8.2 Consolidar governança de artefatos operacionais fora de domínio
- F8.3 Mapear/remover shims e caminhos paralelos remanescentes
- F8.4 Fechar baseline final pós-revolução contínua

### Pronto quando

- árvore de código e árvore de artefatos ficam semanticamente separadas e auditáveis.

---

## F9 — Arquitetura informacional da árvore (`README` + `module-map` + migração física)

### Situação atual validada

Mesmo após a redução de acoplamentos e extração de seams, vários diretórios ainda são difíceis de
ler ao abrir a pasta: arquivos primários, secundários, policies, stores, adapters e seams convivem
lado a lado. Isso aumenta custo cognitivo, torna code review dependente de memória histórica e
facilita a criação de novos "mini-orquestradores" sem ownership claro.

O caso `src/copilot/agent/dialog/` é exemplar: há controller, loop manager, turn executor, boot
runner, policies, state helpers, watchdogs e seams internos na mesma raiz física. A arquitetura
funciona, mas a topologia visual ainda não comunica hierarquia.

### Situação ideal

Cada diretório de domínio em `src/copilot/` deve ter três artefatos canônicos:

1. `README.md` — navegação humana, papéis e ordem recomendada de leitura;
2. `index.js` — superfície pública/sub-barrel, sem virar inventário informal;
3. `module-map.js` — inventário executável de arquivos, papéis, tiers e public/private.

A migração física deve convergir para subpastas semânticas padronizadas, usadas conforme o domínio:

- `controllers/`: adapters internos de entrada;
- `orchestrators/`: coordenação de fluxos vivos;
- `executors/`: execução de ações/turnos;
- `boot/`: bootstrap, handshake, circuit breakers e kits de runtime;
- `policies/`: decisão pura, fallback e regras;
- `state/`: máquinas, ledgers, registries e estado auxiliar;
- `wiring/`: ligação de eventos/listeners;
- `ports/`: fronteiras abstratas para capacidades externas;
- `adapters/`: implementações concretas de portas;
- `stores/`: IO/persistência e schema local;
- `projections/`: payloads/read models quando o owner não for `presentation/`;
- `seams/`: módulos internos extraídos de caminhos quentes.

Regra alvo: a raiz de um diretório de domínio deve tender a `README.md`, `index.js` e
`module-map.js`. Arquivos legados na raiz podem sobreviver temporariamente como shims, desde que
estejam registrados no roadmap e cobertos por contrato de remoção.

### Subfaixas

- F9.1 Introduzir `module-map.js` e `README.md` nos diretórios quentes (`agent/dialog` primeiro)
- F9.2 Criar contratos que impedem arquivos órfãos sem papel arquitetural
- F9.3 Migrar fisicamente arquivos para subpastas semânticas com shims compatíveis
- F9.4 Atualizar imports internos para barrels/subpastas canônicas
- F9.5 Remover shims legados quando testes e consumers estiverem migrados
- F9.6 Replicar a taxonomia para `agent/session`, `agent/lifecycle`, `server`, `terminal`,
  `presentation` e `sdk`

### Pronto quando

- ao abrir qualquer diretório quente de `src/copilot`, os orquestradores primários, módulos
  secundários e detalhes internos estão explícitos em documentação local e contrato executável.

---

## 3) Ordem recomendada de ataque (2.1)

1. **F1 + F2** (máximo impacto em clareza/custo cognitivo)
2. **F3 + F4** (robustez de borda e multi-runtime real)
3. **F5 + F6** (boundary vendor + observabilidade sem drift)
4. **F7 + F8** (institucionalização e fechamento de legado)
5. **F9 transversal** (arquitetura informacional aplicada junto de cada refactor físico)

---

## 4) Plano em ondas (W85–W116)

### Bloco K — Simplificação e projection final (W85–W92)

- W85: hotspot map `agent/*` por aresta e semântica
- W86: extração de seams internos faltantes (**em andamento avançado**; `state-io`, runtime-state,
  boot seams, lifecycle teardown, `turn-executor` e boot lifecycle do `loop-manager` já fatiados até
  W86.8)
- W87: limpeza de dependências `agent -> core/config` (**iniciada**; `agent-lifecycle` já consome
  core/container/error-handlers via `agent/ports/core-runtime-port.js` e `session/snapshot.js`
  delega IO/schema para `session/snapshot-store.js`)
- W88: catálogo 2.1 de projections em `presentation`
- W89: unificação de payloads runtime/health/session/capabilities
- W90: testes anti-ad-hoc por família de projection
- W91: refino terminal UX vs orchestration
- W92: refino server adapter taxonomy

### Bloco L — Multi-runtime e SDK evolution (W93–W100)

- W93: inventário final de estado vivo fora de registries explícitos
- W94: convergência dos remanescentes para registries ou stores legítimos
- W95: stress tests de concorrência por runtime
- W96: fallback/default-runtime governance hardening
- W97: auditoria capabilities SDK pendentes (versão atual)
- W98: promoção de wrappers faltantes
- W99: hardening error/recovery taxonomy
- W100: validação operacional ampla da faixa

### Bloco M — Institucionalização e convergência final (W101–W108)

- W101: expansão de contracts arquiteturais 2.1
- W102: ADRs curtas de decisões da onda K/L
- W103: scorecard contínuo por domínio (beta)
- W104: revisão mandato `plugins/` e extensibilidade
- W105: descomissionamento de shims/trilhas paralelas
- W106: limpeza final de artefatos no centro semântico
- W107: auditoria ampla final 2.1
- W108: baseline congelada pós-2.1

### Bloco N — Organização física e navegação executável (W109–W116)

- W109: introduzir taxonomia executável em `agent/dialog` (`README.md`, `module-map.js`, contrato de
  cobertura e critérios de leitura)
- W110: classificar diretórios quentes por papel e risco (`agent/session`, `agent/lifecycle`,
  `server/routes`, `terminal/handlers`, `presentation`)
- W111: migrar fisicamente `agent/dialog` para subpastas semânticas com shims temporários e
  contratos anti-órfão (**concluída** com `controllers/*`, `orchestrators/*`, `executors/*`,
  `boot/*`, `policies/*`, `state/*`, `wiring/*` e `watchdogs/*`; shims de raiz removidos)
- W112: migrar imports internos do dialog para as novas subpastas e reduzir deep imports de testes
  (**iniciada** com contrato anti-import de shims em código de produção)
- W113: aplicar a mesma taxonomia em `agent/session` e `agent/lifecycle` (**iniciada** nos dois
  diretórios com `README.md`, `module-map.js` e contrato anti-órfão)
- W114: aplicar a taxonomia nas bordas `server`/`terminal`, preservando adapters finos
- W115: criar scorecard de organização física por diretório quente
- W116: remover shims legados e congelar baseline 2.1 de navegação estrutural (\*\*concluída para
  `agent/dialog`; próxima aplicação prevista em `agent/session` após migração física)

---

## 5) Critério de sucesso desta nova fase

A fase 2.1 só é considerada bem-sucedida quando:

1. complexidade estrutural cai com evidência quantitativa;
2. projection monopoly fica completo e defendido por contrato;
3. multi-runtime permanece estável sob concorrência real;
4. fronteira SDK evolui sem drift;
5. governança executável impede regressão por crescimento orgânico;
6. diretórios críticos deixam claro, localmente e por contrato, quais arquivos são orquestradores,
   quais são módulos secundários e quais são detalhes internos.

---

## 6) Próximo passo operacional

Com os documentos 65–68 concluídos e a W86.8 consolidada, o próximo alvo operacional de maior
custo-benefício é:

1. abrir W87 para reduzir dependências diretas e imports cruzados remanescentes no eixo
   `agent -> core/config/sdk`;
2. iniciar W109 em `agent/dialog` para formalizar taxonomia, papéis e próximos movimentos físicos;
3. preparar W93 com testes multi-runtime reais sobre os registries já extraídos;
4. iniciar W88/W89 em paralelo quando a família de projection runtime estiver suficientemente
   inventariada.
