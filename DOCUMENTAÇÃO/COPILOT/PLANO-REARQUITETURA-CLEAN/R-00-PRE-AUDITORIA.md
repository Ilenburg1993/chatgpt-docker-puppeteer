# R-00 — Pré-Auditoria da Rearquitetura Clean de `src/copilot/`

**Data**: 2026-04-15
**Status**: concluída
**Papel**: documento de entrada metodológica e decisória da nova linha clean

---

## 1. Objetivo

Esta pré-auditoria existe para responder, antes de qualquer nova transformação grande, a quatro perguntas:

1. **Qual é o estado real atual** de `src/copilot/` e, especialmente, de `src/copilot/agent/`?
2. **Quanto da documentação atual ainda é operacionalmente útil** e quanto já virou material histórico fragmentado?
3. **Qual arquitetura-alvo faz sentido hoje**, à luz do baseline vivo de 2026-04-15, e não apenas do snapshot de março?
4. **Como reorganizar o backlog** em uma linha canônica, profunda e executável?

---

## 2. Fontes efetivamente consideradas

### 2.1 Código vivo

- árvore atual de `src/copilot/`
- árvore atual de `src/copilot/agent/`
- métricas de arquivos e LOC por subdiretório
- sinais de acoplamento via imports, references e hotspots estruturais

### 2.2 Documentação existente em `DOCUMENTAÇÃO/COPILOT/`

Foram consideradas, como base histórica e técnica:

- `PLANO-MIGRACAO/` (`M-00` a `M-07`)
- `AUDITORIA-SDK-COPILOT/`
- `AUDITORIA-DEEP-SRC-COPILOT/`
- `AUDITORIA-ARQUITETURAL/`
- `ROADMAP-UPGRADES-SRC-COPILOT.md`

### 2.3 Documentos de baseline diretamente reavaliados

- `PLANO-MIGRACAO/M-00-VISAO-GERAL.md`
- `PLANO-MIGRACAO/M-01-INVENTARIO-SITUACAO-ATUAL.md`
- `PLANO-MIGRACAO/M-03-FASE-AGENT-REFACTOR.md`
- `PLANO-MIGRACAO/M-03A-AUDITORIA-ARQUITETURAL-AGENT.md`
- `src/copilot/README.md`

---

## 3. Achados preliminares incontornáveis

### 3.1 Fragmentação documental

`DOCUMENTAÇÃO/COPILOT/` tem hoje **141 arquivos Markdown**.

Distribuição principal:

| Diretório                     |  MDs |
| ----------------------------- | ---: |
| `AUDITORIA-ARQUITETURAL/`     |  103 |
| `AUDITORIA-DEEP-SRC-COPILOT/` |   10 |
| `AUDITORIA-SDK-COPILOT/`      |   16 |
| `PLANO-MIGRACAO/`             |    9 |

### 3.2 Drift entre documentação e código

O drift é material, não cosmético.

Exemplos confirmados:

- `src/copilot/README.md` ainda descreve uma topologia mais antiga, com números de LOC e estruturas já superadas;
- o inventário histórico ainda fala em `api/` e `services/` como módulos ativos em tabelas antigas, embora já tenham sido removidos como diretórios centrais da arquitetura viva;
- `PLANO-MIGRACAO/` contém visão útil, mas já mistura:
  - backlog ainda válido;
  - itens já executados parcialmente;
  - suposições de março que hoje precisam de recalibração;
- `ROADMAP-UPGRADES-SRC-COPILOT.md` é útil, mas foca muito mais em terminal/UX/capacidades do que no fechamento arquitetural da base.

### 3.3 Estado real do código

#### `src/copilot/`

- **420 arquivos `.js`**
- **63.681 linhas**
- **18 módulos arquiteturais ativos**

#### `src/copilot/agent/`

- **62 arquivos `.js`**
- **8.248 linhas**
- maior módulo do recorte

### 3.4 Sinais numéricos de acoplamento

| Indicador                           | Valor |
| ----------------------------------- | ----: |
| imports de `sdk` fora de `sdk/`     |    96 |
| imports de `observability`          |    93 |
| imports de `agent` fora de `agent/` |    40 |
| imports `server → terminal`         |    11 |
| referências a EventBus / emissão    |   713 |
| arquivos com `@deprecated`          |    18 |
| marcadores `TODO/FIXME/HACK/XXX`    |    20 |
| `.catch(...)` silenciosos           |     8 |

