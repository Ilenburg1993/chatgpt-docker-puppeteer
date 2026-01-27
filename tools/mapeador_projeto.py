import os
from pathlib import Path

"""
SCRIPT DE MAPEAMENTO DE ESTRUTURA DE PROJETO (VERSÃO TOOLS/OUTPUT)
----------------------------------------------------------------
Localização: root/tools/mapeador_projeto.py
Saída: root/tools/outputs/estrutura_projeto.txt
"""

# ==============================================================
# CONFIGURAÇÃO DE FILTROS
# ==============================================================

# 1. PASTAS QUE DEVEM SER IGNORADAS
# (O script não entrará nelas nem mostrará seu conteúdo)
IGNORE_PASTAS = {
    '.git', 
    '.github',
    '.tmp.drivedownload',
    '.tmp.driveupload',
    'analysis',
    'local-login',
    'node_modules',
    'profile',
    '.devcontainer',
    '__pycache__', 
    'node_modules', 
    'venv', 
    '.vscode', 
    '.idea', 
    'dist', 
    'build',
    'env',
    'bin',
    'obj'
}

# 2. ARQUIVOS QUE DEVEM SER IGNORADOS
# (O script não listará estes arquivos específicos)
IGNORE_ARQUIVOS = {
    '.DS_Store', 
    'thumbs.db', 
    'desktop.ini', 
    '.env', 
    'package-lock.json', 
    'yarn.lock'
}

# NOME DA SUBPASTA DE SAÍDA (dentro de tools)
NOME_SUBPASTA_SAIDA = "outputs"

# ==============================================================
# LÓGICA DO SISTEMA
# ==============================================================

def gerar_arvore(diretorio_atual, prefixo="", lista_pastas=None, lista_arquivos=None):
    caminho = Path(diretorio_atual)
    itens_filtrados = []
    
    # Normalizamos a lista de ignorados para letras minúsculas para comparação segura
    pastas_ignorar_norm = {p.lower() for p in lista_pastas}
    arquivos_ignorar_norm = {a.lower() for a in lista_arquivos}

    try:
        for item in caminho.iterdir():
            nome_item_lower = item.name.lower()
            
            # Pula arquivos ignorados ou o próprio script
            if item.is_file():
                if nome_item_lower in arquivos_ignorar_norm or item.name == Path(__file__).name:
                    continue
            
            itens_filtrados.append(item)
    except PermissionError:
        return [f"{prefixo}└── [ACESSO NEGADO]"]

    # Ordena: Pastas primeiro
    itens_filtrados.sort(key=lambda x: (not x.is_dir(), x.name.lower()))

    linhas = []
    for i, item in enumerate(itens_filtrados):
        ultimo = (i == len(itens_filtrados) - 1)
        conector = "└── " if ultimo else "├── "
        nome_item_lower = item.name.lower()
        
        if item.is_dir():
            # VERIFICAÇÃO RIGOROSA: Se a pasta está na lista, NÃO entra nela.
            if nome_item_lower in pastas_ignorar_norm:
                linhas.append(f"{prefixo}{conector}{item.name}/ [conteúdo oculto]")
            else:
                linhas.append(f"{prefixo}{conector}{item.name}/")
                extensao_prefixo = "    " if ultimo else "│   "
                # RECURSÃO: Só acontece se a pasta NÃO estiver na lista de ignorados
                linhas.extend(gerar_arvore(item, prefixo + extensao_prefixo, lista_pastas, lista_arquivos))
        else:
            linhas.append(f"{prefixo}{conector}{item.name}")
            
    return linhas

def executar_mapeamento():
    pasta_tools = Path(__file__).resolve().parent
    raiz_projeto = pasta_tools.parent
    
    pasta_saida = pasta_tools / NOME_SUBPASTA_SAIDA
    pasta_saida.mkdir(parents=True, exist_ok=True)
    
    print(f"\n[MAPEANDO]: {raiz_projeto.name}")
    print("-" * 50)
    
    corpo_arvore = gerar_arvore(raiz_projeto, lista_pastas=IGNORE_PASTAS, lista_arquivos=IGNORE_ARQUIVOS)
    resultado_final = f"PROJETO: {raiz_projeto.name}\n.\n" + "\n".join(corpo_arvore)
    
    print(resultado_final)
    
    caminho_arquivo = pasta_saida / "estrutura_projeto.txt"
    with open(caminho_arquivo, "w", encoding="utf-8") as f:
        f.write(resultado_final)
        
    print("-" * 50)
    print(f"SUCESSO! Arquivo gerado em: tools/{NOME_SUBPASTA_SAIDA}/estrutura_projeto.txt")

if __name__ == "__main__":
    executar_mapeamento()