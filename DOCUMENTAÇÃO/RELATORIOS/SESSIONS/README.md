# Sessions — Relatórios Diários de Sessão

> **Gerada automaticamente** pelo hook `sessionEnd` do Copilot.
> Cada arquivo nesta pasta representa um dia de sessões e é acumulado por append.

## Estrutura

```
DOCUMENTAÇÃO/RELATORIOS/SESSIONS/
├── README.md                    ← este arquivo
├── sessions-YYYY-MM-DD.md       ← relatório diário (um arquivo por dia)
└── ...
```

## Como funciona

Quando uma sessão do Copilot (coding agent ou CLI) é encerrada, o hook `sessionEnd` em
`.github/hooks/scripts/session-end.sh` gera automaticamente um resumo Markdown e o acumula nesta
pasta.

Cada entrada de sessão inclui:
- Session ID e data/hora
- Motivo de encerramento (`complete`, `error`, `abort`, `timeout`, `user_exit`)
- Duração e número de turnos do agente
- Ferramentas mais usadas
- Quality gates executados e seus resultados
- Erros e falhas registrados
- Próximas tarefas pendentes de Alta Prioridade

## Arquivos relacionados

| Arquivo                                | Propósito                                        |
| -------------------------------------- | ------------------------------------------------ |
| `.github/hooks/copilot-hooks.json`     | Configuração dos 8 hooks do Copilot              |
| `.github/hooks/state/pending-tasks.md` | Backlog do Modo Arquiteto (commitado)            |
| `.github/hooks/logs/audit.jsonl`       | Log JSONL bruto de todos os eventos (gitignored) |
| `.github/hooks/logs/errors.jsonl`      | Log JSONL de erros e falhas (gitignored)         |

## Considerações de privacidade

- Os textos completos dos prompts do usuário **não são logados**
- Apenas hashes SHA-256 truncados e tamanhos são armazenados
- Credentials são redactados antes de qualquer escrita em log (padrões: `ghp_*`, `Bearer`, etc.)
- Logs brutos JSONL ficam em `.github/hooks/logs/` (gitignored — apenas na máquina local)
- Esta pasta contém apenas resumos de alto nível sem dados sensíveis

---

*Última atualização: 8 de março de 2026 — Implementação inicial dos hooks do Copilot*
