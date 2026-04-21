# M-07 — Fases Futuras (Feature Tracks)

**Data**: 2026-03-21 **Versão**: 1.1 **Pré-requisito**: M-02 a M-06 concluídos (parcial para algumas
faixas) **Estimativa**: ~78h total **Risco**: Variável (por faixa) **Consolida**: Faixas D, F, G2,
H, J3

## 0. Status auditado — 2026-04-15

As faixas futuras continuam válidas, mas o gating real mudou levemente após a auditoria:

- `M-02` já pode ser tratado como praticamente encerrado no plano estrutural;
- `M-03` a `M-06` continuam sendo o gargalo real antes de atacar features grandes com segurança;
- em especial, `G2` (Hub Lifecycle) continua dependente da extração de session registry planejada em
  M-04;
- `F` (Telemetry) continua dependente da consolidação de observability descrita em M-06.

---

## 1. Contexto e Motivação

Após as fases de refatoração estrutural (M-02 a M-06, ~113h), restam faixas de **funcionalidade
nova** e **melhorias técnicas** que foram adiadas por dependerem de uma base saudável.

Este documento cataloga cada faixa futura com:

- Pré-requisitos (quais fases M-0x devem estar concluídas)
- Escopo resumido
- Estimativa
- Prioridade relativa

> Cada faixa futura terá seu próprio documento detalhado quando for priorizada.

---

## 2. Mapa de Faixas Futuras

| Faixa | Nome                            | Horas | Pré-req | Prioridade |
| ----- | ------------------------------- | ----- | ------- | ---------- |
| D     | Experimental RPC Extension      | 30h   | M-02    | Alta       |
| F     | Observabilidade SDK + Telemetry | 16h   | M-06    | Média      |
| G2    | Conversation Hub Lifecycle      | 10h   | M-03    | Média      |
| H     | TSServer Integration            | 16h   | M-04    | Baixa      |
| J3    | SDK Documentation               | 6h    | M-04    | Baixa      |

**Total**: ~78h

---

## 3. Faixa D — Experimental RPC Extension (~30h)

### Contexto

A Faixa A3.2 implementou 20 tools experimentais em `sdk/rpc/experimental.js` (371L). A Faixa D
expande com 5 conjuntos adicionais:

| Subfase | Ferramentas                             | Horas |
| ------- | --------------------------------------- | ----- |
| D1      | Skills RPC (5 ferramentas)              | 6h    |
| D2      | MCP RPC (6 ferramentas)                 | 8h    |
| D3      | Agent Orchestration RPC (4 ferramentas) | 6h    |
| D4      | Extensions RPC (3 ferramentas)          | 4h    |
| D5      | Fleet Management RPC (4 ferramentas)    | 6h    |

### Pré-requisitos

- M-02 concluído (imports limpos)
- `tools/experimental-rpc-tools.js` deve servir como template

### Arquivos a criar/modificar

| Arquivo                        | Ação                               |
| ------------------------------ | ---------------------------------- |
| `sdk/rpc/skills.js`            | CRIAR: Skills RPC server           |
| `sdk/rpc/mcp.js`               | CRIAR: MCP RPC server              |
| `sdk/rpc/orchestration.js`     | CRIAR: Orchestration RPC server    |
| `sdk/rpc/extensions.js`        | CRIAR: Extensions RPC server       |
| `sdk/rpc/fleet.js`             | CRIAR: Fleet Management RPC server |
| `tools/skill-tools.js`         | CRIAR: 5 LLM tools para Skills     |
| `tools/mcp-tools.js`           | CRIAR: 6 LLM tools para MCP        |
| `tools/orchestration-tools.js` | CRIAR: 4 LLM tools                 |
| `tools/extension-tools.js`     | CRIAR: 3 LLM tools                 |
| `tools/fleet-tools.js`         | CRIAR: 4 LLM tools                 |

### Risco

- Médio: depende de APIs experimentais do SDK que podem mudar

---

