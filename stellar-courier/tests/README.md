# Tests · v4 keyboard update

## Dependency-free tests

Run the commands below from the `stellar-courier/` game directory. From the multi-game repository root, use `node --test stellar-courier/tests/*.test.js`; for browser QA, either serve that directory explicitly or visit `/stellar-courier/tests/browser-harness.html` when serving the repository root. The game and its internal relative paths remain self-contained.

```sh
node --test tests/*.test.js
```

- `core.test.js`: 22 base checks for movement, collection, scoring, damage, pause/restart, deadlines and reflow.
- `v2.test.js`: 24 combo, powerup and destruction regressions adapted to the explicit upgrade transition.
- `v3.test.js`: 37 ten-sector/endless/mechanism regressions, including gated objectives and preserved training targets during resize.
- `v4.test.js`: 40 checks for capped objective status, all three refits and payout/capacity agreement, frozen upgrade choices, duplicate actions, isolated tutorial physics and skip/pause, unlocked practice validation, fair stage retries, record eligibility and menu/mode reset.
- `audio.test.js`: 39 checks for Web Audio initialization, delayed/rejected/interrupted recovery, separate gains, original music scheduling, single-scheduler lifecycle, paused menu behavior, retry cancellation and stale unlock prevention.

- `input.test.js`: 26 checks for deliberate key presses, repeats (including orphan repeat events), release requirements across transitions, focus-loss reset, directional wrapping and main/numeric keypad selection.

Audio tests validate engine scheduling with mocked browser objects, not physical speaker output.

## Actual-browser harness

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Open <http://127.0.0.1:8765/tests/browser-harness.html> (hard-refresh the harness after editing tests) and click **运行浏览器测试**. Keep the tab foregrounded. The harness uses the real page, inputs, Canvas loop, audio state and overlays. Controlled simulation fixtures reach later states quickly; synthetic pointer capture is stubbed only inside tests. Original storage preferences, unlocks, tutorial flag and record keys are restored afterward.

The harness covers normal play and interrupted flows: audio start/pause/resume, separate music/effects controls, touch input, mobile reflow, upgrade freezing and duplicate choices, 7-/3-slot UI agreement, safe tutorial success and skip, precise missing-objective failure text, same-stage retry, full-run record isolation, fresh reset, endless wave 11 and saved practice entries. The keyboard update additionally checks held flight keys on entry, four-direction selection, digit/numpad selection without confirmation, Space non-confirmation, Enter confirmation, no movement/Enter leakage to the next sector or tutorial, keyboard retry, details expansion, native select keys, and Escape closing the audio popup with focus returned to its opener. Synthetic keyboard events test routing; a manual Tab/Shift+Tab pass verifies browser-native focus traversal.

### Visual QA scenes

The same **test-only** page provides six buttons: desktop/mobile variants of upgrade choices, safe tutorial and missing-objective failure. Mobile uses a 375×667 iframe. Fixtures do not add a production cheat interface; storage is restored, and **恢复初始页** clears the temporary preview context. These controls are intended for screenshot/interaction review, not gameplay.

The optional `browser-qa.py` adds direct `file://` launch and screenshots through Playwright. Output goes to ignored `artifacts/`.

## Verification (2026-10-25)

### Current keyboard update

- **Passed:** 188/188 Node.js checks, including the new 26 keyboard-state/navigation tests.
- **Passed:** JavaScript and inline browser-harness syntax checks.
- **Passed:** final parent-run visible Chromium **76/76** browser regressions, including both Escape/audio-popup focus checks. Native ArrowDown → hauler, 3 → sprinter selection without leaving, and Enter → next sector were manually verified; focus returned to the game canvas.
- **Passed:** desktop and 375×667 upgrade-menu visual review; no horizontal overflow, vertical scrolling remains usable.
- **Passed:** parent independently reran **188/188** Node.js checks against the final source. The implementation agent did not launch or control a browser. Native Tab/Shift+Tab traversal and actual dropdown selection remain manual QA steps rather than synthetic-event guarantees.

### Prior v4 baseline

- **Passed:** 162/162 Node.js checks against v4 source.
- **Passed:** JavaScript syntax checks and Python wrapper syntax.
- **Passed:** 60/60 checks in actual visible cloud Chromium, including tutorial, upgrade, failure/retry and record isolation.
- **Passed:** desktop start-screen visual review and 375×667 mobile visual review of upgrade choices, safe tutorial and missing-objective failure. Controls remain visible with no horizontal overflow; the compact failure card scrolls vertically and keeps its primary retry action visible.
- **Evidence boundary:** actual browser AudioContext and note/scheduler activity were verified, but no person confirmed speaker output or cloud audio forwarding.
- **Not tested here:** native macOS/iOS Safari and physical touch hardware. Canvas responsive behavior was tested in the cloud browser.
- **Environment limitation:** sandbox socket restrictions blocked headless Chromium, and escalation failed before launch with a mount error. Supported visible cloud Chromium is used instead; the optional Playwright wrapper has not completed here.
