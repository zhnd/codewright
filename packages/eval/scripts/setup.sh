#!/usr/bin/env bash
# Prepare the eval environment: a uv-managed Python venv with sb-cli.
# Idempotent — safe to run before every eval; fast once installed.
set -euo pipefail

cd "$(dirname "$0")/.."
VENV=".venv"
PYTHON_VERSION="3.13"

if ! command -v uv >/dev/null 2>&1; then
  echo "error: 'uv' not found. Install it first:" >&2
  echo "  brew install uv        # or: curl -LsSf https://astral.sh/uv/install.sh | sh" >&2
  exit 1
fi

if [ ! -x "$VENV/bin/sb-cli" ]; then
  echo "Setting up sb-cli venv ($VENV, python $PYTHON_VERSION)…"
  uv venv "$VENV" --python "$PYTHON_VERSION"
  # sb-cli ships without declaring typing_extensions — install it explicitly.
  uv pip install --python "$VENV/bin/python" sb-cli typing_extensions
fi

if "$VENV/bin/sb-cli" --help >/dev/null 2>&1; then
  echo "sb-cli ready → $VENV/bin/sb-cli"
else
  echo "error: sb-cli failed to run after install" >&2
  exit 1
fi
