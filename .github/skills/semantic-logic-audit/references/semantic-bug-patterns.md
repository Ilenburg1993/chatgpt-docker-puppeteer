# Referência: Padrões de Bugs Semânticos

Este documento cataloga padrões de bugs semânticos reais encontrados em sistemas de produção. Use
como inspiração durante a fase de leitura profunda da `semantic-logic-audit`.

---

## Categoria 1: Deduplicação que Impede Monitoramento

### Padrão

Um sistema de threshold/alerta usa `recordEvent` com `dedupKey` para registrar ocorrências, mas
depois conta esses eventos para decidir se o threshold foi atingido.

### Por que falha

`INSERT OR IGNORE` (ou equivalente) silencia duplicatas sem erro. A contagem nunca passa de 1 por
`(taskId, attemptId)`, mas o threshold pode ser 3. O threshold **nunca é alcançado**.

### Sintoma em produção

Tarefa fica em loop infinito sendo "processada" a cada tick sem progredir nem ser bloqueada.

### Fix canônico

Remover `dedupKey` de eventos de monitoramento (contagem). Usar `dedupKey` apenas para eventos que
devem ser idempotentes (ex: `TASK_DISPATCHED`, `TASK_COMPLETED`).

```javascript
// ANTES (bug): dedup impede contagem
recordEvent({ ..., dedupKey: `task:${taskId}:output_missing:${attemptId}` });
const count = db.prepare('SELECT COUNT(*) FROM events WHERE ...').get()?.c;
if (count >= threshold) block();  // count sempre <= 1

// DEPOIS (correto): sem dedup para eventos de contagem
recordEvent({ ..., dedupKey: null });  // cada ocorrência conta
const count = db.prepare('SELECT COUNT(*) FROM events WHERE ...').get()?.c;
if (count >= threshold) block();  // count cresce corretamente
```

---

## Categoria 2: Estado Terminal Ambíguo

### Padrão

Uma state machine tem estados `DONE` e `FAILED`. Quando uma operação "completa" mas sem atender
critérios de qualidade, o sistema usa `DONE` em vez de `FAILED`.

### Por que falha

Downstream (usuário, dashboard, relatórios) interpreta `DONE = sucesso`. Mas o item falhou no
critério de qualidade. A inconsistência cria confusão operacional.

### Sintoma

Tarefas aparecem como "concluídas" no dashboard mas os resultados são de baixa qualidade sem que
ninguém saiba que era esperado falhar.

### Fix canônico

Garantir que todos os terminais de "falha sem retry possível" resultem em `FAILED`:

- Max retries atingido sem sucesso → `FAILED`
- Max iterations sem passar validação → `FAILED`
- Timeout total excedido → `FAILED`

```javascript
// ANTES (bug): max iterations não marca como FAILED
if (nextIteration >= maxIterations) {
  recordEvent({ eventType: 'MAX_ITERATIONS_REACHED' });
  return; // task fica DONE, mas não passou validação
}

// DEPOIS (correto): max iterations sem passar = FAILED
if (nextIteration >= maxIterations) {
  updateTask(taskId, { status: 'FAILED', last_error: 'MAX_ITERATIONS_WITHOUT_PASSING' });
  recordEvent({ eventType: 'TASK_FAILED_MAX_ITERATIONS' });
  return;
}
```

---

## Categoria 3: Retry infinito por critério inalcançável

### Padrão

Um sistema de retry tem condição de saída que nunca é satisfeita em cenários de falha real.

### Por que falha

A condição de bloqueio depende de um contador que nunca incrementa (ver Categoria 1), ou a condição
usa `>` onde deveria usar `>=`, ou o estado é resetado antes da verificação.

### Fix canônico

Verificar que cada iteração do loop avança o estado de forma que o critério de saída seja alcançável
em N iterações finitas.

---

## Categoria 4: Persistência antes de operação crítica

### Padrão

O sistema persiste estado intermediário ANTES de uma operação crítica que pode falhar. Se a operação
crítica falhar, o estado intermediário persiste e cria inconsistência.

### Por que falha

```javascript
// Persiste attempt_id antes de criar o attempt
updateTask(taskId, { latest_attempt_id: correlationId });  // ← persiste
upsertAttempt({ id: correlationId, ... });  // ← pode falhar!
// Se falhar: latest_attempt_id aponta para attempt que não existe
```

### Fix canônico

Criar o objeto dependente ANTES de atualizar a referência:

```javascript
upsertAttempt({ id: correlationId, ... });  // ← cria primeiro
updateTask(taskId, { latest_attempt_id: correlationId });  // ← atualiza referência
```

---

## Categoria 5: Listener registrado depois que evento pode ser emitido

### Padrão

Sistema registra listener para evento, mas o evento pode ser emitido antes do listener ser
registrado (race condition de inicialização).

### Por que falha

Em sistemas assíncronos com inicialização parcial, componentes podem emitir eventos antes que todos
os listeners estejam prontos. O evento é perdido.

### Fix canônico

Garantir que listeners são registrados antes de qualquer operação que pode emitir eventos. Ou usar
padrão de "replay" onde eventos são buffered até listeners serem registrados.

---

## Categoria 6: Comparação com operador errado (off-by-one)

### Padrão

`if (currentAttempts >= maxAttempts)` vs `if (currentAttempts > maxAttempts)`. Um usa `>=`, outro
usa `>`. A semântica correta depende de se `currentAttempts` é contado ANTES ou DEPOIS do attempt
atual.

### Fix canônico

Documentar explicitamente a semântica do contador e verificar o operador correto para cada uso. Se
`attempts` = tentativas JÁ realizadas, então `>= maxAttempts` é correto.

---

## Categoria 7: Função que retorna resultado ignorado

### Padrão

```javascript
const items = results.map((item) => processItem(item)); // processItem pode retornar null
// caller usa items sem verificar nulls
items.forEach((item) => item.save()); // TypeError: Cannot read property 'save' of null
```

### Fix canônico

Filtrar nulls após map: `results.map(...).filter(Boolean)`. Ou verificar que `processItem` nunca
retorna null quando o caller não espera.

---

## Ferramenta: Template de Trace de Fluxo

Use para rastrear fluxo mentalmente:

```
FLUXO: [nome do fluxo]
OBJETIVO: [o que o fluxo deve realizar]

ENTRADA:
  - [campo1]: [tipo] [invariante]
  - [campo2]: [tipo] [invariante]

ESTADOS POSSÍVEIS:
  [ESTADO_A] → (condição X) → [ESTADO_B]
             → (condição Y) → [ESTADO_C]
  [ESTADO_B] → (sucesso)   → [DONE] ← Terminal correto?
             → (falha)     → [FAILED] ← Terminal correto?
  [ESTADO_C] → (retry)     → [ESTADO_A] ← Loop finito?

INVARIANTES VERIFICADOS:
  □ Lock liberado em todos os caminhos?
  □ Estado terminal correto para cada resultado?
  □ Threshold alcançável?
  □ Contagem não bloqueada por dedup?
  □ Dados persists em ordem correta?
```
