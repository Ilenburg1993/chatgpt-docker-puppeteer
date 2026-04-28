# 25 — Sumário Executivo e Decisões Estruturais da Auditoria Ampla

**Status**: consolidação executiva **Última atualização**: 2026-04-27 **Escopo desta etapa**:
sintetizar a auditoria arquitetural ampla de `src/copilot/`, registrando as principais conclusões,
decisões e prioridades de transformação.

---

## 1. Resumo executivo

A auditoria ampla de `src/copilot/` chegou a uma conclusão central:

> o problema principal do sistema não é ausência de arquitetura, e sim **densidade arquitetural com
> owners parcialmente corretos convivendo com owners acidentais e sobreposições toleradas por tempo
> demais**.

Em outras palavras:

- `src/copilot/` já possui uma espinha dorsal arquitetural forte;
- há muita coisa certa e valiosa preservada na estrutura atual;
- porém a evolução aconteceu por ondas sucessivas, o que produziu:
  - excesso de seams;
  - duplicação de responsabilidade em torno de temas centrais;
  - artefatos misturados com código;
  - cross-cuttings com risco de crescer para além do papel ideal;
  - bordas às vezes inteligentes demais.

A revolução proposta por esta auditoria não é uma reescrita cega. É uma **reordenação soberana do
sistema**.

---

## 2. A espinha dorsal correta já existente

A auditoria conclui que a espinha dorsal correta de `src/copilot/` já está visível e deve ser
preservada:

```text
sdk -> event-handlers -> agent -> presentation -> server/terminal
```

Essa espinha dorsal deve ser entendida assim:

- `sdk/` protege o vanilla do vendor;
- `event-handlers/` traduz o sinal vanilla;
- `agent/` governa o runtime vivo;
- `presentation/` projeta semântica compartilhada;
- `server/terminal` expõem protocolo e UX.

O problema não é essa espinha dorsal. O problema é tudo que cresce ao redor dela sem soberania
arquitetural plenamente explícita.

---

## 3. Owners soberanos propostos

A auditoria recomenda institucionalizar os seguintes owners principais.

| Responsabilidade central          | Owner soberano proposto |
| --------------------------------- | ----------------------- |
| vendor SDK vanilla                | `sdk/`                  |
| runtime vivo da sessão ativa      | `agent/`                |
| sessão persistida e multi-sessão  | `conversation-hub/`     |
| callbacks e policies do SDK       | `hooks/`                |
| capabilities executáveis          | `tools/`                |
| adapters externos                 | `bridges/`              |
| gramática de eventos internos     | `events/`               |
| tradução de eventos vanilla       | `event-handlers/`       |
| projeções compartilhadas de borda | `presentation/`         |
| protocolo HTTP/SSE/Socket         | `server/`               |
| UX humana terminal                | `terminal/`             |
| observação operacional            | `observability/`        |
| trilha de governança/auditoria    | `audit/`                |
| configuração declarativa          | `config/`               |
| base técnica                      | `core/`                 |

---

## 4. Disputas arquiteturais centrais identificadas

## 4.1 Disputa 1 — Sessão, conversa e ownership

Módulos envolvidos:

- `sdk/`
- `agent/`
- `conversation-hub/`
- `channel/`
- `presentation/`

Conclusão:

- a sessão vanilla é do `sdk/`;
- a sessão ativa viva é do `agent/`;
- a sessão persistida/multi-sessão é do `conversation-hub/`;
- `channel/` não pode se tornar owner de conversa;
- `presentation/` só projeta esse estado.

## 4.2 Disputa 2 — Policy vs capability vs runtime decision

Módulos envolvidos:

- `hooks/`
- `tools/`
- `agent/`

Conclusão:

- `hooks/` decide/intercepta;
- `tools/` executa capability;
- `agent/` governa continuidade/lifecycle.

## 4.3 Disputa 3 — Projeção vs borda final

Módulos envolvidos:

- `presentation/`
- `server/`
- `terminal/`

Conclusão:

- `presentation/` deve monopolizar projeção compartilhada;
- `server/terminal` devem apenas adaptar protocolo e UX.

## 4.4 Disputa 4 — Sinal, observação e auditoria

Módulos envolvidos:

- `event-handlers/`
- `events/`
- `observability/`
- `audit/`
- `logs/`

Conclusão:

- tradução é de `event-handlers/`;
- gramática é de `events/`;
- observação é de `observability/`;
- governança é de `audit/`;
- `logs/` é artefato, não owner.

