---
name: env-governance
description: Use esta skill quando o trabalho envolver auditoria, consolidação, expansão, validação ou documentação estrutural da superfície de variáveis de ambiente, templates `.env*`, schema de ENV, precedência, segredos, integração com DevContainer ou placement entre Dockerfile/containerEnv/remoteEnv.
license: MIT
---

# Overview

Esta skill orienta governança completa da camada de ambiente do projeto.

Ela deve ser usada quando a tarefa envolver:

- mapear variáveis de ambiente reais usadas no código;
- consolidar ou expandir templates `.env*`;
- alinhar `.env.schema.json` com o runtime;
- revisar precedência entre `remoteEnv`, shell e arquivos `.env*`;
- auditar segredos, overrides locais e documentação de ENV;
- revisar a fronteira entre Dockerfile, `containerEnv`, `remoteEnv` e env por processo;
- validar superfícies JSONC que materializam configuração de ambiente;
- reduzir drift entre código, templates, schema e docs.

# When To Use

Use esta skill quando o pedido envolver qualquer uma destas situações:

- “auditar os envs”
- “consolidar variáveis de ambiente”
- “atualizar `.env.example` / `.env.local.example` / `.env.expert.example`”
- “alinhar schema de env”
- “documentar precedência de env”
- “revisar credenciais, remoteEnv e `.env.local`”
- “decidir se uma variável fica no Dockerfile, no containerEnv ou no remoteEnv”

# When Not To Use

Não use esta skill quando:

- a tarefa for apenas preencher um segredo local específico;
- o pedido for só corrigir uma variável isolada sem impacto estrutural;
- o foco principal for arquitetura documental geral, caso em que a skill correta é
  `documentation-governance`.

# Inputs / Preconditions

Antes de executar:

- localizar as fontes canônicas:
  - `.env.example`
  - `.env.local.example`
  - `.env.expert.example`
  - `.env.schema.json`
- revisar a implementação de bootstrap e config:
  - `src/core/env_bootstrap.js`
  - `src/core/config.js`
- verificar a camada DevContainer:
  - `.devcontainer/devcontainer.json`
  - `.devcontainer/Dockerfile`
  - `.devcontainer/scripts/sync-local-auth.sh`
  - `.devcontainer/scripts/validate-env.sh`
  - `.devcontainer/scripts/jsonc-validate.cjs`
- revisar a documentação viva:
  - `DOCUMENTAÇÃO/REFERENCIA/ENV_VARIABLES_GUIDE.md`
  - `DOCUMENTAÇÃO/AUDITORIAS/ENV_STRUCTURE_AUDIT_2026-03-01.md`

# Workflow

1. Mapear a superfície real de ENV.
   - Executar `node scripts/env/audit-env-surface.mjs`.
   - Quando necessário, confirmar com busca direta por `process.env.*`.
2. Classificar cada variável em uma das quatro classes:
   - baseline operacional: vai para `.env.example`
   - segredo / credencial local: vai para `.env.local.example`
   - knob especializado: vai para `.env.expert.example`
   - runtime automático / compat legado: fica fora dos templates
3. Classificar também a camada correta de injeção quando a variável toca DevContainer:
   - default de imagem: Dockerfile `ENV`
   - baseline do container de desenvolvimento: `containerEnv`
   - ponte host -> editor/processos remotos: `remoteEnv`
   - comportamento pontual de tool/processo: env por processo (não globalizar)
4. Alinhar contrato e execução no mesmo change set.
   - Atualizar `.env.schema.json` quando a chave vira contrato suportado.
   - Atualizar comentários e mensagens em `env_bootstrap` / `config.js` se a precedência mudar.
   - Remover duplicações desnecessárias entre Dockerfile, `containerEnv` e `remoteEnv`.
   - Evitar globais que conflitam com o ambiente do operador (por exemplo `FORCE_COLOR`).
5. Atualizar a documentação canônica.
   - Revisar `ENV_VARIABLES_GUIDE.md`.
   - Se a mudança for estrutural, atualizar também a auditoria de ENV e os hubs afetados.
6. Validar o resultado.
   - Executar `node scripts/env/validate-env.js`.
   - Executar `node scripts/env/check-env-local.mjs`.
   - Executar `node scripts/env/audit-env-surface.mjs`.
   - Quando a mudança tocar `.jsonc` estruturais, executar `jsonc-validate` nos arquivos afetados.
   - Quando a mudança tocar a materialização do DevContainer, executar também
     `devcontainer read-configuration --workspace-folder .` se o CLI estiver disponível.

# Guardrails

- Nunca colocar segredos reais em arquivos versionados.
- Não promover para `.env.example` variáveis efêmeras do runtime (`PM2_*`, `NODE_APP_INSTANCE`,
  `CHATGPT_ENV_*`, etc.).
- Não usar `.env.expert.example` como arquivo “ativo”; ele é catálogo, não fonte de autoload.
- Não alterar a precedência de env sem refletir isso em código, schema e documentação no mesmo
  patch.
- Não usar `remoteEnv` para simular defaults estáticos que pertencem à imagem.
- Não exportar globalmente em `containerEnv` flags de UX que deveriam ser por processo
  (`FORCE_COLOR`, toggles temporários de debug, etc.).
- Não confiar em `grep` bruto sobre JSONC comentado quando o parser real já estiver disponível.
- Se uma variável mudar comportamento padrão do sistema, documentar o impacto explicitamente.

# Validation / Done Criteria

O trabalho está completo quando:

- a superfície de `process.env.*` está classificada e coberta por templates ou allowlist consciente;
- `.env.schema.json` está coerente com o baseline suportado;
- `node scripts/env/validate-env.js` conclui sem findings inesperados;
- `node scripts/env/check-env-local.mjs` passa;
- `node scripts/env/audit-env-surface.mjs` só retorna lacunas conscientemente excluídas;
- a documentação canônica de ENV reflete o estado atual.

# Related Skills

- `documentation-governance`: usar para impactos transversais em hubs e taxonomia documental.
- `skill-creator-pt-br`: usar para evoluir esta skill ou criar variantes especializadas.
