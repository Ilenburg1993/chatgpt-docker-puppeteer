# 13 — `terminal/` como UX Humana e Consumidor do Runtime

**Status**: auditoria ativa **Última atualização**: 2026-04-27 **Escopo desta etapa**:
`src/copilot/terminal/` como borda humana da LLM-B, REPL operacional, renderização local e
consumidor do runtime via `presentation/` e `agent/`.

---

## 1. Objetivo deste documento

Este documento audita o papel do `terminal/` no sistema Copilot.

A pergunta central é:

> **o terminal está funcionando como UX humana sobre o runtime, ou ainda carrega semântica demais
> que deveria pertencer a `presentation/`, `agent/` ou `sdk/`?**

Essa pergunta importa porque a borda humana costuma ser o lugar onde a arquitetura sofre mais
pressão por conveniência:

- render e UX demandam decisões rápidas;
- operador quer comandos ricos;
- muita informação converge para o REPL;
- borda local tende a acumular exceções “só aqui”.

---

## 2. Base factual utilizada nesta etapa

A análise se apoia em:

- `src/copilot/terminal/README.md`
- `src/copilot/terminal/index.js`
- `src/copilot/terminal/bootstrap.js`
- `src/copilot/terminal/frontend/llm-b-runtime.js`
- documentação anterior desta auditoria (`05`–`12`)

---

## 3. Tese arquitetural declarada para `terminal/`

## 3.1 Tese canônica

A documentação atual define o terminal como:

- borda humana local da LLM-B;
- frontend operacional do runtime contínuo;
- lugar de REPL, render, waiting UX, comandos e SSE local.

Também afirma algo crucial:

> o terminal **não** deve implementar versões paralelas do SDK.

E mais:

- deve consumir `agent/` para lifecycle e estado;
- deve consumir `presentation/agent-runtime.js` como accessor compartilhado do runtime;
- deve consumir `sdk/` como fonte canônica do vanilla;
- deve concentrar em `frontend/` a camada de consumo do runtime;
- deve deixar em `dialog/` a camada de render/prompt/espera/envio.

---

## 4. O que `terminal/` parece fazer corretamente hoje

## 4.1 `terminal/bootstrap.js` é entrypoint fino

Ele apenas:

- registra sinais mínimos de shutdown da borda terminal;
- chama `bootCopilot()`;
- trata erro fatal.

### Diagnóstico

Excelente. Não há sinal de que a borda esteja tentando se tornar root do runtime por esse arquivo.

## 4.2 `terminal/index.js` é host humano, não root do runtime

O arquivo orquestra:

- aliases;
- wiring do runtime via dependency injection;
- pinned files loader;
- conversation hub local;
- servidor HTTP canônico;
- listeners do agent;
- reflection loop;
- REPL.

### Diagnóstico

É muito poder, mas um poder coerente com o papel de host da borda humana.

### Ponto de atenção

Esse tipo de arquivo sempre corre risco de acúmulo excessivo. Ainda assim, a autoridade dele como
host humano parece legítima.

## 4.3 `frontend/llm-b-runtime.js` já consome `presentation/` corretamente

Esse arquivo é um dos sinais arquiteturais mais fortes de evolução positiva.

Ele consome de `presentation/`:

- runtime controls;
- runtime overview;
- runtime SDK session projections;
- handoff history;
- state snapshots;
- runtime selection.

### Diagnóstico

Isso confirma algo importante:

> o terminal já está deixando de reabrir a topologia do runtime em múltiplos pontos e está passando
> a consumi-la via uma camada compartilhada.

Este é exatamente o comportamento arquitetural desejado.

---

## 5. O papel ideal do terminal na arquitetura

## 5.1 O que é responsabilidade legítima do terminal

`terminal/` deve responder:

> **como o operador humano interage localmente com o runtime Copilot?**

Isso inclui:

- REPL;
- parsing de comandos;
- prompt dinâmico;
- waiting UX;
- render incremental;
- narrativa operacional local;
- SSE local e feedback para operador;
- boot da experiência terminal;
- wiring da atividade do terminal.

## 5.2 O que não é responsabilidade legítima do terminal

`terminal/` não deveria ser owner de:

- capacidade vanilla do SDK;
- contrato compartilhado de selection/targeting;
- payloads compartilhados com `server/`;
- lifecycle do runtime como source-of-truth;
- semântica de health/status já compartilhável.

---

## 6. Fronteiras críticas de `terminal/`

## 6.1 `terminal/` vs `presentation/`

### Situação atual

A documentação e o frontend concreto já mostram a direção correta:

- `presentation/` fornece accessors/projections compartilhadas;
- `terminal/` consome e transforma isso em UX humana.

### Diagnóstico

Essa é a fronteira mais importante para manter o terminal saudável.

### Situação ideal

- `presentation/` responde “de onde vem a verdade consumida pela borda?”;
- `terminal/` responde “como isso vira experiência humana local?”.

