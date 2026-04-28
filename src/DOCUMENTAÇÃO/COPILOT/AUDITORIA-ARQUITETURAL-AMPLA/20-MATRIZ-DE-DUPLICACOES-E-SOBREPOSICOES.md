# 20 — Matriz de Duplicações, Sobreposições e Owners Concorrentes

**Status**: auditoria ativa **Última atualização**: 2026-04-27 **Escopo desta etapa**: mapear onde
`src/copilot/` possui responsabilidades duplicadas, concorrentes, parcialmente redundantes ou
semanticamente mal delimitadas.

---

## 1. Objetivo deste documento

Toda arquitetura densa sofre menos por “falta de módulos” e mais por **módulos demais resolvendo
partes do mesmo problema por caminhos diferentes**.

Este documento consolida precisamente isso.

Perguntas respondidas aqui:

1. onde há duplicação funcional real ou potencial;
2. onde há owners concorrentes da mesma semântica;
3. onde a duplicação é legítima e onde é smell;
4. qual owner TO-BE deve vencer cada disputa;
5. quais migrações serão necessárias.

---

## 2. Escala de classificação

Cada sobreposição abaixo recebe uma classificação:

- **legítima** — duas camadas participam do mesmo fluxo, mas com papéis distintos e bem definidos;
- **tolerável** — há overlap hoje, mas ele é administrável no curto prazo;
- **crítica** — owners concorrentes ou semântica replicada exigem correção estrutural.

---

## 3. Matriz-mestra de sobreposição

| Tema / Responsabilidade                | Owners atuais envolvidos                               | Diagnóstico preliminar | Owner TO-BE principal               |
| -------------------------------------- | ------------------------------------------------------ | ---------------------- | ----------------------------------- |
| capacidade vanilla do SDK              | `sdk/`, partes de `agent/`, bordas `/sdk`              | tolerável              | `sdk/`                              |
| sessão ativa viva                      | `sdk/`, `agent/`, `channel/`                           | crítica                | `agent/` sobre `sdk`                |
| sessão persistida / replay / store     | `conversation-hub/`, `agent/`                          | crítica                | `conversation-hub/`                 |
| tradução de eventos SDK                | `event-handlers/`, `events/`, às vezes bordas          | tolerável              | `event-handlers/`                   |
| gramática/nomeação de eventos internos | `events/`, `observability/`, `event-handlers/`         | tolerável              | `events/`                           |
| policy e callbacks do SDK              | `hooks/`, partes de `agent/`, `tools/`                 | crítica                | `hooks/`                            |
| capabilities executáveis               | `tools/`, `sdk/tools/*`, `plugins/`                    | tolerável              | `tools/` + `sdk/tools/*` infra only |
| projeção compartilhada de borda        | `presentation/`, `server/`, `terminal/`                | crítica                | `presentation/`                     |
| observabilidade operacional            | `observability/`, `audit/`, `logs/`                    | crítica                | `observability/`                    |
| trilha de auditoria                    | `audit/`, `observability/`, `logs/`                    | crítica                | `audit/`                            |
| transporte LLM-A ↔ LLM-B               | `channel/`, `terminal/`, `agent/`                      | crítica                | `channel/`                          |
| integração externa                     | `bridges/`, `tools/`, `agent/`, `server/terminal`      | tolerável              | `bridges/`                          |
| configuração declarativa               | `config/`, `boot/`, `sdk-config-port`, arquivos locais | tolerável              | `config/` + `boot/`                 |
| contracts transversais                 | `types/`, barrels locais, arquivos de typedefs         | tolerável              | `types/` (somente transversal)      |
| protocolo dialog READY/REPLY           | `dialog/`, `agent/dialog/*`, `terminal/dialog/*`       | crítica                | `dialog/` ou contracts/protocols    |
| extensão modular                       | `plugins/`, `tools/`, `hooks/`, `bridges/`             | crítica                | a definir explicitamente            |

---

## 4. Sobreposições críticas, uma a uma

## 4.1 `sdk/` vs `agent/` — capabilities vanilla vs runtime vivo

### O que há de overlap

- `sdk/` possui sessão, lifecycle, RPC, UI, tools, provider capabilities;
- `agent/` governa o runtime contínuo que usa essas capacidades.

