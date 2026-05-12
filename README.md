# Pose-Runner

TV-displayed runner game controlled by phone-camera pose detection.

## Quickstart (Phase 0 → Phase 1)

```bash
pnpm install
pnpm certs        # one-time: generate LAN HTTPS certs for phone testing
pnpm dev          # starts broker, controller, tv concurrently
```

Open the TV at `https://localhost:5174` (laptop → HDMI to TV), and the controller
at `https://YOUR_LAN_IP:5173` from your phone (same Wi-Fi).

## Packages

| Package      | Purpose                                |
|--------------|----------------------------------------|
| `shared`     | Wire protocol, types, map manifest     |
| `controller` | Phone-side PWA: pose detection + WS    |
| `tv`         | Phaser-based runner game               |
| `broker`     | WebSocket server brokering rooms       |
| `backend`    | Supabase migrations + edge functions   |

## Build phases

See `BUILD_PLAN.md` at the repo root.

## Reference files

The `_reference/` folder holds the as-shipped reference implementations of
each module — see `_reference/README.md` for a phase-by-phase index.
