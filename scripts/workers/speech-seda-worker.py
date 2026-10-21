import sys
import os
import json
import time

# Seda-v0.2 (atasoglu/seda-v0.2, CC BY-SA 4.0) through sedalib: Zipformer2 transducer on sherpa-onnx.
# The whole file is known up front, so the model's Silero VAD first splits it into speech regions
# with exact sample positions; each region is then decoded on its own. This gives real subtitle
# timestamps, and words are never split between two segments (the streaming endpoint detector
# reacts about a second late, which cuts into the next sentence after short pauses).

VAD_RATE = 16000
MIN_SILENCE_SECONDS = 0.35   # a pause at least this long ends a speech region
MIN_SPEECH_SECONDS = 0.2     # shorter blips are ignored
PAD_BEFORE_SECONDS = 0.6     # context kept before each region
PAD_AFTER_SECONDS = 0.25     # and after it
MAX_REGION_SECONDS = 20.0    # longer regions are split at their quietest point


def fmt_ts(sec):
    sec = max(0.0, sec)
    ms = int(round((sec - int(sec)) * 1000))
    if ms == 1000:
        sec, ms = int(sec) + 1, 0
    s = int(sec) % 60
    mi = (int(sec) // 60) % 60
    hr = int(sec) // 3600
    return f"{hr:02d}:{mi:02d}:{s:02d},{ms:03d}"


def speech_regions(np, x, vad_path, threads):
    """[(start, end)] sample ranges of speech in 16 kHz mono audio."""
    import sherpa_onnx

    vad = sherpa_onnx.VadModel.create(
        sherpa_onnx.VadModelConfig(
            silero_vad=sherpa_onnx.SileroVadModelConfig(model=vad_path, threshold=0.5),
            sample_rate=VAD_RATE,
            num_threads=min(2, threads),
        )
    )
    w = vad.window_size()
    flags = [vad.is_speech(x[i:i + w].tolist()) for i in range(0, len(x) - w + 1, w)]

    min_silence = max(1, round(MIN_SILENCE_SECONDS * VAD_RATE / w))
    min_speech = max(1, round(MIN_SPEECH_SECONDS * VAD_RATE / w))
    runs, start, quiet = [], None, 0
    for i, speech in enumerate(flags):
        if speech:
            if start is None:
                start = i
            quiet = 0
        elif start is not None:
            quiet += 1
            if quiet >= min_silence:
                runs.append((start, i - quiet + 1))
                start, quiet = None, 0
    if start is not None:
        runs.append((start, len(flags) - quiet))
    runs = [(a * w, b * w) for a, b in runs if b - a >= min_speech]

    # Split overlong regions at the lowest-energy 100 ms frame in their second half.
    limit = int(MAX_REGION_SECONDS * VAD_RATE)
    frame = VAD_RATE // 10
    out = []
    for a, b in runs:
        while b - a > limit:
            lo, hi = a + limit // 2, a + limit
            energies = [float(np.mean(x[i:i + frame] ** 2)) for i in range(lo, hi - frame, frame)]
            cut = lo + int(np.argmin(energies)) * frame + frame // 2 if energies else hi
            out.append((a, cut))
            a = cut
        out.append((a, b))

    # Silero flags speech onsets ~0.3 s late, so more context is kept before a region than after.
    # Pads share the gap between neighbours and never overlap, so no word is decoded twice.
    before, after = int(PAD_BEFORE_SECONDS * VAD_RATE), int(PAD_AFTER_SECONDS * VAD_RATE)
    padded = []
    prev_end = 0
    for i, (a, b) in enumerate(out):
        next_start = out[i + 1][0] if i + 1 < len(out) else len(x)
        start = max(prev_end, a - before)
        gap_after = next_start - b
        end = min(len(x), b + min(after, gap_after // 3))
        padded.append((start, end))
        prev_end = end
    return padded


def split_sentences(text, start_s, end_s):
    """One subtitle per sentence: a region's time is shared by the sentences' character counts."""
    import re

    sentences = [s for s in re.split(r"(?<=[.?!])\s+", text) if s]
    if len(sentences) < 2:
        return [(text, start_s, end_s)]
    total = sum(len(s) for s in sentences)
    out, t = [], start_s
    for s in sentences:
        dt = (end_s - start_s) * len(s) / total
        out.append((s, t, t + dt))
        t += dt
    return out


def main():
    try:
        if hasattr(sys.stdin, "reconfigure"):
            sys.stdin.reconfigure(encoding="utf-8")
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8")

        raw_bytes = sys.stdin.buffer.read()
        if not raw_bytes.strip():
            print(json.dumps({"ok": False, "error": "No JSON payload provided to worker."}), file=sys.stdout)
            return

        payload = json.loads(raw_bytes.decode("utf-8", errors="replace"))

        wav_path = payload.get("wavPath")
        if not wav_path or not os.path.exists(wav_path):
            print(json.dumps({"ok": False, "error": f"WAV file not found: {wav_path}"}), file=sys.stdout)
            return

        root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
        model_dir = payload.get("modelDir") or os.path.join(root_dir, "app", "speech-models", "seda-v0.2")
        if not os.path.exists(os.path.join(model_dir, "tokens.txt")):
            print(json.dumps({"ok": False, "error": f"Seda model directory not found: {model_dir}"}), file=sys.stdout)
            return

        import numpy as np
        from sedalib import Recognizer, read_wav

        mode = str(payload.get("mode", "accurate")).strip().lower()
        if mode not in ("fast", "balanced", "accurate"):
            mode = "accurate"
        threads = max(1, int(payload.get("threads", 4)))
        punctuate = bool(payload.get("punctuate", True)) and os.path.exists(os.path.join(model_dir, "formatter", "formatter.int8.onnx"))

        t0 = time.time()
        recognizer = Recognizer(model_dir, mode=mode, punctuate=punctuate, num_threads=threads, vad=False)
        samples, sample_rate = read_wav(wav_path)
        x = np.asarray(samples, dtype=np.float32)
        if sample_rate != VAD_RATE and len(x):
            # The server already converts uploads to 16 kHz mono; this only covers direct calls.
            n = int(round(len(x) * VAD_RATE / sample_rate))
            x = np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)
            sample_rate = VAD_RATE
        total_sec = max(0.01, len(x) / float(VAD_RATE))

        vad_path = os.path.join(model_dir, "vad", "silero_vad.onnx")
        if os.path.exists(vad_path):
            regions = speech_regions(np, x, vad_path, threads)
        else:
            step = int(MAX_REGION_SECONDS * VAD_RATE)
            regions = [(a, min(len(x), a + step)) for a in range(0, len(x), step)]

        segments = []
        for a, b in regions:
            text = recognizer.transcribe(x[a:b], VAD_RATE).strip()
            if text:
                segments.extend(split_sentences(text, a / VAD_RATE, b / VAD_RATE))

        transcription = [
            {
                "timestamps": {"from": fmt_ts(start_s), "to": fmt_ts(end_s)},
                "offsets": {"from": int(start_s * 1000), "to": int(end_s * 1000)},
                "text": text,
            }
            for text, start_s, end_s in segments
        ]

        result = {
            "ok": True,
            "text": " ".join(t for t, _, _ in segments),
            "durationMs": int((time.time() - t0) * 1000),
            "audioDurationS": round(total_sec, 2),
            "engine": "seda-v0.2",
            "lang": "tr",
            "mode": mode,
            "punctuated": punctuate,
            "raw": {"transcription": transcription},
        }
        print(json.dumps(result, ensure_ascii=False), file=sys.stdout)

    except Exception as e:
        print(json.dumps({"ok": False, "error": f"{type(e).__name__}: {str(e)}"}), file=sys.stdout)


if __name__ == "__main__":
    main()
