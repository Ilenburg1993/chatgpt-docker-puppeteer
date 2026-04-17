# R-04A — End-state e Critérios de Sucesso da Arquitetura-Alvo

**Data**: 2026-04-16
**Status**: canônico para convergência arquitetural
**Relacionamento**: complemento operacional de `R-04-ARQUITETURA-ALVO-E-PRINCIPIOS.md`

---

## 1. Propósito

`R-04` já define a arquitetura-alvo em termos de princípios, camadas e ownership macro.

O problema é que, sem um documento complementar, parte importante do “alvo” continua distribuída entre:

- `R-04` (princípios e desenho);
- `R-07B` (ownership e contratos);
- `R-07C` (fronteiras e compatibilidade residual);
- `R-07D` (gates e risco);
- `R-16` (faixas, fases e checkpoints).

Este documento existe para transformar isso em uma pergunta operacional simples:

> **Como saberemos, com clareza, que a arquitetura ideal foi realmente atingida?**

Em outras palavras, `R-04A` define o **end-state explícito**, os **invariantes canônicos** e os
**critérios de sucesso** que devem orientar as próximas ondas profundas de transformação.

---

## 2. Diagnóstico curto: o alvo já existia, mas ainda estava implícito demais

Antes deste documento, a arquitetura ideal estava **parcialmente clara**, mas ainda não estava clara
o suficiente para servir como régua única de convergência.

O que já existia:

- princípios estruturais bem definidos em `R-04`;
- ownership e contratos de topo em `R-07B`;
- regras de fronteira em `R-07C`;
- gates e risco em `R-07D`;
- backlog de execução em `R-16`.

O que faltava:

- uma **imagem explícita do sistema ao final** da rearquitetura clean;
- uma definição clara do que é **sucesso arquitetural**, e não apenas “progresso local”;
- uma separação mais nítida entre:
  - mudança estrutural real;
  - melhoria local útil;
  - capability futura que ainda não deveria disputar a mesma fila.

Este documento fecha essa lacuna.

---

## 3. A arquitetura ideal que estamos buscando

## 3.1 Visão sintética do sistema-alvo

Ao final da rearquitetura clean, `src/copilot/` deve funcionar como um conjunto de SSOTs explícitas,
com fronteiras nítidas e poucas ambiguidades sobre quem manda em quê.

O modelo alvo é este:

```text
LLM-B runtime truth
  -> agent/

Conversation truth
  -> conversation-hub/

Transport truth (LLM-A <-> LLM-B)
  -> channel/

Vendor SDK facade (thin)
  -> sdk/

Shared edge projections
  -> presentation/

Remote edge
  -> server/

Local UX edge
  -> terminal/

Policy/runtime services
  -> tools/ hooks/ event-handlers/ config/

Cross-cutting governed infrastructure
  -> core/ infra/ db/ events/ observability/ audit/ types/ bridges/
```

O objetivo **não** é criar uma arquitetura academicamente perfeita.

O objetivo é atingir uma arquitetura em que:

- ownership seja inequívoco;
- fronteiras sejam sustentáveis;
- SSOTs não concorram entre si;
- o custo de mudar o sistema caia de forma relevante.

---

## 3.2 O que deve mudar muito em relação ao estado atual

### Hoje

- `agent/` ainda absorve coordenação demais;
- `sdk/` ainda participa demais do ownership operacional;
- `server/`, `terminal/` e outras bordas ainda carregam projeções e inferências locais demais;
- o modelo de eventos e observability ainda custa caro de governar;
- compatibilidade residual ainda ameaça virar permanente;
- parte do sistema ainda funciona por “coordenação implícita por costume”.

### No alvo

- `agent/` vira runtime core claro, e não balcão de tudo;
- `sdk/` vira facade previsível e fina;
- `presentation/` vira a única SSOT de projeções compartilhadas entre bordas;
- `conversation-hub/` vira dono inequívoco do domínio conversacional persistido;
- `channel/` vira contrato explícito de transporte;
- `observability/` e `events/` passam a ser infraestrutura governada, não conveniência espalhada;
- compatibilidade residual passa a ter prazo, dono e suite mínima.

---

## 4. SSOTs canônicas do sistema-alvo

Estas são as verdades únicas que a rearquitetura clean deve consolidar.

| Domínio                                        | SSOT canônica alvo                                                                            |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| runtime operacional da LLM-B                   | `agent/`                                                                                      |
| health operacional da LLM-B                    | `agent/health-check.js` + projections derivadas                                               |
| binding `hubSessionId ↔ sdkSessionId`          | `core/shared-state.js` + persistência no `ConversationStore` + projections em `presentation/` |
| store, replay, memória e sessão conversacional | `conversation-hub/`                                                                           |
| transporte LLM-A ↔ LLM-B                       | `channel/`                                                                                    |
| wrapper do vendor SDK                          | `sdk/`                                                                                        |
| handlers/projections compartilhados de borda   | `presentation/`                                                                               |
| naming/schema/ownership de eventos             | `events/`                                                                                     |
| error semantics de runtime                     | `agent/error-policy.js` + projeções canônicas de borda                                        |
| builders/defaults de config runtime            | `config/`                                                                                     |

