# 16 — `bridges/`, `infra/`, `channel/` e `plugins/`

**Status**: auditoria ativa **Última atualização**: 2026-04-27 **Escopo desta etapa**: auditar os
módulos que conectam o runtime Copilot a infraestruturas externas, transportes, registries técnicos
e superfícies de extensibilidade.

---

## 1. Objetivo deste documento

Este documento cobre o grupo de módulos que mais facilmente vira uma **zona cinzenta arquitetural**
em sistemas com crescimento rápido:

- adapters externos;
- transporte entre superfícies;
- infraestrutura técnica compartilhada;
- mecanismos de extensibilidade;
- registries que começam técnicos e acabam semânticos.

O foco aqui é responder:

1. o que cada um desses módulos faz **de fato** hoje;
2. onde ele é adapter legítimo e onde já ameaça virar owner de domínio;
3. quais responsabilidades estão corretamente posicionadas;
4. quais precisam ser rebaixadas, separadas ou endurecidas;
5. como esse grupo deve existir no TO-BE revolucionado de `src/copilot`.

---

## 2. Visão arquitetural do grupo

| Módulo     | Natureza predominante         | Função atual resumida                                           | Risco principal                                 |
| ---------- | ----------------------------- | --------------------------------------------------------------- | ----------------------------------------------- |
| `bridges/` | adapters externos             | integra Git, GitHub CLI, MCP e NERV ao runtime                  | virar orquestrador paralelo                     |
| `infra/`   | infraestrutura técnica        | fila, lockfile, SSE infra, registry de sessões SDK e storage    | acumular semântica de domínio                   |
| `channel/` | transporte/runtime bridge     | ponte LLM-A ↔ LLM-B por client em-processo e por injection HTTP | misturar transporte com domínio conversacional  |
| `plugins/` | superfície de extensibilidade | registry/descoberta/ativação de plugins por DI                  | ter forma de extensão sem estratégia de produto |

Leitura central desta etapa:

> estes módulos são necessários, mas só permanecem saudáveis se sua missão for rigidamente limitada.

Quando esses módulos crescem sem vigilância, passam a competir com:

- `agent/` no domínio vivo;
- `presentation/` na projeção compartilhada;
- `tools/` na capability executável;
- `hooks/` na policy;
- `conversation-hub/` na orquestração multi-sessão.

---

## 3. `bridges/` — adapters externos legítimos, mas estruturalmente perigosos

## 3.1 Base factual observada

`bridges/README.md` declara `bridges/` como **L3**, explicitamente responsável por conectar o
Copilot ao mundo externo:

- NERV;
- MCP;
- Git;
- GitHub.

O barrel `bridges/index.js` reforça essa leitura:

- Git bridge (`git-bridge.js`);
- MCP bridge (`mcp-tool-bridge.js`);
- NERV event bus adapter;
- integração GitHub CLI em `gh/`;
- tokens DI como `BRIDGE_AGENT`, `NERV_BRIDGE_AGENT`, `PERMISSION_AGENT`.

O `mcp-tool-bridge.js` é particularmente ilustrativo:

- consulta um registry externo via HTTP;
- projeta tools MCP em custom tools do SDK;
- mede saúde/latência;
- usa circuit breaker e health snapshot;
- registra métricas e spans.

Isso mostra que `bridges/` não é um diretório ornamental: ele já é um **owner legítimo de adapters
externos**.

## 3.2 Missão atual correta

A missão correta e já parcialmente realizada de `bridges/` é:

1. traduzir contratos externos em contratos consumíveis pelo runtime local;
2. encapsular protocolos externos;
3. isolar failures, health, retries e circuit breaking desses sistemas;
4. evitar que `agent/`, `server/`, `terminal/` ou `presentation/` falem diretamente com
   Git/MCP/NERV.

## 3.3 Onde começa `bridges/`

`bridges/` deve começar quando surge qualquer necessidade de:

- falar com processo externo;
- falar com infraestrutura remota;
- adaptar semântica de outro ecossistema;
- traduzir erro, health e payload de terceiro.

Exemplos legítimos:

- CLI `gh`;
- protocolo MCP;
- adapters Git;
- event bus NERV.

