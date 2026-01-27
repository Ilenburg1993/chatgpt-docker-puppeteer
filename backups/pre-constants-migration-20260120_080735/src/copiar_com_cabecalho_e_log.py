from pathlib import Path
from datetime import datetime

# ============================================================
# CONFIGURAÇÕES
# ============================================================

FORMATO_DATA = "%Y-%m-%d %H:%M:%S"
FORMATO_RUN = "%Y-%m-%d_%H-%M-%S"
SEPARADOR = "-" * 80

# ============================================================
# INÍCIO
# ============================================================

inicio = datetime.now()
timestamp_run = inicio.strftime(FORMATO_RUN)
timestamp_humano = inicio.strftime(FORMATO_DATA)

ROOT = Path(__file__).resolve().parent
SCRIPT_PATH = Path(__file__).resolve()

BASE_CONSOLIDACAO = ROOT / "códigos_consolidados"
PASTA_RUN = BASE_CONSOLIDACAO / f"RUN_{timestamp_run}"

LOG_PATH = PASTA_RUN / f"LOG_{timestamp_run}.txt"
INDEX_PATH = PASTA_RUN / "INDEX.txt"

BASE_CONSOLIDACAO.mkdir(exist_ok=True)
PASTA_RUN.mkdir(exist_ok=True)

print(f"Root: {ROOT}")
print(f"Pasta de saída: {PASTA_RUN}")

erros = []
renomeacoes = []
arquivos_index = []
arquivos_copiados = 0

# ============================================================
# VARREDURA APENAS DE .js
# ============================================================

arquivos_encontrados = list(ROOT.rglob("*.js"))
print(f"Arquivos .js encontrados no total: {len(arquivos_encontrados)}")

for caminho in arquivos_encontrados:

    # Excluir o próprio script
    if caminho == SCRIPT_PATH:
        continue

    # Excluir tudo dentro de códigos_consolidados
    if BASE_CONSOLIDACAO in caminho.parents:
        continue

    try:
        relativo = caminho.relative_to(ROOT)
    except Exception:
        continue

    partes = relativo.parts

    # Determinar pasta de primeiro nível
    if len(partes) == 1:
        pasta_chave = "ROOT"
        base_origem = ROOT
    else:
        pasta_chave = partes[0]
        base_origem = ROOT / pasta_chave

    # Pasta de destino achatada
    pasta_destino = PASTA_RUN / pasta_chave
    pasta_destino.mkdir(parents=True, exist_ok=True)

    # 1. Tentar usar SEMPRE o nome original primeiro
    destino = pasta_destino / caminho.name

    nome_final = caminho.name
    renomeado = False

    # 2. Se houver colisão, renomear usando subpasta
    if destino.exists():
        try:
            relativo_base = caminho.relative_to(base_origem)
            partes_rel = relativo_base.parts

            if len(partes_rel) > 1:
                subpasta = partes_rel[-2]
                stem = caminho.stem
                suffix = caminho.suffix
                nome_final = f"{stem}__{subpasta}{suffix}"
            else:
                # Arquivo direto na pasta base, usar contador
                nome_final = f"{caminho.stem}__1{caminho.suffix}"

        except Exception:
            nome_final = f"{caminho.stem}__1{caminho.suffix}"

        destino = pasta_destino / nome_final
        renomeado = True

    # 3. Se ainda colidir, adicionar contador incremental
    contador = 1
    while destino.exists():
        stem = caminho.stem
        suffix = caminho.suffix
        nome_final = f"{stem}__{contador}{suffix}"
        destino = pasta_destino / nome_final
        contador += 1
        renomeado = True

    if renomeado:
        renomeacoes.append((str(caminho), str(destino)))

    print(f"Copiando: {caminho} -> {destino.relative_to(PASTA_RUN)}")

    # Ler conteúdo
    try:
        conteudo = caminho.read_text(encoding="utf-8")
    except Exception as e:
        erros.append((str(caminho), repr(e)))
        continue

    # Cabeçalho
    cabecalho = []
    cabecalho.append(f"FILE_ORIGINAL: {caminho}")
    cabecalho.append(f"PASTA_BASE: {pasta_chave}")
    cabecalho.append(f"DATA_DA_EXTRACAO: {timestamp_humano}")
    cabecalho.append(SEPARADOR)
    cabecalho_texto = "\n".join(cabecalho) + "\n\n"

    try:
        with open(destino, "w", encoding="utf-8") as out:
            out.write(cabecalho_texto)
            out.write(conteudo)

        tamanho = destino.stat().st_size
        arquivos_index.append(
            (str(destino.relative_to(PASTA_RUN)), tamanho, str(caminho))
        )
        arquivos_copiados += 1

    except Exception as e:
        erros.append((str(caminho), repr(e)))
        continue

# ============================================================
# GERAR INDEX.txt
# ============================================================

total_bytes = sum(t for _, t, _ in arquivos_index)

with open(INDEX_PATH, "w", encoding="utf-8") as idx:
    idx.write(f"ROOT: {ROOT}\n")
    idx.write(f"DATA_DA_EXTRACAO: {timestamp_humano}\n\n")

    for destino_rel, tamanho, origem in sorted(arquivos_index):
        idx.write(f"{destino_rel} — {tamanho} bytes\n")
        idx.write(f"    ORIGEM: {origem}\n")

    idx.write("\nTOTAL:\n")
    idx.write(f"- Arquivos: {len(arquivos_index)}\n")
    idx.write(f"- Tamanho total: {total_bytes} bytes\n")

# ============================================================
# GERAR LOG
# ============================================================

fim = datetime.now()
duracao = (fim - inicio).total_seconds()

with open(LOG_PATH, "w", encoding="utf-8") as log:
    log.write(f"DATA_INICIO: {timestamp_humano}\n")
    log.write(f"ROOT: {ROOT}\n\n")

    log.write(f"ARQUIVOS_JS_COPIADOS: {arquivos_copiados}\n\n")

    log.write("RENOMEACOES_AUTOMATICAS:\n")
    if renomeacoes:
        for origem, destino in renomeacoes:
            log.write(f"- {origem} -> {destino}\n")
    else:
        log.write("Nenhuma renomeação foi necessária.\n")

    log.write("\nERROS:\n")
    if erros:
        for caminho, erro in erros:
            log.write(f"- {caminho} → {erro}\n")
    else:
        log.write("Nenhum erro.\n")

    log.write(f"\nDATA_FIM: {fim.strftime(FORMATO_DATA)}\n")
    log.write(f"DURACAO: {duracao:.2f} segundos\n")

# ============================================================
# FINAL
# ============================================================

print("\n=== RESULTADO ===")
print(f"Arquivos .js copiados: {arquivos_copiados}")
print(f"Pasta RUN: {PASTA_RUN}")
print(f"INDEX: {INDEX_PATH}")
print(f"LOG: {LOG_PATH}")

if renomeacoes:
    print("\nHouve renomeações automáticas apenas onde houve colisão de nomes.")

if erros:
    print("\nHouve erros. Verifique o LOG.")

print("\nConcluído.")
input("\nPressione Enter para fechar...")