### Quando isso é legítimo

É legítimo quando:

- `sdk/` define a semântica vanilla;
- `agent/` decide como e quando isso é usado no runtime local.

### Onde vira problema

Vira problema quando:

- `agent/` recompõe capabilities vanilla sem passar por wrapper/facade;
- ou quando `sdk/` passa a carregar semântica de runtime local.

### Decisão TO-BE

- `sdk/` vence como owner de vanilla;
- `agent/` vence como owner de runtime vivo.

Classificação: **crítica**, mas com direção correta já em andamento.

---

## 4.2 `agent/` vs `conversation-hub/` — quem é dono da sessão?

### O que há de overlap

- `agent/` lida com sessão viva, dialog loop, queue e lifecycle ativo;
- `conversation-hub/` lida com multi-sessão, store e persistência conversacional.

### Onde há risco real

Ambos tangenciam:

- turns;
- state;
- ownership;
- replay;
- memory;
- realtime.

### Decisão TO-BE

- `agent/` = sessão ativa viva;
- `conversation-hub/` = sessão persistida, replay, multi-sessão e store.

Classificação: **crítica**.

---

## 4.3 `hooks/` vs `agent/` vs `tools/` — policy vs capability vs runtime control

### O que há de overlap

- `hooks/` intercepta decisões do SDK;
- `tools/` implementa capabilities;
- `agent/` às vezes participa do fluxo ou decide continuidade.

### Risco

Se esses três módulos não tiverem fronteira explícita, surgem bugs de tipo:

- capability decidindo policy;
- policy carregando fluxo de runtime;
- runtime reescrevendo policy localmente.

### Decisão TO-BE

- `hooks/` = policy/callbacks do SDK;
- `tools/` = capability executável;
- `agent/` = lifecycle e continuidade do runtime.

Classificação: **crítica**.

---

## 4.4 `presentation/` vs `server/` vs `terminal/` — quem projeta a semântica para a borda?

### O que há de overlap

- `presentation/` existe para projetar semântica compartilhada;
- `server/` e `terminal/` frequentemente também têm dados/handlers próprios.

### Quando isso é legítimo

É legítimo que bordas tenham:

- adaptação de protocolo;
- UX ou payload final;
- rotas/comandos.

### Onde vira problema

Quando `server/` ou `terminal/`:

- calculam snapshots que já poderiam vir de `presentation/`;
- duplicam projeções;
- reinterpretam runtime por conta própria.

### Decisão TO-BE

- `presentation/` vence como owner de projeção compartilhada;
- `server/terminal` só adaptam a última milha.

Classificação: **crítica**.

---

## 4.5 `events/` vs `event-handlers/` vs `observability/`

### O que há de overlap

Todos lidam com eventos, mas por papéis diferentes:

- `event-handlers/` traduz vanilla;
- `events/` nomeia/cataloga sinais internos;
- `observability/` observa/correlaciona.

### Risco

O risco aqui não é duplicação total; é **semântica sutilmente replicada**.

### Decisão TO-BE

- `event-handlers/` traduz;
- `events/` define a gramática;
- `observability/` consome.

Classificação: **tolerável**, mas requer disciplina permanente.

---

## 4.6 `observability/` vs `audit/` vs `logs/`

### O que há de overlap

Todos tratam evidência operacional, mas com naturezas distintas:

- `observability/` = medir/correlacionar;
- `audit/` = governar/preservar trilha;
- `logs/` = output artifact.

### Risco

Se esses três não forem separados:

- log vira auditoria;
- auditoria vira métrica;
- arquivo de output vira owner implícito de semântica.

### Decisão TO-BE

- `observability/` vence observação operacional;
- `audit/` vence trilha de governança;
- `logs/` é rebaixado a artefato.

Classificação: **crítica**.

---

## 4.7 `tools/` vs `sdk/tools/*`

### O que há de overlap

Ambos usam a palavra “tools”, mas representam coisas diferentes:

- `sdk/tools/*` = envelope/registry/state vanilla do wrapper;
- `tools/` = capabilities reais do runtime local.

### Decisão TO-BE

A duplicação é apenas nominal, não semântica — desde que continue assim.

Classificação: **legítima**.

---

## 4.8 `plugins/` vs `tools/` / `hooks/` / `bridges/`

