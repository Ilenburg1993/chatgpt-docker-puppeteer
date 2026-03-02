---
name: semantic-logic-audit
user-invokable: true
description: >-
  Skill para auditoria profunda de lógica e semântica: verifica se o código faz o que deveria fazer,
  independente de sintaxe, padrões ou lint. Lê código com profundidade para detectar bugs de lógica,
  condições invertidas, invariantes violados, fluxos de estado quebrados e gaps entre intenção e
  implementação. Use quando quiser saber se o código FUNCIONA CORRETAMENTE, não apenas se está bem
  escrito.
---

# semantic-logic-audit

## Overview

Esta skill é fundamentalmente diferente das demais. Enquanto `code-audit-and-fix`,
`exploratory-bug-hunt` e `reactive-bug-audit` dependem de **padrões grep** (timer leaks,
addEventListener, parseInt sem radix etc.), a `semantic-logic-audit` exige **leitura profunda** do
código para entender o que ele deve fazer e verificar se realmente faz.

> **Regra de ouro**: nenhuma ferramenta automatizada consegue encontrar os bugs cobertos por esta
> skill. Apenas uma LLM lendo o código com atenção semântica completa pode identificá-los.

### Tipos de bug descobertos por esta skill (não encontrados por grep)

- **Lógica de threshold nunca alcançada** (e.g. dedup key bloqueia contagem)
- **Estado terminal incorreto** (e.g. task chega em `status=DONE` quando deveria ser `FAILED`)
- **Operação assíncrona que parece funcionar mas ignora o resultado** (void que deveria awaitar)
- **Condição de guarda que protege o caso errado** (guard inverted, dead branch)
- **Contagem que nunca incrementa** porque a chave de deduplicação impede inserção
- **Retry infinito** porque o critério de saída nunca é satisfeito
- **Invariante de estado violado** (task em stage X com status Y que não deveria acontecer)
- **Callback que nunca é invocado** porque o evento não corresponde ao listener
- **Resultado de função ignorado** quando o chamador esperava uma transformação
- **Comparação com valor errado** (off-by-one em índice, `>=` vs `>`, `<` vs `<=`)
- **Branch de erro que silencia falha real** (catch que deveria relançar, não absorver)
- **Estado persistido antes de operação crítica** (dados inconsistentes se operação falhar)
- **Contrato entre módulos violado** (produtor produz formato X, consumidor espera formato Y)

## When To Use

- Quando se quer verificar se um fluxo completo (início ao fim) funciona como esperado.
- Quando bugs "difíceis" podem existir — os que passam em lint, tests e code review.
- Quando há comportamento estranho em produção sem stack trace óbvio.
- Após implementar uma feature nova de orquestração, estado ou retry.
- Periodicamente para sistemas de missão crítica (task queues, state machines, workflows).

## When Not To Use

- **Não** usar para encontrar bugs de padrão (use `code-audit-and-fix` ou `exploratory-bug-hunt`).
- **Não** usar sem delimitar claramente o escopo — leitura profunda exige foco.
- **Não** usar se o objetivo é apenas melhorar estilo/formatação.

## Inputs / Preconditions

- Escopo: módulo, fluxo ou caminho de execução específico (e.g. "fluxo completo de tasks")
- Documentação do objetivo do sistema (README, ARCHITECTURE.md, comentários de intenção)
- Baseline de testes: `npm run test:unit` passando antes de qualquer mudança

## Workflow de Auditoria Semântica

### Fase 1 — Entender o Objetivo do Sistema (ANTES de ler o código)

Esta é a fase mais importante e mais ignorada. Sem entender o OBJETIVO, não é possível verificar se
o código o cumpre.

**Perguntas obrigatórias antes de ler o código:**

1. **O que este sistema faz?** Em uma frase: qual é o valor entregue para o usuário/operador?
2. **Quais são os invariantes críticos?** O que NUNCA pode acontecer?
   - Ex: "uma task jamais deve ficar em DONE se não passou na validação"
   - Ex: "um lock jamais deve ser mantido se o processamento falhou"
3. **Quais são os estados terminais corretos?** Para cada resultado possível, qual estado é
   esperado?
4. **Quais são os contratos entre módulos?** O que o produtor garante? O que o consumidor espera?
5. **Qual é o caminho feliz?** Trace-o mentalmente antes de olhar o código.
6. **Quais são os caminhos de erro?** Como o sistema deve se comportar em cada falha?

**Fontes para responder essas perguntas:**

