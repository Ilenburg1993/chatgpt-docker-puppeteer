# 27 — Checklist de Seams Oficiais por Módulo

**Status**: baseline de seams canônicos **Última atualização**: 2026-04-27 **Escopo desta etapa**:
registrar, módulo a módulo, quais seams são considerados oficiais na arquitetura atual/TO-BE e quais
caminhos devem ser evitados ou proibidos.

---

## 1. Objetivo deste documento

A revolução arquitetural só será sustentável se houver resposta clara para a pergunta:

> por qual caminho um módulo deve conversar com outro?

Este documento transforma isso em checklist operacional.

Ele não substitui os gates. Ele os antecede e fundamenta.

---

## 2. Legenda

| Tipo de seam | Significado                                     |
| ------------ | ----------------------------------------------- |
| **oficial**  | seam preferencial, explícito e desejado         |
| **tolerado** | aceitável no curto prazo, mas não ideal         |
| **proibido** | regressão arquitetural ou anti-fronteira        |
| **exceção**  | uso delimitado, documentado e não generalizável |

---

## 3. Checklist por módulo

## 3.1 `sdk/`

### Seams oficiais

- `#copilot/sdk` barrel público;
- wrappers internos L1;
- emitter/port de telemetria L1;
- consumo por `agent/facades/*` e `agent/ports/*`.

### Seams tolerados

- adapters `/server/routes/sdk/*` para exposição HTTP do SDK wrapper.

### Seams proibidos

- qualquer import direto de `@github/copilot-sdk` fora de `src/copilot/sdk/`;
- qualquer crude call fora de `sdk/`.

---

## 3.2 `agent/`

### Seams oficiais

- consumo do SDK por façades/ports;
- surfaces públicas via `#copilot/agent`;
- runtime registry e snapshots semânticos;
- contracts com `presentation/` e `conversation-hub/`.

### Seams tolerados

- alguns acessos internos ainda via contexto vivo enquanto a purificação do runtime não termina.

### Seams proibidos

- domínio quente importando detalhes internos do SDK fora de `facades/ports`;
- bordas consumindo helpers internos soltos do `agent/` em vez de superfícies canônicas.

---

## 3.3 `event-handlers/`

### Seams oficiais

- input vanilla do SDK;
- output para sinais internos/catálogo `events/`;
- logging/observability como consumer secundário.

### Seams proibidos

- projection de borda;
- store persistido;
- runtime command orchestration.

---

## 3.4 `events/`

### Seams oficiais

- barrel/catálogo de nomes e namespaces;
- consumo por runtime, observability, audit e bordas.

### Seams proibidos

- tradução do SDK;
- lógica de protocol adapter;
- ownership de observação ou auditoria.

---

## 3.5 `hooks/`

### Seams oficiais

- callbacks do SDK;
- factories/composer/registry/presets de policy;
- consumo por `agent/context-factories` e wiring de sessão.

### Seams tolerados

- helpers operacionais estritamente vinculados a slots do SDK.

### Seams proibidos

- imports de runtime `agent/` como owner alternativo;
- projection de borda;
- store de domínio.

---

## 3.6 `tools/`

### Seams oficiais

- `#copilot/sdk` para envelope/tool creation;
- `boot/`, `config/`, `bridges/`, `observability/`, `audit/` como dependências auxiliares;
- exposição via barrel `#copilot/tools`.

### Seams proibidos

- policy decidida localmente em lugar de `hooks/`;
- projeção para borda como owner.

---

## 3.7 `presentation/`

### Seams oficiais

- consumo de `#copilot/agent`;
- consumo de `#copilot/conversation-hub`;
- consumo de `config/`, `bridges/`, `observability/`, `audit/` quando necessário;
- exposição via `#copilot/presentation`.

### Seams proibidos

- runtime import do SDK wrapper;
- cálculo de semântica vanilla;
- acesso cru a internals de bordas.

---

## 3.8 `server/`