## 4. Faixa F — Observabilidade SDK + Telemetry (~16h)

### Contexto

Após M-06 (error pipeline), a observability está limpa mas ainda faltam:

1. Client-side telemetry (performance de requests, latência, token usage)
2. OTEL export configurável (stdout, Jaeger, OTLP)
3. Dashboards de quota via `/health/quotas`

| Subfase | Escopo                       | Horas |
| ------- | ---------------------------- | ----- |
| F1      | Client telemetry middleware  | 4h    |
| F2      | OTEL exporter configurável   | 6h    |
| F3      | Quota dashboard endpoints    | 4h    |
| F4      | Métricas de tool performance | 2h    |

### Pré-requisitos

- M-06 concluído (ErrorPipeline = base de métricas)
- `sdk/telemetry/` existente serve como base

### Arquivos a criar/modificar

| Arquivo                             | Ação                                      |
| ----------------------------------- | ----------------------------------------- |
| `sdk/telemetry/client-telemetry.js` | CRIAR: interceptor de requests            |
| `sdk/telemetry/otel-exporter.js`    | CRIAR: configuração dinâmica de exporters |
| `server/routes/health.js`           | ATUALIZAR: adicionar /health/quotas       |
| `observability/metrics.js`          | ATUALIZAR: integrar com OTEL exporter     |

### Risco

- Baixo: extensão incremental sobre infraestrutura existente

---

## 5. Faixa G2 — Conversation Hub Lifecycle (~10h)

### Contexto

O `conversation-hub/` (12 arquivos, 2.217L) gerencia conversas mas não tem lifecycle formal:

- Não há cleanup automático de conversas dormentes
- `store.js` (563L) cresce sem limites
- Não há replay/recovery de conversas após restart

| Subfase | Escopo                                     | Horas |
| ------- | ------------------------------------------ | ----- |
| G2.1    | TTL para conversas (cleanup automático)    | 3h    |
| G2.2    | Store compaction (SQLite vacuum + archive) | 3h    |
| G2.3    | Conversation replay após restart           | 4h    |

### Pré-requisitos

- M-03 concluído (agent session lifecycle estável)
- M-04 concluído (session registry em conversation-hub/)

### Arquivos a criar/modificar

| Arquivo                                | Ação                             |
| -------------------------------------- | -------------------------------- |
| `conversation-hub/lifecycle.js`        | CRIAR: TTL manager + cleanup     |
| `conversation-hub/store-compaction.js` | CRIAR: vacuum + archive strategy |
| `conversation-hub/store.js`            | ATUALIZAR: integrar lifecycle    |
| `conversation-hub/orchestrator.js`     | ATUALIZAR: replay on restart     |

### Risco

- Médio: compaction pode causar perda de dados se mal implementado

---

## 6. Faixa H — TSServer Integration (~16h)

### Contexto

O TSServer (TypeScript Language Server) é uma ferramenta valiosa para fornecer contexto de código ao
agente. Atualmente não há integração formal.

| Subfase | Escopo                                                                                 | Horas |
| ------- | -------------------------------------------------------------------------------------- | ----- |
| H1      | TSServer tools (5 ferramentas: hover, completion, definition, references, diagnostics) | 10h   |
| H2      | Context injection (injetar info do TSServer no system prompt)                          | 6h    |

### Pré-requisitos

- M-04 concluído (SDK stateless, import paths limpos)
- Referência: Doc 06 (TSSERVER-SDK-INTERNALIZACAO)

### Arquivos a criar

| Arquivo                                             | Ação                   |
| --------------------------------------------------- | ---------------------- |
| `tools/tsserver/hover.js`                           | CRIAR                  |
| `tools/tsserver/completion.js`                      | CRIAR                  |
| `tools/tsserver/definition.js`                      | CRIAR                  |
| `tools/tsserver/references.js`                      | CRIAR                  |
| `tools/tsserver/diagnostics.js`                     | CRIAR                  |
| `tools/tsserver/index.js`                           | CRIAR: barrel          |
| `config/system-prompt/sections/tsserver-context.js` | CRIAR: seção de prompt |

