# Auditoria Individual — `{MÓDULO}/{ARQUIVO}.js`

> Gerado como parte da Macro-Fase II do Copilot Full Audit.
> Plano: `DOCUMENTAÇÃO/AUDITORIAS/COPILOT-FULL-AUDIT-PLAN.md` v2.0

---

## 1. Identificação

| Campo               | Valor                               |
| ------------------- | ----------------------------------- |
| **Arquivo**         | `src/copilot/{módulo}/{arquivo}.js` |
| **Módulo**          | `{módulo}/`                         |
| **LOC**             | {N}                                 |
| **Fase**            | F{XX}-{YY}                          |
| **Data de leitura** | {YYYY-MM-DD}                        |
| **Releitura?**      | Sim (MF-I + MF-II)                  |

---

## 2. Propósito e Responsabilidade

> Descrever em 2-5 frases o que este arquivo faz, qual sua razão de existir, e qual módulo/camada
> ele serve.

{Descrição do propósito do arquivo}

---

## 3. API Pública (Exports)

| Export          | Tipo     | Descrição curta    |
| --------------- | -------- | ------------------ |
| `{nomeExport1}` | function | {O que faz}        |
| `{nomeExport2}` | class    | {O que faz}        |
| `{CONSTANTE}`   | const    | {O que representa} |
| `{TypedefName}` | @typedef | {Shape dos dados}  |

**Total de exports**: {N}
**Exports consumidos externamente**: {N} (verificar com `rg 'import.*{export}' src/copilot/`)
**Exports possivelmente dead**: {lista ou "nenhum"}

---

## 4. Dependências (Imports)

### 4.1 Imports internos (`#copilot/` ou relativos)

| Import                    | Via barrel? | Módulo origem  |
| ------------------------- | ----------- | -------------- |
| `#copilot/{módulo}/{sub}` | ❌/✅         | {módulo}       |
| `../{relativo}`           | N/A         | {mesmo módulo} |

### 4.2 Imports externos (npm)

| Pacote                | Uso         |
| --------------------- | ----------- |
| `@github/copilot-sdk` | {o que usa} |
| `express`             | {o que usa} |

### 4.3 Diagnóstico de imports

- **Barrel bypasses**: {N} (listar quais)
- **SDK direto**: {Sim/Não} — deveria usar façade `lib/sdk-client.js`?
- **Violação de camada**: {Sim/Não} — {detalhe se sim}
- **Circular potencial**: {Sim/Não}

---

## 5. Estado Interno

### 5.1 Variáveis de módulo (module-level)

| Variável | Tipo      | Mutable? | TTL/Cleanup? | Risco          |
| -------- | --------- | -------- | ------------ | -------------- |
| `_var1`  | let/const | Sim/Não  | Sim/Não      | {leak/race/ok} |
| `_cache` | Map       | Sim      | {TTL ou não} | {leak/ok}      |

### 5.2 Singletons

| Singleton    | Factory com reset? | Symbol.dispose? | Testabilidade |
| ------------ | ------------------ | --------------- | ------------- |
| `{instance}` | ❌/✅                | ❌/✅             | {boa/ruim}    |

### 5.3 Timers e Listeners

| Recurso         | Tipo     | Cleanup registrado? | Onde?   |
| --------------- | -------- | ------------------- | ------- |
| `setInterval()` | timer    | {Sim/Não}           | {linha} |
| `emitter.on()`  | listener | {Sim/Não}           | {linha} |

---

## 6. Análise de Contratos

### 6.1 Contratos de entrada (parâmetros)

| Função/Método | Param     | Tipo esperado | Validação? | Default seguro? |
| ------------- | --------- | ------------- | ---------- | --------------- |
| `{fn1}`       | `{param}` | `{type}`      | ❌/✅        | ❌/✅             |

### 6.2 Contratos de saída (retornos)

| Função/Método | Return type | Nullable? | Error propagation     |
| ------------- | ----------- | --------- | --------------------- |
| `{fn1}`       | `{type}`    | ❌/✅       | throws / returns null |

### 6.3 JSDoc completeness

| Critério                       | Status |
| ------------------------------ | ------ |
| Todos os exports têm JSDoc?    | ❌/✅    |
| @param com tipo explícito?     | ❌/✅    |
| @returns com tipo explícito?   | ❌/✅    |
| @throws documentado?           | ❌/✅    |
| @example em funções complexas? | ❌/✅    |
| Typedefs completos e corretos? | ❌/✅    |

---

