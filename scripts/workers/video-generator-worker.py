"""
DD:YZ Multi-Tier AI Video Generation Worker

Three Hardware Tiers:
  - Low Tier (<= 6 GB VRAM)              : AnimateDiff Realistic Vision (v1.5 v2) / 512x512 16 frames
  - Mid Tier (<= 16 GB VRAM)             : Alibaba Wan 2.1 1.3B (T2V) & Stable Video Diffusion XT 1.1 (I2V)
  - High Tier (24 GB+ / 64 GB RAM Offload): Alibaba Wan 2.1 14B (T2V) with CPU Offload & 64 GB RAM

Zero-emoji enterprise logging.
Progress lines: @@PROGRESS {"phase": "...", "step": n, "total": m}
"""
import sys
import os
import io
import json
import time
import base64
import subprocess
import traceback

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
VIDEO_MODELS = os.path.join(ROOT, "app", "video-models")
WAN_DIR = os.path.join(VIDEO_MODELS, "wan21-t2v-1.3b")
WAN14_DIR = os.path.join(VIDEO_MODELS, "wan21-t2v-14b")
SVD_DIR = os.path.join(VIDEO_MODELS, "svd-xt-1.1")

WAN_NEGATIVE = (
    "Bright tones, overexposed, static, blurred details, subtitles, style, works, paintings, images, static, "
    "overall gray, worst quality, low quality, JPEG compression residue, ugly, incomplete, extra fingers, "
    "poorly drawn hands, poorly drawn faces, deformed, disfigured, misshapen limbs, fused fingers, still picture, "
    "messy background, three legs, many people in the background, walking backwards"
)


def progress(phase, step=0, total=0):
    sys.stderr.write("@@PROGRESS " + json.dumps({"phase": phase, "step": step, "total": total}) + "\n")
    sys.stderr.flush()


def log(msg):
    sys.stderr.write(f"[video-worker] {msg}\n")
    sys.stderr.flush()


def find_ffmpeg():
    candidates = [
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft", "WinGet", "Links", "ffmpeg.exe"),
        "C:\\ffmpeg\\bin\\ffmpeg.exe",
    ]
    for c in candidates:
        if c and os.path.exists(c):
            return c
    import shutil
    on_path = shutil.which("ffmpeg")
    if on_path:
        return on_path
    # Fresh installs have no system ffmpeg; the portable Python env ships one via imageio-ffmpeg.
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"


def encode_frames(frames, out_path, fps):
    """Encode a list of PIL frames to a browser-friendly H.264 MP4 via ffmpeg rawvideo pipe."""
    import numpy as np
    w, h = frames[0].size
    cmd = [
        find_ffmpeg(), "-y", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-r", str(fps), "-i", "-",
        "-c:v", "libx264", "-preset", "slow", "-crf", "16",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        out_path,
    ]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    for f in frames:
        p.stdin.write(np.asarray(f.convert("RGB"), dtype=np.uint8).tobytes())
    p.stdin.close()
    err = p.stderr.read().decode("utf-8", errors="replace")
    p.wait()
    if p.returncode != 0:
        raise RuntimeError(f"ffmpeg encode failed: {err[-400:]}")


def decode_image(b64):
    from PIL import Image
    clean = str(b64)
    if "," in clean and clean.strip().startswith("data:"):
        clean = clean.split(",", 1)[1]
    return Image.open(io.BytesIO(base64.b64decode(clean))).convert("RGB")


def fit_cover(img, w, h):
    from PIL import Image
    src_w, src_h = img.size
    scale = max(w / src_w, h / src_h)
    nw, nh = int(round(src_w * scale)), int(round(src_h * scale))
    img = img.resize((nw, nh), Image.Resampling.LANCZOS)
    left, top = (nw - w) // 2, (nh - h) // 2
    return img.crop((left, top, left + w, top + h))


