# Migração TypeScript 7+, memória WSL/DevContainer e estado-alvo — 2026-08-20

## 1. Estatuto deste documento

Este documento é a referência canônica, a partir de 2026-08-20, para duas mudanças que precisam ser
tratadas como um único problema de arquitetura:

1. tornar **TypeScript 7+ o baseline real e exclusivo do workspace**, mantendo TypeScript 6 apenas
   em ilhas de compatibilidade que sejam demonstravelmente exigidas por dependências upstream ainda
   incompatíveis com TS7;
2. reduzir e tornar observável o consumo de memória do WSL/DevContainer, sobretudo o custo
   estrutural do VS Code Server remoto, Extension Host e agentes de IA instalados/ativados
   automaticamente.

O roadmap anterior, `DOCUMENTAÇÃO/PLANOS/MIGRACAO_TYPESCRIPT_7_WORKSPACE_ROADMAP_2026-08-19.md`,
continua útil como histórico, mas não deve ser usado isoladamente para decidir um rebuild: a
investigação de 2026-08-20 revelou dependências TypeScript 5 transitivas, um grafo npm inválido e
uma causa de memória que não estava suficientemente modelada.

**Decisão operacional atual:** ainda não considerar o DevContainer pronto para rebuild até que os
gates da fase 7 deste documento estejam concluídos.

---

## 2. Resumo executivo

### 2.1 TypeScript

O código versionado já avançou materialmente para TS7:

- `@typescript/native` resolve TypeScript **7.0.2** e é a autoridade dos scripts `tsc7`/typecheck;
- `.devcontainer/Dockerfile` já declara `TYPESCRIPT_VERSION=7.0.2` e instala o compilador global da
  geração TS7;
- o VS Code usa `TypeScriptTeam.native-preview` e `js/ts.experimental.useTsgo=true`;
- os lanes strict do workspace chamam `scripts/ci/run-typescript-7.mjs`.

A investigação, porém, encontrou um problema estrutural no grafo npm:

- `typescript` na raiz é um alias para `@typescript/typescript6` **6.0.2**, ainda necessário hoje
  para `typescript-eslint` 8.67 (`typescript >=4.8.4 <6.1.0`);
- `madge` 8 exige `typescript ^5.4.4`, o que torna o alias TS6 inválido para seu peer;
- a árvore de Madge introduz **TypeScript 5.9.3** transitivamente;
- `npm ls` retorna `ELSPROBLEMS`;
- portanto o workspace contém simultaneamente TS7, TS6 e TS5 — situação incompatível com o
  estado-alvo.

Além disso, alguns analisadores internos ainda importam `scripts/analysis/typescript-compat.mjs`.
Isso é dívida técnica: uma ferramenta interna não deve conservar TS6 se puder usar a infraestrutura
Babel já canônica no projeto.

### 2.2 Memória WSL/DevContainer

A memória observada não aponta para o language server TS7 como principal culpado. No snapshot
investigado, **não havia processo `tsgo`, `tsserver` nem TypeScript language server ativo**.

Os maiores consumidores observados foram:

| Componente                      | Evidência aproximada no snapshot | Interpretação                                                    |
| ------------------------------- | -------------------------------: | ---------------------------------------------------------------- |
| VS Code remote Extension Host   |     ~1,0 GiB RSS / ~0,98 GiB PSS | custo agregado das extensões remotas ativadas                    |
| Gemini `cloudcode_cli`          |    ~0,81 GiB RSS / ~0,83 GiB PSS | processo próprio do agente; recebe eventos de documentos abertos |
| Kilo                            |    ~0,49 GiB RSS / ~0,50 GiB PSS | processo/agente próprio ativado no startup                       |
| MCP/projeto Node                |                    ~0,32 GiB RSS | runtime do projeto/MCP, custo esperado mas relevante             |
| Codex                           |                    ~0,13 GiB RSS | processo adicional de agente                                     |
| demais processos VS Code Server |        centenas de MiB agregados | infraestrutura remota do editor                                  |

