# R-09 — Programa 2: SDK e fronteiras de sessão

**Programa**: P2
**Prioridade**: alta
**Foco**: transformar `sdk/` em camada fina e corrigir ownership de sessão entre `sdk/`, `agent/` e `conversation-hub/`

---

## 1. Objetivo

P2 existe para resolver uma das ambiguidades mais caras do sistema atual:

> o wrapper do SDK ainda participa demais do ownership de sessão e da modelagem operacional.

Isso precisa mudar para que o `agent/` e o `conversation-hub/` possam amadurecer de verdade.

---

## 2. Diagnóstico de partida

### Sinais principais

- `sdk/` ainda soma **7.913 linhas**;
- `sdk/session/client.js` ainda concentra parte do lifecycle do wrapper, mas o primeiro bolsão de estado já começou a sair;
- **96 arquivos fora de `sdk/`** importam `sdk` diretamente;
- ainda há resquícios de duplicação/configuração entre `sdk/` e `config/`.

### Avanço incremental já entregue em `F2.1`

O programa já não está mais em fase puramente diagnóstica:

- surgiu `infra/sdk-session-registry.js` como SSOT de sessões SDK ativas no processo;
- o registry `_sessions` saiu de `sdk/session/client.js` e passou a ser delegado para a nova camada de `infra/`;
- a API pública do wrapper foi preservada (`createClientSession`, `resumeClientSession`, `getClientSession`,
	`listActiveClientSessions`, `incrementSessionMessageCount`, `getActiveSessionCount`), mas o statefulness do módulo foi reduzido;
- o barrel `infra/index.js` agora exporta explicitamente essa nova superfície canônica;
- aliases compatíveis `loadCustomTools` e `loadToolsConfig` foram restaurados no barrel `#copilot/sdk`, evitando ruído de regressão enquanto o programa avança.

Leitura prática:

- o SDK ainda não está “fino” o suficiente, mas o primeiro pedaço do ownership operacional de sessão já saiu do wrapper;
- isso abre caminho para que `agent/`, `server/routes/sdk/*` e `conversation-hub/` passem a conversar com um registry mais neutro e menos vendor-shaped.
- além disso, a costura entre `sdkSessionId` e `hubSessionId` deixou de depender só de inferência local:
	`agent/session/ownership.js` + `core/shared-state.js` já começam a formar uma SSOT explícita desse vínculo.

---

## 3. Fases

## F2.1 — Session ownership e registry

### Subfases

- F2.1.a — mapear todo o ownership atual de sessão
- F2.1.b — extrair ou relocalizar session registry para camada apropriada
- F2.1.c — reduzir statefulness do wrapper principal
- F2.1.d — alinhar `agent/` e `conversation-hub/` ao novo ownership

### Resultado esperado

O SDK deixa de “guardar a casa” e volta a ser o porteiro técnico do vendor SDK.

### Estado atual resumido de `F2.1`

Os primeiros cortes de `F2.1` já começaram:

- o registry de sessões ativas deixou de ser um `Map` privado em `sdk/session/client.js`;
- `infra/sdk-session-registry.js` passou a centralizar:
	- registro de sessão ativa;
	- leitura/listagem do registry;
	- contagem de sessões;
	- contagem de mensagens por sessão;
	- remoção/reset do estado em memória;
- `sdk/session/client.js` agora funciona como fachada sobre esse registry externo, em vez de ser o dono do estado.

Validação focada do corte:

- **2/2** (`node:test`) para a extração estrutural `D1`;
- **71/71** (`vitest`) nas suítes de registry/client/barrel do SDK.

Próxima regra prática de `F2.1`:

- usar a externalização do registry para começar a limpar ownership residual entre `sdk/session/client.js`,
	`server/routes/sdk/*` e as superfícies de sessão do `agent/`, em vez de apenas mover mapas de lugar.

### Avanço adicional conectado a `F2.1.d`

- o `sdkSessionId` ativo agora é publicado em estado compartilhado cross-layer e sincronizado com o hub conversacional;
- isso reduz a necessidade de que `conversation-hub/` e `server/` redescubram o vínculo via snapshots ou wiring informal;
- `presentation/sdk-sessions.js` passou a concentrar essa projeção de ownership para as rotas SDK, reduzindo lógica
	duplicada em `session-crud.js` e `session-messaging.js`;
