from pathlib import Path
from datetime import datetime
import traceback
import time

# ============================================================
# CONFIGURAÇÕES FIXAS (CONFORME ESPECIFICAÇÃO)
# ============================================================

SEPARADOR_FORTE = "=" * 80
SEPARADOR_BLOCO = "-" * 80
DELIMITADOR = "\n\n---\n\n"
FORMATO_DATA = "%Y-%m-%d %H:%M:%S"
FORMATO_RUN = "%Y-%m-%d_%H-%M-%S"

# ============================================================
# INÍCIO
# ============================================================

inicio_execucao = datetime.now()
timestamp_str = inicio_execucao.strftime(FORMATO_RUN)
timestamp_humano = inicio_execucao.strftime(FORMATO_DATA)

ROOT = Path(__file__).resolve().parent
SCRIPT_PATH = Path(__file__).resolve()

BASE_CONSOLIDACAO = ROOT / "códigos_consolidados"
PASTA_LOGS = BASE_CONSOLIDACAO / "LOGS"
PASTA_RUN = BASE_CONSOLIDACAO / f"RUN_{timestamp_str}"

LOG_PATH = PASTA_LOGS / f"consolidacao_{timestamp_str}.log"
ARQUIVO_CONSOLIDACAO_GERAL = PASTA_RUN / f"consolidacao_{timestamp_str}.txt"
INDEX_PATH = PASTA_RUN / "INDEX.txt"

# ============================================================
# ESTRUTURAS DE CONTROLE
# ============================================================

erros_leitura = []
mapa_por_pasta = {}          # { "KERNEL": [Path, Path, ...], "ROOT": [...] }
tamanho_por_txt = {}        # { "KERNEL.txt": bytes }
total_arquivos = 0
total_bytes = 0

# ============================================================
# FUNÇÕES AUXILIARES
# ============================================================

def registrar_erro(path, exc):
    erros_leitura.append((str(path), repr(exc)))

def escrever_cabecalho_txt(out, nome_pasta, total_arquivos_txt):
    out.write(f"ROOT: {ROOT}\n")
    out.write(f"PASTA CONSOLIDADA: {nome_pasta}\n")
    out.write(f"DATA DA CONSOLIDAÇÃO: {timestamp_humano}\n")
    out.write(f"TOTAL DE ARQUIVOS: {total_arquivos_txt}\n\n")
    out.write(SEPARADOR_FORTE + "\n\n")

def escrever_cabecalho_bloco(out, caminho_arquivo):
    stat = caminho_arquivo.stat()
    modificado = datetime.fromtimestamp(stat.st_mtime).strftime(FORMATO_DATA)

    # Determinar pasta origem imediata
    try:
        parte = caminho_arquivo.relative_to(ROOT).parts
        if len(parte) > 1:
            pasta_origem = parte[0]
        else:
            pasta_origem = "ROOT"
    except Exception:
        pasta_origem = "ROOT"

    out.write(f"FILE: {caminho_arquivo}\n")
    out.write(f"PASTA_ORIGEM: {pasta_origem}\n")
    out.write(f"TAMANHO: {stat.st_size} bytes\n")
    out.write(f"MODIFICADO_EM: {modificado}\n\n")
    out.write(SEPARADOR_BLOCO + "\n")

# ============================================================
# PREPARAÇÃO DE DIRETÓRIOS
# ============================================================

BASE_CONSOLIDACAO.mkdir(exist_ok=True)
PASTA_LOGS.mkdir(exist_ok=True)
PASTA_RUN.mkdir(exist_ok=True)

# ============================================================
# VARREDURA GLOBAL DOS .js
# ============================================================

for caminho in ROOT.rglob("*.js"):

    # Exclusões explícitas
    if caminho == SCRIPT_PATH:
        continue

    if BASE_CONSOLIDACAO in caminho.parents:
        continue

    try:
        relativo = caminho.relative_to(ROOT)
    except Exception:
        continue

    partes = relativo.parts

    if len(partes) == 1:
        pasta_chave = "ROOT"
    else:
        pasta_chave = partes[0]

    mapa_por_pasta.setdefault(pasta_chave, []).append(caminho)

# ============================================================
# PROCESSAMENTO POR PASTA
# ============================================================

