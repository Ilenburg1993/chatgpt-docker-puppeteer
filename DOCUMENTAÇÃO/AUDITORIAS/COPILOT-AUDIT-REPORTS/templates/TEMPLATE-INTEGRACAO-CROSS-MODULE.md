# Análise de Integração — {NOME DO FLUXO}

> Gerado como parte da Macro-Fase III do Copilot Full Audit. Plano:
> `DOCUMENTAÇÃO/AUDITORIAS/COPILOT-FULL-AUDIT-PLAN.md` v2.0

---

## 1. Identificação

| Campo                  | Valor                                       |
| ---------------------- | ------------------------------------------- |
| **Fluxo**              | {Nome descritivo do fluxo end-to-end}       |
| **Fase**               | F{XX}                                       |
| **Data de análise**    | {YYYY-MM-DD}                                |
| **Módulos envolvidos** | {lista de módulos}                          |
| **Arquivos-chave**     | {lista de arquivos que participam do fluxo} |

---

## 2. Descrição do Fluxo

> Descrever em 5-10 frases: (a) o que este fluxo faz, (b) quando é ativado, (c) qual o resultado
> esperado, (d) quais módulos participam e em que ordem.

{Descrição}

---

## 3. Diagrama de Sequência

```
[Componente A] --evento/call--> [Componente B] --evento/call--> [Componente C]
      |                              |                              |
      |<------resposta/evento--------|                              |
      |                              |<------resposta/evento--------|
```

> Usar formato ASCII art detalhado mostrando o data flow principal com:
>
> - Setas indicando direção
> - Labels com nome do método/evento
> - Notas inline para transformações de dados

---

## 4. Data Flow (rastreamento de dados)

### 4.1 Ponto de entrada

| Origem           | Tipo de dado       | Shape/Schema                     |
| ---------------- | ------------------ | -------------------------------- |
| `{arquivo}:L{N}` | {evento/call/HTTP} | `{ campo1: tipo, campo2: tipo }` |

### 4.2 Transformações ao longo do fluxo

| Passo | Arquivo              | Função/Handler | Input shape   | Output shape  | Transformação         |
| ----- | -------------------- | -------------- | ------------- | ------------- | --------------------- |
| 1     | `{arquivo1}.js:L{N}` | `{fn1}()`      | `{ a, b }`    | `{ a, b, c }` | Enriquece com `c`     |
| 2     | `{arquivo2}.js:L{N}` | `{fn2}()`      | `{ a, b, c }` | `{ d, e }`    | Projeta para `d`, `e` |
| …     | …                    | …              | …             | …             | …                     |

### 4.3 Ponto de saída / consumo final

| Destino          | Tipo de consumo  | Shape final        |
| ---------------- | ---------------- | ------------------ |
| `{arquivo}:L{N}` | {REST/SSE/store} | `{ campo1: tipo }` |

### 4.4 Verificação de consistência

| Verificação                                         | Status | Detalhes   |
| --------------------------------------------------- | ------ | ---------- |
| Shapes compatíveis entre produtor e consumidor?     | ❌/✅  | {detalhes} |
| Campos opcionais tratados em todos os consumidores? | ❌/✅  | {detalhes} |
| Tipos alinhados (number vs string, etc.)?           | ❌/✅  | {detalhes} |

---

## 5. Event Flow (rastreamento de eventos)

### 5.1 Eventos emitidos

| Evento             | Emissor        | Linha | Payload shape     |
| ------------------ | -------------- | ----- | ----------------- |
| `{nome.do.evento}` | `{arquivo}.js` | L{N}  | `{ campo: tipo }` |

### 5.2 Eventos consumidos

| Evento             | Consumer       | Linha | Handler  |
| ------------------ | -------------- | ----- | -------- |
| `{nome.do.evento}` | `{arquivo}.js` | L{N}  | `{fn}()` |

### 5.3 Verificação de completude

