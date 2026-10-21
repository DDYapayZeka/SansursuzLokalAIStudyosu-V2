import sys
import os
import json
import re
import unicodedata
import traceback


def clean_text_for_ahenk(text: str) -> str:
    """Removes emojis, XML/HTML tags, and normalizes typography before sending to Ahenk normalizer."""
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


STYLE_ALIASES = {
    "neutral": "neutral",
    "dogal": "neutral",
    "notr": "neutral",
    "standart": "neutral",
    "cheerful": "cheerful",
    "neseli": "cheerful",
    "canli": "cheerful",
    "calm": "calm",
    "sakin": "calm",
    "dingin": "calm",
    "empathetic": "empathetic",
    "empatik": "empathetic",
    "sefkatli": "empathetic",
    "sad": "sad",
    "huzunlu": "sad",
    "duygusal": "sad",
    "surprised": "surprised",
    "saskin": "surprised",
    "heyecanli": "surprised",
    "angry": "angry",
    "ofkeli": "angry",
    "sert": "angry",
}

STYLE_DISPLAY_NAMES = {
    "neutral": "Dogal / Notr Ton",
    "cheerful": "Neseli ve Canli Ton",
    "calm": "Sakin ve Dingin Ton",
    "empathetic": "Empatik ve Sefkatli Ton",
    "sad": "Huzunlu ve Duygusal Ton",
    "surprised": "Saskin ve Heyecanli Ton",
    "angry": "Ofkeli ve Sert Ton",
}


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

        raw_style = str(payload.get("style") or payload.get("voice") or "neutral").strip().lower()
        # Clean prefix if provided (e.g. "ahenk_cheerful" -> "cheerful")
        if raw_style.startswith("ahenk_"):
            raw_style = raw_style[6:]
        style = STYLE_ALIASES.get(raw_style, "neutral")

        steps = int(payload.get("steps", 16))
        steps = max(4, min(32, steps))

        cfg = float(payload.get("cfg", 2.0))
        cfg = max(1.0, min(5.0, cfg))

        seed = int(payload.get("seed", 0))

        text = clean_text_for_ahenk(raw_text)
        if not text:
            text = "Merhaba"

        # Check HF token if available
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
        import soundfile as sf
        from huggingface_hub import snapshot_download

        # Ahenk Cep: 8.6M parameters, fast inference on CPU (and CUDA compatible)
        # Using CPU by default for ultra-lightweight ~0.15s RTF and zero VRAM impact,
        # or CUDA if requested and available.
        req_device = str(payload.get("device", "cpu")).strip().lower()
        if req_device == "cuda" and torch.cuda.is_available():
            device = "cuda"
        else:
            device = "cpu"

        weights_dir = snapshot_download("ozgurguler/ahenk-cep-tr", allow_patterns=["*.pt", "ahenk_cep.py"])
        if weights_dir not in sys.path:
            sys.path.insert(0, weights_dir)

        from ahenk_cep import AhenkCep

        student_path = os.path.join(weights_dir, "student.pt")
        decoder_path = os.path.join(weights_dir, "decoder.pt")

        try:
            tts = AhenkCep(student_path, decoder_path, device=device)
            audio, sr = tts.say(text, style=style, steps=steps, cfg=cfg, speed=user_speed, seed=seed)
        except Exception as device_err:
            if device != "cpu":
                sys.stderr.write(f"Notice: Ahenk fallback from {device} to CPU: {device_err}\n")
                device = "cpu"
                tts = AhenkCep(student_path, decoder_path, device="cpu")
                audio, sr = tts.say(text, style=style, steps=steps, cfg=cfg, speed=user_speed, seed=seed)
            else:
                raise device_err

        sf.write(out_path, audio, sr)

        duration = float(len(audio) / sr) if sr > 0 else 0.0
        voice_label = STYLE_DISPLAY_NAMES.get(style, style.capitalize())

        result = {
            "ok": True,
            "output": out_path,
            "sampleRate": sr,
            "duration": duration,
            "style": style,
            "voice": f"ahenk_{style}",
            "voiceName": f"Ahenk Cep ({voice_label})",
            "device": device
        }
        print(json.dumps(result), file=sys.stdout)

    except Exception as e:
        sys.stderr.write(traceback.format_exc() + "\n")
        print(json.dumps({"ok": False, "error": str(e)}), file=sys.stdout)
        sys.exit(1)


if __name__ == "__main__":
    main()
