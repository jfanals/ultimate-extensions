# Underdog Woof text-to-speech, run by server.ts as one warm process, as kokoro-speak.py: one JSON request per stdin
# line, {"text": "...", "voice": "juno"}; each answered on stdout by a JSON header line,
# {"bytes": N} then N bytes of 24 kHz WAV, or {"error": "..."}. The model folder (speech.woofDir) is the first argument.
import io, json, os, sys, wave

out = os.fdopen(os.dup(1), "wb")
os.dup2(2, 1)  # libraries that print must not corrupt the protocol
sys.path.insert(0, sys.argv[1])
try:
    import numpy as np
    from underdog_woof import VOICES, Woof
except Exception as error:  # reported per request, so the host can say what is missing
    missing = f"Underdog Woof is not in {sys.argv[1]} for {sys.executable}: {error}"
else:
    missing = None
voices = {}

def reply(header, data=b""):
    out.write((json.dumps(header) + "\n").encode())
    out.write(data)
    out.flush()

for line in sys.stdin:
    try:
        if missing:
            raise RuntimeError(missing)
        request = json.loads(line)
        voice = request.get("voice") or "juno"
        if voice not in VOICES:
            raise ValueError(f"Underdog Woof has no voice {voice!r}; it has {', '.join(VOICES)}")
        if voice not in voices:
            voices[voice] = Woof(voice=voice)
        if not request.get("text"):  # a warm-up: load the voice, say nothing
            reply({"bytes": 0})
            continue
        audio = voices[voice](request["text"], seed=0)
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000)
            w.writeframes((np.clip(audio, -1, 1) * 32767).round().astype("<i2").tobytes())
        reply({"bytes": buffer.tell()}, buffer.getvalue())
    except Exception as error:
        reply({"error": str(error)})