- `server/routes/sdk/*` agora já usa a SSOT compartilhada para:
	- publicar `canonicalSessionId`, `sharedBinding` e `boundHubSessionId`;
	- sincronizar a sessão SDK ativa em operações de `create`, `resume` e `setForeground`;
	- limpar o binding compartilhado quando a sessão ativa é `disconnect`/`delete`.
- `server/routes/sdk/client.js` e `server/routes/sdk/agent.js` passaram a consumir a mesma runtime projection canônica,
	reduzindo drift entre inspeção de runtime, inspeção do wrapper e ownership de sessão;
- `POST /client/force-stop` deixou de chamar diretamente o método do client e passou a usar a superfície canônica do
	wrapper, limpando também o binding compartilhado da sessão SDK.

Validação incremental adicional:

- **11/11** (`node:test`) no recorte ampliado das rotas SDK ownership-aware + runtime projection;
- **42/42** (`vitest`) nas suítes estruturais F19/F33 após a migração.

Próximo passo natural:

- revisar quais consumidores fora de `server/routes/sdk/*` ainda falam em “sessão SDK ativa” sem distinguir claramente
	hub, runtime e wrapper, para continuar a dieta de ownership difuso.

## F2.2 — Consolidação de config builders e superfícies duplicadas

### Subfases

- F2.2.a — eliminar duplicações residuais entre `sdk/` e `config/`
- F2.2.b — definir claramente onde moram builders, defaults e contracts de configuração
- F2.2.c — remover ou consolidar restos de config legacy no wrapper

### Resultado esperado

`config/` vira a casa canônica da configuração; `sdk/` para de duplicar essa discussão.

## F2.3 — `custom-agents`, contratos e barrels

### Subfases

- F2.3.a — consolidar ownership de `custom-agents`
- F2.3.b — revisar contratos e typedefs ainda mal posicionados
- F2.3.c — limpar barrels e exports que espalham o wrapper além do necessário

### Resultado esperado

Menos exports “por conveniência” e mais superfície pública deliberada.

## F2.4 — Dieta de imports diretos de `sdk`

### Subfases

- F2.4.a — mapear imports legítimos vs imports de conveniência
- F2.4.b — criar/fortalecer camadas intermediárias onde fizer sentido
- F2.4.c — reduzir o fan-out direto do wrapper para o restante do repositório

### Resultado esperado

Menos arquivos fora de `sdk/` conhecendo detalhes que não deveriam conhecer.

## F2.5 — Typing, docs e contracts do wrapper

### Subfases

- F2.5.a — revisar tipagem compartilhada do wrapper
- F2.5.b — reorganizar typedefs pesados demais
- F2.5.c — alinhar JSDoc, barrels e docs de API pública

### Resultado esperado

O wrapper fica mais previsível para código e para humanos.

---

## 4. Critérios de conclusão

- statefulness residual do `sdk/` drasticamente reduzido;
- ownership de sessão formalizado fora do wrapper fino;
- imports diretos de `sdk` fora do módulo significativamente reduzidos;
- duplicações com `config/` eliminadas ou formalmente encerradas;
- API pública do wrapper documentada e mais enxuta.

---

## 5. Dependências relevantes

- depende do avanço de P1 para não reinventar ownership no lado do `agent/`;
- alimenta P4, porque server/terminal/channel/hub dependem muito da clareza do lifecycle de sessão;
- conversa com P5 em config/types;
- exige gates de P6 para garantir que a migração não vire caos distribuído.

---

## 6. Riscos principais

- mover registry/session ownership cedo demais sem contrato de integração robusto;
- trocar difusão atual por outro acoplamento invisível em `conversation-hub/`;
- subestimar a quantidade de consumidores indiretos do wrapper.

---

## 7. Resultado esperado

Ao concluir P2, o sistema deve olhar para `sdk/` e enxergar:

- adaptação técnica limpa;
- menos estado escondido;
- menos dependências diretas espalhadas;
- e ownership de sessão muito mais coerente com a arquitetura do restante do sistema.