# =========================================================================
# TIER 1: Low-End (<= 6 GB VRAM) - AnimateDiff Realistic Vision v1.5 v2
# =========================================================================

def run_animatediff(payload, out_path, rng_seed):
    import torch
    from diffusers import AnimateDiffPipeline, MotionAdapter, DPMSolverMultistepScheduler

    adapter_path = os.path.join(VIDEO_MODELS, "mm_sd_v15_v2.ckpt")
    if not os.path.exists(adapter_path):
        raise RuntimeError("AnimateDiff motion module missing: app/video-models/mm_sd_v15_v2.ckpt")

    base_candidates = [
        os.path.join(ROOT, "app", "models", "Realistic_Vision_V5.1_fp16-no-ema.safetensors"),
        os.path.join(ROOT, "app", "models", "DreamShaper_8_pruned.safetensors"),
        os.path.join(ROOT, "app", "models", "v1-5-pruned-emaonly.safetensors"),
    ]
    base_ckpt = None
    for c in base_candidates:
        if os.path.exists(c):
            base_ckpt = c
            break
    if not base_ckpt:
        raise RuntimeError("SD 1.5 base checkpoint missing in app/models/")

    progress("loading", 0, 0)
    t0 = time.time()
    adapter = MotionAdapter.from_single_file(adapter_path, torch_dtype=torch.float16)
    pipe = AnimateDiffPipeline.from_single_file(base_ckpt, motion_adapter=adapter, torch_dtype=torch.float16)
    pipe.scheduler = DPMSolverMultistepScheduler.from_config(pipe.scheduler.config, beta_schedule="linear")
    pipe.to("cuda")
    if hasattr(pipe, "vae") and hasattr(pipe.vae, "enable_slicing"):
        pipe.vae.enable_slicing()
    log(f"AnimateDiff pipeline loaded in {time.time() - t0:.1f}s")

    prompt = payload.get("prompt") or "a cinematic shot, natural motion, high quality"
    negative = payload.get("negative_prompt") or (
        "bad quality, blurry, distorted, deformed, static, stripes, duplicate, disfigured, text, watermark"
    )
    steps = int(payload.get("steps", 20))
    guidance = float(payload.get("guidance", 7.5))
    num_frames = 16

    def on_step(pipe_, i, t, kwargs):
        progress("denoising", i + 1, steps)
        return kwargs

    log(f"Generating AnimateDiff video: 512x512, {num_frames} frames, {steps} steps, cfg {guidance}")
    t1 = time.time()
    out = pipe(
        prompt=prompt,
        negative_prompt=negative,
        width=512,
        height=512,
        num_frames=num_frames,
        guidance_scale=guidance,
        num_inference_steps=steps,
        generator=torch.Generator("cpu").manual_seed(rng_seed),
        callback_on_step_end=on_step,
    )
    frames = out.frames[0]
    log(f"AnimateDiff sampling took {time.time() - t1:.1f}s")

    progress("encoding", 0, 0)
    fps = int(payload.get("fps", 12))
    encode_frames(frames, out_path, fps)
    return {
        "engine": "AnimateDiff Realistic Vision (v1.5 v2)",
        "tier": "Low (<= 6 GB VRAM)",
        "width": 512,
        "height": 512,
        "frames": len(frames),
        "fps": fps,
        "steps": steps,
    }


# =========================================================================
# TIER 2 & 3: Mid (<= 16 GB VRAM) & High (24 GB+ / 64 GB RAM Offloaded) - Wan 2.1
# =========================================================================

def wan_size(resolution, is_14b=False):
    """Map aspect ratio to native Wan buckets."""
    try:
        w, h = [int(x) for x in str(resolution).lower().split("x")]
    except Exception:
        w, h = (1280, 720) if is_14b else (832, 480)
    if is_14b:
        if w > h * 1.15:
            return 1280, 720
        if h > w * 1.15:
            return 720, 1280
        return 960, 960
    else:
        if w > h * 1.15:
            return 832, 480
        if h > w * 1.15:
            return 480, 832
        return 624, 624


