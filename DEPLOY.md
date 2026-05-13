# Pose-Runner — Deployment & Sideload

## Live infrastructure

| Service     | URL                                                | Purpose                                |
|-------------|----------------------------------------------------|----------------------------------------|
| Broker      | `wss://pose-broker.156.67.216.187.sslip.io`        | Room state, slot assignment, fan-out   |
| Controller  | `https://pose-ctl.156.67.216.187.sslip.io`         | Phone PWA                              |
| TV          | `https://pose-tv.156.67.216.187.sslip.io`          | Phaser TV game                         |

All three are deployed to Coolify on the Hostinger VPS (`156.67.216.187`), with Let's Encrypt SSL via Traefik. Auto-deploy on every push to `main` is wired through the GitHub repo.

## Repo

`https://github.com/xidik12/pose-runner` (public — needed for Coolify to clone, and harmless since the game source isn't sensitive).

## Coolify resource UUIDs

- broker: `dypgfqslral7nh6soopqqinj`
- tv: `b637k6ne1fmtioy8gjc7q8au`
- controller: `ki5cpthm94dtor7jlhr18nnu`

Force a redeploy with:
```bash
TOKEN="5|CNGDLIqFIoUA4QXeMT8soD9QaoVE9HGrDIMOrpZ5a6368ee4"  # from ~/.sebastian/keys.md
curl -H "Authorization: Bearer $TOKEN" \
  "http://156.67.216.187:8000/api/v1/deploy?uuid=<APP_UUID>&force=true"
```

## Smoke test (against production)

```bash
BROKER_URL=wss://pose-broker.156.67.216.187.sslip.io node scripts/e2e-smoke.mjs
```
Expect: ✓ all assertions passed, RTT ~30–80 ms.

---

# Android TV APK (Mi Box / Xiaomi TV / any Android TV)

**Built APK:** `~/Desktop/pose-runner-tv.apk` (944 KB)
**Package ID:** `com.poserunner.tv`
**Signing key:** `~/Desktop/pose-runner/android-twa/android.keystore` (password: `androidkey`)
**Cert SHA-256:** `1E:F3:38:F2:02:FA:F3:1D:7F:17:AE:11:A4:62:45:98:2F:33:38:35:09:7E:15:CF:3A:D0:DE:D2:2E:5D:1D:D5`

Asset-links are deployed at `https://pose-tv.156.67.216.187.sslip.io/.well-known/assetlinks.json` — this is what tells Chrome (the underlying TWA runtime) "yes, this APK is authorized for this PWA," which removes the address bar on launch.

## Sideload procedure (Mi Box / Xiaomi)

### One-time setup on the Mi Box

1. **Enable Developer mode**: Settings → Device Preferences → About → click *Android TV OS build* seven times. "You are now a developer" toasts up.
2. **Enable USB debugging + Network debugging**: Settings → Device Preferences → Developer Options → toggle on:
   - *USB debugging*
   - *Network debugging* (Android TV-specific; lets you `adb connect` over Wi-Fi)
3. Note the Mi Box's LAN IP: Settings → Network → status. Should be on the same Wi-Fi as your laptop.

### Install the APK

From your laptop (Mac), run:
```bash
# 1. Connect to the Mi Box (replace IP with yours)
adb connect 192.168.x.x:5555
# First time it'll show a "Allow USB debugging?" dialog on the TV — accept.

# 2. Verify it sees the device
adb devices
# Should list: 192.168.x.x:5555  device

# 3. Install
adb install ~/Desktop/pose-runner-tv.apk

# 4. Launch (optional — also appears in the TV's app drawer)
adb shell am start -n com.poserunner.tv/.LauncherActivity
```

`adb` is at `/opt/homebrew/share/android-commandlinetools/platform-tools/adb` — add it to PATH or use the full path.

### Updating the APK

After any deploy that changes the TV web app, the APK *doesn't need to be rebuilt* — TWA fetches the live URL on every launch. Just push to `main`, Coolify redeploys, next launch shows the new build.

You only need to rebuild the APK if:
- Icons or PWA manifest fields change
- App version bumps
- Package ID changes

Rebuild:
```bash
cd ~/Desktop/pose-runner/android-twa
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export PATH=$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH
node build-twa.mjs
cp app-release-signed.apk ~/Desktop/pose-runner-tv.apk
adb install -r ~/Desktop/pose-runner-tv.apk   # -r = reinstall keeping data
```

## Phone controller

The phone scans the QR on the TV and opens `https://pose-ctl.156.67.216.187.sslip.io/?room=XXXXXX`. iOS Safari + Android Chrome both work natively (real Let's Encrypt cert, no warnings). No native app needed for the phone — just the PWA URL.

The phone can be on a **different Wi-Fi than the TV** — both connect to the public broker over the internet. Cambodia → broker round-trip is ~30–80 ms; total phone-to-display latency lands ~80–180 ms.

## What got built today (Phases 0–8 of the build plan)

- ✅ Phases 0–6: solo runner end-to-end, web MVP, procedurally drawn placeholder art
- ✅ Phase 8: production deploys for broker + TV + controller with HTTPS + WSS
- ✅ Bonus (off-plan): Android TV APK via TWA, ready to install on Mi Box
- ❌ Phase 7: punch + stance polish (the detectors exist; UX feedback on TV side is minimal)
- ❌ Phase 7b: local split-screen co-op
- ❌ Phase 9: validation gate (you do this after playtesting on the Mi Box)
- ❌ Phases 10–13: accounts, IAP, Unity port — explicitly deferred until validation passes

## When validation passes, what's next

Phase 7b co-op is the biggest leverage move — the killer feature thesis from the original plan. The protocol already supports up to 4 controllers; only the TV side needs the split-screen `MatchScene` + mode rules turned on. ~1–2 sessions of work.

Unity port (Phases 11–13) is weeks of work for marginal gain over what the TWA APK already delivers — defer until the F2P model is generating revenue or the validation playtests reveal a hard ceiling on web-based pose detection.
