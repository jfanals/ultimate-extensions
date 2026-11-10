# Parakeet v3 speech to text, run by worker.ts as one warm process: one JSON request per stdin line,
# {"path": "/tmp/recording.webm"} (any format ffmpeg reads); each answered on stdout by a JSON header line,
# {"bytes": N} then N bytes of UTF-8 text, or {"error": "..."}. An empty path only loads the model.
import json, os, sys

out = os.fdopen(os.dup(1), "wb")
os.dup2(2, 1)  # libraries that print must not corrupt the protocol
MODEL = "mlx-community/parakeet-tdt-0.6b-v3"
# Long recordings go in 2-minute chunks, overlapped by 15 s and merged by parakeet-mlx: in one piece, attention over
# 19 minutes of speech peaked at 34.5 GB and 30 minutes killed the worker; chunked, 19 minutes takes 3.4 GB and half
# the time. Shorter audio is transcribed whole either way.
CHUNK = {"chunk_duration": 120.0, "overlap_duration": 15.0}
try:
    import mlx.core as mx
    # MLX keeps freed buffers for reuse; uncapped that is 2.7 GB on top of the 1.2 GB model, for ~0.1 s per request.
    mx.set_cache_limit(0)
    from parakeet_mlx import from_pretrained
except Exception as error:  # reported per request, so the host can say what is missing
    missing = f"parakeet-mlx is not installed for {sys.executable}: {error}"
else:
    missing = None
model = None

def reply(header, data=b""):
    out.write((json.dumps(header) + "\n").encode())
    out.write(data)
    out.flush()

for line in sys.stdin:
    try:
        if missing:
            raise RuntimeError(missing)
        request = json.loads(line)
        if model is None:
            model = from_pretrained(MODEL)
        text = model.transcribe(request["path"], **CHUNK).text.strip().encode() if request.get("path") else b""
        reply({"bytes": len(text)}, text)
    except Exception as error:
        reply({"error": str(error)})
