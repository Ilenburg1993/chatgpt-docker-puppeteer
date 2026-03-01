# Plano Mestre de Skills de Auditoria 🧩

Resumo consolidado para orientar criação e execução dos _**skills de auditoria**_ no repositório.

## Contexto e propósito

O projeto já conta com um auditor CLI (`scripts/audit/runner.mjs`) capaz de coletar achados por
domínios, avaliar contratos e usar LLM para triagem. Os skills destinam‑se a encapsular casos de uso
comuns (bugs, arquitetura, segurança, etc.) em workflows replicáveis, com checklists, prompts e
aliases npm, reduzindo a curva de aprendizado e padronizando a operação.

Os skills não substituem os utilitários existentes; eles os orquestram. Ex.: `rag-mcp-lsp-ops` e
`lsp-ops` servem de base para qualquer análise que necessite contexto ou navegação de código.

## Objetivos gerais

1. Cobertura total de domínios técnicos.
2. Protocolos claros, com checklist, ferramentas e critérios de conclusão.
3. Combinar automação + inspeção LLM (leitura crítica de trechos de código).
4. Interoperabilidade via MCP (encadeamento de skills).
5. Execução simples (`npm run audit:<nome>` ou comando único).
6. Feedback contínuo para evoluir prompts/checklists (revisões semestrais).

## Domínios iniciais

Há três categorias de skills:

- **Reativos** – acompanham bugs/incidentes relatados. Partem de uma pista externa e conduzem
  detecção & correção.
- **Proativos** – auditorias planejadas ou exploratórias, sem nenhum sinal de erro prévio; podem
  incluir varreduras aleatórias/caças de bug que não dependem de relatórios.
- **Outros** – casos especiais que não se encaixam nos dois grupos acima.

### Skills reativos

| Skill              | Propósito                                     | Evento gatilho               |
| ------------------ | --------------------------------------------- | ---------------------------- |
| reactive-bug-audit | Triagem e patch de defeitos operacionais      | Erro de log / ticket         |
| security-audit     | Detectar segredos, injeções, vulnerabilidades | Pen-test / CVE crítico       |
| performance-audit  | Investigar leaks e hotspots                   | Profiling / reclamação lenta |
| ops-audit          | Checar contêineres, serviços, RAG/MCP         | Dashboard/MCP degradado      |

### Skills proativos

| Skill                | Propósito                                                   | Gatilho típico                    |
| -------------------- | ----------------------------------------------------------- | --------------------------------- |
| architecture-audit   | Revisão de dependências e padrões arquiteturais             | Refatoração / perda de perf.      |
| upgrade-proposal     | Planejar migrações de libs, Node, TS, infra                 | Novo LTS / auditoria de versão    |
| exploratory-bug-hunt | Caça proativa de bugs / gaps em módulos sem relatos prévios | Auditoria periódica / curiosidade |

_`exploratory-bug-hunt` é encarado como skill separado que incide em analisar diretórios ou arquivos
aleatórios à procura de problemas antes que algoritmoos ou usuários relatem algo. Ele emprega o
protocolo de busca exploratória detalhado na documentação do `reactive-bug-audit`, mas opera como
workflow independente._

### Outros possíveis

- `dashboard-audit` para monitoramento de UI e queries N+1.
- `rag-health-audit` para diagnosticar problemas de indexação ou disponibilidade do sistema RAG.
- `docs-audit` para garantir documentação atualizada.

Possíveis extensões adicionais podem ser adicionadas conforme surgirem novos casos de uso.

## Estrutura padrão de skill

Esqueleto criado por `node scripts/audit/make-skill.js <nome>`:

```markdown
# nome-do-skill

## Descrição

## Pré-requisitos

## Checklist passo a passo

1. ação automatizada
2. leitura LLM

## Ferramentas

## Protocolo LLM

## Categorias de problemas

## Done criteria

## Fallbacks / chaining
```

Fluxo de trabalho em três fases: **Identificação → Proposta → Aplicação**. Cada skill gerará alias
npm (`audit:<nome>`) e vínculo de teste em `tests/unit/audit_skills/`.

## Protocolo de leitura LLM

1. Escolher trecho (≤200 linhas) e prefixar com `// file: …`.
2. Enviar prompt que pede intenção, validação, loops, padrões de bug e sugestões.
3. Incluir saída no relatório do skill; iterar ou refinar conforme necessário.
4. Gerar/enriquecer README do código analisado.

## Integração e testes

- Skills podem chamar `mcp tool` ou ser invocados por `mcp:run`.
- Referenciar `rag_search`, `lsp_*` nos checklists.
- Escrever testes de checklist/prompt e smoke tests em fixtures.

## Métricas de sucesso

- % de auditorias que seguem um skill.
- Incidentes cobertos por skills.
- Feedback humano sobre relatórios LLM.
- Revisões semestrais dos prompts.

## Roadmap resumido

1. Definir primeiros SKILL.md e testes.
2. Adicionar aliases npm (`audit:bugfix`, …).
3. Aplicar skills a auditorias passadas para calibrar.
4. Documentar comandos rápidos no README geral.
5. Revisar e expandir domínios periodicamente.

---

Este plano condensado sintetiza a versão extensa anterior e serve de guia imediato para
implementação plena.
