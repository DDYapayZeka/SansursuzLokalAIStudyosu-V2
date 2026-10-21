#!/usr/bin/env python3
import argparse
import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np
import torch
from python_coreml_stable_diffusion.pipeline import (
    StableDiffusionPipeline,
    StableDiffusionXLPipeline,
    get_coreml_pipe,
    SCHEDULER_MAP
)



MODEL_VERSION_BY_NAME = {
    "coreml-stable-diffusion-v1-5": "runwayml/stable-diffusion-v1-5",
    "stable-diffusion-v1-5": "runwayml/stable-diffusion-v1-5",
    "stable-diffusion-v1-4": "CompVis/stable-diffusion-v1-4",
    "cyberrealistic": "runwayml/stable-diffusion-v1-5",
}


def get_scheduler_class(name: str):
    name = str(name).lower().replace(" ", "").replace("_", "").replace("-", "")
    if "eulerancestral" in name or "eulera" in name:
        return SCHEDULER_MAP.get("EulerAncestralDiscrete")
    if "euler" in name:
        return SCHEDULER_MAP.get("EulerDiscrete")
    if "dpm" in name:
        return SCHEDULER_MAP.get("DPMSolverMultistep")
    if "ddim" in name:
        return SCHEDULER_MAP.get("DDIM")
    if "lms" in name:
        return SCHEDULER_MAP.get("LMSDiscrete")
    if "pndm" in name:
        return SCHEDULER_MAP.get("PNDM")
    return None



def json_response(handler, code, payload):
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def find_coreml_resource_dir(model_path: Path) -> Path:
    candidates = [
        model_path,
        model_path / "Resources",
        model_path / "compiled",
        model_path / "packages",
        model_path / "split_einsum_v2" / "compiled",
        model_path / "split_einsum" / "compiled",
        model_path / "original" / "compiled",
        model_path / "split_einsum_v2" / "packages",
        model_path / "split_einsum" / "packages",
        model_path / "original" / "packages",
    ]

    required_names = {
        "text_encoder.mlmodelc",
        "text_encoder.mlpackage",
        "textencoder.mlmodelc",
        "textencoder.mlpackage",
    }
    for candidate in candidates:
        if not candidate.is_dir():
            continue
        names = {entry.name.lower() for entry in candidate.iterdir()}
        has_text_encoder = bool(names & required_names)
        has_unet = "unet.mlmodelc" in names or "unet.mlpackage" in names
        if has_text_encoder and has_unet:
            return candidate

    for candidate in model_path.rglob("*"):
        if not candidate.is_dir():
            continue
        names = {entry.name.lower() for entry in candidate.iterdir()}
        has_text_encoder = bool(names & required_names)
        has_unet = "unet.mlmodelc" in names or "unet.mlpackage" in names
        if has_text_encoder and has_unet:
            return candidate

    raise FileNotFoundError(
        f"Could not find CoreML resources under {model_path}. "
        "Expected a folder containing text_encoder and unet .mlmodelc/.mlpackage files."
    )


def infer_model_version(model_path: Path) -> str:
    override = os.environ.get("COREML_MODEL_VERSION")
    if override:
        return override
    lower = model_path.name.lower()
    for needle, version in MODEL_VERSION_BY_NAME.items():
        if needle in lower:
            return version
    return "runwayml/stable-diffusion-v1-5"


def infer_model_sources(resource_dir: Path) -> str:
    names = {entry.name.lower() for entry in resource_dir.iterdir()}
    if any(name.endswith(".mlmodelc") for name in names):
        return "compiled"
    return "packages"


def has_coreml_safety_checker(resource_dir: Path, sources: str, model_version: str) -> bool:
    names = {entry.name.lower() for entry in resource_dir.iterdir()}
    if sources == "compiled":
        return "safetychecker.mlmodelc" in names
    package_name = f"Stable_Diffusion_version_{model_version}_safety_checker.mlpackage".replace("/", "_").lower()
    return package_name in names


