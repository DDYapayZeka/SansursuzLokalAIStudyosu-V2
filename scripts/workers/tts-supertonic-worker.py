import sys
import os
import json
import traceback

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
        raw_text = str(payload.get("text", "")).strip()
        if not raw_text:
            print(json.dumps({"ok": False, "error": "Text is empty."}), file=sys.stdout)
            return

        out_path = payload.get("output")
        if not out_path:
            print(json.dumps({"ok": False, "error": "Output path is required."}), file=sys.stdout)
            return

        os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)

        speed = float(payload.get("speed", 1.05))
        speed = max(0.5, min(2.0, speed))
        voice_raw = str(payload.get("voice", "M1")).strip()

        # Map voice names to Supertonic 3 styles (M1..M5, F1..F5)
        voice_map = {
            "m1": "M1", "m2": "M2", "m3": "M3", "m4": "M4", "m5": "M5",
            "f1": "F1", "f2": "F2", "f3": "F3", "f4": "F4", "f5": "F5",
            "supertonic_m1": "M1", "supertonic_m2": "M2", "supertonic_m3": "M3", "supertonic_m4": "M4", "supertonic_m5": "M5",
            "supertonic_f1": "F1", "supertonic_f2": "F2", "supertonic_f3": "F3", "supertonic_f4": "F4", "supertonic_f5": "F5",
            "supertonic_natural": "M1", "supertonic_erkek": "M1", "supertonic_kadin": "F1",
            "erkek": "M1", "kadin": "F1"
        }
        voice_key = voice_map.get(voice_raw.lower(), voice_raw.upper())
        if voice_key not in ["M1", "M2", "M3", "M4", "M5", "F1", "F2", "F3", "F4", "F5"]:
            voice_key = "M1"

        lang = str(payload.get("lang", "tr")).strip().lower()

        # Load Supertonic TTS
        root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
        local_model_dir = os.path.join(root_dir, "app", "tts-models", "supertonic-3")
        cache_dir = os.path.expanduser("~/.cache/supertonic3")

        model_dir = local_model_dir if os.path.exists(local_model_dir) else cache_dir

        from supertonic import TTS
        tts = TTS(model_dir=model_dir, auto_download=False)
        style = tts.get_voice_style(voice_name=voice_key)

        wav, duration = tts.synthesize(
            text=raw_text,
            voice_style=style,
            speed=speed,
            lang=lang,
            total_steps=8
        )

        tts.save_audio(wav, out_path)

        dur_val = float(duration[0]) if hasattr(duration, "__iter__") else float(duration)

        result = {
            "ok": True,
            "output": out_path,
            "sampleRate": 44100,
            "duration": dur_val,
            "voice": voice_key,
            "lang": lang
        }
        print(json.dumps(result), file=sys.stdout)

    except Exception as e:
        sys.stderr.write(traceback.format_exc() + "\n")
        print(json.dumps({"ok": False, "error": str(e)}), file=sys.stdout)
        sys.exit(1)

if __name__ == "__main__":
    main()
