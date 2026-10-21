import sys
import os
import json
import time
import copy
import re
import random
import traceback


TR_SFX_DICT = [
    ("gök gürültüsü", "loud thunderclap rumble"),
    ("şimşek", "lightning strike thunder"),
    ("sağanak yağmur", "heavy rain downpour"),
    ("yağmur", "rain falling water drops"),
    ("fırtına", "violent storm wind and rain"),
    ("rüzgar", "howling wind blowing"),
    ("patlama", "massive explosion boom blast"),
    ("bomba", "bomb explosion shockwave"),
    ("silah sesi", "gunshot firearm bang"),
    ("silah", "gunshot weapon fire"),
    ("ateş etme", "gunfire shooting"),
    ("lazer", "sci-fi laser beam zap"),
    ("ayak sesi", "footsteps walking on floor"),
    ("adımlar", "footsteps walking"),
    ("koşma", "running footsteps"),
    ("araba motoru", "car engine revving V8"),
    ("motor sesi", "engine roaring revving"),
    ("araba", "car driving pass by"),
    ("fren", "tires screeching car brake"),
    ("patinaj", "car tires skidding screech"),
    ("cam kırılması", "glass shattering breaking crash"),
    ("kırılan cam", "glass breaking shatter"),
    ("kapı gıcırtısı", "creaky wooden door opening"),
    ("kapı çarpması", "heavy door slam shut"),
    ("kapı", "door opening and closing"),
    ("alkış", "crowd clapping applause"),
    ("kalabalık", "crowd ambience chatter"),
    ("çığlık", "human scream shout"),
    ("kahkaha", "laughing laughter"),
    ("gülme", "laughter chuckling"),
    ("ağlama", "crying sobbing"),
    ("köpek havlaması", "dog barking"),
    ("köpek", "dog barking growling"),
    ("kedi miyavlaması", "cat meowing"),
    ("kedi", "cat meow purr"),
    ("kuş sesleri", "birds chirping singing in forest"),
    ("kuş", "bird chirping"),
    ("dalga", "ocean waves crashing on beach"),
    ("deniz", "sea waves water splashing"),
    ("su sesi", "flowing water stream splash"),
    ("su", "water splash flowing"),
    ("ateş", "crackling fire flames burning"),
    ("kamp ateşi", "campfire crackling wood burning"),
    ("kılıç", "metal sword clash slash"),
    ("yumruk", "heavy punch impact hit"),
    ("darbe", "heavy impact thud hit"),
    ("zil", "bell ringing chime"),
    ("telefon", "telephone ringing beep"),
    ("alarm", "siren alarm blaring"),
    ("siren", "police ambulance siren wailing"),
    ("helikopter", "helicopter rotor blades flying"),
    ("uçak", "jet airplane engine flyby"),
    ("tren", "train chugging on tracks horn"),
    ("klavye", "mechanical keyboard typing clicks"),
    ("saat", "clock ticking mechanical"),
    ("kalp atışı", "heartbeat thumping pulse"),
    ("korku", "creepy horror ambience drone"),
    ("uzay", "sci-fi space ambient whoosh"),
    ("rüzgarlı", "windy air whoosh"),
]

TR_MUSIC_DICT = [
    ("epik", "epic cinematic"),
    ("sinematik", "cinematic film score"),
    ("orkestra", "symphonic orchestra strings brass"),
    ("piyano", "acoustic grand piano"),
    ("akustik gitar", "acoustic guitar fingerpicking"),
    ("elektro gitar", "electric guitar riff solo"),
    ("gitar", "guitar melody"),
    ("keman", "emotional violin solo strings"),
    ("çello", "deep cello strings"),
    ("flüt", "wooden flute melody"),
    ("ney", "mystical reed flute ney"),
    ("bağlama", "anatolian folk lute baglama"),
    ("ud", "middle eastern oud melody"),
    ("davul", "powerful drums percussion beat"),
    ("bateri", "drum kit rhythm groove"),
    ("bas", "deep bassline groove"),
    ("hüzünlü", "melancholic emotional sad slow"),
    ("duygusal", "emotional heartfelt expressive"),
    ("neşeli", "upbeat happy cheerful bright"),
    ("enerjik", "energetic fast driving upbeat"),
    ("hareketli", "upbeat danceable rhythmic"),
    ("sakin", "calm relaxing peaceful ambient"),
    ("rahatlatıcı", "relaxing soothing chill ambient"),
    ("karanlık", "dark mysterious tense atmospheric"),
    ("gerilim", "suspenseful thriller tension"),
    ("romantik", "romantic warm tender"),
    ("lo-fi", "lofi hip hop chill beats"),
    ("lofi", "lofi chillhop dusty beats"),
    ("elektronik", "electronic synthwave house"),
    ("tekno", "techno club driving bass"),
    ("rock", "rock band electric guitar drums"),
    ("metal", "heavy metal distorted guitars double kick"),
    ("caz", "smooth jazz saxophone piano upright bass"),
    ("klasik", "classical chamber orchestra"),
    ("doğu", "oriental middle eastern traditional"),
    ("türk", "turkish anatolian folk melody"),
    ("oyun müziği", "video game soundtrack ost"),
    ("fon müziği", "background instrumental music"),
    ("melodi", "melodic instrumental"),
    ("ritim", "rhythmic beat groove"),
    ("yavaş", "slow tempo ambient"),
    ("hızlı", "fast tempo energetic"),
]


