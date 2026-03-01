import threading
import time

try:
    import requests
except ImportError:  # tests will be skipped if requests is missing
    requests = None

import pytest
from agents import server


def test_server_explain_endpoint(tmp_path):
    # start server on ephemeral port
    if requests is None:
        pytest.skip('requests library not installed; skipping server tests')

    srv, thread = server.start_background(port=0)
    port = srv.server_address[1]
    url = f"http://localhost:{port}/explain"

    # prepare a temporary python file to explain
    file_path = tmp_path / "foo.py"
    file_path.write_text("print('hello')\n")

    resp = requests.post(url, json={"paths": [str(file_path)]})
    assert resp.status_code == 200
    data = resp.json()
    assert "output_file" in data
    assert data["output_file"].endswith(".md")

    # shutdown the server gracefully
    srv.shutdown()
    thread.join(timeout=1)


def test_cooking_endpoints(tmp_path):
    if requests is None:
        pytest.skip('requests library not installed; skipping server tests')

    srv, thread = server.start_background(port=0)
    port = srv.server_address[1]
    search_url = f"http://localhost:{port}/search_recipes"
    extract_url = f"http://localhost:{port}/extract_ingredients"

    r = requests.post(search_url, json={"query": "panqueca"})
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data.get("results"), list)

    r2 = requests.post(extract_url, json={"text": "ovo, leite"})
    assert r2.status_code == 200
    data2 = r2.json()
    assert isinstance(data2.get("ingredients"), list)

    srv.shutdown()
    thread.join(timeout=1)
