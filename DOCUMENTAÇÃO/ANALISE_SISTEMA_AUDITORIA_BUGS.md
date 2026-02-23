# Análise Completa do Sistema de Auditoria e Rastreamento de Bugs

## Índice

1. [Resumo Executivo](#1-resumo-executivo)
2. [Mapeamento de Arquivos e Módulos](#2-mapeamento-de-arquivos-e-módulos)
3. [Análise de Funcionalidades Implementadas](#3-análise-de-funcionalidades-implementadas)
4. [Problemas, Inconsistências e Áreas de Melhoria](#4-problemas-inconsistências-e-áreas-de-melhoria)
5. [Integrações e Dependências Externas](#5-integrações-e-dependências-externas)
6. [Recomendações para Próximos Passos](#6-recomendações-para-próximos-passos)
7. [Skill do Projeto](#7-skill-do-projeto)

---

## 1. Resumo Executivo

### 1.1 Visão Geral do Sistema

O sistema de auditoria e rastreamento de bugs é composto por múltiplos componentes que trabalham em conjunto para fornecer uma plataforma abrangente de análise de código, detecção de problemas e sugestões de correção automatizada. A arquitetura é baseada em múltiplas camadas que incluem execução determinística, ferramentas semânticas, inteligência de engenharia e governança operacional.

O Audit Agent funciona como um agente LLM de engenharia em background, capaz de analisar código, encontrar bugs, sugerir patches, executar validações seguras e operar continuamente com supervisão humana. O sistema utiliza uma abordagem híbrida que combina detecção determinística de problemas com capacidades de inteligência artificial para análise e sugestão de correções.

### 1.2 Principais Componentes

O sistema é composto por seis componentes principais que desempenham funções específicas e complementares. O Audit Agent orquestra jobs de engenharia, chama LLMs, consolida findings, propõe patches, executa dry-runs e aguarda aprovação para aplicação. O Audit Runner funciona como um motor determinístico de checks, contratos e qualidade, sem capacidade de decisão sobre patches. O MCP Server age como um barramento de ferramentas que fornece acesso a LSP, RAG e Ollama. O LSP/TSServer oferece semântica determinística para análise de código. O RAG fornece contexto para as análises. Por fim, o Inference Gateway governa a inferência com tagging, budgets, quotas, métricas e fallback.

### 1.3 Estado Atual de Implementação

O sistema encontra-se em fase avançada de implementação, com as funcionalidades F0/F1 concluídas e F2/F3/F4/F5/F6/F7/F8/F9 parcialmente implementadas. O pipeline LLM V0 está operacional para triage e proposal, com preflights operacionais, read-models detalhados e guardrails de aplicação reforçados. A última atualização significativa ocorreu em 2026-02-22T12:42:10Z, com o sistema mantendo governança ativa sob a política bug-first para bugs P0/P1.

---

## 2. Mapeamento de Arquivos e Módulos

### 2.1 Diretório Principal: src/audit_agent

O diretório do Audit Agent contém nove arquivos principais que implementam a lógica de orquestração, execução e integração do sistema de auditoria. O arquivo contracts.js define os tipos de job suportados, incluindo categorias para patch_suggest, bug_hunt, quick_audit e diagnostic. O arquivo runtime.js implementa o núcleo do sistema de execução de jobs, gerenciando o ciclo de vida completo desde a criação até a conclusão. O arquivo context_builder.js é responsável por coletar contexto semântico usando ferramentas MCP, LSP e RAG para enriquecer as análises.

O arquivo triage_llm.js implementa o cliente de triagem que utiliza o Inference Gateway para classificar problemas identificados. O arquivo patch_author_llm.js estende essa funcionalidade para gerar propostas de correção automatizadas. O arquivo db_store.js gerencia a persistência de dados usando SQLite, armazenando jobs, runs, findings e patches. O arquivo server.js expõe endpoints HTTP locais para health checks, métricas e gerenciamento de jobs. Por fim, o arquivo main.js serve como ponto de entrada do processo, coordenando a inicialização de todos os componentes.

### 2.2 Diretório Principal: src/inference_gateway

O Inference Gateway é responsável por toda a governança de inferência do sistema. O arquivo gateway.js implementa a lógica principal de roteamento, políticas, budgets e circuit breaker. O arquivo server.js expõe a API REST para interação com o gateway. O arquivo persistence.js gerencia o carregamento de políticas e perfis do banco de dados SQLite. O arquivo policy_config.js define as configurações de políticas disponíveis. O arquivo client_tags.js gerencia os tags de cliente obrigatórios como audit_agent_triage, audit_agent_patch e mcp_ollama_generate. O arquivo ollama_host_supervisor.js implementa o supervisor do host Ollama com polling e circuit breaker.

### 2.3 Diretório Principal: src/diagnostic_agent

O Diagnostic Agent é um subsistema standalone para diagnósticos de infraestrutura. O arquivo main.js implementa o servidor HTTP nativo com 11 endpoints. O arquivo diagnostic-agent.js contém a classe principal que orquestra os diagnósticos. O diretório services/ contém implementações específicas para diferentes tipos de diagnóstico, incluindo health-checker.js para checagens de saúde, system-monitor.js para monitoramento de recursos, model-analyzer.js para análise de modelos, code-analyzer.js para análise de código e report-generator.js para geração de relatórios. O diretório utils/ contém utilitários como constants.js para variáveis de ambiente e comandos, logger.js para logging customizado e validators.js para validações.

### 2.4 Control Plane e APIs

O sistema de controle centralizado está implementado em src/server/domain/control_command_service.js, que gerencia todos os comandos AUDIT_*, INFERENCE_* e DIAGNOSTIC_*. As APIs de dashboard estão distribuídas em dashboard_audit.js e dashboard_inference.js, oferecendo endpoints para gerenciamento de jobs, patches, watch rules e configuração de inferência.

### 2.5 Repositórios de Dados

Os repositórios de dados estão localizados em src/infra/db/ e incluem arquivos para gerenciamento de audit_jobs, audit_job_runs, audit_findings, audit_patches, audit_watch_rules, inference_backends, inference_models, inference_profiles e inference_client_policies. O sistema de migrations está implementado em migrations.js para versionamento do schema do banco de dados.

---

## 3. Análise de Funcionalidades Implementadas

### 3.1 Pipeline de Execução de Jobs

O sistema de jobs do Audit Agent implementa um pipeline completo de processamento que inclui múltiplas etapas sequenciais. Inicia-se com a coleta de contexto através do context_builder, que utiliza ferramentas MCP para coletar informações semânticas do código. Em seguida, o sistema executa a triagem LLM utilizando o Inference Gateway para classificar a severidade e tipo de cada problema identificado. Para jobs de tipo patch_suggest ou bug_hunt, o sistema gera propostas de correção automatizadas através do patch_author_llm.

O pipeline inclui validação de políticas e perfis através do Inference Gateway antes de cada chamada LLM, garantindo que apenas requisições autorizadas sejam processadas. Os resultados são persistidos no SQLite com metadados completos incluindo timestamps, durações e resultados intermediários. O sistema suporta múltiplos estados de job incluindo PENDING, RUNNING, WAITING_APPROVAL, COMPLETED, FAILED e CANCELLED.

### 3.2 Sistema de Políticas e Profiles

O Inference Gateway implementa um sistema sofisticado de políticas com precedência definida. A configuração segue a ordem: override por job, política por clientTag, perfil de inferência, registry de modelos, config global, ENV bootstrap e defaults internos. Os clientTags obrigatórios incluem audit_agent_triage, audit_agent_patch, rag_embed, mcp_ollama_generate, mcp_ollama_embed, diagnostics_probe e fallback_generic.

O sistema de políticas suporta budgets por requisição, quotas por período, circuit breaker para falhas e fallback automático para modelos alternativos. As políticas são armazenadas no SQLite e recarregadas dinamicamente através do endpoint POST /v1/policies/reload.

### 3.3 Context Builder e Enriquecimento Semântico

O context_builder.js implementa coleta de contexto semântico utilizando múltiplas fontes de informação. As ferramentas MCP disponíveis incluem lsp_diagnostics para diagnóstico de código, lsp_definition para navegação de definições, lsp_references para encontrar referências, lsp_document_symbols para listar símbolos, rag_search para busca em documentação e rag_expand para enriquecimento de contexto.

O sistema implementa budget de MCP para limitar o consumo de recursos durante a coleta de contexto. Os resultados são normalizados e armazenados como findings com metadados de source, severity e evidence. O context_builder suporta fallback automático para modo probe quando ferramentas MCP não estão disponíveis.

### 3.4 Sistema de Patch e Apply

O sistema de patches implementa um fluxo de governança completo para aplicação de correções. O pipeline segue: geração de proposta, validação de política, dry-run, aprovação manual, validação de readiness e aplicação. O comando AUDIT_PATCH_APPLY implementa múltiplos guardrails incluindo exigência de aprovação, validação de dry-run TTL, verificação de branch permitida, verificação de path permitido e modo propose_only por padrão.

O sistema de dry-run state tracking monitora estados incluindo missing, pending, invalid, fresh, failed e stale. A validação de readiness expõe endpoint para verificar se um patch está pronto para aplicação sem executar mutação.

### 3.5 Sistema de Contratos e Qualidade

O Audit Runner implementa verificação de contratos v3 com fases de warn e p1. Os contratos cobrem quality gates incluindo node_check, typecheck_node, typecheck_browser, jsdoc_delta, jsdoc_full e ts_ignore_scan. O sistema de collect-quality implementa caching, paralelismo controlado e deduplicação de findings para otimização de performance.

### 3.6 APIs de Dashboard

O sistema expõe APIs RESTful completas para gerenciamento através do dashboard. Os endpoints de Audit incluem listagem de jobs, detalhes de jobs individuais, resultados de diagnóstico, patches com dry-run state, watch rules e endpoints de mutação para create, run, cancel, retry, approve, reject e apply. Os endpoints de Inference incluem profiles, client policies, backends, models, summary com contagens e agregados, e preflights de validação.

---

## 4. Problemas, Inconsistências e Áreas de Melhoria

### 4.1 Problemas Arquiteturais Identificados

O sistema apresenta algumas inconsistências arquiteturais que merecem atenção. O Diagnostic Agent standalone não está configurado no PM2, apenas os processos audit-agent, inference-gateway e ollama-host-supervisor estão configurados. Esta decisão foi tomada para evitar impacto no runtime antes da Fase 5, mas cria complexidade operacional.

O padrão de logging não está uniformizado entre componentes. O Audit Agent utiliza o logger compartilhado do projeto enquanto o Diagnostic Agent implementa seu próprio logger customizado. Esta inconsistência dificulta a correlação de logs e análise de problemas em produção.

A persistência do Audit Agent opera em modo sink incremental, onde o runtime de execução continua em memória sem hidratação completa após restart. Jobs criados antes de um restart não são automaticamente recarregados no estado do processo.

### 4.2 Limitações Atuais do Pipeline LLM

O pipeline LLM atual apresenta limitações que precisam ser endereçadas em próximas rodadas. O triage_llm está integrado mas desabilitado por padrão através da flag AUDIT_AGENT_TRIAGE_LLM_ENABLED, aguardando calibração de modelos e budgets no ambiente. O patch_author_llm é classificado como V0 proposal-only, sem garantir diff confiável em todos os casos e podendo retornar apenas plano estruturado em vez de diff concreto.

O truncation e token budget formal ainda não estão implementados antes do envio de prompts para o LLM. O sistema utiliza enrichment de contexto por MCP mas não tem limitação formal de tokens, podendo levar a prompts excessivamente grandes em análises complexas.

### 4.3 Gap de Cobertura de Testes

A cobertura de testes apresenta lacunas que precisam ser endereçadas. Não existem testes específicos para cache-hit e cache-miss do collect-quality através de stubs controlados. Faltam testes de parser desacoplados para eslint JSON, prettier --check e saída tsc. O sistema de integração entre Audit Agent e Diagnostic Agent precisa de mais cobertura de testes end-to-end.

### 4.4 Observações de Performance

A documentação menciona que audit:quick continua pesado em branch sujo com fallback para full, especialmente quando há mudanças em package.json ou configurações que disparam lint/typecheck/prettier completos. O cache miss em quality.lint e quality.prettier_check aumenta significativamente a duração da execução. O static.forbidden continua como custo relevante do quick e está fora do cache do collect-quality.

---

## 5. Integrações e Dependências Externas

### 5.1 Integrações com Ollama

O sistema depende do Ollama como backend de inferência local. A configuração presume Ollama rodando como serviço permanente no host WSL. O supervisor ollama-host-supervisor implementa polling e circuit breaker para monitoramento de saúde e recuperação automática de falhas. O sistema suporta múltiplos modelos configurados através de inference_backends e inference_models no SQLite.

### 5.2 Integração com MCP

O MCP serves como barramento oficial para ferramentas de análise. As integrações disponíveis incluem ferramentas LSP para diagnóstico semântico, ferramentas RAG para busca em documentação e ferramentas Ollama para inferência local. O sistema implementa fallback automático para modo mínimo determinístico quando MCP está indisponível.

### 5.3 Integração com Dashboard

O dashboard React consome as APIs REST expostas pelo servidor principal. A integração utiliza wrappers HTTP que delegam para o control plane sem bypass de mutação. Os endpoints suportam tanto leitura quanto mutação de jobs, patches e configurações de inferência.

### 5.4 Dependências de Banco de Dados

O sistema utiliza SQLite para persistência com migrations versionadas. As tabelas incluem audit_jobs, audit_job_runs, audit_job_findings, audit_patch_proposals, audit_watch_rules, inference_backends, inference_models, inference_profiles e inference_client_policies. O Inference Gateway carrega políticas e perfis do SQLite na inicialização e pode recarregar através de endpoint REST.

---

## 6. Recomendações para Próximos Passos

### 6.1 Melhorias Imediatas

Recomenda-se habilitar gradualmente o triage_llm em produção após calibração de budgets e modelos. A implementação de truncation/token budget formal antes do pipeline LLM é necessária para evitar prompts excessivos. A adição de testes unitários para cache-hit/cache-miss e parsers desacoplados melhoraria a cobertura.

### 6.2 Refatorações Recomendadas

A consolidação do padrão de logging entre Audit Agent e Diagnostic Agent facilitaria a operação. A implementação de hidratação completa de jobs no startup do Audit Agent evitaria perda de visibilidade após restart. A adição do Diagnostic Agent ao PM2 com flag de habilitação permitiria gerenciamento unificado de processos.

### 6.3 Próximas Fases de Desenvolvimento

As próximas fases devem incluir a implementação de apply real em modo controlado com validações adicionais de segurança. O desenvolvimento de UI dedicada para visualização de llm_triage e patch_proposal no dashboard melhoraria a experiência do usuário. A expansão do sistema de benchmarks e prompt templates permitiria otimização contínua de resultados.

### 6.4 Monitoramento e Observabilidade

Recomenda-se implementar dashboards de observabilidade específicos para o Inference Gateway showing métricas de request, latência, error rate e budget consumption. A criação de alertas para circuit breaker aberto e fallback de política garantiria resposta rápida a problemas. O logging estruturado com trace ID para correlação de requisições entre componentes facilitaria debugging.

---

## 7. Skill do Projeto

### 7.1 Visão Geral

A skill a ser criada documentará o conhecimento institucional sobre o sistema de auditoria, incluindo padrões de operação, comandos disponíveis, troubleshooting e procedimentos de manutenção.

### 7.2 Estrutura Proposta

A skill deve incluir seções para quick start com pré-requisitos e inicialização básica, referência de comandos AUDIT_*, INFERENCE_* e DIAGNOSTIC_*, troubleshooting comum com soluções para problemas frequentes, configuração avançada incluindo flags e variáveis de ambiente, e procedimentos de manutenção para backup, restore e migrations.

### 7.3 Conteúdo Técnico

A skill deve cobrir o pipeline de jobs desde criação até completion, o sistema de políticas e precedence, context builder e ferramentas MCP disponíveis, guardrails de apply e estados de dry-run, e integração com Inference Gateway e Ollama.
