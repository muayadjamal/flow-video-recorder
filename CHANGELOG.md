# Changelog

## 1.5.0 (2026-10-22)

- Frame step: browser chrome with traffic lights and the live URL (`FRAME_URL` to show the real domain), compact numbered step header, and spoken-word subtitles cut from the narration clips (ElevenLabs alignment when a key exists, otherwise estimated). Zoom guidance tightened: never for a click as such, only for a detail the voice points at.

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
