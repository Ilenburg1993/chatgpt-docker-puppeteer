from pathlib import Path
import traceback

print("=== INÍCIO DO SCRIPT ===")

try:
    ROOT = Path(__file__).resolve().parent
    ARQUIVO_SAIDA = ROOT / "consolidado.txt"

    print(f"Root detectado automaticamente: {ROOT}")
    print(f"Arquivo de saída: {ARQUIVO_SAIDA}")

    arquivos_js = sorted(ROOT.rglob("*.js"))

    print(f"Arquivos .js encontrados: {len(arquivos_js)}")

    with open(ARQUIVO_SAIDA, "w", encoding="utf-8") as out:
        primeiro = True
        for arquivo in arquivos_js:
            print(f"Lendo: {arquivo.relative_to(ROOT)}")

            try:
                conteudo = arquivo.read_text(encoding="utf-8")
            except Exception:
                print("❌ Erro ao ler arquivo:")
                traceback.print_exc()
                continue

            if not primeiro:
                out.write("\n\n---\n\n")

            out.write(conteudo)
            primeiro = False

    print("✔ Consolidação concluída com sucesso.")

except Exception:
    print("❌ ERRO FATAL:")
    traceback.print_exc()

print("=== FIM DO SCRIPT ===")
input("\nPressione Enter para fechar...")
