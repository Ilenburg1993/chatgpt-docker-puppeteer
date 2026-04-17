# R-01 — Auditoria Profunda: Resumo Executivo

**Data**: 2026-04-15
**Status**: concluída
**Escopo**: `src/copilot/` inteiro, com ênfase em `src/copilot/agent/`

---

## 1. Resumo em uma frase

`src/copilot/` tem base funcional forte e muita evolução incremental já entregue, mas continua operando com **ownership difuso entre `agent/`, `sdk/`, `observability/`, `server/` e `terminal/`**, o que torna o próximo ciclo necessariamente mais profundo do que uma simples continuação do plano anterior.

---

## 2. Diagnóstico executivo

### 2.1 O que está melhor do que antes

A auditoria confirma progresso real, especialmente no eixo do `agent/`:

- `AgentContext` já foi particionado internamente;
- fila e executor canônicos já foram deslocados para `agent-messaging.js`;
- o boot já está muito mais explícito, com `boot-wiring` + `boot-steps`;
- o wiring de eventos já saiu do corpo gordo de `always-alive.js`;
- `background-tasks.js` já existe e está integrado ao runtime;
- `health-check.js` já existe e foi conectado às rotas.

Ou seja: a base não está parada; ela está em transição arquitetural real.

### 2.2 O que continua quebrando a leitura do sistema

Mesmo com esse progresso, o sistema ainda sofre com:

1. **muitos imports transversais diretos**, especialmente para `sdk`, `observability` e `agent`;
2. **ownership de sessão e lifecycle ainda distribuído demais**;
3. **observability onipresente demais** para um módulo que deveria ser infraestrutura transversal, não dependência banalizada;
4. **fronteira server/terminal ainda porosa**;
5. **event model ainda grande demais e pouco governado**;
6. **dívida de compatibilidade ainda ativa** em pontos que já deveriam estar na fila de remoção;
7. **documentação histórica abundante, mas pouco curada** para orientar a próxima fase.

---

## 3. Principais achados estruturais

### A1 — `agent/` continua sendo o principal hotspot

- **62 arquivos / 8.248 linhas**
- continua sendo o maior módulo do recorte
- ainda concentra o maior custo de coordenação do sistema

### A2 — `sdk/` ainda está espalhado demais

- **96 arquivos fora de `sdk/`** importam `sdk` diretamente
- isso indica que a fronteira “SDK fino e stateless” ainda não foi consolidada

### A3 — `observability/` está acoplado demais ao restante

- **93 arquivos** importam `observability`
- isso é sintoma de logging/metrics/tracing sem camada de consumo mais controlada

### A4 — a fronteira `server/ ↔ terminal/` ainda é cara

- **11 imports** de `server` para `terminal`
- isso confirma que a camada de apresentação HTTP e a camada de terminal ainda compartilham demais

### A5 — o event model é dominante demais na topologia

- **713 referências** relacionadas a EventBus / emissão de eventos
- o problema aqui não é “usar eventos”; é usá-los em escala sem contrato suficientemente apertado

### A6 — documentação antiga está grande demais para continuar como hub único

- **141 MDs** só em `DOCUMENTAÇÃO/COPILOT/`
- forte sobreposição entre auditoria arquitetural, auditoria deep, auditoria SDK e plano de migração

### A7 — backlog estrutural e backlog de capabilities foram misturados

O material antigo junta, em diferentes lugares:

- cleanup arquitetural;
- refactor profundo de `agent/`;
- unificação de eventos;
- error pipeline;
- UX/terminal streaming;
- RPC/TSServer;
- documentação e governança.

O resultado é backlog rico, mas difícil de sequenciar sem uma nova taxonomia.

---

## 4. Diagnóstico específico do `agent/`

A auditoria do `agent/` aponta quatro verdades importantes:

### 4.1 O maior problema já não é “começar” a decomposição

A decomposição **já começou**.

O problema agora é **terminar corretamente**:

- consolidar `background tasks`;
- fechar a camada de health/runtime;
- remover compatibilidade residual;
- reduzir fan-in da fachada principal.

### 4.2 `always-alive.js` continua pesado porque ainda é ponto de convergência público

Mesmo mais fino do que antes, ele ainda agrega:

- API pública;
- coordenação com lifecycle;
- leitura de estado;
- health;
- wiring indireto.

### 4.3 `session/` e `dialog/` continuam sendo os subdomínios mais caros

Isso sugere que a próxima grande redução de custo cognitivo virá mais de **ownership e separação interna** do que de micro-refactors de barrel.

### 4.4 `turn-executor` não deve ser confundido com a fila

A auditoria reafirma a decisão recente: fundir `turn-executor.js` com o executor da fila seria um erro conceitual.

---

## 5. Situação ideal resumida

A situação ideal revisada para `src/copilot/` é:

- `agent/` como **fachada de orquestração**, não como depósito de tudo;
- `sdk/` como **camada fina e stateless**, com ownership de sessão fora dele;
- `observability/` como **infra transversal governada**, e não dependência direta de meio sistema;
- `events/` como **contrato governado**, não apenas catálogo volumoso;
- `server/`, `terminal/`, `channel/` e `conversation-hub/` com **limites de apresentação e orquestração mais claros**;
- `tools/`, `config/`, `core/`, `infra/` e `types/` operando como plataformas de suporte, não como acumuladores silenciosos de dívida;
- um backlog separado em:
  - base estrutural;
  - qualidade/governança;
  - capacidades futuras.

---

## 6. Recomendação executiva

A recomendação desta auditoria é **não seguir apenas acrescentando subfases ao plano antigo**.

O próximo ciclo deve ser regido por um novo roadmap com:

1. **programas de transformação bem delimitados**;
2. **dependências explícitas entre domínios**;
3. **gates de baseline, segurança e qualidade**;
4. **separação formal entre base obrigatória e capabilities futuras**.

Em termos práticos:

- primeiro fechar base e fronteiras;
- depois apertar governança e redução de dívida;
- só então expandir capacidades ambiciosas com tranquilidade.

---

## 7. Resultado desta auditoria profunda

Esta auditoria profunda alimenta diretamente os próximos documentos da série clean:

- `R-02` — mapa `as-is`;
- `R-03` — auditoria de `agent/` e integrações;
- `R-04` — arquitetura-alvo;
- `R-05` — matriz de gaps;
- `R-06` — roadmap master;
- `R-07` a `R-13` — programas estruturais e de governança;
- `R-15` — backlog de capacidades avançadas.

---

## 8. Conclusão

O sistema já tem massa crítica, mas ainda opera com um custo arquitetural alto demais para continuar crescendo de forma saudável só na força de correções incrementais isoladas.

A boa notícia é que a base já foi mexida o suficiente para permitir uma reestruturação séria.

A má notícia — que também é a notícia honesta — é que essa reestruturação precisa ser planejada como **programa amplo de rearquitetura**, não como sequência de pequenos tickets desconectados.