---

## 5. Módulos que devem ser endurecidos

A auditoria recomenda fortalecer explicitamente:

1. `sdk/`
2. `agent/`
3. `presentation/`
4. `hooks/`
5. `conversation-hub/`
6. `events/`
7. `event-handlers/`
8. `bridges/`
9. `config/`
10. `core/`

Esses módulos não precisam ser reduzidos por reflexo. Eles precisam ser **mais nítidos e mais
soberanos**.

---

## 6. Módulos que devem ser clarificados ou reclassificados

A auditoria recomenda clarificação especial para:

1. `channel/`
2. `plugins/`
3. `infra/`
4. `types/`
5. `dialog/`

Razão:

- todos são legítimos em alguma medida;
- mas todos são módulos onde naming, escopo e soberania ainda podem ser confundidos.

---

## 7. Elementos que devem ser rebaixados ou realocados

A auditoria recomenda rebaixamento/realocação clara de:

1. `logs/`
2. `src/copilot/.github/` interna e seus estados/snapshots
3. quaisquer compat shims remanescentes que não carreguem mais função real de transição

Esses elementos podem continuar existindo operacionalmente, mas não devem competir semanticamente
com os módulos de código.

---

## 8. O que a revolução NÃO significa

A revolução arquitetural proposta não significa:

- apagar a topologia atual e reconstruir do zero;
- reduzir o sistema a poucos diretórios genéricos;
- fundir módulos só porque ambos tocam o mesmo tema;
- transformar tudo em mega-barrels e superfícies indistintas;
- matar flexibilidade em nome de pureza abstrata.

Ela significa:

- tornar owners claros;
- tornar seams canônicos;
- remover owners acidentais;
- transformar arquitetura declarada em arquitetura executável;
- e fazer o codebase voltar a ser cognitivamente governável.

---

## 9. Decisões estruturais consolidadas

### D25-01

A espinha dorsal oficial do sistema é:

`sdk -> event-handlers -> agent -> presentation -> server/terminal`

### D25-02

A soberania de sessão será tripartida:

- vanilla SDK;
- runtime vivo;
- persistência/multi-sessão.

### D25-03

`presentation/` será institucionalizada como única shared edge layer.

### D25-04

`hooks/` será mantido como owner de policies/callbacks do SDK, não de runtime ou projection.

### D25-05

`tools/` continuará owner de capabilities executáveis; `sdk/tools/*` permanece apenas como infra
vanilla de tool.

### D25-06

`observability/` e `audit/` serão mantidos separados e com papéis mais explícitos.

### D25-07

`channel/` será explicitamente tratado como transporte interno, e não como owner de conversa.

### D25-08

`plugins/` só crescerá após decisão explícita de mandato estratégico.

### D25-09

Artefatos operacionais serão rebaixados e realocados sempre que possível.

### D25-10

Toda fase relevante da revolução deverá resultar em gates, testes e contratos executáveis.

---

## 10. Ordem executiva recomendada

A auditoria recomenda a seguinte ordem de prioridade macro:

1. blindagem estrutural e baseline;
2. soberania do boundary SDK;
3. purificação do runtime `agent/`;
4. separação sessão viva vs persistida;
5. reforma do sistema de sinais;
6. purificação de hooks/policy/capability governance;
7. monopólio de projeção por `presentation/`;
8. reforma das bordas (`server`, `terminal`, `channel`);
9. clarificação de `bridges`, `infra` e `plugins`;
10. reorganização de `config`, `types`, `dialog` e artefatos;
11. gates/ADRs/enforcement;
12. descomissionamento e consolidação final.

---

## 11. Condição de sucesso da revolução

A revolução só estará concluída quando for verdade que:

- qualquer engenheiro consegue dizer onde cada responsabilidade mora sem recorrer à arqueologia do
  código;
- qualquer regressão arquitetural relevante falha em gates/testes;
- as bordas deixaram de reinventar domínio;
- os cross-cuttings deixaram de competir com owners de semântica;
- o sistema continua rico, porém muito mais governável.

---

## 12. Fecho final

A conclusão mais importante desta auditoria é simples e severa:

> `src/copilot/` não precisa de mais improviso. Precisa de soberania arquitetural, disciplina de
> owners, seams canonizados e uma longa campanha de convergência.

É isso que o roadmap propõe.

Não uma reforma cosmética. Uma **revolução arquitetural deliberada, longa, testável e
institucional**.