Se duas SSOTs disputarem o mesmo aspecto do sistema, a rearquitetura ainda **não** terminou.

---

## 5. Invariantes canônicos da arquitetura ideal

## 5.1 Invariantes de fronteira

1. `server/` **não importa** `terminal/` diretamente.
2. `presentation/` **não importa** `server/` nem `terminal/`.
3. `sdk/` **não é dono** do ownership profundo de sessão, replay nem sessão conversacional.
4. `terminal/` continua livre para falar com `agent/`, `channel/`, `conversation-hub/` e `sdk/` quando isso for UX real da LLM-B.
5. `observability/` não volta a ser atalho para lógica de negócio.

## 5.2 Invariantes de ownership

1. Toda decisão sobre runtime da LLM-B converge para `agent/`.
2. Toda decisão sobre replay/memória/sessão persistida converge para `conversation-hub/`.
3. Toda projeção compartilhada entre `server/` e `terminal/` converge para `presentation/`.
4. Todo ownership de transporte LLM-A ↔ LLM-B converge para `channel/`.
5. Todo wrapper do vendor converge para `sdk/`, sem sugar ownership sistêmico para dentro dele.

## 5.3 Invariantes de governança

1. Não existe shim novo sem dono, fase de saída e suite mínima.
2. Não existe checkpoint estrutural sem explicitar qual SSOT ficou mais clara.
3. Não existe “sucesso” de checkpoint que não reduza acoplamento ou ambiguidade.
4. Não existe capability nova competindo com correção estrutural sem dependência explicitada.

---

## 6. Anti-objetivos explícitos

Este documento também define o que **não** é a arquitetura-alvo.

### Não queremos

- `terminal/` como pseudo-backend de conveniência para `server/`;
- `sdk/` como dono de sessão ativa, replay ou binding conversacional;
- `agent/` como “grande orquestrador mágico” onde tudo acaba caindo;
- `observability/` como módulo de lógica transversal informal;
- cada borda inventando sua própria projection de health/status/session;
- compatibilidade residual sem fim porque “ainda não incomoda tanto”.

Se a mudança melhora um arquivo, mas reintroduz um desses anti-objetivos, ela piora a arquitetura.

---

## 7. Critérios de sucesso por subsistema

## 7.1 `agent/`

O `agent/` só será considerado convergido quando:

- `always-alive.js` funcionar como fachada real;
- lifecycle, session, dialog e messaging forem lidos como subdomínios claros;
- `background-tasks`, `health-check` e `error-policy` estiverem estáveis como infraestrutura do runtime;
- shims prioritários deixarem de ser pontos de consumo normal do sistema;
- novas bordas não precisarem “adivinhar” estado do runtime via snapshots informais.

### Indicadores desejados

- `always-alive.js` aproximando-se da faixa **300–450L**;
- crescimento do `agent/` deixando de se concentrar em um único arquivo grande;
- regressões do eixo `agent/` cobertas por suites explícitas de domínio.

## 7.2 `sdk/`

O `sdk/` só será considerado convergido quando:

- o wrapper não concentrar registry nem ownership operacional profundo;
- `sdk/session/client.js` deixar de ser centro de decisão sobre binding conversacional;
- os principais consumidores externos falarem com superfícies mais neutras do que o wrapper cru;
- duplicações com `config/` estiverem reduzidas ou encerradas.

### Indicadores desejados

- nenhum novo estado operacional relevante nasce dentro do wrapper;
- imports diretos de `sdk/` fora do módulo continuam caindo contra a baseline;
- `server/routes/sdk/*` deixa de reinventar resolução de sessão.

## 7.3 `conversation-hub/`

O `conversation-hub/` só será considerado convergido quando:

- for claramente o dono de store, replay, memória e sessão conversacional;
- sincronização com a sessão SDK existir por contrato, não por inferência espalhada;
- restart/resume/restore estiverem alinhados ao runtime do agente;
- terminal e server consumirem suas superfícies sem duplicar regras locais.

## 7.4 `channel/`

O `channel/` só será considerado convergido quando:

- seu contrato de transporte estiver explícito;
- retry/timeout/reconnect tiverem semântica previsível;
- detalhes internos do runtime não vazarem arbitrariamente para seus consumidores;
- terminal e agente puderem consumi-lo como transporte, não como estado difuso.

## 7.5 `presentation/`, `server/` e `terminal/`

O eixo de borda só será considerado convergido quando:

- toda SSOT compartilhada entre `server/` e `terminal/` morar em `presentation/`;
- `server/` operar como presentation remota;
- `terminal/` operar como UX local da LLM-B;
- reducers de DI e wiring explícito forem materializados em `commands/`, `handlers/` e `dialog/` do terminal;
- o terminal continuar plenamente compatível com `agent/`, `channel/`, `conversation-hub/` e `sdk/` como interface operacional da LLM-B.
- existir uma camada interna explícita (`terminal/frontend/*`) para compor a UX principal da LLM-B, evitando reabrir integrações transversais em cada comando do REPL.