Somente `Extension Host + Gemini + Kilo` representavam aproximadamente **2,25 GiB de PSS**.

No cgroup do DevContainer, o snapshot mostrou aproximadamente:

- ~3,4 GiB de memória anônima;
- ~3,6 GiB de file/page cache;
- `memory.current` em torno de 7,2 GiB no instante medido;
- nenhum evento OOM/high relevante;
- pressão PSI de memória desprezível;
- swap sem uso;
- WSL com aproximadamente 11 GiB ainda disponíveis.

Isso produz duas conclusões diferentes e complementares:

1. existe consumo anônimo real e elevado, dominado por editor/extensões/agentes;
2. uma parcela grande da memória vista pelo Windows é **page cache Linux reclamável**, portanto não
   deve ser tratada automaticamente como leak.

### 2.3 Causa arquitetural dominante da RAM

`config/vscode/extensions.mjs` ainda define como auto-install do DevContainer praticamente o
conjunto inteiro de ferramentas e agentes: foundation + GitHub + AI + documentação. Assim, Claude,
CodeRabbit, ChatGPT, Gemini, HuggingFace, Kilo e OpenCode entram como custo estrutural de toda
sessão.

Os logs do VS Code confirmaram ativações `onStartupFinished` para agentes pesados, incluindo Gemini,
Kilo e Claude; OpenAI/ChatGPT foi ativado pela view. A configuração do Gemini já desabilita outlines
automáticos, mas o processo `cloudcode_cli` continua ativo e recebe eventos LSP/documentos,
inclusive Markdown.

O problema é agravado porque `/home/node/.vscode-server` está em um **volume Docker persistente**.
Portanto, retirar uma extensão da lista de auto-install não basta: um rebuild que reutilize o mesmo
volume pode conservar extensões remotas antigas. A migração deve usar uma nova geração de volume de
VS Code Server, preservando o volume anterior para rollback em vez de apagá-lo destrutivamente.

---

## 3. Princípios do estado-alvo

### 3.1 TypeScript

1. **TS7 é autoridade:** todo compile/typecheck/editor language service do workspace usa TS7+.
2. **TS5 é proibido:** nenhuma versão TypeScript <6 pode existir no grafo instalado ou no lockfile.
3. **TS6 é compatibilidade, não baseline:** só pode existir quando uma ferramenta upstream ainda
   declarar incompatibilidade com TS7.
4. **Ilhas TS6 precisam de justificativa verificável:** atualmente `typescript-eslint` é uma ilha
   válida; `dependency-cruiser` também declara suporte até `<7` em sua integração TypeScript atual,
   caso seja usado para parse TypeScript.
5. **Ferramentas internas não justificam TS6 por conveniência:** analisadores próprios devem migrar
   para Babel ou APIs TS7 adequadas.
6. **Sem suppressions:** `@ts-ignore`, `@ts-nocheck` e `@ts-expect-error` permanecem proibidos em
   source e testes.
7. **Sem falso strict:** todos os lanes devem continuar submetidos aos tsconfigs strict canônicos e
   ao compilador TS7.

### 3.2 Editor e DevContainer

1. o DevContainer auto-instala somente o baseline técnico necessário;
2. agentes de IA são perfis explícitos/on-demand, não custo obrigatório;
3. recomendações pessoais não são confundidas com resíduos removíveis;
4. `--prune` só pode remover extensões realmente legadas/conflitantes e host-only instaladas no
   remoto;
5. o volume do VS Code Server usa geração nova na migração, preservando a geração anterior para
   rollback;
6. não impor hard memory cap como substituto de arquitetura — isso apenas converte demanda alta em
   OOM;
7. memória deve ser medida por PSS/anon/file/cache e não somente por RSS ou pelo número agregado do
   Gerenciador de Tarefas.

---

## 4. Arquitetura TypeScript: situação atual e ideal

### 4.1 Situação atual

