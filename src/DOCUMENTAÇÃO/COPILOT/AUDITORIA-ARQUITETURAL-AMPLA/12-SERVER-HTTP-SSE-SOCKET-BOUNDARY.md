# 12 — `server/` como Borda HTTP/SSE/Socket do Runtime Copilot

**Status**: auditoria ativa **Última atualização**: 2026-04-27 **Escopo desta etapa**:
`src/copilot/server/` como superfície externa HTTP/SSE/Socket do runtime Copilot local.

---

## 1. Objetivo deste documento

Este documento audita o papel de `server/` como borda externa do runtime.

A pergunta central é:

> **`server/` está funcionando como adapter de protocolo puro, ou ainda corre o risco de se tornar
> um segundo owner do runtime?**

Essa distinção é crítica. Em arquiteturas desse tipo, o servidor HTTP frequentemente se torna um
concorrente do runtime por três razões:

- precisa responder rápido e tende a “pegar atalhos” na topologia interna;
- centraliza muitas rotas e pode começar a reinterpretar contratos locais;
- convive com SSE/Socket e com isso pode acabar criando sua própria semântica de eventos.

---

## 2. Base factual utilizada nesta etapa

A análise se apoia em:

- `src/copilot/server/index.js`
- `src/copilot/server/router.js`
- documentação anterior desta auditoria (`05`–`11`)

Observação factual importante: não há README local de `server/` disponível no mesmo padrão de alguns
outros módulos, então esta etapa depende mais diretamente da leitura dos arquivos de entrada do
subsystem.

---

## 3. Tese arquitetural atual para `server/`

## 3.1 Tese observada em código

`server/index.js` declara explicitamente que:

- é o owner do servidor HTTP/Socket.IO do Copilot local;
- **não** inicia REPL;
- **não** inicia runtime agent sozinho;
- é composto pelo boot canônico via `terminal/index.js`.

### Diagnóstico

Essa declaração já é, por si só, um excelente sinal de maturidade arquitetural.

Ela deixa claro que `server/` é:

- uma borda,
- não um root de runtime.

## 3.2 Tese observada em `router.js`

`router.js` também reforça essa posição:

- centraliza mounting dos routers;
- separa auth-exempt e rotas autenticadas;
- monta vários routers especializados;
- condicionalmente monta a API `/sdk` quando habilitada.

### Diagnóstico

Isso mostra que `server/` está sendo usado como:

- **surface protocol layer**;
- **composition point de routers**;
- não como owner da semântica profunda do sistema.

---

## 4. O que `server/` parece fazer corretamente hoje

## 4.1 `server/index.js` é um host HTTP limpo

Ele cuida de:

- app Express;
- error handler do app;
- criação do `http.Server`;
- criação opcional de Socket.IO;
- graceful shutdown;
- retorno de uma interface `CopilotServer` clara (`app`, `httpServer`, `io`, `url`, `close`).

### Diagnóstico

Esse tipo de foco é o comportamento esperado de um host HTTP.

## 4.2 `router.js` centraliza a superfície de rotas

Ao montar explicitamente:

- agent,
- config,
- memory,
- observability,
- git,
- sse,
- sessions,
- copilot-api,
- webhooks,
- sdk,

`server/router.js` evita que o app Express se torne um agregado caótico de mounts espalhados.

### Diagnóstico

A centralização de rotas é boa, desde que não passe a centralizar também semântica do runtime.

## 4.3 Integração condicional com a superfície `/sdk`

A presença de `createSdkRouter()` condicionada por `COPILOT_SDK_ENABLED` é um sinal importante.

### Diagnóstico

Isso mostra que `server/` é capaz de expor o layer SDK sem transformar o servidor em owner do SDK.

A borda apenas monta a surface quando habilitada.

---

## 5. Papel ideal de `server/` dentro da arquitetura geral

## 5.1 `server/` como adaptador de protocolo

Idealmente, `server/` deve responder a esta pergunta:

> **como o runtime Copilot é exposto via HTTP/SSE/Socket de forma segura, estável e desacoplada do
> seu núcleo?**

Isso significa que `server/` deve possuir legitimamente:

- protocolos;
- middleware;
- auth;
- rate limiting e guards HTTP quando aplicável;
- montagem de routers;
- SSE endpoints;
- socket namespace / gateway;
- error mapping HTTP-safe.

## 5.2 O que `server/` não deve possuir

`server/` não deve ser dono de:

- lifecycle do runtime;
- session source-of-truth;
- semântica vanilla do SDK;
- projections que já são compartilhadas com o terminal;
- composição DI do runtime.

---

## 6. Fronteiras críticas de `server/`

## 6.1 `server/` vs `presentation/`

### Situação atual

A direção do sistema é clara:

- `presentation/` deve concentrar accessors, projections e deps compartilhadas;
- `server/` deve consumi-las.

### Diagnóstico

