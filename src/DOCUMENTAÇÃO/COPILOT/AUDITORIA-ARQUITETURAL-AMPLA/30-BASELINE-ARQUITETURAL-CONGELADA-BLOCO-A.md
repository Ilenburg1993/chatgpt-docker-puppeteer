# 30 — Baseline Arquitetural Congelada do Bloco A

**Status**: baseline congelada do programa P0 **Última atualização**: 2026-04-27 **Escopo desta
etapa**: consolidar, numa única referência executiva, o estado arquitetural que o Bloco A decidiu
congelar antes do início das cirurgias profundas da revolução.

---

## 1. Objetivo deste documento

O Bloco A do roadmap existe para garantir que a revolução arquitetural não comece no escuro.

Este documento materializa exatamente isso: o **congelamento consciente da baseline** contra a qual
as próximas ondas serão avaliadas.

Em termos práticos, ele consolida:

- a taxonomia atual aceita;
- os owners soberanos propostos;
- os seams oficiais já institucionalizados ou em institucionalização;
- a baseline documental do pacote de auditoria;
- a baseline quantitativa inicial de maturidade;
- os anti-owners oficialmente reconhecidos;
- a baseline das superfícies públicas canônicas;
- os primeiros testes/gates estruturais do Bloco A.

---

## 2. O que o Bloco A congela

O Bloco A **não** congela o código para sempre.

Ele congela:

1. a leitura oficial do estado atual;
2. a nomenclatura de responsabilidades centrais;
3. os owners propostos que passam a servir como norte;
4. os seams que já devem ser tratados como canônicos;
5. a lista de problemas que deixaram de ser “impressão” e passaram a ser **baseline formal**.

---

## 3. Artefatos que compõem a baseline congelada

A baseline do Bloco A passa a ser composta, no mínimo, pelos seguintes documentos:

- `00-PRE-AUDITORIA-PLANO-MESTRE.md`
- `05-TAXONOMIA-ARQUITETURAL-POR-MODULO.md`
- `19-MATRIZ-DE-COMUNICACAO-CROSS-MODULE.md`
- `20-MATRIZ-DE-DUPLICACOES-E-SOBREPOSICOES.md`
- `21-MATRIZ-DE-FRONTEIRAS-E-DECISOES.md`
- `22-SITUACAO-IDEAL-ALVO.md`
- `23-ROADMAP-MACRO-FAIXAS-E-FASES.md`
- `24-ROADMAP-SUBFASES-E-ORDEM-DE-ATAQUE.md`
- `25-SUMARIO-EXECUTIVO-E-DECISOES-ESTRUTURAIS.md`
- `26-SCORE-INICIAL-DE-MATURIDADE-POR-MODULO.md`
- `27-CHECKLIST-DE-SEAMS-OFICIAIS-POR-MODULO.md`
- `28-INVENTARIO-DE-ANTI-OWNERS-E-ARTEFATOS.md`
- `29-SUPERFICIES-PUBLICAS-CANONICAS-BASELINE.md`
- `30-BASELINE-ARQUITETURAL-CONGELADA-BLOCO-A.md`

---

## 4. Owners soberanos congelados nesta baseline

A partir desta baseline, a auditoria passa a tratar como owners soberanos iniciais:

| Responsabilidade                 | Owner soberano congelado |
| -------------------------------- | ------------------------ |
| vanilla SDK                      | `sdk/`                   |
| runtime vivo                     | `agent/`                 |
| sessão persistida / multi-sessão | `conversation-hub/`      |
| policy/callbacks do SDK          | `hooks/`                 |
| capabilities executáveis         | `tools/`                 |
| adapters externos                | `bridges/`               |
| gramática de eventos internos    | `events/`                |
| tradução de sinais vanilla       | `event-handlers/`        |
| projeção compartilhada de borda  | `presentation/`          |
| protocolo HTTP/SSE/Socket        | `server/`                |
| UX terminal                      | `terminal/`              |
| observação operacional           | `observability/`         |
| trilha de auditoria/governança   | `audit/`                 |
| configuração declarativa         | `config/`                |
| base técnica                     | `core/`                  |