```
DOCUMENTAÇÃO/ARQUITETURA/ARCHITECTURE.md
README.md, CLAUDE.MD
Comentários de intenção no início dos módulos (JSDoc @description)
Nomes de constantes (TASK_STAGES, TASK_STATUSES, EVENT_TYPES)
Testes de integração/e2e existentes
```

### Fase 2 — Mapear o Fluxo Completo (Trace Mental)

Com o objetivo em mente, trace o fluxo completo **sem executar o código**:

1. **Identificar o ponto de entrada**: onde o fluxo começa? (API, fila, evento, cron)
2. **Seguir cada ramificação**: para cada `if/else`, o que acontece em cada branch?
3. **Verificar as transições de estado**: cada mudança de estado é consistente com o objetivo?
4. **Identificar pontos de falha**: onde o fluxo pode se perder? O que acontece então?
5. **Verificar loops e recursão**: quando terminam? Há casos de loop infinito?

**Ferramenta de rastreamento — criar mapa mental de estados:**

```
Estado A → [condição X] → Estado B (✓ correto?)
Estado A → [condição Y] → Estado C (✓ correto?)
Estado B → [falha Z]  → Estado D (✓ correto?) ou Estado A (ciclo esperado?)
```

### Fase 3 — Leitura Profunda por Módulo (SEM grep — ler o arquivo inteiro)

Para cada módulo no escopo:

1. **Ler os comentários de intenção primeiro** (JSDoc @description, comentários de bloco)
2. **Ler a implementação com os olhos do revisor cético** — perguntar a cada linha:
   - "E se isso retornar null/undefined/false?"
   - "E se isso falhar na segunda vez, não na primeira?"
   - "Este valor realmente representa o que o nome sugere?"
   - "Esta condição sempre é verdadeira/falsa em algum cenário?"
   - "O resultado desta operação está sendo usado pelo chamador?"

3. **Perguntas específicas por tipo de construção:**

**Para funções de threshold/contagem:**

- A contagem pode ser bloqueada por deduplicação ou cache?
- A janela de tempo está sendo aplicada corretamente?
- O valor inicial é o esperado (0 vs null vs undefined)?
- O threshold usa `<` quando deveria usar `<=` (ou vice-versa)?

**Para state machines (PENDING → RUNNING → DONE/FAILED):**

- Todos os caminhos de entrada em um estado também saem dele?
- Há estados terminais ambíguos (DONE quando deveria ser FAILED)?
- Uma transição de estado errada pode deixar o sistema em loop?
- Um estado intermediário pode se tornar terminal se uma operação falhar?

**Para deduplicação e idempotência:**

- A dedup key é suficientemente granular para o caso de uso?
- A dedup key impede eventos DIFERENTES de serem registrados?
- A dedup previne operação necessária de ser executada múltiplas vezes (correto)?
- Ou a dedup previne eventos de monitoramento de serem registrados cada vez (errado)?

**Para locking e concorrência:**

- O lock é liberado em TODOS os caminhos de saída (incluindo exceções)?
- O lock é adquirido antes de verificar a pré-condição que o lock deveria proteger?
- O lock TTL é compatível com o tempo máximo da operação?
- Há janelas onde dois workers podem processar o mesmo item?

**Para retry e backoff:**

- A condição de parada do retry é alcançável?
- O backoff aumenta corretamente a cada tentativa?
- Retry + dedup podem criar situação onde o sistema fica "preso" sem progredir?
- O número máximo de tentativas é checado ANTES ou DEPOIS de tentar?

**Para persistência e atomicidade:**

- Estado parcial é persistido antes de uma operação crítica que pode falhar?
- Se a operação crítica falhar, o estado parcial persiste e cria inconsistência?
- Transações de DB são usadas quando múltiplas escritas devem ser atômicas?

**Para comunicação assíncrona (eventos/NERV):**

- O listener está registrado ANTES de o evento poder ser emitido?
- O evento emitido tem o mesmo formato que o listener espera?
- Eventos "stale" (atrasados) são descartados corretamente?
- O callback é invocado apenas quando o evento correto chega?

### Fase 4 — Verificar Contratos entre Módulos

Para cada interface entre módulos no escopo:

1. **Produtor**: o que este módulo produz? (tipo de dados, campos obrigatórios, semântica dos
   valores)
2. **Consumidor**: o que este módulo espera? (mesmo tipo? mesmo campo? mesma semântica?)
3. **Gaps**: há campos produzidos que o consumidor ignora? Campos esperados que o produtor não
   fornece?

Especialmente verificar:

- Funções que retornam `true/false` vs funções que retornam `{success: bool}` — chamadores
  confundem?
