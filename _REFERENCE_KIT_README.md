# Pose-Runner — Reference Implementation Kit

This folder contains a complete reference implementation alongside the build plan. Drop each file into the path indicated in your monorepo and tune from there.

## How to use this

1. Read **`POSE_RUNNER_BUILD_PLAN.md`** end to end — that's the strategy doc, this folder is the executable counterpart.
2. Run **`14_phase0_setup.sh`** to scaffold the monorepo skeleton.
3. Drop the reference files into the paths in the table below.
4. Iterate from Phase 1 onward, treating these files as starting points (every threshold is in a config object — tune in playtests, not in code).

## File index

| # | File | Phase | Drop-in path | What it is |
|---|---|---|---|---|
| — | `POSE_RUNNER_BUILD_PLAN.md` | all | repo root | Strategy doc — phase plan, validation gate, monetization, Unity port |
| 1 | `01_shared_types.ts` | 0 | `packages/shared/src/index.ts` | Wire protocol, room state, map manifest, stance defs, pose data types |
| 2 | `02_detectors.ts` | 1–3 | `packages/controller/src/detect/index.ts` | One-Euro filter, ring buffer, calibration, all 5 action detectors |
| 3 | `03_broker.ts` | 4, 7b | `packages/broker/src/server.ts` | WebSocket broker — rooms with up to 4 controllers, slot assignment, JWT auth, reconnect grace |
| 4 | `04_modes_and_match.ts` | 7b | `packages/tv/src/systems/modes.ts` + `packages/tv/src/scenes/MatchScene.ts` | Mode rule strategies (Solo, Score Battle, Co-op, Race) + the orchestrator that composes 1-4 RunScene viewports |
| 5 | `05_schema.sql` | 10 | `packages/backend/migrations/20260101_001_initial.sql` | Complete Postgres schema: profiles, ownership, purchases, runs, unlock progress, tournaments, friends, challenges, room sessions. Includes RLS policies, `submit_run` RPC, `evaluate_unlocks` trigger, seed data. |
| 6 | `06_maps.json` | 6, 12 | `packages/backend/seeds/maps.json` | Full content for all 8 launch maps |
| 7 | `07_stances.json` | 7 | `packages/shared/src/data/stances.json` | 7 stance reference angles in radians |
| 8 | `08_unity_detectors.cs` | 11 | `unity/Assets/Scripts/Detection/DetectorPipeline.cs` | C# port of `02_detectors.ts` for the Unity phone app — same constants, same algorithm |
| 9 | `09_unity_match_manager.cs` | 12 | `unity/Assets/Scripts/Match/MatchManager.cs` | Unity match manager + viewport layout system + mode rules |
| 10 | `10_pose_worker.ts` | 1 | `packages/controller/src/pose/poseWorker.ts` | MediaPipe Web Worker — receives ImageBitmaps, returns pose snapshots |
| 11 | `11_run_scene.ts` | 6, 7 | `packages/tv/src/scenes/RunScene.ts` | Per-player Phaser scene: lanes, obstacles, parallax, scoring, action consumption |
| 12 | `12_receipt_validation.ts` | 10 | `packages/backend/edge-functions/verify-receipt/index.ts` | Apple App Store + Google Play receipt verification edge function |
| 13 | `13_tournament_scheduler.ts` | 12b | `packages/backend/edge-functions/tournament-scheduler/index.ts` | Cron-triggered tournament lifecycle: activate, end, rank, grant prizes, roll next week |
| 14 | `14_phase0_setup.sh` | 0 | run once at repo root | Bootstraps the entire monorepo skeleton |
| 15 | `15_README.md` | — | this file | What you're reading |

## Cross-references between files

