# Checklist de Governança de ENV

## Classificação obrigatória

Toda variável nova deve cair em exatamente uma classe:

1. `baseline`: vai para `.env.example`
2. `secret/local`: vai para `.env.local.example`
3. `expert`: vai para `.env.expert.example`
4. `runtime-only`: fica fora dos templates, mas precisa de justificativa

## Placement no DevContainer

Além da classe funcional, toda variável que toca o `.devcontainer` deve cair em exatamente uma
camada:

1. `dockerfile-env`: default estrutural da imagem, independente do host
2. `container-env`: baseline do container de desenvolvimento
3. `remote-env`: ponte do host para terminais/extensões/agentes do VS Code
4. `process-only`: usar apenas no processo que precisa dela

### Regras rápidas

- não duplicar no `containerEnv` o que já é default estável do Dockerfile sem necessidade;
- não usar `remoteEnv` para esconder segredos em arquivos versionados, apenas para referenciar
  `${localEnv:*}`;
- não promover para global flags de UX que conflitam com o ambiente do operador (`FORCE_COLOR`,
  `NO_COLOR`, toggles de debug transitórios);
- quando uma variável muda de camada, atualizar a documentação canônica e o comentário de
  precedência.

## Arquivos que normalmente precisam andar juntos

- `.env.schema.json`
- `.env.example`
- `.env.local.example`
- `.env.expert.example`
- `DOCUMENTAÇÃO/REFERENCIA/ENV_VARIABLES_GUIDE.md`
- `.devcontainer/devcontainer.json`
- `.devcontainer/Dockerfile`

## Validação mínima

```bash
node scripts/env/validate-env.js
node scripts/env/check-env-local.mjs
node scripts/env/audit-env-surface.mjs
```

## Critérios para NÃO promover uma variável ao baseline

- é automática do runtime/orquestrador;
- é alias de compatibilidade de baixo valor;
- é tuning raro voltado a especialistas;
- sua exposição no template principal adiciona ruído maior que utilidade.
