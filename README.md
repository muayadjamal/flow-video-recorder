# flow-video-recorder

[![skills.sh](https://skills.sh/b/muayadjamal/flow-video-recorder)](https://skills.sh/muayadjamal/flow-video-recorder)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

An agent skill that records a narrated demo video of your app. Tell Claude Code (or Codex, Cursor, any agent that reads `SKILL.md`) which flow to show, and it writes a script, drives the app, and hands back an MP4 with a moving cursor, a ripple on every click, a caption per step, and a voice that explains what is happening while it happens.

It works on two surfaces:

| | Browser | Native iOS |
|---|---|---|
| Driver | Playwright | Maestro on the simulator |
| Capture | Playwright `recordVideo` | `simctl io recordVideo` |
| Cursor, ripple, captions | injected into the page | composited after capture |
| Output | 2560x1440 MP4, supersampled | device-resolution MP4 |

Narration comes from ElevenLabs. Without an API key the same flow records silently with captions.

## See it working

Every video on [edumind.school/course](https://edumind.school/course?lang=en) was made with this skill: 20 walkthroughs of a school management platform, about 41 minutes in total, in English and Arabic, covering both the web app and the native parent and teacher apps. A few direct links:

- [Meet EduMind](https://edumind.school/course/01-overview/en.mp4) (web, with motion-graphics scenes)
- [The parent app](https://edumind.school/course/02-parent-app/en.mp4) (native iOS)
- [Exams: from question bank to paper](https://edumind.school/course/11-exams/en.mp4) (web)

## Install

Claude Code, as a plugin (updates itself):

```text
/plugin marketplace add muayadjamal/flow-video-recorder
/plugin install flow-video-recorder@flow-video-recorder
```

Claude Code, Codex, Cursor and other agents, through [skills.sh](https://skills.sh/muayadjamal/flow-video-recorder) (copies the files so you can edit them):

```bash
npx skills add muayadjamal/flow-video-recorder                       # into this project
npx skills add muayadjamal/flow-video-recorder -g                    # for every project
npx skills add muayadjamal/flow-video-recorder -g -a claude-code     # one agent only
```

By hand:

```bash
git clone https://github.com/muayadjamal/flow-video-recorder ~/.claude/skills/flow-video-recorder
```

## Requirements

- `node` 20 or newer and `ffmpeg` on the PATH.
- Browser flows: `playwright` in the target project (`npm i -D playwright && npx playwright install chromium`).
- iOS flows: macOS with Xcode, a booted simulator with your app installed, and [Maestro](https://maestro.mobile.dev) at `~/.maestro/bin/maestro`.
- Narration: an `ELEVENLABS_API_KEY` in the environment or the project's `.env`. Optional.

## Usage

Ask for a video in plain language:

> Record a demo video of the checkout flow, with narration.

The skill first asks what goes in the video (voice-over, subtitles, pointer, motion graphics), checks the tools above, copies its helper scripts into the project, writes a flow file for your app, and runs one of:

```bash
ELEVENLABS_API_KEY=… BASE=http://localhost:8000 bash <skill>/assets/record.sh flow.mjs demo.mp4
ELEVENLABS_API_KEY=… UDID=<simulator> bash <skill>/assets/record-ios.sh flow.mjs demo.mp4
```

A flow file is a short JavaScript module. Each step says its line, does its clicking, and holds until the line is finished:

```js
export const narration = [
  { id: 'open', caption: 'Open the order', text: 'Start from the orders list and open the one that just arrived.' },
];

export default async ({ page, say, hold, click, goto }) => {
  await goto('http://localhost:8000/orders');
  say('open');
  await click(page.getByRole('link', { name: 'ORD-1042' }));
  await hold();
};
```

After every run the recorder prints a table of spoken length against on-screen length per step, and flags silence and lines that kept talking after the screen changed.

## How it works

The picture is paced to the audio rather than the other way round. Every narration clip is synthesized and measured before the app opens, so a step lasts exactly as long as its sentence, and the voice never gets cut off by the next screen. Fitting audio to an already recorded video fails because step durations vary from run to run.

On iOS there is no DOM to inject into and Maestro runs a static YAML, so the flow is executed twice: once to plan, once for real, with Maestro calling back into the recorder over HTTP before every tap. The cursor, ripples and captions are painted on afterwards from the tap log. A frame-difference check then confirms each line stayed on the screen it describes.

Motion graphics are optional HTML scenes animated with GSAP, rendered frame by frame and cut in between recorded steps with a transition on each side. The assembler measures loudness around every join and refuses to ship a video where speech falls under a cut.

The full method, every environment knob, and the gotchas are in [SKILL.md](SKILL.md).

## Files

| File | Does |
|---|---|
| `SKILL.md` | The instructions the agent follows |
| `assets/record.sh`, `assets/recorder.mjs` | Browser entry point and Playwright driver |
| `assets/record-ios.sh`, `assets/ios-recorder.mjs`, `assets/ios-compose.mjs` | iOS entry point, Maestro driver, overlay compositor |
| `assets/tts.mjs`, `assets/mux.mjs` | ElevenLabs synthesis with caching, audio muxing |
| `assets/motion.mjs`, `assets/assemble.mjs`, `assets/kit.js`, `assets/preview.mjs` | Motion-graphics renderer, assembler, scene helpers, preview |
| `assets/*.example.*` | A browser flow, an iOS flow, two scenes and a plan to copy from |
| `assets/ios-calibrate.mjs` | Measures capture clock drift on a simulator |

## License

MIT. See [LICENSE](LICENSE).