def translate_and_enrich_prompt(raw_prompt: str, is_sfx: bool, enrich: bool = True) -> str:
    """Translates Turkish audio/music terms to English so CLAP (AudioLDM) and T5 (MusicGen) understand Turkish prompts natively."""
    lower_p = raw_prompt.lower()
    for strip_word in ("ses efekti", "sesi", "efekti", "üret", "yap", "bana", "lütfen"):
        lower_p = re.sub(rf"\b{strip_word}\b", " ", lower_p)

    matched_terms = []
    dictionary = TR_SFX_DICT if is_sfx else (TR_MUSIC_DICT + TR_SFX_DICT)
    for tr_term, en_term in dictionary:
        if tr_term in lower_p:
            matched_terms.append(en_term)
            lower_p = lower_p.replace(tr_term, " ")

    # Keep any remaining ASCII/English words the user wrote
    ascii_words = re.findall(r"\b[a-zA-Z]{3,}\b", lower_p)
    tr_Clarify = {"bir", "ile", "icin", "gibi", "cok", "daha", "olan", "veya", "hem"}
    remaining_en = [w for w in ascii_words if w.lower() not in tr_Clarify]

    if matched_terms:
        combined = ", ".join(matched_terms)
        if remaining_en:
            combined = f"{combined}, {' '.join(remaining_en)}"
        if not enrich:
            return combined
        if is_sfx:
            return f"high quality realistic sound effect, foley audio of {combined}, clear crisp recording"
        else:
            return f"{combined}, high quality studio instrumental music"
    else:
        if is_sfx and enrich:
            return f"high quality realistic sound effect of {raw_prompt}, foley audio, clear recording"
        return raw_prompt