| Faixa    | Origem                                        | Papel atual                                                               | Estado                            |
| -------- | --------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------- |
| TS 7.0.2 | `@typescript/native`                          | compilação/typecheck e editor TS7                                         | **canônico**                      |
| TS 6.0.x | alias `typescript -> @typescript/typescript6` | compatibilidade `typescript-eslint`; alguns analisadores internos antigos | **permitido apenas parcialmente** |
| TS 5.9.3 | árvore de `madge`                             | transitivo de análise de dependências                                     | **proibido / remover**            |

O TS7 nativo observado expõe `tsc`, mas **não expõe `tsserver`**. Isso é coerente com a migração
para o servidor nativo/TSGO. Após rebuild, a ausência de `tsserver` global deve ser considerada um
sinal desejável, não uma falha.

### 4.2 Estado ideal

O grafo deve convergir para:

```text
TypeScript 7+
├─ @typescript/native -> compilação, typecheck, CI, VS Code/TSGO
└─ autoridade única dos contratos do workspace

TypeScript 6 compat (temporário)
├─ typescript-eslint, enquanto peer < 6.1 / sem TS7
└─ ferramenta upstream adicional somente se houver incompatibilidade documentada

TypeScript < 6
└─ inexistente
```

A presença do alias `typescript` para TS6 não pode induzir scripts internos a importá-lo
casualmente. A compatibilidade deve ser explicitamente nomeada, documentada e auditável.

---

## 5. Substituição de Madge e modernização do grafo

Madge não pode permanecer como gate arquitetural porque sua árvore mantém TS5 e atualmente gera
`ELSPROBLEMS`.

O workspace já possui `@babel/parser` e uma política canônica em `src/copilot/infra/parse`. A
arquitetura-alvo é um grafo interno que:

- parseia JS/TS/ESM/CJS via Babel;
- extrai imports estáticos, dinâmicos, `require()` e reexports;
- resolve caminhos pelo resolvedor Node, incluindo `package.json#imports` (`#copilot/*`);
- mantém somente arestas internas ao escopo analisado;
- encontra componentes fortemente conexos para detectar ciclos;
- fornece fan-in/fan-out para hotspots;
- produz JSON/DOT sem depender de TypeScript 6;
- retorna exit code não zero para ciclo ou parse incompleto em modo gate.

`dependency-cruiser` continua útil como segunda visão arquitetural. Sua regra `no-circular`, porém,
precisa deixar de ser `warn` e se tornar `error` para não reduzir a severidade do gate após a
retirada de Madge.

---

## 6. Arquitetura VS Code: baseline e perfis

### 6.1 Baseline técnico proposto para auto-install

O baseline remoto deve permanecer pequeno e diretamente relacionado a linguagem, validação e
infraestrutura:

- `TypeScriptTeam.native-preview`
- `dbaeumer.vscode-eslint`
- `esbenp.prettier-vscode`
- `ms-azuretools.vscode-containers`
- `ms-vscode.makefile-tools`
- `timonwong.shellcheck`
- `redhat.vscode-yaml`
- `EditorConfig.EditorConfig`
- `Vue.volar`
- `github.vscode-github-actions`
- `DavidAnson.vscode-markdownlint`

### 6.2 Perfis on-demand

Devem existir perfis explícitos para:

- agentes de IA (`agents` / `agents-full`);
- conveniência/UX;
- Python;
- documentação especializada;
- GitHub ampliado.

A existência do perfil on-demand preserva liberdade funcional sem transformar todos os agentes em
residentes de memória de cada sessão.

### 6.3 Recomendações pessoais versus prune

`unwantedRecommendations` significa “não recomendado pelo workspace”; isso não é semanticamente
igual a “seguro para desinstalar”. O reconciliador deve possuir uma lista separada de extensões
**prunáveis**, restrita a extensões obsoletas, conflitantes ou incorretamente instaladas no
Extension Host remoto.

A preferência já registrada por `oderwat.indent-rainbow` deve ser preservada como recomendação/UX,
não convertida novamente em item removível.

