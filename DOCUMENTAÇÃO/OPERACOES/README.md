# OPERACOES

**Propósito**: concentrar a documentação de deploy, ambiente, PM2, devcontainer, rede e operação do runtime em execução.  
**Status documental**: Canônico.  
**Público**: engenharia, operação, manutenção e agentes de IA.  
**Última atualização**: 1 de março de 2026.

## O que esta pasta contém

- documentação de deploy e bootstrap operacional;
- guias de PM2, launcher e execução contínua;
- materiais de devcontainer e rebuild de ambiente;
- documentação de proxy, rede, portas e acesso externo;
- notas operacionais de compatibilidade do dashboard e runtime.

## O que não deve ficar aqui

- arquitetura conceitual do sistema;
- planos de refatoração ou propostas de mudança;
- referência de API e contratos de código;
- relatórios puramente históricos sem valor operacional atual.

## Entradas principais

- [DEPLOYMENT.md](./DEPLOYMENT.md)
- [PM2_QUICK_REFERENCE.md](./PM2_QUICK_REFERENCE.md)
- [DEVCONTAINER.md](./DEVCONTAINER.md)
- [LAUNCHER.md](./LAUNCHER.md)
- [NETWORKING.md](./NETWORKING.md)
- [SECURITY.md](./SECURITY.md)
- [DEPENDENCY_AUTOMATION.md](./DEPENDENCY_AUTOMATION.md)
- [GITHUB_AUTOMATION.md](./GITHUB_AUTOMATION.md)

## Trilhas operacionais importantes

- Chrome Proxy:
  - [CHROME_PROXY_SETUP.md](./CHROME_PROXY_SETUP.md)
  - [CHROME_PROXY_INTEGRATION_GUIDE.md](./CHROME_PROXY_INTEGRATION_GUIDE.md)
- Devcontainer e ambiente:
  - [DEVCONTAINER.md](./DEVCONTAINER.md)
- Dependências e supply chain:
  - [DEPENDENCY_AUTOMATION.md](./DEPENDENCY_AUTOMATION.md)
- GitHub e CI/CD:
  - [GITHUB_AUTOMATION.md](./GITHUB_AUTOMATION.md)
- Dashboard e conectividade:
  - [DASHBOARD_PORT_FORWARDING.md](./DASHBOARD_PORT_FORWARDING.md)
- PM2 e rollout:
  - [PM2_QUICK_REFERENCE.md](./PM2_QUICK_REFERENCE.md)

## Relatórios reclassificados

- Relatórios de implementação e análise que antes poluíam esta pasta foram movidos para
  [../RELATORIOS/RECLASSIFICADOS/README.md](../RELATORIOS/RECLASSIFICADOS/README.md).
- Os caminhos antigos permanecem apenas como wrappers curtos de compatibilidade.

## Auditoria qualitativa desta categoria

- A avaliação canônica desta pasta está em
  [../RELATORIOS/AUDITORIA_QUALITATIVA_CATEGORIAS_VIVAS.md](../RELATORIOS/AUDITORIA_QUALITATIVA_CATEGORIAS_VIVAS.md).
- A reclassificação dos relatórios de implementação já foi aplicada.
- `NETWORKING.md`, `SECURITY.md` e `LAUNCHER.md` já foram reescritos com base no código atual.
- `CHROME_PROXY_SETUP.md`, `CHROME_PROXY_INTEGRATION_GUIDE.md` e
  `DASHBOARD_PORT_FORWARDING.md` também já foram reescritos com base nos scripts e configs atuais.
- `DEVCONTAINER.md` e `PM2_QUICK_REFERENCE.md` também já foram reescritos com base no estado atual
  observado e com exposição explícita dos drifts remanescentes.
- Os drifts principais do `Makefile` e dos scripts PM2 já foram corrigidos nesta trilha.
- A próxima fase recomendada aqui é uma passada de link hygiene e, depois, revisar helpers
  legados restantes (`launcher`, `quick-ops`, scripts históricos de deploy).

## Regras de manutenção

- Se o documento orientar execução, ambiente, deploy, rede ou operação em produção/devcontainer, ele
  tende a pertencer aqui.
- Se o material for análise histórica de uma mudança já encerrada, ele pode permanecer aqui apenas
  se ainda ajudar a operar o sistema; caso contrário, deve migrar para `ARQUIVO_MORTO/`.
- Relatórios de implementação concluída não devem voltar a competir com os runbooks vivos desta
  pasta; o destino preferencial agora é `RELATORIOS/RECLASSIFICADOS/`.
- O material desta pasta deve sempre apontar para a arquitetura oficial quando houver dependência de
  entendimento estrutural.

## Links relacionados

- Hub principal: [../README.md](../README.md)
- Arquitetura: [../ARQUITETURA/README.md](../ARQUITETURA/README.md)
- Referência técnica: [../REFERENCIA/README.md](../REFERENCIA/README.md)
