# 11 — Agent Module: Situação Ideal Compatível

**Data de atualização**: 2026-04-22
**Escopo primário**: `src/copilot/agent/`
**Escopo contextual**: evolução compatível do `agent/` dentro de `src/copilot/`
**Documento superior**:
[12-SRC-COPILOT-ARQUITETURA-GLOBAL.md](./12-SRC-COPILOT-ARQUITETURA-GLOBAL.md)
**Documento base**: [10-AGENT-SITUACAO-ATUAL.md](./10-AGENT-SITUACAO-ATUAL.md)
**Status**: proposta ideal reconstruída após reavaliação da situação atual

> **Leitura correta deste documento**: esta versão abandona a hipótese de uma arquitetura totalmente
> nova. A situação atual não justifica um big bang. O estado ideal passa a ser uma evolução
> compatível: preservar o runtime atual, criar contratos menores ao redor dele, reduzir
> centralização e preparar expansão futura sem trocar o motor em voo. Este documento é subordinado
> ao guia global do `src/copilot`; o `agent/` é L4 Runtime, não a arquitetura inteira.

---

## 1. Tese central

A situação ideal não é `Runtime Kernel + Runtime Manager + Adapters` como troca profunda da
arquitetura atual.

A situação ideal mais compatível é:

> **transformar o `agent/` atual em um runtime governado por facades, capabilities, ports e policies
> leves, preservando `AlwaysAliveAgent`, `AgentContext`, health, boot, SDK façade e
> `runtime-registry` como bases de transição.**

Em vez de substituir o centro, o plano deve cercar os centros atuais com contratos menores:

- `AlwaysAliveAgent` continua como API compatível, mas para de crescer;
- `AgentContext` continua como contexto vivo, mas ganha limites e adapters;
- `runtime-registry` evolui para manager leve, sem multi-session prematuro;
- `health-check.js` vira base para capability readiness;
- `facades/` viram a superfície moderna de consumo;
- imports diretos para contexts adjacentes são drenados por ports;
- dialog e lifecycle são decompostos apenas depois de contratos externos estáveis.

O objetivo é reduzir risco e aumentar governança sem impor uma nova arquitetura paralela complexa.

---

## 2. Subordinação à arquitetura global

A arquitetura ideal do `agent/` deve obedecer ao documento global:

- `agent/` é **L4 Runtime**.
- `sdk/` continua sendo a fonte de verdade das capabilities vanilla.
- `event-handlers/` é a primeira fronteira para payload cru do SDK.
- `events/` nomeia, cataloga e valida eventos.
- `presentation/` é o hub de projections e runtime targeting para bordas.
- `conversation-hub/` é dono de memória, turns e replay conversacional.
- `tools/`, `hooks/` e `bridges/` são capacidades/policies/integrações sensíveis, não internals do
  `agent/`.
- `server/` e `terminal/` são bordas e devem preferir `presentation/`.
- `observability/` e `audit/` consomem sinais, não decidem runtime.

Consequência prática:

> qualquer melhoria do `agent/` que o faça absorver `presentation/`, `event-handlers`,
> `conversation-hub`, `tools`, `hooks`, `server` ou `terminal` como detalhe interno está indo contra
> a arquitetura global.

---

## 3. Princípios da nova proposta

## 3.1 Compatibilidade primeiro

Nenhuma fase deve quebrar:

- `getAgent()`;
- `alwaysAliveAgent`;
- API pública existente do `AlwaysAliveAgent`;
- eventos legados;
- snapshot de estado atual;
- rotas e comandos que dependem de `presentation/`.

## 3.2 Expandir antes de contrair

O plano deve seguir:

1. criar contrato novo;
2. delegar comportamento antigo para ele;
3. testar equivalência;
4. migrar consumidores;
5. bloquear novos usos antigos;
6. remover apenas quando seguro.

## 3.3 Menos kernel, mais facades governadas

O código atual já tem facades. A evolução mais barata e mais segura é fortalecê-las:

- `agent-runtime-status`;
- `agent-runtime-controls`;
- `agent-dialog-runtime`;
- `agent-runtime-ownership`;
- `agent-runtime-webhooks`;
- `agent-sdk-access`;
- `agent-session-ops`;
- `agent-model-config`.

Antes de criar uma árvore nova, essas facades devem virar a superfície moderna de runtime.

## 3.4 Estado governado sem trocar o storage interno de uma vez

