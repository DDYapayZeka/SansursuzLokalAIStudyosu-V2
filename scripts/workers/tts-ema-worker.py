import sys
import os
import json
import re
import unicodedata
import traceback


def clean_text_for_ema(text: str) -> str:
    """Removes emojis, XML/HTML tags, and normalizes typography so normalizer_tr receives clean Turkish text."""
    text = re.sub(r"<[^>]+>", " ", text)
    text = text.replace("\u2103", " derece ")
    text = text.replace("\u00b0", " derece ")
    text = text.replace("%", " y\u00fczde ")
    text = text.replace("\u2022", " ")
    text = text.replace("\u2013", "-")
    text = text.replace("\u2014", "-")
    text = text.replace("\u2019", "'").replace("\u2018", "'").replace("\u201c", '"').replace("\u201d", '"')
    text = re.sub(r"[\u200B-\u200F\uFE00-\uFE0F\u200D\u00A0]", " ", text)
    cleaned = []
    for ch in text:
        cat = unicodedata.category(ch)
        if cat in ("So", "Sk", "Cs", "Cn", "Co"):
            cleaned.append(" ")
        else:
            cleaned.append(ch)
    text = "".join(cleaned)
    return re.sub(r"\s+", " ", text).strip()


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
        voice = str(payload.get("voice", "ema_kadin")).strip().lower()

        text = clean_text_for_ema(raw_text)
        if not text:
            text = "Merhaba"

        # Load HF token if available
        root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
        token_path = os.path.join(root_dir, "app", "config", "hf-token.txt")
        if os.path.exists(token_path):
            try:
                hf_token = open(token_path, "r", encoding="utf-8").read().strip()
                if hf_token:
                    os.environ["HF_TOKEN"] = hf_token
            except Exception:
                pass

        import torch
        device = "cuda" if torch.cuda.is_available() else "cpu"

        is_male = voice in ("ema_erkek", "erkek", "male", "tr_cem", "tr_ahmet", "dfki_fahrettin")

        # If male voice is selected under EMA Lightning, route to native 48kHz Turkish Male model (Antalia)
        # instead of destructive STFT pitch shifting which causes metallic/robotic phase artifacts.
        if is_male:
            try:
                from antalia_mini import Antalia
                tts_male = Antalia()
                speech = tts_male.say(text, path=out_path, speed=user_speed)
                result = {
                    "ok": True,
                    "output": out_path,
                    "sampleRate": getattr(speech, "sample_rate", 48000),
                    "duration": float(getattr(speech, "duration", 0.0)),
                    "voice": voice,
                    "device": device
                }
                print(json.dumps(result), file=sys.stdout)
                return
            except Exception as male_err:
                sys.stderr.write(f"Notice: Native Antalia male synthesis fallback to EMA: {male_err}\n")

        # Natural cadence profiles for EMA 48kHz studio female voice (no destructive pitch shifting)
        cadence_mult = {
            "ema_kadin": 1.0,
            "ema_genc": 1.06,
            "ema_sakin": 0.92,
            "ema_haber": 1.08,
        }.get(voice, 1.0)
        effective_speed = max(0.5, min(2.0, user_speed * cadence_mult))

        import ema_lightning.frontend
        ema_lightning.frontend.POLICY = "preserve"

        from ema_lightning import EMA
        from ema_lightning.audio import write_wav
        tts = EMA(device=device)

        if device == "cuda":
            try:
                tts = tts.lightning()
            except Exception as e:
                sys.stderr.write(f"Notice: Lightning compilation skipped: {e}\n")

        speech = tts.say(text, speed=effective_speed, sample_rate=48000)
        write_wav(out_path, speech.audio, 48000)

        result = {
            "ok": True,
            "output": out_path,
            "sampleRate": 48000,
            "duration": float(getattr(speech, "duration", 0.0)),
            "voice": voice,
            "device": device
        }
        print(json.dumps(result), file=sys.stdout)

    except Exception as e:
        sys.stderr.write(traceback.format_exc() + "\n")
        print(json.dumps({"ok": False, "error": str(e)}), file=sys.stdout)
        sys.exit(1)


if __name__ == "__main__":
    main()
