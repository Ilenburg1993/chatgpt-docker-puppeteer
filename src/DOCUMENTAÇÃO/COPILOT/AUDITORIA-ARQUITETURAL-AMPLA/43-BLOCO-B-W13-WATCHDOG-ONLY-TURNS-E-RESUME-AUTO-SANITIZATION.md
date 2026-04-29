# 43 — Bloco B / W13: Watchdog-Only no Turno e Saneamento do Resume com `model="auto"`

**Status**: checkpoint complementar validado
**Última atualização**: 2026-04-28
**Escopo desta subonda**:

- eliminar o falso timeout de `sendTurn sem progresso` em auditorias longas da LLM-B;
- impedir que o resume de sessão reapresente `model="auto"` ao SDK;
- persistir/expor o modelo efetivo resolvido em vez do placeholder semântico `auto`.

---

## 1. Problema observado em runtime real

O terminal permanente da LLM-B apresentava dois bugs reais e graves quando exercitado ao vivo:

1. **turnos longos exploratórios morriam por falso stall**
   - o log mostrava `sendTurn inactivity timeout` / `sendTurn sem progresso por 120000ms`;
   - isso ocorria mesmo com o agente executando `skill`, `glob`, `grep`, `view` e emitindo progresso
     observável no runtime.

2. **retomadas legadas podiam reenviar `model="auto"` ao SDK**
   - em certos resumes, o runtime ainda propagava o placeholder `auto` combinado com
     `reasoningEffort`;
   - o SDK rejeita essa combinação porque `auto` é uma convenção do runtime local, não um modelo
     concreto válido para `resumeSession()`.

Esses dois bugs se combinavam mal em boot + uso real do terminal: o runtime podia iniciar com estado
semanticamente difuso e, em seguida, falhar em auditorias longas exatamente no cenário mais
importante para o projeto.

---

## 2. Causa raiz consolidada

### 2.1 Timeout de `sendTurn`

O timeout de inatividade do executor de turno observava progresso de forma incompleta.

- o watchdog era reiniciado adequadamente por deltas e replies do loop;
- porém turnos exploratórios longos produziam progresso relevante também no **host vivo do agent**,
  e nem todo esse progresso reiniciava o timeout local do executor.

Resultado: o sistema matava turnos vivos só porque eles eram longos.

### 2.2 Resume com `auto`

O placeholder `model="auto"` é legítimo apenas **antes** da resolução concreta do modelo.

- em `createSession()`, o runtime pode pedir `auto` e resolver para `gpt-5-mini` (ou outro modelo)
  antes de chamar o SDK;
- em `resumeSession()`, porém, `auto` deve ser **sanitizado/omitido**, porque a retomada precisa
  trabalhar com um modelo concreto ou com ausência de override.

Além disso, o runtime precisava parar de exibir `auto` como modelo ativo depois que o modelo real já
havia sido resolvido.

---

## 3. Transformações aplicadas

### 3.1 `turn-executor.js` passou a observar progresso do host vivo

`src/copilot/agent/dialog/turn-executor.js`

- `createInactivityTimeout()` agora aceita `progressSources` adicionais;
- o timeout de inatividade passa a reiniciar não só com eventos do emitter interno, mas também com
  progresso vindo do host vivo;
- os eventos relevantes continuam sendo:
  - `EMITTER_ASSISTANT_MESSAGE`
  - `EMITTER_ASSISTANT_STREAMING_DELTA`
  - `EMITTER_ASSISTANT_TURN_END`
  - `EMITTER_TASK_DELTA`
  - `EMITTER_TASK_REASONING`
  - `EMITTER_TOOL_EXECUTION_PROGRESS`

### 3.2 Turnos interativos do terminal passaram para modo watchdog-only

Na cadeia terminal → presentation → channel → agent runtime, o contrato de timeout foi ampliado para
aceitar `timeout: null`.

Isso foi propagado em:

- `src/copilot/agent/facades/agent-dialog-runtime.js`
- `src/copilot/channel/client-dialog.js`
- `src/copilot/channel/client.js`
- `src/copilot/presentation/runtime-dialog.js`
- `src/copilot/terminal/dialog/engine.js`

