# R-11 — Programa 4: `server/`, `terminal/`, `channel/` e `conversation-hub/`

**Programa**: P4
**Prioridade**: alta
**Foco**: limpar as bordas de apresentação e comunicação, reduzindo acoplamento entre API, terminal, canal e hub

**Documentos complementares**:

- [`R-11A-AUDITORIA-TERMINAL-E-FRONTEIRAS.md`](./R-11A-AUDITORIA-TERMINAL-E-FRONTEIRAS.md)
- [`R-11B-TERMINAL-FRONTEND-PRINCIPAL.md`](./R-11B-TERMINAL-FRONTEND-PRINCIPAL.md)

---

## 1. Objetivo

P4 existe para corrigir a principal tensão de borda do sistema atual:

- `server/` cresceu bastante;
- `terminal/` ganhou muitas capacidades;
- `channel/` é peça crítica na comunicação LLM-A ↔ LLM-B;
- `conversation-hub/` ainda pode assumir mais ownership;
- e essas quatro áreas continuam se tocando demais em alguns pontos.

---

## 2. Diagnóstico de partida

### Sinais atuais

- `server/` já soma **5.275L**;
- `terminal/` já soma **7.113L**;
- `terminal/` já acumula **47 arquivos `.js`**, sendo **23** em `commands/`, **6** em `handlers/` e **6** em `dialog/`;
- o recorte atual do terminal já tem **16** imports de `agent`, **12** de `conversation-hub`, **5** de `channel`, **12** de `observability` e **73** ocorrências de DI/container;
- `channel/` já é um contrato relevante, mas ainda subenquadrado no plano antigo;
- `conversation-hub/` continua importante para sessão conversacional, store e replay;
- **0 imports estruturais diretos** de `server` para `terminal` no runtime confirmam que a primeira metade da
	fronteira de presentation foi fechada: `server/` e `terminal/` já convergem para SSOTs em `presentation/`.

### Leitura específica do terminal

O `terminal/` já não é só um REPL:

- ele opera como UX local rica;
- expõe handlers HTTP reaproveitados pelo `server/`;
- concentra diagnóstico/health/metrics/history/session ops;
- embute wiring de agent, hub, channel e observability;
- e ainda carrega drift documental no próprio módulo.

Isso torna o terminal um dos principais eixos de fronteira do P4, não apenas um detalhe da UX.

### Situação ideal específica do terminal

Ao final do programa P4, o `terminal/` deve:

- ser dono da **UX local** (REPL, renderização, aliases, anexos, contexto de workspace, streaming local);
- operar explicitamente como o **frontend principal da LLM-B** para o usuário humano e para a LLM-A;
- consumir o mesmo conjunto de **contratos canônicos** de runtime que o `server/`, sem servir de pseudo-backend compartilhado;
- concentrar a composição de UX e runtime em `terminal/frontend/*`, em vez de espalhá-la por `commands/` e `dialog/`;
- ter `commands/` e `handlers/` mais finos, menos difusos e menos dependentes de DI espalhada;
- ter `dialog/` tratado como motor local de experiência e não como cola ad hoc de múltiplos domínios;
- manter backlog avançado em trilha separada, sem contaminar a fila estrutural.

---

## 3. Fases

## F4.1 — Desacoplamento `server ↔ terminal`

### Subfases

- F4.1.a — mapear todos os imports e contratos cruzados
- F4.1.b — separar handlers, projections e serviços reaproveitáveis
- F4.1.c — eliminar dependências diretas quando puderem virar contrato ou adapter
- F4.1.d — revisar health/status/diag expostos por ambos os lados

### Resultado esperado

`server/` e `terminal/` deixam de agir como parentes que dividem gaveta de meias.

## F4.2 — Consolidação de rotas, health e realtime

### Subfases

- F4.2.a — revisar organização de `server/routes/`
- F4.2.b — alinhar health endpoints e projections com contratos canônicos
- F4.2.c — limpar sobreposições entre HTTP, SSE e Socket
- F4.2.d — definir ownership de endpoints de runtime, sessão, tool stats e health

### Resultado esperado

API mais coesa e menos espalhada por remendos históricos.

## F4.3 — Fortalecimento de `channel/`

### Subfases

- F4.3.a — explicitar o contrato do canal LLM-A ↔ LLM-B
- F4.3.b — revisar retry, timeout, reconexão e structured response logic
- F4.3.c — alinhar uso do canal com terminal e runtime do agente
- F4.3.d — separar concerns de transporte, contexto e controle de turno

### Resultado esperado

`channel/` deixa de ser “um detalhe técnico útil” e vira uma peça arquitetural clara.

## F4.4 — Lifecycle do `conversation-hub`

### Subfases

- F4.4.a — definir ownership do hub sobre store, replay e sessão conversacional
- F4.4.b — revisar compaction, replay, cleanup e retenção
- F4.4.c — alinhar hub com nova fronteira de sessão do P2
- F4.4.d — reduzir difusão de responsabilidades com `agent/`