### Seams oficiais

- `presentation/` como shared edge layer;
- `sdk/` nas rotas `/sdk` específicas;
- route deps explícitos.

### Seams proibidos

- imports oportunistas de helpers internos do `agent/`;
- reconstrução de projection que deveria nascer em `presentation/`.

---

## 3.9 `terminal/`

### Seams oficiais

- `presentation/` para projeções compartilhadas;
- `channel/` para transporte interno LLM-A ↔ LLM-B;
- `bridges/`, `config/`, `boot/` para concerns de borda.

### Seams proibidos

- importar runtime interno cru quando já houver gateway/ façade;
- owner local de semântica conversacional persistida.

---

## 3.10 `conversation-hub/`

### Seams oficiais

- stores/contracts próprios;
- relação explícita com `agent/`;
- consumo por `presentation/` e por bordas via projection.

### Seams tolerados

- consumo do barrel público do `agent/` enquanto os contratos não estiverem mais refinados.

### Seams proibidos

- deep-imports do `agent/`;
- ownership de runtime ativo.

---

## 3.11 `channel/`

### Seams oficiais

- `agent/` como runtime peer público;
- `config/`, `boot/`, `events/`, `observability/` para concerns de transporte;
- barrel `#copilot/channel`.

### Seams proibidos

- imports de `conversation-hub/`;
- imports de `presentation/`;
- imports de `server/` ou `terminal/` como owners de transporte.

---

## 3.12 `bridges/`

### Seams oficiais

- `core/`, `config/`, `sdk/`, `observability/`;
- DI tokens/activation por runtime wiring.

### Seams proibidos

- imports diretos de runtime do `agent/` como dependência geral;
- projeções/borda.

---

## 3.13 `infra/`

### Seams oficiais

- primitives técnicas compartilhadas;
- consumo por `server`, `terminal`, `sdk`, `agent` apenas como substrate.

### Seams proibidos

- semântica de domínio viva/persistida embutida no substrate.

---

## 3.14 `plugins/`

### Seams oficiais (provisórios)

- DI container;
- registry e discovery controlados;
- integração com tools/hooks/bridges via instalação declarada.

### Seams proibidos

- bypass de fronteiras oficiais;
- extensão arbitrária sem governance explícita.

---

## 3.15 `config/`, `boot/`, `types/`, `dialog/`

### `config/`

- seams oficiais: `core/`, ports explícitos, builders declarativos.
- proibido: runtime owner behavior.

### `boot/`

- seams oficiais: `config/`, `core/`, composition roots.
- proibido: virar runtime domain helper genérico.

### `types/`

- seams oficiais: contratos realmente transversais.
- proibido: barrel gigantesco de conveniência.

### `dialog/`

- seams oficiais: protocolo compartilhado.
- proibido: crescer como domínio paralelo não classificado.

---

## 4. Seams de exceção legitimados

Atualmente, esta auditoria reconhece algumas exceções documentadas como legítimas:

1. `server/routes/sdk/*` consumindo `sdk/` diretamente por ser adapter específico da superfície SDK.
2. `observability/bootstrap.js` como seam deliberado de composição cross-cutting.
3. `types/index.js` como contract surface transversal controlada.
4. `conversation-hub/` ainda consumindo `#copilot/agent` por seam público enquanto a soberania de
   sessão é refinada.

Essas exceções devem permanecer **explícitas e pequenas**.

---

## 5. Uso deste checklist no Bloco A

Este documento materializa o requisito W5 do Bloco A:

- ele serve de base para o gate executável de seams oficiais;
- ele define o que os testes estruturais devem vigiar;
- ele ajuda reviewers a julgar novos imports sem depender apenas de intuição.

---

## 6. Conclusão desta etapa

A arquitetura deixa de depender apenas de “boas intenções de importação” quando os seams oficiais se
tornam explícitos. Este checklist é a primeira formalização dessa disciplina e será endurecido pelas
próximas waves do programa.
