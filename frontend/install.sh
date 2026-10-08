#!/bin/bash
set -e

# npm, not yarn: package.json relies on npm "overrides" (pins @firebase/app)
npm ci
