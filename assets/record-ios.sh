#!/usr/bin/env bash
# Record a native iOS flow on a booted simulator to a high-quality MP4, with
# voice-over when the flow has one.
#
# Usage: record-ios.sh <flow.mjs> [output.mp4]
# Requires: node, ffmpeg, Xcode command line tools, a booted simulator with the
#           app installed, and Maestro (~/.maestro/bin/maestro).
# Env: UDID (default: the booted simulator), BUNDLE_ID, OUT_W (output width,
#      default 1080), CRF (16), TAIL_MS (1200), SCALE (points→pixels, auto),
#      TTS: ELEVENLABS_API_KEY, OPENAI_API_KEY, TTS_COMMAND or macOS say (see tts.mjs), NARRATION=0 (force silent).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
flow="${1:?Usage: record-ios.sh <flow.mjs> [output.mp4]}"
out="${2:-demo.mp4}"

# A flow that fails halfway still captured everything up to the failure, and
# that footage is usually how you work out what went wrong. Compose it anyway.
set +e
mov="$(node "$here/ios-recorder.mjs" "$flow" | tail -1)"
rc=$?
set -e

if [ ! -f "$mov" ]; then
  echo "The recorder produced no video." >&2
  exit 1
fi
case "$rc" in
  0) ;;
  2) echo "note: a line talked over a screen change (see above) - composing anyway" >&2 ;;
  *) echo "note: the flow failed - composing what was captured" >&2 ;;
esac

node "$here/ios-compose.mjs" "$mov" "$out" > /dev/null

# Kept beside the video: it says which line was spoken at which offset, which is
# what you check frames against to prove the voice-over is in sync.
[ -f "$mov.timeline.json" ] && mv "$mov.timeline.json" "${out%.mp4}.timeline.json"
rm -f "$mov"
echo "Wrote $(cd "$(dirname "$out")" && pwd)/$(basename "$out")"
