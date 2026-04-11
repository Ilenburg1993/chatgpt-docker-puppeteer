# PARTE-20E — Critérios Arquiteturais para `src/copilot`

**Data**: 2026-04-10 | **Status**: Canônico | **Versão**: 1.0

> Este documento define os critérios que toda decisão arquitetural em `src/copilot` deve satisfazer.
> Usado como checklist de avaliação para novas features, refatorações e revisões de código.

---

## C1 — Princípio de Responsabilidade Única por Módulo (SRM)

> Cada módulo de nível 1 (pasta direta de `src/copilot`) deve ter **uma única razão para mudar**.

**Critérios derivados:**
- C1.1 — Todo módulo deve ter um `README.md` de 3-5 linhas definindo: o que faz, o que **não** faz, quem pode importá-lo
- C1.2 — Nenhum módulo deve ter mais de 2 responsabilidades primárias distintas
- C1.3 — Se um arquivo executa mais de 3 concerns distintos, deve ser dividido
- C1.4 — `index.js` de cada módulo deve ser um barrel puro (só re-exports, sem lógica)

---

## C2 — Hierarquia de Camadas (Dependency Direction)

> Dependências sempre fluem de camadas superiores para camadas inferiores. Nunca o inverso.

**Hierarquia canônica (de baixo para cima):**

```
[L0] core/          — utilitários ortogonais, sem dependências internas
[L1] sdk/           — wrapper do @github/copilot-sdk
[L1] db/            — persistência SQLite
[L2] config/        — configuração, system-prompt, MCP
[L2] audit/         — pipeline de auditoria, ring buffer
[L3] hooks/         — sistema de permissão e lifecycle
[L3] observability/ — logging, métricas, alertas
[L4] tools/         — definições de Tools
[L4] bridges/       — adaptadores de infraestrutura externa
[L5] agent/         — core agent, session, dialog
[L5] conversation-hub/ — hub de conversas
[L6] channel/       — client LLM-A ↔ LLM-B
[L6] api/           — HTTP, SSE, bridge de controle
[L7] terminal/      — interface interativa LLM-B
```

**Regras:**
- C2.1 — Uma camada **L(n)** nunca importa de L(n+k) para k≥1
- C2.2 — Importações horizontais (mesmo nível) são permitidas mas devem ser justificadas
- C2.3 — Qualquer nova dependência cross-layer deve ser documentada com justificativa explícita
- C2.4 — Violações detectadas por CI devem bloquear merge

---

## C3 — Interfaces de Módulo Explícitas

> Cada módulo expõe apenas o que precisa ser público. Internals ficam internos.

**Critérios:**
- C3.1 — Todo módulo tem um único ponto de entrada público: `index.js`
- C3.2 — Arquivos internos do módulo não devem ser importados diretamente por outros módulos
- C3.3 — A public API de cada módulo deve ser documentada em seu `index.js` (JSDoc de re-exports)
- C3.4 — Se dois módulos precisam de um internal um do outro, esse internal deve ser promovido a módulo separado

---

## C4 — Injeção de Dependência sobre Acoplamento Estático

> Dependências de runtime mutáveis devem ser injetadas, não importadas como singletons.

**Critérios:**
- C4.1 — Funções sem side effects devem ser puras (sem imports de estado global)
- C4.2 — Singletons (ex.: `alwaysAliveAgent`) só são exportados do nível mais alto do módulo
- C4.3 — Funções que precisam de estado de outro módulo recebem esse estado como parâmetro
- C4.4 — `setX()` setters para injeção tardia devem ser eliminados em favor de factory functions com DI explícita

---

## C5 — Tamanho e Coesão de Arquivo

> Arquivos grandes são sintoma de múltiplas responsabilidades.

**Limites:**
- C5.1 — Limite de **300 LoC** por arquivo (exceto `types.js` e barrels)
- C5.2 — Arquivos entre 300-400 LoC devem ter justificativa documentada em comentário de topo
- C5.3 — Arquivos > 400 LoC são proibidos (exceto `types.js`)
- C5.4 — Se um arquivo excede o limite, deve ser dividido por concern (ex.: `foo.js` → `foo-core.js` + `foo-handlers.js`)

---

## C6 — Ausência de Duplicação de Responsabilidade (DRY Arquitetural)

> Cada responsabilidade deve ter exatamente um local canônico no codebase.

**Critérios:**
- C6.1 — Lógica de segurança/validação centralizada em `core/security/`
- C6.2 — Configuração centralizada em `config/` — nenhum outro módulo deve definir configs de SDK
- C6.3 — Logging centralizado via `observability/logger.js` — proibido criar outros loggers
- C6.4 — Tipos centralizados em `sdk/types.js` — nenhum módulo redefine tipos do SDK
- C6.5 — Utilitários compartilhados em `core/` — não duplicados em módulos específicos

---

## C7 — Nomenclatura Consistente e Descritiva

> Nomes devem comunicar propósito sem ambiguidade.

