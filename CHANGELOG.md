# Changelog

## 1.4.0 (2026-10-22)

- Opt-in zoom and framed canvas for browser recordings: `click(…, { zoom })` and `zoom()` mark the moments, `frame.sh` renders spring-eased push-ins inside a padded, rounded, shadowed frame with Remotion. Installs on first use only; the default pipeline is unchanged.
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