def load_musicgen_model(model_id: str, root_dir: str, device: str, dtype):
    """Loads MusicGen Small (300M), Medium (1.5B), or Large (3.3B) using local weights and AudioCraft state_dict mapping."""
    import torch
    from safetensors.torch import load_file
    from transformers import AutoProcessor, MusicgenForConditionalGeneration, MusicgenConfig

    small_dir = os.path.join(root_dir, "app", "music-models", "musicgen-small-local")
    if not os.path.exists(os.path.join(small_dir, "model.safetensors")):
        # Medium/Large reuse Small's T5 text encoder + EnCodec weights, so a full local folder is needed.
        from huggingface_hub import snapshot_download
        small_dir = snapshot_download(
            "facebook/musicgen-small",
            allow_patterns=["*.json", "spiece.model", "model.safetensors"],
        )

    processor = AutoProcessor.from_pretrained(small_dir)

    target_ckpt = None
    arch_params = None
    resolved_model_id = "musicgen-small"

    if "large" in model_id:
        cand = os.path.join(root_dir, "app", "music-models", "musicgen-large.safetensors")
        if os.path.exists(cand) and os.path.getsize(cand) > 1_000_000_000:
            target_ckpt = cand
            arch_params = {"hidden_size": 2048, "ffn_dim": 8192, "num_hidden_layers": 48, "num_attention_heads": 32}
            resolved_model_id = "musicgen-large"
    elif "medium" in model_id:
        cand = os.path.join(root_dir, "app", "music-models", "musicgen-medium.safetensors")
        if os.path.exists(cand) and os.path.getsize(cand) > 1_000_000_000:
            target_ckpt = cand
            arch_params = {"hidden_size": 1536, "ffn_dim": 6144, "num_hidden_layers": 48, "num_attention_heads": 24}
            resolved_model_id = "musicgen-medium"

    if ("large" in model_id or "medium" in model_id) and not target_ckpt:
        raise RuntimeError(f"{model_id} weights (AudioCraft state_dict) not found in app/music-models/.")

    if target_ckpt and arch_params:
        sys.stderr.write(f"Notice: Loading {resolved_model_id} ({arch_params['hidden_size']}d, {arch_params['num_hidden_layers']}L) from {os.path.basename(target_ckpt)} on {device.upper()}...\n")
        cfg = copy.deepcopy(MusicgenConfig.from_pretrained(small_dir))
        cfg.decoder.hidden_size = arch_params["hidden_size"]
        cfg.decoder.ffn_dim = arch_params["ffn_dim"]
        cfg.decoder.num_hidden_layers = arch_params["num_hidden_layers"]
        cfg.decoder.num_attention_heads = arch_params["num_attention_heads"]

        small_sd = load_file(os.path.join(small_dir, "model.safetensors"))
        # These AudioCraft checkpoints are zip pickles despite the .safetensors name; newer torch.load
        # routes *paths* ending in .safetensors to the safetensors reader, so pass a file object.
        with open(target_ckpt, "rb") as ckpt_file:
            ac_ckpt = torch.load(ckpt_file, map_location="cpu", weights_only=False)
        bs = ac_ckpt["best_state"]

        merged_sd = {}
        for k, v in small_sd.items():
            if k.startswith("text_encoder.") or k.startswith("audio_encoder."):
                merged_sd[k] = v.to(dtype)
        if "text_encoder.shared.weight" in merged_sd and "text_encoder.encoder.embed_tokens.weight" not in merged_sd:
            merged_sd["text_encoder.encoder.embed_tokens.weight"] = merged_sd["text_encoder.shared.weight"]

        merged_sd["enc_to_dec_proj.weight"] = bs["condition_provider.conditioners.description.output_proj.weight"].to(dtype)
        merged_sd["enc_to_dec_proj.bias"] = bs["condition_provider.conditioners.description.output_proj.bias"].to(dtype)

        for k in range(4):
            merged_sd[f"decoder.model.decoder.embed_tokens.{k}.weight"] = bs[f"emb.{k}.weight"].to(dtype)
            merged_sd[f"decoder.lm_heads.{k}.weight"] = bs[f"linears.{k}.weight"].to(dtype)

        merged_sd["decoder.model.decoder.layer_norm.weight"] = bs["out_norm.weight"].to(dtype)
        merged_sd["decoder.model.decoder.layer_norm.bias"] = bs["out_norm.bias"].to(dtype)

        for i in range(arch_params["num_hidden_layers"]):
            p_hf = f"decoder.model.decoder.layers.{i}"
            p_ac = f"transformer.layers.{i}" if f"transformer.layers.{i}.self_attn.in_proj_weight" in bs else f"layers.{i}"

            q, k, v = bs[f"{p_ac}.self_attn.in_proj_weight"].chunk(3, dim=0)
            merged_sd[f"{p_hf}.self_attn.q_proj.weight"] = q.to(dtype)
            merged_sd[f"{p_hf}.self_attn.k_proj.weight"] = k.to(dtype)
            merged_sd[f"{p_hf}.self_attn.v_proj.weight"] = v.to(dtype)
            merged_sd[f"{p_hf}.self_attn.out_proj.weight"] = bs[f"{p_ac}.self_attn.out_proj.weight"].to(dtype)

            cq, ck, cv = bs[f"{p_ac}.cross_attention.in_proj_weight"].chunk(3, dim=0)
            merged_sd[f"{p_hf}.encoder_attn.q_proj.weight"] = cq.to(dtype)
            merged_sd[f"{p_hf}.encoder_attn.k_proj.weight"] = ck.to(dtype)
            merged_sd[f"{p_hf}.encoder_attn.v_proj.weight"] = cv.to(dtype)
            merged_sd[f"{p_hf}.encoder_attn.out_proj.weight"] = bs[f"{p_ac}.cross_attention.out_proj.weight"].to(dtype)

            merged_sd[f"{p_hf}.self_attn_layer_norm.weight"] = bs[f"{p_ac}.norm1.weight"].to(dtype)
            merged_sd[f"{p_hf}.self_attn_layer_norm.bias"] = bs[f"{p_ac}.norm1.bias"].to(dtype)
            merged_sd[f"{p_hf}.encoder_attn_layer_norm.weight"] = bs[f"{p_ac}.norm_cross.weight"].to(dtype)
            merged_sd[f"{p_hf}.encoder_attn_layer_norm.bias"] = bs[f"{p_ac}.norm_cross.bias"].to(dtype)
            merged_sd[f"{p_hf}.final_layer_norm.weight"] = bs[f"{p_ac}.norm2.weight"].to(dtype)
            merged_sd[f"{p_hf}.final_layer_norm.bias"] = bs[f"{p_ac}.norm2.bias"].to(dtype)

            merged_sd[f"{p_hf}.fc1.weight"] = bs[f"{p_ac}.linear1.weight"].to(dtype)
            merged_sd[f"{p_hf}.fc2.weight"] = bs[f"{p_ac}.linear2.weight"].to(dtype)

        del small_sd, bs, ac_ckpt

        try:
            from transformers.initialization import no_init_weights  # transformers 5.x
        except ImportError:
            from transformers.modeling_utils import no_init_weights  # transformers 4.x
        prev_dtype = torch.get_default_dtype()
        try:
            torch.set_default_dtype(dtype)
            with no_init_weights():
                model = MusicgenForConditionalGeneration(cfg)
        finally:
            torch.set_default_dtype(prev_dtype)

        model.load_state_dict(merged_sd, strict=True, assign=True)
        del merged_sd
        model = model.to(device).eval()
        ensure_generation_token_ids(model)
        return processor, model, resolved_model_id

    sys.stderr.write(f"Notice: Loading musicgen-small (300M) from {small_dir} on {device.upper()}...\n")
    model = MusicgenForConditionalGeneration.from_pretrained(
        small_dir,
        torch_dtype=dtype,
        low_cpu_mem_usage=True
    ).to(device).eval()
    ensure_generation_token_ids(model)
    return processor, model, "musicgen-small"