## 7. Error Handling

| Função/Método | try/catch? | finally? | Error transformado? | Propagado? |
| ------------- | ---------- | -------- | ------------------- | ---------- |
| `{fn1}`       | ❌/✅        | ❌/✅      | ❌/✅                 | ❌/✅        |

**Padrão dominante**: {catch-and-log / rethrow / swallow / transform}
**Comentário**: {análise de adequação}

---

## 8. Segurança

| Vetor               | Aplicável? | Mitigado? | Detalhes   |
| ------------------- | ---------- | --------- | ---------- |
| Injection (SQL/cmd) | ❌/✅        | ❌/✅       | {detalhes} |
| Path traversal      | ❌/✅        | ❌/✅       | {detalhes} |
| SSRF                | ❌/✅        | ❌/✅       | {detalhes} |
| Secrets exposure    | ❌/✅        | ❌/✅       | {detalhes} |
| Prompt injection    | ❌/✅        | ❌/✅       | {detalhes} |
| Auth bypass         | ❌/✅        | ❌/✅       | {detalhes} |

---

## 9. Concorrência e Race Conditions

| Cenário                         | Risco          | Mitigação existente |
| ------------------------------- | -------------- | ------------------- |
| {cenário de acesso concorrente} | {alto/med/low} | {mutex/lock/none}   |

---

## 10. Performance

| Preocupação                      | Severidade | Detalhes            |
| -------------------------------- | ---------- | ------------------- |
| Sync I/O (`readFileSync` etc.)   | {P0-P4}    | {linhas e contexto} |
| Unbounded growth (Map/Set/Array) | {P0-P4}    | {linhas e contexto} |
| Hot loop / O(n²) ou pior         | {P0-P4}    | {linhas e contexto} |
| Allocations desnecessárias       | {P0-P4}    | {linhas e contexto} |

---

## 11. Achados (Questões Formais)

> Cada questão usa o formato `{TIPO}-{MÓD}-{SEQ}` conforme tipologia do plano.

### {TIPO}-{MÓD}-{SEQ} — {Título curto}

- **Severidade**: P{0-4}
- **Arquivo**: `src/copilot/{módulo}/{arquivo}.js`#L{N}-L{M}
- **Descrição**: {Explicação técnica detalhada}
- **Cenário de manifestação**: {Quando e como o problema se manifesta}
- **Proposta de correção**: {Código ou estratégia sugerida}
- **Impacto se não corrigido**: {Consequência}
- **Referência arquitetural**: {Delta AS-IS→TO-BE relacionado, se aplicável}

<!-- Repetir bloco para cada achado -->

---

## 12. Upgrades Propostos

### UPG-{MÓD}-{SEQ} — {Título}

- **Prioridade**: P{1-4}
- **Motivação**: {Por que vale a pena}
- **Implementação proposta**: {Estratégia}
- **Trade-offs**: {O que se ganha vs o que se perde}
- **Complexidade estimada**: {Baixa/Média/Alta}
- **Pré-requisitos**: {Outros achados que devem ser resolvidos primeiro}

<!-- Repetir bloco para cada upgrade -->

---

## 13. Cobertura de Testes

| Critério                      | Status                              |
| ----------------------------- | ----------------------------------- |
| Existe spec dedicado?         | ❌/✅                                 |
| Arquivo do spec               | `tests/unit/copilot/{spec}.spec.js` |
| Cenários cobertos             | {lista ou "N/A"}                    |
| Cenários edge NÃO cobertos    | {lista}                             |
| Cenários de erro NÃO cobertos | {lista}                             |

---

## 14. Pontuação de Saúde

| Dimensão            | Score (0-10) | Justificativa                      |
| ------------------- | ------------ | ---------------------------------- |
| Contratos (tipos)   | {0-10}       | {justificativa curta}              |
| Error handling      | {0-10}       | {justificativa curta}              |
| Segurança           | {0-10}       | {justificativa curta}              |
| Performance         | {0-10}       | {justificativa curta}              |
| Testabilidade       | {0-10}       | {justificativa curta}              |
| Manutenibilidade    | {0-10}       | {justificativa curta}              |
| **Média ponderada** | **{0-10}**   | **(tipos×2 + sec×2 + rest×1) / 8** |

---

## 15. Resumo Executivo

> 3-5 frases sumarizando o estado geral do arquivo, principais achados, e recomendação.

{Resumo executivo}

---

*Gerado por copilot-full-audit skill v2.0 — Fase F{XX}-{YY}*