| Verificação                                    | Status | Detalhes   |
| ---------------------------------------------- | ------ | ---------- |
| Todo evento emitido tem pelo menos 1 consumer? | ❌/✅  | {detalhes} |
| Handlers recebem o payload shape correto?      | ❌/✅  | {detalhes} |
| Deduplicação: mesmo evento processado 2x?      | ❌/✅  | {detalhes} |
| Ordenação: eventos chegam na ordem esperada?   | ❌/✅  | {detalhes} |

---

## 6. Error Flow (rastreamento de erros)

### 6.1 Pontos de falha

| Ponto de falha | Arquivo             | Tipo de erro | Tratamento          |
| -------------- | ------------------- | ------------ | ------------------- |
| {descrição}    | `{arquivo}.js:L{N}` | {tipo}       | {catch/rethrow/log} |

### 6.2 Propagação de erros

```
[Erro em A:L{N}] → catch em A → {transforma/rethrow} → catch em B → {log/user feedback}
```

### 6.3 Verificação de robustez

| Verificação                                    | Status | Detalhes   |
| ---------------------------------------------- | ------ | ---------- |
| Erros no ponto A chegam ao consumidor final?   | ❌/✅  | {detalhes} |
| Erros são transformados adequadamente?         | ❌/✅  | {detalhes} |
| Cleanup ocorre em todos os pontos de falha?    | ❌/✅  | {detalhes} |
| Erros silenciados indevidamente (catch vazio)? | ❌/✅  | {detalhes} |
| Stack trace preservado?                        | ❌/✅  | {detalhes} |

---

## 7. Resource Lifecycle

| Recurso                 | Criado em           | Liberado em         | Lifecycle correto? |
| ----------------------- | ------------------- | ------------------- | ------------------ |
| {timer/listener/handle} | `{arquivo}.js:L{N}` | `{arquivo}.js:L{M}` | ❌/✅              |

---

## 8. Contract Alignment (entre módulos)

| Interface         | Módulo A (provê)          | Módulo B (consome)        | Alinhado? | Divergências   |
| ----------------- | ------------------------- | ------------------------- | --------- | -------------- |
| `{fn/type/event}` | `{módulo_A}/{arquivo}.js` | `{módulo_B}/{arquivo}.js` | ❌/✅     | {divergências} |

---

## 9. Concorrência e Order of Operations

| Cenário                           | Risco   | Mitigação          | Status |
| --------------------------------- | ------- | ------------------ | ------ |
| {2 chamadas simultâneas ao fluxo} | {A/M/B} | {mutex/lock/none}  | ❌/✅  |
| {evento chega antes de init}      | {A/M/B} | {guard/queue/none} | ❌/✅  |

---

## 10. Achados de Integração

> Achados que SÓ são visíveis quando se analisa o fluxo cross-module. Achados por arquivo já estão
> nos MDs individuais.

### INTG-{ID} — {Título}

- **Severidade**: P{0-4}
- **Módulos envolvidos**: {lista}
- **Detalhamento**: {Descrição técnica detalhada}
- **Cenário de manifestação**: {Quando e como o problema se manifesta}
- **Proposta de correção**: {Estratégia, envolvendo quais arquivos}
- **Impacto se não corrigido**: {Consequência}

<!-- Repetir bloco para cada achado de integração -->

---

## 11. Recomendações

### 11.1 Correções prioritárias

| Prioridade | ID(s) | Ação recomendada | Complexidade |
| ---------- | ----- | ---------------- | ------------ |
| P0         | {ID}  | {ação}           | {S/M/L}      |
| P1         | {ID}  | {ação}           | {S/M/L}      |

### 11.2 Melhorias estruturais

| Melhoria                | Módulos afetados | Complexidade | Delta TO-BE          |
| ----------------------- | ---------------- | ------------ | -------------------- |
| {descrição da melhoria} | {lista}          | {S/M/L}      | {transformação T{N}} |

---

## 12. Resumo Executivo

> 5-10 frases sumarizando: (a) saúde geral do fluxo, (b) pontos mais frágeis, (c) recomendação
> principal, (d) urgência.

{Resumo executivo}

---

_Gerado por copilot-full-audit skill v2.0 — Integração F{XX}_
