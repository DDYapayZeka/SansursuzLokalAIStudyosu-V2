import sys
import os
import json
import traceback

def emit_progress(phase: str, progress: int, step: int = 0, total: int = 0):
    try:
        msg = json.dumps({
            "phase": phase,
            "progress": max(0, min(100, int(progress))),
            "step": int(step),
            "total": int(total)
        }, ensure_ascii=False)
        sys.stderr.write(f"@@PROGRESS {msg}\n")
        sys.stderr.flush()
    except Exception:
        pass

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

        ref_audio = payload.get("ref_audio")
        if ref_audio:
            ref_audio = str(ref_audio).strip()
            if not os.path.exists(ref_audio):
                ref_audio = None

        ref_text = payload.get("ref_text")
        if ref_text:
            ref_text = str(ref_text).strip()
            if not ref_text:
                ref_text = None

        instruct = payload.get("instruct")
        if instruct:
            instruct = str(instruct).strip()
            if not instruct:
                instruct = None

        lang = str(payload.get("lang", "tr")).strip().lower()
        if not lang:
            lang = "tr"

        speed = float(payload.get("speed", 1.0))
        speed = max(0.5, min(2.0, speed))

        root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

        # Safeguard: If reference audio is excessively long (>15s), trim to first 10s to prevent
        # cross-attention memory blowup, whisper stalls, and runaway CPU/GPU execution.
        if ref_audio and os.path.exists(ref_audio):
            try:
                import soundfile as sf
                info = sf.info(ref_audio)
                if info.duration > 15.0:
                    sys.stderr.write(f"Notice: Trimming long reference audio ({info.duration:.1f}s) to first 10.0s for optimal voice cloning.\n")
                    data, sr = sf.read(ref_audio, frames=int(10.0 * info.samplerate))
                    trimmed_name = f".trimmed_{os.path.basename(ref_audio)}"
                    trimmed_path = os.path.join(os.path.dirname(ref_audio), trimmed_name)
                    sf.write(trimmed_path, data, sr)
                    ref_audio = trimmed_path
            except Exception as te:
                sys.stderr.write(f"Notice: Audio trim check skipped: {te}\n")

        # If reference audio is provided but reference text is blank,
        # auto-transcribe accurately using faster-whisper (local offline model, 0.8s),
        # ensuring OmniVoice prompt cross-attention has zero text-audio mismatch.
        if ref_audio:
            emit_progress("Referans ses analiz ediliyor...", 15)

        if ref_audio and not ref_text:
            # Check cached transcript file first
            cache_txt = ref_audio + ".txt"
            if os.path.exists(cache_txt):
                try:
                    ref_text = open(cache_txt, "r", encoding="utf-8").read().strip()
                except Exception:
                    pass

            if not ref_text:
                # Check transcriptions directory
                base_name = os.path.basename(ref_audio)
                tr_dir = os.path.join(root_dir, "app", "transcriptions")
                if os.path.isdir(tr_dir):
                    for fn in os.listdir(tr_dir):
                        if fn.endswith(base_name + ".txt") or fn.endswith(base_name):
                            try:
                                ref_text = open(os.path.join(tr_dir, fn), "r", encoding="utf-8").read().strip()
                                if ref_text:
                                    break
                            except Exception:
                                pass

            if not ref_text:
                try:
                    emit_progress("Referans ses transkripsiyonu yapılıyor...", 25)
                    from faster_whisper import WhisperModel
                    w_model = WhisperModel("base", device="cpu", compute_type="int8")
                    segs, _ = w_model.transcribe(ref_audio, language=lang)
                    ref_text = " ".join(s.text.strip() for s in segs).strip()
                    if ref_text:
                        try:
                            with open(cache_txt, "w", encoding="utf-8") as f:
                                f.write(ref_text)
                        except Exception:
                            pass
                except Exception as we:
                    sys.stderr.write(f"Notice: Offline ASR failed: {we}\n")

            if not ref_text:
                ref_text = "Merhaba, bu ses örneğidir."

        # Locate the weights: app/tts-models/omnivoice (Model Hub download) or any HF cache snapshot.
        snapshot_dir = None
        local_dir = os.path.join(root_dir, "app", "tts-models", "omnivoice")
        if os.path.exists(os.path.join(local_dir, "model.safetensors")):
            snapshot_dir = local_dir
        else:
            snap_root = os.path.expanduser("~/.cache/huggingface/hub/models--k2-fsa--OmniVoice/snapshots")
            if os.path.isdir(snap_root):
                for name in os.listdir(snap_root):
                    cand = os.path.join(snap_root, name)
                    weights = os.path.join(cand, "model.safetensors")
                    if os.path.exists(weights) and os.path.getsize(weights) >= 2_000_000_000:
                        snapshot_dir = cand
                        break
        if not snapshot_dir:
            print(json.dumps({"ok": False, "error": "OmniVoice model ağırlıkları bulunamadı. Model Merkezi > TTS'ten OmniVoice'u indirin."}), file=sys.stdout)
            return

        # Load HF token if available
        token_path = os.path.join(root_dir, "app", "config", "hf-token.txt")
        if os.path.exists(token_path):
            try:
                hf_token = open(token_path, "r", encoding="utf-8").read().strip()
                if hf_token:
                    os.environ["HF_TOKEN"] = hf_token
            except Exception:
                pass

        emit_progress("OmniVoice yapay zekâ modeli yükleniyor...", 40)

        import torch
        import soundfile as sf
        import numpy as np
        from omnivoice.models.omnivoice import OmniVoice
        from omnivoice.utils.common import get_best_device

        device = get_best_device()
        dtype = torch.float16 if device == "cuda" else torch.float32

        if device == "cpu":
            try:
                phys_cores = max(4, (os.cpu_count() or 8) // 2)
                torch.set_num_threads(phys_cores)
            except Exception:
                pass

        raw_step = payload.get("num_step")
        if raw_step is None or int(raw_step) <= 0:
            default_step = 16 if device == "cpu" else 24
        else:
            default_step = int(raw_step)
            if device == "cpu" and default_step == 32:
                default_step = 16
        num_step = max(8, min(64, default_step))

        # Use the local snapshot path directly to avoid network checks and snapshot download stalls
        model_id = snapshot_dir

        # Load OmniVoice model offline
        emit_progress("OmniVoice temel ağırlıkları hazırlanıyor...", 55)
        model = OmniVoice.from_pretrained(
            model_id,
            device_map=device,
            dtype=dtype
        )

        gen_kwargs = {
            "text": raw_text,
            "language": lang,
            "speed": speed,
            "num_step": num_step,
            "guidance_scale": float(payload.get("guidance_scale", 2.0)),
            "denoise": True,
            "postprocess_output": True,
        }

        if ref_audio:
            gen_kwargs["ref_audio"] = ref_audio
            if ref_text:
                gen_kwargs["ref_text"] = ref_text
        elif instruct:
            gen_kwargs["instruct"] = instruct

        emit_progress("Zero-Shot ses klonlama sentezleniyor...", 75)
        with torch.inference_mode():
            audios = model.generate(**gen_kwargs)

        if not audios or len(audios) == 0:
            print(json.dumps({"ok": False, "error": "OmniVoice produced empty audio output."}), file=sys.stdout)
            return

        emit_progress("WAV ses dosyası kodlanıyor...", 95)
        sampling_rate = getattr(model, "sampling_rate", 24000)
        audio_arr = np.clip(audios[0], -1.0, 1.0)
        sf.write(out_path, audio_arr, sampling_rate, subtype="PCM_16")
        emit_progress("Tamamlandı", 100)

        duration = float(len(audio_arr)) / float(sampling_rate)

        result = {
            "ok": True,
            "output": out_path,
            "sampleRate": sampling_rate,
            "duration": duration,
            "mode": "voice_clone" if ref_audio else ("voice_design" if instruct else "auto"),
            "lang": lang
        }
        print(json.dumps(result), file=sys.stdout)

    except Exception as e:
        sys.stderr.write(traceback.format_exc() + "\n")
        print(json.dumps({"ok": False, "error": str(e)}), file=sys.stdout)
        sys.exit(1)

if __name__ == "__main__":
    main()
