import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function resolveRuntimePackage(name) {
  const runtime = process.env.TTS_RUNTIME || "";
  if (runtime) {
    const pkg = path.join(runtime, "node_modules", name, "dist", "kokoro.js");
    return pathToFileUrl(pkg);
  }
  return name;
}

function pathToFileUrl(filePath) {
  const resolved = path.resolve(filePath).replace(/\\/g, "/");
  return `file:///${resolved.replace(/^\/+/, "")}`;
}

function numToTr(n) {
  n = parseInt(n, 10);
  if (isNaN(n)) return "";
  if (n === 0) return "sıfır";
  const ones = ["", "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz"];
  const tens = ["", "on", "yirmi", "otuz", "kırk", "elli", "altmış", "yetmiş", "seksen", "doksan"];
  let res = [];
  if (n >= 1000000) {
    const m = Math.floor(n / 1000000);
    res.push(m === 1 ? "bir milyon" : numToTr(m) + " milyon");
    n %= 1000000;
  }
  if (n >= 1000) {
    const k = Math.floor(n / 1000);
    res.push(k === 1 ? "bin" : numToTr(k) + " bin");
    n %= 1000;
  }
  if (n >= 100) {
    const h = Math.floor(n / 100);
    res.push(h === 1 ? "yüz" : ones[h] + " yüz");
    n %= 100;
  }
  if (n >= 10) {
    res.push(tens[Math.floor(n / 10)]);
    n %= 10;
  }
  if (n > 0) {
    res.push(ones[n]);
  }
  return res.filter(Boolean).join(" ");
}

function normalizeTurkishText(text) {
  if (!text) return "";
  let s = String(text);

  // Currency & Symbols
  s = s.replace(/(\d+)\s*(?:TL|tl|₺)/g, "$1 Türk Lirası");
  s = s.replace(/(\d+)\s*(?:\$|USD|usd)/g, "$1 dolar");
  s = s.replace(/(\d+)\s*(?:€|EUR|eur)/g, "$1 euro");
  s = s.replace(/%\s*(\d+)/g, "yüzde $1");

  // Abbreviations
  const abbrevs = {
    "dr\\.": "doktor",
    "prof\\.": "profesör",
    "av\\.": "avukat",
    "müh\\.": "mühendis",
    "cad\\.": "caddesi",
    "sok\\.": "sokağı",
    "mah\\.": "mahallesi",
    "apt\\.": "apartmanı",
    "no\\.": "numara",
    "vb\\.": "ve benzeri",
    "vs\\.": "ve saire",
    "bkz\\.": "bakınız",
    "ör\\.": "örneğin",
    "sn\\.": "saniye",
    "dk\\.": "dakika",
    "sa\\.": "saat",
    "km": "kilometre",
    "kg": "kilogram",
    "gr": "gram",
    "cm": "santimetre",
    "tb": "terabayt",
    "gb": "gigabayt",
    "mb": "megabayt"
  };
  for (const [k, v] of Object.entries(abbrevs)) {
    s = s.replace(new RegExp(`\\b${k}`, "gi"), v);
  }

  // Ordinal numbers (1., 2., 3.)
  s = s.replace(/\b(\d+)\./g, (m, p1) => numToTr(p1) + "inci");

  // Cardinal numbers
  s = s.replace(/\b\d+\b/g, (m) => numToTr(m));

  return s;
}

