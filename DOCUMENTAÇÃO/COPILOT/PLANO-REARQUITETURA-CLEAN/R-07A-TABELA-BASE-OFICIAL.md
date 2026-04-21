# R-07A — Tabela-Base Oficial do Ciclo Clean

**Programa**: P0 / Faixa A **Data-base factual**: 2026-04-16 **Status**: ativo e canônico para
comparação entre checkpoints

---

## 1. Propósito

Este documento congela a primeira fotografia factual do ciclo clean após a consolidação inicial das
extrações de `presentation/` e do fechamento estrutural da primeira metade da Faixa F.

Ele existe para responder, sem adivinhação:

- quanto código existe por módulo;
- onde estão os maiores hotspots;
- quais acoplamentos estruturais ainda dominam o sistema;
- e quais sinais de dívida residual continuam visíveis no runtime.

> Regra prática: a partir daqui, qualquer checkpoint relevante deve comparar seus efeitos contra
> esta tabela-base, e não contra números lembrados de cabeça ou snapshots documentais antigos.

---

## 2. Método de medição

### Recorte usado

- código: `src/copilot/**/*.js`
- documentação: `DOCUMENTAÇÃO/COPILOT/**/*.md`
- linha clean: `DOCUMENTAÇÃO/COPILOT/PLANO-REARQUITETURA-CLEAN/**/*.md`

### Heurísticas usadas

- contagem de linhas por leitura direta dos arquivos `.js`;
- contagem de importadores por busca textual (`#copilot/*` e imports relativos relevantes);
- contagem heurística de sinais de dívida via `@deprecated`, `TODO/FIXME` e `catch {}` silenciosos.

### Limites conhecidos

- contagens heurísticas não substituem auditoria semântica;
- números de LOC podem variar poucos pontos entre checkpoints por comentários, cabeçalhos ou
  reformatação;
- acoplamento estrutural é inferido por import/referência, não por dependência semântica completa.

---

## 3. Snapshot global

| Métrica                             |  Valor |
| ----------------------------------- | -----: |
| Arquivos `.js` em `src/copilot/`    |    426 |
| Linhas em `src/copilot/`            | 63.869 |
| Diretórios top-level em disco       |     22 |
| Diretórios top-level com `.js`      |     20 |
| Markdown em `DOCUMENTAÇÃO/COPILOT/` |    160 |
| Markdown na linha clean             |     19 |

### Leitura executiva

- `agent/` continua sendo o maior hotspot absoluto;
- `sdk/` ainda é o segundo maior eixo estrutural e segue difuso demais fora do próprio módulo;
- `presentation/` já existe como SSOT de borda compartilhada e deve permanecer explicitamente no
  mapa arquitetural daqui para frente;
- a linha clean já não é “rascunho paralelo”: com 19 documentos, ela já opera como hub real.

---

## 4. Totais por diretório de topo

| Diretório           | Arquivos `.js` | Linhas | Leitura rápida                                                              |
| ------------------- | -------------: | -----: | --------------------------------------------------------------------------- |
| `agent/`            |             62 |  8.327 | maior hotspot estrutural do runtime                                         |
| `sdk/`              |             38 |  7.913 | wrapper ainda grande e com ownership difuso em sessão                       |
| `tools/`            |             33 |  7.101 | plataforma ampla, porém relativamente mais saudável                         |
| `terminal/`         |             47 |  5.943 | rico em UX e ainda com DI interna difusa                                    |
| `observability/`    |             33 |  5.860 | transversal demais; fan-out segue alto                                      |
| `server/`           |             41 |  5.304 | borda HTTP/realtime relevante e já parcialmente saneada por `presentation/` |
| `hooks/`            |             25 |  4.610 | camada de política ainda espessa                                            |
| `core/`             |             20 |  3.146 | base útil, mas ainda muito consumida por conveniência                       |
| `config/`           |             24 |  2.550 | builders/defaults/runtime state ainda misturados                            |
| `events/`           |             20 |  2.299 | catálogo importante, porém ainda inflado                                    |
| `conversation-hub/` |             12 |  2.217 | ownership de store/replay ainda subaproveitado                              |
| `bridges/`          |             13 |  2.192 | integrações externas e adapters de borda relevantes                         |
| `channel/`          |              8 |  1.437 | contrato crítico LLM-A ↔ LLM-B                                              |
| `presentation/`     |              5 |  1.228 | SSOT compartilhada das bordas `server/`/`terminal/`                         |
| `infra/`            |             11 |  1.023 | recursos técnicos compartilhados                                            |
| `audit/`            |              9 |    906 | trilha transversal útil, ainda a alinhar com observability                  |
| `event-handlers/`   |             13 |    802 | camada positiva, mas ainda não fechada como programa                        |
| `db/`               |              3 |    437 | pequeno, porém estruturalmente crítico                                      |
| `plugins/`          |              3 |    268 | embrionário e sem massa arquitetural suficiente                             |
| `types/`            |              4 |    219 | pequeno demais para o volume contratual atual                               |

### Leitura rápida dos hotspots de módulo

- o topo real hoje é `agent/ → sdk/ → tools/ → terminal/ → observability/ → server/`;
- `presentation/` já merece status de módulo de primeira classe dentro da borda de P4;
- `terminal/` caiu de protagonismo como pseudo-backend, mas segue grande como UX local + wiring.

---

## 5. Hotspots de arquivo