`AgentContext` não deve ser substituído imediatamente. Ele deve ser limitado:

- writes por commands;
- reads por queries;
- managers vivos por accessors/ports;
- novos campos só com owner explícito;
- raw access proibido por gate.

## 3.5 Multi-runtime progressivo, não multi-session imediato

O ideal não é correr para múltiplas sessões reais. O ideal é:

1. runtime default governado;
2. runtime manager leve;
3. runtime fake/nomeado em testes;
4. health/listagem por runtime;
5. só depois isolamento real.

## 3.6 Dialog só deve ser decomposto quando houver superfície estável

Decompor `DialogLoopManager` cedo demais aumenta risco. Primeiro:

- contracts de commands/queries;
- capability map;
- ports;
- tests de equivalência;
- eventos catalogados.

Depois, extrair FSM, ledger e policies.

---

## 4. Arquitetura-alvo compatível

## 4.1 Visão geral

```text
agent/
  always-alive.js              # API pública compatível; não cresce
  agent-context.js             # contexto vivo governado; não vira novo saco mutável
  runtime-registry.js          # registry atual
  runtime-manager.js           # manager leve sobre a registry
  runtime-facade.js            # superfície moderna de commands/queries
  runtime-capabilities.js      # capability map simples e auditável
  runtime-ports.js             # ports para tools/conversation/webhooks/audit
  facades/                     # facades atuais fortalecidas
  lifecycle/                   # start/stop/reconnect fatiados gradualmente
  dialog/                      # loop atual preservado, extrações incrementais
  session/                     # boot/session/ownership/snapshot
  messaging/                   # commands de envio/fila/answer
  state/                       # snapshots públicos
```

Essa arquitetura não tenta apagar a árvore atual. Ela adiciona uma camada de governança acima dela.

## 4.2 Papel ideal do `AlwaysAliveAgent`

Na situação ideal compatível, `AlwaysAliveAgent` é:

- API pública estável;
- compatibility façade;
- EventEmitter compatível;
- delegador para `runtime-facade`;
- ponto de materialização lazy.

Ele não deve:

- receber novas responsabilidades de domínio;
- expor managers novos diretamente;
- implementar lógica nova de lifecycle/dialog;
- virar manager de múltiplos runtimes.

## 4.3 Papel ideal do `AgentContext`

`AgentContext` continua existindo, mas com regras:

- cada subestado tem owner;
- cada manager vivo tem façade/port;
- writes novos precisam de command nomeado;
- reads novos precisam de query/snapshot;
- `ctx.*State` cru é compat interno, não padrão;
- `ctx.dialogLoop`, `ctx.permissions`, `ctx.webhooks`, `ctx.handoff`, `ctx.toolsRegistry` devem ser
  encapsulados progressivamente.

O objetivo não é eliminá-lo. É reduzir seu poder arquitetural.

## 4.4 Papel ideal do `runtime-facade`

Nova superfície moderna mínima:

```text
runtime-facade
  commands:
    start()
    stop()
    sendMessage()
    steerMessage()
    answerPendingQuestion()
    setModel()
    setReasoningEffort()
    setPermissionMode()

  queries:
    getStatusSnapshot()
    getHealthSnapshot()
    getSdkResourceSnapshot()
    getRuntimeInfo()
    getDialogSnapshot()
    getQueueSnapshot()
    getCapabilities()
```

Inicialmente, essa façade pode delegar para `AlwaysAliveAgent`/`AgentContext`. Depois, o fluxo se
inverte: `AlwaysAliveAgent` passa a delegar para ela.

## 4.5 Papel ideal do `runtime-manager`

`runtime-manager` deve começar pequeno:

- encapsular `runtime-registry`;
- materializar runtime default via factory existente;
- listar runtimes;
- resolver runtime por id;
- manter fallback explícito;
- suportar runtime fake em testes.

Não deve, inicialmente:

- criar multi-session real;
- isolar todos os estados;
- substituir `getAgent()`;
- mudar semântica de boot.

## 4.6 Papel ideal das capabilities

Capability map simples, não framework pesado.

Exemplo:

```js
{
  id: 'session.plan.write',
  available: true,
  source: 'sdk',
  risk: 'medium',
  requiresPermission: false,
  degradedReason: null
}
```

Capabilities iniciais:

- `runtime.lifecycle.start`;
- `runtime.lifecycle.stop`;
- `runtime.status.read`;
- `runtime.health.read`;
- `sdk.resources.inspect`;
- `session.mode.read`;
- `session.mode.write`;
- `session.plan.read`;
- `session.plan.write`;
- `dialog.turn.send`;
- `dialog.question.answer`;
- `permissions.mode.read`;
- `permissions.mode.write`;
- `webhooks.manage`;
- `handoff.read`;
- `tools.registry.read`.

## 4.7 Papel ideal dos ports

Ports devem remover acoplamentos diretos sem reescrever tudo.

Ports iniciais:

- `ToolBootstrapPort`: encapsula `tools/bootstrap`;
- `ConversationSyncPort`: encapsula `conversation-hub` para ownership/history sync;
- `InputResolverPort`: encapsula `hook-tools.resolveUserInput`;
- `WebhookPort`: encapsula `ctx.webhooks`;
- `PermissionPort`: encapsula `ctx.permissions`;
- `AuditPort`: futuro, para diagnóstico/autoprogramação.

Cada port só vale se remover ou impedir pelo menos um import direto.

---

## 5. Fronteiras-alvo

## 5.1 `agent/`

Deve importar diretamente:

- `core/`;
- `events/`;
- `sdk/`;
- `config/`;
- `observability/`;
- `hooks/` quando for contrato de sessão;
- módulos internos do próprio `agent/`.

Deve evitar import direto de:

- `conversation-hub/`;
- `tools/`;
- `bridges/`;
- `terminal/`;
- `server/`;
- `channel/`.

Exceções devem ser documentadas e ter prazo de drenagem.

## 5.2 `presentation/`

Deve continuar sendo o hub compartilhado das bordas:

- runtime selection;
- runtime fallback;
- projections;
- route deps;
- payloads comuns.

`server/` e `terminal/` devem consumir `presentation/` sempre que a funcionalidade for
compartilhada.

## 5.3 `conversation-hub/`

Deve ser dono de:

- sessões conversacionais;
- turns;
- memória;
- replay conversacional.

Não deve ser dependência concreta do lifecycle do agent. O agent deve falar com ele por port.

## 5.4 `tools/`

Deve ser dono de:

- tools;
- bootstrap operacional;
- registry e bindings de sessão;
- superfícies de tool.

O agent deve consumir isso por `ToolBootstrapPort`.

---

## 6. Situação ideal por eixo

## 6.1 Estado

Ideal compatível:

- `AgentContext` permanece;
- subestados têm owners explícitos;
- commands/queries cobrem hot path;
- managers vivos ganham wrappers;
- raw access vira exceção monitorada.

Não ideal por enquanto:

- criar store nova completa;
- migrar tudo para aggregates;
- remover `AgentContext`.

## 6.2 Lifecycle

Ideal compatível:

- `agent-lifecycle.js` é fatiado por services;
- `agentStart`/`agentStop` continuam como wrappers;
- ownership/history/tools viram ports;
- boot continua com pipeline atual;
- error policy cobre fluxos residuais.

Services iniciais:

- `sdk-client-service`;
- `session-start-service`;
- `ownership-sync-service`;
- `history-sync-service`;
- `shutdown-service`.

## 6.3 Dialog

Ideal compatível:

- `DialogLoopManager` permanece API interna principal;
- extrações são pequenas;
- primeiro extrair PR/cost ledger;
- depois extrair compaction policy;
- depois extrair FSM;
- só então avaliar boot sequencer separado.

Não ideal por enquanto:

- recriar todo o dialog como protocolo novo;
- mudar contrato público de `startDialogLoop`, `sendDialogTurn`, `pause`, `resume`.

## 6.4 Messaging

Ideal compatível:

- `sendMessage`, `steerMessage`, `answerPendingQuestion` viram commands da runtime façade;
- fila segue em `MessageQueue`;
- eventos seguem compatíveis;
- persistência de pending turn é isolada gradualmente.

## 6.5 Health

Ideal compatível:

- `health-check.js` continua canônico;
- adiciona readiness por capability;
- adiciona origem/degradação de resources;
- prepara health por runtime id;
- não duplica health em `presentation/`.

## 6.6 SDK access

Ideal compatível:

- `agent-sdk-access.js` continua façade canônica;
- `getSdkResourceSnapshot()` alimenta capability map;
- fallback estrutural é mantido só para compat/testes;
- novas operações SDK entram por esta façade.

