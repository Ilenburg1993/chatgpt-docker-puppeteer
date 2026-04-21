# R-03 — Auditoria de `src/copilot/agent/` e das suas integrações

**Data**: 2026-04-15 **Status**: concluída **Foco**: `src/copilot/agent/` no contexto do restante de
`src/copilot/`

---

## 1. Papel arquitetural atual do `agent/`

O `agent/` é hoje o centro operacional de `src/copilot/`.

Ele concentra, ao mesmo tempo:

- fachada pública do runtime always-alive;
- start/stop/reconnect e setup de sessão;
- loop de diálogo;
- fila e envio ao SDK;
- wiring de eventos;
- background tasks e health runtime;
- parte da relação com `conversation-hub`, `server`, `terminal` e `channel`.

Essa concentração explica por que o módulo continua sendo o maior hotspot do sistema mesmo após
diversas melhorias incrementais.

---

## 2. Snapshot do `agent/`

| Métrica                  |                    Valor |
| ------------------------ | -----------------------: |
| Arquivos `.js`           |                       62 |
| Linhas                   |                    8.248 |
| Maior arquivo            | `always-alive.js` (638L) |
| Maior subárvore          |      `session/` (1.975L) |
| Segunda maior subárvore  |       `dialog/` (1.902L) |
| Terceira maior subárvore |    `lifecycle/` (1.299L) |

### Melhorias já incorporadas ao baseline

- `AgentContext` já tem subestados nomeados;
- `processQueue()` e `executeTask()` já têm caminho canônico em `agent-messaging.js`;
- `boot-wiring.js` já foi afinado com `boot-steps.js`;
- `event-bridge-map.js` e `event-bridge-wiring.js` já existem;
- `background-tasks.js` já opera no runtime;
- `health-check.js` já existe e já é usado pelas rotas.

### Leitura honesta

O `agent/` melhorou bastante em **estrutura interna**, mas continua pesado demais em **coordenação
de fronteiras**.

---

## 3. Relação `agent ↔ sdk`

### Estado atual

- o `agent/` depende intensamente de `sdk/`;
- `sdk/` ainda não é completamente stateless;
- ownership de sessão ainda vaza entre `sdk/`, `agent/` e `conversation-hub/`.

### Consequências

- ciclo de vida de sessão fica difuso;
- muito código precisa conhecer detalhes do wrapper SDK;
- a redução do `agent/` fica limitada porque parte da coordenação ainda depende de uma base SDK não
  suficientemente encapsulada.

### Situação ideal

- `sdk/` vira camada fina e previsível;
- ownership de sessão ativa e registry migra para uma camada de orquestração adequada;
- `agent/` fala com `sdk/` por contratos mais estreitos.

---

## 4. Relação `agent ↔ observability`

### Estado atual

- `agent/` importa `observability` em muitos pontos relevantes;
- health, metrics, tracing, logs e spans atravessam o runtime principal;
- `observability/` já tem papel fundamental, mas ainda funciona mais como dependência onipresente do
  que como plataforma transversal governada.

### Consequências

- alta dependência operacional cruzada;
- risco de espalhar decisões de observabilidade pelo domínio de negócio;
- custos maiores para refatorar lifecycle, dialog e boot.

### Situação ideal

- `agent/` emite sinais e consome interfaces mínimas;
- `observability/` coleta e projeta, sem invadir modelagem de domínio desnecessariamente;
- `health-check` formal vira contrato claro, e não agregação oportunista.

---

## 5. Relação `agent ↔ hooks`

### Estado atual

- `session-setup` e partes do lifecycle ainda dependem de setup e composição de hooks;
- a fronteira melhorou, mas hooks continuam muito próximos do runtime do agente.

### Consequências

- políticas de permissão, prompt e tool interception ainda entram cedo demais no fluxo do runtime;
- risco de a camada de políticas continuar vazando decisões de orquestração.

### Situação ideal

- hooks operam como camada de política claramente situada entre configuração e execução;
- `agent/` depende de contracts/pipelines, não de detalhes internos do subsistema de hooks.

---

## 6. Relação `agent ↔ events` e `event-handlers`

### Estado atual

- mover handlers reais para `src/copilot/event-handlers/` foi um avanço importante;
- ainda existem sinais de compatibilidade residual dentro do `agent/`;
- o modelo de eventos do sistema permanece muito grande e muito presente no runtime.

