# Auditoria — Dialog Loop e Input Humano Concorrente

Data: 2026-05-08  
Escopo: `src/copilot/terminal`, `src/copilot/presentation/runtime/dialog.js` e
`src/copilot/agent/dialog`.

## Objetivo

Avaliar o que acontece quando o usuário humano envia input no terminal enquanto a LLM-B já está
processando outro turno, usando tools, aguardando o SDK, renderizando streaming ou esperando
`ask_user`.

O princípio aplicado é: o terminal pode enfileirar turnos humanos, mas respostas a perguntas vivas
do modelo não podem ficar presas atrás do turno que está aguardando essa resposta.

## Situação AS-IS encontrada

O dialog loop interno já possui serialização canônica via `DialogLoopManager -> TurnQueue`. Esse
ponto está correto: a LLM-B não deve receber turnos concorrentes no mesmo canal `ask_user`.

O problema estava na borda REPL: `repl/repl-lifecycle.js` também serializava todas as linhas em
`lineQueue` e fazia `await sendTurn(...)` dentro do processamento da linha. Isso criava uma segunda
fila anterior ao dialog loop.

Essa fila anterior gerava três efeitos ruins:

1. mensagens normais digitadas durante um turno só eram percebidas depois do turno terminar;
2. comandos observacionais como `/status` e `/now` ficavam presos atrás de um turno longo;
3. se a LLM-B chamasse `ask_user` real durante o turno, a resposta humana digitada no terminal
   ficava presa atrás do próprio `sendTurn()` que esperava essa resposta, causando risco de
   deadlock.

## Cenários avaliados

### 1. Humano envia nova mensagem enquanto a LLM-B está respondendo normalmente

Comportamento ideal: a mensagem deve ser aceita imediatamente, ganhar feedback visual e entrar na
fila canônica de turnos. Ela só deve ser executada quando o turno atual terminar.

Correção aplicada: o REPL não faz mais `await sendTurn()` para mensagens normais. Ele entrega a
mensagem ao `sendTurn()`, que usa a fila canônica do engine/dialog loop.

### 2. Humano responde a `ask_user` real enquanto a LLM-B está no meio de um turno

Comportamento ideal: a resposta deve furar a fila de turnos e ir direto para
`answerPendingQuestion()`, desde que a pergunta seja humana real (`kind=question`) e não protocolo
`READY/REPLY/STOPPED`.

Bug encontrado: a resposta ficava presa em `lineQueue`, atrás do turno que aguardava essa resposta.

Correção aplicada: antes de entrar na fila do REPL, linhas simples não-comando tentam
`tryAnswerTerminalPendingQuestionInput()`. Quando há pergunta real pendente, a resposta é roteada
imediatamente.

### 3. Humano digita comando crítico durante freeze ou turno longo

Comportamento ideal: `/quit`, `/restart` e reset emergencial precisam furar qualquer fila.

Estado atual: isso já existia parcialmente.

Correção aplicada: a policy foi extraída para `repl/repl-input-routing.js`, evitando lista inline e
tornando a decisão auditável.

### 4. Humano digita comando observacional durante turno longo

Comportamento ideal: comandos de leitura do estado operacional não devem esperar o turno acabar.

Correção aplicada: comandos como `/status`, `/now`, `/activity`, `/errors`, `/live`, `/usage`,
`/metrics`, `/tools`, `/menu`, `/answer`, `/elicitation` e `/permission` passaram a seguir caminho
imediato.

### 5. Attachments enquanto existem turnos enfileirados

Bug encontrado: attachments eram lidos da fila global só quando `_executeTurn()` começava. Se uma
mensagem fosse enfileirada e o humano alterasse `/attach` antes dela executar, os arquivos poderiam
ser associados ao turno errado.

Correção aplicada: `sendTurn()` agora captura e limpa a fila de attachments no momento do envio
humano. Cada turno carrega seu snapshot de attachments até ser executado.

### 6. Input multiline

Comportamento adotado: enquanto há buffer multiline local, o REPL preserva a composição do operador
e não tenta tratar a linha como resposta imediata a `ask_user`. O operador ainda pode usar `Ctrl+C`
para limpar o multiline.

## Situação ideal implementada

- A serialização real de turnos permanece no dialog loop (`DialogLoopManager/TurnQueue`).
- O REPL deixa de ser gargalo para mensagens normais.
- Respostas a `ask_user` real têm via imediata.
- Comandos críticos e observacionais têm policy explícita.
- Attachments pertencem ao turno no momento do envio, não ao momento futuro de execução.
- A profundidade de fila exposta por `terminal/dialog/index.js` reflete o engine carregado, em vez
  de retornar `0` estaticamente.

## Próximos riscos a observar

- Alguns comandos classificados como imediatos ainda podem ganhar subpolicies por efeito colateral
  se crescerem.
- O caminho multiline pode precisar de UX explícita quando uma pergunta real chega durante
  composição longa.
- A fila terminal (`MAX_TURN_QUEUE_SIZE`) ainda retorna `null` para rejeição; a UX agora avisa, mas
  uma futura melhoria pode retornar objeto estruturado.

## Rodada complementar — steer e interrupção

A investigação foi aprofundada em `2026-05-08-AUDITORIA-DIALOG-LOOP-STEER-E-INTERRUPCAO.md`.

Resultado aplicado: o canal principal `/inject` passou a aceitar `mode=queue|steer|interrupt`, e o
terminal ganhou comandos imediatos `/steer`, `/interrupt` e `/abort`. Com isso, a LLM-A e o humano
têm a mesma semântica canônica para “próximo turno”, “intervenção no turno atual” e “abort +
substituição”.

## Arquivos alterados nesta rodada

- `src/copilot/terminal/repl/repl-lifecycle.js`
- `src/copilot/terminal/repl/repl-input-routing.js`
- `src/copilot/presentation/agent-control.js`
- `src/copilot/channel/inject.js`
- `src/copilot/terminal/dialog/engine.js`
- `src/copilot/terminal/dialog/index.js`
- `src/copilot/terminal/module-map.js`
- `tests/unit/copilot/terminal/test_repl_input_routing.spec.js`
