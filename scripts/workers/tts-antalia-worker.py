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

        user_speed = float(payload.get("speed", 1.0))
        user_speed = max(0.5, min(2.0, user_speed))
        voice = str(payload.get("voice", "antalia_dogal")).strip().lower()

        # Antalia Mini is a high-fidelity 48kHz Flow-Matching Turkish male model.
        # Artificial pitch shifting destroys vocal tract formants and causes robotic artifacts.
        # We use natural speech cadence profiles without destructive pitch manipulation:
        voice_profiles = {
            "antalia_dogal": {"speed_mult": 1.0, "name": "Antalia Doğal Erkek Sesi (48kHz Orijinal Stüdyo)"},
            "antalia_erkek": {"speed_mult": 1.0, "name": "Antalia Doğal Erkek Sesi (48kHz Orijinal Stüdyo)"},
            "antalia_tok": {"speed_mult": 0.94, "name": "Antalia Sakin & Tok Anlatıcı (Doğal Tını)"},
            "antalia_akici": {"speed_mult": 1.08, "name": "Antalia Akıcı Haber Spikeri (Dinamik Hız)"},
            "antalia_sicak": {"speed_mult": 0.96, "name": "Antalia Samimi Anlatıcı (Doğal Tını)"},
            "antalia_genc": {"speed_mult": 1.05, "name": "Antalia Genç Karakter (Akıcı Hız)"},
        }

        profile = voice_profiles.get(voice, voice_profiles["antalia_dogal"])
        calc_speed = max(0.5, min(2.0, user_speed * profile["speed_mult"]))

        # Load token if available to prevent HF warning
        root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
        token_path = os.path.join(root_dir, "app", "config", "hf-token.txt")
        if os.path.exists(token_path):
            try:
                hf_token = open(token_path, "r", encoding="utf-8").read().strip()
                if hf_token:
                    os.environ["HF_TOKEN"] = hf_token
            except Exception:
                pass

        from antalia_mini import Antalia
        import soundfile as sf
        import numpy as np

        tts = Antalia()
        speech = tts.say(raw_text, path=out_path, speed=calc_speed)
        duration = float(getattr(speech, "duration", 0.0))
        sr = getattr(speech, "sample_rate", 48000)

        result = {
            "ok": True,
            "output": out_path,
            "sampleRate": sr,
            "duration": duration,
            "voice": voice,
            "voiceName": profile["name"],
            "lang": "tr"
        }
        print(json.dumps(result), file=sys.stdout)

    except Exception as e:
        sys.stderr.write(traceback.format_exc() + "\n")
        print(json.dumps({"ok": False, "error": str(e)}), file=sys.stdout)
        sys.exit(1)

if __name__ == "__main__":
    main()
