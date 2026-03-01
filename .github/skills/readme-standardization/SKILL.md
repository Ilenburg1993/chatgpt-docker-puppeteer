---
name: readme-standardization
description: Use esta skill quando o trabalho for criar ou revisar README.md padronizados por pasta, com template consistente, escopo claro e navegação local previsível.
license: MIT
---

# Overview

Esta skill orienta a criação e revisão de `README.md` locais por diretório.

Ela existe para evitar:

- `README`s vazios ou genéricos;
- duplicação desnecessária do conteúdo do hub principal;
- divergência entre pastas vivas e históricas;
- desorganização na navegação local.

Use esta skill para transformar um diretório em uma unidade navegável e autoexplicativa.

# When To Use

Use esta skill quando o pedido envolver:

- “criar README em cada pasta”
- “padronizar READMEs”
- “fazer README local de um diretório”
- “criar índice local de subpasta”
- “revisar README de navegação”

# When Not To Use

Não use esta skill quando:

- a tarefa for escrever documentação de conteúdo profundo de um subsistema;
- o problema for taxonomia global ou governança transversal, caso em que a skill correta é
  `documentation-governance`;
- o diretório for apenas temporário, volátil ou claramente descartável.

# Inputs / Preconditions

Antes de escrever o `README`:

- entender o papel real do diretório;
- listar os documentos/arquivos mais relevantes da pasta;
- identificar se a pasta é ativa, técnica, operacional ou histórica;
- localizar o hub superior que esse `README` deve complementar.

Para diretórios históricos:

- confirmar que o `README` será minimalista e explicitamente não canônico.

# Workflow

1. Classificar o diretório:
   - canônico ativo;
   - subpasta viva;
   - técnico/operacional;
   - histórico.
2. Escolher o template adequado.
3. Escrever um `README` curto, orientado à navegação.
4. Linkar apenas as entradas principais da pasta.
5. Explicitar o que deve e o que não deve viver ali.
6. Atualizar o hub superior se a nova navegação local mudar o fluxo recomendado.

# Guardrails

- Não reescrever dentro do `README` o conteúdo completo dos documentos principais.
- Não transformar o `README` em changelog ou inventário excessivo.
- Não usar o mesmo template textual para diretórios vivos e históricos sem adaptação.
- Não esconder que uma pasta é histórica, legado ou não canônica.
- Se a pasta tiver poucos arquivos e pouca semântica, manter o `README` minimalista.

# Validation / Done Criteria

O `README` está bom quando:

- explica rapidamente o propósito da pasta;
- deixa claro o status documental;
- aponta para os arquivos mais importantes;
- define limites de escopo;
- melhora a navegabilidade sem duplicar o hub superior.

# Related Skills

- `documentation-governance`: usar para decidir a ordem e as ondas de rollout.
- `jsdoc-authoring`: não é a mesma coisa; usar apenas quando a tarefa for documentação de API em código.

Consulte o template base em [assets/README_TEMPLATE.md](./assets/README_TEMPLATE.md).