## 3.4 Onde `bridges/` deve terminar

`bridges/` **não** deve:

- decidir lifecycle do agente;
- decidir ownership de sessão;
- decidir projections HTTP/terminal;
- executar policy de segurança;
- orquestrar replay/memory;
- expor store próprio de estado funcional de domínio.

Em outras palavras:

- ele pode informar health/status/capabilities externas;
- ele não pode virar segundo runtime.

## 3.5 Tensão principal

A tensão mais importante de `bridges/` é:

> adapter rico demais começa a se parecer com domínio.

Isso já aparece em bridges que fazem:

- health model;
- retry policy;
- metric emission;
- circuit breaker;
- registry discovery.

Nada disso é errado.

Mas exige uma regra forte:

> o bridge pode ser inteligente sobre o sistema externo, mas não pode se tornar owner do fluxo
> interno.

## 3.6 Situação ideal para `bridges/`

No TO-BE:

- `bridges/` permanece como módulo de adapters externos;
- cada bridge deve ter:
  - contrato de entrada/saída explícito;
  - health snapshot explícito;
  - error taxonomy explícita;
  - integração por DI ou façade, não por imports oportunistas;
- todo consumo de bridge por borda deve passar por:
  - `agent/` se for runtime state/action;
  - `presentation/` se for projection;
  - `server/terminal` apenas como adapter final.

### Decisão preliminar

`bridges/` é módulo legítimo e deve ser **endurecido**, não removido.

---

## 4. `infra/` — infraestrutura técnica saudável, mas sempre em risco de drift semântico

## 4.1 Base factual observada

`infra/index.js` mostra que `infra/` contém hoje:

- lockfile;
- `AsyncQueue`;
- registry de sessões SDK ativas;
- SSE infra (`fanout`, replay buffer, client pools);
- storage utilitário.

Isso é um sinal forte de que `infra/` funciona como camada de **substrato técnico compartilhado**.

O ponto mais sensível aqui é `sdk-session-registry.js`:

- trata sessões SDK ativas do processo;
- centraliza state antes espalhado em wrapper do SDK;
- faz sentido como registry técnico de processo;
- mas fica perigosamente perto de semântica de lifecycle.

A SSE infra também é estruturalmente interessante:

- foi movida para `infra/sse/` por ser usada por `server/` e `terminal/`;
- isso reforça o papel de `infra/` como shared technical substrate.

## 4.2 Missão atual correta

`infra/` deve ser:

- provider de utilidades técnicas reutilizáveis;
- owner de mecanismos infraestruturais neutros;
- sem semântica de negócio como owner principal.

Exemplos legítimos:

- fila genérica;
- replay buffer;
- fanout SSE;
- storage utilitário;
- lockfile;
- registry técnico de handles/process resources.

## 4.3 Onde `infra/` começa

`infra/` começa quando o problema é:

- coordenação técnica;
- buffering/transporte genérico;
- serialization/utilitário;
- registry técnico sem significado semântico próprio.

## 4.4 Onde `infra/` deve terminar

`infra/` não deve decidir:

- ownership de sessão;
- handoff entre agentes;
- autorização;
- projeção de UI;
- política de retry por domínio;
- semântica conversacional.

## 4.5 Sinais de risco

### 4.5.1 `sdk-session-registry.js`

Este arquivo está provavelmente **bem posicionado hoje**, mas exige vigilância.

Ele pode ser:

- registry técnico de handles ativos — bom;
- ou embrião de owner semântico de lifecycle de sessão — ruim.

### 4.5.2 `sse/`

SSE em `infra/` é coerente se continuar:

- genérico;
- parametrizável;
- sem lógica de domínio embutida.

Se começar a carregar semântica específica de runtime/agent/terminal, deve ser redividido.

## 4.6 Situação ideal para `infra/`

No TO-BE:

- `infra/` fica mais claramente limitado ao técnico;
- qualquer módulo que precise de `infra/` deve receber:
  - primitives;
  - registries técnicos;
  - fanout/buffer;
  - storage helpers;
  - nunca fluxo de domínio pronto.

### Decisão preliminar

