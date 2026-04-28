# 17 — `config/`, `types/`, `dialog/` e artefatos internos

**Status**: auditoria ativa **Última atualização**: 2026-04-27 **Escopo desta etapa**: auditar
configuração declarativa, contratos cross-module, o microdomínio `dialog/` e os artefatos que hoje
coexistem dentro de `src/copilot/`.

---

## 1. Objetivo deste documento

Este documento trata de uma combinação deliberadamente heterogênea de módulos porque todos eles
sofrem de um mesmo risco estrutural:

> parecerem menores, acessórios ou neutros demais — e justamente por isso acumularem confusão.

O foco aqui é responder:

1. o que `config/` realmente deve possuir;
2. o que `types/` deve centralizar e o que não deve duplicar;
3. se `dialog/` é domínio legítimo, protocolo compartilhado ou resíduo incompleto;
4. por que `.github/` e `logs/` dentro de `src/copilot/` são anomalias arquiteturais que precisam de
   decisão explícita.

---

## 2. `config/` — um módulo pequeno demais para errar, mas central demais para relaxar

## 2.1 Base factual observada

O README de `config/` o posiciona como **L1**, dependente apenas de `core/`, com foco em:

- env;
- sessão;
- system prompt;
- custom agents;
- pinned files.

O barrel `config/index.js` mostra uma superfície rica:

- env constants;
- MCP server config;
- system prompt modular;
- custom agents;
- session config builder;
- client options builder;
- declarative runtime config;
- `DEFAULT_EXCLUDED_TOOLS`.

`session-config.js` revela um builder fluent abrangente para `SessionConfig` e
`ResumeSessionConfig`, cobrindo:

- model;
- reasoning effort;
- tools;
- skill directories;
- custom agents;
- default agent;
- MCP;
- system message;
- commands;
- infinite sessions;
- provider;
- permission handlers;
- elicitation;
- onEvent etc.

Ou seja: `config/` não é um módulo de env trivial; ele é um **owner declarativo muito relevante**.

## 2.2 Função atual correta

`config/` é o lugar certo para:

- builders tipados;
- leitura e normalização de env/config declarativa;
- montagem declarativa de prompt, session config e client options;
- ports controlados para o SDK quando necessário (`sdk-config-port.js`).

## 2.3 Onde `config/` deve começar

`config/` deve começar quando a pergunta for:

- como descrever uma configuração?
- como validar normalizar e montar opções?
- como transformar env/arquivo em objeto declarativo?
- como montar prompt/config sem executar runtime?

## 2.4 Onde `config/` deve terminar

`config/` não deve:

- orquestrar runtime;
- conhecer detalhes vivos de `agent/`;
- depender diretamente do `sdk/` fora de ports explícitos;
- executar side effects comportamentais não declarativos;
- carregar semântica de domínio operacional.

## 2.5 Risco principal

O risco de `config/` é virar uma mistura de:

- env layer;
- builder layer;
- prompt domain;
- registry de entidades;
- port da capability vanilla.

Isso ainda é administrável, mas exige estrutura explícita.

## 2.6 Situação ideal para `config/`

No TO-BE:

- `config/` continua existindo;
- mas deve se dividir claramente em subzonas conceituais:
  1. `env/` ou equivalentes;
  2. `builders/`;
  3. `prompt/`;
  4. `ports/`;
  5. `declarative registries`.

### Decisão preliminar

`config/` é legítimo e deve ser **endurecido como módulo declarativo**, com vigilância para não
escorregar para comportamento vivo.

---

## 3. `types/` — pequeno módulo transversal, mas com uma responsabilidade muito sensível

## 3.1 Base factual observada

O README de `types/` o declara como módulo **L0** de tipos compartilhados cross-module.

`types/index.js` confirma uma estratégia específica:

- re-export de tokens DI de vários módulos (`audit`, `bridges`, `conversation-hub`, `sdk`);
- export do container;
- export de utilitários DI;
- export do EventBus;
- export de nomes/esquemas de eventos.

Isso é interessante porque `types/` não é apenas “types”; ele também é um **barrel transversal de
contratos e tokens**.

## 3.2 Diagnóstico atual

Essa abordagem pode ser boa, mas carrega um risco importante:

> módulo chamado `types/` tende a ser usado como “atalho legitimado” para tudo que é transversal.

Hoje, o README diz corretamente que ele não deve duplicar tipos e que os tipos SDK permanecem em
`sdk/types.js`.

Isso é excelente.

Mas o fato de re-exportar tokens e container significa que ele opera também como **contract surface
cross-module**, não apenas como typedef module.

## 3.3 Onde `types/` deve começar

`types/` deve começar quando algo precisa ser:

- semanticamente compartilhado por vários módulos;
- suficientemente estável para virar contrato transversal;
- re-exportável sem reabrir topologia interna.

## 3.4 Onde `types/` deve terminar

`types/` não deve virar:

- mega-barrel de conveniência;
- bypass para importar coisas proibidas indiretamente;
- repositório de contratos específicos demais de um subdomínio;
- duplicação de SSOTs já existentes em `sdk/`, `hooks/`, `events/` etc.

## 3.5 Situação ideal para `types/`

No TO-BE:

- `types/` deve ser pequeno e duro;
- deve conter apenas contratos realmente transversais;
- cada subdomínio deve continuar dono do seu SSOT específico;
- `types/` serve para reduzir acoplamento, não para escondê-lo.

### Decisão preliminar

`types/` deve ser **convergido como contract surface cross-module**, mas seu escopo precisa ser
policiado com força.

---

