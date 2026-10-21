import sys
import os
import json
import time
import random
import traceback
import importlib.util

# Stable Audio 3 (Stability AI) music and sound effect generation with the stable-audio-3 package.
# Models are loaded from app/music-models/<folder> (downloaded by the app, gated on Hugging Face),
# including the bundled T5Gemma text encoder, so nothing is fetched into the user's HF cache.

MODELS = {
    "stable-audio-3-small-music": {"folder": "stable-audio-3-small-music", "name": "Stable Audio 3 Small Music", "max": 120, "sfx": False, "gpu_only": False},
    "stable-audio-3-small-sfx": {"folder": "stable-audio-3-small-sfx", "name": "Stable Audio 3 Small SFX", "max": 120, "sfx": True, "gpu_only": False},
    "stable-audio-3-medium": {"folder": "stable-audio-3-medium", "name": "Stable Audio 3 Medium", "max": 300, "sfx": False, "gpu_only": True},
}
STEPS = 8  # the models are adversarially post-trained for 8-step sampling


def load_music_worker_helpers():
    """The Turkish prompt translation and the progress protocol are shared with music-worker.py."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "music-worker.py")
    spec = importlib.util.spec_from_file_location("ddyz_music_worker", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def use_local_text_encoder(node, encoder_dir):
    """Point every T5Gemma conditioner at the bundled encoder folder instead of the Hub."""
    if isinstance(node, dict):
        if node.get("type") == "t5gemma" and isinstance(node.get("config"), dict):
            cfg = node["config"]
            cfg["model_path"] = encoder_dir
            cfg.pop("repo_id", None)
            cfg.pop("subfolder", None)
        for value in node.values():
            use_local_text_encoder(value, encoder_dir)
    elif isinstance(node, list):
        for value in node:
            use_local_text_encoder(value, encoder_dir)


def main():
    helpers = load_music_worker_helpers()
    emit_progress = helpers.emit_progress
    try:
        if hasattr(sys.stdin, "reconfigure"):
            sys.stdin.reconfigure(encoding="utf-8")
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8")
        if hasattr(sys.stderr, "reconfigure"):
            sys.stderr.reconfigure(encoding="utf-8")

        payload = json.loads(sys.stdin.buffer.read().decode("utf-8", errors="replace") or "{}")
        raw_prompt = str(payload.get("prompt", "")).strip()
        out_path = payload.get("output")
        if not raw_prompt or not out_path:
            print(json.dumps({"ok": False, "error": "Prompt and output path are required."}), file=sys.stdout)
            sys.exit(1)

        model_id = str(payload.get("model", "")).strip().lower()
        spec = MODELS.get(model_id)
        if not spec:
            print(json.dumps({"ok": False, "error": f"Unknown Stable Audio model: {model_id}"}), file=sys.stdout)
            sys.exit(1)

        root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
        model_dir = os.path.join(root_dir, "app", "music-models", spec["folder"])
        config_path = os.path.join(model_dir, "model_config.json")
        ckpt_path = os.path.join(model_dir, "model.safetensors")
        encoder_dir = os.path.join(model_dir, "t5gemma-b-b-ul2")
        if not (os.path.exists(config_path) and os.path.exists(ckpt_path) and os.path.isdir(encoder_dir)):
            raise RuntimeError(f"{spec['name']} dosyaları bulunamadı ({model_dir}). Model Merkezi > Müzik bölümünden indirin.")

        duration = max(2, min(spec["max"], int(payload.get("duration", 10))))
        seed = payload.get("seed", None)
        if seed is None or int(seed) < 0:
            seed = random.randint(100000, 99999999)
        seed = int(seed)
        is_sfx = spec["sfx"] or str(payload.get("mode", "")).lower() == "sfx"

        emit_progress(f"{spec['name']} hazırlanıyor...", 5, 0, STEPS)

        # stable-audio-3 wraps flex_attention in torch.compile, which needs Triton. Without it (Windows),
        # every call first fails to compile and then falls back; run it uncompiled from the start.
        if importlib.util.find_spec("triton") is None:
            os.environ.setdefault("TORCHDYNAMO_DISABLE", "1")

        import torch
        import numpy as np
        import soundfile as sf
        from stable_audio_3.loading_utils import load_diffusion_cond
        from stable_audio_3.model import StableAudioModel

        device = "cuda" if torch.cuda.is_available() else "cpu"
        if spec["gpu_only"] and device != "cuda":
            raise RuntimeError(f"{spec['name']} NVIDIA (CUDA) ekran kartı gerektirir. İşlemcide Stable Audio 3 Small modellerini kullanın.")
        model_half = device == "cuda"

        with open(config_path, "r", encoding="utf-8") as f:
            model_config = json.load(f)
        use_local_text_encoder(model_config, encoder_dir)

        t0 = time.time()
        emit_progress(f"{spec['name']} yükleniyor...", 12, 0, STEPS)
        model = load_diffusion_cond(model_config, ckpt_path, device=device, model_half=model_half)
        model.use_lora = False
        model.lora_names = []
        sa = StableAudioModel(model, model_config, device, model_half)
        sys.stderr.write(f"Notice: {spec['name']} loaded on {device} in {time.time() - t0:.1f}s\n")

        # T5Gemma reads English; Turkish music/SFX terms are translated like in music-worker.py.
        effective_prompt = helpers.translate_and_enrich_prompt(raw_prompt, is_sfx, enrich=False)

        def on_step(info):
            i = int(info.get("i", 0)) + 1
            emit_progress(f"Ses sentezleniyor (adım {i}/{STEPS})...", 20 + int(70 * i / STEPS), i, STEPS)

        start = time.time()
        emit_progress("Ses sentezleniyor...", 20, 0, STEPS)
        audio = sa.generate(prompt=effective_prompt, duration=duration, steps=STEPS, seed=seed, callback=on_step)
        elapsed = time.time() - start

        emit_progress("Ses dosyası kaydediliyor...", 96, STEPS, STEPS)
        sample_rate = int(model_config.get("sample_rate", 44100))
        data = audio[0].to(torch.float32).cpu().numpy().T  # (samples, channels)
        peak = float(np.max(np.abs(data))) if data.size else 0.0
        if peak > 0.001:
            data = data / peak * 0.95
        if peak <= 0.001:
            raise RuntimeError(f"{spec['name']} bu istem için sessiz bir çıktı üretti. İstemi değiştirip tekrar deneyin.")
        os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
        sf.write(out_path, np.clip(data, -1.0, 1.0), sample_rate, subtype="PCM_16")
        emit_progress("Tamamlandı", 100, STEPS, STEPS)

        print(json.dumps({
            "ok": True,
            "output": out_path,
            "duration": duration,
            "sampleRate": sample_rate,
            "channels": int(data.shape[1]) if data.ndim == 2 else 1,
            "seed": seed,
            "model": model_id,
            "effectivePrompt": effective_prompt,
            "genDuration": f"{elapsed:.1f}s",
            "isSfx": is_sfx,
        }, ensure_ascii=False), file=sys.stdout)

    except Exception as e:
        sys.stderr.write(traceback.format_exc() + "\n")
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False), file=sys.stdout)
        sys.exit(1)


if __name__ == "__main__":
    main()