---

## 7. Persistência do VS Code Server e estratégia de rebuild

O mount atual é:

```text
source=devcontainer-vscode-server,target=/home/node/.vscode-server,type=volume
```

Como esse volume persiste binários, extensões e estado, retirar extensões do `devcontainer.json` não
garante um runtime limpo. A estratégia segura é **generation bump** do nome do volume na
configuração versionada, por exemplo:

```text
source=devcontainer-vscode-server-ts7,target=/home/node/.vscode-server,type=volume
```

Benefícios:

- rebuild inicia um VS Code Server remoto limpo;
- somente o novo baseline é auto-instalado;
- o volume antigo permanece intacto e pode ser usado para rollback/forense;
- não é necessário purge destrutivo para validar a nova arquitetura.

O estado de autenticação de agentes pode exigir reautenticação quando o usuário reinstalar agentes
opcionais, dependendo de onde cada extensão persiste credenciais. Os volumes dedicados (`.claude`,
caches etc.) permanecem independentes.

---

## 8. Modelo correto de memória

### 8.1 Métricas que importam

- **RSS:** páginas residentes atribuídas a um processo; pode duplicar páginas compartilhadas.
- **PSS:** divide páginas compartilhadas entre processos; melhor para somar custo efetivo.
- **PSS Anon:** aproxima heaps/stacks/memória privada real.
- **PSS File:** páginas file-backed.
- **cgroup anon:** pressão anônima efetiva do container.
- **cgroup file:** cache/file-backed, em grande parte reclamável.
- **MemAvailable:** melhor sinal de headroom do Linux que `MemFree`.
- **PSI:** informa pressão/espera, não apenas ocupação.
- **memory.events:** evidencia OOM/high/max.

### 8.2 O que não fazer

- não concluir “leak” apenas por WSL aparecer grande no Windows;
- não somar RSS de todos os processos como se não houvesse compartilhamento;
- não reduzir `memory=` no `.wslconfig` como primeira medida;
- não adicionar swap como correção para extensões residentes;
- não executar vários typechecks/linters pesados simultaneamente durante a migração.

### 8.3 O que fazer

Criar auditor local reprodutível que leia `/proc` e cgroup, agrupe processos por função e permita
comparar antes/depois do rebuild. O critério de sucesso deve distinguir redução de **anon/PSS** de
mera oscilação de page cache.

---

## 9. Riscos e rollback

### 9.1 Riscos

- retirada de Madge pode degradar o gate se o substituto não resolver aliases/reexports/dynamic
  imports;
- redução do auto-install pode surpreender quem espera um agente já disponível;
- novo volume de VS Code Server implica download/reinstalação inicial;
- o alias TS6 continuará existindo enquanto upstream exigir, portanto scripts internos precisam
  evitar import acidental;
- caches Linux podem fazer a memória total parecer alta mesmo após a redução de agentes.

### 9.2 Rollback

- não apagar o volume `devcontainer-vscode-server` anterior;
- generation bump é reversível por uma única mudança no mount;
- manter perfis de extensões capazes de reinstalar agentes explicitamente;
- alterações do grafo devem ser cobertas por testes/gates antes da remoção definitiva de Madge;
- alterações de lockfile devem ser validadas com `npm ls` e gates TypeScript antes do rebuild.

---

## 10. Roadmap executável

### Fase 0 — Reconstrução do estado

- [x] Confirmar branch/HEAD e dirty state antes da intervenção.
- [x] Ler roadmap TS7 anterior e configuração atual.
- [x] Confirmar `@typescript/native` 7.0.2 como compilador canônico local.
- [x] Confirmar Dockerfile versionado já apontando para TS7.
- [x] Auditar `npm ls` e identificar TS7 + TS6 + TS5 simultâneos.
- [x] Identificar Madge como fonte de TS5/`ELSPROBLEMS`.
- [x] Confirmar `typescript-eslint` como justificativa upstream real para TS6.
- [x] Auditar memória por processo, PSS/RSS, cgroup e `/proc/meminfo`.
- [x] Confirmar ausência de `tsgo`/`tsserver` ativo no snapshot de memória.
- [x] Confirmar ativação automática de agentes pesados nos logs do VS Code.
- [x] Confirmar persistência de `/home/node/.vscode-server` em volume Docker.