def run_wan(payload, out_path, rng_seed, tier="1.3b"):
    import torch
    from diffusers import WanPipeline, AutoencoderKLWan, UniPCMultistepScheduler

    is_14b = (tier == "14b")
    target_dir = WAN14_DIR if is_14b else WAN_DIR
    has_local_pipe = os.path.exists(target_dir) and os.path.exists(os.path.join(target_dir, "model_index.json"))

    if not has_local_pipe:
        # Never silently switch to another engine: the user asked for Wan.
        raise RuntimeError(f"Wan 2.1 {tier.upper()} Diffusers folder (model_index.json) not found in {target_dir}.")
    missing = [sub for sub in ("vae", "transformer", "text_encoder")
               if not os.path.exists(os.path.join(target_dir, sub, "config.json"))
               or not any(f.endswith(".safetensors") for f in os.listdir(os.path.join(target_dir, sub)))]
    if missing:
        raise RuntimeError(f"Wan 2.1 {tier.upper()} download is incomplete (missing: {', '.join(missing)}). "
                           "Restart the download from Model Center > Video; finished files are skipped.")

    progress("loading", 0, 0)
    t0 = time.time()
    vae = AutoencoderKLWan.from_pretrained(target_dir, subfolder="vae", torch_dtype=torch.float32)
    pipe = WanPipeline.from_pretrained(target_dir, vae=vae, torch_dtype=torch.bfloat16)
    flow_shift = 5.0 if is_14b else 3.0
    pipe.scheduler = UniPCMultistepScheduler.from_config(pipe.scheduler.config, flow_shift=flow_shift)
    # Offload submodules to system RAM so the 1.3B pipeline (UMT5-XXL encoder) fits consumer VRAM.
    pipe.enable_model_cpu_offload()
    log(f"Wan 2.1 {tier.upper()} loaded in {time.time() - t0:.1f}s via CPU offloading")

    width, height = wan_size(payload.get("resolution", "832x480"), is_14b=is_14b)
    duration = max(1.0, min(5.0, float(payload.get("duration", 3))))
    num_frames = int(round(duration * 16 / 4.0)) * 4 + 1
    num_frames = max(17, min(81, num_frames))
    steps = int(payload.get("steps", 30))
    guidance = float(payload.get("guidance", 5.0))

    prompt = payload.get("prompt") or "a cinematic shot, natural motion, high quality"
    negative = payload.get("negative_prompt") or WAN_NEGATIVE

    def on_step(pipe_, i, t, kwargs):
        progress("denoising", i + 1, steps)
        return kwargs

    log(f"Generating Wan 2.1 {tier.upper()}: {width}x{height}, {num_frames} frames, {steps} steps, cfg {guidance}")
    t1 = time.time()
    result = pipe(
        prompt=prompt,
        negative_prompt=negative,
        width=width,
        height=height,
        num_frames=num_frames,
        num_inference_steps=steps,
        guidance_scale=guidance,
        generator=torch.Generator("cpu").manual_seed(rng_seed),
        callback_on_step_end=on_step,
        output_type="pil",
    )
    frames = result.frames[0]
    log(f"Wan sampling took {time.time() - t1:.1f}s")

    progress("encoding", 0, 0)
    encode_frames(frames, out_path, 16)
    return {
        "engine": f"Wan 2.1 T2V {tier.upper()}",
        "tier": "High (24 GB+ / 64 GB RAM Offload)" if is_14b else "Mid (<= 16 GB VRAM)",
        "width": width,
        "height": height,
        "frames": len(frames),
        "fps": 16,
        "steps": steps,
    }


# =========================================================================
# Image-to-Video: Stable Video Diffusion XT 1.1 (SVD-XT)
# =========================================================================