### Consequências

- alta densidade de wiring e bridging;
- custo elevado para validar cobertura de eventos;
- naming, schema e ownership ainda não totalmente consolidados.

### Situação ideal

- contratos de eventos versionados/governados;
- `event-handlers/` como camada própria;
- `agent/` consumindo eventos necessários, sem voltar a hospedá-los por gravidade.

---

## 7. Relação `agent ↔ conversation-hub`

### Estado atual

- `agent-lifecycle` e rotas/serviços em torno do hub ainda compartilham ownership de sessão e estado
  conversacional;
- `conversation-hub/` ainda não assumiu plenamente seu papel em lifecycle e replay.

### Consequências

- ambiguidade entre sessão SDK, sessão do agente e sessão do hub;
- recuperação e compaction ficam mais difíceis de governar.

### Situação ideal

- lifecycle conversacional formal no hub;
- registry e replay com ownership claro;
- `agent/` foca a execução de turnos e o runtime do agente, não o inventário completo de sessões.

---

## 8. Relação `agent ↔ terminal`, `server` e `channel`

### Estado atual

- o terminal e o server continuam se cruzando mais do que o ideal;
- `channel/` participa da comunicação LLM-A ↔ LLM-B, mas ainda depende de fronteiras que não estão
  completamente explícitas;
- `agent/` segue sendo o pivô do runtime consumido por esses lados.

### Consequências

- risco de duplicação de health/status/turn-flow em camadas de apresentação;
- fronteira de apresentação e fronteira de orquestração ainda misturadas em alguns pontos.

### Situação ideal

- `agent/` expõe um runtime operacional claro;
- `server/` serve HTTP/Socket/SSE sem depender de detalhes de terminal;
- `terminal/` consome runtime e serviços específicos, não vira extensão informal do server;
- `channel/` opera como canal com contrato claro e responsabilidade própria.

---

## 9. Relação `agent ↔ tools`, `config`, `core`, `infra`, `types`

### Estado atual

- `agent/` ainda depende bastante de bootstrap, config builders, core utilities, timers, storage e
  tipos vindos de vários lugares;
- essa dependência não é errada por si só, mas a concentração simultânea de muitas delas na fachada
  principal aumenta o fan-in do módulo.

### Situação ideal

- `config/` constrói;
- `tools/` registra/expõe;
- `core/` fornece contrato e utilidades centrais;
- `infra/` cuida de recursos compartilhados;
- `types/` deixa de ser pequeno demais para a massa contratual que existe no sistema;
- `agent/` orquestra sem absorver funções alheias.

---

## 10. Diagnóstico consolidado do `agent/`

### O que já foi resolvido na direção certa

- simplificação do eixo de fila;
- início da partição do contexto;
- pipeline de boot mais legível;
- wiring de eventos mais declarativo;
- background tasks e health formal iniciados.

### O que ainda falta resolver para a próxima grande etapa

1. fechar a decomposição do `agent/` sem perder compatibilidade controlada;
2. diminuir o fan-in da fachada `always-alive.js`;
3. retirar ownership indevido do `sdk/` e consolidar fronteiras de sessão;
4. reorganizar o ecossistema de eventos/observabilidade em torno de contratos mais governáveis;
5. desacoplar melhor `server/`, `terminal/`, `channel/` e `conversation-hub` do runtime central do
   agente.

---

## 11. Situação ideal resumida para o `agent/`

O `agent/` ideal desta linha clean deve ser:

- pequeno o bastante para ser lido como **fachada e coordenação**;
- explícito o bastante para deixar claro onde moram:
  - lifecycle;
  - dialog;
  - sessão;
  - fila;
  - health;
  - background tasks;
- leve o bastante para **não ser o centro informal de todo `src/copilot/`**.

---

## 12. Conclusão

A auditoria de `agent/` confirma que o módulo não precisa de “mais do mesmo”, e sim de um programa
de rearquitetura que trate:

- o módulo em si;
- as suas fronteiras principais;
- e o custo de coordenação que ele impõe ao resto de `src/copilot/`.

Por isso, o novo roadmap clean não terá apenas uma “fase do agent”, mas sim vários programas
coordenados que partem dele e reorganizam as bordas sistêmicas ao seu redor.