## 4. `dialog/` — domínio compartilhado real ou resíduo arquitetural?

## 4.1 Base factual observada

`dialog/index.js` exporta um protocolo compartilhado READY/REPLY/STO PPED.

`dialog/protocol.js` é explícito:

- o módulo define a linguagem compartilhada do loop;
- ele **não pertence ao `agent/`**;
- o `agent` executa o runtime;
- o `terminal` filtra sinais de protocolo para não mostrá-los ao usuário como perguntas reais.

Isto é crucial.

`dialog/` não é um diretório aleatório: ele representa um **contrato de protocolo compartilhado**.

## 4.2 Diagnóstico atual

Antes desta leitura, `dialog/` parecia fortemente suspeito de ser resíduo.

Depois da leitura de `protocol.js`, o diagnóstico muda:

- o módulo é pequeno;
- mas sua motivação é legítima;
- ele define um protocolo compartilhado entre runtime e bordas.

Logo, `dialog/` não é necessariamente um erro.

O problema é outro:

> ele é pequeno demais para parecer domínio completo e grande demais para ser descartado sem
> análise.

## 4.3 Situação arquitetural provável

Hoje `dialog/` parece ser um **microdomínio de protocolo compartilhado**, não um domínio operacional
amplo.

A forma ideal disso pode ser uma de duas:

### Caminho A — manter `dialog/` como microdomínio autônomo

Vantagem:

- clareza de que protocolo não pertence nem ao `agent/` nem ao `terminal/`.

### Caminho B — rebaixar `dialog/` para `types/contracts` ou `protocols/`

Vantagem:

- o nome passaria a refletir mais precisamente que se trata de contrato, não de domínio vivo.

## 4.4 Decisão preliminar

`dialog/` não deve ser removido por reflexo.

Ele deve ser **reclassificado explicitamente** como um destes dois:

- microdomínio/protocolo compartilhado;
- ou subzona de contratos compartilhados.

Atualmente, a auditoria pende para a segunda hipótese:

> `dialog/` parece mais um módulo de protocolo do que um domínio estrutural completo.

---

## 5. Artefatos internos em `src/copilot/`: `.github/` e `logs/`

## 5.1 `.github/` dentro de `src/copilot/`

Base factual observada:

- existe `src/copilot/.github/hooks/state/`;
- há snapshots como `sdk-always-alive.json` e diretório `snapshots/`.

Isso é um forte sinal de **estado operacional localizado junto ao código**.

### Problema arquitetural

Mesmo que funcionalmente útil, isso é quase sempre ruim por quatro razões:

1. artefato de runtime parece módulo de código;
2. ownership fica ambíguo;
3. documentação e tooling tendem a tratá-lo como parte da arquitetura de software;
4. dificulta distinguir contrato de execução vs resíduo local.

### Situação ideal

Esses artefatos devem migrar para um lugar explicitamente não-domínio, por exemplo:

- diretório de estado resolvido por `boot/`;
- runtime data dir;
- storage declarativo fora da árvore de código.

## 5.2 `logs/` dentro de `src/copilot/`

Base factual observada:

- `logs/` contém arquivos como:
  - `agent.log`
  - `audit.jsonl`
  - `events.jsonl`
  - `metrics.jsonl`
  - `otel-traces.jsonl`
  - `tool-audit.jsonl`
  - `tool-permissions-audit.jsonl`

### Problema arquitetural

`logs/` dentro da árvore do módulo gera três distorções:

1. parece subdomínio;
2. concorre semanticamente com `observability/` e `audit/`;
3. dificulta a leitura do codebase como arquitetura e não como estado local de execução.

### Situação ideal

`logs/` deve ser tratado como:

- output directory;
- não como módulo arquitetural.

É candidato forte a realocação ou a tratamento explícito de artefato no boot/runtime config.

---

## 6. Relação entre os quatro eixos auditados aqui

| Eixo      | Papel correto                      | Risco principal                         |
| --------- | ---------------------------------- | --------------------------------------- |
| `config/` | declarar, montar, normalizar       | começar a executar domínio              |
| `types/`  | estabilizar contratos transversais | virar barrel gigante de conveniência    |
| `dialog/` | definir protocolo compartilhado    | ficar sem classificação semântica clara |
| artefatos | guardar estado/output operacional  | parecer módulo de código                |

A relação ideal entre eles é:

- `config/` descreve;
- `types/` estabiliza contratos transversais;
- `dialog/` define um protocolo compartilhado específico;
- artefatos saem do centro arquitetural e voltam a ser apenas artefatos.

---

## 7. Decisões preliminares desta etapa

### D17-01

`config/` é owner legítimo do declarativo e deve ser reforçado como tal.

### D17-02

`types/` deve existir como contract surface transversal mínima, nunca como mega-barrel genérico.

### D17-03

`dialog/` deve ser reclassificado explicitamente como microdomínio/protocolo compartilhado ou ser
absorvido por uma zona de contratos mais apropriada.

### D17-04

`.github/` interna e `logs/` são artefatos operacionais, não domínios arquiteturais; devem ser
rebaixados e provavelmente realocados.

---

## 8. Conclusão desta etapa

Estes módulos provam um ponto importante da auditoria:

> a confusão arquitetural não nasce só nos módulos grandes; ela nasce também nas bordas pequenas,
> nos barrels transversais e nos artefatos que parecem código.

A revolução arquitetural de `src/copilot` exigirá, portanto, não só redesenhar os módulos grandes,
mas também **disciplinar radicalmente os módulos pequenos e os resquícios operacionais**.
