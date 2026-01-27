from .agent import CookingAgent


def demo():
    agent = CookingAgent()
    print("Demo: busca de receitas por 'panqueca'.")
    results = agent.search_recipes("panqueca")
    print(results)

    print("\nDemo: extração de ingredientes de exemplo.")
    text = "Panqueca: 200g farinha, 300ml leite, 2 ovos, 1 colher de sopa de açúcar"
    ings = agent.extract_ingredients(text)
    print(ings)


if __name__ == '__main__':
    demo()
