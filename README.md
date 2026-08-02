# Draw Game

A real-time collaborative drawing canvas — anyone in a room can draw together and see each other's cursors live. Built as a hands-on project to gain production experience with Azure's container and real-time services.

**Live demo:** `https://draw-game-client.bluewater-cb1e9b0c.polandcentral.azurecontainerapps.io`

## Features

- Real-time collaborative drawing synced across all connected clients via WebSockets
- Live cursor tracking — see where other users are drawing, labeled with their name
- Room-based sessions (join/switch rooms independently of other users)
- Persistent stroke history — users who join late see everything already drawn
- Color picker per user

## Tech Stack

**Backend**
- ASP.NET Core (.NET 10) Web API
- SignalR for real-time bidirectional communication
- StackExchange.Redis for stroke persistence and multi-instance state sharing

**Frontend**
- TypeScript + Vite (vanilla, no framework)
- Native Canvas 2D API for rendering — no game engine or rendering library
- `@microsoft/signalr` client

**Infrastructure**
- Docker (separate images for API and client)
- Azure Container Apps for hosting
- Azure Managed Redis for stroke persistence
- Azure SignalR Service for scalable real-time connections
- Azure Container Registry for image storage
- GitHub Actions (OIDC-authenticated) for CI/CD

## Architecture

```
Browser Client (TypeScript + Canvas)
        │
        │  WebSocket (SignalR)
        ▼
Azure SignalR Service ──── relays to ────► API (ASP.NET Core + SignalR Hub)
                                                    │
                                                    │  stroke read/write
                                                    ▼
                                          Azure Managed Redis
```

The API defines all hub logic (`DrawingHub`) and connects to Azure SignalR Service as a client rather than holding WebSocket connections directly — this lets the API scale horizontally without needing a separate backplane, since Azure SignalR Service handles connection state centrally.

Redis stores each room's stroke history as an ordered list, so a client joining mid-session can replay everything drawn so far.

## Project Structure

```
draw-game/
├── docker-compose.yml
├── server/              # ASP.NET Core Web API + SignalR hub
│   ├── Dockerfile
│   └── Hubs/
│       └── DrawingHub.cs
└── client/               # Vite + TypeScript frontend
    ├── Dockerfile
    └── src/
        └── main.ts
```

## Running Locally

**Prerequisites:** Docker and Docker Compose installed.

```bash
git clone https://github.com/vuiren/Azure-Draw-Game.git
cd Azure-Draw-Game
docker compose up --build
```

This starts three containers: the API, the client, and a local Redis instance, all networked together. Once running:

- Client: [http://localhost:5173](http://localhost:5173)
- API: [http://localhost:5296](http://localhost:5296)

No Azure resources or credentials are required for local development — Azure SignalR Service is only used conditionally in production (see [Configuration](#configuration) below), so local runs fall back to self-hosted SignalR automatically.

## Configuration

The API reads the following configuration, settable via `appsettings.json` locally or environment variables in deployment:

| Key | Purpose | Required |
|---|---|---|
| `ConnectionStrings:Redis` | Redis connection string | Yes |
| `Azure:SignalR:ConnectionString` | Azure SignalR Service connection string | No — falls back to self-hosted SignalR if unset |
| `Cors:AllowedOrigins` | Allowed origins for the client | Yes |

The client reads the following at **build time** (baked into the static bundle, not runtime-configurable):

| Variable | Purpose | Default |
|---|---|---|
| `VITE_API_URL` | Base URL of the API | none — must be set explicitly |
| `VITE_DOT_RADIUS` | Brush dot radius in pixels | `4` |
| `VITE_POINTS_SEND_INTERVAL_MS` | Throttle interval for stroke batching | `10` |
| `VITE_POINTER_SEND_INTERVAL_MS` | Throttle interval for cursor position updates | `2` |

## Deployment

Deployed on Azure Container Apps, with the API and client as two independently scaled container apps sharing one Container Apps Environment. Redis is Azure Managed Redis; real-time connections are handled by Azure SignalR Service.

CI/CD runs via GitHub Actions on every push to `master` that touches `server/` or `client/` respectively (path-filtered, so a client-only change doesn't redeploy the API and vice versa). Authentication to Azure uses OIDC federated credentials — no long-lived secrets are stored in GitHub.

Each deploy builds a uniquely tagged image (`${{ github.sha }}`), pushes it to Azure Container Registry, and updates the corresponding Container App to that image.

## Notes on Design Decisions

A few choices worth explaining, since they weren't the "default" option:

- **No game engine or rendering library on the frontend.** The drawing surface is just stroke coordinates streamed over the wire and drawn with the native Canvas API — a rendering library like Pixi.js or a game engine like Excalibur.js would add abstraction with no corresponding benefit here.
- **Redis over a relational database.** Stroke data is ephemeral, append-only, and has no relational structure — a Redis list per room (`RPUSH`/`LRANGE`) matches the access pattern directly with no schema or indexing needed.
- **Azure SignalR Service instead of self-hosted SignalR.** Keeps the API stateless with respect to WebSocket connections, so it can scale to multiple instances without a separate backplane.

## License

MIT
