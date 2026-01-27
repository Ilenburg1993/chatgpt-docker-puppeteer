#!/usr/bin/env python3
import sys
from rich import print
from rich.prompt import Prompt

from .agent import CookingAgent


def print_help():
    print("Comandos:")
    print("  search <consulta>     - Buscar receitas por nome ou ingredientes")
    print("  extract <texto>       - Extrair ingredientes de um texto de receita")
    print("  help                  - Mostrar ajuda")
    print("  exit                  - Sair")


def main():
    agent = CookingAgent()
    print("[bold green]Cooking AI - CLI[/bold green]")
    print_help()
    while True:
        try:
            cmd = Prompt.ask("comando")
        except (KeyboardInterrupt, EOFError):
            print("\nSaindo...")
            sys.exit(0)

        if not cmd:
            continue
        parts = cmd.split(" ", 1)
        action = parts[0].lower()
        arg = parts[1] if len(parts) > 1 else ""

        if action == "search":
            if not arg:
                print("Use: search <consulta>")
                continue
            results = agent.search_recipes(arg)
            print(f"Resultados para: [bold]{arg}[/bold]")
            for i, r in enumerate(results, 1):
                title = r.get("title")
                desc = r.get("desc", "")
                print(f"{i}. [cyan]{title}[/cyan] — {desc}")

        elif action == "extract":
            if not arg:
                print("Use: extract <texto>")
                continue
            ingredients = agent.extract_ingredients(arg)
            print(f"Ingredientes extraídos ({len(ingredients)}):")
            for it in ingredients:
                print(f"- {it.get('name')} — {it.get('amount')}")

        elif action == "help":
            print_help()
        elif action in ("exit", "quit"):
            print("Saindo...")
            sys.exit(0)
        else:
            print("Comando desconhecido. Digite 'help' para ver comandos.")


if __name__ == "__main__":
    main()