Essa é a fronteira mais importante para manter `server/` saudável.

### Situação ideal

`server/` monta protocolos e routers, enquanto `presentation/` resolve:

- runtime targeting;
- deps compartilhadas;
- projections reutilizáveis;
- error mapping shared quando couber.

## 6.2 `server/` vs `agent/`

### Situação atual

`server/` expõe capabilities do runtime, mas não deveria conhecer o runtime tão profundamente quanto
`agent/`.

### Risco

Cada nova rota pode ser tentada a acessar diretamente:

- `getAgent()`;
- registry;
- `AgentContext` shapes;
- SDK handles;
- semântica de status e ownership.

### Situação ideal

`server/` fala com `agent/` pela superfície pública apropriada:

- façades;
- `presentation/`;
- accessors de runtime;
- projections compartilhadas.

## 6.3 `server/` vs `sdk/`

### Situação atual

A rota `/sdk` já existe como adapter HTTP para capacidades da camada `sdk/`.

### Diagnóstico

Esse é um uso saudável da borda HTTP: expor contracts já definidos em L1.

### Situação ideal

- `sdk/` define a capability;
- `server/` a expõe por protocolo;
- `server/` não reinventa a semântica da capability.

## 6.4 `server/` vs `terminal/`

### Situação atual

A arquitetura atual já trabalha contra a ideia errada de `server/` importar `terminal/` como owner
compartilhado de semântica.

### Situação ideal

A comunicação compartilhada deve acontecer via:

- `presentation/`;
- `agent/` façades;
- `conversation-hub/` quando aplicável;
- `observability/` para sinais observáveis.

---

## 7. Riscos estruturais específicos de `server/`

## 7.1 Router sprawl

Com tantas rotas montadas, o risco de expansão orgânica é grande.

### Sinal de regressão

- cada router passa a montar sua própria semântica de runtime;
- cada rota escolhe seu próprio parsing de `runtimeId`;
- cada handler inventa payloads de status/health por conta própria.

### Regra proposta

Todo router novo deve responder:

1. usa deps de `presentation/` quando a semântica for compartilhável?
2. evita reabrir topologia interna do runtime?
3. expõe protocolo, e não ownership?

## 7.2 SSE/Socket como tradutores paralelos de eventos

SSE e Socket são candidatos naturais a drift de evento.

### Risco

A borda de streaming pode começar a reinterpretar o sistema de eventos em vez de apenas projetá-lo.

### Situação ideal

- `event-handlers/` traduzem;
- `agent/` orquestra;
- `presentation/` projeta quando necessário;
- `server/` transmite com contrato estável.

## 7.3 HTTP-safe error mapping espalhado

Se o mapeamento `Error -> HTTP` viver espalhado por rotas, o servidor vira owner acidental de policy
semântica.

### Situação ideal

Concentrar mapping compartilhado em `presentation/agent-http-errors.js` ou camadas semelhantes.

---

## 8. Situação ideal TO-BE para `server/`

## 8.1 Missão ideal consolidada

`src/copilot/server/` deve ser o módulo que responde:

> **como o runtime Copilot é exposto por protocolos externos sem que a borda se torne dona do
> sistema?**

## 8.2 Responsabilidades legítimas

- Express app;
- routers;
- auth/middleware;
- SSE/Socket namespace e wiring de protocolo;
- error handling de borda;
- lifecycle do próprio servidor (`close()`, graceful shutdown).

## 8.3 Responsabilidades ilegítimas

- lifecycle do agent;
- composition root do runtime;
- semântica vanilla do SDK;
- source-of-truth de projections compartilhadas;
- state store do runtime.

---

## 9. Decisões preliminares desta etapa

1. **`server/` parece hoje conceitualmente saudável como host HTTP/Socket**.
2. **A principal fronteira a proteger é `server/` vs `presentation/`**.
3. **A surface `/sdk` é um bom exemplo de exposição de capability pela borda sem deslocar o owner da
   semântica**.
4. **O grande risco futuro é crescimento orgânico de routers reabrindo o runtime por conveniência**.
5. **Toda nova rota deveria ser tratada como problema de protocolo e projection, não de ownership do
   runtime**.

---

## 10. Conclusão desta etapa

A conclusão principal é positiva:

> `server/` já se parece mais com uma borda de protocolo bem comportada do que com um segundo núcleo
> do sistema.

Isso é excelente.

Mas o perigo de regressão continua alto, porque bordas HTTP são sempre pressionadas a resolver tudo
rápido, e isso costuma incentivar atalhos arquiteturais.

A defesa correta para essa pasta é:

- reforçar `presentation/`;
- manter façades públicas fortes em `agent/`;
- manter `sdk/` como owner do vanilla;
- tratar cada router novo como ponto potencial de regressão de boundary.

A próxima etapa natural é auditar a outra borda principal do sistema:

- `13-TERMINAL-UX-E-CONSUMO-DO-RUNTIME.md`