---

## 4. Leitura preliminar da crise arquitetural

A pré-auditoria conclui que o problema de `src/copilot/` hoje não é um bug isolado, e sim uma soma de quatro tensões estruturais:

1. **módulos com ownership difuso**, especialmente `agent/`, `sdk/`, `observability/` e as bordas `server/ ↔ terminal/`;
2. **forte herança de compatibilidade**, com shims, barrels e bridges que já foram úteis, mas agora prolongam acoplamento;
3. **documentação muito rica, porém dispersa**, o que dificulta governança de backlog;
4. **mistura entre backlog estrutural e backlog de capabilities**, o que torna fácil pular para features antes de estabilizar a base.

---

## 5. Decisões metodológicas desta linha clean

### 5.1 Novo diretório canônico

Foi criada uma nova linha documental em:

- `DOCUMENTAÇÃO/COPILOT/PLANO-REARQUITETURA-CLEAN/`

Motivo: o material existente é valioso, mas está espalhado demais para continuar servindo como hub operacional sem overhead cognitivo desnecessário.

### 5.2 O acervo antigo vira fonte, não hub principal

As séries antigas continuam relevantes como:

- evidência;
- contexto histórico;
- catálogo de gaps;
- memória de decisões e execuções.

Mas a governança do próximo ciclo passa a ser centralizada nesta nova série.

### 5.3 Foco prioritário

O foco central da nova série será:

- `src/copilot/agent/` como epicentro do problema arquitetural atual;
- sua relação com `sdk/`, `events/`, `hooks/`, `observability/`, `server/`, `terminal/`, `channel/` e `conversation-hub/`;
- o backlog transversal necessário para fechar essas fronteiras com segurança.

### 5.4 Separação obrigatória entre base e futuro

A nova série separa explicitamente:

- **programas estruturais obrigatórios**;
- **programas de qualidade e governança**;
- **capacidades futuras / expansões**.

Isso evita que features apetitosas matem a disciplina arquitetural. Clássico problema de software adulto com alma de startup em sexta-feira à noite.

---

## 6. Diretrizes para a auditoria profunda

A auditoria profunda desta linha deve obedecer a estas diretrizes:

1. **usar o baseline vivo como verdade primária**;
2. **não duplicar o acervo antigo em bloco**, mas sintetizá-lo e mapeá-lo;
3. **focar ownership, fronteiras, contratos e acoplamento**, não só volume de LOC;
4. **tratar `agent/` como prioridade**, mas nunca isolado do resto de `src/copilot/`;
5. **converter backlog antigo em programas coerentes**, com fases e subfases acionáveis;
6. **registrar explicitamente o que é legado, o que é base atual e o que é target**;
7. **deixar critérios de aceitação claros**, para que o roadmap futuro não dependa de interpretação poética.

---

## 7. Deliverables exigidos por esta pré-auditoria

Com base nestas diretrizes, a auditoria profunda desta nova linha deve gerar:

1. resumo executivo da auditoria profunda;
2. mapa `as-is` de `src/copilot/`;
3. auditoria dedicada de `agent/` e integrações;
4. arquitetura-alvo revisada;
5. matriz de gaps e transformações;
6. roadmap master limpo;
7. programas detalhados por domínio;
8. anexo de mapeamento entre documentação antiga e nova;
9. backlog explícito de capacidades avançadas/pós-base.

---

## 8. Conclusão da pré-auditoria

A pré-auditoria conclui que **não basta continuar estendendo `PLANO-MIGRACAO/`**.

A próxima fase exige uma linha documental nova porque:

- o sistema evoluiu bastante desde o snapshot original;
- o backlog restante ficou maior, mais transversal e mais profundo;
- o `agent/` continua no centro do problema, mas já não é o único eixo crítico;
- há backlog suficiente acumulado em `server/`, `terminal/`, `channel/`, `observability/`, `sdk/`, `tools/` e `config/` para justificar um plano clean por programas.

Esta pré-auditoria, portanto, **autoriza e orienta** a criação da série `R-00` a `R-15` como nova referência operacional para a próxima grande etapa de rearquitetura de `src/copilot/`.
