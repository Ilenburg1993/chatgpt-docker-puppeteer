from agents.cooking_ai.agent import CookingAgent


def test_search_recipes_returns_list():
    agent = CookingAgent()
    results = agent.search_recipes("panqueca")
    assert isinstance(results, list)
    assert len(results) >= 1
    assert isinstance(results[0], dict)


def test_extract_ingredients_parses_list():
    agent = CookingAgent()
    text = "Panqueca: 200g farinha, 300ml leite, 2 ovos"
    ings = agent.extract_ingredients(text)
    assert isinstance(ings, list)
    assert any("farinha" in (it.get("name") or "") for it in ings)