def run_svd(payload, out_path, rng_seed):
    import torch
    from diffusers import StableVideoDiffusionPipeline

    image_b64 = payload.get("input_image")
    if not image_b64:
        raise RuntimeError("Image-to-video requires an input image.")
    src = decode_image(image_b64)

    if src.size[1] > src.size[0] * 1.15:
        width, height = 576, 1024
    else:
        width, height = 1024, 576
    image = fit_cover(src, width, height)

    has_local_pipe = os.path.exists(SVD_DIR) and os.path.exists(os.path.join(SVD_DIR, "model_index.json"))
    if not has_local_pipe:
        raise RuntimeError("SVD-XT 1.1 Diffusers folder not found in app/video-models/svd-xt-1.1.")

    progress("loading", 0, 0)
    t0 = time.time()
    pipe = StableVideoDiffusionPipeline.from_pretrained(SVD_DIR, torch_dtype=torch.float16, variant="fp16", low_cpu_mem_usage=True)
    # Model offload keeps the UNet + image encoder within 12-16 GB VRAM cards.
    pipe.enable_model_cpu_offload()
    log(f"SVD-XT loaded in {time.time() - t0:.1f}s")

    steps = int(payload.get("steps", 25))
    motion = int(payload.get("motion_bucket_id", 127))

    def on_step(pipe_, i, t, kwargs):
        progress("denoising", i + 1, steps)
        return kwargs

    t1 = time.time()
    result = pipe(
        image,
        width=width,
        height=height,
        num_frames=25,
        num_inference_steps=steps,
        motion_bucket_id=motion,
        noise_aug_strength=0.02,
        fps=7,
        decode_chunk_size=8,
        generator=torch.Generator("cpu").manual_seed(rng_seed),
        callback_on_step_end=on_step,
    )
    frames = result.frames[0]
    log(f"SVD-XT sampling took {time.time() - t1:.1f}s")

    progress("encoding", 0, 0)
    encode_frames(frames, out_path, 8)
    return {
        "engine": "Stable Video Diffusion XT 1.1",
        "tier": "Mid (<= 16 GB VRAM)",
        "width": width,
        "height": height,
        "frames": len(frames),
        "fps": 8,
        "steps": steps,
    }


def main():
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    try:
        raw = sys.stdin.buffer.read().decode("utf-8", errors="replace")
        if not raw.strip():
            print(json.dumps({"ok": False, "error": "No JSON payload provided to video worker."}))
            return
        payload = json.loads(raw)

        out_path = payload.get("output")
        if not out_path:
            print(json.dumps({"ok": False, "error": "Output path is required."}))
            return
        out_path = os.path.abspath(out_path)
        os.makedirs(os.path.dirname(out_path), exist_ok=True)

        payload["prompt"] = str(payload.get("prompt") or "").strip() or "a cinematic shot, natural motion, high quality"
        seed = payload.get("seed")
        rng_seed = int(seed) if seed is not None else int(time.time() * 1000) % 2147483647

        engine = str(payload.get("engine", "")).lower()
        has_image = bool(payload.get("input_image"))
        mode = str(payload.get("mode", "t2v")).lower()

        log(f"Dispatching video job: engine='{engine}', mode='{mode}', has_image={has_image}")

        if "svd" in engine:
            info = run_svd(payload, out_path, rng_seed)
        elif engine in ("wan21-1.3b", "wan-1.3b"):
            info = run_wan(payload, out_path, rng_seed, tier="1.3b")
        elif engine in ("animatediff-v15", "animatediff"):
            info = run_animatediff(payload, out_path, rng_seed)
        else:
            raise RuntimeError(f"Video engine '{engine}' is not supported by this worker.")

        info.update({"ok": True, "output": out_path, "size": os.path.getsize(out_path), "seed": rng_seed})
        print(json.dumps(info))
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"ok": False, "error": str(e)}))


if __name__ == "__main__":
    main()
