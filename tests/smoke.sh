#!/usr/bin/env bash
# End-to-end smoke test for the browser recorder. Copies the assets into a
# scratch dir, installs Playwright there, records a one-step flow with a
# synthetic "voice" (a tone from ffmpeg via TTS_COMMAND), and asserts the MP4
# has a video and an audio stream of plausible length. No API keys needed.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp "$here"/../assets/{recorder.mjs,record.sh,tts.mjs,mux.mjs} "$work"/
cp "$here"/flow.smoke.mjs "$work"/flow.mjs
cd "$work"
npm init -y >/dev/null
npm install --no-audit --no-fund playwright >/dev/null
npx playwright install ${PLAYWRIGHT_WITH_DEPS:+--with-deps} chromium >/dev/null

export TTS_COMMAND='ffmpeg -y -loglevel error -f lavfi -i "sine=frequency=440:duration=2" -ar 44100 "$TTS_OUT.wav" && mv "$TTS_OUT.wav" "$TTS_OUT"'
WIDTH=1280 HEIGHT=720 OUT_DIR="$work/out" TTS_CACHE_DIR="$work/tts" bash record.sh flow.mjs demo.mp4

streams="$(ffprobe -v error -show_entries stream=codec_type -of csv=p=0 demo.mp4 | sort | tr '\n' ' ')"
dur="$(ffprobe -v error -show_entries format=duration -of csv=p=0 demo.mp4)"
echo "streams: $streams duration: ${dur}s"
[[ "$streams" == *audio*video* ]] || { echo "expected audio and video streams"; exit 1; }
awk -v d="$dur" 'BEGIN { exit !(d > 1.5 && d < 10) }' || { echo "duration out of range"; exit 1; }
echo "smoke ok"
