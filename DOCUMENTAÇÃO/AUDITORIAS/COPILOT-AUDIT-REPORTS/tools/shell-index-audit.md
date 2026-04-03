# Audit: src/copilot/tools/shell/index.js

**Módulo**: `copilot/tools/shell` **Arquivo**: `src/copilot/tools/shell/index.js` **LOC**: 610
**Data**: 2026-06-10 **Auditor**: copilot-full-audit MF-II F07

---

## Resumo

Implementação das três shell-tools do agente: `exec_command`, `run_npm_script` e `run_node_file`. O
módulo aplica sandboxing robusto: `safeEnv()` (17 vars explícitas + regex), lista de bloqueio
`BLOCKED_COMMAND_PATTERNS` (24 regexp), whitelist de scripts npm configurável via env e validação de
extensão para run_node_file. O suporte a pipelines (`runPipeline`) é o ponto de maior risco.

**Score**: 7.8/10

---

## Achados

### P3 — Potencial Race Condition em runPipeline()

**Localização**: Função `runPipeline()`, no bloco `stages.map(…)`.

```js
const procs = stages.map((s) => spawn(s.cmd, s.args, { ...opts }));
// Piping realizado após todos os processos já terem sido iniciados
```

Todos os processos do pipeline são iniciados simultaneamente via `stages.map(…spawn(…))` antes que a
cadeia stdio seja estabelecida. Se o primeiro processo terminar e fechar stdout antes que a pipe
esteja conectada, o segundo processo nunca recebe dados e trava ou termina prematuramente.

**Impacto**: Pipelines curtos/rápidos podem retornar resultados incorretos (vazio) silenciosamente.

**Recomendação**: Inicializar processos em sequência e conectar pipes antes de iniciar o próximo
estágio, ou usar `spawn` com `{ stdio: ['pipe', 'pipe', 'pipe'] }` e pipe explícito sincronizado.

---

### P4 — Descrição Enganosa do Tool exec_command

**Localização**: `description` de `execCommandTool`.

A descrição menciona "via /bin/sh" mas o handler usa `execFile` (sem shell), que não interpreta
metacaracteres de shell. Pipeline é tratado internamente via `runPipeline()` com `spawn()`.

**Impacto**: Baixo (cosmético), mas pode induzir o modelo a esperar comportamento de shell que não
acontece.

**Recomendação**: Atualizar description para "executa via execFile (sem /bin/sh); pipeline com
sintaxe `|` é suportado internamente".

---

### P4 — BLOCKED_COMMAND_PATTERNS Contornável via Pipeline

**Localização**: Função `checkCommandBlocklist()` e lógica de parsing de pipeline.

`BLOCKED_COMMAND_PATTERNS` bloqueia `env` quando é o único comando, mas em um pipeline como
`env | grep TOKEN`, o segmento `env` pode passar se a tokenização não preservar o contexto do
primeiro segmento como bloqueado.

**Impacto**: Informação de environment potencialmente exposta se o bloco de pipeline não re-aplicar
blocklist a todos os segmentos individualmente.

**Recomendação**: Verificar que `checkCommandBlocklist()` é chamado para cada segmento do pipeline
antes de qualquer execução.

---

### P5 — WORKSPACE_ROOT Resolvido em Import.meta.url

**Localização**: `const WORKSPACE_ROOT = new URL('../../../..', import.meta.url).pathname`

Calculado no parse do módulo. Em ambientes com symlinks de módulo (ex: `npm link`), o caminho
resolvido pode diferir do root real do workspace sem resolução de symlinks.

**Impacto**: Muito baixo em cenários normais. Pode causar surpresa em setups de desenvolvimento
não-padrão.

---

## Positivos

- `safeEnv()` remove 17 variáveis sensíveis explícitas + regex
  `/TOKEN|SECRET|PASSWORD|API_KEY|CREDENTIAL|PRIVATE_KEY/i` — excelente cobertura de sanitização
- `BLOCKED_COMMAND_PATTERNS` com 24 regexps, incluindo `rm -rf`, `mkfs`, `dd if=`, `curl … | sh`
  etc.
- `ALLOWED_NPM_SCRIPTS` como Set configurável via `COPILOT_NPM_SCRIPT_ALLOWLIST` env —
  extensibilidade segura
- Extensões permitidas para `run_node_file`: apenas `.js`, `.mjs`, `.cjs`
- Max pipeline stages = 5 (hardcoded, previne abuso)
- `MAX_OUTPUT_BYTES = 10_000`, `MAX_TIMEOUT_MS = 120_000`

---

## Status de Correção (2026-04-03)

### [FIXED] SEC-TOOLS-001 (P1) — Path traversal via symlink mitigado

validateCwd() e validação de run_node_file agora usam realpathSync() para resolver symlinks antes de
comparar com WORKSPACE_ROOT (também resolvido via realpathSync). Ataque '../../etc/passwd' via
symlink agora é bloqueado corretamente.

**Pontuação atualizada: 9.0/10**

---

## Status de Correção (2026-04-03)

### [FIXED] SEC-TOOLS-001 (P1) — Path traversal via symlink mitigado

validateCwd() e validação de run_node_file agora usam realpathSync() para resolver symlinks antes de
comparar com WORKSPACE_ROOT (também resolvido via realpathSync). Ataque '../../etc/passwd' via
symlink agora é bloqueado corretamente.

**Pontuação atualizada: 9.0/10**