| Linhas | Arquivo                                                       |
| -----: | ------------------------------------------------------------- |
|    700 | `src/copilot/sdk/types.js`                                    |
|    638 | `src/copilot/agent/always-alive.js`                           |
|    631 | `src/copilot/agent/dialog/loop-manager.js`                    |
|    563 | `src/copilot/conversation-hub/store.js`                       |
|    507 | `src/copilot/channel/client.js`                               |
|    486 | `src/copilot/hooks/factory.js`                                |
|    437 | `src/copilot/server/socket/hub-ns.js`                         |
|    432 | `src/copilot/bridges/mcp-tool-bridge.js`                      |
|    431 | `src/copilot/agent/agent-context.js`                          |
|    427 | `src/copilot/terminal/repl.js`                                |
|    426 | `src/copilot/observability/observers/dialog-task-handlers.js` |
|    418 | `src/copilot/channel/inject.js`                               |
|    417 | `src/copilot/observability/metrics.js`                        |
|    412 | `src/copilot/conversation-hub/orchestrator.js`                |
|    412 | `src/copilot/tools/introspection-tools.js`                    |
|    405 | `src/copilot/agent/dialog/turn-executor.js`                   |
|    405 | `src/copilot/agent/lifecycle/agent-lifecycle.js`              |
|    398 | `src/copilot/events/schemas/builtin-schemas.js`               |
|    398 | `src/copilot/tools/web-tools.js`                              |
|    393 | `src/copilot/observability/collectors/session-handlers.js`    |

### Leitura executiva dos hotspots

- `sdk/types.js` continua desproporcionalmente grande para uma superfície de contratos;
- `always-alive.js`, `loop-manager.js`, `turn-executor.js` e `agent-lifecycle.js` confirmam que o
  coração do P1 ainda está vivo;
- `conversation-hub/store.js` e `channel/client.js` indicam que P2/P4 não são “fase distante”: eles
  já são hotspots da base atual;
- `terminal/repl.js` é um hotspot legítimo de UX local, não de pseudo-backend.

---

## 6. Acoplamentos transversais críticos

| Sinal                                      | Valor | Leitura                                                                    |
| ------------------------------------------ | ----: | -------------------------------------------------------------------------- |
| importadores de `sdk` fora de `sdk/`       |    95 | o wrapper ainda vaza demais para o resto do sistema                        |
| importadores de `observability`            |    97 | logging/metrics/tracing seguem transversais demais                         |
| importadores de `agent` fora de `agent/`   |    52 | a fachada do runtime ainda serve como API de conveniência para muita coisa |
| imports diretos `server → terminal`        |     0 | slice estrutural principal de P4 já foi fechado                            |
| importadores `terminal → agent`            |    15 | terminal segue consumidor legítimo do runtime da LLM-B                     |
| importadores `terminal → conversation-hub` |    11 | terminal ainda fala bastante com store/replay/memória                      |
| importadores `terminal → channel`          |     8 | compatível com o papel de interface operacional da LLM-B                   |
| referências a `EventBus`/emissão           |   733 | modelo de eventos continua forte, mas caro de governar                     |

### Leituras de acoplamento

- o acoplamento `server ↔ terminal` foi resolvido no nível estrutural, mas o custo de DI interna do
  terminal ainda não foi reduzido;
- o problema de borda cedeu espaço para um problema ainda maior de transversalidade em `sdk/` e
  `observability/`;
- `presentation/` já atua como SSOT de borda e precisa ser explicitada nos artefatos canônicos da
  arquitetura-alvo.

---

## 7. Dívida residual visível

### 7.1 Código

| Sinal                                      | Valor | Leitura                                                          |
| ------------------------------------------ | ----: | ---------------------------------------------------------------- |
| referências a `@deprecated` / `deprecated` |    20 | ainda há legados vivos e wrappers com prazo de remoção implícito |
| marcadores `TODO/FIXME`                    |    21 | backlog estrutural continua embutido no código                   |
| `catch {}` silenciosos                     |    12 | ainda existe swallow de erro em pontos relevantes                |

### 7.2 Documentação clean

| Sinal                      | Valor | Leitura                                                                                          |
| -------------------------- | ----: | ------------------------------------------------------------------------------------------------ |
| referências a `deprecated` |    14 | documentação já fala bastante de dívida residual — bom para governança, ruim se não houver saída |
| `TODO/FIXME`               |     6 | ainda há pontos declarados como pendentes na própria linha clean                                 |

### 7.3 Leituras principais

- a dívida residual já não está “escondida”; ela está razoavelmente nomeada, mas ainda precisa virar
  fila executável com prazo e dono;
- o eixo de compatibilidade residual do `agent/` permanece sendo o bolsão técnico mais explícito;
- o volume de `@deprecated` já é suficiente para justificar registro canônico próprio em P0.

---

## 8. Síntese para as próximas ondas

### O que a Faixa A precisa sustentar

1. uma base métrica estável para provar redução real de acoplamento e de hotspots;
2. um mapa explícito de ownership e fronteiras para evitar reimportar difusão no meio das ondas B–F;
3. um registro canônico de compatibilidade residual, para impedir “temporário eterno”;
4. gates mínimos de qualidade, segurança e suites por tipo de mudança.

### O que esta tabela já provou

- P4 fechou a maior dependência estrutural errada (`server → terminal`);
- P1 continua sendo o maior campo de trabalho do ciclo clean;
- P2/P3 seguem mais urgentes do que qualquer capability avançada, porque `sdk/` e `observability/`
  continuam dominando o custo transversal do sistema.

---

## 9. Uso obrigatório desta tabela-base

Este documento deve ser consultado e atualizado quando:

- um programa alterar significativamente LOC/hotspots de um módulo central;
- um checkpoint reduzir ou aumentar acoplamentos transversais de forma mensurável;
- a linha clean passar a conviver com novo SSOT estrutural de borda ou runtime;
- deprecateds, TODOs ou shims relevantes forem removidos ou criados.

Quando houver divergência entre números antigos da série clean e esta tabela-base, **prevalece este
documento** até a sincronização dos demais artefatos.