`infra/` deve ser **dividido conceitualmente e endurecido**:

- manter o que é substrate técnico;
- remover ou realocar o que começar a virar owner semântico.

---

## 5. `channel/` — transporte legítimo, mas com fronteira conceitual muito delicada

## 5.1 Base factual observada

`channel/README.md` define `channel/` como camada L5 de comunicação LLM-A ↔ LLM-B via
`AlwaysAliveAgent`.

O módulo tem dois modos explícitos:

- HTTP injection (`inject.js`) quando o terminal está ativo;
- SDK client em-processo (`client.js`) quando o runtime está embutido.

O barrel `channel/index.js` descreve isso como um **canal de comunicação entre LLM-A e LLM-B**, com
versão de protocolo (`CHANNEL_VERSION`) e typedefs próprios.

O `client.js` mostra um client de alto nível com:

- histórico local;
- listeners de streaming;
- retries;
- timeout guards;
- integração com eventos do runtime.

O `inject.js` mostra:

- HTTP injection para o terminal;
- rate limit client-side;
- health check;
- SSE subscription;
- adaptive timeout.

## 5.2 Leitura arquitetural atual

`channel/` claramente já é mais do que “um helper”.

Hoje ele é:

- transporte;
- façade conversacional entre duas entidades lógicas do sistema;
- adaptador de execução local/remota do mesmo propósito.

Isso explica por que ele é arquiteturalmente sensível.

## 5.3 O que `channel/` deve ser

Idealmente, `channel/` deve ser owner de:

- transporte e protocolo LLM-A ↔ LLM-B;
- abstração de envio/recebimento entre operador interno e runtime remoto/local;
- details de injection, streaming, reply capture e boot readiness.

## 5.4 O que `channel/` não deve ser

`channel/` não deve virar:

- owner do runtime do agente;
- owner de sessão persistida;
- owner de multi-sessão;
- owner de projection pública HTTP;
- owner de política de diálogo.

A separação correta é:

- `channel/` = caminho de transporte e protocolo entre duas pontas internas;
- `conversation-hub/` = domínio multi-sessão persistida;
- `agent/` = runtime vivo da sessão ativa;
- `terminal/` = borda humana.

## 5.5 Tensão estrutural

A grande tensão é:

> `channel/` usa runtime, eventos, timeouts, SSE e histórico; isso o aproxima de domínio.

Portanto o TO-BE precisa endurecer uma distinção:

- **histórico local de transporte** é aceitável;
- **store conversacional verdadeira** pertence a `conversation-hub/`;
- **lifecycle do dialog loop** pertence a `agent/`;
- **renderização/UX** pertence a `terminal/`.

## 5.6 Situação ideal para `channel/`

No estado ideal:

- `channel/` fica como módulo especializado de transporte/bridge local interno;
- deve expor contratos pequenos e estáveis;
- deve depender do mínimo de semântica de runtime;
- todo enriquecimento analítico deve ficar fora dele.

### Decisão preliminar

`channel/` deve ser **convergido e clarificado**, não extinto.

---

## 6. `plugins/` — fundação plausível, mas ainda subdefinida como estratégia de produto

## 6.1 Base factual observada

`plugins/index.js` e `plugin-registry.js` mostram que já existe uma fundação funcional:

- contrato de `CopilotPlugin`;
- tipos: `tool`, `hook`, `bridge`, `service`;
- instalação via DI container;
- registry com validação;
- `discoverPlugins()` por subdiretórios convencionais;
- `activatePlugins()` por whitelist.

Isso não é mero placeholder.

Existe um mecanismo de extensibilidade real em embrião.

## 6.2 Diagnóstico atual

O problema de `plugins/` não é falta de código.

O problema é falta de **papel estratégico consolidado**.

Perguntas em aberto:

1. plugins são extensibilidade pública de produto?
2. plugins são apenas composição interna modular?
3. plugins serão usados para carregar tools/hook packs de terceiros?
4. plugins substituirão parte de `bridges/`/`tools/`/`hooks/` no futuro?

Sem essa resposta, `plugins/` corre o risco de ficar eternamente entre:

- infraestrutura de extensão;
- experimento estrutural;
- compat shim glorificado.

