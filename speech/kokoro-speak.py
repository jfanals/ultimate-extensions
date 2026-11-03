# Kokoro text-to-speech for the Drive screen, run by kokoro.ts as one warm process: one JSON request per stdin line,
# {"text": "...", "voice": "af_heart"}; each answered on stdout by a JSON header line,
# {"bytes": N} then N bytes of 24 kHz WAV, or {"error": "..."}.
# Named so it cannot shadow the kokoro package: Python puts its folder first on the import path.
import io, json, os, sys

out = os.fdopen(os.dup(1), "wb")
os.dup2(2, 1)  # libraries that print must not corrupt the protocol
try:
    import numpy as np
    import soundfile as sf
    import torch
    from kokoro import KPipeline
except Exception as error:  # reported per request, so the host can say what is missing
    missing = f"Kokoro is not installed for {sys.executable}: {error}"
else:
    missing = None
device = "mps" if not missing and torch.backends.mps.is_available() else "cpu"
pipelines = {}

def reply(header, data=b""):
    out.write((json.dumps(header) + "\n").encode())
    out.write(data)
    out.flush()

for line in sys.stdin:
    try:
        if missing:
            raise RuntimeError(missing)
        request = json.loads(line)
        voice = request.get("voice") or "af_heart"
        # A voice's first letter is its language: a American, b British, e Spanish, f French...
        lang = voice[0]
        if lang not in pipelines:
            pipelines[lang] = KPipeline(lang_code=lang, device=device, repo_id="hexgrad/Kokoro-82M")
        if not request.get("text"):  # a warm-up: load the pipeline, say nothing
            reply({"bytes": 0})
            continue
        chunks = [np.asarray(audio, dtype=np.float32) for _, _, audio in pipelines[lang](request["text"], voice=voice)]
        buffer = io.BytesIO()
        sf.write(buffer, np.concatenate(chunks) if chunks else np.zeros(2400, np.float32), 24000, format="WAV", subtype="PCM_16")
        reply({"bytes": buffer.tell()}, buffer.getvalue())
    except Exception as error:
        reply({"error": str(error)})