def latest_png(root: Path) -> Path:
    images = sorted(root.rglob("*.png"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not images:
        raise FileNotFoundError("CoreML generation finished but did not write a PNG output.")
    return images[0]


class CoreMLServerState:
    def __init__(self, model: Path, steps: int, cfg_scale: float):
        self.model = model
        self.resources = find_coreml_resource_dir(model)
        self.model_version = infer_model_version(model)
        self.steps = steps
        self.cfg_scale = cfg_scale
        self.started_at = time.time()
        self.lock = threading.Lock()

        # Load CoreML pipeline components on startup
        print(f"[coreml-npu] Loading PyTorch reference configuration for model version: {self.model_version}", flush=True)
        SDP = StableDiffusionXLPipeline if 'xl' in self.model_version else StableDiffusionPipeline
        pytorch_pipe = SDP.from_pretrained(
            self.model_version,
            use_auth_token=True,
        )

        compute_unit = os.environ.get("COREML_COMPUTE_UNIT", "CPU_AND_NE")
        sources = infer_model_sources(self.resources)
        if not has_coreml_safety_checker(self.resources, sources, self.model_version):
            print("[coreml-npu] Safety checker Core ML model not found; running without safety checker.", flush=True)
            pytorch_pipe.safety_checker = None

        print(f"[coreml-npu] Loading Core ML models from: {self.resources} (compute unit: {compute_unit}, sources: {sources})", flush=True)
        self.pipe = get_coreml_pipe(
            pytorch_pipe=pytorch_pipe,
            mlpackages_dir=self.resources,
            model_version=self.model_version,
            compute_unit=compute_unit,
            sources=sources
        )
        print("[coreml-npu] Core ML models loaded successfully.", flush=True)



def make_handler(state: CoreMLServerState):
    class Handler(BaseHTTPRequestHandler):
        def do_OPTIONS(self):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
            self.end_headers()

        def do_GET(self):
            if self.path == "/health":
                json_response(self, 200, {
                    "ok": True,
                    "ready": True,
                    "model": str(state.model),
                    "resources": str(state.resources),
                    "model_version": state.model_version,
                    "uptime_sec": round(time.time() - state.started_at, 1),
                })
                return
            if self.path == "/v1/models":
                json_response(self, 200, {
                    "object": "list",
                    "data": [{
                        "id": state.model.name,
                        "object": "model",
                        "owned_by": "local-coreml",
                    }],
                })
                return
            json_response(self, 404, {"ok": False, "error": "Unknown endpoint"})

        def do_POST(self):
            if self.path != "/v1/images/generations":
                json_response(self, 404, {"ok": False, "error": "Unknown endpoint"})
                return

            try:
                if not hasattr(state, "pipe") or not state.pipe:
                    raise RuntimeError("CoreML pipeline is not initialized or failed to load.")

                length = int(self.headers.get("Content-Length", "0") or "0")
                payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
                prompt = str(payload.get("prompt") or "").strip()
                if not prompt:
                    raise ValueError("Prompt is required")

                size = str(payload.get("size") or "512x512").lower().split("x")
                if len(size) == 2 and size != ["512", "512"]:
                    raise ValueError("CoreML models in this app currently generate at their compiled resolution, normally 512x512.")

                steps = max(1, int(payload.get("steps") or state.steps or 30))
                guidance = float(payload.get("cfg_scale") or state.cfg_scale or 7.0)
                if guidance <= 1.0:
                    print("[coreml-npu] CFG scale <= 1 can disable classifier-free guidance, but this compiled UNet expects CFG batch shape. Using cfg_scale=7.0.", flush=True)
                    guidance = 7.0
                seed = int(payload.get("seed")) if payload.get("seed") not in (None, -1) else int(time.time_ns() % (2 ** 32))
                negative_prompt = str(payload.get("negative_prompt") or "").strip()

                started = time.time()

                # Dynamic sampler / scheduler swap
                sampler = payload.get("sample_method") or payload.get("sampler") or payload.get("sampler_name")
                if sampler and hasattr(state, "pipe") and state.pipe:
                    scheduler_cls = get_scheduler_class(sampler)
                    if scheduler_cls is not None and state.pipe.scheduler.__class__ != scheduler_cls:
                        print(f"[coreml-npu] Switching scheduler to {scheduler_cls.__name__}", flush=True)
                        state.pipe.scheduler = scheduler_cls.from_config(state.pipe.scheduler.config)

                print("[coreml-npu] generating image", flush=True)
                np.random.seed(seed)

                # Thread safe execution of the in-memory pipeline
                with state.lock:
                    output = state.pipe(
                        prompt=prompt,
                        height=state.pipe.height,
                        width=state.pipe.width,
                        num_inference_steps=steps,
                        guidance_scale=guidance,
                        negative_prompt=negative_prompt if negative_prompt else None,
                    )
                
                image = output.images[0]

                # Convert to base64 PNG
                import io
                buffered = io.BytesIO()
                image.save(buffered, format="PNG")
                encoded = base64.b64encode(buffered.getvalue()).decode("ascii")

                print("[coreml-npu] decoding complete", flush=True)
                json_response(self, 200, {
                    "created": int(time.time()),
                    "data": [{
                        "b64_json": encoded,
                        "seed": seed,
                    }],
                    "duration_sec": round(time.time() - started, 2),
                })
            except Exception as exc:
                import traceback
                traceback.print_exc()
                json_response(self, 500, {"ok": False, "error": str(exc)})


        def log_message(self, fmt, *args):
            print("[coreml-npu-http] " + fmt % args, flush=True)

    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--listen-port", required=True, type=int)
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--steps", type=int, default=30)
    parser.add_argument("--cfg-scale", type=float, default=7.0)
    args = parser.parse_args()

    state = CoreMLServerState(args.model, args.steps, args.cfg_scale)
    print(f"[coreml-npu] Model: {state.model}", flush=True)
    print(f"[coreml-npu] Resources: {state.resources}", flush=True)
    print(f"[coreml-npu] Model version: {state.model_version}", flush=True)
    print("| 1/1 - CoreML resources ready", flush=True)
    server = ThreadingHTTPServer(("127.0.0.1", args.listen_port), make_handler(state))
    print(f"[coreml-npu] listening on http://127.0.0.1:{args.listen_port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
