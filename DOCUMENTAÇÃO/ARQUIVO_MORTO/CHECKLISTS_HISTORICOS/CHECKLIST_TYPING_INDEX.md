# CHECKLISTS: Tipagem 100% (Ordem Canônica)

Objetivo

- Evoluir o projeto para tipagem 100% e profissional, com gate automático (CI/local) e sem
  regressões de runtime.

Regra do jogo

- Cada fase termina com uma Definição de Pronto objetiva.
- Não iniciar a fase seguinte sem a fase atual estar verde.

Ordem

1. `checklists/typing/CHECKLIST_TYPING_00_BASELINE.md`
2. `checklists/typing/CHECKLIST_TYPING_01_TYPECHECK_GATE.md`
3. `checklists/typing/CHECKLIST_TYPING_02_REMOVER_SHIMS_GLOBAIS.md`
4. `checklists/typing/CHECKLIST_TYPING_03_COBERTURA_TS_CHECK.md`
5. `checklists/typing/CHECKLIST_TYPING_04_STRICTNESS_RAMP.md`
6. `checklists/typing/CHECKLIST_TYPING_05_CONTRATOS_DOMINIO.md`
7. `checklists/typing/CHECKLIST_TYPING_06_MIGRACAO_TS_SELETIVA.md`
8. `checklists/typing/CHECKLIST_TYPING_07_CI_HIGIENE.md`

Notas

- O dashboard (`src/dashboard-ui`) fica fora do escopo inicial. Depois a gente cria um plano
  separado para tipagem do front.

---

Arquivo gerado automaticamente por solicitação. Não farei commit/push sem sua autorização.
