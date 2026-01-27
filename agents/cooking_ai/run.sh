#!/usr/bin/env bash
PYTHON=${PYTHON:-python3}
ROOT_DIR=$(dirname "${BASH_SOURCE[0]}")/..
export PYTHONPATH="${ROOT_DIR}:$PYTHONPATH"
exec $PYTHON ${ROOT_DIR}/agents/cooking_ai/cli.py