### Fase 1 — Grafo arquitetural sem TS5/Madge

- [ ] Implementar grafo Babel/Node canônico independente de TypeScript 6.
- [ ] Migrar `scripts/analysis/analyze-code-graph.js` para o novo grafo.
- [ ] Migrar `scripts/analyze-copilot-hotspots.mjs` para o novo grafo.
- [ ] Migrar coletores de auditoria que chamam/parsam Madge.
- [ ] Renomear etapas de auditoria `static.madge` para `static.depgraph`.
- [ ] Elevar `dependency-cruiser/no-circular` de warning para error.
- [ ] Remover `madge` de `package.json` e atualizar lockfile/node_modules.
- [ ] Remover declaração `src/types/madge.d.ts` após zero usos ativos.
- [ ] Validar `npm ls` sem `ELSPROBLEMS` e sem TypeScript 5.x.

### Fase 2 — Guard automático do baseline TypeScript

- [ ] Criar `check-typescript-baseline` com inspeção de versões/lockfile.
- [ ] Falhar se houver TypeScript major <6.
- [ ] Falhar se `@typescript/native` deixar de ser major >=7.
- [ ] Tornar explícitas as ilhas TS6 permitidas e seus motivos.
- [ ] Detectar quando upstream passar a aceitar TS7 para poder remover a ilha TS6.
- [ ] Integrar o guard aos gates adequados sem duplicar typecheck pesado.

### Fase 3 — Redução das ilhas TS6 internas

- [ ] Inventariar todos os imports de `scripts/analysis/typescript-compat.mjs`.
- [ ] Remover do analisador de dependências/grafo.
- [ ] Avaliar/migrar JSDoc coverage para Babel/infra já existente.
- [ ] Avaliar/migrar typing hardening audit para TS7/Babel conforme semântica necessária.
- [ ] Avaliar/migrar `diagnostic-full.mjs`.
- [ ] Reescrever comentário/contrato de `typescript-compat.mjs` para refletir somente
      compatibilidade upstream residual.
- [ ] Confirmar que nenhuma ferramenta interna usa TS6 apenas por conveniência.

### Fase 4 — Extensões e memória do VS Code

- [ ] Reduzir `VSCODE_DEVCONTAINER_EXTENSIONS` ao baseline técnico.
- [ ] Criar perfil explícito para agentes de IA.
- [ ] Criar perfis de conveniência/UX/documentação/GitHub ampliado.
- [ ] Separar `unwantedRecommendations` de `prunable`.
- [ ] Preservar `oderwat.indent-rainbow` como preferência/recomendação, não prune.
- [ ] Atualizar reconciliador e testes.
- [ ] Trocar formatter Markdown default para Prettier se Markdown All In One sair do baseline.
- [ ] Sincronizar projeções `.devcontainer/devcontainer.json` e `.vscode/extensions.json`.
- [ ] Fazer generation bump do volume `/home/node/.vscode-server` sem apagar o volume antigo.

### Fase 5 — Observabilidade de memória

- [ ] Criar `scripts/analysis/devcontainer-memory-audit.mjs`.
- [ ] Coletar MemAvailable, cgroup current/peak/anon/file/swap/events e PSI.
- [ ] Coletar PSS/RSS/PSS-anon/PSS-file por processo quando permitido.
- [ ] Agrupar VS Code, extension host, Gemini, Kilo, agentes, MCP, navegador e infraestrutura.
- [ ] Oferecer saída humana e `--json`.
- [ ] Adicionar scripts npm para baseline pré/pós rebuild.

### Fase 6 — Validação pré-rebuild

