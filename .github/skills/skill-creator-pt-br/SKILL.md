---
name: skill-creator-pt-br
license: Complete terms in LICENSE.txt
metadata:
  category: development
  source:
    repository: 'https://github.com/ComposioHQ/awesome-claude-skills'
    path: skill-creator
description: >-
  Orientações detalhadas para construir ou atualizar skills que ampliem as capacidades do agente com
  conhecimento especializado, fluxos de trabalho e integrações de ferramentas. Deve ser usada quando
  o objetivo é criar uma skill nova ou melhorar uma existente.
---

# Criador de Skills

Esta skill contém instruções e boas práticas para elaborar skills efetivas.

## Conceito de Skill

Skills são pacotes modulares e autocontidos que estendem as capacidades do agente ao fornecer:

1. **Fluxos de trabalho especializados** – sequências de passos para domínios específicos;
2. **Integrações de ferramentas** – procedimentos para trabalhar com dados, APIs ou formatos de
   arquivo concretos;
3. **Conhecimento de domínio** – vocabulário, regras de negócio e convenções que um modelo genérico
   não domina;
4. **Recursos empacotados** – scripts, referências e ativos para tarefas complexas ou repetitivas.

Pense em skills como um “manual de bordo” que transforma o agente genérico em um assistente treinado
para um conjunto definido de tarefas.

## Estrutura de um Skill

Um skill consiste obrigatoriamente de um arquivo `SKILL.md` e pode incluir recursos opcionais.

Por convenção, as skills residem no diretório `.github/skills/` do repositório. Esse caminho é
utilizado pelo conjunto de scripts de empacotamento/validação e facilita a manutenção quando vários
skills são armazenados juntos. Caso haja necessidade, a skill também pode ser criada em outro local,
mas lembre-se de fornecer o caminho correto durante o empacotamento ou execução.

Um skill consiste obrigatoriamente de um arquivo `SKILL.md` e pode incluir recursos opcionais:

```
skill-name/
├── SKILL.md (obrigatório)
│   ├── frontmatter YAML com metadata
│   └── instruções Markdown
└── Recursos (opcionais)
    ├── scripts/          - código executável (Python/Bash/etc.)
    ├── references/       - documentação que o agente deve consultar
    └── assets/           - arquivos usados nas saídas (templates, logos etc.)
```

### `SKILL.md` (obrigatório)

- **metadata**: `name` e `description` definem o gatilho do skill. Seja preciso e use terceira
  pessoa. Ex.: “Esta skill deve ser usada quando ...”.
- **corpo**: instruções procedurais e orientações principais; evite texto longo e não procedural.

### Recursos complementares (opcionais)

#### Scripts (`scripts/`)

- Incluir quando há código repetidamente reescrito ou que exija confiabilidade determinística.
- Exemplos: `scripts/rotate_pdf.py`, `scripts/generate_report.sh`.
- Vantagens: economiza tokens, garante resultados previsíveis e pode ser executado sem entrar no
  contexto.

#### Referências (`references/`)

- Documentação ou informação que o agente deve carregar sob demanda.
- Use quando houver detalhes como esquemas, políticas, guias ou documentação extensa (>10 000
  palavras).
- Inclua padrões de pesquisa (`grep`) no `SKILL.md` para arquivos grandes.
- Evite duplicação: escolha entre SKILL.md ou arquivos de referência – não ambos.

#### Ativos (`assets/`)

- Arquivos que serão incorporados na saída final, mas não precisam ser lidos.
- Exemplos: logos, templates HTML, arquivos binários.

## Princípio de Divulgação Progressiva

Para gerenciar eficiência de contexto, o carregamento de dados segue três níveis:

1. **Metadados** (`name` + `description`) – sempre presentes (~100 palavras);
2. **Texto do SKILL.md** – carregado quando o skill é acionado (<5 000 palavras);
3. **Recursos empacotados** – carregados/executados apenas se e quando necessários (sem limite de
   tamanho).

## Processo de Criação de Skills

Siga as etapas a seguir em ordem; pule apenas quando houver justificativa clara.

### Passo 1 – Entender o uso com exemplos concretos

Obter ou gerar exemplos claros de como a skill será invocada ajuda a definir seu escopo. Perguntas
úteis:

- "Quais solicitações dos usuários devem acionar essa skill?"
- "Que resultados eles esperam?"
- "Quais ferramentas ou formatos estão envolvidos?"

Evite muitas perguntas por vez; comece com as mais importantes e amplie conforme necessário. Termine
esta etapa com entendimento firme das funcionalidades que a skill deve suportar.

### Passo 2 – Planejar os conteúdos reutilizáveis

Para cada exemplo, imagine como executar a tarefa manualmente e identifique os recursos que são
escritos repetidamente ou exigem conhecimento específico.

- Se houver código reescrito várias vezes, um script em `scripts/` é indicado.
- Se houver dados de referência (esquemas, políticas, etc.), crie arquivos em `references/`.
- Se for necessário um modelo, template ou outro item estático, coloque em `assets/`.

Liste os recursos planejados para que futuros ajustes não sejam esquecidos.

### Passo 3 – Inicializar o skill

Para skills novos, execute `scripts/init_skill.py`:

```bash
scripts/init_skill.py <nome-do-skill> --path <diretório-do-skill>
```

Isso gera a estrutura de diretórios, um `SKILL.md` template e exemplos em `script/`, `references/` e
`assets/`. Personalize ou remova os arquivos de exemplo conforme necessário.

Se estiver iterando em um skill existente, continue direto no passo seguinte.

### Passo 4 – Editar o skill

Comece pelos recursos reutilizáveis identificados na etapa anterior. Crie ou ajuste scripts,
referências e ativos. Remova qualquer exemplo desnecessário gerado pelo `init_skill.py`.

Ao escrever o `SKILL.md`, use linguagem imperativa/infinitiva:

- "Para gerar um relatório, execute XYZ." em vez de "Você deve fazer XYZ."
- Manter o texto enxuto e focado em passos.

Cubra as seguintes perguntas no corpo do arquivo:

1. Qual o propósito da skill em poucas frases?
2. Quando e por que deve ser usada?
3. Como o agente deve utilizá‑la na prática? Demonstre como acessar e usar scripts, referências e
   ativos incluídos.

### Passo 5 – Empacotar a skill

Quando o skill estiver pronto, rode:

```bash
scripts/package_skill.py <caminho/para/skill>
```

O script valida o skill e, se tudo estiver correto, gera um ZIP (ex.: `skill-name.zip`). Ele checa
metadata, estrutura de diretórios, convenções de nome e referências internas. Corrija qualquer erro
reportado e execute novamente.

### Passo 6 – Iterar

Após usar o skill em tarefas reais, observe dificuldades ou repetições. Faça ajustes no `SKILL.md`
ou nos recursos e empacote novamente. A melhoria contínua é parte natural do desenvolvimento de
skills.

## Dicas Adicionais

- **Nomes**: escolha nomes claros e descritivos; evite abreviações crípticas.
- **Tamanho**: mantenha o `SKILL.md` leve; transfira detalhes excessivos para referências.
- **Testes**: considere adicionar scripts que autoverifiquem comportamentos críticos.
- **Documentação**: sempre atualize a descrição metadata se o escopo mudar.

Esta skill pode ser usada como modelo para novas skills; sinta‑se livre para copiar trechos ou
adaptar conforme necessário.