Estes owners ainda podem ser refinados, mas não voltam ao estado de ambiguidade informal.

---

## 5. Seams congelados como oficiais no Bloco A

Passam a ser tratados como seams oficiais iniciais:

1. `#copilot/sdk` como barrel soberano do boundary vanilla;
2. `agent/facades/*` e `agent/ports/*` como fronteiras oficiais `agent ↔ sdk`;
3. `event-handlers/` como tradução vanilla → interno;
4. `presentation/` como shared edge layer;
5. `server/` consumindo `presentation/` e rotas `/sdk` específicas;
6. `terminal/` consumindo `presentation/` e `channel/` como seams primários;
7. `channel/` como transporte LLM-A ↔ LLM-B, não owner de conversa;
8. `hooks/` como owner de policy/callbacks do SDK;
9. `conversation-hub/` como owner da conversa persistida;
10. `observability/` e `audit/` como consumidores estruturados, não owners concorrentes de domínio.

---

## 6. Anti-owners congelados no Bloco A

A lista oficial inicial de anti-owners passa a ser:

1. `src/copilot/logs/`
2. `src/copilot/.github/`
3. compat shims remanescentes
4. barrels excessivamente oportunistas

Enquanto essa baseline vigorar, qualquer mudança que promova semanticamente um desses anti-owners já
nasce sob suspeita arquitetural forte.

---

## 7. Baseline quantitativa congelada

O score inicial do documento `26` passa a funcionar como baseline comparativa oficial do Bloco A.

### Leituras que ficam congeladas como tese inicial

- `sdk/` e `core/` partem fortes;
- `agent/`, `terminal/`, `presentation/`, `conversation-hub/` e `hooks/` partem relevantes, porém
  com dívida estrutural alta;
- `plugins/`, `dialog/`, `infra/` e `channel/` exigem clarificação prioritária;
- `logs/` e `.github/` saem da leitura normal de maturidade modular.

---

## 8. Baseline de superfície pública congelada

O documento `29` passa a ser referência inicial para proteger semanticamente as superfícies públicas
centrais de:

- `sdk/`
- `agent/`
- `presentation/`
- `hooks/`
- `tools/`
- `server/routes/sdk/*`

Regra do Bloco A:

> refatorações podem reorganizar internamente, mas não devem quebrar semanticamente essas
> superfícies sem decisão explícita, contrato novo e estratégia de migração.

---

## 9. Artefatos executáveis do Bloco A

A baseline congelada do Bloco A não é apenas documental. Ela também passa a ter expressão executável
em:

- `scripts/check-copilot-official-seams.mjs`
- testes estruturais do Bloco A em `tests/unit/copilot/contracts/*`
- guardrails globais já existentes (`boundary`, `crude`, `layer violations`)

A intenção é simples:

> a baseline do Bloco A deve ser auditável por leitura humana e verificável por execução automática.

---

## 10. O que ainda NÃO está congelado

Mesmo nesta baseline, alguns pontos seguem explicitamente em aberto:

1. mandato estratégico final de `plugins/`;
2. classificação final de `dialog/`;
3. topologia final de `channel/` após purificação de bordas;
4. shape final da relação `agent/` ↔ `conversation-hub/`;
5. reorganização física final de artefatos e paths.

Esses pontos são **pendências planejadas**, não lacunas acidentais.

---

## 11. Critério de uso desta baseline

A partir de agora, toda wave dos próximos blocos deve responder explicitamente:

1. que item da baseline está sendo fortalecido?
2. que owner está ficando mais soberano?
3. que seam está ficando mais oficial?
4. que anti-owner está sendo rebaixado?
5. que evidência executável está sendo adicionada?

Se a mudança não responde a pelo menos uma dessas perguntas, ela provavelmente não pertence ao
programa revolucionário principal.

---

## 12. Conclusão desta etapa

Este documento fecha o Bloco A no plano conceitual: `src/copilot/` agora possui uma **baseline
arquitetural congelada** a partir da qual a revolução pode avançar sem perder a capacidade de dizer:

- o que estava protegido;
- o que mudou;
- por que mudou;
- e se a mudança realmente fortaleceu a arquitetura ou apenas deslocou a confusão.
