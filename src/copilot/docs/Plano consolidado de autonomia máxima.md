# Documento canônico — Máxima autonomia, liberdade e poder do `https://chatgpt.com/` sobre o nosso repo via MCP

**Data:** 2026-05-23
**Status do acesso atual:** o tunnel e o MCP server estão fechados no momento deste documento; portanto, este relatório não é uma auditoria viva do repo. Ele é uma reconstrução canônica, feita do zero, com foco exclusivo na autonomia do `chatgpt.com` sobre o nosso repositório por meio de um conector MCP.
**Foco absoluto:** tudo que aumenta a capacidade do ChatGPT de ler, compreender, modificar, validar, operar e manter o repo.
**Fora de escopo:** qualquer melhoria do workspace que não aumente direta ou indiretamente o poder do ChatGPT sobre o repo.

---

## Índice

1. [Tese central](#1-tese-central)
2. [Definição de “máxima autonomia”](#2-definição-de-máxima-autonomia)
3. [Mapa de poder do ChatGPT sobre o repo](#3-mapa-de-poder-do-chatgpt-sobre-o-repo)
4. [O que a documentação oficial estabelece](#4-o-que-a-documentação-oficial-estabelece)
5. [O limite que o MCP server não controla](#5-o-limite-que-o-mcp-server-não-controla)
6. [O que controlamos para aumentar poder](#6-o-que-controlamos-para-aumentar-poder)
7. [Arquitetura canônica de máxima autonomia](#7-arquitetura-canônica-de-máxima-autonomia)
8. [Configuração do `chatgpt.com`](#8-configuração-do-chatgptcom)
9. [Configuração do endpoint MCP](#9-configuração-do-endpoint-mcp)
10. [Configuração de autenticação](#10-configuração-de-autenticação)
11. [Design de tools para máximo poder](#11-design-de-tools-para-máximo-poder)
12. [Annotations: como fazer o ChatGPT confiar mais](#12-annotations-como-fazer-o-chatgpt-confiar-mais)
13. [Tool surface canônica](#13-tool-surface-canônica)
14. [Leitura total do repo](#14-leitura-total-do-repo)
15. [Escrita transformadora](#15-escrita-transformadora)
16. [Validação e execução](#16-validação-e-execução)
17. [Manutenção em lote](#17-manutenção-em-lote)
18. [Delegação para autonomia quase plena](#18-delegação-para-autonomia-quase-plena)
19. [Como reduzir confirmações e janelas](#19-como-reduzir-confirmações-e-janelas)
20. [Como maximizar continuidade entre sessões](#20-como-maximizar-continuidade-entre-sessões)
21. [Prompting operacional para forçar uso do repo](#21-prompting-operacional-para-forçar-uso-do-repo)
22. [Perfis de autonomia](#22-perfis-de-autonomia)
23. [Variáveis de ambiente recomendadas](#23-variáveis-de-ambiente-recomendadas)
24. [Checklist de implementação](#24-checklist-de-implementação)
25. [Golden prompts para medir poder real](#25-golden-prompts-para-medir-poder-real)
26. [Plano de execução em fases](#26-plano-de-execução-em-fases)
27. [Princípio final](#27-princípio-final)
28. [Referências oficiais](#28-referências-oficiais)

---

## 1. Tese central

A autonomia máxima do `chatgpt.com` sobre o nosso repo depende de duas coisas:

1. **O ChatGPT precisa ver o repo como um sistema operacional remoto, não como um conjunto solto de arquivos.**
2. **O MCP precisa expor tools que sejam poderosas, previsíveis, bem anotadas, reversíveis quando possível e fáceis de aprovar.**

O servidor MCP é o contrato. O ChatGPT é o operador. O repo é o ambiente de execução.

A documentação oficial da Apps SDK afirma que apps usam MCP para se conectar ao ChatGPT e que o MCP server define capabilities/tools e as expõe ao ChatGPT.[^quickstart] A documentação de Developer Mode afirma que esse modo fornece suporte MCP completo para tools de leitura e escrita, mas que write actions exigem confirmação por padrão e que `readOnlyHint` é usado para distinguir leitura de escrita.[^developer-mode]

Assim, a tese operacional é:

> Para dar poder máximo ao ChatGPT, devemos fazer o MCP expor uma superfície de desenvolvimento completa, com leitura total, escrita segura, validação allowlisted, manutenção em lote e delegação para um runner nosso — reduzindo o número de ações que parecem destrutivas ou ambíguas ao host ChatGPT.

---

## 2. Definição de “máxima autonomia”

Neste documento, “máxima autonomia” significa que o `chatgpt.com` consegue:

- descobrir o estado atual do repo;
- entender a arquitetura;
- navegar arquivos, símbolos, imports, testes e diffs;
- identificar bugs;
- editar arquivos;
- criar arquivos;
- mover arquivos;
- limpar artefatos;
- validar mudanças;
- ler resultados de jobs;
- detectar quando o MCP precisa de restart;
- atualizar índice;
- gerar relatório final;
- executar sequências de manutenção com o mínimo de confirmações;
- manter continuidade durante uma conversa longa;
- delegar tarefas multi-step para um executor nosso.

Essa autonomia não significa ausência de qualquer controle do host ChatGPT. A documentação oficial deixa claro que write actions exigem confirmação por padrão e que aprovações lembradas valem só para a conversa.[^developer-mode] Portanto, o objetivo realista é:

```text
máxima liberdade prática dentro do ChatGPT
+
capacidade de delegar execução longa para infraestrutura nossa
```

---

## 3. Mapa de poder do ChatGPT sobre o repo

O poder do ChatGPT pode ser dividido em seis camadas.

### 3.1. Poder de observação

O ChatGPT sabe:

- branch;
- status Git;
- arquivos alterados;
- árvore do repo;
- conteúdo de arquivos;
- símbolos;
- imports;
- testes;
- índice;
- runtime health;
- tunnel health;
- capabilities expostas.

Sem observação total, não há autonomia.

### 3.2. Poder de diagnóstico

O ChatGPT consegue:

- buscar texto;
- localizar símbolos;
- comparar arquivos;
- ler logs;
- interpretar falhas;
- identificar drift;
- detectar dirty workspace;
- sugerir patches.

### 3.3. Poder de transformação

O ChatGPT consegue:

- aplicar patch;
- escrever arquivo;
- criar arquivo;
- mover arquivo;
- quarantine;
- restaurar quarantine;
- atualizar docs;
- corrigir testes.

### 3.4. Poder de validação

O ChatGPT consegue rodar:

- typecheck;
- lint;
- unit tests;
- smoke MCP;
- index health;
- hygiene checks.

### 3.5. Poder de orquestração

O ChatGPT consegue executar sequências:

```text
ler → planejar → patch → validar → corrigir → relatar
```

sem depender de prompts manuais a cada micro-ação.

### 3.6. Poder de delegação

O ChatGPT consegue acionar um runner nosso:

```text
delegate_to_repo_autonomy_runner
```

Esse é o maior nível: uma chamada estruturada a partir do ChatGPT dispara um executor local com política nossa.

---

## 4. O que a documentação oficial estabelece

### 4.1. MCP é o mecanismo oficial de acesso

O Quickstart da Apps SDK diz que apps construídos com Apps SDK usam o Model Context Protocol para se conectar ao ChatGPT, e que o MCP server é obrigatório para definir capacidades/tools e expô-las ao ChatGPT.[^quickstart]

Consequência para nós:

```text
Sem MCP server ativo, o ChatGPT não tem poder real sobre o repo.
```

Como o tunnel/MCP está fechado agora, qualquer poder operacional está suspenso até o endpoint voltar.

### 4.2. Developer Mode é a via de poder máximo dentro do ChatGPT

A documentação de Developer Mode diz que ele fornece suporte MCP completo para todas as tools, tanto read quanto write; é poderoso e perigoso; e está disponível para contas elegíveis na web.[^developer-mode]

Consequência:

```text
Developer Mode deve ser considerado obrigatório para o perfil chatgpt-max-power.
```

### 4.3. O ChatGPT suporta autenticações diferentes para apps MCP

Developer Mode lista protocolos SSE e streaming HTTP, e autenticações OAuth, No Authentication e Mixed Authentication.[^developer-mode]

Consequência:

- dev solo: No Authentication;
- dev com time: Mixed Authentication;
- produção: OAuth.

### 4.4. O ChatGPT permite gerenciar e atualizar tools

A documentação diz que, em app settings, existe uma página de detalhes por app, com toggle de tools e refresh para puxar novas tools e descrições do MCP server.[^developer-mode]

Consequência:

```text
Sempre que mudarmos tool name, schema, description ou annotations, precisamos reiniciar o MCP e fazer Refresh no app.
```

### 4.5. Write actions exigem confirmação por padrão

Developer Mode diz explicitamente que write actions exigem confirmação por padrão, que `readOnlyHint` é respeitado, e que tools sem esse hint são tratadas como write actions.[^developer-mode]

Consequência:

```text
Toda tool read-only sem readOnlyHint reduz autonomia.
Toda tool write mal desenhada aumenta prompts.
```

### 4.6. Aprovação lembrada vale por conversa

Developer Mode diz que o usuário pode lembrar approve/deny para uma tool durante o restante da conversa, mas novas conversas ou refreshes voltam a pedir confirmação.[^developer-mode]

Consequência:

```text
Para ciclos longos, trabalhar em uma conversa dedicada e lembrar aprovações de bounded-write tools confiáveis.
```

### 4.7. As annotations influenciam como o ChatGPT enquadra chamadas

A referência da Apps SDK define `readOnlyHint`, `destructiveHint`, `openWorldHint` e `idempotentHint`, e afirma que esses hints influenciam como o ChatGPT enquadra uma chamada ao usuário, embora o servidor ainda deva impor autorização própria.[^apps-reference]

Consequência:

```text
Annotations são a linguagem oficial para tornar tools mais aprováveis pelo ChatGPT.
```

### 4.8. Tool design importa

A documentação “Define tools” recomenda “one job per tool”, inputs explícitos, enums, outputs previsíveis e separar read/write para que o ChatGPT respeite confirmation flows.[^define-tools]

Consequência:

```text
Tools genéricas reduzem poder porque aumentam ambiguidade e prompts.
Tools estreitas e explícitas aumentam poder.
```

### 4.9. Testar no ChatGPT é obrigatório

A documentação de teste recomenda usar MCP Inspector localmente, depois validar no Developer Mode com golden prompts e registrar quando o modelo escolhe a tool certa, quais argumentos passou e se prompts de confirmação aparecem como esperado.[^testing]

Consequência:

```text
A autonomia precisa ser medida em chatgpt.com, não apenas em unit tests.
```

---

## 5. O limite que o MCP server não controla

O MCP server não controla:

- a UI do ChatGPT;
- a janela de confirmação;
- a política interna de bloqueio;
- a memória de aprovações;
- o escopo de “remember approval”;
- bloqueios por payload;
- bloqueios por sequência de ações;
- exigências do plano/conta/organização.

O MCP server controla:

- o que expõe;
- como descreve;
- como anota;
- como limita;
- como torna reversível;
- como agrupa;
- como valida;
- como audita.

O objetivo é fazer o lado controlável ser tão bem projetado que o ChatGPT consiga executar mais com menos fricção.

---

## 6. O que controlamos para aumentar poder

### 6.1. Estabilidade do acesso

O ChatGPT só tem poder se o MCP estiver online.

Requisitos:

```text
HTTPS estável
/mcp disponível
health check
tunnel state
smoke
restart status
refresh process
```

Tunnel temporário reduz poder. Para máximo poder, usar domínio estável ou tunnel gerenciado.

### 6.2. Tool surface

Controlamos quais tools existem. A autonomia cresce quando a tool surface cobre todo o ciclo de desenvolvimento:

```text
observe → diagnose → modify → validate → report
```

### 6.3. Tool descriptions

A documentação recomenda nomes e descrições orientados por ação, com “Use this when…”, casos proibidos e descrições de parâmetros.[^developer-mode]

Descrição ruim:

```text
Run command
```

Descrição boa:

```text
Use this when ChatGPT needs to validate MCP changes with a fixed allowlisted suite. This tool does not accept arbitrary shell commands.
```

### 6.4. Schemas

Schemas fechados aumentam poder porque tornam a chamada mais previsível.

Preferir:

```text
enum
boolean defaults
max limits
outputSchema
structuredContent
```

Evitar:

```text
string livre para comando
path livre sem policy
payload gigante
```

### 6.5. Reversibilidade

O ChatGPT terá mais poder se as ações forem reversíveis:

```text
quarantine > delete
patch with expectedHash > overwrite cego
rollback metadata > irreversibilidade
```

### 6.6. Agrupamento

O ChatGPT perde poder quando precisa pedir autorização 20 vezes. A solução é agrupar ações comuns:

```text
mcp_maintenance_apply_safe_fixes
```

---

## 7. Arquitetura canônica de máxima autonomia

### 7.1. Camada ChatGPT

Responsável por:

- raciocinar;
- planejar;
- chamar tools;
- interpretar resultados;
- revisar;
- relatar.

### 7.2. Camada MCP

Responsável por:

- expor tools;
- validar inputs;
- aplicar policy;
- proteger paths;
- executar IO;
- rodar jobs;
- auditar;
- devolver structured outputs.

### 7.3. Camada repo/runtime

Responsável por:

- arquivos;
- Git;
- Node;
- typecheck;
- lint;
- tests;
- index;
- logs.

### 7.4. Camada autonomia delegada

Responsável por:

- execução multi-step longa;
- menor dependência da UI do ChatGPT;
- política local;
- rollback;
- CI;
- relatórios.

Arquitetura:

```text
chatgpt.com
  └── WORKSPACE MCP Connector
        ├── read tools
        ├── write tools
        ├── validation tools
        ├── maintenance tools
        └── delegate_to_repo_autonomy_runner
              └── runner local / LLM-B / CI
```

---

## 8. Configuração do `chatgpt.com`

### 8.1. Developer Mode

Ativar:

```text
Settings → Apps / Apps & Connectors → Advanced settings → Developer mode
```

### 8.2. Criar conector

Configuração:

```text
Name: WORKSPACE
URL: https://<endpoint-estável>/mcp
Auth: No Authentication em dev controlado
```

### 8.3. Usar na conversa

Prompt inicial recomendado:

```text
Use exclusivamente o conector WORKSPACE para qualquer fato, leitura, escrita, validação ou relatório sobre o repo. Não use browsing, memória, arquivos enviados nem inferência interna para estado do repo. Sempre chame as tools WORKSPACE.
```

### 8.4. Aprovação lembrada

Quando a UI oferecer, lembrar aprovação para:

- patch;
- write file;
- create file;
- quarantine;
- validation suite;
- maintenance batch;
- delegate runner.

Não lembrar aprovação para:

- delete definitivo;
- push externo;
- deploy;
- shell arbitrário.

---

## 9. Configuração do endpoint MCP

### 9.1. HTTPS estável

Para máximo poder:

```text
https://workspace.<domínio>/mcp
```

Evitar depender de `trycloudflare.com` para ciclos longos.

### 9.2. Health endpoints

Expor:

```text
GET /health
GET /mcp/health
POST /mcp
OPTIONS /mcp
```

### 9.3. Tool refresh

Após mudança:

```text
restart MCP → test MCP Inspector → refresh ChatGPT app → golden prompts
```

A documentação de Developer Mode diz que app settings permite refresh para puxar novas tools e descrições.[^developer-mode]

### 9.4. List changed

Se suportado, declarar capability de tools com mudança de lista. A spec MCP prevê `tools/list` e notificação/listChanged em capabilities.[^mcp-tools]

---

## 10. Configuração de autenticação

### 10.1. No Authentication

Máximo poder em dev solo/controlado:

```text
COPILOT_MCP_CHATGPT_AUTH_MODE=none-dev
```

Prós:

- menos friction;
- conexão rápida;
- ideal para dev local.

Contras:

- só aceitável com tunnel controlado e escopo local.

### 10.2. Mixed Authentication

Melhor para dev com segurança:

- initialize/list tools sem auth;
- tools específicas com OAuth/no-auth conforme security scheme.

A documentação de Developer Mode diz que Mixed Authentication suporta OAuth e No Authentication, com initialize/list tools sem auth e tools usando OAuth ou no-auth com base nos security schemes.[^developer-mode]

### 10.3. OAuth

Para produção. Menos liberdade, mais governança.

---

## 11. Design de tools para máximo poder

### 11.1. Uma tool por trabalho

Seguir “one job per tool”.[^define-tools]

Ruim:

```text
repo_do_anything
```

Bom:

```text
repo_apply_patch
repo_quarantine_file
mcp_run_safe_validation_suite
```

### 11.2. Inputs explícitos

Usar:

```text
path
expectedHash
dryRun
suite enum
fixes enum
maxResults
cursor
```

### 11.3. Outputs previsíveis

Usar:

```text
success
status
path
previousHash
contentHash
diffPreview
jobId
checks
warnings
critical
```

### 11.4. Separar read/write

A documentação recomenda separar read e write para confirmation flows.[^define-tools]

Portanto:

- `repo_hygiene_report` é read-only;
- `mcp_maintenance_apply_safe_fixes` aplica;
- `repo_file_stats` observa;
- `repo_write_file` modifica.

---

## 12. Annotations: como fazer o ChatGPT confiar mais

### 12.1. Read-only idempotent

```js
{
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
  idempotentHint: true
}
```

Usar em:

- status;
- tree;
- read file;
- search;
- outline;
- symbol search;
- git status/diff/log;
- health;
- tools status;
- restart required;
- hygiene report.

### 12.2. Bounded write

```js
{
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
  idempotentHint: false
}
```

Usar em:

- apply patch;
- write file;
- create file;
- move file;
- quarantine;
- restore quarantine.

### 12.3. Safe automation

```js
{
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
  idempotentHint: false
}
```

Usar em:

- safe validation suite;
- maintenance safe fixes;
- index build/invalidate.

### 12.4. Destructive

```js
{
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: false,
  idempotentHint: false
}
```

Usar somente em:

- delete real;
- overwrite irreversível;
- cleanup sem rollback.

### 12.5. Open world

```js
{
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: true,
  idempotentHint: false
}
```

Usar em:

- push;
- PR;
- issue;
- deploy;
- upload externo.

---

## 13. Tool surface canônica

### 13.1. Read

```text
repo_status
repo_tree
repo_root_tree
repo_read_file
repo_read_file_chunks
repo_file_stats
repo_search_text
repo_symbol_search
repo_find_symbol_usages
repo_file_outline
repo_index_status
repo_index_search
repo_index_find_symbol
repo_find_imports
git_status
git_diff
git_log
mcp_runtime_health
mcp_capabilities_summary
mcp_tools_status
mcp_restart_required
repo_hygiene_report
```

### 13.2. Write

```text
repo_apply_patch
repo_write_file
repo_create_file
repo_move_file
repo_quarantine_file
repo_restore_quarantined_file
```

### 13.3. Destructive

```text
repo_remove_file
```

Não usar no fluxo normal.

### 13.4. Validation

```text
mcp_run_safe_validation_suite
job_list
job_get_output
job_cancel
mcp_smoke_workspace
```

### 13.5. Maintenance

```text
mcp_maintenance_plan
mcp_maintenance_apply_safe_fixes
mcp_index_refresh_safe
```

### 13.6. Delegation

```text
delegate_to_repo_autonomy_runner
```

---

## 14. Leitura total do repo

Para poder máximo, o ChatGPT precisa ler tudo que é permitido.

### 14.1. Requisitos

- line ranges;
- chunks;
- cursors;
- contextLines;
- index freshness;
- path redaction;
- SHA para concorrência;
- outline;
- symbol references;
- imports;
- Git diff.

### 14.2. Funções indispensáveis

```text
repo_read_file(path,startLine,endLine)
repo_read_file_chunks(path,chunkLines,cursor)
repo_search_text(pattern,path,contextLines,cursor)
repo_symbol_search(name)
repo_find_symbol_usages(symbol)
repo_file_outline(path)
repo_index_status()
repo_index_search(query)
repo_find_imports(source)
```

### 14.3. Resultado esperado

O ChatGPT deve conseguir localizar sozinho:

- arquivo certo;
- linha certa;
- símbolo certo;
- teste certo;
- impacto do patch;
- risco de import quebrado;
- necessidade de index refresh.

---

## 15. Escrita transformadora

### 15.1. Patch é o padrão

Preferir:

```text
repo_apply_patch
```

com:

```text
expectedHash
old_string
new_string
occurrenceIndex
dryRun
```

### 15.2. Write file é exceção

Usar `repo_write_file` quando:

- arquivo é novo ou pequeno;
- patch textual não é confiável;
- regeneração completa é mais segura.

### 15.3. Create file

Usar `repo_create_file` para relatórios, testes e novos módulos.

### 15.4. Quarantine

Usar `repo_quarantine_file` para limpeza.

Motivo:

```text
quarantine reduz confirmação porque é reversível; remove_file é destrutiva.
```

---

## 16. Validação e execução

### 16.1. O problema

Validators genéricos parecem execução de comando.

### 16.2. A solução

Criar:

```text
mcp_run_safe_validation_suite
```

Schemas:

```json
{
  "suite": "mcp-fast" | "mcp-full" | "copilot-fast",
  "output": "summary" | "tail"
}
```

### 16.3. Suites

```text
mcp-fast:
  typecheck
  unit-mcp

mcp-full:
  typecheck
  unit-mcp
  lint

copilot-fast:
  typecheck
  lint
```

### 16.4. Output

Sempre resumido por padrão:

```json
{
  "success": true,
  "suite": "mcp-full",
  "checks": [
    { "name": "typecheck", "exitCode": 0 },
    { "name": "unit-mcp", "exitCode": 0 },
    { "name": "lint", "exitCode": 0 }
  ]
}
```

---

## 17. Manutenção em lote

### 17.1. Objetivo

Reduzir várias confirmações em uma operação.

### 17.2. Tool

```text
mcp_maintenance_apply_safe_fixes
```

### 17.3. Schema

```json
{
  "fixes": [
    "cleanup-write-smoke-tmp",
    "quarantine-root-audit-reports",
    "emit-dirty-workspace-warning",
    "refresh-capabilities-summary",
    "invalidate-mcp-index",
    "run-mcp-smoke"
  ],
  "dryRun": true
}
```

### 17.4. Regras

- sem path arbitrário;
- sem shell arbitrário;
- sem delete;
- quarantine apenas;
- enum fechado;
- plano antes de aplicar.

### 17.5. Poder ganho

O ChatGPT deixa de chamar:

```text
repo_status → repo_read_file → repo_apply_patch → repo_remove_file → run_validator → job_get_output
```

e chama:

```text
mcp_maintenance_apply_safe_fixes
```

---

## 18. Delegação para autonomia quase plena

### 18.1. A tool mais poderosa

```text
delegate_to_repo_autonomy_runner
```

### 18.2. Função

O ChatGPT envia um plano estruturado. Um runner nosso executa fora da UI do ChatGPT.

### 18.3. Schema

```json
{
  "task": "apply-safe-fixes" | "repair-mcp" | "run-validation-suite" | "generate-report" | "prepare-commit",
  "scope": "mcp" | "src/copilot" | "repo",
  "approvalProfile": "dev-max" | "on-destructive" | "dry-run-only",
  "dryRun": true,
  "plan": {
    "steps": []
  }
}
```

### 18.4. Por que isso é decisivo

Dentro do `chatgpt.com`, sempre há governança do host. A delegação permite que a execução longa aconteça em infraestrutura nossa, com política nossa.

O ChatGPT continua sendo o cérebro. O runner vira as mãos.

---

## 19. Como reduzir confirmações e janelas

### 19.1. Dentro do ChatGPT

- Developer Mode;
- mesma conversa;
- remember approval para tools confiáveis;
- `readOnlyHint` em todas reads;
- `idempotentHint` em reads;
- evitar `repo_remove_file`;
- preferir quarantine;
- preferir maintenance batch;
- preferir validation suite;
- outputs curtos.

### 19.2. No MCP

- nomes não destrutivos;
- descrições “Use this when…”;
- enums;
- no shell livre;
- no path livre em manutenção;
- rollback metadata;
- expectedHash;
- dryRun.

### 19.3. No fluxo

Evitar:

```text
write → delete → command → long log
```

Preferir:

```text
plan → patch → safe suite → summary
```

---

## 20. Como maximizar continuidade entre sessões

### 20.1. Dentro da mesma conversa

- manter conversa dedicada ao repo;
- aprovar tools com remember quando apropriado;
- não fazer refresh desnecessário;
- usar prompts curtos de continuidade.

### 20.2. Entre conversas

Como aprovações não persistem universalmente, criar:

```text
mcp_session_profile
```

que retorna:

- tools confiáveis;
- prompt recomendado;
- estado do repo;
- policy;
- últimos jobs;
- como reaprovar rápido.

### 20.3. Após refresh

Rodar:

```text
mcp_capabilities_summary
mcp_tools_status
mcp_smoke_workspace
```

---

## 21. Prompting operacional para forçar uso do repo

### 21.1. Prompt inicial

```text
Você está operando sobre o repo apenas pelo conector WORKSPACE. Use sempre WORKSPACE para estado real. Não use memória, browsing, anexos ou inferência para afirmar estado do repo.
```

### 21.2. Prompt de edição

```text
Primeiro leia o arquivo com WORKSPACE.repo_read_file e capture o sha256. Depois aplique mudança com WORKSPACE.repo_apply_patch usando expectedHash. Não use repo_write_file salvo se patch for insuficiente.
```

### 21.3. Prompt de validação

```text
Use WORKSPACE.mcp_run_safe_validation_suite com suite mcp-full. Não use run_copilot_validator diretamente.
```

### 21.4. Prompt de manutenção

```text
Use WORKSPACE.mcp_maintenance_apply_safe_fixes com dryRun=true. Se o plano for seguro, aplique com dryRun=false. Não use repo_remove_file.
```

### 21.5. Prompt de delegação

```text
Use WORKSPACE.delegate_to_repo_autonomy_runner para executar o plano no runner local com approvalProfile dev-max.
```

---

## 22. Perfis de autonomia

### 22.1. `chatgpt-max-power`

Objetivo: máximo poder dentro do ChatGPT.

Configuração:

```text
Developer Mode ON
No Authentication
HTTPS /mcp estável
readOnlyHint perfeito
remember approvals por conversa
quarantine no lugar de delete
safe validation suite
maintenance batch
```

### 22.2. `chatgpt-low-friction-team`

Objetivo: poder alto com equipe.

Configuração:

```text
Developer Mode ON
Mixed Authentication
bounded writes lembráveis
destructive sempre confirmada
OAuth para open-world
```

### 22.3. `chatgpt-delegate-max`

Objetivo: máxima execução via runner nosso.

Configuração:

```text
ChatGPT chama delegate_to_repo_autonomy_runner
Runner executa plano com política local
ChatGPT revisa relatório
```

### 22.4. `read-only-observer`

Objetivo: ChatGPT entende o repo mas não modifica.

Configuração:

```text
somente read tools
readOnlyHint/idempotentHint em tudo
sem write tools expostas
```

---

## 23. Variáveis de ambiente recomendadas

### 23.1. ChatGPT máximo poder

```env
COPILOT_OPERATIONAL_PROFILE=development
COPILOT_MCP_CHATGPT_AUTH_MODE=none-dev
COPILOT_MCP_LOCAL_URL=http://127.0.0.1:3333/mcp
COPILOT_MCP_PUBLIC_URL=https://<stable-public-url>/mcp
COPILOT_MCP_HTTP_TIMEOUT_MS=60000
COPILOT_MCP_STDIO_TIMEOUT_MS=60000
MCP_PORT=3333
MCP_PORT_PROBE_TIMEOUT_MS=3000
BRIDGE_EXPOSE_DIAGNOSTICS=true
```

### 23.2. Delegação máxima

```env
LLMB_REPO_AUTONOMY_RUNNER_ENABLED=true
LLMB_REPO_AUTONOMY_APPROVAL_MODE=never
LLMB_REPO_AUTONOMY_ALLOW_WRITE=true
LLMB_REPO_AUTONOMY_ALLOW_QUARANTINE=true
LLMB_REPO_AUTONOMY_ALLOW_DELETE=false
LLMB_REPO_AUTONOMY_ALLOW_VALIDATORS=true
LLMB_REPO_AUTONOMY_REQUIRE_EXPECTED_HASH=true
LLMB_REPO_AUTONOMY_AUDIT_LOG=true
```

### 23.3. Equipe

```env
LLMB_REPO_AUTONOMY_APPROVAL_MODE=on-destructive
LLMB_REPO_AUTONOMY_ALLOW_DELETE=false
COPILOT_MCP_CHATGPT_AUTH_MODE=mixed
```

---

## 24. Checklist de implementação

### 24.1. Conector

- [ ] Tunnel/endpoint estável.
- [ ] `/mcp` HTTPS ativo.
- [ ] Developer Mode ativo.
- [ ] Conector WORKSPACE criado.
- [ ] Refresh funcionando.

### 24.2. Annotations

- [ ] `readOnlyHint` em read tools.
- [ ] `idempotentHint` em read tools.
- [ ] `destructiveHint` só em delete real.
- [ ] `openWorldHint` só em externo.

### 24.3. Tools novas

- [ ] `repo_quarantine_file`
- [ ] `repo_restore_quarantined_file`
- [ ] `repo_hygiene_report`
- [ ] `mcp_run_safe_validation_suite`
- [ ] `mcp_maintenance_apply_safe_fixes`
- [ ] `mcp_tools_status`
- [ ] `mcp_restart_required`
- [ ] `delegate_to_repo_autonomy_runner`

### 24.4. Testes

- [ ] unit tests de cada tool.
- [ ] MCP Inspector.
- [ ] golden prompts no ChatGPT.
- [ ] registrar prompts de confirmação.

A documentação de teste recomenda validar tool correctness, usar MCP Inspector, testar no Developer Mode com golden prompts e registrar confirmação esperada.[^testing]

---

## 25. Golden prompts para medir poder real

### 25.1. Observação total

```text
Use somente WORKSPACE. Faça repo_status, repo_root_tree, repo_index_status e mcp_runtime_health. Não use outras ferramentas.
```

### 25.2. Patch seguro

```text
Use somente WORKSPACE. Leia src/copilot/mcp/tools/meta.js, capture sha256 e aplique patch mínimo com repo_apply_patch usando expectedHash.
```

### 25.3. Validação

```text
Use WORKSPACE.mcp_run_safe_validation_suite com suite mcp-full e retorne apenas o resumo.
```

### 25.4. Manutenção

```text
Use WORKSPACE.mcp_maintenance_apply_safe_fixes com dryRun=true para cleanup-write-smoke-tmp e run-mcp-smoke. Se o plano for seguro, aplique.
```

### 25.5. Quarantine

```text
Use WORKSPACE.repo_quarantine_file para mover src/copilot/.ai/tmp/mcp-write-smoke.txt para quarantine. Não use repo_remove_file.
```

### 25.6. Delegação

```text
Use WORKSPACE.delegate_to_repo_autonomy_runner para executar repair-mcp no escopo mcp com approvalProfile dev-max.
```

---

## 26. Plano de execução em fases

### Fase 0 — Voltar o acesso

1. Subir MCP server.
2. Subir tunnel estável.
3. Confirmar `/mcp`.
4. Criar/refresh conector.

### Fase 1 — Visão total

1. Auditar read tools.
2. Adicionar `idempotentHint`.
3. Corrigir `readOnlyHint`.
4. Garantir index/search/symbols.

### Fase 2 — Transformação segura

1. `repo_quarantine_file`.
2. `repo_restore_quarantined_file`.
3. reforçar `expectedHash`.
4. melhorar diff previews.

### Fase 3 — Validação sem fricção

1. `mcp_run_safe_validation_suite`.
2. resumo de jobs.
3. outputs pequenos.

### Fase 4 — Operação em lote

1. `mcp_maintenance_apply_safe_fixes`.
2. `mcp_tools_status`.
3. `mcp_restart_required`.

### Fase 5 — Poder quase pleno

1. `delegate_to_repo_autonomy_runner`.
2. runner local.
3. policy engine.
4. approvalProfile dev-max.
5. relatório automático.

---

## 27. Princípio final

Para dar máximo poder ao `chatgpt.com`, não basta expor tools poderosas. É preciso expor tools que o ChatGPT consiga **selecionar**, **justificar**, **aprovar**, **repetir**, **encadear** e **validar**.

O design ideal é:

```text
read tools = totalmente livres
bounded write tools = aprováveis e lembráveis
destructive tools = raras
maintenance tools = agregadas
validation tools = allowlisted
delegation tool = ponte para autonomia quase plena
```

O caminho mais forte é:

```text
Developer Mode + WORKSPACE MCP estável + annotations perfeitas + quarantine + safe validation suite + maintenance batch + delegate runner.
```

Isso dá ao `chatgpt.com` o máximo de liberdade prática sobre o repo, sem depender de hacks, e cria uma ponte para poder quase ilimitado via executor nosso.

---

## 28. Referências oficiais

[^quickstart]: OpenAI Apps SDK Quickstart — https://developers.openai.com/apps-sdk/quickstart
[^developer-mode]: OpenAI ChatGPT Developer Mode — https://developers.openai.com/api/docs/guides/developer-mode
[^apps-reference]: OpenAI Apps SDK Reference — https://developers.openai.com/apps-sdk/reference
[^define-tools]: OpenAI Apps SDK — Define tools — https://developers.openai.com/apps-sdk/plan/tools
[^connect-chatgpt]: OpenAI Apps SDK — Connect from ChatGPT — https://developers.openai.com/apps-sdk/deploy/connect-chatgpt
[^testing]: OpenAI Apps SDK — Test your integration — https://developers.openai.com/apps-sdk/deploy/testing
[^security-privacy]: OpenAI Apps SDK — Security & Privacy — https://developers.openai.com/apps-sdk/guides/security-privacy
[^mcp-tools]: Model Context Protocol — Tools specification — https://modelcontextprotocol.io/specification/2025-06-18/server/tools
