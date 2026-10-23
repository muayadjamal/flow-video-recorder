#!/usr/bin/env bash
# Optional last step: sound effects on the clicks, keystrokes and beats a video
# marked, from earshot's bank of sounds made in code (github.com/Leonxlnx/earshot).
#
# Usage: sfx.sh <video.mp4> <cues.json> [output.mp4]
#        cues.json: the recording's timeline (record with SFX=1), or the
#        <clip>.sounds.json motion.mjs writes for a scene.
# Requires: Python 3.10+ and ffmpeg. Installs earshot into sfx/.venv next to
#           this script on first run (CPU torch included): budget a few minutes
#           and ~1 GB. No models are downloaded; the sounds render from code.
# Env: SFX_KIT (calm | crisp | minimal, or a kit.json; default calm),
#      SFX_DB (dB on every effect; default -6 under a voice, 0 on a silent video),
#      EARSHOT_PYTHON (a Python that already has earshot installed).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
in="${1:?Usage: sfx.sh <video.mp4> <cues.json> [output.mp4]}"
cues="${2:?Usage: sfx.sh <video.mp4> <cues.json> [output.mp4]}"
out="${3:-${in%.mp4}.sfx.mp4}"
cache="$here/sfx"
mkdir -p "$cache"

py="${EARSHOT_PYTHON:-}"
if [ -z "$py" ] && command -v earshot >/dev/null; then
  py="$(head -1 "$(command -v earshot)" | sed 's/^#!//')"
fi
if [ -z "$py" ]; then
  py="$cache/.venv/bin/python"
  if [ ! -x "$py" ]; then
    echo "Installing earshot into $cache/.venv (first run only)..." >&2
    if command -v uv >/dev/null; then
      uv venv -q --python 3.12 "$cache/.venv"
      uv pip install -q --python "$py" torch --index-url https://download.pytorch.org/whl/cpu
      uv pip install -q --python "$py" "earshot @ git+https://github.com/Leonxlnx/earshot@v0.4.0"
    else
      python3 -m venv "$cache/.venv"
      "$py" -m pip install -q torch --index-url https://download.pytorch.org/whl/cpu
      "$py" -m pip install -q "earshot @ git+https://github.com/Leonxlnx/earshot@v0.4.0"
    fi
  fi
fi

tmp="${out%.mp4}.sfx-tmp.mp4"
"$py" "$here/sfx.py" "$in" "$cues" "$tmp" "$cache"
mv "$tmp" "$out"
echo "Wrote $out"