### Risco

- Alto: TSServer é processo externo pesado; precisa de gerenciamento de lifecycle

---

## 7. Faixa J3 — SDK Documentation (~6h)

### Contexto

Após M-04 (SDK stateless) e M-07 (documentation), o SDK wrapper precisa de documentação atualizada:

| Subfase | Escopo                                     | Horas |
| ------- | ------------------------------------------ | ----- |
| J3.1    | Documentação de API pública do SDK wrapper | 3h    |
| J3.2    | Guia de migração para consumers            | 3h    |

### Pré-requisitos

- M-04 concluído (API estabilizada)

### Arquivos a criar

| Arquivo                                   | Ação                     |
| ----------------------------------------- | ------------------------ |
| `DOCUMENTAÇÃO/COPILOT/SDK-WRAPPER-API.md` | CRIAR: referência de API |
| `DOCUMENTAÇÃO/COPILOT/MIGRATION-GUIDE.md` | CRIAR: guia de migração  |

### Risco

- Baixo: puramente documental

---

## 8. Sequenciamento Recomendado

```
M-02 ──→ D (RPC Extension)
                              ↘
M-03 ──→ G2 (Hub Lifecycle)   ─→ Sprint 8-9
                              ↗
M-04 ──→ H (TSServer) + J3 (Docs)

M-06 ──→ F (Telemetry)
```

### Sprint 8 (Semana 18-19, ~30h)

- D1-D5 (Experimental RPC Extension)

### Sprint 9 (Semana 20-21, ~26h)

- F1-F4 (Telemetry)
- G2 (Hub Lifecycle)

### Sprint 10 (Semana 22-23, ~22h)

- H1-H2 (TSServer)
- J3 (Documentation)

---

## 9. Tabela Consolidada de Todas as Fases

| Fase                    | Doc      | Faixas         | Horas    | Status |
| ----------------------- | -------- | -------------- | -------- | ------ |
| Cleanup                 | M-02     | L1, J2, G4, C4 | 12h      | ⬜     |
| Agent Refactor          | M-03     | K1-K8, L2      | 59h      | ⬜     |
| SDK Stateless           | M-04     | L3, J1         | 14h      | ⬜     |
| Event Unification       | M-05     | L4, G3, K6     | 16h      | ⬜     |
| Obs + Errors            | M-06     | L5, K3, F(p)   | 12h      | ⬜     |
| **Subtotal estrutural** |          |                | **113h** |        |
| RPC Extension           | (futuro) | D              | 30h      | ⬜     |
| Telemetry               | (futuro) | F              | 16h      | ⬜     |
| Hub Lifecycle           | (futuro) | G2             | 10h      | ⬜     |
| TSServer                | (futuro) | H              | 16h      | ⬜     |
| Documentation           | (futuro) | J3             | 6h       | ⬜     |
| **Subtotal features**   |          |                | **78h**  |        |
| **TOTAL GERAL**         |          |                | **191h** |        |

---

## 10. Critérios de Conclusão por Faixa

### Faixa D (RPC)

- [ ] 22 novas ferramentas LLM registradas
- [ ] Testes unitários para cada tool
- [ ] Documentação JSDoc completa

### Faixa F (Telemetry)

- [ ] `/health/quotas` endpoint funcional
- [ ] OTEL export para stdout + OTLP
- [ ] Client telemetry middleware ativo

### Faixa G2 (Hub)

- [ ] Conversas dormentes limpas automaticamente após TTL
- [ ] Store compaction funcional
- [ ] Replay de conversas após restart

### Faixa H (TSServer)

- [ ] 5 ferramentas TSServer funcionais
- [ ] Context injection no system prompt

### Faixa J3 (Docs)

- [ ] SDK-WRAPPER-API.md publicado
- [ ] MIGRATION-GUIDE.md publicado
