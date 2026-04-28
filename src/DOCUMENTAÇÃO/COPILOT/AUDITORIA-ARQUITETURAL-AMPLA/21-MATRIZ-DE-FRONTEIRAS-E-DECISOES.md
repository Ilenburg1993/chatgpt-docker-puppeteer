# 21 — Matriz de Fronteiras e Decisões Arquiteturais

**Status**: auditoria ativa **Última atualização**: 2026-04-27 **Escopo desta etapa**: definir, com
máxima explicitude, onde começa e termina a função de cada módulo relevante de `src/copilot/`, quais
imports/seams são legítimos, quais são proibidos e quais decisões estruturais passam a orientar a
revolução arquitetural.

---

## 1. Objetivo deste documento

Se os documentos anteriores mapearam:

- o que existe;
- o que cada módulo faz;
- onde há overlap;
- como os módulos se comunicam;

este documento responde o próximo passo lógico:

> **quais são as fronteiras oficiais propostas para o sistema**.

Em termos práticos, este é um documento de **demarcação de soberania arquitetural**.

---

## 2. Princípio central

A partir desta matriz, a pergunta correta deixa de ser:

> "esse módulo consegue fazer isso?"

E passa a ser:

> "esse módulo é o lugar legítimo para fazer isso?"

---

## 3. Fronteiras por módulo principal

## 3.1 `sdk/`

### Começa em

- tudo que fala com `@github/copilot-sdk`;
- wrappers de client/session/RPC/tools/model/provider;
- tipos SSOT do vendor;
- taxonomia de erro vanilla;
- observabilidade de operação de L1.

### Termina em

- qualquer semântica específica do runtime local;
- projection de borda;
- store persistente do runtime;
- policy de produto/local runtime fora das callbacks vanilla.

### Pode consumir

- `core/`
- `boot/` apenas quando explicitamente necessário para resolução de path/infra compatível via seam
  correto
- `infra/` técnico quando estritamente necessário
- `observability/` **não diretamente**, apenas por emitter/port injetável de L1

### Não pode consumir

- `agent/`
- `presentation/`
- `server/`
- `terminal/`
- `conversation-hub/`
- `tools/` de domínio

### Decisão

`sdk/` é soberano sobre vanilla.

---

## 3.2 `agent/`

### Começa em

- runtime contínuo;
- lifecycle da sessão ativa;
- dialog loop;
- queue;
- recovery;
- runtime health;
- state do agent vivo;
- façades semânticas do runtime.

### Termina em

- capacidades vanilla do SDK;
- projeção compartilhada de borda;
- persistência multi-sessão como owner primário;
- policy/callback owner do SDK;
- protocolos HTTP/SSE/REPL.

### Pode consumir

- `sdk/` por façades/ports/seams oficiais
- `events/`
- `hooks/`
- `config/`
- `boot/`
- `conversation-hub/`
- `observability/`
- `audit/`
- `bridges/` quando via capability explícita

### Não pode consumir como owner alternativo

- topologia interna de `presentation/`
- projeções de `server/terminal`
- store conversacional persistida como se fosse runtime state local

### Decisão

`agent/` é soberano sobre runtime vivo.

---

## 3.3 `event-handlers/`

### Começa em

- tradução do `SessionEvent` vanilla do SDK;
- normalização de sinais do vendor para o idioma interno.

### Termina em

- orquestração de runtime;
- projection de borda;
- persistência;
- observação/auditoria como owner.

### Pode consumir

- `events/`
- `observability/`
- `core/`
- `sdk/` apenas enquanto surface vanilla de evento

### Não pode consumir

- `presentation/`
- `server/`
- `terminal/`
- `conversation-hub/`

### Decisão

`event-handlers/` é soberano sobre tradução de sinais vanilla.

---

## 3.4 `events/`

### Começa em

- catálogo de nomes de eventos;
- schemas/event grammar do sistema;
- convenções de namespace de eventos.

### Termina em

- tradução do vendor;
- observação de runtime;
- routing HTTP/SSE.

### Pode consumir

- `core/`
- talvez `types/` para contracts transversais mínimos

### Não pode consumir

- `agent/`
- `presentation/`
- `server/`
- `terminal/`

### Decisão

`events/` é soberano sobre gramática de sinais internos.

---

## 3.5 `hooks/`

### Começa em

- callbacks do SDK;
- permission handling;
- prompt/tool/session interception;
- user input / elicitation provider helpers;
- composição de policy para slots do SDK.

### Termina em

- runtime ownership;
- projection de borda;
- tradução de eventos;
- capability executável.

### Pode consumir

- `sdk/`
- `core/`
- `config/`
- `observability/`
- `events/` quando necessário de forma controlada

### Não pode consumir como owner estrutural

- `agent/`
- `presentation/`
- `server/`
- `terminal/`
- `conversation-hub/`