Regra nova:

- `timeout: null` = **sem timeout semântico de inatividade**;
- o watchdog do dialog loop passa a ser o único guardião de stall real nesse modo.

Na prática, o terminal interativo da LLM-B agora usa explicitamente esse modo para auditorias
longas.

### 3.3 `resumeSession()` passou a sanear `model="auto"`

`src/copilot/sdk/session/lifecycle.js`

Foi reforçada a montagem do resume para:

- omitir `model` quando o input lógico é `auto`;
- omitir também `reasoningEffort` quando não houver modelo concreto associado;
- continuar expondo `model`/`reasoningEffort` no resultado **apenas** quando realmente aplicados.

### 3.4 `initializer.js` passou a persistir o modelo efetivo

`src/copilot/agent/session/initializer.js`

O initializer agora calcula e persiste:

- `effectiveModel`
- `effectiveReasoningEffort`

Fontes consideradas:

- retorno efetivo do lifecycle SDK;
- estado persistido concreto (quando não legado);
- fallback canônico quando o estado legado ainda carregava `auto`.

Resultado:

- o runtime deixa de reapresentar `auto` como modelo ativo depois da resolução real;
- o boot live passa a expor `gpt-5-mini` (ou o modelo resolvido correspondente) desde o estado
  retomado/criado.

---

## 4. Regra arquitetural consolidada

Daqui em diante, a regra é:

> `auto` é um placeholder **de intenção do runtime**, nunca um modelo de verdade do lifecycle
> vanilla do SDK.

Portanto:

- **create** pode aceitar `auto` enquanto ele ainda será resolvido localmente antes do SDK;
- **resume** não deve reenviar `auto` ao SDK;
- **UI/health/runtime state** devem expor o modelo efetivo resolvido, não o placeholder lógico.

E, no eixo de timeout:

> turnos exploratórios longos da LLM-B não devem usar timeout semântico curto; eles devem operar em
> modo watchdog-only, desde que haja progresso observável do runtime.

---

## 5. Validação executada

### 5.1 Validação estática escopada

- `prettier --check` focado nos arquivos tocados ✅
- `eslint` focado nos arquivos tocados ✅
- `npm run typecheck:strict:src.copilot` ✅

### 5.2 Lote focado de testes

- `tests/unit/copilot/test_turn_executor.spec.js` ✅
- `tests/unit/copilot/test_terminal_dialog_engine.spec.js` ✅
- `tests/unit/copilot/sdk/test_sdk_session_core_lifecycle.spec.js` ✅
- `tests/unit/copilot/test_initializer_session_fs.spec.js` ✅

### 5.3 Validação live no terminal LLM-B

Foi executado boot real da task/terminal da LLM-B, com os seguintes sinais positivos:

- boot saudável do runtime em `:3009`;
- auto-seleção resolvendo para `gpt-5-mini`;
- criação de nova sessão sem erro de resume com `model="auto"`;
- prompt interativo exibindo `você[gpt-5-mini/high]›` em vez de `auto`.

Também foram executados dois cenários reais:

1. **turno simples** (`oi`)
   - log confirmado: `timeout=none(watchdog-only)`;
   - reply completa entregue no terminal.

2. **turno exploratório longo em `src/copilot`**
   - o runtime permaneceu emitindo progresso contínuo (`skill`, `view`, `grep`, etc.);
   - o turno ultrapassou com folga a antiga janela de 120s sem disparar `sendTurn sem progresso`;
   - `/health` confirmou runtime saudável em `processing`, com `dialogLoopActive=true` e
     `model="gpt-5-mini"`.

---

## 6. Impacto arquitetural

Esta subonda não foi só um bugfix local. Ela consolidou duas fronteiras críticas:

1. **ownership do progresso de turno**
   - o executor do agent passa a respeitar progresso emitido pelo host vivo, reduzindo
     desacoplamento artificial entre observabilidade local e runtime real.

2. **ownership do modelo efetivo**
   - o runtime deixa de confundir intenção de seleção (`auto`) com estado concreto da sessão.

O efeito é um terminal muito mais estável para auditorias longas — exatamente o tipo de workload que
esta revolução arquitetural precisa suportar.
