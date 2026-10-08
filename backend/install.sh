#!/bin/bash
set -e

uv venv --python 3.13 .venv
source .venv/bin/activate
uv pip install -r requirements.txt
