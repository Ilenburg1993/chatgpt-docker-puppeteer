# Plano de Rearquitetura Clean — `src/copilot`

**Status**: canônico para as próximas ondas de trabalho **Data-base**: 2026-04-15 **Escopo**:
`src/copilot/` inteiro, com foco prioritário em `src/copilot/agent/`

---

## Propósito

Este diretório inaugura uma **nova linha documental limpa** para `src/copilot/`.

Ele existe porque o acervo atual em `DOCUMENTAÇÃO/COPILOT/` já contém muito valor, mas está
fragmentado em várias gerações de auditoria, snapshots históricos e roadmaps parciais. O resultado
prático é o clássico efeito “temos muito material, mas pouca navegação canônica”.

A proposta desta série é simples:

- usar o acervo antigo como **fonte**;
- tratar os documentos novos deste diretório como **linha mestra operacional**;
- reorganizar o backlog em programas, fases e subfases coerentes com o baseline real de 2026-04-15;
- preparar um plano profundo o suficiente para orientar as próximas transformações estruturais sem
  reabrir a discussão do zero a cada checkpoint.

---

## O que esta linha substitui — e o que ela não substitui

### Esta linha passa a ser a referência principal para

- novas auditorias gerais de `src/copilot/`;
- definição de arquitetura-alvo;
- planejamento macro das próximas ondas;
- integração entre backlog técnico, risco, governança e critérios de aceitação.

### Esta linha **não apaga** o acervo anterior

Os diretórios abaixo continuam valiosos como **fonte histórica e de evidências**:

- `DOCUMENTAÇÃO/COPILOT/AUDITORIA-ARQUITETURAL/`
- `DOCUMENTAÇÃO/COPILOT/AUDITORIA-DEEP-SRC-COPILOT/`
- `DOCUMENTAÇÃO/COPILOT/AUDITORIA-SDK-COPILOT/`
- `DOCUMENTAÇÃO/COPILOT/PLANO-MIGRACAO/`
- `DOCUMENTAÇÃO/COPILOT/ROADMAP-UPGRADES-SRC-COPILOT.md`

A diferença é que eles deixam de ser usados como “mapa mestre” disperso.

---

## Como navegar nesta série

| Ordem | Documento                                                                                                      | Papel                                                          |
| ----- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1     | [`R-00-PRE-AUDITORIA.md`](./R-00-PRE-AUDITORIA.md)                                                             | escopo, método, critérios e diretrizes da linha clean          |
| 2     | [`R-01-AUDITORIA-PROFUNDA-RESUMO-EXECUTIVO.md`](./R-01-AUDITORIA-PROFUNDA-RESUMO-EXECUTIVO.md)                 | diagnóstico executivo consolidado                              |
| 3     | [`R-02-MAPA-AS-IS-SRC-COPILOT.md`](./R-02-MAPA-AS-IS-SRC-COPILOT.md)                                           | mapa do estado atual real de `src/copilot/`                    |
| 4     | [`R-03-AUDITORIA-AGENT-E-INTEGRACOES.md`](./R-03-AUDITORIA-AGENT-E-INTEGRACOES.md)                             | deep dive do `agent/` e das suas fronteiras                    |
| 5     | [`R-04-ARQUITETURA-ALVO-E-PRINCIPIOS.md`](./R-04-ARQUITETURA-ALVO-E-PRINCIPIOS.md)                             | situação ideal e princípios de desenho                         |
| 5A    | [`R-04A-ENDSTATE-E-CRITERIOS-DE-SUCESSO.md`](./R-04A-ENDSTATE-E-CRITERIOS-DE-SUCESSO.md)                       | end-state explícito e critérios de sucesso da arquitetura-alvo |
| 6     | [`R-05-MATRIZ-DE-GAPS-E-TRANSFORMACOES.md`](./R-05-MATRIZ-DE-GAPS-E-TRANSFORMACOES.md)                         | gaps, evidências, impactos e programas de transformação        |
| 7     | [`R-06-ROADMAP-MASTER.md`](./R-06-ROADMAP-MASTER.md)                                                           | roadmap global por programas, ondas e dependências             |
| 8     | [`R-16-ROADMAP-GERAL-INTEGRADO.md`](./R-16-ROADMAP-GERAL-INTEGRADO.md)                                         | roadmap expandido por faixas, fases, subfases e checkpoints    |
| 9     | [`R-07-PROGRAMA-0-GOVERNANCA-E-BASELINE.md`](./R-07-PROGRAMA-0-GOVERNANCA-E-BASELINE.md)                       | baseline, governança, medições e gates                         |
| 9A    | [`R-07A-TABELA-BASE-OFICIAL.md`](./R-07A-TABELA-BASE-OFICIAL.md)                                               | snapshot factual do ciclo clean                                |
| 9B    | [`R-07B-MATRIZ-DE-OWNERSHIP-E-CONTRATOS.md`](./R-07B-MATRIZ-DE-OWNERSHIP-E-CONTRATOS.md)                       | ownership e contratos canônicos de topo                        |
| 9C    | [`R-07C-FRONTEIRAS-E-COMPATIBILIDADE-RESIDUAL.md`](./R-07C-FRONTEIRAS-E-COMPATIBILIDADE-RESIDUAL.md)           | fronteiras por camada e compatibilidade residual               |
| 9D    | [`R-07D-GATES-SUITES-E-RISCO-OPERACIONAL.md`](./R-07D-GATES-SUITES-E-RISCO-OPERACIONAL.md)                     | gates, suites mínimas e baseline de risco                      |
| 10    | [`R-08-PROGRAMA-1-AGENT-CORE-E-LIFECYCLE.md`](./R-08-PROGRAMA-1-AGENT-CORE-E-LIFECYCLE.md)                     | programa principal do `agent/`                                 |
| 11    | [`R-09-PROGRAMA-2-SDK-E-FRONTEIRAS-DE-SESSAO.md`](./R-09-PROGRAMA-2-SDK-E-FRONTEIRAS-DE-SESSAO.md)             | stateless SDK e ownership de sessão                            |
| 12    | [`R-10-PROGRAMA-3-EVENTOS-HOOKS-E-OBSERVABILIDADE.md`](./R-10-PROGRAMA-3-EVENTOS-HOOKS-E-OBSERVABILIDADE.md)   | unificação de eventos, hooks e observabilidade                 |
| 13    | [`R-11-PROGRAMA-4-SERVER-TERMINAL-CHANNEL-E-HUB.md`](./R-11-PROGRAMA-4-SERVER-TERMINAL-CHANNEL-E-HUB.md)       | fronteiras de apresentação e orquestração                      |
| 13A   | [`R-11A-AUDITORIA-TERMINAL-E-FRONTEIRAS.md`](./R-11A-AUDITORIA-TERMINAL-E-FRONTEIRAS.md)                       | deep dive do terminal, seus acoplamentos e sua situação ideal  |
| 13B   | [`R-11B-TERMINAL-FRONTEND-PRINCIPAL.md`](./R-11B-TERMINAL-FRONTEND-PRINCIPAL.md)                               | papel do terminal como frontend principal da LLM-B             |
| 14    | [`R-12-PROGRAMA-5-TOOLS-CONFIG-CORE-INFRA-E-TYPES.md`](./R-12-PROGRAMA-5-TOOLS-CONFIG-CORE-INFRA-E-TYPES.md)   | camada de políticas, configuração, core e contratos            |
| 15    | [`R-13-PROGRAMA-6-SEGURANCA-QUALIDADE-E-GOVERNANCA.md`](./R-13-PROGRAMA-6-SEGURANCA-QUALIDADE-E-GOVERNANCA.md) | segurança, qualidade, testes, typing, docs e remoção de dívida |
| 16    | [`R-14-ANEXO-MAPEAMENTO-LEGADO-PARA-NOVO-PLANO.md`](./R-14-ANEXO-MAPEAMENTO-LEGADO-PARA-NOVO-PLANO.md)         | ponte entre a documentação antiga e a nova                     |
| 17    | [`R-15-BACKLOG-DE-CAPACIDADES-AVANCADAS.md`](./R-15-BACKLOG-DE-CAPACIDADES-AVANCADAS.md)                       | capacidades futuras, UX, RPC, TSServer e expansões             |