- [ ] `npm ls` íntegro, sem TS5 e sem peer invalid.
- [ ] `npm run check:typescript-baseline` verde.
- [ ] `npm run analyze:deps` verde e gate de ciclo estrito.
- [ ] hotspot/auditoria de arquitetura funcionando sem Madge.
- [ ] testes focados de extensões verdes.
- [ ] `npm run vscode:sync:check` verde.
- [ ] `npm run vscode:check` verde no estado versionado.
- [ ] `npm run check:ts-suppressions` verde.
- [ ] typecheck TS7 strict relevante verde.
- [ ] lint relevante verde.
- [ ] DevContainer JSON/sync/shell gates verdes.
- [ ] diff final auditado, sem apagar alterações preexistentes do usuário.

### Fase 7 — Gate de rebuild

- [ ] Marcar explicitamente neste documento que o estado versionado está pronto para rebuild.
- [ ] Rebuild do DevContainer pelo usuário.
- [ ] Confirmar pós-rebuild: `node --version` e `npm --version` esperados.
- [ ] Confirmar pós-rebuild: `tsc --version` major 7+.
- [ ] Confirmar pós-rebuild: `npm run -s tsc7 -- --version` major 7+.
- [ ] Confirmar pós-rebuild: `command -v tsserver` ausente, salvo nova justificativa explícita.
- [ ] Confirmar apenas baseline de extensões auto-instalado no novo volume.
- [ ] Medir memória após estabilização do editor e comparar PSS/anon com baseline de 2026-08-20.
- [ ] Reexecutar gates TypeScript/lint/DevContainer no runtime novo.

---

## 11. Critérios formais para declarar “pronto para rebuild”

A autorização de rebuild só deve ser dada quando, cumulativamente:

1. não houver TypeScript 5.x no lockfile nem em `npm ls`;
2. `npm ls` não reportar `ELSPROBLEMS` relacionado ao stack TypeScript;
3. Madge não estiver mais no runtime/dependency graph ativo;
4. o gate de circularidade substituto estiver estrito e validado;
5. o baseline de extensões estiver reduzido e projetado no `devcontainer.json`;
6. a nova geração do volume VS Code Server estiver configurada;
7. o guard TypeScript estiver verde;
8. os validadores focados de TS7/lint/DevContainer estiverem verdes;
9. as alterações preexistentes do usuário tiverem sido preservadas semanticamente;
10. este roadmap estiver atualizado com a Fase 6 concluída.

Até lá, a formulação correta é: **o repositório está em migração e o runtime atual continua sendo
uma evidência pré-rebuild, não o estado final**.

---

## 12. Baseline de evidência para comparação pós-rebuild

Registrar como baseline do snapshot investigado em 2026-08-20:

- Extension Host remoto: ~1 GiB RSS;
- Gemini `cloudcode_cli`: ~0,81 GiB RSS;
- Kilo: ~0,49 GiB RSS;
- MCP/projeto Node: ~0,32 GiB RSS;
- Codex: ~0,13 GiB RSS;
- cgroup: ~3,4 GiB anon + ~3,6 GiB file cache;
- swap: 0;
- WSL MemAvailable: ~11 GiB;
- TS language server dedicado: não observado no snapshot.

A comparação futura deve ser feita após alguns minutos de estabilização do editor, com conjunto de
arquivos semelhante aberto. O alvo principal é reduzir PSS/anon de extensões/agentes; queda ou
aumento de `file` isoladamente não é critério suficiente.

---

## 13. Decisões que não devem ser revertidas acidentalmente

- TS7 é o baseline e não deve voltar a ser “preview opcional”.
- TS6 não deve voltar a ser o `tsc` global/canônico.
- TS5 é proibido.
- não reintroduzir Madge enquanto ele exigir TS5.
- não restaurar todos os agentes de IA ao auto-install para “conveniência”.
- não confundir recommendation policy com autorização de desinstalação.
- não apagar o volume VS Code Server antigo como parte automática da migração.
- não resolver RAM impondo hard cap antes de reduzir demanda estrutural.
