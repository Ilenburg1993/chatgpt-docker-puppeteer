# Auditoria - `.devcontainer/scripts/post-create.sh`

> **Data:** 2026‑02‑25 **Autor:** GitHub Copilot (revisão técnica automatizada)

Este documento contém a análise detalhada do `post-create.sh`, identifica bugs, inconsistências e
oportunidades de melhoria substanciais, e propõe correções e upgrades de larga escala.

---

## 1. Visão Geral

O `post-create.sh` é um script **crítico de verificação estrutural** executado durante a criação do
DevContainer. Ele valida identidade, contratos de ambiente, montagens, volume e instrumenta o
ambiente com wrappers (NSS, histórico, logging). Com 1.8 k linhas, o arquivo já atingiu complexidade
elevada e serve como referência canônica para OPS e desenvolvedores.

Embora bem documentado e historicamente robusto, a auditoria revelou problemas funcionais e áreas
onde a manutenção custa caro devido à duplicação de lógica.

---

## 2. Principais Defeitos/Bugs

| Prioridade | Localização                                                                                                                                                                     | Descrição                                                                                                                                          | Impacto                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **P0**     | Linha ~~198 (2.1.1)                                                                                                                                                             | `CURRENT_UID` usado antes de ser definido. Com `set -u` isso provoca _exit_ imediato ao executar o script, tornando-o inoperável em builds limpos. | Container não inicializa; falha no boot.                          |
| P1         | Helper `check_chown_contract`                                                                                                                                                   | É invocado com variável indefinida; também depende de `stat` sem fallback robusto.                                                                 | Warnings inexistentes ou falso-negativos em ambientes sem `stat`. |
| P2         | Variáveis definidas manualmente (ARRAYS `STRUCTURAL_ENV_VARS`, etc.) duplicam a especificação do JSON schema. Divergência já causou a omissão recente de `BROWSER_PAGE_TTL_MS`. | Risco de drift entre shell e validadores Node (`.env.schema.json`).                                                                                |
| P2         | `audit_mounts` usa `mount                                                                                                                                                       | grep` com regex não-escapada. Caminhos com caracteres especiais podem quebrar e a ferramenta é ausente em mínimos contêineres.                     | Missed mounts, incapacidade de diagnosticar binds.                |
| P3         | Logging fornece rotação básica, mas não há garantia de retenção ou compressão.                                                                                                  | Logs crescem indefinidamente se `stat`/update falha.                                                                                               |
| P3         | `warn` fallback definido duas vezes (primeiro dissipado; depois substituído). Pode causar comportamento inconsistente quando helpers são chamados antes da re‑definição.        | Difícil de testar/estender.                                                                                                                        |

> **Observação**: testes unitários existentes (em `tests/unit/devcontainer/mounts.spec.js`) não
> cobrem a chamada prematura de `CURRENT_UID` porque o script é tipicamente _sourced_; o bug só
> surge em execução direta.

---

## 3. Sugestões de Correção Imediata

1. **Mover leitura de UID/GID antes de qualquer uso** ou passar `$(id -u)` diretamente:
   ```bash
   readonly CURRENT_UID="$(id -u 2>/dev/null || echo unknown)"
   readonly CURRENT_GID="$(id -g 2>/dev/null || echo unknown)"
   check_chown_contract "${PROJECT_ROOT}" "${CURRENT_UID}"
   ```
2. Ajustar `check_chown_contract` para não depender de `warn` externo e documentar seu
   comportamento.
3. Atualizar arrays `STRUCTURAL_ENV_VARS`/`INFRASTRUCTURE_ENV_VARS`/etc. para ler diretamente o
   arquivo `.env.schema.json` (possible usando `grep`/`jq`) ou mover a lógica de validação inteira
   para o script Node já presente.
4. Escapar corretamente `proj` em `audit_mounts` e adicionar fallback usando `findmnt`/`mountpoint`.
5. Consolidar `warn`/`error` definidas duas vezes; definir helpers de logging antes de qualquer
   outro código e exportá-los para testes.
6. Expandir mecanismo de rotação de logs para manter, por exemplo, últimos 3 arquivos e comprimir
   backups.

Pequeno patch (exemplo):

