# Skills (coleção)

Ponto central para armazenar e indexar skills detectadas no sistema.

Onde procurar skills:

- Skills de projeto: `.github/skills/` ou `.claude/skills/` (cada skill é uma pasta com `SKILL.md`).
- Skills pessoais: `~/.copilot/skills/`.
- Diretório desta coleção (gerado): `skills/`.

Scripts úteis:

- Sincronizar skills pessoais/projeto para `skills/`:

```bash
bash tools/skills_sync.sh
```

- Gerar índice JSON e atualizar este README:

```bash
node tools/generate_skills_index.js
```

Como usar:

1. Coloque suas skills em `.github/skills/<skill-name>/SKILL.md` para skills específicas do repositório, ou em `~/.copilot/skills/<skill-name>/SKILL.md` para skills pessoais.
2. Rode `bash tools/skills_sync.sh` para copiar skill folders para `skills/personal` e `skills/project`.
3. Rode `node tools/generate_skills_index.js` para criar `skills/index.json` e atualizar este README com uma lista resumida.

Padrão suportado: GitHub Agent Skills — `SKILL.md` com frontmatter YAML (veja `skills/template/SKILL.md`).