### O que há de overlap

`plugins/` pode carregar extensões dos tipos:

- tool
- hook
- bridge
- service

Isso o coloca em disputa conceitual com os módulos que ele pretende estender.

### Risco

- `plugins/` virar outro registry concorrente;
- `tools/hooks/bridges` seguirem como owners reais e `plugins/` ficar ornamental;
- ou o contrário, `plugins/` virar bypass da arquitetura.

### Decisão TO-BE

É preciso decidir se `plugins/` será:

- API de extensibilidade pública real;
- ou apenas mecanismo interno de composição modular.

Classificação: **crítica**.

---

## 4.9 `dialog/` vs `agent/dialog/*` vs `terminal/dialog/*`

### O que há de overlap

- `dialog/` define protocolo;
- `agent/dialog/*` executa parte do loop/runtime;
- `terminal/dialog/*` implementa borda/UX/dialog engine.

### Leitura

Isto pode ser uma divisão saudável, mas o naming ainda deixa espaço para ambiguidade.

### Decisão TO-BE

- `dialog/` deve ser explicitamente reconhecido como protocolo compartilhado;
- `agent/dialog/*` como runtime dialog domain;
- `terminal/dialog/*` como adapter/UX.

Classificação: **crítica**, por naming e semântica ainda pouco cristalinos.

---

## 5. Sobreposições toleráveis que não exigem destruição

## 5.1 `config/` vs `boot/`

- `config/` descreve/configura;
- `boot/` resolve e organiza o processo de inicialização.

Isto é saudável, desde que `boot/` não vire registry declarativo e `config/` não vire orquestrador.

Classificação: **tolerável**.

## 5.2 `bridges/` vs `tools/`

- bridges integram sistemas externos;
- tools podem encapsular ou expor capabilities apoiadas em bridges.

Classificação: **tolerável**.

## 5.3 `types/` vs typedefs locais

É normal que cada módulo tenha typedefs locais e que `types/` concentre somente os realmente
transversais.

Classificação: **tolerável**.

---

## 6. Clusters de owner acidental mais perigosos

### Cluster A — sessão, memória e conversa

Módulos envolvidos:

- `sdk/`
- `agent/`
- `conversation-hub/`
- `channel/`
- `presentation/`

Risco:

- múltiplos módulos tangenciando “sessão” com significados diferentes.

### Cluster B — signals, callbacks e observação

Módulos envolvidos:

- `hooks/`
- `event-handlers/`
- `events/`
- `observability/`
- `audit/`

Risco:

- sinais sendo traduzidos, classificados, observados e auditados por rotas concorrentes.

### Cluster C — capacidades e extensibilidade

Módulos envolvidos:

- `tools/`
- `sdk/tools/*`
- `plugins/`
- `bridges/`

Risco:

- capability, extension e adapter confundirem-se.

---

## 7. Quais duplicações devem ser preservadas como tensão produtiva

Nem toda duplicação deve morrer.

Algumas devem existir como **tensão produtiva com papéis diferentes**:

1. `sdk/` e `agent/`
2. `event-handlers/` e `events/`
3. `presentation/` e `server/terminal`
4. `bridges/` e `tools/`
5. `config/` e `boot/`

A meta da revolução arquitetural não é colapsar tudo em menos módulos.

A meta é fazer com que cada duplicação restante seja:

- intencional;
- documentada;
- policed;
- não ambígua.

---

## 8. Decisões preliminares desta etapa

### D20-01

A principal disputa arquitetural de `src/copilot` é **ownership de sessão/conversa/runtime**.

### D20-02

A segunda principal disputa é **quem define policy, quem executa capability e quem apenas observa**.

### D20-03

A terceira principal disputa é **quem projeta para borda e quem apenas expõe protocolo**.

### D20-04

A revolução TO-BE deve reduzir owners concorrentes, não apenas mover arquivos.

---

## 9. Conclusão desta etapa

A matriz de duplicações mostra que `src/copilot` já tem vários owners corretos — o problema é que
eles convivem com owners parciais ou acidentais em torno dos mesmos temas.

A transformação ideal, portanto, será menos uma limpeza cosmética e mais uma operação de:

- definição de soberania por responsabilidade;
- redução de owners concorrentes;
- reforço radical de seams canônicos.