def ensure_generation_token_ids(model):
    """transformers 5 no longer copies these ids from the model config into generation_config,
    and generate() then fails with 'decoder_start_token_id or bos_token_id has to be defined'."""
    gen = model.generation_config
    sources = [model.config, getattr(model.config, "decoder", None)]
    for name in ("decoder_start_token_id", "bos_token_id", "pad_token_id"):
        if getattr(gen, name, None) is not None:
            continue
        for src in sources:
            value = getattr(src, name, None) if src is not None else None
            if value is not None:
                setattr(gen, name, value)
                break
    if getattr(gen, "decoder_start_token_id", None) is None:
        gen.decoder_start_token_id = gen.pad_token_id if gen.pad_token_id is not None else gen.bos_token_id


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
            print(json.dumps({"ok": False, "error": "No JSON payload provided to music worker."}), file=sys.stdout)
            return

        payload = json.loads(raw_bytes.decode("utf-8", errors="replace"))
        raw_prompt = str(payload.get("prompt", "")).strip()
        if not raw_prompt:
            print(json.dumps({"ok": False, "error": "Prompt is required."}), file=sys.stdout)
            return

        out_path = payload.get("output")
        if not out_path:
            print(json.dumps({"ok": False, "error": "Output path is required."}), file=sys.stdout)
            return

        os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)

        duration = max(2, min(300, int(payload.get("duration", 10))))
        model_id = str(payload.get("model", "musicgen-small")).strip().lower()
        mode = str(payload.get("mode", "")).strip().lower()
        seed = payload.get("seed", None)

        emit_progress("Ses motoru hazırlanıyor...", 5, 0, duration)

        import torch
        import soundfile as sf
        import numpy as np

        device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype = torch.float16 if device == "cuda" else torch.float32

        if seed is None or seed == -1:
            seed = random.randint(100000, 99999999)
        torch.manual_seed(seed)
        if device == "cuda":
            torch.cuda.manual_seed_all(seed)

        is_audioldm = ("audioldm" in model_id) or ("sfx" in model_id) or (mode == "sfx")
        is_sfx_keyword = any(w in raw_prompt.lower() for w in [
            "sfx", "sound effect", "ses efekti", "patlama", "explosion",
            "thunder", "gök gürültüsü", "şimşek", "lightning", "rain", "yağmur",
            "wind", "rüzgar", "fırtına", "storm", "gunshot", "silah", "footsteps",
            "ayak sesi", "foley", "car engine", "motor sesi", "patinaj", "skid",
            "glass shatter", "cam kırılması", "kırılan cam", "laser", "lazer",
            "door slam", "kapı gıcırtısı", "kapı çarpması", "köpek havlaması",
            "kedi miyavlaması", "siren", "helikopter", "alkış", "çığlık"
        ])
        run_sfx = is_audioldm or (is_sfx_keyword and mode != "music")

        start_time = time.time()

        if run_sfx:
            # Foley model secimi: En Iyi (Large), En Verimli Orta (Base), En Verimli Kucuk (Small/v1)
            if "large" in model_id:
                repo_id = "cvssp/audioldm2-large"
                model_name = "AudioLDM 2 Large (En Iyi - Sinematik)"
                is_v2 = True
            elif "audioldm2" in model_id or "base" in model_id or "orta" in model_id:
                repo_id = "cvssp/audioldm2"
                model_name = "AudioLDM 2 Base (En Verimli Orta - Dengeli)"
                is_v2 = True
            elif "small" in model_id or "s-full" in model_id or "kucuk" in model_id or "hizli" in model_id:
                repo_id = "cvssp/audioldm-s-full-v2"
                model_name = "AudioLDM-S Full (En Verimli Kucuk - Hizli)"
                is_v2 = False
            else:
                # Varsayilan olarak yuksek kaliteli AudioLDM 2 Large kullan
                repo_id = "cvssp/audioldm2-large"
                model_name = "AudioLDM 2 Large (En Iyi - Sinematik)"
                is_v2 = True

            if is_v2:
                effective_prompt = translate_and_enrich_prompt(raw_prompt, is_sfx=True)
                negative_prompt = "music, melody, singing, song, vocals, instruments, beat, low quality, muffled, distortion"
                guidance = 4.0
            else:
                # AudioLDM v1 (CLAP) collapses to near-silence for event sounds when given a negative prompt
                # or the long "enriched" template (measured -73 dB); plain prompt + CFG 2.5 is its default.
                effective_prompt = translate_and_enrich_prompt(raw_prompt, is_sfx=True, enrich=False)
                negative_prompt = None
                guidance = 2.5

            emit_progress(f"{model_name} modeli yukleniyor...", 12, 0, 35)
            sys.stderr.write(
                f"Notice: Running {model_name} ({repo_id}) SFX on {device.upper()} ({dtype}) | Prompt: '{effective_prompt}'\n"
            )

            # Prefer a local snapshot downloaded from Model Hub (app/music-models/<name>), else the HF cache/repo.
            root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
            local_dir = os.path.join(root_dir, "app", "music-models", repo_id.split("/")[-1])
            source = local_dir if os.path.exists(os.path.join(local_dir, "model_index.json")) else repo_id
            # Never start a silent multi-GB download in the middle of a generation request:
            # a missing or partial HF cache must be fixed from Model Merkezi instead.
            if is_v2:
                from diffusers import AudioLDM2Pipeline as PipelineClass
            else:
                from diffusers import AudioLDMPipeline as PipelineClass
            try:
                pipe = PipelineClass.from_pretrained(source, torch_dtype=dtype, local_files_only=True).to(device)
            except (OSError, EnvironmentError) as load_err:
                raise RuntimeError(
                    f"{model_name} dosyalari eksik veya yarim indirilmis ({repo_id}). "
                    f"Model Merkezi > Muzik bolumunden modeli yeniden indirin. Ayrinti: {load_err}"
                )
            if is_v2:
                # AudioLDM 2 drives its GPT2Model with generation helpers that GPT2Model no longer
                # inherits since transformers 4.50; borrow them from GenerationMixin.
                import types
                from transformers.generation.utils import GenerationMixin
                lm = pipe.language_model
                # Only borrow helpers that still exist: transformers 5 removed _get_initial_cache_position
                # and diffusers then skips that call on its own.
                for helper in ("_get_initial_cache_position", "_update_model_kwargs_for_generation"):
                    if not hasattr(lm, helper) and hasattr(GenerationMixin, helper):
                        setattr(lm, helper, types.MethodType(getattr(GenerationMixin, helper), lm))

            sfx_duration = max(2.0, min(20.0, float(duration)))
            total_steps = 35
            emit_progress("Ses efekti akustik difuzyonu baslatildi...", 18, 1, total_steps)

            def sfx_step_callback(step: int, timestep: int, latents):
                cur = step + 1
                pct = 18 + int((cur / total_steps) * 76)
                emit_progress(f"Ses efekti sentezleniyor (Adim {cur}/{total_steps})...", pct, cur, total_steps)

            generator = torch.Generator(device=device).manual_seed(seed)
            with torch.inference_mode():
                audio_res = pipe(
                    prompt=effective_prompt,
                    negative_prompt=negative_prompt,
                    num_inference_steps=total_steps,
                    audio_length_in_s=sfx_duration,
                    guidance_scale=guidance,
                    generator=generator,
                    callback=sfx_step_callback,
                    callback_steps=1
                ).audios[0]

            emit_progress("Ses efekti WAV dosyasi kaydediliyor...", 97, total_steps, total_steps)
            elapsed = time.time() - start_time
            sys.stderr.write(f"Notice: {model_name} SFX generation complete in {elapsed:.1f}s!\n")

            audio_arr = np.asarray(audio_res, dtype=np.float32)
            max_val = np.max(np.abs(audio_arr))
            if max_val <= 0.001:
                raise RuntimeError(
                    f"{model_name} bu istem icin sessiz bir cikti uretti. Istemi degistirin veya AudioLDM 2 modellerini deneyin."
                )
            audio_arr = audio_arr / max_val * 0.95
            audio_arr = np.clip(audio_arr, -1.0, 1.0)
            sampling_rate = 16000
            sf.write(out_path, audio_arr, sampling_rate, subtype="PCM_16")
            emit_progress("Tamamlandi", 100, total_steps, total_steps)

            result = {
                "ok": True,
                "output": out_path,
                "duration": sfx_duration,
                "sampleRate": sampling_rate,
                "seed": seed,
                "model": model_id,
                "modelName": model_name,
                "repoId": repo_id,
                "effectivePrompt": effective_prompt,
                "genDuration": f"{elapsed:.1f}s",
                "isSfx": True
            }
            print(json.dumps(result), file=sys.stdout)
            return

        root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
        emit_progress(f"MusicGen ({model_id}) modeli belleğe yükleniyor...", 10, 0, duration)
        processor, model, resolved_model_id = load_musicgen_model(model_id, root_dir, device, dtype)

        effective_prompt = translate_and_enrich_prompt(raw_prompt, is_sfx=False)
        inputs = processor(
            text=[effective_prompt],
            padding=True,
            return_tensors="pt"
        ).to(device)

        sampling_rate = getattr(model.config.audio_encoder, "sampling_rate", 32000)

        from transformers import LogitsProcessor, LogitsProcessorList

        class TokenProgressProcessor(LogitsProcessor):
            def __init__(self, base_tokens: int, total_tokens: int, total_sec: int):
                self.base_tokens = base_tokens
                self.total_tokens = max(1, total_tokens)
                self.total_sec = total_sec
                self.cur_tokens = 0

            def __call__(self, input_ids, scores):
                self.cur_tokens += 1
                if self.cur_tokens % 12 == 0 or self.cur_tokens == 1:
                    done = self.base_tokens + self.cur_tokens
                    pct = 14 + int(min(1.0, done / self.total_tokens) * 82)
                    cur_sec = min(self.total_sec, int((done / self.total_tokens) * self.total_sec))
                    emit_progress(
                        f"Müzik sentezleniyor ({cur_sec}/{self.total_sec} sn)...",
                        pct,
                        cur_sec,
                        self.total_sec
                    )
                return scores

        # MusicGen has a 30s (1500 tokens) attention window.
        # For durations > 30s (up to 300s), synthesize in 25s chunks with 1.5s equal-power cosine crossfade.
        if duration <= 30:
            max_new_tokens = int(duration * 50)
            emit_progress(f"Müzik sentezleniyor (0/{duration} sn)...", 14, 0, duration)
            sys.stderr.write(
                f"Notice: Generating {duration}s music with {resolved_model_id} for prompt: '{effective_prompt}' (seed={seed}, tokens={max_new_tokens})...\n"
            )
            prog_proc = LogitsProcessorList([TokenProgressProcessor(0, max_new_tokens, duration)])
            with torch.inference_mode():
                audio_values = model.generate(
                    **inputs,
                    max_new_tokens=max_new_tokens,
                    do_sample=True,
                    guidance_scale=3.5,
                    temperature=1.0,
                    logits_processor=prog_proc
                )
            audio_tensor = audio_values[0, 0].cpu().float().numpy()
        else:
            chunk_sec = 25
            overlap_sec = 1.5
            effective_step_sec = chunk_sec - overlap_sec
            import math
            num_chunks = max(2, int(math.ceil((duration - overlap_sec) / effective_step_sec)))
            tokens_per_chunk = int(chunk_sec * 50)
            total_tokens_all = num_chunks * tokens_per_chunk

            sys.stderr.write(
                f"Notice: Generating long-form {duration}s music in {num_chunks} segments with {resolved_model_id}...\n"
            )
            chunks_audio = []
            overlap_samples = int(overlap_sec * sampling_rate)

            for idx in range(num_chunks):
                chunk_seed = seed + idx * 101
                torch.manual_seed(chunk_seed)
                if device == "cuda":
                    torch.cuda.manual_seed_all(chunk_seed)

                prog_proc = LogitsProcessorList([
                    TokenProgressProcessor(idx * tokens_per_chunk, total_tokens_all, duration)
                ])
                with torch.inference_mode():
                    chunk_vals = model.generate(
                        **inputs,
                        max_new_tokens=tokens_per_chunk,
                        do_sample=True,
                        guidance_scale=3.5,
                        temperature=1.0,
                        logits_processor=prog_proc
                    )
                chunk_np = chunk_vals[0, 0].cpu().float().numpy()
                chunks_audio.append(chunk_np)

            # Equal-power cosine crossfade stitching
            combined = chunks_audio[0]
            for idx in range(1, len(chunks_audio)):
                nxt = chunks_audio[idx]
                ov = min(overlap_samples, len(combined) // 4, len(nxt) // 4)
                if ov > 0:
                    t = np.linspace(0, np.pi / 2, ov, dtype=np.float32)
                    fade_out = np.cos(t)
                    fade_in = np.sin(t)
                    crossfaded = combined[-ov:] * fade_out + nxt[:ov] * fade_in
                    combined = np.concatenate([combined[:-ov], crossfaded, nxt[ov:]], axis=0)
                else:
                    combined = np.concatenate([combined, nxt], axis=0)

            target_samples = int(duration * sampling_rate)
            if len(combined) > target_samples:
                # Apply gentle 0.5s fade-out at the end
                combined = combined[:target_samples]
                tail = min(int(0.5 * sampling_rate), len(combined) // 10)
                if tail > 0:
                    combined[-tail:] *= np.linspace(1.0, 0.0, tail, dtype=np.float32)
            audio_tensor = combined

        emit_progress("Müzik dosyası kaydediliyor...", 98, duration, duration)
        elapsed = time.time() - start_time
        sys.stderr.write(f"Notice: MusicGen ({resolved_model_id}) generation complete in {elapsed:.1f}s!\n")

        max_val = np.max(np.abs(audio_tensor))
        if max_val > 0.001:
            audio_tensor = audio_tensor / max_val * 0.95
        audio_tensor = np.clip(audio_tensor, -1.0, 1.0)

        sf.write(out_path, audio_tensor, sampling_rate, subtype="PCM_16")
        emit_progress("Tamamlandı", 100, duration, duration)

        result = {
            "ok": True,
            "output": out_path,
            "duration": duration,
            "sampleRate": sampling_rate,
            "seed": seed,
            "model": resolved_model_id,
            "effectivePrompt": effective_prompt,
            "genDuration": f"{elapsed:.1f}s",
            "isSfx": False
        }
        print(json.dumps(result), file=sys.stdout)

    except Exception as e:
        sys.stderr.write(traceback.format_exc() + "\n")
        print(json.dumps({"ok": False, "error": str(e)}), file=sys.stdout)
        sys.exit(1)


if __name__ == "__main__":
    main()