### Decisão

`hooks/` é soberano sobre policy/callbacks do SDK.

---

## 3.6 `tools/`

### Começa em

- implementação de capabilities executáveis do runtime local;
- tools customizadas e seus auxiliares;
- adaptação de capability local ao envelope de tool.

### Termina em

- policy de autorização/interceptação;
- infraestrutura vanilla do SDK para registry/state interno;
- projection de borda.

### Pode consumir

- `sdk/`
- `boot/`
- `config/`
- `audit/`
- `observability/`
- `bridges/`
- `infra/`

### Não pode consumir como owner alternativo

- `hooks/` para decidir policy;
- `presentation/` para expor estado;
- `server/terminal` como destino direto de UX.

### Decisão

`tools/` é soberano sobre capability executável.

---

## 3.7 `presentation/`

### Começa em

- projeções compartilhadas de borda;
- snapshots/read models;
- accessors/handlers compartilhados para `server/` e `terminal/`;
- targeting/control semântico de borda.

### Termina em

- ownership do runtime;
- protocol adapters finais;
- semântica vanilla do SDK;
- store persistente.

### Pode consumir

- `agent/`
- `conversation-hub/`
- `config/`
- `bridges/`
- `observability/`
- `audit/`

### Não pode consumir

- detalhes internos arbitrários de `sdk/`;
- topologia interna de `terminal/` e `server/`;
- estado cru de `agent/` fora de surfaces semânticas.

### Decisão

`presentation/` é soberano sobre projeção compartilhada de borda.

---

## 3.8 `server/`

### Começa em

- adapter HTTP/SSE/Socket;
- rotas, controllers, middleware e serialization final de protocolo;
- surface pública `/copilot-api` e `/sdk`.

### Termina em

- ownership do runtime;
- cálculo primário de projeções compartilhadas;
- policy do SDK;
- store principal de conversa;
- vanilla wrapper semantics fora de adapters explícitos `/sdk`.

### Pode consumir

- `presentation/`
- `sdk/` em adapter `/sdk`
- `core/`
- `config/`
- `observability/`

### Não pode consumir

- `agent/` cru para cada rota;
- `hooks/` como atalho de domínio;
- `tools/` como source-of-truth sem intermediação adequada.

### Decisão

`server/` é soberano sobre protocolo HTTP/SSE/Socket, não sobre domínio.

---

## 3.9 `terminal/`

### Começa em

- UX humana;
- REPL/comandos;
- render terminal;
- input/output com operador;
- adapter humano de diálogo e status.

### Termina em

- ownership do runtime;
- projection compartilhada já coberta por `presentation/`;
- store persistente de conversa;
- policy do SDK.

### Pode consumir

- `presentation/`
- `channel/`
- `bridges/`
- `boot/`
- `config/`
- `observability/`
- `events/`

### Não pode consumir como owner alternativo

- `agent/` cru em todos os fluxos;
- semântica de sessão persistida sem `conversation-hub/`;
- lógica duplicada de projection.

### Decisão

`terminal/` é soberano sobre UX humana e só sobre isso.

---

## 3.10 `conversation-hub/`

### Começa em

- multi-sessão persistida;
- conversation store;
- replay;
- sync/realtime de conversa;
- ownership persistente cross-surface.

### Termina em

- execução viva do runtime ativo;
- dialog loop;
- policy do SDK;
- protocol edge final.

### Pode consumir

- `db/`
- `core/`
- `observability/`
- talvez `events/` e `types/` para contracts estáveis

### Não pode consumir como owner alternativo

- `agent/` runtime internals;
- `terminal/server` como if they were store owners.

### Decisão

`conversation-hub/` é soberano sobre sessão persistida e multi-sessão.

---

## 3.11 `bridges/`

### Começa em

- integração com sistemas externos;
- adaptação de protocolos e health externos;
- surface Git/GitHub/MCP/NERV.

### Termina em

- ownership de runtime;
- capability executável como fim em si;
- projections de borda;
- stores de domínio.

### Decisão

`bridges/` é soberano sobre adapters externos.

---

## 3.12 `infra/`

### Começa em

- substrato técnico compartilhado;
- queue/buffer/lock/storage/registry técnico.

### Termina em

- domínio de sessão;
- projection;
- policy;
- conversation semantics.

### Decisão

`infra/` é soberano sobre infraestrutura técnica, nunca sobre significado.

---

## 3.13 `channel/`

### Começa em

- transporte LLM-A ↔ LLM-B;
- injection, health, reply capture, streaming local/remoto interno.

### Termina em

- session store persistido;
- UX humana final;
- runtime lifecycle ownership.

### Decisão

`channel/` é soberano sobre transporte interno entre operadores lógicos.

---

## 3.14 `plugins/`

### Começa em

