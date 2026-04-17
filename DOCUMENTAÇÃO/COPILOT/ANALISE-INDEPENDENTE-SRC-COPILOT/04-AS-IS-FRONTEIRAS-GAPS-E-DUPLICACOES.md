# Estado Atual Crítico — Fronteiras Borradas, Gaps e Duplicações

## 1. Fronteiras sem clareza suficiente

### 1.1 `observability/` vs `events/` vs `event-handlers/`

Hoje existem pelo menos três famílias de responsabilidade tocando o mesmo universo:

- taxonomia e middleware de eventos (`events/`)
- reação semântica (`event-handlers/`)
- coleta/alerta/health/metrics (`observability/`)

**Problema:** a separação de intenção ainda não é suficientemente rígida. Em vários lugares, observers e collectors fazem trabalho que se aproxima demais de reação de domínio.

### 1.2 `sdk/` vs `config/`

Há sinais claros de sobreposição entre:

- builders e defaults de sessão;
- contrato do vendor SDK;
- tipos/modelos/configurações acessadas fora de uma façade única.

**Sintoma objetivo:** 43 arquivos com import direto de `@github/copilot-sdk`.

### 1.3 `agent/session/event-handlers/` vs `event-handlers/`

Existe duplicação explícita de nomes e responsabilidade entre:

- `src/copilot/event-handlers/*`
- `src/copilot/agent/session/event-handlers/*`

Isso é um dos sinais mais objetivos de compatibilidade residual ainda não removida.

### 1.4 `terminal/frontend/*` vs runtime local do terminal

O terminal já avançou muito, mas ainda existe risco de dividir a mesma responsabilidade entre:

- `frontend/llm-b-runtime.js`
- `frontend/llm-b-frontend.js`
- `dialog/*`
- `repl*`
- wiring em `index.js`

O movimento recente de convergência foi correto, mas ainda está em curso.

## 2. Duplicações funcionais e semi-duplicações

### 2.1 Health projections múltiplas (agora parcialmente resolvidas)

Historicamente, `server`, `terminal` e `agent` produziam health em mais de um lugar. A extração para `presentation/` melhorou muito esse cenário, mas o risco ainda existe para métricas e diagnósticos futuros.

### 2.2 Ownership de sessão distribuído demais

Antes da introdução de `core/shared-state.js` como binding explícito, `sdkSessionId` e `hubSessionId` podiam ser inferidos em lugares diferentes. Isso começou a ser corrigido, mas a arquitetura atual ainda tem sinais de coordenação implícita remanescente.

### 2.3 Runtime state + snapshot + store + shared-state

Hoje coexistem, com finalidades diferentes, mas ainda parcialmente sobrepostas:

- `agent/status snapshot`
- `agent/session/snapshot.js`
- `core/shared-state.js`
- `conversation-hub/store*`

**Risco:** leitura incorreta de qual estado é operacional, qual é persistido, qual é binding, qual é replay.

### 2.4 `presentation/` como cura e risco

`presentation/` foi a escolha certa para centralizar projections comuns entre `server` e `terminal`. Mas se ela começar a receber lógica demais, o sistema apenas trocará “terminal pseudo-backend” por “presentation pseudo-orchestrator”.

## 3. Gaps de ownership

### 3.1 Quem é dono do quê?

Em muitos pontos a resposta já existe, mas ainda não está 100% imposta pelo código:

- `agent/` deveria ser dono inequívoco do runtime;
- `sdk/` deveria ser dono inequívoco da relação com o vendor;
- `conversation-hub/` deveria ser dono inequívoco da conversa persistida e replay;
- `channel/` deveria ser dono inequívoco do transporte contínuo;
- `terminal/` deveria ser dono inequívoco da UX da LLM-B;
- `server/` deveria ser dono inequívoco da borda HTTP/SSE/Socket.

Hoje o sistema aponta nessa direção, mas ainda com exceções suficientes para gerar drift.

## 4. Gaps de governança técnica

### 4.1 `container.resolve()` demais

Quando DI aparece em 26 arquivos operacionais, ela corre o risco de deixar de ser **wiring** e virar **atalho**.

### 4.2 `Map()` demais

Com 45 arquivos contendo `new Map()`, o sistema precisa de uma política muito clara de:

- lifetime;
- ownership;
- cleanup;
- persistência ou descarte.

### 4.3 compatibilidade residual demais

18 arquivos marcados como `@deprecated` é um número alto para um sistema que já está tentando convergir para uma arquitetura limpa.

## 5. Problemas estruturais prioritários

### Prioridade 1 — centralidade de `observability/`

Se não for reduzida, ela continuará atrasando a separação de responsabilidades do sistema inteiro.

### Prioridade 2 — boundary do SDK ainda espesso

Sem consolidar o boundary do vendor, toda a discussão de ownership de sessão/modelo continua ficando vulnerável a reaberturas laterais.

### Prioridade 3 — duplicação residual de handlers/eventos

A coexistência de dois lugares fazendo o mesmo trabalho semântico ainda é um custo arquitetural real.

### Prioridade 4 — terminal grande, mas finalmente corrigível

Agora que `server -> terminal` foi zerado e `frontend/*` existe, o terminal já está em posição muito melhor para terminar a própria convergência interna.

## 6. Resumo do estado atual

O sistema atual **já tem direção** e **já tem peças corretas**.

O que falta não é inventar nova taxonomia. É terminar a transformação para que:

- uma sessão tenha um owner claro;
- uma projection tenha um owner claro;
- um evento tenha uma taxonomia clara;
- um frontend não faça runtime;
- observability não faça domínio;
- compatibilidade residual pare de viver para sempre.
