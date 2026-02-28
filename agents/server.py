#!/usr/bin/env python3
"""Simple HTTP wrapper providing endpoints for the Python agents in this repo.

This module is intended to make it easy to run the existing CLI/agent logic
behind a lightweight HTTP server, which is what the AI Toolkit Agent Inspector
requires for full debugging support.  You can still operate the agents via the
command line; passing ``--server`` (or launching the module directly without
arguments) will start the server on port 8087 by default.

Example:

    # normal CLI behaviour
    python agents/server.py explain path/to/file.py

    # start HTTP server (default port 8087)
    python agents/server.py --server

When the server is running you can hit the following endpoints with POST
requests carrying JSON payloads:

    POST /explain
        {"paths": [...], "out_md": "optional.md"}

    POST /search_recipes
        {"query": "some term"}

    POST /extract_ingredients
        {"text": "some text"}

These are deliberately minimal so that the inspector can attach and exercise
logic without needing the original CLI prompt UI.  ``agentdev`` will usually be
invoked as:

    python -m debugpy --listen 127.0.0.1:5679 \
      -m agentdev run agents/server.py --verbose --port 8087 -- --server

The trailing ``--`` separates arguments for ``agentdev`` from the ones consumed
by this script.
"""

from __future__ import annotations

import argparse
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Dict, List, Optional

from agents.code_explainer.agent import CodeExplainer
from agents.cooking_ai.agent import CookingAgent

# default port used by the debugging tasks below; the inspector URL also uses
# this value so keep them in sync if you change it.
DEFAULT_PORT = 8087

# instantiate once so that subsequent calls reuse the same objects
_code_explainer = CodeExplainer()
_cooking_agent = CookingAgent()


class _Handler(BaseHTTPRequestHandler):
    def _send_json(self, data: Any, status: int = 200) -> None:
        encoded = json.dumps(data).encode("utf8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_POST(self) -> None:  # type: ignore[override]
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf8")
        try:
            payload: Dict[str, Any] = json.loads(body) if body else {}
        except json.JSONDecodeError:  # pragma: no cover - defensive
            self._send_json({"error": "invalid json"}, status=400)
            return

        if self.path == "/explain":
            paths = payload.get("paths", [])
            out_md = payload.get("out_md", "code_explanation.md")
            out_file = _code_explainer.explain_code(paths, out_md=out_md)
            self._send_json({"output_file": out_file})
        elif self.path == "/search_recipes":
            query = payload.get("query", "")
            self._send_json({"results": _cooking_agent.search_recipes(query)})
        elif self.path == "/extract_ingredients":
            text = payload.get("text", "")
            self._send_json({"ingredients": _cooking_agent.extract_ingredients(text)})
        else:  # pragma: no cover - unknown endpoint
            self._send_json({"error": "not found"}, status=404)

    def log_message(self, format: str, *args: Any) -> None:
        # silence default logging (it writes to stderr and is noisy during tests)
        pass


def run_server(port: int = DEFAULT_PORT) -> HTTPServer:
    """Start the HTTP server and block until shutdown.

    Returns the server instance so callers (tests) can shut it down programmatically.
    """
    srv = HTTPServer(("0.0.0.0", port), _Handler)
    actual_port = srv.server_address[1]
    print(f"Starting HTTP server on port {actual_port}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:  # graceful shutdown when Ctrl‑C pressed
        pass
    finally:
        srv.server_close()
    return srv


# helpers used by the unit tests; they are not part of the public API but
# exporting them makes the tests cleaner.

def start_background(port: int = 0):
    """Run the HTTP server in a background daemon thread.

    The chosen port is returned along with the server instance and thread so
    callers can shut it down later.  If ``port`` is zero the OS will pick an
    available port.
    """
    import threading

    container: list[HTTPServer] = []

    def _target():
        srv = HTTPServer(("localhost", port), _Handler)
        container.append(srv)
        try:
            srv.serve_forever()
        finally:
            srv.server_close()

    thread = threading.Thread(target=_target, daemon=True)
    thread.start()
    # wait until container has the server
    while not container:
        pass
    return container[0], thread


def _cli_main(argv: Optional[List[str]] = None) -> None:
    """Simple command‑line front‑end for convenience and backwards compatibility."""
    parser = argparse.ArgumentParser(description="Python agent wrapper/HTTP server")
    parser.add_argument("--server", action="store_true", help="run HTTP server")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="port for HTTP server")
    parser.add_argument("cmd", nargs="*", help="CLI command (explain/search_recipes/extract_ingredients)")
    args = parser.parse_args(argv)

    if args.server or not args.cmd:
        run_server(port=args.port)
        return

    verb = args.cmd[0]
    if verb == "explain":
        paths = args.cmd[1].split(",") if len(args.cmd) > 1 else []
        out = args.cmd[2] if len(args.cmd) > 2 else "code_explanation.md"
        print(f"Explicação escrita em: {_code_explainer.explain_code(paths, out_md=out)}")
    elif verb == "search_recipes":
        if len(args.cmd) < 2:
            print("Usage: search_recipes <query>")
        else:
            print(_cooking_agent.search_recipes(args.cmd[1]))
    elif verb == "extract_ingredients":
        if len(args.cmd) < 2:
            print("Usage: extract_ingredients <text>")
        else:
            print(_cooking_agent.extract_ingredients(args.cmd[1]))
    else:  # pragma: no cover - will be exercised by manual use
        print("Unknown command. Available: explain, search_recipes, extract_ingredients")


if __name__ == "__main__":
    _cli_main()
