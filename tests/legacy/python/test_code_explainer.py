import os
from agents.code_explainer.agent import CodeExplainer


def test_explain_writes_md(tmp_path):
    # create temporary python file
    p = tmp_path / "sample.py"
    p.write_text('def add(a, b):\n    return a + b\n')
    out_md = str(tmp_path / "out.md")
    explainer = CodeExplainer()
    res = explainer.explain_code([str(p)], out_md=out_md)
    assert os.path.exists(res)
    content = open(res, 'r', encoding='utf8').read()
    assert 'Explicação' in content or len(content) > 0
