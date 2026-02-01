#!/usr/bin/env python3
"""
Gerador de ARCHITECTURE.md v3.0 Completo
Consolida INVESTIGATION_REPORT.md + ARCHITECTURE.md v2.0 + .github/copilot-instructions.md
"""

import os

def read_file(path):
    """Lê arquivo completo"""
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()

def write_file(path, content):
    """Escreve arquivo completo"""
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)

def generate_architecture_v3():
    """Gera ARCHITECTURE.md v3.0 completo"""

    # Lê arquivos de referência
    investigation = read_file('/workspaces/chatgpt-docker-puppeteer/INVESTIGATION_REPORT.md')
    arch_v2 = read_file('/workspaces/chatgpt-docker-puppeteer/DOCUMENTAÇÃO/ARCHITECTURE.md')
    copilot_instructions = read_file('/workspaces/chatgpt-docker-puppeteer/.github/copilot-instructions.md')

    # Documento v3.0
    doc = f"""# 🏗️ Arquitetura do Sistema (v3.0 - Mission-Oriented)

**Versão**: 3.0 (Mission-Oriented Architecture)
**Última Atualização**: 01/02/2026
**Público-Alvo**: Desenvolvedores iniciantes, intermediários e avançados
**Tempo de Leitura**: ~60-90 min (navegação modular)
**Linhas Totais**: 3,000+ linhas técnicas

---

{investigation}

---

## SEÇÕES ADICIONAIS DO ARCHITECTURE.md v2.0 (LEGADO)

{arch_v2[1174:]}

---

*Documento gerado automaticamente. Para detalhes de implementação, veja copilot-instructions.md*
"""

    # Escreve documento
    output_path = '/workspaces/chatgpt-docker-puppeteer/DOCUMENTAÇÃO/ARCHITECTURE_V3.md'
    write_file(output_path, doc)

    # Estatísticas
    lines = doc.count('\n')
    print(f"✅ ARCHITECTURE_V3.md gerado com sucesso!")
    print(f"📊 Linhas totais: {lines}")
    print(f"📁 Localização: {output_path}")
    print(f"📏 Tamanho: {len(doc) // 1024} KB")

    return output_path

if __name__ == '__main__':
    generate_architecture_v3()