---

## Decisão de governança

A partir desta série:

1. **roadmap operacional** = `R-06` + `R-16` + programas `R-07` a `R-13`;
3. **arquitetura-alvo + critérios de convergência** = `R-04` + `R-04A` + `R-07B`–`R-07D`;
4. **diagnóstico base** = `R-01` a `R-05`;
5. **mapeamento histórico** = `R-14`;
6. **futuro opcional / pós-base saudável** = `R-15`.

---

## Snapshot-base usado nesta série

### `src/copilot/`

- **426 arquivos `.js`**
- **63.869 linhas**
- **22 diretórios top-level em disco / 20 com `.js`**

### `src/copilot/agent/`

- **62 arquivos `.js`**
- **8.327 linhas**
- maior hotspot do sistema atual

### Sinais fortes de acoplamento e drift

- **95** arquivos fora de `sdk/` importam `sdk` diretamente;
- **97** arquivos importam `observability` diretamente;
- **0** imports estruturais diretos de `server/` para `terminal/` permanecem após os slices de
  `presentation/`;
- **52** arquivos fora de `agent/` importam `agent/` diretamente;
- **733** referências a `EventBus` / emissão de eventos aparecem no recorte;
- `DOCUMENTAÇÃO/COPILOT/` contém **160 arquivos Markdown**, com alta fragmentação histórica.

### Materialização da Faixa A

P0 já deixou quatro artefatos canônicos diretamente acoplados ao hub:

- `R-07A` — tabela-base factual;
- `R-07B` — ownership e contratos de topo;
- `R-07C` — fronteiras por camada e compat residual;
- `R-07D` — gates, suites mínimas e baseline de risco.

Isso significa que a linha clean já não depende só de programa/roadmap; ela já tem baseline
operacional próprio.

---

## Resultado esperado desta linha clean

Ao final da execução orientada por estes documentos, o repositório deve ter:

- fronteiras arquiteturais mais explícitas;
- `agent/` e `sdk/` bem menos difusos;
- event model mais governável;
- server/terminal/channel/hub com ownership claro;
- segurança, testes e documentação operando como gates reais, não como pós-nota de rodapé.

> Critérios explícitos de convergência para esse alvo agora vivem em
> [`R-04A-ENDSTATE-E-CRITERIOS-DE-SUCESSO.md`](./R-04A-ENDSTATE-E-CRITERIOS-DE-SUCESSO.md).

---

## Nota prática

Este diretório foi desenhado para **planejamento profundo antes da próxima grande leva de mudanças
de código**. Ele não substitui os artefatos de implementação incremental já realizados, mas os
reorganiza em uma visão maior, mais limpa e mais sustentável.