## 6.3 Onde `plugins/` deve começar

`plugins/` deve começar quando o sistema quiser permitir:

- montagem declarativa de capacidades;
- discoverability de extensões;
- instalação desacoplada por DI;
- ativação seletiva de blocos não-core.

## 6.4 Onde `plugins/` deve terminar

`plugins/` não deve ser:

- dumping ground de módulos sem dono;
- segundo registry de tools sem governança;
- bypass para regras de fronteira;
- substituto informal de `hooks/`, `bridges/` ou `tools/`.

## 6.5 Situação ideal para `plugins/`

Há dois caminhos legítimos:

### Caminho A — extensão real de produto

- plugin API pública;
- contratos estáveis;
- discovery governada;
- sandbox e regras de compatibilidade.

### Caminho B — módulo interno de composição modular

- usado apenas pelo core do projeto;
- sem prometer API pública;
- função equivalente a "feature packs" internos.

Hoje o código parece mais próximo do **Caminho B**, mas com vocabulário de **Caminho A**.

Essa divergência precisa ser resolvida.

### Decisão preliminar

`plugins/` deve ser **clarificado antes de crescer**.

---

## 7. Relação entre os quatro módulos

## 7.1 Matriz resumida

| Módulo     | Pode depender de                             | Não deve depender semanticamente de                              | Papel correto no sistema          |
| ---------- | -------------------------------------------- | ---------------------------------------------------------------- | --------------------------------- |
| `bridges/` | `core`, `sdk`, `config`, `observability`     | ownership de runtime, projections de borda, store conversacional | adapters externos                 |
| `infra/`   | `core`, `config`, `observability`            | decisões de domínio, sessão, policy                              | substrate técnico                 |
| `channel/` | `agent`, `config`, `events`, `observability` | store persistente, projection pública, policy de hooks           | transporte LLM-A ↔ LLM-B          |
| `plugins/` | `core`, DI, módulos-alvo controlados         | semântica própria concorrente com tools/hooks/bridges            | superfície de extensão/composição |

## 7.2 Frase-síntese do grupo

- `bridges/` conecta o runtime ao mundo externo;
- `infra/` sustenta tecnicamente o runtime;
- `channel/` transporta mensagens entre operadores internos do runtime;
- `plugins/` compõe extensões controladas sobre o runtime.

Quando essa frase deixa de ser verdadeira, a arquitetura começa a colapsar.

---

## 8. Principais duplicações ou ambiguidades já visíveis

1. `channel/` vs `conversation-hub/`
   - risco de ambos parecerem owners de conversa.

2. `plugins/` vs `tools/` / `hooks/` / `bridges/`
   - risco de plugin registry virar apenas outra forma de registrar o que já existe.

3. `infra/` vs `server/` / `terminal/`
   - SSE compartilhada precisa permanecer técnica, ou vira owner implícito de entrega de evento.

4. `bridges/` vs `agent/`
   - bridges ricos demais começam a decidir fluxo, retries e status do runtime.

---

## 9. Decisões preliminares desta etapa

### D16-01

`bridges/` é domínio legítimo e deve continuar existindo como owner de adapters externos.

### D16-02

`infra/` deve ser mantido estritamente técnico; qualquer crescimento semântico deve ser tratado como
smell.

### D16-03

`channel/` deve ser explicitamente definido como transporte/protocolo LLM-A ↔ LLM-B, e não como
store conversacional.

### D16-04

`plugins/` precisa de decisão de produto/arquitetura antes de continuar crescendo.

### D16-05

As próximas matrizes da auditoria devem tratar este grupo como área de **alto risco de owner
acidental**.

---

## 10. Conclusão desta etapa

Este grupo não parece “errado”.

Ele parece **estruturalmente necessário**, porém exige governança mais rígida do que a média, porque
cada um de seus módulos opera perto de fronteiras perigosas:

- externo vs interno;
- técnico vs semântico;
- extensão vs improviso;
- transporte vs domínio.

Portanto, na revolução arquitetural de `src/copilot/`, este grupo não deve ser eliminado — deve ser
**delimitado com muito mais dureza**.
