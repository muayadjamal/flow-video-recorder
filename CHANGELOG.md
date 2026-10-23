# Changelog

## 1.7.0 (2026-10-23)

- Sound effects are fuller. Zoom drifts get a soft whoosh and hovers a tick, automatically. With `SFX=1`, `assemble.mjs` puts a whoosh on every transition. Two cues are merged only when they use the same sound, so a click is no longer dropped next to its zoom. SKILL.md now asks for a `sound()` on each step's result, and a sound on every movement in a motion scene.

## 1.6.1 (2026-10-23)

- Scene sound beats take `offsetMs`, so a sound can land when a token arrives rather than when its cue starts.

## 1.6.0 (2026-10-23)

- Opt-in sound effects, made in code by [earshot](https://github.com/Leonxlnx/earshot) and installed on first use only (about 1 GB). Record with `SFX=1`, then run `sfx.sh`. Clicks and typing get soft sounds automatically, with typing thinned to one key every 90 ms. Flows mark a visible result with `sound(role)`, and motion scenes list their beats in `window.SFX`. Effects sit under the voice and follow its loudness.
- The opening question is now two questions of three options each, since `AskUserQuestion` allows four options at most.

## 1.5.1 (2026-10-22)

- Brand colour sampling reads colours through a canvas, so apps styled with `oklch()` or `color-mix()` (Filament, Tailwind 4) get their real colour instead of the default blue.
- README links a two-minute example video rendered with the frame step.

## 1.5.0 (2026-10-22)

- Frame step: browser chrome with traffic lights and the live URL (`FRAME_URL` to show the real domain), compact numbered step header, and spoken-word subtitles cut from the narration clips (ElevenLabs alignment when a key exists, otherwise estimated). The camera zooms the whole browser window, chrome included. The canvas takes the app's colours: the recorder samples the brand colour on each page load and the frame uses it for the badge and a dark gradient background (`FRAME_ACCENT`/`FRAME_BG` still override). Zoom guidance tightened: never for a click as such, only for a detail the voice points at.

## 1.4.0 (2026-10-22)

- Opt-in zoom and frame for browser recordings, rendered with Remotion and installed on first use only: a framed canvas (background, rounded corners, shadow), captions drawn as a step header above the picture (numbered badge, title, app name, progress rail), and slow spring-eased camera drifts on the clicks marked with `click(…, { zoom })` or `zoom()`. Record with `FRAME=1 CAPTIONS=0`, then run `frame.sh`. The default pipeline is unchanged.
- The timeline now stays beside the video whenever the flow narrated or zoomed.

## 1.3.0 (2026-10-22)

- The opening question now also asks for the output resolution: 720p, 1080p, 2K (default) or 4K, mapped to `WIDTH`/`HEIGHT` for browser flows and `OUT_W` for iOS.

## 1.2.0 (2026-10-21)

- Browser recordings now show a macOS-style arrow cursor (black, white outline, soft shadow) instead of a blue dot. It squashes while the button is down and leaves a ripple on every click. iOS recordings keep their dot and ripple.

## 1.1.0 (2026-10-21)

- Narration through any of four engines, picked from the environment or set with `TTS_PROVIDER`: ElevenLabs, OpenAI, macOS `say`, or a custom shell command for local models.
- Word timings for motion-graphics cues are estimated from text when no ElevenLabs key is available.

## 1.0.0 (2026-10-21)

First public release.

- Browser flows with Playwright: cursor, click ripple, caption pill, 2560x1440 supersampled MP4.
- Native iOS flows with Maestro on the simulator, overlays composited after capture.
- ElevenLabs narration, with the picture paced to the audio and a screen-change check per line.
- Motion-graphics scenes (GSAP) spliced between recorded steps with silent, verified joins.