### Resultado esperado

`conversation-hub/` deixa de ser um subsistema bom, porém subaproveitado.

## F4.5 — Fronteiras operacionais do terminal

### Subfases

- F4.5.a — classificar todo o `terminal/` entre boot/wiring, REPL/commands, handlers HTTP, dialog engine, estado local e compatibilidade
- F4.5.b — separar o que é UX local do que é runtime/serviço reaproveitável
- F4.5.c — alinhar terminal com health, usage, history, diagnostics e session operations sem aumentar acoplamento
- F4.5.d — reduzir difusão de `container.resolve()` em comandos e handlers
- F4.5.e — atualizar a narrativa/documentação do módulo para a topologia real
- F4.5.f — consolidar `terminal/frontend/*` como consumer layer principal da LLM-B

### Resultado esperado

O terminal continua poderoso, mas sem sequestrar a arquitetura das bordas.

## F4.6 — Rearquitetura interna do `terminal/`

### Subfases

- F4.6.a — estabilizar `index.js`, `bootstrap.js`, `di-wiring.js` e `terminal-agent-wiring.js` como costuras de boot e wiring
- F4.6.b — reorganizar a superfície de `commands/` por domínio, reduzindo mistura entre UX local e acesso direto a runtime
- F4.6.c — tornar `handlers/` adapters HTTP finos, sem virar camada comum do `server/`
- F4.6.d — revisar `dialog/` como boundary próprio de streaming, turn execution e persistência local
- F4.6.e — consolidar `state.js`, `alias-store.js`, `file-context.js`, `workspace-context.js` e `rate-limiter-state.js` como núcleo legítimo de UX local

### Resultado esperado

O módulo terminal fica mais modular por dentro, sem perder a riqueza da superfície de uso.

## F4.7 — Extração de contratos compartilhados e saída do pseudo-backend

### Subfases

- F4.7.a — mapear tudo o que `server/` ainda importa de `terminal/`
- F4.7.b — extrair projections/serviços compartilhados para superfícies canônicas fora do `terminal/`
- F4.7.c — substituir imports `server → terminal` por contratos explícitos
- F4.7.d — manter apenas adapters transitórios rastreados, com prazo de remoção

### Resultado esperado

`server/` e `terminal/` passam a ser consumidores irmãos do runtime, em vez de uma borda depender estruturalmente da outra.

### Estado atual resumido de F4.7

Os cinco primeiros cortes práticos desta fase já entraram em código:

- foi criada a superfície compartilhada `src/copilot/presentation/system-config.js`;
- `server/routes/health.js` e `server/routes/config.js` deixaram de importar
	`terminal/handlers/system-config.js`;
- `terminal/handlers/system-config.js` passou a atuar como adapter fino/re-export.
- foi criada a superfície compartilhada `src/copilot/presentation/conversation-hub.js`;
- `server/routes/sessions.js`, `server/routes/memory.js` e a rota `/hub-health` deixaram de importar
	`terminal/handlers/dialog.js`;
- `terminal/handlers/dialog.js` passou a atuar como adapter fino/re-export.
- foi criada a superfície compartilhada `src/copilot/presentation/realtime.js`;
- `server/routes/sse.js` e `server/middleware/rate-limiter-state.js` deixaram de importar
	`terminal/dialog/sse.js` e `terminal/rate-limiter-state.js`;
- `terminal/dialog/sse.js` e `terminal/rate-limiter-state.js` passaram a atuar como adapters finos.
- foi criada a superfície compartilhada `src/copilot/presentation/system-metrics.js`;
- `server/routes/observability.js`, `server/routes/git.js` e o trecho de quota/pr-budget em
	`server/routes/agent.js` deixaram de importar `terminal/handlers/system-metrics.js`;
- `terminal/handlers/system-metrics.js` passou a atuar como adapter fino/re-export.
- foi criada a superfície compartilhada `src/copilot/presentation/agent-control.js`;
- `server/routes/agent.js` deixou de importar `terminal/handlers/agent.js`;
- `terminal/handlers/agent.js` passou a atuar como adapter fino/re-export.

Efeito medido no acoplamento:

- imports diretos `server → terminal` caíram de **11** para **0**.

Próxima fila recomendada de F4.7:

1. atacar a redução mais pesada de DI em `commands/`, `handlers/` e `dialog/`;
2. atualizar a narrativa/documentação do terminal;
3. ampliar contract tests do P4.

Primeiro subcorte desse próximo bloco: consolidar `terminal/frontend/*` como camada interna canônica para `/status`,
`/diagnose`, `/metrics`, `/usage` e flows de sessão, tornando o terminal explicitamente o frontend principal da LLM-B
sem reabrir imports estruturais `server → terminal`.

Esse subcorte já começou a entrar em código:

- surgiu `src/copilot/terminal/frontend/llm-b-frontend.js` como consumer layer principal da LLM-B dentro do terminal;
- `/status`, `/diagnose`, `/metrics`, `/usage` e os flows centrais de `commands/session.js` migraram para essa camada;
- `memory`, `resume` e `search` também já migraram para a mesma camada;
- `config`, `context` e `errors` também já migraram para a mesma camada;
- o `README.md` local do terminal foi alinhado para refletir `frontend/` como subdomínio explícito;
- surgiu `src/copilot/terminal/frontend/llm-b-runtime.js` como gateway runtime do terminal para `agent/`, `channel/` e `conversation-hub`;
- `repl.js`, `repl-listeners.js`, `dialog/output.js`, `dialog/engine.js`, `dialog/engine-persistence.js`, `terminal-agent-wiring.js` e `index.js` passaram a consumir esse gateway;
- o recorte de `container.resolve()` em `terminal/commands/` caiu de **22** para **0** ocorrências;
- o recorte total de `container.resolve()` em `src/copilot/terminal/` caiu para **2** ocorrências, com apenas **1** no runtime do módulo;
- validação focada mais recente do slice terminal-first: **44/44** testes verdes em `vitest`, **14/14** em `node:test` e **26/26** em `vitest` na rodada do gateway runtime.

Próxima fila recomendada de F4.7 agora:

1. seguir refinando `dialog/`, `repl.js` e `repl-listeners.js` agora em torno do gateway runtime já extraído;
2. ampliar contract tests do P4 para cobrir frontend principal + runtime gateway + adapters de borda;
3. seguir limpando backlog estrutural do terminal antes de capacidades avançadas.

### Modelo SSOT desejado para P4

Ao final desta fase, a borda de presentation deve seguir esta hierarquia simples:

- runtime truth em `agent/` e `conversation-hub/`;
- projections e handlers compartilhados em `presentation/`;
- adapters de `server/` e `terminal/` consumindo a mesma superfície compartilhada;
- zero imports estruturais `server → terminal` fora de adapters transitórios explicitamente rastreados.

### Regra de compatibilidade terminal ↔ `agent` ↔ SDK

P4 não deve amputar o papel do terminal como interface da LLM-B.

Portanto, o critério de compatibilidade fica explícito:

- `terminal/index.js`, `terminal/repl.js`, `terminal/repl-listeners.js`, `terminal-agent-wiring.js` e
	`terminal/dialog/engine.js` continuam sendo consumers legítimos de `agent/`, `channel/`,
	`conversation-hub/` e, quando necessário, de superfícies do SDK;
- o que sai do terminal para `presentation/` são apenas handlers, projections e contratos de borda que
	antes faziam o `server/` depender do módulo terminal;
- nenhuma extração de P4 deve substituir o runtime truth do `AlwaysAliveAgent` nem o wrapper do SDK.

Esse guardrail foi respeitado nos cinco slices já entregues: o terminal continua operando como interface da
LLM-B, enquanto `presentation/` virou apenas a SSOT compartilhada das superfícies de borda reutilizadas pelo server.

## F4.8 — Separação entre backlog estrutural e capabilities do terminal

### Subfases

- F4.8.a — reclassificar tudo o que é capability avançada de terminal para o backlog P7 quando não for base estrutural
- F4.8.b — preservar na fila ativa apenas itens que fecham ownership, contratos e fronteiras
- F4.8.c — deixar explícito o que é UX local sofisticada versus correção arquitetural necessária

### Resultado esperado

O terminal continua evoluindo, mas sem disputar prioridade com o fechamento das fronteiras arquiteturais obrigatórias.

---

## 4. Critérios de conclusão

- imports diretos `server → terminal` significativamente reduzidos;
- `terminal/` deixa de servir como pseudo-camada compartilhada para `server/`;
- ownership de health, routes e realtime mais explícito;
- `commands/`, `handlers/` e `dialog/` do terminal passam a ter papéis mais claros e menos DI difusa;
- `channel/` com papel arquitetural formalizado;
- `conversation-hub/` com lifecycle e ownership mais claros;
- backlog de terminal separado entre base e capabilities.

---

## 5. Dependências relevantes

- depende de P1 e P2, porque runtime do agente e sessão precisam estar mais claros antes de mexer profundamente nas bordas;
- depende de P3 para projections, eventos e observability mais estáveis;
- conversa com P7, pois várias capacidades avançadas de terminal e canal pertencem ao backlog futuro.

---

## 6. Riscos principais

- mover rápido demais sem separar runtime reutilizável de UX local;
- trocar imports diretos por dependências implícitas ainda piores;
- mover “lógica comum” para lugares tão ambíguos quanto o terminal atual;
- tratar a riqueza da UX do terminal como justificativa para manter o boundary poroso;
- misturar o backlog arquitetural das bordas com backlog de features legais do terminal.

---

## 7. Resultado esperado

Ao concluir P4, `server/`, `terminal/`, `channel/` e `conversation-hub/` devem formar um conjunto muito mais legível:

- borda HTTP e realtime mais limpa;
- terminal potente, porém claramente limitado ao seu papel de UX local e adapters finos;
- canal mais explícito;
- hub finalmente tratado como subsistema de primeira classe.
