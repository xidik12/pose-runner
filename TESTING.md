# Pose-Runner — Testing Playbook

What's in this build: **Solo web MVP, end-to-end playable**. Phone PWA detects pose → broker forwards → TV runner reacts. Phases 0–6 of the build plan are wired. Phases 7 (stance/punch UX polish), 7b (co-op/split-screen), 8 (deploy), and 9+ (Unity port) are deferred.

## Running the stack

```bash
cd ~/Desktop/pose-runner
pnpm dev
```

This launches three services concurrently:

| Service | URL | What it does |
|---|---|---|
| broker | `ws://localhost:8787` | room state, slot assignment, fan-out |
| controller | `https://localhost:5173` | phone PWA |
| tv | `https://localhost:5174` | Phaser runner |

Broker health check: `curl http://localhost:8787/health`

## Phone-on-LAN test (full end-to-end)

LAN IP is bound in the certs (`172.16.18.32` per current network). To play with a real phone:

1. **Laptop**: open `https://localhost:5174` in Chrome. The TV scene shows a 6-char room code and a QR.
2. **Phone**: scan the QR. The controller PWA opens at `https://172.16.18.32:5173/?room=XXXXXX`.
   - First time: accept the self-signed cert warning. On iOS that means installing the mkcert root CA (`mkcert -install` on the laptop, then transfer `~/.local/share/mkcert/rootCA.pem` to the phone), or use Tailscale for a real cert.
   - Allow camera permission.
3. **Phone**: stand 2 m back, full body in frame. Tap **calibrate** (3-2-1 hold, baseline captured).
4. **Phone**: tap **ready**. Broker fires `match-start`.
5. **TV**: transitions to GameScene. Try:
   - Jump (rise ~15 cm) → player jumps
   - Squat (hip drops ~15 cm) → player ducks
   - Lean shoulders left/right by ~10 cm → player lane-changes
   - Punch toward camera (sharp wrist-z velocity, arm extended) → punches breakable obstacles
   - Hold T-pose for ~400 ms → matches the t-pose stance gate

Latency target on a single Wi-Fi network: **80–150 ms** input-to-display. Above 200 ms on LAN usually means thermal throttling or Wi-Fi contention.

## Keyboard fallback (no phone needed)

On the TV's pairing screen, **press SPACE** to skip pairing and drive with the keyboard:
- ← / → lane change
- ↑ jump
- ↓ duck
- A / D punch left / right
- S stance match (t-pose)

Useful for gameplay tuning when you can't be bothered to set up the camera. Score and game-over flow work identically.

## Automated smoke test

```bash
node scripts/e2e-smoke.mjs
```

Verifies: join, slot assignment, calibrate, ready → match-start, action event fan-out (all 6 action types), TV-initiated match-end, ping RTT.

Currently passing: ✓ all assertions, RTT < 5 ms on localhost.

## What I want you to test (and report back on)

This is the build's actual validation gate. The Phase 9 criteria from `POSE_RUNNER_BUILD_PLAN.md` are the bar — these are what to capture in a playtest log:

| Criterion | Target |
|---|---|
| Median session length | ≥ 4 min over 30+ testers |
| "Can I play again?" or 24h return | ≥ 40% |
| False positives during 30 sec standing still | < 1/min total |
| URL → playing flow | ≥ 80% under 90 sec without help |
| Phone OS coverage | iOS 17+ Safari + Android Chrome 120+, ≥ 3 models each |
| "$2 for 5 more maps?" willing-to-pay signal | ≥ 30% yes |

If any of those misses, **iterate on the web build before touching Unity**. Tuning constants live in:
- detector thresholds → `packages/controller/src/detect/index.ts` → `defaultConfig`
- game feel → top constants block in `packages/tv/src/scenes/RunScene.ts`
- difficulty curves → `packages/backend/seeds/maps.json` per map

## Known gaps (intentional for this build)

- **No production art** — sprites are procedural canvas placeholders, music/SFX absent. Replace with real art once detection + game feel are validated.
- **No co-op / split-screen** — single player only. Phase 7b is the next major addition; the protocol already supports up to 4 controllers.
- **No backend/accounts/IAP** — Phase 10. Schema + receipt validation code is in `packages/backend/` ready to deploy when validation passes.
- **MediaPipe model + WASM loaded from CDN** — works in dev; pre-cache via service worker before going off-network for serious testing.
- **PWA manifest is minimal** — no icons. Add when you go to deploy.

## Quick debugging crib sheet

- Camera blocked → check chrome://settings/content/camera or iOS Settings → Safari → Camera
- "rejected: room-full" → broker `MAX_CONTROLLERS=4`; kill stale rooms via `curl http://localhost:8787/health` (resets every restart)
- Detection misses jumps → recalibrate; check `avgVisibility` (overlay shows skeleton; if jittery, lighting is the cause 90% of the time)
- iOS doesn't trust cert → install mkcert root CA on the phone (one-time), or use Tailscale to get a real hostname
- Phone overheats after ~20 min → expected. Drop to 20fps capture or take a break.

## Build & ship checklist (when validation passes)

- [ ] Replace procedural art with real sprites & atlases
- [ ] Add SFX (jump, coin, punch, music)
- [ ] Wire up Supabase per Phase 10 (`packages/backend/migrations/` + `seeds/`)
- [ ] Deploy broker to Fly.io or Railway with `wss://` and a public hostname
- [ ] Deploy controller + tv to Vercel (set `VITE_BROKER_URL` env)
- [ ] Move to real PWA install (icons, theme_color, splash screens)
- [ ] Implement Phase 7b (split-screen co-op) — the killer feature
