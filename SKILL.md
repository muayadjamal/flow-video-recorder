---
name: flow-video-recorder
license: MIT
metadata:
  version: "1.5.0"
description: >
  Use when the user wants to record a screen-capture video of a flow through an
  app: a walkthrough, product demo, feature tour, or reproduction, driven either
  in a browser with Playwright or in a native iOS app on the simulator with
  Maestro, with a visible cursor and tap ripple, on-screen step captions, an optional
  voice-over (ElevenLabs, OpenAI, macOS say, or any local TTS) in sync with the picture, optional motion-graphics explainer
  scenes spliced between recorded steps with animated transitions, and
  high-resolution MP4 output. Triggers:
  "record a demo video", "make a walkthrough / tour video", "screen record this
  flow", "record the app / the mobile app / the iOS app", "video of the app with
  a click indicator / cursor / captions", "add narration / voice-over to the
  demo", "capture this flow as a video", "add motion graphics / animated
  explainer clips to the video".
  Not for editing existing video, generative video, or static screenshots.
---

# Flow Video Recorder

Records a flow through your app to a polished MP4: a cursor that glides and
ripples on every click, a caption pill per step, crisp output, and, when a
text-to-speech engine is configured, a human voice explaining what is happening
as it happens. It records two surfaces:

| | Browser | Native iOS |
|---|---|---|
| Driver | Playwright | Maestro (XCUITest) |
| Capture | `recordVideo` → webm | `simctl io recordVideo` → mov |
| Cursor, ripple, captions | injected into the page | composited afterwards |
| Entry point | `record.sh` | `record-ios.sh` |
| Example flow | `flow.example.mjs` | `flow.ios.example.mjs` |

`<skill>` below means wherever this skill is installed, for example
`~/.claude/skills/flow-video-recorder` or `.claude/skills/flow-video-recorder`.

## Quality: always the best, unless told otherwise

Every recording uses the best quality available unless the user asks otherwise. That means the ElevenLabs `eleven_v4` model for narration when ElevenLabs is the engine (also when clips come through the ElevenLabs connector: pass `model_id: eleven_v4`), a 2560×1440 master at `CRF=16` for browser flows, and `CRF=16` for iOS. These are the defaults in the assets; the resolution question below is where the user lowers or raises them.

## The one decision worth understanding first

**The picture is paced to the audio, not the other way round.** Every narration
clip is synthesized and measured before the app opens. A step then says its
line, does its clicking, and waits out whatever is left of the sentence. So a
step lasts exactly as long as its narration, a sentence is never cut off
mid-word by the next screen, and nothing drifts, because the recorder and the
device are on one clock.

Fitting narration to an already-recorded video is the obvious approach and it is
the wrong one. Step durations vary run to run (a queue job, a page load, an LLM
call), so the audio either overlaps the next step or leaves holes.

## Ask what goes in the video, before anything else

The first thing to do, before reading the app or writing a line of the flow, is
ask. Use `AskUserQuestion` with `multiSelect: true`, one question, these five
options, and say in the question that the first three ticked is the usual
answer, the fourth is worth ticking when the flow has something the screen
alone cannot show, and the fifth gives a polished, product-page look at the
cost of a heavier install:

| Option | Describe it as | Sets |
|---|---|---|
| Voice-over | A spoken narration track, synthesized by the TTS engine the user picks | `NARRATION` |
| Subtitles | The caption pill naming each step on screen | `CAPTIONS` |
| Pointer | A cursor that glides between targets, and a ripple on each tap | `POINTER` |
| Motion graphics | Short animated explainer scenes spliced between the recorded steps, with an animated transition at each join, synced word by word to the voice, for a pipeline, a data flow or a concept the screen cannot show | a `motion.plan.json`, see [Motion graphics](#motion-graphics) |
| Frame | Browser only. The recording sits inside a browser chrome (traffic lights, the live URL) on a framed canvas; the captions become a numbered step header above it; the narration appears as spoken-word subtitles at the bottom; and the camera can drift in on a detail the voice points at. Rendered by Remotion as an extra step, so it installs about 500 MB on first use | `FRAME=1 CAPTIONS=0` on `record.sh`, then `frame.sh`, see [Frame](#frame) |

Pass `=0` for whatever they leave out, to either entry point:

```bash
CAPTIONS=0 POINTER=0 bash …/record-ios.sh flow.mjs demo.mp4     # voice only
NARRATION=0 bash …/record.sh flow.mjs demo.mp4                  # silent, captioned
```

The answer changes what you write, not just what gets rendered:

- **No voice-over** means no `narration` export to write. Steps still use
  `say()`/`hold()` if the array is there, holding for `hold()`'s fallback
  instead of a clip; with no array at all, use `cap()` then `beat()`.
- **No subtitles** means the voice is carrying every explanation on its own, so
  nothing may depend on a viewer reading a step name.
- **No pointer** means taps are invisible. Let each one land on a control whose
  own pressed or focused state shows the tap happened, or the video becomes a
  screen changing for no visible reason.
- **Frame** means the captions and subtitles are drawn by the frame step, not
  the page, so record with `FRAME=1 CAPTIONS=0`, and `frame.sh` runs after
  `record.sh`. The framed file is the deliverable, not `record.sh`'s output.
- **Motion graphics** means the recording is only the raw material. You also
  write one HTML scene per idea and a plan that says where each one goes, and
  the deliverable is the assembled video, not `record.sh`'s output. Only reach
  for a scene when a line of narration over the real screen would not land:
  "the order goes through eight stages" wants a diagram, "click Approve" does
  not.

Ask once, at the start. Re-rendering with different overlays is cheap, since the
capture and the timeline do not change and narration clips are cached, but
rewriting a flow around a different answer is not.

## Then ask for the resolution

In the same `AskUserQuestion` call, add a second question, single choice, with
2K marked as the recommended default. Put the choice straight into the
environment of the entry point:

| Option | Browser (`WIDTH`/`HEIGHT`) | iOS (`OUT_W`, height follows the device) | Use it for |
|---|---|---|---|
| 720p | `1280`/`720` | `720` | Quick previews, chat attachments, draft passes |
| 1080p | `1920`/`1080` | `1080` | Most sharing: Slack, email, LinkedIn, docs |
| 2K (recommended) | `2560`/`1440` | `1440` | The master copy. YouTube, course pages, anything you will keep |
| 4K | `3840`/`2160` | `2160` | Large screens, downscaling in an editor later |

```bash
WIDTH=1920 HEIGHT=1080 bash <skill>/assets/record.sh flow.mjs demo.mp4
OUT_W=1440 bash <skill>/assets/record-ios.sh flow.mjs demo.mp4
```

Resolution has no effect on the flow you write, only on the render, so a
recording made at one size can be remade at another from the same flow. On
iOS the capture is the device's own pixels, so `OUT_W` above the device width
only upscales; say so if they pick 4K for a phone. Browser flows render at 2×
(`SCALE`) regardless, which is what keeps text crisp at every size.

---

# Browser flows

`recorder.mjs` launches Chromium, injects a cursor and caption overlay into
every page, records the session to `.webm`, and runs a **flow module** you
write. `record.sh` converts the `.webm` to a high-quality `.mp4`, then lays the
voice-over on if there is one.

1. **Ask what goes in the video**, as [above](#ask-what-goes-in-the-video-before-anything-else).
   Then **check prerequisites** (install into the target project if missing):
   ```bash
   which ffmpeg node                       # both required
   npm ls playwright || npm i -D playwright
   npx playwright install chromium
   ```
2. **Copy the assets** into the project (e.g. a `scripts/` folder):
   `recorder.mjs`, `record.sh`, `tts.mjs`, `mux.mjs`, and `flow.example.mjs`
   from this skill's `assets/`; with the frame ticked, also `frame.sh`,
   `frame-props.mjs` and the whole `frame/` directory; with motion graphics ticked, also `motion.mjs`,
   `assemble.mjs`, `kit.js`, `preview.mjs`, the two `scene*.example.html`
   files and `motion.plan.example.json` (`kit.js` next to the scenes).
   `tts.mjs` must sit next to the flow file, since the recorder imports it from
   there.
3. **Pick the TTS engine.** See [Narration](#narration), which decides
   whether you write any.
4. **Write the flow.** Copy `flow.example.mjs` to `flow.mjs` and script the
   steps. The default export gets `{ page, say, hold, recap, cap, click, type,
   glide, goto, beat, safe, speaking }`. Rules that make a good recording:
   - One `say(id)` … work … `hold()` block per step. `say()` shows the caption
     and starts the clip; `hold()` keeps the step up until the line finishes.
   - Prefer role or label locators: `page.getByRole('button', { name: 'Save' })`.
   - Wait for async work explicitly:
     `await page.getByText('Completed').waitFor({ timeout: 60000 })`. Never
     guess with a fixed sleep for something that varies.
   - Wrap optional or fragile clicks in `safe(() => click(...))` so one missing
     element cannot abort the whole recording.
   - Without narration, `cap('Step N · what happens')` before each action, then
     `beat()` (1 to 3s) so the screen is readable.
5. **Make sure the app is running** (dev server plus any workers the flow
   needs).
6. **Record:**
   ```bash
   ELEVENLABS_API_KEY=… BASE=http://localhost:8000 \
     bash <skill>/assets/record.sh path/to/flow.mjs demo.mp4
   ```
7. **Read the segment table, then verify.** See [After every
   run](#after-every-run).

## Browser knobs

- `POINTER=0`: no cursor and no click ripple. `CAPTIONS=0`: no caption pill. Both are injected into the page, so turning them off leaves nothing behind.
- `WIDTH`/`HEIGHT`: output resolution, set from the [resolution question](#then-ask-for-the-resolution) (default `2560`/`1440`).
- `SCALE`: `deviceScaleFactor` (default `2`). This supersamples: the page renders at 2× then scales down, so text stays crisp. The single biggest quality lever.
- `SLOWMO`: ms added to every Playwright action (default `55`) for smooth pacing.
- `ZOOM_SCALE` / `ZOOM_HOLD_MS`: defaults for `zoom()` and `click(…, { zoom: true })` (`1.35`, `1800`). Only rendered by `frame.sh`.
- `FRAME=1`: keep the timeline (captions, zoom marks) for `frame.sh` even when the flow has no narration.

## Browser flow patterns

- **Dark mode:** click the app's theme toggle, or set its cookie or localStorage key then `goto` again to reload.
- **File upload:** `page.setInputFiles('input[type=file]', absPath)`. (When Playwright is driven via the MCP browser the path must live inside the project root; a direct `node` run has no such restriction.)
- **Two-part tour (app plus admin):** clear cookies between parts to show a fresh login: `await context.clearCookies()`.
- **Live or async UI (progress bars, queues):** land on the page, then `waitFor` a terminal text or state so the video captures the real transition instead of a fixed guess.
- **A navigation wipes the caption pill.** `say()` → `goto()` → `recap()` → `hold()` speaks over the load and puts the caption back, instead of leaving a hole while the page settles.

## Browser gotchas

- Playwright records to `.webm` (VP8/9). The mp4 conversion plus supersampling is what produces the crisp result, so do not skip `record.sh`.
- Native `<select>` elements sit in the same row as many accordion headers. `click()` presses the centre of whatever it measured, so target the toggle precisely (`button:has(.title)`) or you will open a confirm dialog, or silently change a value, instead of expanding a panel.
- A looped still overlaid on a finite video keeps ffmpeg going forever, because overlay repeats the last frame of whichever input ended. `shortest=1` on that overlay is what stops it.

---

# Native iOS flows

`ios-recorder.mjs` drives a real build on a booted simulator and captures the
device screen; `ios-compose.mjs` paints the cursor, ripples and captions on
afterwards and lays the voice over. `record-ios.sh` runs both.

## How it drives the app

Three constraints shape this half, and all three are worth knowing before you
change anything.

**There is no window to click.** Xcode 27 ships no `Simulator.app`. Device Hub
replaced it, and it renders the device inside its own chrome. So every
coordinate-clicking approach is dead, and taps go through Maestro's XCUITest
driver, which talks to the booted simulator directly and selects by
accessibility id. That is steadier than pixel coordinates anyway: a testID
survives a new device size.

**Maestro runs a static YAML, which cannot interleave narration.** So the flow
module is executed twice. The first pass is a *plan*, where the helpers only
record what the flow meant to do. The recorder then generates a Maestro flow in
which every device action is preceded by a `runScript` that calls back into the
recorder over HTTP and blocks until it answers. That makes the recorder the
clock, the same guarantee the browser half gets from sharing a process. Step
handshake latency is about 10ms.

The cost is that **the plan is fixed before the app opens**, so a flow cannot
branch on what is on screen. Use `waitFor()` for anything that varies.

**There is no DOM to inject an overlay into.** The cursor, ripples and captions
are composited after the fact from the driver's own tap log, which records every
touch it delivered with coordinates and a wall-clock timestamp.

## Steps to produce a recording

1. **Ask what goes in the video**, as [above](#ask-what-goes-in-the-video-before-anything-else).
   Then **check prerequisites:**
   ```bash
   which ffmpeg node
   xcrun simctl list runtimes            # fails if the Xcode licence is unaccepted
   ls ~/.maestro/bin/maestro || curl -Ls "https://get.maestro.mobile.dev" | bash
   ```
   If `simctl` reports the licence has not been agreed, **the user has to run
   `sudo xcodebuild -license accept` themselves**; suggest they type it with a
   `!` prefix. Nothing else works until they do.
2. **Copy the assets** next to each other in the project (e.g. `scripts/`):
   `ios-recorder.mjs`, `ios-compose.mjs`, `record-ios.sh`, `tts.mjs`, `mux.mjs`,
   and `flow.ios.example.mjs`. `tts.mjs` must sit next to the flow file.
3. **Get the app onto a simulator and running.** A debug build already in
   DerivedData installs in seconds and saves a rebuild:
   ```bash
   xcrun simctl boot <udid>
   find ~/Library/Developer/Xcode/DerivedData/<App>-*/Build/Products/Debug-iphonesimulator -name "*.app"
   xcrun simctl install <udid> <that .app>
   ```
   A React Native or Expo debug build also needs its bundler running, and a
   local HTTPS API needs its root certificate trusted on the device
   (`xcrun simctl keychain <udid> add-root-cert <ca.pem>`).
4. **Pick the TTS engine.** See [Narration](#narration).
5. **Learn the screen.** Read the app's source for the testIDs it already
   ships; that is faster and more reliable than guessing. To see what XCUITest
   actually sees, dump the hierarchy, but note it costs about 15 seconds a
   call, because every Maestro invocation starts a JVM and a driver:
   ```bash
   ~/.maestro/bin/maestro --device <udid> hierarchy | \
     python3 -c "import json,sys; …"     # resource-id, text, bounds
   ```
   Bounds come back in **points**; the video is in pixels, so the recorder
   multiplies by the device scale (2 or 3, detected automatically).
6. **Write the flow.** Copy `flow.ios.example.mjs` to `flow.mjs`. The default
   export gets `{ launch, tap, tapText, type, waitFor, waitForText, say, hold,
   recap, cap, beat }`, and the module may also export `appId` and a `before`
   hook. Rules that make a good recording:
   - One `say(id)` … work … `hold()` block per step, as in the browser half.
   - Select by testID. Reach for `tapText` only when there is no id.
   - `waitFor()` after anything that navigates or loads. A cold launch plus a
     JavaScript bundle wants a 60s timeout, not a `beat()`.
   - Keep each line on one screen, or wait for the new one inside the line that
     is about arriving there. See [Keeping the voice on the screen it is
     describing](#keeping-the-voice-on-the-screen-it-is-describing); the
     recorder enforces this and it is the misalignment viewers actually notice.
   - Export `before` to put the device in a known state (see below).
7. **Record:**
   ```bash
   ELEVENLABS_API_KEY=… UDID=<udid> \
     bash <skill>/assets/record-ios.sh path/to/flow.mjs demo.mp4
   ```
8. **Read the segment table, then verify.** See [After every
   run](#after-every-run).

## Keeping the voice on the screen it is describing

There are two ways a recording goes out of sync, and only one of them is a
clock.

The dangerous one is not. A line can be perfectly timed and still describe the
wrong picture, because the app moved on inside the step's own action. Typing the
last digit of a code submits the form, the app navigates, and the line that was
introducing the code spends its remaining twelve seconds talking over the home
screen. Every number in the segment table looks right while this happens: the
line ran 13.8s, the step ran 14.1s.

So the recorder checks the picture itself, sampling the capture and comparing
small greyscale thumbnails. Two rules:

1. **A line that never waits for a new screen must not end on one.** If a
   segment contains no `waitFor`, it is saying it stays put, and the screen at
   the end of the line has to match the screen at the start.
2. **Once the flow stops acting, the screen stays put.** Nothing may change
   during a `hold()` or `beat()`, which is where an app that navigates on a
   timer gets caught.

A segment that *does* contain a `waitFor` is the flow saying that line is meant
to carry the viewer across, so it is allowed to change screen. That is the whole
vocabulary: waiting inside a line declares the line's intent.

A violation prints the segment, how much of the picture changed, and how long
the line kept talking afterwards, and the recorder exits 2:

```
  code   13.8s   14.1s  ← TALKED OVER the next screen for 12.1s
  "code": 32% of the screen changed 1.7s into its line, and the line then kept
          talking for 12.1s over the new screen.
```

Fix the flow, never the audio. Either split the action so the part that
navigates falls under the next line, or let this line carry the viewer across on
purpose by waiting for the new screen inside it and writing words about arriving
there. In the sign-in flow this skill was built against, the fix was to type
five of the six digits under the line about the code, leaving the sixth (which
submits) for the line that describes landing.

Calibrated thresholds, from a real flow: two frames of the same screen differ by
under 1%, text being typed into a field by about 10%, and a navigation by 15% to
32%. `CHANGE_FRACTION` defaults to 0.13.

### The clock, if you ever doubt it

`ios-calibrate.mjs` settles the other question. It flips the simulator's
light/dark appearance at known moments and finds those flips in the recording,
then fits video time against wall-clock time:

```bash
UDID=<udid> node <skill>/assets/ios-calibrate.mjs 8
```

A slope of 1.0 means the capture runs at real speed and a constant offset is the
only thing that could ever need correcting. Measured on an iPhone 17 Pro under
iOS 26.5: slope 1.0026, or 157ms of drift across a whole minute, with the
residual explained by the appearance animation's own latency. Do not "correct"
that with `AUDIO_OFFSET_MS`; it is the measurement's latency, not the video's.

## Start from a known state

A recording that starts from wherever the last run left off is how you end up
with a demo of the wrong screen, and the failure is silent, because the flow
just waits for an element that is never coming.

Export a `before` hook and reset there. The usual trap is a session in the
keychain: it survives uninstalling and reinstalling the app, and only
`xcrun simctl keychain <udid> reset` clears it. That also drops any development
root certificate you added, so put it back in the same hook.

Permission alerts are worth answering once by hand before you record, rather
than scripting around them. They belong to SpringBoard rather than the app, and
Maestro can hang looking for them; a `tapOn: point:` is the escape hatch if you
must. `simctl privacy` has no notifications service, so that one can only be
answered on screen.

## iOS knobs

- `UDID`: which simulator (default: the booted one). `BUNDLE_ID` overrides the flow's `appId`.
- `OUT_W`: output width, set from the [resolution question](#then-ask-for-the-resolution) (default `1080`); the height follows the device's aspect ratio.
- `TAIL_MS`: how much video to keep after the last spoken word (default `1200`). Whatever the driver was still doing after the narration ended is dead air, and dead air at the end is the part viewers notice.
- `SCALE`: points→pixels, normally detected. Set it if a ripple lands in the wrong place.
- `MAESTRO`: path to the binary, if it is not at `~/.maestro/bin/maestro`.
- `POINTER=0`: no cursor and no tap ripple. `CAPTIONS=0`: no caption pill. Both are composited afterwards, so either can be changed by re-running `ios-compose.mjs` on the same capture, without recording again.
- `CHANGE_FRACTION`: how much of the picture must differ to count as a new screen (default `0.13`).
- `SETTLE_GRACE_MS`: how long a transition already in flight is given to finish before the check starts looking (default `900`).

## iOS gotchas

- **`simctl` buffers the whole capture and writes the file when it stops**, so the file sits at 0 bytes while recording. Its size tells you nothing; `Recording started` on stderr is the only usable t=0, and the recorder syncs to that line.
- **An element with `opacity: 0` does not exist to XCUITest.** A six-box code field is usually one transparent input behind the boxes, so wait on a visible landmark (the submit button) and let the field's own autofocus take the typing.
- **`inputText` types into whatever has focus**, which is what makes numeric fields workable: they refuse a pasteboard paste, but synthetic keystrokes land.
- **Every Maestro invocation costs about 15 seconds** of JVM and driver startup, so one flow per recording, never one per step. This is the whole reason for the HTTP handshake.
- **Quitting Device Hub shuts its simulator down.** The symptom is a screenshot failing with "Timeout waiting for screen surfaces", which reads like a graphics fault rather than a missing device; the recorder checks the device state up front and says which one it is.
- The recording is the device screen alone, with no bezel around it. Add one in post if you want the phone look.

---

# Narration

Settle the engine before writing anything, because it decides whether you
write narration at all. `tts.mjs` speaks through one of four providers:

| `TTS_PROVIDER` | Needs | Voice and model knobs |
|---|---|---|
| `elevenlabs` | `ELEVENLABS_API_KEY` | `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID` |
| `openai` | `OPENAI_API_KEY` | `OPENAI_TTS_VOICE` (alloy), `OPENAI_TTS_MODEL` (gpt-4o-mini-tts) |
| `say` | macOS, nothing else | `SAY_VOICE` (`say -v ?` lists them) |
| `command` | `TTS_COMMAND` | whatever the command takes |

Left unset, the provider is auto-picked in that order from what the
environment has, so a paid key wins over the system voice. Look first:

```bash
env | grep -iE "eleven|openai|tts_"
grep -rlE "ELEVENLABS_API_KEY|OPENAI_API_KEY" ~/code/*/.env 2>/dev/null | head
```

Then ask the user which engine to use, offering what you found plus `say`
(free, instant, robotic) and their own command. If they have a local model
(Piper, Kokoro, Coqui, a TTS server they run), `command` is the way in: a shell
line run once per clip with `$TTS_TEXT`, `$TTS_OUT` (the file to write, any
format ffmpeg can read) and `$TTS_SPEED` in its environment. The text is passed
as a variable, never interpolated into the line, so a quote in a sentence
cannot break out of it.

```bash
TTS_COMMAND='piper --model en_US-lessac-medium.onnx --output_file "$TTS_OUT" <<< "$TTS_TEXT"'
TTS_COMMAND='curl -s localhost:8880/v1/audio/speech -H "content-type: application/json" \
  -d "$(jq -n --arg t "$TTS_TEXT" "{input:\$t, voice:\"af_bella\"}")" -o "$TTS_OUT"'
```

Any local model works the same way: wrap it in a few lines that read
`$TTS_TEXT` and write `$TTS_OUT`, and pass that as `TTS_COMMAND`. Budget the
model's load time per clip, since each clip runs in its own process; a tiny
HTTP server that loads the model once is the fix when that adds up.

Engine chosen: write `narration` and use `say()`/`hold()`. Nothing available
and the user wants no system voice: skip narration, use `cap()`, and say so
when you deliver. The same flow file runs every way; clips are cached per
provider, so switching engines re-synthesizes but nothing else changes.

Motion-graphics cues need word timings. ElevenLabs forced alignment gives exact
ones for any clip, whichever engine spoke it, so a key is still worth having
when scenes are ticked. Without one, timings are estimated from word lengths,
which puts a cue within a word or so of its mark: fine for a diagram, not for
anything that has to land on a syllable.

## Writing lines that sound like a person

- **Err long.** A line longer than its step just holds the shot a moment more. A
  step longer than its line is silence, which is the thing viewers notice.
- **Watch the read speed, not just the words.** A voice-over at the default
  ElevenLabs pace sounds slow next to a moving screen, and slow narration also
  stretches the video, since every step waits for its line. `NARRATION_SPEED`
  is set to 1.1 for that reason. Nudge it up before you start cutting content.
- **Spell for the ear.** `text` is never shown, so write names the way they
  should be read. "Lumen Goods" reads correctly; "LumenGOODS" does not.
  Keep the real spelling in `caption`.
- **One flowing sentence beats four short ones.** The voice takes a full beat at
  every full stop, and a run of fragments turns into seconds of gaps. Commas and
  colons keep it moving. `tts.mjs` also caps every pause at 0.3s, so both
  together get you a clip with no holes in it.
- **Never say on the soundtrack what you have not put on screen.** If the line
  says "two orders, both overdue", assert exactly that and throw if it is
  not true. An LLM feature that classifies non-deterministically will eventually
  hand you a run where the voice is confidently wrong, and a video that lies is
  worse than no video.
- **Narrate the shot you are actually on.** Before recording, measure how long
  the interesting states last. A spinner that lives for two seconds cannot carry
  thirteen seconds of "here it is, working": report the result and explain how it
  got there instead. Frame checks catch this; nothing else does.
- **A wait that might outlast its line** deserves a second, optional segment,
  spoken only when the thing you are waiting for still is not there. A slow run
  then has something to listen to instead of a spinner in silence.

## Narration knobs

- `TTS_PROVIDER`: `elevenlabs`, `openai`, `say` or `command`; auto-picked from the environment when unset. See the table above for each one's voice and model variables.
- `ELEVENLABS_VOICE_ID`: default is Eric, an American conversational read that suits product demos. `ELEVENLABS_MODEL_ID` defaults to `eleven_v4`, the best-quality model and the standing choice; `eleven_multilingual_v2` is the older, flatter read.
- `NARRATION_SPEED`: read speed, default `1.1`, applied to every engine (for `say` it scales the words-per-minute rate; for `command` it arrives as `$TTS_SPEED`). ElevenLabs out of the box reads slower than someone talking you through a screen, which viewers notice as a drag. The API takes 0.7 to 1.2 and the effect is close to linear (0.75 gave 9.4s on a line that ran 7.3s at 1.0 and 5.8s at 1.2). Past about 1.15 it starts to sound clipped. Do not judge the setting from one short clip: generation length varies enough run to run to hide a small change.
- `NARRATION=0`: record silently even with a key set. This is what the opening question sets when nobody wants a voice-over, and it is also the cheap first pass on any flow: it costs nothing and catches a broken selector before you spend credits.
- `SEGMENT_GAP_MS`: breath between lines (default `280`).
- `LEAD_IN_MS`: how much video to keep in front of the first spoken word (default `400`). The rest of the head, usually the app's first paint, is cut, and every audio offset moves with it.
- `TTS_CACHE_DIR`: where clips are cached (default `storage/app/recording/tts`). Clips are keyed by content, so re-running a flow costs nothing unless the words changed.
- `AUDIO_OFFSET_MS`: manual override if the voice ever sits ahead of or behind the picture. It should not: the recorder measures this and it comes out at zero.
- `CRF`: H.264 quality (default `16`, near lossless; `18` for a smaller file).

---

# Frame

Browser flows only. The recording stays as it is; a second render places it
inside a browser chrome on a framed canvas, draws the captions as a step
header above the picture, lays the narration under it as subtitles that
follow the voice, and can drift the camera in on a detail. It is what makes a
demo look like a product page instead of a screen capture, and it is opt-in
because it costs the user a Remotion install: React, Remotion and a headless
Chrome, about 500 MB, a few minutes the first time, and renders at roughly
two to three times real time.

**Record with the frame in mind.** `FRAME=1` makes the recorder keep a
timeline even for a silent flow, with every caption, every navigation and
the text of every spoken line in it. `CAPTIONS=0` keeps the page's own pill
off, because the header replaces it:

```bash
FRAME=1 CAPTIONS=0 bash <skill>/assets/record.sh flow.mjs demo.mp4
FRAME_TITLE="Lumen Goods" FRAME_URL="https://app.lumengoods.com" \
  bash <skill>/assets/frame.sh demo.mp4 demo.timeline.json demo.framed.mp4
```

**What the viewer sees.**

- A step header: a small numbered badge (`01`, `02`), the caption as the
  step title, the app name at the right (`FRAME_TITLE`) and a progress rail
  with one segment per step. Each step slides in when its caption starts.
  Captions are therefore titles, three or four words: "Approve the order",
  not a sentence.
- A browser chrome: traffic lights and the URL the page was on at that
  moment, host in bold, path in grey. Recording against `localhost` shows
  `localhost`, which is not what a product demo should say, so set
  `FRAME_URL` to the real domain (the path is kept from the recording when
  you give only an origin, or pass a full URL to pin it). The bar shows host
  and path only: query strings and fragments are dropped at record time,
  because that is where tokens, codes and signatures live and a video is
  forever. `FRAME_URL_QUERY=1` keeps them, with the usual secret parameter
  names blanked. `FRAME_CHROME=0` drops the bar.
- Subtitles: the phrase being spoken, in a dark box at the bottom of the
  picture, cut into lines of about 44 characters (`SUB_MAX_CHARS`). They
  come from the narration clips, word-aligned with ElevenLabs when a key is
  in the environment (free, cached beside the clip) and estimated from text
  length otherwise. A silent flow has none.

**Zoom, rarely.** The ripple already shows every click, so a click is never
a reason to zoom. A drift earns its place only when the voice points at
something the viewer cannot read at full size: a value in a small field, a
toggle in a dense settings page, a badge. In a one-minute video that is one
moment, perhaps two, and most videos have none.

```js
await zoom(page.locator('input.qty').nth(1), { scale: 1.3, ms: 2200 });   // lean in on the one small thing
await click('#pay', { zoom: 1.4 });                                       // only if the click target itself is the small thing
```

The drift starts 500 ms before its moment, holds for `ms` (default
`ZOOM_HOLD_MS`, 1.8 s), then relaxes over a second. Both springs are slow and
heavily damped on purpose; do not make them snappier. The centre is clamped
to the picture, so a target near an edge never shows empty canvas. Stay
between 1.25× and 1.5×: the point is to lean in, not to crop.

**What `frame.sh` does.** Installs Remotion into `frame/node_modules` the
first time, copies the recording in, builds the props from the timeline with
`frame-props.mjs` (captions, URLs and zoom marks shifted by the head trim,
the subtitles, size, length), renders, and prints the path. Narration comes
through untouched since the audio travels with the input video. Knobs:
`FRAME_TITLE`, `FRAME_URL`, `FRAME_CHROME=0`, `FRAME_ACCENT` (badge colour,
default blue), `FRAME_PAD` (inset as a fraction of height, `0.06`),
`FRAME_RADIUS` (`14`), `FRAME_BG` (any CSS background; default a deep blue
gradient), `SUB_MAX_CHARS`, `CRF`.

Two things to tell the user before the install: the size, and the licence.
Remotion is free for individuals and for companies of up to three people;
larger companies need a company licence to render. Say so when the project
belongs to a company, and let them decide.

The framed file is what you deliver. Delete the timeline afterwards as usual.

---

# Motion graphics

A recording shows what the app does. It cannot show why a stage exists, how
three systems feed one record, or what happens between two screens. That is
where a short animated scene earns its place, spliced between two recorded
steps with a transition on each side.

A scene is not a slide. It is a small animated story: things travel (an email
flies from the customer to the order, a truck drives to the courier), things react (a
stamp slams down, a counter ticks up, a node pings when data lands), the
camera follows the action, and every beat lands on the word that names it. If
a frame of it would pass as a presentation slide, it is not done.

| File | Does |
|---|---|
| `motion.mjs` | Renders one scene to an MP4, synced word by word to its narration line |
| `assemble.mjs` | Cuts the recording at segment boundaries, renders the scenes, joins everything with transitions, and proves no speech falls under a join |
| `kit.js` | Scene helpers: measured boxes, connectors drawn between real element edges, the layout check, counters, idle float |
| `scene.example.html` | A complete scene to copy from: one screen, a central record with nodes around it, things travelling between them, a stepper HUD |
| `scene.pipeline.example.html` | A second pattern: a pipeline wider than the screen that the camera pans along, phase pills in the HUD, and a pull-back to the whole picture at the end |
| `motion.plan.example.json` | A plan with two scenes and cue-marked narration, the one that produced the reference sample |
| `preview.mjs` | `node preview.mjs scene.html cueA,cueB,… 26000`: fake evenly spaced cues, runs the layout check, saves a frame just after each cue to `preview/`, so a scene can be fixed before any credits are spent |

Scenes use GSAP 3.12.5 and its MotionPathPlugin, loaded from cdnjs inside the
scene page. They are not a dependency of the project being recorded.

## The plan

Run `record.sh` first. The plan points at its MP4 and timeline:

```json
{
  "flow": "out/demo.mp4",
  "timeline": "out/demo.timeline.json",
  "transition": { "type": "smoothleft", "ms": 700 },
  "parts": [
    { "flow": ["order-stepper"] },
    { "motion": "scenes/journey.html", "id": "m-journey",
      "text": "Here is the whole journey. {email}It starts when a customer places an order. {ai}The system reads it…" },
    { "flow": ["amendment-arrives", "amendment-task"] }
  ]
}
```

A `flow` part is `[first, last]` segment ids, inclusive, so a cut never lands
mid-sentence. A `motion` part is a scene plus its narration. `{name}` marks a
cue: the markers are stripped, the line is synthesized through `tts.mjs` (same
voice, same cache), force-aligned with ElevenLabs when a key exists, otherwise
estimated (free, cached beside the clip as `.words.json`), and each cue becomes the moment the next word starts. Put a
cue before the word the viewer should see happen, not before the sentence that
introduces it.

## Joins: nothing is ever said under a transition

`assemble.mjs` gives every part T + 0.35 s of silence before its first word
and T + 0.45 s after its last, where T is the transition length. A flow part
gets it by holding its first and last frame (the wipe covers most of the
hold); a motion part gets it as lead-in and tail while its scene keeps moving.
After the final encode it measures the loudest sound in a window around every
join and exits 2 if any is above −45 dB. The table it prints is the proof:

```
join   at        loudest in window
1        13.71s   -91.0 dB silent
```

Never "fix" a loud join by shortening the transition. Widen `PRE_GAP_MS` or
`POST_GAP_MS`, or end the line earlier.

## Writing a scene

The contract, which `motion.mjs` enforces:

- `window.setup()` runs once at final layout, before anything animates. Measure
  here: `K.link('#a', '#b', { from: 'right', to: 'left' })` draws a connector
  from the real edge of one element to the real edge of the other, and
  `K.place(token, point)` parks a token at the start of its path.
- `window.timeline()` returns a paused GSAP timeline. Times come from
  `K.cue('name')`, in seconds. The renderer seeks it frame by frame; nothing
  plays in real time, so the clip is deterministic.
- `window.__DURATION_MS` is the clip length, for anything that runs the whole
  way (background drift, idle float, a spinning ring).

Alignment is checked, not eyeballed. After `setup()`, `K.lint()` reports text
that sticks out of or is clipped by its `.lint` container, `.lint` elements
that overlap each other, anything outside the world, and `[data-row]` /
`[data-col]` groups whose centres are more than 1 px apart. Any report stops
the render. Mark decorations that overlap on purpose (glow rings, stamps, scan
beams) with `.deco`. Lay out with grid and flex, never with hand-typed
coordinates; the only numbers in a scene should be sizes.

Rules that make a scene feel alive:

- **Something always moves.** Background blobs drift, connector tracks flow,
  idle nodes float (`K.float`). A frozen frame between beats reads as a slide.
- **Data travels.** When the voice says something goes somewhere, a token goes
  there along the connector (`motionPath`), and the receiver reacts on arrival:
  a ping ring, a counter, a status that flips.
- **The camera follows.** Lay the scene out wider than the screen if it needs
  room, frame the pair of elements the line is about, and pull back to the
  whole picture at the end.
- **A progress HUD** (a stepper, or phase pills) outside the camera, so the
  viewer always knows where in the story they are.
- **Real names and numbers from the app**, same rule as the recording. A
  scene that shows a price difference shows the real one.
- **`fromTo` renders its start state immediately.** For anything that should
  stay invisible until its moment (a ripple, a ping), pass
  `immediateRender: false`, or it sits faintly on screen from frame one.

Before spending credits, preview with fake evenly spaced cues: load the scene
with `__CUES` set, run `setup()` and `K.lint()`, seek to just after each cue,
screenshot, look. Do not return the timeline from `page.evaluate`: Playwright
tries to serialise it and hangs.

---

# After every run

**Read the segment table.** It prints spoken length against on-screen length for
every step and flags two different faults. `SHORT` means the step outlasted its
line, which is silence: lengthen the text and re-run. `TALKED OVER` means the
line was describing a screen the viewer had already left, and no amount of
shifting audio will fix it; the flow has to change.

```
  segment            spoken   on screen
  intro              8.6s     8.9s
  code              13.8s    14.1s  ← TALKED OVER the next screen for 12.1s
  home               5.8s     9.1s  ← SHORT (silence)
```

**Then verify before delivering.** The timeline beside the video says which line
was spoken when. Pull the frame at each offset and look at it: the screen has to
show what the voice is claiming.

```bash
ffprobe -v error -show_entries format=duration:stream=codec_type,width,height \
  -of default=noprint_wrappers=1 demo.mp4
python3 -c "
import json
d = json.load(open('demo.timeline.json'))
for s in d['segments']:
    print(s['id'], round((s['startMs'] - d['trimMs']) / 1000, 1))
"
ffmpeg -y -ss 132 -i demo.mp4 -frames:v 1 /tmp/f.png     # then Read it
```

Pull the frame from the last second of each line, not the middle. The middle
usually looks right even when the end does not, and the end is where a line that
has outrun its screen gives itself away.

Also check the finished track for holes:

```bash
ffmpeg -hide_banner -i demo.mp4 -vn -af silencedetect=noise=-40dB:d=1.0 -f null /dev/null 2>&1 | grep silence_
```

Anything over about 1.2s is dead air worth chasing. Under that is a breath
between sentences.

**Then clean up.** Keep captions to a phrase. They are chapter markers next to
the voice, not subtitles of it. Delete the `<out>.timeline.json` and any
extracted frames before handing the file over; both entry points remove their
own scratch capture.

**Then hand it over with its path.** The last line of the reply is the
absolute path of the finished MP4 (and of the assembled video when motion
graphics were used), with its duration and size, so the user can open it
without searching:

```
Final video: /Users/me/code/app/out/demo.mp4 (2:51, 48 MB)
```