## 6.7 Runtime registry

Ideal compatível:

- criar manager leve ao lado;
- manager usa registry atual por baixo;
- `presentation/agent-runtime.js` migra para manager;
- `getAgent()` continua funcionando;
- runtime fake/nomeado em teste prova o caminho.

## 6.8 Eventos

Ideal compatível:

- manter `EventEmitter`;
- manter bridge;
- criar catálogo de eventos atuais;
- impedir novos eventos sem entrada no catálogo;
- opcionalmente publicar eventos estruturados no `EventBus` em paralelo.

Não ideal por enquanto:

- inverter origem de todos os eventos;
- criar journal obrigatório;
- quebrar consumidores legados.

---

## 7. Critérios de sucesso

## CA-1 — API pública preservada

- `getAgent()` continua.
- `alwaysAliveAgent` continua.
- Métodos atuais do `AlwaysAliveAgent` continuam.
- Eventos legados continuam.

## CA-2 — Nenhuma nova centralização

- novos recursos não adicionam manager vivo direto ao `AgentContext`;
- novos métodos não incham `AlwaysAliveAgent` sem façade correspondente.

## CA-3 — Runtime façade mínima

- existe superfície moderna de commands/queries;
- `AlwaysAliveAgent` delega pelo menos parte da API para ela;
- testes provam equivalência.

## CA-4 — Capability map útil

- capabilities iniciais são listáveis;
- health aponta degradações relevantes;
- SDK resources alimentam capabilities.

## CA-5 — Ports removem acoplamento real

- pelo menos `tools/bootstrap` ou `conversation-hub` deixa de ser import direto em um fluxo central;
- novos fluxos não importam contexts adjacentes diretamente.

## CA-6 — Lifecycle menos transacional

- ownership sync e history sync saem do miolo de `agentStart`;
- shutdown tem service/helper próprio;
- error policy cobre fluxos residuais.

## CA-7 — Dialog reduzido sem quebra

- PR/cost ledger ou compaction policy sai do `DialogLoopManager`;
- API pública do dialog permanece;
- testes cobrem comportamento antes/depois.

## CA-8 — Registry vira manager leve

- manager resolve default runtime;
- manager lista runtimes;
- manager aceita runtime fake em teste;
- `presentation/` usa manager ou adapter dele.

## CA-9 — Gates automatizados

- gate de raw access;
- gate de imports sensíveis;
- gate de eventos sem catálogo;
- gate de novos exports públicos do `agent/index.js`.

## CA-10 — Documentação permanece alinhada

- 10 descreve o estado real;
- 11 descreve o alvo compatível;
- cada fatia de migração atualiza o status.

---

## 8. Roadmap compatível

## Fase 0 — Baseline e gates

### F0.1 Inventário congelado

- Métodos públicos do `AlwaysAliveAgent`.
- Imports diretos sensíveis.
- Eventos emitidos.
- Managers acessados via `ctx`.
- Arquivos densos.

### F0.2 Gates em modo warn

- raw access;
- imports sensíveis;
- novos métodos públicos;
- eventos sem catálogo.

### F0.3 Documento de exceções

- exceções aceitas;
- dono;
- prazo;
- caminho de drenagem.

## Fase 1 — Runtime façade mínima

### F1.1 Criar `runtime-facade.js`

Commands:

- `startRuntime`;
- `stopRuntime`;
- `sendRuntimeMessage`;
- `answerRuntimeQuestion`;
- `setRuntimeModel`.

Queries:

- `getRuntimeStatus`;
- `getRuntimeHealth`;
- `getRuntimeSdkResources`;
- `getRuntimeQueue`;
- `getRuntimeDialog`.

### F1.2 Delegar sem mudar comportamento

- `AlwaysAliveAgent.start()` delega;
- `AlwaysAliveAgent.stop()` delega;
- `getHealthSnapshot()` delega;
- `getSdkResourceSnapshot()` delega.

### F1.3 Testes de equivalência

- API antiga e façade retornam shapes equivalentes;
- erros permanecem compatíveis;
- eventos continuam.

## Fase 2 — Capability map

### F2.1 Criar `runtime-capabilities.js`

- schema simples;
- capabilities iniciais;
- source/risk/degradedReason.

### F2.2 Ligar SDK resources

- `getSdkResourceSnapshot()` alimenta capabilities;
- health mostra capabilities degradadas.

