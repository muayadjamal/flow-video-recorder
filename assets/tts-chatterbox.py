#!/usr/bin/env python
# Chatterbox (resemble-ai/chatterbox) as a TTS_COMMAND provider for tts.mjs.
# One clip per process: reads TTS_TEXT, writes TTS_OUT (wav bytes, any name).
#
# Setup:  python3.12 -m venv ~/.chatterbox
#         ~/.chatterbox/bin/pip install "git+https://github.com/resemble-ai/chatterbox.git"
#         (the PyPI release lags behind: 0.1.7 has no Nano and no Multilingual V3)
# Use:    TTS_COMMAND='~/.chatterbox/bin/python <skill>/assets/tts-chatterbox.py' bash <skill>/assets/record.sh flow.mjs demo.mp4
#
# Env: CHATTERBOX_MODEL  turbo (default, English, best quality) | nano (English, CPU) | multilingual
#      CHATTERBOX_DEVICE mps (default on Apple Silicon) | cuda | cpu
#      CHATTERBOX_REF    optional 10s wav to clone a voice from; default is the built-in voice
#      TTS_LANG          language id for the multilingual model (default en)
import os
import sys

import torch
import torchaudio as ta

text = os.environ["TTS_TEXT"]
out = os.environ["TTS_OUT"]
model_name = os.environ.get("CHATTERBOX_MODEL", "turbo")
device = os.environ.get("CHATTERBOX_DEVICE") or ("mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu")
ref = os.environ.get("CHATTERBOX_REF") or None

if model_name in ("turbo", "nano"):
    from chatterbox.tts_turbo import ChatterboxTurboTTS
    model = ChatterboxTurboTTS.from_pretrained(device=device, nano=model_name == "nano")
    wav = model.generate(text, audio_prompt_path=ref) if ref else model.generate(text)
elif model_name == "multilingual":
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS
    model = ChatterboxMultilingualTTS.from_pretrained(device=device, t3_model="v3")
    wav = model.generate(text, language_id=os.environ.get("TTS_LANG", "en"), audio_prompt_path=ref)
else:
    sys.exit(f"CHATTERBOX_MODEL={model_name}: expected turbo, nano or multilingual")

# torchaudio picks the container from the extension; TTS_OUT has none.
ta.save(out + ".wav", wav.cpu(), model.sr)
os.replace(out + ".wav", out)
