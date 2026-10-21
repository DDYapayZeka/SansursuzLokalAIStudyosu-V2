import sys
import os
import json
import time

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

        raw_input = raw_bytes.decode("utf-8", errors="replace")
        payload = json.loads(raw_input)

        wav_path = payload.get("wavPath")
        if not wav_path or not os.path.exists(wav_path):
            print(json.dumps({"ok": False, "error": f"WAV file not found: {wav_path}"}), file=sys.stdout)
            return

        root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
        model_dir = payload.get("modelDir") or os.path.join(root_dir, "app", "speech-models", "duyu-small")
        if not os.path.exists(model_dir):
            print(json.dumps({"ok": False, "error": f"Duyu model directory not found: {model_dir}"}), file=sys.stdout)
            return

        sys.path.insert(0, model_dir)
        from duyu_small import DuyuSmall
        from duyu_small.audio import load_audio

        lang = str(payload.get("language", "tr")).strip().lower()
        if lang in ["auto", "tr", "turkish"]:
            lang = "tr"
        elif lang in ["en", "english"]:
            lang = "en"
        else:
            lang = "mix"

        quant = str(payload.get("quant", "int8")).strip()
        threads = int(payload.get("threads", 4))
        beam = int(payload.get("beam", 5))

        t0 = time.time()
        m = DuyuSmall(model_dir, quant=quant, threads=threads, beam=beam)
        audio = load_audio(wav_path)
        
        text = m.transcribe(audio, lang=lang)
        dur_ms = int((time.time() - t0) * 1000)
        total_sec = max(1.0, len(audio) / 16000.0)

        def fmt_ts(sec):
            ms = int(round((sec - int(sec)) * 1000))
            s = int(sec) % 60
            mi = (int(sec) // 60) % 60
            hr = int(sec) // 3600
            return f"{hr:02d}:{mi:02d}:{s:02d},{ms:03d}"

        words = [w for w in str(text or "").strip().split() if w]
        segments = []
        if words:
            chunk_size = 6
            chunks = [words[i:i + chunk_size] for i in range(0, len(words), chunk_size)]
            total_words = len(words)
            cur_word_idx = 0
            for ch in chunks:
                start_s = (cur_word_idx / total_words) * total_sec
                end_s = ((cur_word_idx + len(ch)) / total_words) * total_sec
                cur_word_idx += len(ch)
                segments.append({
                    "timestamps": {
                        "from": fmt_ts(start_s),
                        "to": fmt_ts(end_s)
                    },
                    "offsets": {
                        "from": int(start_s * 1000),
                        "to": int(end_s * 1000)
                    },
                    "text": " ".join(ch)
                })
        else:
            segments.append({
                "timestamps": {
                    "from": "00:00:00,000",
                    "to": fmt_ts(total_sec)
                },
                "text": text
            })

        result = {
            "ok": True,
            "text": text,
            "durationMs": dur_ms,
            "audioDurationS": round(total_sec, 2),
            "engine": "duyu-small",
            "lang": lang,
            "raw": {
                "transcription": segments
            }
        }
        print(json.dumps(result, ensure_ascii=False), file=sys.stdout)

    except Exception as e:
        err = f"{type(e).__name__}: {str(e)}"
        print(json.dumps({"ok": False, "error": err}), file=sys.stdout)

if __name__ == "__main__":
    main()