```bash
# before 2.1.1
readonly CURRENT_USER="$(id -un 2>/dev/null || echo unknown)"
readonly CURRENT_UID="$(id -u 2>/dev/null || echo unknown)"
readonly CURRENT_GID="$(id -g 2>/dev/null || echo unknown)"

# chown assertion
check_chown_contract "${PROJECT_ROOT}" "${CURRENT_UID}"
```

---

## 4. Upgrades e Refatorações Estratégicas

Além das correções, recomenda-se um conjunto de **upgrades de grande impacto** para tornar o
`post-create` mais confiável e evolutivo:

### 4.1 Migrar de Bash para Node/TypeScript & reutilizar a lógica existente

- O repositório já contém `scripts/env/validate-env.js` com parsing do esquema e relatórios
  coloridos. Reimplementar _toda_ validação (STRUCTURAL/INFRA/OPERATIONAL/Flags) em Node permite:
  - uso direto do `.env.schema.json` (única fonte de verdade);
  - melhor tratamento de erros, async I/O e telemetria;
  - geração de artefatos JSON para análises CI; e
  - facilidade de testes unitários usando o runner `node --test`.
- O script Node poderia exportar funções consumíveis pelas pipelines de CI/CD e pelo próprio
  `post-create.sh` (via `node -e 'require(...)'`).

### 4.2 Modularizar e reduzir acoplamento

Extrair seções em arquivos menores (`logging.sh`, `identity.sh`, `env.sh`, `mounts.sh`) e
`source`‑los condicionalmente. Isso reduz o custo de revisão e permite reuso nos
`post-start.sh`/`post-attach.sh`.

### 4.3 Integração com devcontainer.json e VS Code

- Adicionar um hook `postStartCommand` opcional que registra apenas as diferenças incrementais,
  usando o mesmo mecanismo de _replay_.
- Emitir notificações via `echo "::warning::…"` para que o VS Code destaque problemas diretamente na
  UI.

### 4.4 Políticas de cache e estado

- Implementar um arquivo de manifesto estrutural (`.devcontainer/state.json`) com hash do script,
  UID/GID, versão da schema. O `post-create` deve pular etapas (audit, volume) se nada mudou.
- Essa cache permitiria **boot instantâneo** em processos de desenvolvimento rápido.

### 4.5 Validação adicional de infraestrutura

- Verificar a disponibilidade do Chrome/Proxy (ping na porta) e sugerir `make up` se não encontrado.
- Incluir checagem de `docker` CLI ou `kubectl` conforme necessário.

### 4.6 Suporte multiplataforma aprimorado

- Reduzir dependências de utilitários GNU (`stat`, `mount`). Adaptar `check_chown_contract` e
  `audit_mounts` para macOS/Windows (p.ex. usando `stat -f %u`).
- Documentar claramente o comportamento em ambientes WSL vs Linux.

### 4.7 Documentação e audit trails

- Gerar automaticamente notas de versão (`CHANGELOG`) a partir de cabeçalhos `# CHANGELOG` no
  script, de modo que o MD esteja sempre sincronizado.
- Adicionar um modo `--dry-run` que imprime ações previstas sem executar chown ou mkdir.

### 4.8 Segurança e sanitização

- Atualmente argumentos como `proj` são interpolados diretamente em regex; escopo poderia ser
  violado por nomes maliciosos. Use `printf '%q'` ou variáveis seguras.
- Proibir execução de `mount` arbitrário (ya, check with `set -u -o nounset`).

---

## 5. Próximos passos

1. Aplicar os _fixes imediatos_ listados na seção 3 e rodar novamente a bateria de testes de
   `devcontainer/mounts.spec.js`.
2. Refatorar a validação de ENV para alimentar-se de `.env.schema.json` (Node ou `jq`).
3. Planejar a migração gradual para Node/TS; iniciar com a extração de `env.sh`.
4. Atualizar a documentação de boot (`.devcontainer/ENV_ANALYSIS_V6.md`) para refletir as novas
   garantias.
5. Revolver a seção de `ensure_dir_*` para tratar erros de permissão com mais clareza e remover
   duplicação.

---

### 6. Conclusão

O `post-create.sh` é um dos artefatos mais sensíveis do workspace; pequenas falhas afetam
diretamente a experiência de todos os desenvolvedores. A auditoria expôs um bug crítico e várias
áreas de manutenção onerosa. Com as correções propostas e um plano de modernização, o script poderá
continuar sendo um pilar seguro e evolutivo do ambiente de desenvolvimento.

_Fim do relatório._