**Critérios:**
- C7.1 — Nenhum arquivo pode se chamar `utils.js`, `helpers.js`, `misc.js` ou `shared.js` sem prefixo descritivo
- C7.2 — Nomes de arquivo refletem a responsabilidade principal (ex.: `session-factory.js`, não `session.js`)
- C7.3 — Quando dois módulos têm arquivos com nomes idênticos, ao menos um precisa ser renomeado
- C7.4 — Subpastas de módulo usam substantivos concretos (ex.: `handlers/`, `collectors/`, `lifecycle/`)
- C7.5 — Presets, factories e registros têm sufixos explícitos (`-preset.js`, `-factory.js`, `-registry.js`)

---

## C8 — Expansibilidade e Extensão Aberta

> O sistema deve suportar novas ferramentas, novos bridges, novos comandos sem modificar código existente.

**Critérios:**
- C8.1 — Novos Tools são adicionados em `tools/` sem modificar `agent/` ou `terminal/`
- C8.2 — Novos bridges são adicionados em `bridges/` sem modificar `agent/`
- C8.3 — Novos comandos do terminal são adicionados em `terminal/commands/` sem modificar outros arquivos
- C8.4 — Novos hooks são registrados via `hooks/registry.js` — não hard-coded em `agent/`
- C8.5 — Novos coletores de observabilidade são registrados em `observability/` sem modificar `core/`

---

## C9 — Auditabilidade e Rastreabilidade

> Toda ação do sistema deve ser rastreável via audit trail estruturado.

**Critérios:**
- C9.1 — Toda tool execution passa pelo `audit/pipeline.js`
- C9.2 — Toda sessão start/end é registrada no audit trail
- C9.3 — Toda permissão concedida/negada é registrada
- C9.4 — Logs de auditoria são append-only (nunca sobrescritos)
- C9.5 — Correlação de eventos via session_id e turn_id é obrigatória

---

## C10 — Isolamento de Infraestrutura Externa

> Código que depende de infraestrutura externa (SDK, git, GitHub, MCP, SQLite) deve ser isolado.

**Critérios:**
- C10.1 — Toda interação com `@github/copilot-sdk` passa por `sdk/` — nunca diretamente
- C10.2 — Interações com git/GitHub passam por `bridges/git-bridge.js` ou `bridges/gh/`
- C10.3 — Interações com MCP Tools passam por `bridges/mcp-tool-bridge.js`
- C10.4 — Interações com SQLite passam por `db/`
- C10.5 — `Dockerfile`, configurações de ambiente e variáveis de processo são centralizadas via `config/env.js`

---

## C11 — Testabilidade

> Módulos devem ser testáveis de forma isolada, sem depender de infraestrutura externa.

**Critérios:**
- C11.1 — Factories retornam objetos configuráveis — sem singleton hard-coded em lógica de negócio
- C11.2 — IO (filesystem, rede, DB) é injetável ou mockável
- C11.3 — Cada módulo tem pelo menos um arquivo de teste unitário
- C11.4 — Testes de integração cobrem os boundaries entre módulos adjacentes

---

## C12 — Zero Artefatos Runtime no Source

> Arquivos gerados em runtime não vivem em `src/`.

**Critérios:**
- C12.1 — Logs vivem em `var/logs/` ou path configurável via env — nunca em `src/`
- C12.2 — Snapshots vivem em `var/snapshots/` — nunca em `src/`
- C12.3 — Arquivos `.bak` não vivem em `src/`
- C12.4 — `.gitignore` exclui explicitamente todos os paths de artefatos runtime

---

## C13 — Performance e Resource Safety

> O sistema não deve vazar recursos nem degradar com volume.

**Critérios:**
- C13.1 — EventEmitters têm limite de listeners declarado (`setMaxListeners`)
- C13.2 — Timers criados são sempre limpos no teardown correspondente (via `timer-registry.js`)
- C13.3 — Ring buffers e caches têm tamanho máximo configurado
- C13.4 — Streams são fechados em caso de erro ou abort
- C13.5 — AbortController é propagado através de operações longas

---

## Matriz de Aplicação por Fase

| Critério | Fase 1 (Imediata) | Fase 2 (Estrutural) | Fase 3 (Hardening) |
|---|---|---|---|
| C2 — Camadas | 🔴 Corrigir violações | 🟠 Enforce via CI | ✅ Automático |
| C1 — SRM | 🟠 Adicionar README.md | 🔴 Dividir god objects | ✅ Mantener |
| C5 — Tamanho | 🟠 Identificar candidatos | 🔴 Dividir >400 LoC | ✅ Gate CI |
| C6 — DRY | 🟠 Unificar url-validator | 🔴 Unificar config | ✅ Manter |
| C3 — Interfaces | 🟡 Documentar index.js | 🔴 Eliminar internal imports | ✅ Gate CI |
| C4 — DI | 🟡 Mapear singletons | 🔴 Refatorar setters | ✅ Manter |
| C7 — Nomes | 🟠 Renomear ambíguos | 🔴 Eliminar paralelos terminal | ✅ Manter |
| C8 — Expansão | 🟡 Documentar pontos | 🔴 Registros por discover | ✅ Manter |
| C12 — Artefatos | 🔴 Mover logs/ | 🟠 CI gate | ✅ Automático |
| C10 — Infra | ✅ Já parcialmente OK | 🟠 Completar isolamento | ✅ Manter |