## 6.2 `terminal/` vs `agent/`

### Situação atual

Historicamente, a borda terminal teria motivos para falar diretamente com o runtime. A arquitetura
atual está tentando reduzir isso com `presentation/` e façades.

### Diagnóstico

O risco residual ainda existe: terminal é um lugar muito tentador para colocar chamadas diretas ao
agente quando se quer “só resolver um comando”.

### Situação ideal

O terminal fala com o runtime por:

- `presentation/` quando a semântica é compartilhável;
- façades públicas quando a operação é inerentemente runtime-facing.

## 6.3 `terminal/` vs `sdk/`

### Situação atual

O terminal usa o SDK como fonte canônica de conceitos vanilla, especialmente em surfaces como
`mode/plan`, `session.ui.*`, models/tools, etc.

### Diagnóstico

Isso é correto, desde que a borda continue **observando e ampliando** o vanilla, e não recriando-o.

## 6.4 `terminal/` vs `server/`

### Situação atual

A arquitetura busca impedir acoplamentos do tipo:

- `server` importando semântica do `terminal`;
- `terminal` servindo de owner compartilhado de payloads HTTP.

### Situação ideal

Ambos devem se encontrar via:

- `presentation/`;
- `agent/` façades;
- `conversation-hub/` quando aplicável;
- eventos e observabilidade estabilizados.

---

## 7. Riscos estruturais específicos de `terminal/`

## 7.1 Borda humana virar "owner de exceções"

Esse é o risco estrutural número um.

### Sinal de regressão

Sempre que surgir um caso especial, a solução mais fácil costuma ser “coloca no terminal”.

Isso pode fazer a borda carregar:

- policy;
- targeting;
- projections compartilhadas;
- parsing canônico que deveria ser multiplataforma;
- semântica de domínio que não é apenas humana.

## 7.2 `terminal/index.js` crescer como host totalizante

O arquivo já concentra muita coisa legítima.

### Risco

Com o tempo, ele pode virar local de qualquer bootstrap secundário da UX, watchers, jobs e wiring
adicional.

### Regra proposta

Todo novo comportamento no terminal host deve responder:

1. isso é realmente comportamento da borda humana?
2. isso é compartilhável com outras bordas?
3. isso deveria subir para `presentation/`?

## 7.3 `frontend/` virar runtime paralelo

`frontend/llm-b-runtime.js` é muito poderoso e útil.

### Risco

Com o tempo, a camada de consumo pode começar a concentrar muita semântica própria em vez de apenas
organizar consumo e projection.

### Situação ideal

`frontend/` continua sendo consumer layer, não owner do runtime.

---

## 8. Situação ideal TO-BE para `terminal/`

## 8.1 Missão ideal consolidada

`src/copilot/terminal/` deve ser o módulo que responde:

> **como a verdade do runtime e do vanilla do SDK aparece para um operador humano local em forma de
> REPL, render, comandos, feedback, waiting UX e narrativa operacional?**

## 8.2 Responsabilidades legítimas

- entrypoint do terminal;
- host da borda humana;
- boot da UX local;
- commands REPL;
- render e prompt;
- SSE/local feedback ao operador;
- listeners de runtime especificamente voltados à experiência humana.

## 8.3 Responsabilidades ilegítimas

- owner de capabilities vanilla;
- owner do targeting canônico compartilhado;
- owner de payload HTTP compartilhado;
- source-of-truth do runtime;
- owner de eventos canônicos do sistema.

---

## 9. Decisões preliminares desta etapa

1. **`terminal/` parece hoje muito mais saudável do que a média de bordas REPL em sistemas desse
   tipo**.
2. **A presença de `presentation/` e do frontend consumindo projections compartilhadas é um dos
   sinais mais fortes de maturidade recente do subsistema**.
3. **O risco principal permanece sendo acúmulo excessivo de exceções na borda humana**.
4. **`terminal/index.js` deve continuar sendo tratado como host da UX humana, mas com vigilância de
   crescimento**.
5. **`frontend/` deve permanecer como camada de consumo do runtime, não runtime paralelo**.

---

## 10. Conclusão desta etapa

A conclusão principal é positiva e importante:

> `terminal/` já não parece um lugar onde o sistema “se resolve sozinho no improviso”; ele parece,
> cada vez mais, uma borda humana consumindo corretamente camadas inferiores.

Esse é um avanço grande.

A tarefa futura aqui não é inventar um novo terminal; é preservar a clareza da divisão:

- `sdk/` define o vanilla;
- `agent/` governa o runtime;
- `presentation/` compartilha accessors e projections;
- `terminal/` transforma isso em experiência humana local.

Com isso, a próxima frente natural da auditoria é voltar aos subsistemas de estado e persistência,
principalmente:

- `14-CONVERSATION-HUB-E-PERSISTENCIA.md`
- `15-TOOLS-E-EXECUCAO-OPERACIONAL.md`
