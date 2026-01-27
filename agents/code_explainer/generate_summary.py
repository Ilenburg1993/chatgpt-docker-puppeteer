#!/usr/bin/env python3
"""Scan repository for code files and generate a single Markdown summary using CodeExplainer."""
import os
import sys
from pathlib import Path

# Ensure repository root is on sys.path so `agents` package is importable
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from agents.code_explainer.agent import CodeExplainer



DOCS_DIR = ROOT / "DOCUMENTAÇÃO"
DOCS_DIR.mkdir(parents=True, exist_ok=True)


def discover_files(root: Path, exts=None):
    if exts is None:
        exts = {".py", ".js", ".ts", ".json", ".md"}
    files = []
    for dirpath, dirnames, filenames in os.walk(root):
        # skip node_modules, .git, logs, backups, fila, tmp
        skip_dirs = {"node_modules", ".git", "logs", "backups", "fila", "tmp"}
        dirnames[:] = [d for d in dirnames if d not in skip_dirs]
        for fn in filenames:
            p = Path(dirpath) / fn
            if p.suffix.lower() in exts:
                files.append(str(p))
    return files



def main():
    print("Scanning repository for code files...")
    files = discover_files(ROOT)
    if not files:
        print("No files found to summarize.")
        sys.exit(1)
    print(f"Found {len(files)} files. Generating summary...")
    explainer = CodeExplainer()
    out_md = DOCS_DIR / "full_repo_summary.md"
    explainer.explain_code(files, out_md=str(out_md))
    print(f"Summary written to: {out_md}")


if __name__ == '__main__':
    main()
