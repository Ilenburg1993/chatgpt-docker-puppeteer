# Auditoria Consolidada — Módulo `{MÓDULO}/`

> Gerado como parte da Macro-Fase II do Copilot Full Audit.
> Plano: `DOCUMENTAÇÃO/AUDITORIAS/COPILOT-FULL-AUDIT-PLAN.md` v2.0
> Este documento é escrito APÓS todos os MDs individuais do módulo terem sido gerados.

---

## 1. Visão Geral do Módulo

| Campo                    | Valor                   |
| ------------------------ | ----------------------- |
| **Diretório**            | `src/copilot/{módulo}/` |
| **Arquivos**             | {N}                     |
| **LOC total**            | {N}                     |
| **Fase de análise**      | F{XX}                   |
| **Data de consolidação** | {YYYY-MM-DD}            |
| **Specs de teste**       | {N} specs, {N} casos    |
| **Prioridade de risco**  | 🔴/🟠/🟡/🟢                 |

---

## 2. Propósito e Papel Arquitetural

> Descrever em 3-8 frases: (a) qual é a responsabilidade do módulo dentro do sistema, (b) em qual
> camada arquitetural se situa (Infrastructure / Utilities / Observability / Domain Logic /
> Orchestration / Interface), (c) como ele se conecta com o restante do sistema.

{Descrição}

### Camada no modelo TO-BE

```
[Infrastructure] → [Utilities] → [Observability] → [Domain Logic] → [Orchestration] → [Interface]
                                                         ↑
                                                    {MÓDULO} (exemplo)
```

---

## 3. Mapa de Arquivos

| #   | Arquivo         | LOC | Responsabilidade  | Score Saúde | Achados |
| --- | --------------- | --- | ----------------- | ----------- | ------- |
| 1   | `{arquivo1}.js` | {N} | {descrição curta} | {0-10}      | {N}     |
| 2   | `{arquivo2}.js` | {N} | {descrição curta} | {0-10}      | {N}     |
| …   | …               | …   | …                 | …           | …       |

**Score médio de saúde do módulo**: {0-10}
**Arquivo mais saudável**: `{arquivo}` ({score})
**Arquivo mais problemático**: `{arquivo}` ({score})

---

## 4. Grafo de Dependências Internas

> Mapear como os arquivos do módulo se relacionam entre si.

```
{arquivo1}.js
    ├── imports → {arquivo2}.js
    ├── imports → {arquivo3}.js
    └── exports → usado por {arquivo4}.js

{arquivo2}.js
    └── imports → {arquivo5}.js (externo: #copilot/{outro_módulo})
```

### Dependência circular intra-módulo?

- {Sim/Não}: {detalhe se sim}

### Exports do barrel (`index.js`)

| Export re-exportado | Arquivo origem | Usado externamente? |
| ------------------- | -------------- | ------------------- |
| `{export1}`         | `{arquivo}.js` | ❌/✅                 |
| `{export2}`         | `{arquivo}.js` | ❌/✅                 |

**Barrel bypasses detectados**: {N} (imports que ignoram o `index.js`)

---

## 5. Interface Externa (Superfície do Módulo)

### 5.1 Quem importa DESTE módulo

| Módulo consumidor | Arquivos consumidores | Imports           |
| ----------------- | --------------------- | ----------------- |
| `{módulo_A}/`     | `{arquivo}.js`        | `{o que importa}` |
| `{módulo_B}/`     | `{arquivo}.js`        | `{o que importa}` |

**Total de consumidores externos**: {N} módulos, {N} arquivos

### 5.2 De quem ESTE módulo depende

| Módulo dependência | Arquivos deste módulo | Imports           |
| ------------------ | --------------------- | ----------------- |
| `{módulo_X}/`      | `{arquivo}.js`        | `{o que importa}` |
| (npm) `{pacote}`   | `{arquivo}.js`        | `{o que importa}` |

**Total de dependências**: {N} módulos internos, {N} pacotes npm

---

## 6. Padrões Arquiteturais Identificados

### 6.1 Padrões positivos