- Funções que lançam exceção vs funções que retornam null — chamadores tratam ambos?
- Formatos de ID (string vs number) — conversões implícitas criam bugs?

### Fase 5 — Confirmar Cada Bug com Evidência Concreta

**Nunca reportar um bug sem:**

1. **Citar o arquivo e linha exata** onde o bug ocorre
2. **Descrever o cenário reproduzível**: "quando X acontece, Y deveria ocorrer mas Z ocorre"
3. **Rastrear o fluxo completo** que leva ao estado incorreto (trace step-by-step)
4. **Verificar se não há outro código** que "conserta" o problema downstream

### Fase 6 — Aplicar Correções Cirúrgicas

Para cada bug confirmado:

1. Aplicar a mudança **mínima** que corrige o comportamento sem alterar o que funciona
2. Verificar que a correção não quebra outros invariantes
3. Rodar `npm run test:unit` após cada grupo de correções
4. Rodar `npm run lint` para verificar estilo

**Critério de mínima mudança:** prefira adicionar uma linha a refatorar um método. Prefira mudar um
parâmetro a reestruturar a lógica. Só refatore se a refatoração é necessária para corrigir o bug.

### Fase 7 — Documentar Relatório de Auditoria

Criar relatório em `DOCUMENTAÇÃO/AUDITORIAS/` com:

- **Objetivo do sistema** (como entendido)
- **Invariantes identificados**
- **Bugs encontrados** (com evidência, trace e correção aplicada)
- **Áreas sem bugs** (confirmar explicitamente o que foi verificado e está OK)
- **Lacunas na cobertura** (o que não foi verificado e por quê)

## Checklist de Semântica Rápida

Use como checklist mental ao ler cada módulo:

| Categoria           | Pergunta                                                                 |
| ------------------- | ------------------------------------------------------------------------ |
| **Threshold**       | A contagem pode ser zerada/bloqueada por dedup ou cache?                 |
| **Estado terminal** | O estado final reflete o resultado real (DONE vs FAILED)?                |
| **Loop de saída**   | O critério de parada do loop/retry é sempre alcançável?                  |
| **Lock**            | O lock é liberado em TODOS os caminhos, incluindo exceções?              |
| **Dedup**           | A dedup key impede evento necessário de ser registrado múltiplas vezes?  |
| **Comparação**      | A comparação usa `>=` onde deveria usar `>` (ou vice-versa)?             |
| **Resultado**       | O resultado de funções críticas está sendo verificado/usado?             |
| **Contrato**        | O que o produtor envia tem exatamente o formato que o consumidor espera? |
| **Persistência**    | Estado parcial persiste se a operação crítica falhar?                    |
| **Evento**          | O listener está registrado antes do evento poder ser emitido?            |

## Guardrails

- **NUNCA fazer grep como substituto para leitura** — grep não vê semântica.
- **NUNCA reportar bug sem evidência de fluxo completo** — um trecho de código fora de contexto pode
  parecer bugado mas estar correto.
- **NUNCA confundir "código feio" com "código com bug"** — o objetivo é funcionalidade, não estilo.
- **SEMPRE ler o chamador** antes de julgar a função chamada — o bug pode estar no chamador.
- **SEMPRE verificar se downstream "conserta" o problema** antes de reportar como bug.

## Validation / Done Criteria

- Objetivo do sistema documentado e compreendido.
- Fluxo completo rastreado (happy path + error paths).
- Bugs ALTO/MÉDIO corrigidos com correção mínima.
- `npm run test:unit`: sem regressões.
- `npm run lint`: sem novos warnings.
- Relatório de auditoria em `DOCUMENTAÇÃO/AUDITORIAS/` com evidências.

## Diferença desta skill vs as demais

| Skill                      | Abordagem            | O que encontra                                               |
| -------------------------- | -------------------- | ------------------------------------------------------------ |
| `exploratory-bug-hunt`     | grep-first + padrões | Timers sem clear, parseInt sem radix, TODOs                  |
| `code-audit-and-fix`       | grep + patches       | Padrões estruturais + aplicação de correções                 |
| `reactive-bug-audit`       | parte de sintoma     | Causa raiz de bug já observado                               |
| **`semantic-logic-audit`** | **leitura profunda** | **Lógica incorreta, invariantes violados, fluxos quebrados** |

## Related Skills

- `code-audit-and-fix` — complementar para bugs de padrão pós-auditoria semântica.
- `reactive-bug-audit` — quando há sintoma concreto para investigar.
- `audit-proposal-deep-triage` — para proposta P0/P1 após descoberta crítica.
- `performance-audit` — foco em performance após verificar correção.
