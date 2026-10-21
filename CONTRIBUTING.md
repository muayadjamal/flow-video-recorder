# Contributing

Thanks for looking under the hood. This file covers how the repo is laid out, how to check a change, and what a good pull request looks like.

## Layout

| Path | What it is |
|---|---|
| `SKILL.md` | The instructions the agent reads. The single source of truth for how a recording is made. |
| `assets/` | The scripts the agent copies into a project: recorder, iOS driver, TTS, muxer, motion-graphics renderer, and the examples. |
| `tests/smoke.sh` | Records a one-step flow end to end with a synthetic voice and checks the MP4. |
| `.claude-plugin/`, `.cursor-plugin/`, `agents/` | Manifests for Claude Code, Cursor and Codex. |
| `.github/brand/` | Logo and banner masters. |

## Running it locally

You need `node` 20 or newer and `ffmpeg`. The smoke test installs Playwright into a temp dir on its own:

```bash
bash tests/smoke.sh
claude plugin validate .
```

For a real recording, follow the steps in `SKILL.md` against an app you have running. The browser half works on any OS; the iOS half needs macOS, Xcode and Maestro.

## Making a change

- One change per pull request. A bug fix and a new knob are two PRs.
- `SKILL.md` is read by an agent, not a person. Keep the voice it already has: say what to do and why, give the command, and name the failure the rule prevents. Do not add sections that restate the assets.
- The assets are copied into user projects, so they have no build step and no dependencies beyond Playwright, ffmpeg and the GSAP CDN. Keep it that way.
- Anything that changes what a user sees or runs gets a version bump: `metadata.version` in `SKILL.md`, both `plugin.json` files, `marketplace.json`, and a dated entry at the top of `CHANGELOG.md`. CI checks that they agree.
- If you touched `assets/`, make a real recording and say so in the PR. The smoke test proves the pipeline runs; it cannot tell you the cursor landed in the right place.

## Reporting problems

Bugs and feature requests go through the issue forms. Questions and recordings you want to show off go in Discussions. Security problems go through the private report button on the Security tab, as described in `.github/SECURITY.md`.