- descoberta/registro/ativação de extensões;
- composição modular por DI.

### Termina em

- capability owner principal;
- policy owner principal;
- bypass de fronteira.

### Decisão

`plugins/` não pode crescer antes de ter mandato estratégico explícito.

---

## 3.15 `config/`, `boot/`, `core/`, `types/`, `dialog/`

### `config/`

- soberano sobre descrição e builders declarativos.

### `boot/`

- soberano sobre inicialização, plano e resolução de paths/contratos de boot.

### `core/`

- soberano sobre primitives, DI, erros, shutdown, base comum.

### `types/`

- soberano apenas sobre contratos realmente transversais.

### `dialog/`

- soberano apenas sobre protocolo compartilhado, se esta classificação for mantida.

---

## 4. Fronteiras especiais entre pares de módulos

## 4.1 `sdk/` ↔ `agent/`

- `sdk/` entrega vanilla capability;
- `agent/` transforma isso em runtime governado.

**Regra**: nenhum módulo fora de `sdk/`, `agent/facades/` e `agent/ports/` deve reabrir essa
fronteira arbitrariamente.

## 4.2 `agent/` ↔ `presentation/`

- `agent/` responde perguntas e executa comandos semânticos;
- `presentation/` projeta isso para borda.

**Regra**: `presentation/` não pode virar runtime 2.0.

## 4.3 `presentation/` ↔ `server/terminal`

- `presentation/` define o shared edge layer;
- `server/terminal` adaptam protocolo/UX final.

**Regra**: bordas não recalculam semântica compartilhada sem motivo forte.

## 4.4 `hooks/` ↔ `tools/`

- `hooks/` decide/intercepta;
- `tools/` executa.

**Regra**: capability nunca absorve policy; policy nunca absorve capability.

## 4.5 `agent/` ↔ `conversation-hub/`

- `agent/` possui sessão viva;
- `conversation-hub/` possui sessão persistida.

**Regra**: qualquer fluxo híbrido precisa explicitar qual dos dois é source-of-truth em cada etapa.

---

## 5. Imports idealmente permitidos por camada (TO-BE)

| Camada/Grupo                                    | Pode importar de                                                | Não deve importar de                           |
| ----------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------- |
| foundation (`core`, `types`)                    | `node:*`, foundation mínima                                     | runtime, bordas, adapters de produto           |
| config/boot                                     | `core`, `types`, ports explícitos                               | runtime/bordas diretas                         |
| `sdk/`, `events/`, `event-handlers/`            | foundation, config/boot controlados                             | `agent`/`presentation`/borda direta            |
| `hooks`, `tools`, `bridges`, `infra`, `plugins` | foundation + vanilla seams necessários                          | bordas como owner de semântica                 |
| `agent`, `channel`                              | foundation + vanilla + cross-cutting legítimos                  | bordas como source-of-truth                    |
| `conversation-hub`                              | foundation + db + contracts                                     | borda/runtimes internos como source-of-truth   |
| `presentation`                                  | `agent`, `conversation-hub`, `config`, `bridges`, cross-cutting | detalhes internos arbitrários do SDK ou bordas |
| `server`, `terminal`                            | `presentation`, `sdk` adapters específicos, cross-cutting       | domínio vivo cru sem intermediação             |

---

## 6. Anti-fronteiras (proibições explícitas)

1. `server/` não deve virar owner de runtime.
2. `terminal/` não deve virar owner de projection compartilhada.
3. `hooks/` não deve virar runtime helper genérico.
4. `observability/` não deve virar segundo sistema de eventos semânticos.
5. `audit/` não deve competir com `observability/` por interpretação operacional.
6. `infra/` não deve carregar domínio conversacional.
7. `plugins/` não deve ser bypass das regras de fronteira.
8. `.github/` e `logs/` não devem ser lidos como módulos de domínio.

---

## 7. Decisões estruturais desta etapa

### D21-01

A arquitetura TO-BE de `src/copilot` será orientada por **soberania por responsabilidade**, não por
conveniência de import.

### D21-02

Toda responsabilidade central deve ter owner principal, consumers secundários e seam canônico.

### D21-03

Módulos pequenos não terão permissão implícita para crescer por ambiguidade nominal.

### D21-04

Artefatos operacionais deixarão de competir semanticamente com módulos de código.

### D21-05

Toda transformação futura deve poder ser julgada pela pergunta: **isto fortalece ou enfraquece a
fronteira do owner correto?**

---

## 8. Conclusão desta etapa

A revolução arquitetural proposta para `src/copilot` não será uma simples reorganização de pastas.

Ela exige uma redefinição explícita de fronteiras, para que o sistema deixe de depender de leitura
implícita do código e passe a depender de **responsabilidades arquiteturais declaradas, auditáveis e
enforçáveis**.