### F2.3 Ligar permissions

- capabilities sensíveis indicam permissão necessária;
- `PermissionController` continua implementação.

## Fase 3 — Runtime manager leve

### F3.1 Criar `runtime-manager.js`

- encapsula registry;
- resolve default;
- resolve explicit runtime;
- lista runtimes.

### F3.2 Migrar `presentation/agent-runtime.js`

- consumir manager;
- preservar fallback;
- preservar shapes atuais.

### F3.3 Testar runtime fake

- registrar runtime fake;
- resolver por id;
- listar;
- não iniciar sessão real.

## Fase 4 — Ports de integração

### F4.1 `ToolBootstrapPort`

- encapsula `tools/bootstrap`;
- usado por `session-setup`;
- reduz import direto.

### F4.2 `ConversationSyncPort`

- encapsula `conversation-hub`;
- usado por ownership/history sync;
- reduz import direto em lifecycle.

### F4.3 `InputResolverPort`

- encapsula `hook-tools.resolveUserInput`;
- usado no fluxo de resposta de pergunta.

### F4.4 `WebhookPort` e `PermissionPort`

- wrappers sobre managers atuais;
- reduzem acesso direto via `ctx`.

## Fase 5 — Lifecycle fatiado

### F5.1 Extrair service de SDK/session

- client creation;
- session init/resume;
- session handles.

### F5.2 Extrair service de ownership/history

- sync ownership;
- clear ownership;
- history sync.

### F5.3 Extrair shutdown service

- drain tasks;
- snapshot;
- stop timers;
- disconnect session/client.

## Fase 6 — Dialog incremental

### F6.1 Extrair cost ledger

- PR metrics;
- quota snapshots;
- cost by turn.

### F6.2 Extrair compaction policy

- token budget handling;
- urgency;
- duplicate guard.

### F6.3 Extrair FSM simples

- estados;
- transições;
- warnings/violations.

### F6.4 Manter manager como orquestrador

- API de `DialogLoopManager` permanece.

## Fase 7 — Persistência mais limpa

### F7.1 Separar tipos de snapshot

- recovery fields;
- telemetry fields;
- dialog fields.

### F7.2 Criar adapter de snapshot

- mantém arquivo atual;
- prepara versão futura;
- evita breaking change.

### F7.3 Event log opcional

- não obrigatório no primeiro ciclo;
- pode registrar lifecycle/dialog/ask_user para debug.

## Fase 8 — Multi-runtime preparado

### F8.1 Runtime fake/nomeado

- provar manager;
- health/listagem;
- sem sessão real concorrente.

### F8.2 Runtime real secundário experimental

- feature flag;
- sem default;
- sem borda pública ampla.

### F8.3 Decisão posterior sobre multi-session

- só avançar se houver caso real;
- exigir isolamento de state, queue e session.

---

## 9. Sequência imediata recomendada

A próxima implementação deve ser:

1. Adicionar gates em modo warn para imports sensíveis e raw access.
2. Criar `runtime-facade.js` com queries de health/status/sdkResources.
3. Fazer `AlwaysAliveAgent.getHealthSnapshot()` e `getSdkResourceSnapshot()` delegarem para a
   façade.
4. Criar testes de equivalência.
5. Só depois adicionar commands de start/stop/send.

Essa sequência entrega valor arquitetural sem tocar no `DialogLoopManager` nem no boot.

---

## 10. O que fica explicitamente fora agora

Não fazer nesta rodada:

- substituir `AgentContext`;
- remover `AlwaysAliveAgent`;
- remover `alwaysAliveAgent`;
- introduzir kernel completo;
- reescrever dialog;
- criar event journal obrigatório;
- fazer multi-session real;
- trocar formato do snapshot persistido.

Essas ideias podem continuar como horizonte, mas não são o melhor próximo passo.

---

## 11. Conclusão

A proposta ideal compatível é menos dramática e mais forte operacionalmente:

> **preservar a arquitetura atual, criar uma camada moderna de runtime façade/capabilities/ports,
> migrar consumidores gradualmente e só então reduzir os centros de gravidade internos.**

Essa abordagem respeita o que já está funcionando, reduz risco e ainda prepara o sistema para
expansão futura. O melhor plano não é trocar o coração do `agent/`; é dar a ele vasos melhores,
válvulas mais claras e instrumentos mais precisos antes de qualquer cirurgia profunda.
