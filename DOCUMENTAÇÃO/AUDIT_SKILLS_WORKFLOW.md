# Fluxo de Implementação do Sistema de Skills de Auditoria 📋

Este documento acompanha, em formato de checklists, todas as etapas práticas que
precisam ser realizadas para construir, testar e operacionalizar o novo sistema de
skills de auditoria descrito no **Plano Mestre**. Cada item é marcado conforme a
equipe avança (nós mesmos, neste momento, vamos preenchendo).

> Nota: a existência deste arquivo facilita a visibilidade de progresso e serve como
a "lista de tarefas" que pode ser citada em issues/PRs.

---

## 1. Preparação inicial

- [x] Ler e auditar o sistema de auditoria existente (`scripts/audit/runner.mjs`).
- [x] Escrever `AUDIT_SKILLS_PLAN.md` com visão, objetivos e estrutura geral.
- [x] Identificar inventário de skills existentes (`.codex/skills`).
- [x] Definir template comum de skill e roadmap de fases (identificação/proposta/aplicação).

## 2. Infraestrutura de suporte

- [x] Criar `scripts/audit/make-skill.js` gerador de boilerplate (com testes).
- [x] Configurar aliases npm (automáticos via gerador). 
- [x] Bibliotecas de prompts compartilhados (`scripts/audit/prompts.js`).
- [x] Definir lista de comandos sugeridos e padrão de chaining entre skills.
- [x] Estabelecer tracker de feedback (planilha JSON ou link externo).

## 3. Documentação e artefatos

- [x] Atualizar `AUDIT_SKILLS_PLAN.md` com prompts reuse, detalhes de generator, etc.
- [ ] Criar `AUDIT_SKILLS_WORKFLOW.md` (este arquivo). ✅
- [ ] Adicionar seção "biblioteca de prompts" no Plan e referência nas skills.
- [ ] Escrever README genérico explicando como usar qualquer skill novo.

## 4. Desenvolvimento de skills iniciais

- [x] Implementar `bug-fix-audit` SKILL.md e commitar.
- [ ] Implementar `security-audit` SKILL.md.
- [ ] Implementar `architecture-audit` SKILL.md.
- [ ] Implementar `performance-audit` SKILL.md.
- [ ] Implementar `ops-audit` SKILL.md.
- [ ] Implementar `upgrade-proposal` SKILL.md.
- [ ] (Opcional) criar extras como `dashboard-audit`, `rag-health-audit` etc.

## 5. Testes e validação

- [ ] Escrever testes unitários para o gerador (`tests/unit/audit_skills/make-skill.spec.js`).
- [ ] Criar smoke tests que invocam cada skill em workspace temporário.
- [ ] Testar prompts compartilhados com LLM stub / mocks.
- [ ] Garantir que aliases npm funcionam e que `npm run audit:<skill>` executa fluxo.

## 6. Operacionalização e rollout

- [ ] Publicar snapshots iniciais de auditoria usando `audit:publish-snapshot`.
- [ ] Agendar auditorias periódicas (quick/nightly) que utilizem skills.
- [ ] Promover documento de workflow a toda equipe e coletar feedback.

## 7. Manutenção

- [ ] Revisar prompts e checklists a cada 3–6 meses.
- [ ] Atualizar gerador de skills conforme novas necessidades.
- [ ] Registrar sugestões de melhoria no tracker e atribuir responsáveis.

---

Workflow iniciado em 27 fev 2026 pelo assistente Copilot. Marcar tarefas conforme forem
concluídas e editar este arquivo repetidamente para manter a previsibilidade.
