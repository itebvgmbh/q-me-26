# Databutton app

This project consists of a FastAPI backend server and a React + TypeScript frontend application exported from Databutton.

## Stack

- React+Typescript frontend with `npm` as package manager (`package.json` relies on npm `overrides`).
- Python FastAPI server with `uv` as package manager.

## Quickstart

1. Install dependencies:

```bash
make
```

2. Start the backend and frontend servers in separate terminals:

```bash
make run-backend
make run-frontend
```

## Configuration

The backend reads `backend/.env`:

```bash
FIREBASE_PROJECT_ID=qmedata-7c79e
# Either the service account key JSON inline ...
FIREBASE_SERVICE_ACCOUNT_KEY='{"type": "service_account", ...}'
# ... or a path to the JSON file
FIREBASE_SERVICE_ACCOUNT_KEY_FILE=/path/to/service-account.json
```

Without the project id every authenticated endpoint answers `401`; without the key every endpoint that touches Firestore fails.

## Deployment

The test deployment runs next to Spielmacherei on its Hetzner server (systemd service behind the existing Caddy). See [deploy/README.md](deploy/README.md).

## Gotchas

The backend server runs on port 8000 and the frontend development server runs on port 5173. The frontend Vite server proxies API requests to the backend on port 8000.

Visit <http://localhost:5173> to view the application.