| Padrão                     | Onde             | Comentário      |
| -------------------------- | ---------------- | --------------- |
| {DI / Factory / Observer…} | `{arquivo}:L{N}` | {por que é bom} |

### 6.2 Anti-padrões

| Anti-padrão              | Onde             | Severidade | Proposta   |
| ------------------------ | ---------------- | ---------- | ---------- |
| {God object / Circular…} | `{arquivo}:L{N}` | P{0-4}     | {proposta} |

---

## 7. Consolidação de Achados

### 7.1 Sumário por tipo

| Tipo  | Count   | P0  | P1  | P2  | P3  | P4  |
| ----- | ------- | --- | --- | --- | --- | --- |
| BUG   | {N}     |     |     |     |     |     |
| RACE  | {N}     |     |     |     |     |     |
| LEAK  | {N}     |     |     |     |     |     |
| SEC   | {N}     |     |     |     |     |     |
| PERF  | {N}     |     |     |     |     |     |
| GAP   | {N}     |     |     |     |     |     |
| INC   | {N}     |     |     |     |     |     |
| DEAD  | {N}     |     |     |     |     |     |
| ARCH  | {N}     |     |     |     |     |     |
| TEST  | {N}     |     |     |     |     |     |
| TYPO  | {N}     |     |     |     |     |     |
| **∑** | **{N}** |     |     |     |     |     |

### 7.2 Lista completa de achados

> Todos os achados já foram detalhados nos MDs individuais. Aqui consolida-se a lista mestra do
> módulo com referência ao MD individual para detalhes.

| ID                   | Título         | Arquivo             | Sev  | Tipo | MD Individual                 |
| -------------------- | -------------- | ------------------- | ---- | ---- | ----------------------------- |
| `{TIPO}-{MÓD}-{SEQ}` | {título curto} | `{arquivo.js}#L{N}` | P{N} | {T}  | `{módulo}/{arquivo}-audit.md` |

### 7.3 Top-5 achados mais críticos

1. **`{ID}`** — {título}: {1 frase sobre impacto}
2. **`{ID}`** — {título}: {1 frase sobre impacto}
3. **`{ID}`** — {título}: {1 frase sobre impacto}
4. **`{ID}`** — {título}: {1 frase sobre impacto}
5. **`{ID}`** — {título}: {1 frase sobre impacto}

---

## 8. Consolidação de Upgrades

| ID                | Título         | Prioridade | Complexidade | Pré-requisitos   |
| ----------------- | -------------- | ---------- | ------------ | ---------------- |
| `UPG-{MÓD}-{SEQ}` | {título curto} | P{N}       | {B/M/A}      | {IDs de achados} |

---

## 9. Análise de Cobertura de Testes

### 9.1 Specs existentes

| Spec                                         | Casos | Cenários cobertos   |
| -------------------------------------------- | ----- | ------------------- |
| `tests/unit/copilot/{módulo}/{spec}.spec.js` | {N}   | {lista de cenários} |

### 9.2 Gaps de cobertura

| Arquivo sem cobertura | LOC | Cenários que faltam                    | Prioridade |
| --------------------- | --- | -------------------------------------- | ---------- |
| `{arquivo}.js`        | {N} | {cenários edge/error que não têm spec} | P{N}       |

### 9.3 Recomendações de testes prioritários

1. {Arquivo}: testar {cenário} — motivo: {justificativa}
2. {Arquivo}: testar {cenário} — motivo: {justificativa}
3. …

---

## 10. Segurança do Módulo

### 10.1 Superfície de ataque

| Vetor             | Exposto? | Mitigado? | Detalhes   |
| ----------------- | -------- | --------- | ---------- |
| User input direto | ❌/✅      | ❌/✅       | {detalhes} |
| File I/O          | ❌/✅      | ❌/✅       | {detalhes} |
| Shell execution   | ❌/✅      | ❌/✅       | {detalhes} |
| Network requests  | ❌/✅      | ❌/✅       | {detalhes} |
| SDK interactions  | ❌/✅      | ❌/✅       | {detalhes} |

### 10.2 Achados de segurança consolidados

{Referenciar os SEC-* do módulo}

---

## 11. Performance do Módulo

