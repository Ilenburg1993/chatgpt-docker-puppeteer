# 28 — Inventário de Anti-Owners e Artefatos Arquiteturalmente Perigosos

**Status**: baseline de anti-owners **Última atualização**: 2026-04-27 **Escopo desta etapa**:
registrar quais elementos hoje presentes em `src/copilot/` não devem ser lidos como owners legítimos
de comportamento arquitetural, apesar de influenciarem a operação do sistema.

---

## 1. Objetivo deste documento

Nem tudo que existe numa árvore de código deve ser tratado como módulo soberano.

Este documento identifica os **anti-owners**: elementos que podem parecer importantes no filesystem,
mas que não devem competir com módulos de domínio por protagonismo arquitetural.

---

## 2. O que é um anti-owner

Para os fins desta auditoria, um anti-owner é qualquer elemento que:

- apareça próximo do código;
- influencie execução, estado ou percepção do sistema;
- mas **não** deva ser tratado como owner de semântica arquitetural.

---

## 3. Anti-owners identificados no estado atual

## 3.1 `src/copilot/logs/`

### O que é hoje

Diretório de artefatos operacionais com arquivos como:

- `agent.log`
- `audit.jsonl`
- `events.jsonl`
- `metrics.jsonl`
- `otel-traces.jsonl`
- `tool-audit.jsonl`
- `tool-permissions-audit.jsonl`

### Por que é anti-owner

Porque, embora registre evidências relevantes, ele não deve definir:

- observabilidade;
- auditoria;
- contratos de evento;
- policy de logging.

### Owner real dos temas tangenciados

- `observability/`
- `audit/`
- `events/`
- `config/boot` para path resolution

### Ação arquitetural sugerida

- rebaixar semanticamente;
- realocar fisicamente quando possível;
- impedir que leitura de `src/copilot/` o trate como subdomínio.

---

## 3.2 `src/copilot/.github/`

### O que é hoje

Diretório interno contendo, ao menos, `hooks/state/` com snapshots e estados auxiliares do runtime.

### Por que é anti-owner

Porque o nome e a localização sugerem mistura entre:

- estado operacional;
- snapshot local;
- convenção de tooling;
- e pseudo-subdomínio.

### Owner real dos temas tangenciados

- `boot/` para resolução de paths/estado;
- `hooks/` para semântica de callbacks/policies;
- eventualmente storage/runtime state específico.

### Ação arquitetural sugerida

- tratar explicitamente como runtime state artifact;
- planejar realocação fora da árvore de código-dominio.

---

## 3.3 Compat shims remanescentes

### O que são

Entrypoints, aliases, compat facades ou caminhos preservados apenas para transição histórica.

### Por que são anti-owners

Porque frequentemente passam a reter protagonismo apenas por inércia.

### Owner real dos temas tangenciados

Dependerá do shim específico, mas a regra geral é:

- shim não é owner;
- owner está sempre em algum módulo canônico por trás dele.

### Ação arquitetural sugerida

- inventariar;
- marcar como deprecated;
- descomissionar em P11.

---

## 3.4 Barrels excessivamente oportunistas

### O que são

Barrels que passam a ser usados como atalho para esconder topologia real.

### Por que são anti-owners

Porque barrel não deveria redefinir soberania arquitetural; ele apenas expõe uma superfície.

### Owner real dos temas tangenciados

Sempre o subdomínio por trás do barrel.

### Ação arquitetural sugerida

- revisar barris transversais;
- reduzir reexports oportunistas;
- manter apenas superfícies públicas intencionais.

---

## 4. Anti-owners potenciais (monitorar)

## 4.1 `plugins/` sem mandato explícito

Se `plugins/` continuar crescendo sem decisão estratégica, ele pode virar anti-owner porque parecerá
resolver extensibilidade sem ser, de fato, owner claro de nada.

## 4.2 `types/` se crescer como mega-barrel

Se `types/` continuar reexportando cada vez mais contratos heterogêneos, ele pode virar anti-owner
transversal de conveniência.

## 4.3 `infra/` se acumular semântica viva

Se `infra/` começar a carregar mais state semântico do que substrate técnico, ele deixa de ser infra
e passa a competir indevidamente com runtime/domain modules.

## 4.4 `channel/` se acumular store/conversation semantics

Se `channel/` começar a reter ownership de conversa ou sessão além do transporte, ele vira
anti-owner na fronteira entre runtime e persistência.

---

## 5. Lista oficial inicial de anti-owners do Bloco A

Conforme W7 do roadmap, a lista oficial inicial fica definida como:

1. `src/copilot/logs/`
2. `src/copilot/.github/`
3. compat shims remanescentes
4. barrels excessivamente oportunistas

Essa lista pode crescer, mas não deve encolher sem decisão explícita.

---

## 6. Uso deste inventário

Este inventário deve orientar:

- revisões de arquitetura;
- decisões de realocação física;
- criação de gates;
- scorecards de maturidade;
- decisões de descomissionamento.

Regra prática:

> se um novo comportamento central estiver nascendo num anti-owner, a mudança já começa suspeita.

---

## 7. Conclusão desta etapa

A revolução arquitetural não exige apenas definir quem são os owners corretos. Exige também definir,
com igual clareza, **quem não pode parecer owner**. Este inventário inaugura essa disciplina.