function turkishTextToIpa(rawText) {
  const norm = normalizeTurkishText(rawText);
  let ipa = "";
  const lower = norm.toLowerCase();
  const frontVowels = "eiöü";

  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i];
    const prev = i > 0 ? lower[i - 1] : "";
    switch (ch) {
      case "c": ipa += "ʤ"; break;
      case "ç": ipa += "ʧ"; break;
      case "ğ": ipa += frontVowels.includes(prev) ? "j" : "ː"; break;
      case "ı": ipa += "ɯ"; break;
      case "i": case "İ": ipa += "i"; break;
      case "ö": ipa += "œ"; break;
      case "ü": ipa += "y"; break;
      case "ş": ipa += "ʃ"; break;
      case "r": ipa += "ɾ"; break;
      case "a": ipa += "ɑ"; break;
      case "e": ipa += "e"; break;
      case "o": ipa += "o"; break;
      case "u": ipa += "u"; break;
      case "y": ipa += "j"; break;
      case "b": case "d": case "f": case "g": case "h": case "k": case "l": 
      case "m": case "n": case "p": case "s": case "t": case "v": case "z":
        ipa += ch; break;
      case " ": ipa += " "; break;
      case ".": ipa += ". "; break;
      case ",": ipa += ", "; break;
      case "!": ipa += "! "; break;
      case "?": ipa += "? "; break;
      case ";": ipa += "; "; break;
      case ":": ipa += ": "; break;
      default:
        if (/[a-zA-Z]/.test(ch)) ipa += ch;
        break;
    }
  }
  return ipa.replace(/\s+/g, " ").trim();
}

async function main() {
  const payload = JSON.parse(await readStdin());
  process.env.TRANSFORMERS_CACHE = payload.cacheDir || process.env.TRANSFORMERS_CACHE || "";
  process.env.HF_HOME = payload.cacheDir || process.env.HF_HOME || "";

  const kokoro = await import(resolveRuntimePackage("kokoro-js"));
  const { KokoroTTS } = kokoro;

  const tts = await KokoroTTS.from_pretrained(payload.modelId, {
    dtype: payload.dtype || "q8",
    device: "cpu",
  });
  const validVoices = [
    "af_heart", "af_alloy", "af_aoede", "af_bella", "af_jessica", "af_kore", "af_nicole", "af_nova",
    "af_river", "af_sarah", "af_sky", "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam",
    "am_michael", "am_onyx", "am_puck", "am_santa", "bf_emma", "bf_isabella", "bm_george",
    "bm_lewis", "bf_alice", "bf_lily", "bm_daniel", "bm_fable"
  ];
  let voiceToUse = payload.voice || "af_heart";
  const voiceLower = String(voiceToUse).toLowerCase();

  if (!validVoices.includes(voiceToUse)) {
    voiceToUse = /erkek|male/.test(voiceLower) ? "am_michael" : "af_heart";
  }

  // Kokoro has no Turkish voice. Turkish text is approximated with a phonetic (IPA) mapping;
  // everything else uses Kokoro's own English G2P.
  const isTurkish = payload.lang === "tr" || (payload.lang !== "en" && /[çğıöşüÇĞİÖŞÜ]/.test(payload.text || ""));
  let audio;

  if (isTurkish && tts.tokenizer && tts.generate_from_ids) {
    try {
      const turkishIpa = turkishTextToIpa(payload.text);
      const { input_ids } = tts.tokenizer(turkishIpa, { truncation: true });
      audio = await tts.generate_from_ids(input_ids, {
        voice: voiceToUse,
        speed: Number(payload.speed) || 1,
      });
    } catch (g2pErr) {
      // Fallback to standard generation if IPA tokenization encounters unknown symbol
      audio = await tts.generate(payload.text, {
        voice: voiceToUse,
        speed: Number(payload.speed) || 1,
      });
    }
  } else {
    audio = await tts.generate(payload.text, {
      voice: voiceToUse,
      speed: Number(payload.speed) || 1,
    });
  }

  await fs.mkdir(path.dirname(payload.output), { recursive: true });
  audio.save(payload.output);
  process.stdout.write(JSON.stringify({
    ok: true,
    output: payload.output,
    sampleRate: audio.sampling_rate || audio.sampleRate || 24000,
  }));
}

main().catch((err) => {
  process.stderr.write(err?.stack || err?.message || String(err));
  process.exit(1);
});