### Indicadores desejados

- `server → terminal` permanece em **0 imports estruturais diretos**;
- adapters finos continuam temporários e rastreados;
- contract tests do P4 crescem para proteger essas bordas.

## 7.6 `events/` e `observability/`

O eixo transversal só será considerado convergido quando:

- eventos tiverem naming, schema e ownership explícitos;
- `observability/` parar de funcionar como dependência reflexa de quase tudo;
- projections de health/erro/audit convergirem para contratos estáveis;
- collectors, observers e handlers deixarem de se sobrepor por hábito histórico.

## 7.7 `tools/`, `hooks/`, `config/`, `core/`, `infra/`, `types/`

O eixo de plataforma só será considerado convergido quando:

- `tools/` tiver governança forte sem vazar ownership para fora;
- `hooks/` ficar mais estreito como policy layer;
- `config/` for a casa inequívoca de builders/defaults;
- `core/` e `infra/` não virarem gaveta genérica;
- `types/` crescerem onde existe contrato compartilhado real, e não por acaso.

---

## 8. Critérios mensuráveis de sucesso arquitetural

Nem tudo que importa cabe num número, mas parte importante da convergência precisa ser mensurável.

## 8.1 Métricas estruturais duras

- `server → terminal` = **0 imports estruturais diretos** e permanece assim.
- shared handlers/projections de borda passam a viver em `presentation/`.
- session registry do SDK permanece fora do wrapper fino.
- binding `hubSessionId ↔ sdkSessionId` permanece com SSOT explícita cross-layer.
- checkpoints estruturais seguem rodando suites focadas do domínio afetado.

## 8.2 Métricas estruturais direcionais

Estas não precisam atingir um número mágico imediatamente, mas precisam evoluir de forma objetiva:

- imports diretos de `sdk/` fora do módulo devem cair continuamente contra a baseline;
- imports diretos de `observability/` fora do subsistema devem cair continuamente contra a baseline;
- compatibilidade residual deve diminuir checkpoint a checkpoint;
- hotspots de `agent/` devem redistribuir responsabilidade e reduzir concentração em poucos arquivos.

## 8.3 Critérios de checkpoint

Todo checkpoint estrutural relevante precisa responder, explicitamente:

1. qual SSOT ficou mais clara?
2. qual acoplamento caiu?
3. qual contrato ficou mais explícito?
4. quais suites e gates foram rodados?
5. qual risco operacional caiu, subiu ou ficou igual?

Se a resposta não estiver clara, provavelmente a mudança ainda é local demais para ser chamada de avanço arquitetural.

---

## 9. Definição de pronto da arquitetura-alvo

A rearquitetura clean só poderá ser considerada **estruturalmente concluída** quando as respostas abaixo forem majoritariamente “sim”:

1. Existe uma SSOT clara para cada domínio central do sistema?
2. `agent/`, `sdk/`, `conversation-hub/`, `channel/`, `presentation/`, `server/` e `terminal/` têm ownership legível?
3. As bordas compartilham projections via `presentation/`, e não via dependência acidental entre si?
4. O terminal continua sendo a interface operacional completa da LLM-B sem virar backend informal?
5. O SDK deixou de ser dono de state e ownership sistêmico?
6. O binding entre sessão SDK e sessão conversacional deixou de ser inferência espalhada?
7. Health, error semantics e observability convergiram para contratos canônicos?
8. Compatibilidade residual caiu de forma objetiva e rastreável?
9. Quality, security, tests, typing e docs operam como gates reais?
10. O backlog de capabilities avançadas ficou desacoplado do backlog estrutural?

Se três ou mais dessas respostas ainda forem “não”, o sistema ainda não convergiu o suficiente para ser tratado como base saudável.

---

## 10. Como usar este documento durante a execução

Este documento não substitui `R-16`; ele serve como a régua para interpretar se os checkpoints do roadmap realmente aproximam o sistema do alvo.

Uso recomendado:

- `R-04` responde **qual é a arquitetura-alvo**;
- `R-04A` responde **como reconhecer que ela foi atingida**;
- `R-07B/C/D` respondem **quem é dono do quê, quais fronteiras valem e quais gates precisamos respeitar**;
- `R-16` responde **em que ordem vamos atacar isso**.

Toda mudança estrutural importante deveria conseguir apontar para ao menos um critério deste documento e dizer: “foi isso que melhorou”.

---

## 11. Conclusão

O valor deste documento não está em inventar uma arquitetura nova em cima da arquitetura-alvo já existente.

O valor está em transformar o target em uma régua mais objetiva.

Sem isso, o sistema corre o risco de continuar evoluindo por muitos checkpoints corretos localmente, mas sem uma noção forte o suficiente de chegada.

Com isso, a rearquitetura clean ganha uma definição mais rigorosa de sucesso:

> **menos ambiguidade de ownership, menos SSOTs concorrentes, menos fronteiras porosas e mais capacidade de evoluir sem reabrir a fundação a cada novo avanço.**
