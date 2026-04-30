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

## 3) Ordem recomendada de ataque (2.1)

1. **F1 + F2** (máximo impacto em clareza/custo cognitivo)
2. **F3 + F4** (robustez de borda e multi-runtime real)
3. **F5 + F6** (boundary vendor + observabilidade sem drift)
4. **F7 + F8** (institucionalização e fechamento de legado)

---

## 4) Plano em ondas (W85–W108)

### Bloco K — Simplificação e projection final (W85–W92)

- W85: hotspot map `agent/*` por aresta e semântica
- W86: extração de seams internos faltantes (**em andamento avançado**; `state-io`, runtime-state,
  boot seams, lifecycle teardown e `turn-executor` já fatiados até W86.7.3)
- W87: limpeza de dependências `agent -> core/config`
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

---

## 5) Critério de sucesso desta nova fase

A fase 2.1 só é considerada bem-sucedida quando:

1. complexidade estrutural cai com evidência quantitativa;
2. projection monopoly fica completo e defendido por contrato;
3. multi-runtime permanece estável sob concorrência real;
4. fronteira SDK evolui sem drift;
5. governança executável impede regressão por crescimento orgânico.

---

## 6) Próximo passo operacional

Com os documentos 65–68 concluídos e a W86.7.3 consolidada, o próximo alvo operacional de maior
custo-benefício é:

1. fechar W86.8 com decomposição de `loop-manager.js`;
2. abrir W87 para reduzir dependências diretas e imports cruzados remanescentes no eixo
   `agent -> core/config/sdk`;
3. preparar W93 com testes multi-runtime reais sobre os registries já extraídos.
