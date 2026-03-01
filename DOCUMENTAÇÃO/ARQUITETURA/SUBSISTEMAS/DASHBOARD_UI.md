**Status**: Canônico de apoio.  
**Escopo**: aprofundamento do pacote `src/dashboard-ui/`.  
**Quando consultar**: ao alterar a UI operacional, rotas Vue, stores, composables, consumo de API ou integração Socket.io do dashboard.  
**Documento-mestre relacionado**: [ARCHITECTURE.md](../ARCHITECTURE.md).

# DASHBOARD UI

**Propósito**: documentar `src/dashboard-ui/` como frontend operacional separado do backend server.  
**Status documental**: Canônico de apoio.  
**Público**: engenharia frontend, manutenção e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Papel arquitetural

`src/dashboard-ui/` é um pacote frontend próprio, baseado em Vue 3 + Vite, que consome a superfície
externa exposta por `src/server/`.

Ele não é:

- o backend HTTP;
- o barramento NERV;
- a camada de persistência.

Ele é:

- a interface humana principal de observabilidade e controle;
- um cliente HTTP autenticado;
- um consumidor realtime do Socket.io do servidor.

## Estrutura principal

### `package.json`

Define o pacote UI.

Características observáveis:

- `type: module`;
- scripts `dev`, `build`, `preview`;
- stack com `vue`, `vue-router`, `pinia`, `axios`, `socket.io-client`, `chart.js`, `radix-vue`.

### `src/main.js`

É o bootstrap do frontend.

Responsabilidades:

- criar a aplicação Vue;
- instalar `router`;
- instalar `pinia`;
- montar `App.vue`.

### `src/router/`

É a topologia navegável do dashboard.

Rotas observáveis no baseline:

- `/dashboard`
- `/tasks`
- `/tasks/:id`
- `/missions`
- `/missions/:id`
- `/events`
- `/workflows/:workflowId`
- `/artifacts/:id`
- `/health`
- `/audit`
- `/audit/jobs`
- `/audit/jobs/:id`
- `/audit/patches/:id`
- `/audit/inference`

Essa árvore mostra que a UI já cobre runtime principal e trilha de auditoria.

### `src/stores/`

É o estado cliente de alto nível.

Peças observáveis:

- `tasks.js`, `tasks_vnext.js`
- `missions_vnext.js`
- `events_vnext.js`
- `system.js`
- `telemetry.js`

Função:

- manter cache e sincronização reativa da UI.

### `src/composables/`

É a camada de integração reutilizável do frontend.

Peças observáveis:

- `useSocket.js`
- `useRealtime.js`
- `useSsotRealtime.js`
- `useAudit.js`
- `useAuth.js`
- `useNotifications.js`
- `useUiPreferences.js`

Função:

- encapsular conexão Socket.io, autenticação, consumo de feed SSOT e UX transversal.

### `src/lib/`

Peças observáveis:

- `http.js`
- `command_guard.js`
- `utils.js`

Função:

- concentrar o cliente Axios, tratamento de erro e helpers de comando.

### `src/components/`

Biblioteca de UI e widgets de domínio:

- layout;
- UI base (`Button`, `Card`, `Modal`, etc.);
- gráficos;
- componentes de task;
- autenticação.

### `src/views/`

Composição das telas de alto nível que o router entrega.

### `src/assets/`

Inclui estilos, ícones e assets estáticos da UI.

## Integrações de backend

### HTTP

`src/lib/http.js` cria um cliente Axios com:

- timeout configurável;
- `withCredentials`;
- injeção de `Authorization` via `auth_token`;
- enrich de erro com `request_id`.

### Realtime

`useSocket.js` mantém uma conexão Socket.io singleton com:

- reconnect automático;
- autenticação por token;
- subscribe/unsubscribe reativo;
- acoplamento ao lifecycle dos componentes.

Isso conecta diretamente o frontend ao plano `src/server/realtime/`.

## Artefatos não canônicos dentro do pacote

`src/dashboard-ui/` contém também:

- `dist/`
- `node_modules/`

Esses diretórios são artefatos de build e dependências locais. Eles não fazem parte do mapa
canônico da arquitetura e não devem ser tratados como baseline estrutural.

## Relação com outros subsistemas

### Dashboard UI x Server

- o frontend consome API e Socket.io do `src/server/`;
- não deve falar diretamente com `infra`, `kernel` ou `driver`.

### Dashboard UI x Auditoria / Inference

- há telas e fluxos específicos para jobs de auditoria e inferência;
- isso não muda o fato de que a UI continua cliente do backend, não dona desses domínios.

## Restrições e guardrails

- Não misturar lógica de backend dentro do pacote frontend.
- O contrato de dados da UI deve seguir as APIs e eventos do server.
- `dist/` e `node_modules/` não entram no baseline de arquitetura.
- Rotas e stores devem ser lidas como cliente operacional, não como nova fonte de verdade.

## Referências no código

- `src/dashboard-ui/package.json`
- `src/dashboard-ui/src/main.js`
- `src/dashboard-ui/src/router/index.js`
- `src/dashboard-ui/src/lib/http.js`
- `src/dashboard-ui/src/composables/useSocket.js`
- `src/dashboard-ui/src/stores/`
- `src/dashboard-ui/src/views/`
- `src/dashboard-ui/src/components/`
