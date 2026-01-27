#!/usr/bin/env python3
import sys
from rich import print
from rich.prompt import Prompt
from agents.code_explainer.agent import CodeExplainer


def print_help():
    print("Comandos:")
    print("  explain <path1[,path2,...]> [out.md]  - Explicar código e gerar markdown")
    print("  help                                   - Mostrar ajuda")
    print("  exit                                   - Sair")


def main():
    explainer = CodeExplainer()
    print("[bold green]Code Explainer - CLI[/bold green]")
    print_help()
    while True:
        try:
            cmd = Prompt.ask("comando")
        except (KeyboardInterrupt, EOFError):
            print("\nSaindo...")
            sys.exit(0)

        if not cmd:
            continue
        parts = cmd.split()
        action = parts[0].lower()

        if action == 'explain':
            if len(parts) < 2:
                print("Uso: explain <path1[,path2,...]> [out.md]")
                continue
            paths_raw = parts[1]
            paths = [p.strip() for p in paths_raw.split(',') if p.strip()]
            out_md = parts[2] if len(parts) > 2 else 'code_explanation.md'
            out = explainer.explain_code(paths, out_md=out_md)
            print(f"Explicação escrita em: {out}")

        elif action == 'help':
            print_help()
        elif action in ('exit', 'quit'):
            print('Saindo...')
            sys.exit(0)
        else:
            print("Comando desconhecido. Digite 'help'.")


if __name__ == '__main__':
    main()