```
01 (shared types) ←──── imported by everyone
   │
   ├── 02 (detectors) ──── imports ActionEvent, Landmark, PoseSnapshot, StanceDefinition
   ├── 03 (broker) ────── imports RoomMessage, RoomState, PlayerSlot
   ├── 04 (modes) ─────── imports GameMode, MatchResult, PlayerSlot
   ├── 10 (pose worker) ─ imports PoseSnapshot, Landmark
   └── 11 (run scene) ─── imports MapManifest, ActionEvent, PatternRef

02 (detectors) ←─── consumed by 10's main-thread companion
04 (match scene) ←─ instantiates 11 (run scene) per player
03 (broker) ←──── 04 listens for RoomMessages from this
05 (schema) ←──── 12 (receipts) and 13 (tournaments) write here
06 (maps) ←────── seeded into 05; consumed by 11
07 (stances) ←─── consumed by 02 and 11
08 (unity detectors) ←── direct C# port of 02
09 (unity match) ←─────── direct C# equivalent of 04
```

## Phase coverage matrix

| Phase | Description | Files |
|---|---|---|
| 0 | Foundation | 14, 01 |
| 1 | Pose pipeline | 10, 02 |
| 2 | Smoothing + ring buffer + calibration | 02 |
| 3 | Action detectors | 02, 07 |
| 4 | Broker + room pairing | 03, 01 |
| 5 | TV game shell + QR pairing | (boilerplate, not in this kit) |
| 6 | Runner gameplay | 11, 06 |
| 7 | Punch + stance gates | 02, 11, 07 |
| 7b | Local split-screen + remote multiplayer | 03, 04, 11, 01 |
| 8 | Polish & deploy | (Vercel/Fly config, not in this kit) |
| 9 | Validation gate | (a decision point, no code) |
| 10 | Backend (accounts + IAP + ownership) | 05, 12 |
| 11 | Unity phone app | 08 |
| 12 | Unity TV app | 09 |
| 12b | Tournaments + async + replays | 13, 05 |
| 13 | Store launch | (assets and listings, not in this kit) |

## What's not in this kit (and why)

- **Asset pipeline** (sprites, audio, models) — this is content work, not architecture
- **Vercel/Fly deployment configs** — environment-specific; trivial to set up once you know your host
- **App Store / Google Play listing copy** — needs your actual screenshots and brand voice
- **Unity scene + prefab assets** — Unity Editor work; the C# scripts are here, but scene composition is hand-built in the Editor
- **Specific patterns for `executePattern` in 11_run_scene.ts** — only a representative sample is hardcoded; the production approach is to load patterns from a JSON registry per map

## Tuning playbook

Every "magic number" lives in one of three places:

1. **Detector thresholds** → `defaultConfig` in `02_detectors.ts` (port to `DetectorConfig` ScriptableObject in `08_unity_detectors.cs`)
2. **Game tuning** → constants block at the top of `11_run_scene.ts` (LANE_WIDTH, JUMP_HEIGHT_PX, COIN_VALUE, etc.)
3. **Difficulty curves** → `difficultyCurve` array in each map manifest in `06_maps.json`

When playtests reveal a pattern is too hard, change the data, not the code.

## Two-version sync rule

Whenever you fix a bug or tune a threshold in `02_detectors.ts`, port the same change to `08_unity_detectors.cs` immediately. The two files are intentionally structured identically to make this trivial. Keep parity tests with shared JSON pose fixtures so a regression in either fails CI.

## Questions you'll hit

**Q: The broker doesn't have rate limiting on actions. Is that fine?**
For an MVP yes — actions are tiny and rate limits add latency. Add token-bucket only if you see abuse. Cooldowns in the detectors already cap action rate from a single phone.

**Q: Why is `verify-receipt` an Edge Function and not part of the broker?**
Receipt verification needs Apple/Google credentials. Keeping it in a separate, narrowly-scoped function reduces blast radius if the broker is ever compromised, and lets you scale it independently.

**Q: How do I test the Unity port without writing C# unit tests?**
Record a JSON pose fixture from the web MVP (capture `PoseSnapshot[]` over a 30 sec session). Replay through both detectors. Diff the resulting `ActionEvent[]` arrays — they should be identical modulo timestamp epsilon.

**Q: Local co-op feels laggy on the host phone but fine on the second phone — why?**
Host phone is also driving the TV browser via tab focus. On low-end hardware the browser steals CPU. Move the TV to a separate device (laptop → HDMI) for any serious local co-op test.