for pasta in sorted(mapa_por_pasta.keys()):
    arquivos = sorted(mapa_por_pasta[pasta], key=lambda p: str(p.relative_to(ROOT)))
    nome_txt = f"{pasta}.txt"
    path_txt = PASTA_RUN / nome_txt

    bytes_txt = 0
    arquivos_validos = []

    # Primeiro: filtrar arquivos válidos
    for arquivo in arquivos:
        try:
            _ = arquivo.read_text(encoding="utf-8")
            arquivos_validos.append(arquivo)
        except Exception as e:
            registrar_erro(arquivo, e)

    with open(path_txt, "w", encoding="utf-8") as out:
        escrever_cabecalho_txt(out, pasta, len(arquivos_validos))

        primeiro = True
        for arquivo in arquivos_validos:
            if not primeiro:
                out.write(DELIMITADOR)

            escrever_cabecalho_bloco(out, arquivo)

            try:
                conteudo = arquivo.read_text(encoding="utf-8")
            except Exception as e:
                registrar_erro(arquivo, e)
                continue

            out.write(conteudo)
            bytes_txt += len(conteudo.encode("utf-8"))
            primeiro = False

    tamanho_por_txt[nome_txt] = bytes_txt
    total_arquivos += len(arquivos_validos)
    total_bytes += bytes_txt

# ============================================================
# GERAR INDEX.txt
# ============================================================

with open(INDEX_PATH, "w", encoding="utf-8") as idx:
    idx.write(f"ROOT: {ROOT}\n")
    idx.write(f"DATA: {timestamp_humano}\n\n")

    for nome_txt in sorted(tamanho_por_txt.keys()):
        qt = len(mapa_por_pasta.get(nome_txt.replace(".txt", ""), []))
        tamanho = tamanho_por_txt[nome_txt]
        idx.write(f"{nome_txt:<12} — {qt} arquivos — {tamanho} bytes\n")

    idx.write("\nTOTAL GERAL:\n")
    idx.write(f"- Arquivos: {total_arquivos}\n")
    idx.write(f"- Tamanho: {total_bytes} bytes\n")

# ============================================================
# GERAR CONSOLIDAÇÃO GERAL
# ============================================================

with open(ARQUIVO_CONSOLIDACAO_GERAL, "w", encoding="utf-8") as geral:
    geral.write(f"ROOT: {ROOT}\n")
    geral.write(f"DATA DA CONSOLIDAÇÃO: {timestamp_humano}\n\n")
    geral.write(SEPARADOR_FORTE + "\n\n")

    for nome_txt in sorted(tamanho_por_txt.keys()):
        path_txt = PASTA_RUN / nome_txt
        geral.write(f"\n\n### INÍCIO DE {nome_txt} ###\n\n")
        geral.write(path_txt.read_text(encoding="utf-8"))

# ============================================================
# GERAR LOG
# ============================================================

fim_execucao = datetime.now()
duracao = (fim_execucao - inicio_execucao).total_seconds()

with open(LOG_PATH, "w", encoding="utf-8") as log:
    log.write(f"DATA_INICIO: {timestamp_humano}\n")
    log.write(f"ROOT: {ROOT}\n\n")

    log.write(f"PASTAS_ENCONTRADAS: {len(mapa_por_pasta)}\n")
    log.write(f"TOTAL_ARQUIVOS_JS: {total_arquivos}\n\n")

    log.write("POR_PASTA:\n")
    for pasta in sorted(mapa_por_pasta.keys()):
        qtd = len(mapa_por_pasta[pasta])
        log.write(f"- {pasta}: {qtd} arquivos\n")

    log.write("\nERROS_DE_LEITURA:\n")
    if erros_leitura:
        for caminho, erro in erros_leitura:
            log.write(f"- {caminho} → {erro}\n")
    else:
        log.write("Nenhum erro de leitura.\n")

    log.write("\nARQUIVOS_GERADOS:\n")
    for nome_txt in sorted(tamanho_por_txt.keys()):
        log.write(f"- {nome_txt}\n")

    log.write(f"- INDEX.txt\n")
    log.write(f"- {ARQUIVO_CONSOLIDACAO_GERAL.name}\n\n")

    log.write(f"DATA_FIM: {fim_execucao.strftime(FORMATO_DATA)}\n")
    log.write(f"DURACAO: {duracao:.2f} segundos\n")

# ============================================================
# FINAL
# ============================================================

print("✔ Consolidação concluída com sucesso.")
print(f"📁 Pasta gerada: {PASTA_RUN}")
print(f"📄 Log: {LOG_PATH}")

input("\nPressione Enter para fechar...")
