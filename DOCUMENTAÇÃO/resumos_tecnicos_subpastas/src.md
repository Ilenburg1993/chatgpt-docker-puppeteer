# src

Resumo técnico:
Contém o código principal da aplicação (kernel, nerv, driver, infra, server, core). Implementa a lógica de orquestração: NERV (bus de eventos), Kernel (motor de execução), Driver (automação via Puppeteer), Infra (pool de browsers, locks), Server (API/dashboard), e módulos core (configurações, logger, identidade).

Arquivos típicos:
- src/nerv/, src/kernel/, src/driver/, src/infra/, src/server/, src/core/

Uso e responsabilidades:
- Núcleo da aplicação, responsável por execução de tarefas, comunicação interna e abstração de infraestrutura.