| Preocupação           | Count | Arquivos afetados | Severidade mais alta |
| --------------------- | ----- | ----------------- | -------------------- |
| Sync I/O              | {N}   | {lista}           | P{N}                 |
| Unbounded collections | {N}   | {lista}           | P{N}                 |
| Hot loops (O(n²)+)    | {N}   | {lista}           | P{N}                 |

---

## 12. Diagnóstico Arquitetural

### 12.1 Conformidade com camada esperada

| Critério                             | Status | Detalhes              |
| ------------------------------------ | ------ | --------------------- |
| Segue direção de imports da camada?  | ❌/✅    | {violações se houver} |
| Usa barrels consistentemente?        | ❌/✅    | {bypasses se houver}  |
| Sem dependência de SDK direto?       | ❌/✅    | {files se houver}     |
| Singletons com lifecycle gerenciado? | ❌/✅    | {sem reset/dispose?}  |
| Maps/Sets com TTL?                   | ❌/✅    | {sem TTL?}            |

### 12.2 Mapeamento no Delta AS-IS → TO-BE

| Transformação do plano            | Aplicável a este módulo? | Estado atual |
| --------------------------------- | ------------------------ | ------------ |
| T1: Logger abstraction layer      | ❌/✅                      | {estado}     |
| T2: SDK accessor centralization   | ❌/✅                      | {estado}     |
| T3: Event bus unification         | ❌/✅                      | {estado}     |
| T4: Barrel-only imports           | ❌/✅                      | {estado}     |
| T5: core/ independence            | ❌/✅                      | {estado}     |
| T6: Circular dep resolution       | ❌/✅                      | {estado}     |
| T7: Singleton lifecycle           | ❌/✅                      | {estado}     |
| T8: Map TTL/eviction              | ❌/✅                      | {estado}     |
| T9: Observability as pure utility | ❌/✅                      | {estado}     |

---

## 13. Pontuação de Saúde do Módulo

| Dimensão            | Score (0-10) | Justificativa                                |
| ------------------- | ------------ | -------------------------------------------- |
| Contratos (tipos)   | {0-10}       | {justificativa curta}                        |
| Error handling      | {0-10}       | {justificativa curta}                        |
| Segurança           | {0-10}       | {justificativa curta}                        |
| Performance         | {0-10}       | {justificativa curta}                        |
| Testabilidade       | {0-10}       | {justificativa curta}                        |
| Manutenibilidade    | {0-10}       | {justificativa curta}                        |
| Arquitetura         | {0-10}       | {justificativa curta}                        |
| **Média ponderada** | **{0-10}**   | **(tipos×2 + sec×2 + arch×2 + rest×1) / 10** |

---

## 14. Roadmap de Ações para o Módulo

| Prioridade | ID(s)             | Ação          | Esforço estimado |
| ---------- | ----------------- | ------------- | ---------------- |
| P0         | `{ID}`            | {o que fazer} | {S/M/L}          |
| P1         | `{ID1}`, `{ID2}`  | {o que fazer} | {S/M/L}          |
| P2         | `{ID}`            | {o que fazer} | {S/M/L}          |
| UPG        | `UPG-{MÓD}-{SEQ}` | {o que fazer} | {S/M/L}          |

---

## 15. Resumo Executivo

> 5-10 frases sumarizando: (a) estado geral de saúde do módulo, (b) top 3 problemas, (c)
> recomendação principal, (d) urgência de ação.

{Resumo executivo}

---

## 16. Referências aos MDs Individuais

| #   | Arquivo analisado | MD Individual                                        | Score |
| --- | ----------------- | ---------------------------------------------------- | ----- |
| 1   | `{arquivo1}.js`   | `COPILOT-AUDIT-REPORTS/{módulo}/{arquivo1}-audit.md` | {N}   |
| 2   | `{arquivo2}.js`   | `COPILOT-AUDIT-REPORTS/{módulo}/{arquivo2}-audit.md` | {N}   |
| …   | …                 | …                                                    | …     |

---

*Gerado por copilot-full-audit skill v2.0 — Consolidação do módulo `{módulo}/`*
