# Tests · v3

## Dependency-free tests

```sh
node --test tests/*.test.js
```

- `core.test.js`: 22 base checks for movement, input normalization, collection, delivery, damage, pause/restart, deadlines, reflow and randomized runs.
- `v2.test.js`: 24 regressions preserving combo, magnetic attraction, protection, slow-time and destruction behavior while updating progression assumptions to v3.
- `v3.test.js`: 37 checks for the ten configurations, per-level time, gated destruction objectives, mines, portals, wind, drones, moving station, expanding storm, combined finale, infinite mode, pause/resize/restart and randomized mechanism safety.
- `audio.test.js`: 33 checks for gesture-safe initialization, async resume, Safari-style interruption, mute/recovery, stale request races, independent gains, melody/beat scheduling, single-scheduler guarantees, pause cancellation, suspended unlock cancellation and timer throttling.

The audio tests use mocked browser audio objects and validate scheduling, not physical speaker output.

## Actual-browser harness

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Open <http://127.0.0.1:8765/tests/browser-harness.html> and click **运行浏览器测试**. Keep the tab foregrounded. It exercises the real page, Canvas loop, controls, modes, sound engine and overlays. Controlled simulation fixtures accelerate reaching combos, powers, campaign victory and endless progression; synthetic pointer capture is stubbed only in the test. All original storage preferences and scores are restored in `finally`.

The harness checks actual browser AudioContext state, scheduled effects/music, and scheduler start/stop. This does **not** establish that a cloud desktop transmitted audio or a person heard it.

The optional `browser-qa.py` adds `file://` launch and desktop/mobile screenshots via Playwright. Generated `artifacts/` are ignored.

## Verification (2026-10-25)

- **Passed:** 116/116 v3 Node.js checks.
- **Passed:** JavaScript syntax checks and Python wrapper syntax.
- **Passed:** 47/47 v3 checks in actual visible cloud Chromium, including audio initialization, background-music start/pause/resume/blur/finish, separate volume and toggles, controls, combo/powers, campaign final victory, and endless progression beyond wave 10.
- **Passed:** manual desktop mode selection, movement with cargo pickup, pause, audio-volume controls and visual inspection with no desktop overflow.
- **Evidence boundary:** browser AudioContext and note/scheduler activity were verified; nobody confirmed physical audible output, and cloud audio forwarding was not verified.
- **Not tested here:** native macOS / iOS Safari, physical touch hardware, physical audio output or cloud-desktop audio forwarding.
- **Environment limitation:** headless Chromium is blocked by sandbox socket restrictions; an approved escalation failed before launch with a mount error. Supported visible cloud Chromium is used instead. The optional Playwright wrapper has not completed here.
