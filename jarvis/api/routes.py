"""
Nova — REST API Routes
========================
All HTTP endpoints for chat, conversations, tasks, commands, security, etc.
"""

from typing import Optional
import os
import uuid
import asyncio
from pathlib import Path

from fastapi import APIRouter, Request, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel

router = APIRouter()

# ── TTS process tracking (module-level, single user) ──
_tts_proc: asyncio.subprocess.Process | None = None
_TTS_VOICE = "en-GB-RyanNeural"   # Microsoft Edge neural voice — British male, JARVIS-style


# ── TTS text preprocessing for natural speech ──

def _prep_tts_text(text: str) -> str:
    """Clean text so edge-tts reads it naturally without awkward pauses."""
    import re
    text = text.strip()
    # Remove markdown-style formatting
    text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)
    text = re.sub(r'\*(.+?)\*', r'\1', text)
    text = re.sub(r'`(.+?)`', r'\1', text)
    # Remove bullet points
    text = re.sub(r'^[\s]*[-•]\s+', '', text, flags=re.MULTILINE)
    # Collapse multiple newlines into one period (sentence boundary)
    text = re.sub(r'\n+', '. ', text)
    # Remove stray asterisks and underscores
    text = re.sub(r'[*_]{1,2}', '', text)
    # Collapse multiple spaces
    text = re.sub(r'\s{2,}', ' ', text)
    # Collapse multiple periods/ellipses
    text = re.sub(r'\.{2,}', '.', text)
    # Remove double periods from newline conversion
    text = re.sub(r'\.\s*\.', '.', text)
    # Ensure proper sentence spacing
    text = re.sub(r'\.(\S)', r'. \1', text)
    return text.strip()


# ── Request schemas ────────────────────────────────

class ChatReq(BaseModel):
    message: str
    conversation_id: Optional[int] = None
    voice_mode: bool = False

class ApprovalReq(BaseModel):
    approval_id: str

class TaskReq(BaseModel):
    title: str
    description: str = ""
    priority: str = "medium"

class TaskUpdateReq(BaseModel):
    status: str

class MemoryReq(BaseModel):
    key: str
    value: str = ""

class RenameReq(BaseModel):
    title: str

class TTSReq(BaseModel):
    text: str


def _m(r: Request):
    """Shortcut to get module dict from app state."""
    return r.app.state.modules


# ── Health ─────────────────────────────────────────

@router.get("/health")
async def health():
    return {"status": "ok", "service": "Nova"}


# ── TTS (neural voice via edge-tts + gst-play-1.0) ───────────────

@router.post("/tts")
async def tts(req: TTSReq):
    global _tts_proc
    # Kill any currently running speech
    if _tts_proc is not None:
        try:
            _tts_proc.kill()
            await _tts_proc.wait()
        except Exception:
            pass
        _tts_proc = None

    text = _prep_tts_text(req.text)
    if not text:
        return {"ok": True}

    tmp = f"/tmp/nova_tts_{uuid.uuid4().hex}.mp3"
    try:
        import edge_tts
        communicate = edge_tts.Communicate(
            text, _TTS_VOICE,
            rate="+8%",       # slightly faster for natural flow
            pitch="+0Hz",
        )
        await communicate.save(tmp)

        _tts_proc = await asyncio.create_subprocess_exec(
            "gst-play-1.0", "--no-interactive", tmp,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await _tts_proc.wait()
    except Exception as e:
        return {"ok": False, "error": str(e)}
    finally:
        _tts_proc = None
        try:
            os.unlink(tmp)
        except OSError:
            pass

    return {"ok": True}


@router.post("/tts/stop")
async def tts_stop():
    global _tts_proc
    if _tts_proc is not None:
        try:
            _tts_proc.kill()
            await _tts_proc.wait()
        except Exception:
            pass
        _tts_proc = None
    return {"ok": True}


# ── STT (speech-to-text — faster-whisper local, Google fallback) ───────

# Module-level model cache so it only loads once
_whisper_model = None

def _get_whisper():
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel
        # "base.en" is fast, accurate enough for voice commands, ~75MB
        _whisper_model = WhisperModel("base.en", device="cpu", compute_type="int8")
        print("[STT] faster-whisper model loaded (base.en)", flush=True)
    return _whisper_model


@router.post("/stt")
async def stt(file: UploadFile = File(...)):
    import tempfile, os, struct, wave, subprocess, shutil
    import numpy as np

    audio_data = await file.read()
    header = audio_data[:4] if len(audio_data) >= 4 else b''
    fname = file.filename or "audio.wav"
    is_wav = header == b'RIFF'
    print(f"[STT] received {len(audio_data)} bytes, header={header!r}, filename={fname!r}", flush=True)

    # Save debug copy for diagnostics
    debug_path = "/tmp/nova_debug_stt_input"
    try:
        debug_ext = '.wav' if is_wav else '.webm'
        with open(debug_path + debug_ext, 'wb') as df:
            df.write(audio_data)
    except Exception:
        pass

    ext = os.path.splitext(fname)[1] or ('.wav' if is_wav else '.webm')
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(audio_data)
        src_path = tmp.name

    wav_path = src_path

    # Convert non-WAV to WAV via GStreamer
    if not is_wav and shutil.which("gst-launch-1.0"):
        wav_path = src_path.rsplit('.', 1)[0] + '_conv.wav'
        try:
            result = subprocess.run(
                [
                    "gst-launch-1.0", "-q",
                    "filesrc", f"location={src_path}", "!",
                    "decodebin", "!",
                    "audioconvert", "!",
                    "audioresample", "!",
                    "audio/x-raw,format=S16LE,channels=1,rate=16000", "!",
                    "wavenc", "!",
                    "filesink", f"location={wav_path}",
                ],
                capture_output=True, timeout=15,
            )
            if result.returncode != 0:
                print(f"[STT] gst conversion failed: {result.stderr.decode(errors='replace')[:200]}", flush=True)
                wav_path = src_path
            else:
                print(f"[STT] converted {ext} → WAV via GStreamer", flush=True)
        except Exception as e:
            print(f"[STT] gst error: {e}", flush=True)
            wav_path = src_path

    # Log WAV properties
    try:
        with wave.open(wav_path, 'rb') as wf:
            nch, sw, fr, nframes = wf.getnchannels(), wf.getsampwidth(), wf.getframerate(), wf.getnframes()
            dur = nframes / fr if fr else 0
            raw = wf.readframes(nframes)
            peak = 0
            if sw == 2 and len(raw) >= 2:
                samps = struct.unpack(f'<{len(raw)//2}h', raw)
                peak = max(abs(s) for s in samps) if samps else 0
            print(f"[STT] WAV: {nch}ch {sw*8}bit {fr}Hz {nframes}frames {dur:.2f}s peak={peak}/32768", flush=True)
    except Exception as e:
        print(f"[STT] WAV parse warn: {e}", flush=True)

    text = ""
    try:
        # Primary: faster-whisper (local, offline, reliable)
        model = await asyncio.to_thread(_get_whisper)

        # Load WAV as float32 numpy array for faster-whisper
        with wave.open(wav_path, 'rb') as wf:
            fr = wf.getframerate()
            raw = wf.readframes(wf.getnframes())
            audio_np = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0

        def _transcribe():
            segments, info = model.transcribe(
                audio_np,
                language="en",
                beam_size=5,
                vad_filter=True,          # skip silent parts
                vad_parameters={"min_silence_duration_ms": 500},
            )
            return " ".join(seg.text for seg in segments).strip()

        text = await asyncio.to_thread(_transcribe)
        print(f"[STT] whisper heard: {text!r}", flush=True)

    except Exception as e:
        print(f"[STT] whisper error, falling back to Google: {e}", flush=True)
        # Fallback: Google free STT
        try:
            import speech_recognition as sr
            recognizer = sr.Recognizer()
            with sr.AudioFile(wav_path) as source:
                audio = recognizer.record(source)
            text = recognizer.recognize_google(audio)
            print(f"[STT] google heard: {text!r}", flush=True)
        except Exception as ge:
            print(f"[STT] google fallback also failed: {ge}", flush=True)
            text = ""

    finally:
        for p in (src_path, wav_path):
            if p != src_path or p == wav_path:
                try:
                    os.unlink(p)
                except Exception:
                    pass

    return {"text": text, "ok": True}


# ── Voice command detection (smart home + system) ───────────

import re as _re

_LIGHT_PATTERNS = [
    # on
    (_re.compile(r'\bturn\s+on\b.*\b(?:lights?|lamp|led)\b', _re.I), "govee_on", {}),
    (_re.compile(r'\b(?:lights?|lamp|led)\b.*\bturn\s+on\b', _re.I), "govee_on", {}),
    (_re.compile(r'\b(?:switch|put|get)\b.*\b(?:lights?|lamp|led)\b.*\bon\b', _re.I), "govee_on", {}),
    (_re.compile(r'\b(?:lights?|lamp|led)\b.*\b(?:on|up)\b', _re.I), "govee_on", {}),
    (_re.compile(r'\b(?:turn|switch|flip|put)\b.*\bon\b.*\b(?:lights?|lamp|led)\b', _re.I), "govee_on", {}),
    (_re.compile(r'\b(?:lights?|lamp|led)\s+on\b', _re.I), "govee_on", {}),
    (_re.compile(r'\bon\b.*\b(?:lights?|lamp|led)\b', _re.I), "govee_on", {}),
    # off
    (_re.compile(r'\bturn\s+off\b.*\b(?:lights?|lamp|led)\b', _re.I), "govee_off", {}),
    (_re.compile(r'\b(?:lights?|lamp|led)\b.*\bturn\s+off\b', _re.I), "govee_off", {}),
    (_re.compile(r'\b(?:switch|put|get)\b.*\b(?:lights?|lamp|led)\b.*\boff\b', _re.I), "govee_off", {}),
    (_re.compile(r'\b(?:lights?|lamp|led)\b.*\boff\b', _re.I), "govee_off", {}),
    (_re.compile(r'\b(?:turn|switch|flip|shut|kill|cut)\b.*\boff\b.*\b(?:lights?|lamp|led)\b', _re.I), "govee_off", {}),
    (_re.compile(r'\b(?:lights?|lamp|led)\s+off\b', _re.I), "govee_off", {}),
    (_re.compile(r'\boff\b.*\b(?:lights?|lamp|led)\b', _re.I), "govee_off", {}),
    (_re.compile(r'\b(?:shut|kill|cut)\s+(?:the\s+)?(?:lights?|lamp|led)\b', _re.I), "govee_off", {}),
]

_BRIGHTNESS_PAT = _re.compile(
    r'\b(?:set|change|make|put)\b.*\bbright(?:ness)?\b.*?\b(\d{1,3})\b', _re.I)
_BRIGHTNESS_PAT2 = _re.compile(
    r'\bbright(?:ness)?\b.*?\b(\d{1,3})\b', _re.I)
_COLOR_PAT = _re.compile(
    r'\b(?:set|change|make|turn)\b.*\b(?:lights?|lamp|color|colour)\b.*?\b(red|green|blue|purple|pink|yellow|orange|white|cyan|teal|magenta|lime|indigo|violet|coral|gold|lavender|turquoise|salmon|warm\s*white|sky\s*blue)\b', _re.I)
_COLOR_PAT2 = _re.compile(
    r'\b(?:lights?|lamp)\b.*?\b(red|green|blue|purple|pink|yellow|orange|white|cyan|teal|magenta|lime|indigo|violet|coral|gold|lavender|turquoise|salmon|warm\s*white|sky\s*blue)\b', _re.I)
_COLOR_HEX_PAT = _re.compile(r'#([0-9a-fA-F]{6})\b')
_LIST_PAT = _re.compile(r'\b(?:list|what|which)\b.*\b(?:lights?|govee|device)\b', _re.I)
_STATUS_PAT = _re.compile(r'\b(?:are|is)\b.*\b(?:lights?|lamp)\b.*\b(?:on|off)\b', _re.I)

# ── Light scene patterns ──
_SCENE_NAMES = r'(?:cosmic[_ ]?flow|sunset[_ ]?drift|northern[_ ]?lights|neon[_ ]?pulse|ocean[_ ]?abyss|lava)'
# "run sunset drift", "start the neon pulse scene", "play cosmic flow light show"
_SCENE_NAMED_PAT = _re.compile(
    r'\b(?:start|run|play|activate|do|launch|set)\b.*\b(' + _SCENE_NAMES + r')\b', _re.I)
# "start a light scene" / "run a light show" (no name → defaults to cosmic_flow)
_SCENE_GENERIC_PAT = _re.compile(
    r'\b(?:start|run|play|activate|do|launch|set)\b.*\b(?:light[_ ]?(?:scene|show)|scene|light[_ ]?show)\b', _re.I)
_SCENE_STOP_PAT = _re.compile(
    r'\b(?:stop|end|cancel|turn\s+off|kill)\b.*\b(?:light[_ ]?(?:scene|show)|scene|light[_ ]?show)\b', _re.I)
_SCENE_LIST_PAT = _re.compile(
    r'\b(?:list|what|which)\b.*\b(?:light[_ ]?)?(?:scenes?|shows?)\b', _re.I)

# ── Website / search patterns ──
_OPEN_URL_PAT = _re.compile(
    r'\b(?:open|go\s+to|pull\s+up|load|navigate\s+to|visit|show\s+me|bring\s+up)\s+(?:the\s+)?(?:website\s+)?'
    r'((?:https?://)?(?:www\.)?[\w\-]+\.[\w\-.]+(?:/\S*)?)', _re.I)
# Direct site names: "open youtube", "go to reddit", "pull up spotify"
_OPEN_SITE_PAT = _re.compile(
    r'\b(?:open|go\s+to|pull\s+up|load|navigate\s+to|visit|show\s+me|bring\s+up)\s+(?:the\s+)?'
    r'(youtube|reddit|twitter|x\.com|twitch|github|google|spotify|netflix|amazon|instagram|facebook|discord|tiktok|wikipedia|stack\s*overflow|gmail|hulu|chat\s*gpt)\b', _re.I)
_WEB_SEARCH_PAT = _re.compile(
    r'\b(?:search|google|look\s+up|find\s+(?:me\s+)?(?:info|information)?(?:\s+about|\s+on|\s+for)?)\b[\s:]+(.{3,80})', _re.I)

# ── "find me X" without info/about/for — broad fallback ──
# "find me something good to watch", "find me a good podcast"
_FIND_ME_PAT = _re.compile(
    r'\bfind\s+me\s+(?!(?:a\s+|an\s+|some\s+)?\S+\s+(?:website|web\s*site|site|page|web\s*page)\b)(.{4,80})', _re.I)

# ── Website/category discovery ──
# "find me a gaming website", "open a cooking site", "show me a news website"
_FIND_WEBSITE_PAT = _re.compile(
    r'\b(?:find|get|show|give|recommend|suggest|open|pull\s+up|bring\s+up)\s+(?:me\s+)?'
    r'(?:a\s+|an\s+|some\s+)?(?:good\s+|great\s+|cool\s+)?'
    r'(.{2,40}?)\s+(?:website|web\s*site|site|page|web\s*page)(?:s)?'
    r'(?:\s+(?:in\s+(?:my\s+)?(?:the\s+)?browser|online|for\s+me|to\s+browse|to\s+check\s+out))?\b', _re.I)

# Category → direct URL mapping for common site types
_CATEGORY_SITES = {
    # Gaming
    "gaming": "https://store.steampowered.com",
    "game": "https://store.steampowered.com",
    "games": "https://store.steampowered.com",
    "pc gaming": "https://store.steampowered.com",
    "free game": "https://store.epicgames.com/en-US/free-games",
    "free games": "https://store.epicgames.com/en-US/free-games",
    # News
    "news": "https://news.google.com",
    "world news": "https://news.google.com",
    "tech news": "https://www.theverge.com",
    "gaming news": "https://www.ign.com",
    "sports news": "https://www.espn.com",
    # Entertainment
    "movie": "https://www.imdb.com",
    "movies": "https://www.imdb.com",
    "tv show": "https://www.imdb.com",
    "tv shows": "https://www.imdb.com",
    "anime": "https://www.crunchyroll.com",
    "manga": "https://mangadex.org",
    "comic": "https://www.webtoons.com",
    "comics": "https://www.webtoons.com",
    # Cooking / Food
    "cooking": "https://www.allrecipes.com",
    "recipe": "https://www.allrecipes.com",
    "recipes": "https://www.allrecipes.com",
    "food": "https://www.allrecipes.com",
    # Music
    "music": "https://open.spotify.com",
    "podcast": "https://open.spotify.com",
    "podcasts": "https://open.spotify.com",
    # Shopping
    "shopping": "https://www.amazon.com",
    "deals": "https://slickdeals.net",
    "deal": "https://slickdeals.net",
    # Tech / Programming
    "tech": "https://www.theverge.com",
    "technology": "https://www.theverge.com",
    "coding": "https://github.com",
    "programming": "https://stackoverflow.com",
    "developer": "https://dev.to",
    # Sports
    "sports": "https://www.espn.com",
    "sport": "https://www.espn.com",
    "nfl": "https://www.nfl.com",
    "nba": "https://www.nba.com",
    # Learning
    "learning": "https://www.khanacademy.org",
    "education": "https://www.khanacademy.org",
    "course": "https://www.coursera.org",
    "courses": "https://www.coursera.org",
    # Finance
    "finance": "https://finance.yahoo.com",
    "stocks": "https://finance.yahoo.com",
    "crypto": "https://www.coinmarketcap.com",
    # Health / Fitness
    "health": "https://www.webmd.com",
    "fitness": "https://www.bodybuilding.com",
    "workout": "https://www.reddit.com/r/fitness",
    # Travel
    "travel": "https://www.tripadvisor.com",
    # Art / Creative
    "art": "https://www.deviantart.com",
    "design": "https://www.behance.net",
    "wallpaper": "https://wallhaven.cc",
    "wallpapers": "https://wallhaven.cc",
    # Social
    "forum": "https://www.reddit.com",
    "forums": "https://www.reddit.com",
    "meme": "https://www.reddit.com/r/memes",
    "memes": "https://www.reddit.com/r/memes",
}

# ── YouTube search / play patterns ──
_YT_SEARCH_PAT = _re.compile(
    r'\b(?:search|find|look\s+(?:up|for))\s+(?:on\s+)?(?:youtube|yt)\s+(?:for\s+)?(.{3,80})', _re.I)
_YT_SEARCH_PAT2 = _re.compile(
    r'\b(?:search|find|look\s+(?:up|for))\s+(.{3,80}?)\s+(?:on|in)\s+(?:youtube|yt)\b', _re.I)
_YT_PLAY_PAT = _re.compile(
    r'\b(?:play|put\s+on|watch)\s+(.{3,80}?)\s+(?:on|in|from)\s+(?:youtube|yt)\b', _re.I)
_YT_PLAY_PAT2 = _re.compile(
    r'\b(?:play|put\s+on|watch)\s+(?:on\s+)?(?:youtube|yt)\s+(.{3,80})', _re.I)

# ── Compound search-then-open pattern ──
# "look up the best dog cage then open it in amazon"
# "search for gaming keyboards and find them on amazon"
# "find the best headphones then show me on ebay"
_COMPOUND_SEARCH_SITE_PAT = _re.compile(
    r'\b(?:search|google|look\s+up|find)\s+(?:for\s+|me\s+)?(?:the\s+)?(.{3,80}?)\s+'
    r'(?:then|and)\s+(?:open|find|show|search|look|shop\s+for|get|buy)?\s*(?:it|them|that|those|the\s+results?)?\s*'
    r'(?:on|in|at|from|on\s+to)\s+'
    r'(amazon|ebay|walmart|target|best\s*buy|newegg|etsy|reddit|github|stack\s*overflow|wikipedia)\b', _re.I)
# "look up best dog cage on amazon" (direct site intent without "then")
_COMPOUND_SEARCH_SITE_PAT2 = _re.compile(
    r'\b(?:look\s+up|find|search\s+for|google)\s+(?:me\s+)?(?:the\s+)?(.{3,80}?)\s+'
    r'(?:on|in|at|from)\s+'
    r'(amazon|ebay|walmart|target|best\s*buy|newegg|etsy|reddit|github|stack\s*overflow|wikipedia)\b', _re.I)

# ── Site-specific search patterns ──
# "search amazon for gaming keyboard", "find headphones on ebay", "look up RTX 4090 on newegg"
_SITE_SEARCH_PAT = _re.compile(
    r'\b(?:search|find|look\s+(?:up|for)|shop\s+(?:for)?)\s+(?:on\s+)?'
    r'(amazon|ebay|walmart|target|best\s*buy|newegg|etsy|reddit|github|stack\s*overflow|wikipedia)\s+'
    r'(?:for\s+)?(.{3,80})', _re.I)
_SITE_SEARCH_PAT2 = _re.compile(
    r'\b(?:search|find|look\s+(?:up|for)|shop\s+(?:for)?)\s+'
    r'(.{3,80}?)\s+(?:on|in|at|from)\s+'
    r'(amazon|ebay|walmart|target|best\s*buy|newegg|etsy|reddit|github|stack\s*overflow|wikipedia)\b', _re.I)

# ── Web content reading patterns ──
# "read this page", "what does X say", "read the content of URL"
_WEB_READ_PAT = _re.compile(
    r'\b(?:read|fetch|get|summarize|summarise|what\s+does|what\'s\s+on)\s+(?:the\s+)?(?:content\s+(?:of|from|on)\s+)?(?:the\s+)?(?:page\s+(?:at\s+)?)?'
    r'((?:https?://)?(?:www\.)?[\w\-]+\.[\w\-.]+(?:/\S*)?)', _re.I)
_WEB_READ_PAT2 = _re.compile(
    r'\b(?:read|check|look\s+at)\s+(?:what(?:\'s)?\s+(?:on|at)\s+)?((?:https?://)?(?:www\.)?[\w\-]+\.[\w\-.]+(?:/\S*)?)', _re.I)

# ── Terminal / shell patterns ──
# Quoted command: run "ls -la" / run `git status`
_RUN_CMD_QUOTED_PAT = _re.compile(
    r'\b(?:run|execute)\s+(?:the\s+)?(?:command\s+)?["`\'](.*?)["`\']', _re.I)
# "run ls -la", "run git status", "execute pip install X"
_RUN_CMD_PAT = _re.compile(
    r'^(?:run|execute)\s+(?:the\s+)?(?:command\s+)?(?!(?:the|a|an)\b)([\w./~-][\w\s./\-=_:@$#+%^&*,"\'{}<>|`~?]*)$', _re.I)
# "run X in the terminal", "run X in terminal"
_RUN_CMD_TERMINAL_PAT = _re.compile(
    r'\b(?:run|execute)\s+(.{3,80}?)\s+in(?:\s+the)?\s+terminal\b', _re.I)
# "open a terminal", "open terminal"
_OPEN_TERMINAL_PAT = _re.compile(
    r'\b(?:open|launch|start)\s+(?:a\s+|the\s+)?terminal\b', _re.I)

# ── App patterns ──
_OPEN_APP_PAT = _re.compile(
    r'\b(?:open|launch|start|run)\s+(?:the\s+)?'
    r'(files?|file\s*manager|explorer|terminal|browser|chrome|firefox|code|vscode|spotify|discord|'
    r'calculator|calc|settings|system\s*settings|steam|obs|text\s*editor|notepad|'
    r'task\s*manager|system\s*monitor|vlc|gimp|slack|zoom|teams|'
    r'music|photos|videos|video\s*player|music\s*player)\b', _re.I)
# "open weather app" → open weather.com instead
_OPEN_WEATHER_PAT = _re.compile(r'\b(?:open|show\s+me|launch)\s+(?:the\s+)?weather(?:\s+app)?\b', _re.I)

# ── Volume patterns ──
_VOLUME_SET_PAT = _re.compile(
    r'\b(?:set|change|make|put)\b.*\bvol(?:ume)?\b.*?\b(\d{1,3})\b', _re.I)
_VOLUME_SET_PAT2 = _re.compile(
    r'\bvol(?:ume)?\b.*?\b(\d{1,3})\b', _re.I)
_VOLUME_UP_PAT = _re.compile(r'\b(?:turn|volume|vol)\s+(?:it\s+)?up\b', _re.I)
_VOLUME_DOWN_PAT = _re.compile(r'\b(?:turn|volume|vol)\s+(?:it\s+)?down\b', _re.I)
_VOLUME_MUTE_PAT = _re.compile(r'\b(?:mute|unmute|shut\s+up)\b', _re.I)

# ── Spotify patterns ──
_SPOTIFY_PLAY_PAT = _re.compile(
    r'\b(?:play|put\s+on)\s+(.+?)\s+(?:on|with|in|via|using)\s+spotify\b', _re.I)
_SPOTIFY_PLAY_PAT2 = _re.compile(
    r'\bspotify\s+play\s+(.+)', _re.I)
# Generic "play [something]" — routes to Spotify when connected
_SPOTIFY_PLAY_GENERIC = _re.compile(
    r'\b(?:play|put\s+on|throw\s+on|listen\s+to)\s+(?:some\s+)?(.+?)\s*$', _re.I)
# "play a song" / "play some music" / "play something" / "play a song from my playlist"
_SPOTIFY_PLAY_ANYTHING = _re.compile(
    r'\b(?:play|put\s+on)\s+(?:a\s+|some\s+|any\s+)?(?:song|music|track|something|anything)\b.*', _re.I)
_SPOTIFY_PAUSE_PAT = _re.compile(
    r'\b(?:pause|stop)\s+(?:the\s+)?(?:spotify|music|song)\b|\bspotify\s+(?:pause|stop)\b', _re.I)
_SPOTIFY_RESUME_PAT = _re.compile(
    r'\b(?:resume|unpause|continue)\s+(?:the\s+)?(?:spotify|music|song)\b|\bspotify\s+(?:resume|unpause|continue)\b', _re.I)
_SPOTIFY_NEXT_PAT = _re.compile(
    r'\b(?:next|skip)\s+(?:(?:the\s+)?(?:song|track)\s+)?(?:on\s+)?(?:spotify)?\b|\bspotify\s+(?:next|skip)\b', _re.I)
_SPOTIFY_PREV_PAT = _re.compile(
    r'\b(?:prev(?:ious)?|go\s+back)\s+(?:(?:the\s+)?(?:song|track)\s+)?(?:on\s+)?(?:spotify)?\b|\bspotify\s+(?:prev(?:ious)?|back)\b', _re.I)
_SPOTIFY_CURRENT_PAT = _re.compile(
    r'\b(?:what(?:\'?s)?\s+(?:playing|(?:this|the)\s+(?:song|track))|current(?:ly)?\s+playing|what\s+(?:song|track)\s+is\s+(?:this|playing))\b', _re.I)
_SPOTIFY_QUEUE_PAT = _re.compile(
    r'\b(?:queue|add\s+to\s+(?:the\s+)?queue)\s+(.+?)\s*(?:on\s+spotify)?\s*$|\bspotify\s+queue\s+(.+)', _re.I)

# ── Media patterns (fallback when Spotify not connected) ──
_MEDIA_PAUSE_PAT = _re.compile(r'\b(?:pause|resume|stop)\s*(?:the\s+)?(?:music|song|media|video|audio)?\b', _re.I)
_MEDIA_PLAY_PAT = _re.compile(r'\bplay\s*(?:the\s+)?(?:music|song|media|video|audio)\b', _re.I)
_MEDIA_NEXT_PAT = _re.compile(r'\b(?:next|skip)\s*(?:the\s+)?(?:song|track|music)?\b', _re.I)
_MEDIA_PREV_PAT = _re.compile(r'\b(?:prev(?:ious)?|go\s+back)\s*(?:the\s+)?(?:song|track|music)?\b', _re.I)

# ── Timer patterns ──
_TIMER_PAT = _re.compile(
    r'\b(?:set|start)\s+(?:a\s+)?timer\s+(?:for\s+)?(\d+)\s*(second|sec|minute|min|hour|hr)s?\b', _re.I)
_TIMER_PAT2 = _re.compile(
    r'\b(?:remind\s+me|wake\s+me|alert\s+me)\s+(?:in\s+)?(\d+)\s*(second|sec|minute|min|hour|hr)s?\b', _re.I)

# ── Screenshot patterns ──
_SCREENSHOT_PAT = _re.compile(r'\b(?:take|capture|grab)\s+(?:a\s+)?(?:screenshot|screen\s*shot|screen\s*cap)\b', _re.I)

# ── File find patterns ──
_FIND_FILE_PAT = _re.compile(
    r'\b(?:find|locate|where\s+is|search\s+for)\s+(?:the\s+)?(?:file\s+)?(?:named?\s+|called?\s+)?["\']?(.+?)["\']?\s*$', _re.I)

# ── System info patterns ──
_SYS_STATUS_PAT = _re.compile(
    r'\b(?:system|cpu|memory|ram|disk|computer)\s+(?:status|usage|info|stats|health)\b', _re.I)
_TIME_PAT = _re.compile(r'\b(?:what\s+)?(?:time|date)\s+(?:is\s+it)?\b', _re.I)

# ── Calendar patterns ──
_CAL_TODAY_PAT = _re.compile(
    r'\b(?:what(?:\'?s)?|show|get|check|any)\b.*\b(?:my\s+)?(?:schedule|calendar|events?|appointments?)\b.*\b(?:today|this\s+(?:morning|afternoon|evening))\b', _re.I)
_CAL_TODAY_PAT2 = _re.compile(
    r'\b(?:today|this\s+(?:morning|afternoon|evening))(?:\'?s)?\b.*\b(?:schedule|calendar|events?|appointments?)\b', _re.I)
_CAL_TOMORROW_PAT = _re.compile(
    r'\b(?:what(?:\'?s)?|show|get|check|any)\b.*\b(?:schedule|calendar|events?|appointments?)\b.*\btomorrow\b', _re.I)
_CAL_TOMORROW_PAT2 = _re.compile(
    r'\btomorrow(?:\'?s)?\b.*\b(?:schedule|calendar|events?|appointments?)\b', _re.I)
_CAL_UPCOMING_PAT = _re.compile(
    r'\b(?:what(?:\'?s)?|show|get|check)\b.*\b(?:upcoming|next|this\s+week)\b.*\b(?:schedule|calendar|events?|appointments?)\b', _re.I)
_CAL_UPCOMING_PAT2 = _re.compile(
    r'\b(?:upcoming|this\s+week)(?:\'?s)?\b.*\b(?:events?|schedule|appointments?)\b', _re.I)
_CAL_UPCOMING_PAT3 = _re.compile(
    r'\b(?:what(?:\'?s)?|do\s+i\s+have|show|get|check)\b.*\b(?:planned|schedule[d]?|calendar|events?|appointments?)\b.*\b(?:this\s+week|upcoming|next\s+\d+\s+days?)\b', _re.I)
_CAL_CREATE_PAT = _re.compile(
    r'\b(?:add|create|schedule|put|set\s+up|make)\b.*\b(?:event|appointment|meeting|reminder)\b.*?[:\-–]\s*(.{5,80})', _re.I)
_CAL_CREATE_PAT2 = _re.compile(
    r'\b(?:add|create|schedule|put)\b\s+(?:an?\s+)?(.{5,80}?)\s+(?:to|on|in)\s+(?:my\s+)?(?:calendar|schedule)\b', _re.I)
_CAL_CREATE_PAT3 = _re.compile(
    r'\b(?:add|create|schedule|put|make)\b.+\b(?:to|on|in)\s+(?:my\s+)?(?:calendar|schedule)\b', _re.I)

# ── Weather patterns ──
_WEATHER_PAT = _re.compile(
    r'\b(?:what(?:\'?s)?|how(?:\'?s)?|check|get)\b.*\b(?:the\s+)?(?:weather|temperature|temp|forecast)\b', _re.I)
_WEATHER_PAT2 = _re.compile(
    r'\b(?:weather|temperature|forecast)\b.*\b(?:today|now|outside|current)\b', _re.I)
_WEATHER_CITY_PAT = _re.compile(
    r'\bweather\s+(?:in|for|at)\s+([A-Za-z\s]{2,30})\b', _re.I)
_FORECAST_PAT = _re.compile(
    r'\b(?:forecast|weather)\b.*\b(?:this\s+week|next\s+\d+\s+days?|upcoming|week(?:ly)?)\b', _re.I)

# ── Google Docs patterns ──
_DOC_URL_PAT = _re.compile(r'(https?://docs\.google\.com/\S+|(?<!\w)[a-zA-Z0-9_-]{25,}(?!\w))', _re.I)
_DOC_READ_PAT = _re.compile(
    r'\b(?:read|open|get|show|fetch)\b.*\b(?:google\s+)?doc(?:ument)?\b.*?([\w-]{20,}|https?://docs\.google\.com/\S+)', _re.I)
_DOC_SUMMARY_PAT = _re.compile(
    r'\b(?:summarize|summary)\b.*\b(?:google\s+)?doc(?:ument)?\b.*?([\w-]{20,}|https?://docs\.google\.com/\S+)', _re.I)
# "can you see the google doc?" / "find the open google doc" / "what google doc is open?"
_DOC_IN_BROWSER_PAT = _re.compile(
    r'\b(?:see|check|find|look\s+at|detect|spot|view|access)\b.*\b(?:the\s+)?(?:google\s+)?doc(?:ument)?\b'
    r'|\b(?:what|which)\b.*\b(?:google\s+)?doc(?:ument)?\b.*\b(?:open|in\s+(?:my\s+)?browser|tab)\b'
    r'|\b(?:google\s+)?doc(?:ument)?\b.*\b(?:open|in\s+(?:my\s+)?browser|current\s+tab)\b', _re.I)
# "make up a story and write it to doc" / "create X and add it to my google doc URL"
_DOC_GEN_WRITE_PAT = _re.compile(
    r'\b(?:make(?:\s+up)?|create|generate|compose|draft)\b\s+(?:a\s+|an\s+)?(.{3,200}?)\s+'
    r'(?:and\s+)?(?:write|add|put|insert|append|save)\s+(?:it|that)\s+'
    r'(?:in(?:to)?|to)\s+(?:(?:my|the|that|this)\s+)?(?:google\s+)?doc(?:ument)?'
    r'(?:\s+([\w-]{20,}|https?://docs\.google\.com/\S+))?', _re.I)
# Write/append to doc — matches: "write X to my/that/the/this/open/current doc [URL]"
_DOC_WRITE_PAT = _re.compile(
    r'\b(?:write|add|append|put|insert)\b\s+(.{1,300}?)\s+(?:to|into|in(?:to)?|at\s+the\s+end\s+of)\s+'
    r'(?:(?:my|the|that|this|a|your|the\s+open|the\s+current|the\s+active)\s+)?(?:google\s+)?doc(?:ument)?'
    r'(?:\s+([\w-]{20,}|https?://docs\.google\.com/\S+))?', _re.I)
# "in [doc URL] write X" / "on this doc URL, add X"
_DOC_WRITE_PAT2 = _re.compile(
    r'(?:in|on|to)\s+([\w-]{25,}|https?://docs\.google\.com/\S+)\s+'
    r'(?:write|add|append|put|insert)\s+(.{1,300})', _re.I)
# Replace in doc: "replace X with Y in doc URL"
_DOC_REPLACE_PAT = _re.compile(
    r'\b(?:replace|change|swap|update)\b\s+["\']?(.{2,80}?)["\']?\s+(?:with|to)\s+["\']?(.{2,80}?)["\']?'
    r'\s+(?:in|on)\s+(?:(?:my|the|that|this)\s+)?(?:google\s+)?doc(?:ument)?'
    r'(?:\s+([\w-]{20,}|https?://docs\.google\.com/\S+))?', _re.I)
# Creative content markers — if captured content starts with one of these, it needs to be generated
_CREATIVE_NOUNS = _re.compile(
    r'^(?:me\s+)?(?:a\s+|an\s+)?(?:(?:short|long|brief|detailed|funny|scary|romantic|epic|creative)\s+)?'
    r'(?:story|store|tale|poem|song|essay|article|blog\s+post|paragraph|joke|riddle|letter|recipe|'
    r'description|review|speech|script|dialogue|haiku|sonnet|limerick|list|report|caption|summary)\b',
    _re.I)
# Detects creative generation phrasing: "as if you were", "like I was", "from the perspective of",
# "in the style of" — catches cases where the user describes WHAT to write, not the text itself
_CREATIVE_DESCRIPTION_PAT = _re.compile(
    r'\bas\s+if\b|\bfrom\s+(?:the\s+)?(?:perspective|point\s+of\s+view)\b'
    r'|\bin\s+the\s+style\s+of\b|\blike\s+(?:you|i)\s+(?:were|was|am)\b'
    r'|\bfrom\s+(?:my|your|his|her|their|a)\s+\w+\'s?\s+(?:point|perspective|view)\b',
    _re.I)
# Broad catch-all: user mentions writing + creative noun + doc URL anywhere in message
# "can you write me a story in my google doc in my browser write it about anything: URL"
_DOC_WRITE_BROAD = _re.compile(
    r'\b(?:write|add|create|compose|draft|put)\b\s+(?:me\s+)?(?:a\s+|an\s+)?'
    r'(?:(?:short|long|brief|detailed|funny|scary|romantic|epic|creative)\s+)?'
    r'(story|tale|poem|song|essay|article|blog\s+post|paragraph|joke|riddle|letter|'
    r'recipe|description|review|speech|script|dialogue|haiku|sonnet|limerick|list|report|caption|summary)'
    r'.*(?:doc(?:ument)?|docs\.google\.com)', _re.I)

def _extract_doc_id(raw: str) -> str:
    """Pull the bare document ID from a full Google Docs URL or return the raw string."""
    import re as _re2
    m = _re2.search(r'/document/d/([\w-]+)', raw)
    return m.group(1) if m else raw.strip('/')

async def _resolve_doc_id(doc_id: str, full_text: str = "") -> str:
    """Return doc_id as-is if non-empty; otherwise scan *full_text* for a
    Google Docs URL, then try the active browser tab, then DEFAULT_DOC_ID."""
    import os as _os
    import re as _re2
    if doc_id:
        return doc_id
    # Scan the full user message for a doc URL the pattern may have missed
    if full_text:
        m = _re2.search(r'docs\.google\.com/document/d/([\w-]+)', full_text)
        if m:
            return m.group(1)
    # Try *all* browser tabs first (not just the active one)
    try:
        from api.browser_bridge import is_connected, get_active_tab, send_command
        if is_connected():
            # Search every open tab for a Google Doc
            result = await send_command("get_tabs")
            if result and result.get("success"):
                for tab in result.get("tabs", []):
                    url = tab.get("url", "")
                    m = _re2.search(r'docs\.google\.com/document/d/([\w-]+)', url)
                    if m:
                        return m.group(1)
            # Fallback: cached active tab
            tab = get_active_tab()
            url = tab.get("url", "")
            if not url:
                res = await send_command("get_active_tab")
                url = res.get("tab", {}).get("url", "") if res.get("success") else ""
            m = _re2.search(r'docs\.google\.com/document/d/([\w-]+)', url)
            if m:
                return m.group(1)
    except Exception:
        pass
    # Fall back to last-used doc ID, then env var
    if _last_used_doc_id:
        return _last_used_doc_id
    return _os.environ.get("DEFAULT_DOC_ID", "")


# ── Last-used doc ID tracking ──
_last_used_doc_id: str = ""

# ── Last assistant response (for "write that to the doc" pronoun resolution) ──
_last_assistant_response: str = ""


def _remember_doc_id(doc_id: str) -> None:
    global _last_used_doc_id
    if doc_id:
        _last_used_doc_id = doc_id


def _set_last_response(text: str) -> None:
    global _last_assistant_response
    if text:
        _last_assistant_response = text


async def _generate_for_doc(topic: str) -> str:
    """Call Ollama directly to generate creative content for a doc.
    Uses the same config.yaml as the main AI engine.
    Streams the response to avoid httpx timeouts with large models."""
    import httpx as _hx
    import pathlib as _pl
    import json as _json
    # Load config to get the Ollama URL and model
    base_url = "http://127.0.0.1:11434"
    model    = "qwen2.5:32b"
    max_tokens = 2048
    try:
        import yaml as _yaml
        _cfg_path = _pl.Path(__file__).parent.parent / "config.yaml"
        if _cfg_path.exists():
            with open(_cfg_path) as _f:
                _cfg = _yaml.safe_load(_f) or {}
            base_url   = _cfg.get("ai", {}).get("ollama_url", base_url)
            model      = _cfg.get("ai", {}).get("model", model)
            max_tokens = _cfg.get("google_docs", {}).get("max_tokens", 2048)
    except Exception:
        pass
    try:
        # Use streaming to avoid timeout — each chunk resets the read timer
        chunks: list[str] = []
        async with _hx.AsyncClient(timeout=_hx.Timeout(connect=30, read=180, write=30, pool=30)) as client:
            async with client.stream(
                "POST",
                f"{base_url}/api/chat",
                json={
                    "model": model,
                    "messages": [
                        {
                            "role": "system",
                            "content": (
                                "You are Nova, an exceptionally talented creative writer. "
                                "Write vivid, engaging, well-structured content with depth and detail. "
                                "Use rich descriptions, interesting characters, and compelling narratives. "
                                "Make every piece feel polished and worth reading. "
                                "Output ONLY the content itself — no 'Here is your story:', "
                                "no preamble, no meta-commentary, no sign-off. Just the content. "
                                "Write at LEAST several substantial paragraphs. Never write just a few sentences."
                            ),
                        },
                        {"role": "user", "content": f"Write {topic}. Make it detailed, vivid, and substantial."},
                    ],
                    "stream": True,
                    "options": {"temperature": 0.8, "num_predict": max_tokens},
                },
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line:
                        continue
                    try:
                        obj = _json.loads(line)
                    except _json.JSONDecodeError:
                        continue
                    token = obj.get("message", {}).get("content", "")
                    if token:
                        chunks.append(token)
                    if obj.get("done"):
                        break
        result = "".join(chunks).strip()
        if not result:
            raise RuntimeError("Ollama returned empty response")
        return result
    except RuntimeError:
        raise
    except Exception as e:
        raise RuntimeError(f"Failed to generate content: {e}") from e


async def _stream_write_to_doc(doc_id: str, text: str) -> None:
    """Write text to a Google Doc word-by-word so it appears to type live.
    Runs the synchronous streaming API call in a thread pool to avoid
    blocking the async event loop."""
    import asyncio
    from integrations.google_docs import GoogleDocsClient
    docs = GoogleDocsClient()
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, docs.append_text_streaming, doc_id, text)


def _bg_doc_write(doc_id: str, topic: str, content: str | None = None):
    """Run a Google Doc generate-and-write in a background thread.
    When finished (or failed) pushes a proactive follow-up via the
    websocket broadcast so the user gets notified without blocking the chat.

    If `content` is provided it is written directly; otherwise `topic` is
    used to generate creative content first via Ollama.
    """
    import asyncio
    import logging
    _log = logging.getLogger(__name__)

    async def _do():
        try:
            text_to_write = content
            if text_to_write is None:
                text_to_write = await _generate_for_doc(topic)
            await _stream_write_to_doc(doc_id, "\n\n" + text_to_write)
            # Push success notification
            from api.websocket import broadcast_proactive
            await broadcast_proactive({
                "type": "proactive",
                "content": f"Done — I wrote {topic} to the Google Doc.",
                "category": "followup",
            })
        except Exception as e:
            _log.error(f"Background doc write failed: {e}", exc_info=True)
            from api.websocket import broadcast_proactive
            await broadcast_proactive({
                "type": "proactive",
                "content": f"Sorry, the doc write failed: {e}",
                "category": "followup",
            })

    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(_do())
    except Exception as e:
        _log.error(f"Background doc write thread error: {e}", exc_info=True)
    finally:
        loop.close()


# "look up repo owner/repo", "check out github.com/owner/repo", "what do you think of owner/repo"
_GITHUB_PAT = _re.compile(
    r'\b(?:look\s+(?:up|at|into)|check\s+out|review|analyze|analyse|what\s+(?:do\s+you\s+think|is)|tell\s+me\s+about|show\s+me|thoughts?\s+on|opinion\s+on)\b'
    r'.*?((?:https?://)?github\.com/[A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-]+|[A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-]+)', _re.I)
# "github repo owner/repo", "github owner/repo"
_GITHUB_PAT2 = _re.compile(
    r'\bgithub\s+(?:repo(?:sitory)?\s+)?((?:https?://)?github\.com/[A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-]+|[A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-]+)', _re.I)
# Direct github URL mentioned
_GITHUB_URL_PAT = _re.compile(
    r'(https?://github\.com/[A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-]+)', _re.I)

# ── Browser intelligence patterns ──
_BROWSER_READ_PAT = _re.compile(
    r'\b(?:read|analyze|extract|scrape|get\s+content)\b.*\b(?:page|website|site|content)\b.*?((?:https?://)?(?:www\.)?[\w\-]+\.[\w\-.]+(?:/\S*)?)', _re.I)
_BROWSER_INFO_PAT = _re.compile(
    r'\b(?:what\s+is|info|information|details|analyze)\b.*\b(?:about|on)\b.*?((?:https?://)?(?:www\.)?[\w\-]+\.[\w\-.]+(?:/\S*)?)', _re.I)

# ── Live browser queries (via Chrome extension bridge) ──
_BROWSER_WHAT_PAGE_PAT = _re.compile(
    r'\b(?:what|which)\b.*\b(?:page|tab|site|website|url)\b.*\b(?:open|on|have|viewing|looking|browsing|am\s+i)\b', _re.I)
_BROWSER_WHAT_PAGE_PAT2 = _re.compile(
    r'\b(?:what|which)\b.*\b(?:am\s+i|i\s+have)\b.*\b(?:open|on|looking|browsing|viewing)\b', _re.I)
_BROWSER_WHAT_PAGE_PAT3 = _re.compile(
    r'\b(?:what(?:\'?s)?)\s+(?:open|up)\s+(?:in|on)\s+(?:my\s+)?(?:tab)\b', _re.I)
_BROWSER_READ_CURRENT_PAT = _re.compile(
    r'\b(?:read|summarize|summarise|what(?:\'?s)?)\b.*\b(?:my|the|this|current)\b.*\b(?:page|tab|screen|browser|site)\b', _re.I)
_BROWSER_TYPE_PAT = _re.compile(
    r'\b(?:type|enter|put|write|input)\b\s+(?:in\s+)?[\"\']?(.{2,100})[\"\']?\s+(?:in(?:to)?|on)\s+(?:my\s+|the\s+)?(?:browser|page|search\s*bar|input|field|tab)\b', _re.I)
_BROWSER_TYPE_PAT2 = _re.compile(
    r'\b(?:type|enter|put|write|input)\b\s+[\"\'](.{2,100})[\"\']', _re.I)
_BROWSER_CLICK_PAT = _re.compile(
    r'\b(?:click|press|tap|hit)\b\s+(?:the\s+|on\s+)?(?:the\s+)?[\"\']?(.{2,60})[\"\']?\s*(?:button|link|tab)?\b', _re.I)
_BROWSER_SCROLL_PAT = _re.compile(
    r'\b(?:scroll)\b\s+(?:the\s+)?(?:page\s+)?(?:down|up|to\s+(?:the\s+)?(?:top|bottom))\b', _re.I)
_BROWSER_TABS_PAT = _re.compile(
    r'\b(?:what|which|list|show|how\s+many)\b.*\b(?:tabs?)\b.*\b(?:open|have|are)\b', _re.I)
# Broader: "what's open in my browser" / "what do I have open in chrome" → all tabs
_BROWSER_ALL_TABS_PAT = _re.compile(
    r'\b(?:what(?:\'?s)?|anything)\b.*\b(?:open|up)\b.*\b(?:browser|chrome|firefox|edge)\b', _re.I)

# ── Good Morning pattern ──
_MORNING_PAT = _re.compile(
    r'^\s*(?:hey\s+(?:nova|buddy)[,!.\s]*)?\s*good\s+mornin[g\']?\s*[.!]*\s*$', _re.I)

# ── Darklock / Pi5 patterns ──
_DARKLOCK_STATUS_PAT = _re.compile(
    r'\b(?:darklock|dark\s*lock)\b.*\b(?:status|health|check|up|down|running|online)\b', _re.I)
_DARKLOCK_STATUS_PAT2 = _re.compile(
    r'\b(?:check|how\'?s?|is)\b.*\b(?:darklock|dark\s*lock|server|servers)\b', _re.I)
_DARKLOCK_BUGS_PAT = _re.compile(
    r'\b(?:bug|bugs|bug\s*report|bug\s*reports|issues|tickets)\b.*\b(?:darklock|dashboard|admin)\b', _re.I)
_DARKLOCK_BUGS_PAT2 = _re.compile(
    r'\b(?:darklock|admin|dashboard)\b.*\b(?:bug|bugs|bug\s*report|bug\s*reports|issues|tickets)\b', _re.I)
_DARKLOCK_BUGS_PAT3 = _re.compile(
    r'\b(?:show|list|get|check|any|open)\b.*\b(?:bug|bugs|bug\s*report|bug\s*reports)\b', _re.I)
_DARKLOCK_RESTART_PAT = _re.compile(
    r'\b(?:restart|reboot|bring\s+back|start)\b.*\b(?:darklock|dark\s*lock|server|servers)\b', _re.I)
_DARKLOCK_RESTART_PAT2 = _re.compile(
    r'\b(?:darklock|dark\s*lock|server)\b.*\b(?:crash|crashed|down|restart|fix)\b', _re.I)
_DARKLOCK_LOGS_PAT = _re.compile(
    r'\b(?:darklock|server)\b.*\b(?:logs?|journal|output|errors?)\b', _re.I)
_PI5_HEALTH_PAT = _re.compile(
    r'\b(?:pi\s*5|raspberry|pi5|rpi|pi)\b.*\b(?:health|status|check|temp|temperature|how\'?s?)\b', _re.I)
_PI5_HEALTH_PAT2 = _re.compile(
    r'\b(?:check|how\'?s?)\b.*\b(?:pi\s*5|raspberry|pi5|rpi)\b', _re.I)


# ── Search query cleaning ──────────────────────────────────────────────────────
# Strips noise from captured search queries so the actual search is meaningful.
# "the best dog cage then open it in amazon" → "best dog cage"
# "for top gaming laptops 2026" → "top gaming laptops 2026"
_QUERY_TRAILING_CLAUSE = _re.compile(
    r'\s+(?:then|and\s+then|and\s+(?:open|find|show|search|look|shop|get|buy|check|go))\b.*$', _re.I)
_QUERY_LEADING_FILLER = _re.compile(
    r'^(?:for|about|up|me\s+the|me\s+|info\s+(?:on|about)|information\s+(?:on|about))\s+', _re.I)
_QUERY_LEADING_ARTICLE = _re.compile(r'^(?:the|a|an)\s+', _re.I)


def _clean_search_query(query: str) -> str:
    """Clean a raw search query captured by regex.

    Removes trailing multi-step clauses ('then open it in amazon'),
    leading filler words ('for', 'about'), and normalizes whitespace.
    """
    # Strip trailing clauses like "then open it on amazon"
    query = _QUERY_TRAILING_CLAUSE.sub('', query)
    # Strip leading filler: "for top gaming laptops" → "top gaming laptops"
    query = _QUERY_LEADING_FILLER.sub('', query)
    # Final cleanup
    query = query.strip(' .,!?')
    if not query:
        return query
    return query


def _parse_timer_seconds(amount_str: str, unit_str: str) -> int:
    amount = int(amount_str)
    unit = unit_str.lower()
    if unit.startswith("min"):
        return amount * 60
    elif unit.startswith("hour") or unit.startswith("hr"):
        return amount * 3600
    return amount


_SITE_URLS = {
    "youtube": "https://www.youtube.com", "reddit": "https://www.reddit.com",
    "twitter": "https://twitter.com", "x.com": "https://x.com",
    "twitch": "https://www.twitch.tv", "github": "https://github.com",
    "google": "https://www.google.com", "spotify": "https://open.spotify.com",
    "netflix": "https://www.netflix.com", "amazon": "https://www.amazon.com",
    "instagram": "https://www.instagram.com", "facebook": "https://www.facebook.com",
    "discord": "https://discord.com", "tiktok": "https://www.tiktok.com",
    "wikipedia": "https://www.wikipedia.org", "stackoverflow": "https://stackoverflow.com",
    "stack overflow": "https://stackoverflow.com", "gmail": "https://mail.google.com",
    "hulu": "https://www.hulu.com", "chatgpt": "https://chat.openai.com",
    "chat gpt": "https://chat.openai.com",
}


def _cmd_result(r: dict) -> str:
    """Extract a human-readable result from an executor response."""
    if r.get("success"):
        return r.get("result") or "Done."
    return r.get("result") or r.get("error") or "Command failed."


# Phrases that indicate the user is complaining or speaking conversationally ABOUT
# lights/commands, not actually issuing a command. Skip command detection for these.
_COMPLAINT_PAT = _re.compile(
    r'\b(?:you(?:\'?re|\s+are)\s+not|you\s+(?:can\'?t|cannot|don\'?t)|'
    r'why\s+(?:are|aren\'?t|don\'?t)|i\s+told\s+you|when\s+i\s+tell\s+you|'
    r'told\s+you\s+to|you\s+(?:never|always|keep|still)|fix\s+your|'
    r'not\s+working|doesn\'?t\s+work|won\'?t\s+(?:turn|open|start))\b', _re.I
)

async def _detect_voice_command(text: str, executor) -> str | None:
    """Try to detect smart home / system commands from natural speech.
    Handles multi-part requests by splitting on 'and'/'then'/'also'.
    """
    raw = text.strip()

    # If the text is too long to be a simple command, it's probably conversational
    # (raised to 350 to accommodate messages with Google Docs URLs)
    if len(raw) > 350:
        return None

    text = raw

    # Strip conversational prefixes so "can you open youtube" → "open youtube"
    text = _re.sub(
        r'^(?:hey\s+(?:nova|buddy)[,!.\s]*)?'
        r'(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)?'
        r'(?:please\s+)?'
        r'(?:i\s+(?:want|need)\s+(?:you\s+)?to\s+)?'
        r'(?:go\s+ahead\s+and\s+)?',
        '', text, flags=_re.I
    ).strip()

    # Also handle trailing "for me", "please" etc.
    text = _re.sub(r'\s+(?:for\s+me|please|thanks|thank\s+you)\s*[.!?]?\s*$', '', text, flags=_re.I).strip()

    # Normalize possessives: "my lights" → "the lights", "my room" → "the room"
    text = _re.sub(r'\bmy\b', 'the', text, flags=_re.I)

    # ── Compound intent detection (before multi-part splitting) ──
    # "look up X then open it on amazon" is ONE intent, not two.
    # Check compound patterns first so they don't get split incorrectly.
    m = _COMPOUND_SEARCH_SITE_PAT.search(text)
    if m:
        query = _clean_search_query(m.group(1).strip())
        site = m.group(2).strip().lower()
        r = await executor.execute({"type": "command", "action": "site_search", "args": {"site": site, "query": query}})
        return _cmd_result(r)
    m = _COMPOUND_SEARCH_SITE_PAT2.search(text)
    if m:
        query = _clean_search_query(m.group(1).strip())
        site = m.group(2).strip().lower()
        r = await executor.execute({"type": "command", "action": "site_search", "args": {"site": site, "query": query}})
        return _cmd_result(r)

    # ── Multi-part command splitting ──
    # "turn on the lights and make them blue" → two separate commands
    # Only split if the total text is short enough to be a real command sequence
    parts = _re.split(r'\s+(?:and\s+(?:then\s+)?|then\s+|also\s+)', text, flags=_re.I)
    if len(parts) > 1 and len(text) < 120:
        results = []
        last_query = None  # Track the search query for context passing
        for part in parts:
            part = part.strip()
            if not part or len(part) < 4:
                continue
            # Skip complaint/negative sub-parts
            if _COMPLAINT_PAT.search(part):
                continue
            # Handle referential commands ("open it on amazon" after a search)
            if last_query and _re.match(
                r'(?:open|find|show|search|look|shop\s+for|get|buy|check)\s*'
                r'(?:it|them|that|those|the\s+results?)?\s*'
                r'(?:on|in|at|from)\s+'
                r'(amazon|ebay|walmart|target|best\s*buy|newegg|etsy|reddit|github|stack\s*overflow|wikipedia)\b',
                part, _re.I
            ):
                site_m = _re.search(r'(amazon|ebay|walmart|target|best\s*buy|newegg|etsy|reddit|github|stack\s*overflow|wikipedia)\b', part, _re.I)
                if site_m:
                    site = site_m.group(1).strip().lower()
                    r = await executor.execute({"type": "command", "action": "site_search", "args": {"site": site, "query": last_query}})
                    results.append(_cmd_result(r))
                    continue
            single_result = await _detect_single_command(part, executor)
            if single_result:
                results.append(single_result)
                # Track the query from search commands for context passing
                search_m = _WEB_SEARCH_PAT.search(part)
                if search_m:
                    last_query = _clean_search_query(search_m.group(1).strip())
        if results:
            return " | ".join(results)
        # If multi-split found nothing, fall through to try the full text

    # Skip if it looks like a complaint about commands rather than an actual command
    if _COMPLAINT_PAT.search(raw):
        return None

    return await _detect_single_command(text, executor)


async def _detect_single_command(text: str, executor) -> str | None:
    """Detect and execute a single voice command from text."""

    # ── Light brightness ──
    m = _BRIGHTNESS_PAT.search(text) or _BRIGHTNESS_PAT2.search(text)
    if m:
        val = min(100, max(0, int(m.group(1))))
        r = await executor.execute({"type": "command", "action": "govee_brightness", "args": {"brightness": val}})
        return _cmd_result(r)

    # ── Light color (name) ──
    m = _COLOR_PAT.search(text) or _COLOR_PAT2.search(text)
    if m:
        color = m.group(1).strip()
        r = await executor.execute({"type": "command", "action": "govee_color", "args": {"color": color}})
        return _cmd_result(r)

    # ── Light color (hex) ──
    m = _COLOR_HEX_PAT.search(text)
    if m:
        r = await executor.execute({"type": "command", "action": "govee_color", "args": {"color": f"#{m.group(1)}"}})
        return _cmd_result(r)

    # ── Lights on/off ──
    for pat, action, extra_args in _LIGHT_PATTERNS:
        if pat.search(text):
            r = await executor.execute({"type": "command", "action": action, "args": extra_args})
            return _cmd_result(r)

    # ── Light scene stop ──  (check BEFORE generic light list/status)
    if _SCENE_STOP_PAT.search(text):
        r = await executor.execute({"type": "command", "action": "govee_scene", "args": {"scene": "stop"}})
        return _cmd_result(r)

    # ── Light scene list ──
    if _SCENE_LIST_PAT.search(text):
        r = await executor.execute({"type": "command", "action": "govee_scene", "args": {"scene": "list"}})
        return _cmd_result(r)

    # ── Light scene start (named first, then generic fallback) ──
    m = _SCENE_NAMED_PAT.search(text)
    if m:
        scene = m.group(1).strip()
        r = await executor.execute({"type": "command", "action": "govee_scene", "args": {"scene": scene}})
        return _cmd_result(r)

    if _SCENE_GENERIC_PAT.search(text):
        r = await executor.execute({"type": "command", "action": "govee_scene", "args": {"scene": "cosmic_flow"}})
        return _cmd_result(r)

    # ── Light list ──
    if _LIST_PAT.search(text):
        r = await executor.execute({"type": "command", "action": "govee_list", "args": {}})
        return _cmd_result(r)

    # ── Light status ──
    if _STATUS_PAT.search(text):
        r = await executor.execute({"type": "command", "action": "govee_status", "args": {}})
        return _cmd_result(r)

    # ── Good Morning ──
    if _MORNING_PAT.search(text):
        r = await executor.execute({"type": "command", "action": "good_morning", "args": {}})
        # Return the briefing verbatim with a MORNING_BRIEFING tag so the chat
        # handler sends it directly instead of letting the LLM rephrase it.
        result = _cmd_result(r)
        return f"MORNING_BRIEFING:\n{result}"

    # ── Calendar today ──
    if _CAL_TODAY_PAT.search(text) or _CAL_TODAY_PAT2.search(text):
        r = await executor.execute({"type": "command", "action": "calendar_today", "args": {}})
        return f"CALENDAR_DATA:\n{_cmd_result(r)}"

    # ── Calendar tomorrow ──
    if _CAL_TOMORROW_PAT.search(text) or _CAL_TOMORROW_PAT2.search(text):
        r = await executor.execute({"type": "command", "action": "calendar_tomorrow", "args": {}})
        return f"CALENDAR_DATA:\n{_cmd_result(r)}"

    # ── Calendar upcoming ──
    if _CAL_UPCOMING_PAT.search(text) or _CAL_UPCOMING_PAT2.search(text) or _CAL_UPCOMING_PAT3.search(text):
        r = await executor.execute({"type": "command", "action": "calendar_upcoming", "args": {}})
        return f"CALENDAR_DATA:\n{_cmd_result(r)}"

    # ── Calendar create (natural language) ──
    m = _CAL_CREATE_PAT.search(text) or _CAL_CREATE_PAT2.search(text) or _CAL_CREATE_PAT3.search(text)
    if m:
        r = await executor.execute({"type": "command", "action": "calendar_create", "args": {"text": text}})
        return _cmd_result(r)

    # ── Weather (with optional city) ──
    if _FORECAST_PAT.search(text):
        city_m = _WEATHER_CITY_PAT.search(text)
        args = {"days": 5}
        if city_m:
            args["city"] = city_m.group(1).strip()
        r = await executor.execute({"type": "command", "action": "weather_forecast", "args": args})
        return _cmd_result(r)

    if _WEATHER_PAT.search(text) or _WEATHER_PAT2.search(text):
        city_m = _WEATHER_CITY_PAT.search(text)
        args = {}
        if city_m:
            args["city"] = city_m.group(1).strip()
        r = await executor.execute({"type": "command", "action": "weather_current", "args": args})
        return _cmd_result(r)

    # ── Google Doc detection in browser ──
    if _DOC_IN_BROWSER_PAT.search(text):
        from api.browser_bridge import is_connected, get_active_tab, send_command
        if not is_connected():
            return "BROWSER_DATA:\nThe Nova Bridge Chrome extension isn't connected right now, so I can't see your browser tabs. Make sure the extension is running in Chrome."
        tab = get_active_tab()
        url  = tab.get("url", "")
        title = tab.get("title", "")
        if "docs.google.com/document" in url:
            doc_id = _re.search(r'/d/([\w-]+)', url)
            doc_id = doc_id.group(1) if doc_id else ""
            _remember_doc_id(doc_id)
            return f"BROWSER_DATA:\nYes — I can see a Google Doc open in Chrome: \"{title}\".\nDoc ID: {doc_id}\nURL: {url}"
        # Check all tabs
        result = await send_command("get_tabs")
        if result.get("success"):
            doc_tabs = [t for t in result.get("tabs", []) if "docs.google.com/document" in t.get("url", "")]
            if doc_tabs:
                t0 = doc_tabs[0]
                doc_id = _re.search(r'/d/([\w-]+)', t0.get("url", ""))
                doc_id = doc_id.group(1) if doc_id else ""
                _remember_doc_id(doc_id)
                return f"BROWSER_DATA:\nFound a Google Doc in your browser tabs: \"{t0.get('title', '?')}\".\nDoc ID: {doc_id}\nURL: {t0.get('url', '')}"
        return "BROWSER_DATA:\nI'm connected to Chrome but don't see any Google Docs open in your tabs right now."

    # ── Google Docs summary ──
    m = _DOC_SUMMARY_PAT.search(text)
    if m:
        doc_id = m.group(1).strip()
        r = await executor.execute({"type": "command", "action": "doc_summary", "args": {"doc_id": doc_id}})
        return _cmd_result(r)

    # ── Google Docs read ──
    m = _DOC_READ_PAT.search(text)
    if m:
        doc_id = m.group(1).strip()
        r = await executor.execute({"type": "command", "action": "doc_read", "args": {"doc_id": doc_id}})
        return _cmd_result(r)

    # ── Google Docs generate + write (make up X and write it to doc) ──
    m = _DOC_GEN_WRITE_PAT.search(text)
    if m:
        topic  = m.group(1).strip()
        raw_id = (m.group(2) or "").strip()
        doc_id = _extract_doc_id(raw_id) if raw_id else ""
        doc_id = await _resolve_doc_id(doc_id, text)
        if not doc_id:
            return "DOC_WRITE_DATA:\nERROR: No Google Doc found. Include the doc URL or open a Google Doc in Chrome."
        _remember_doc_id(doc_id)
        import threading
        threading.Thread(target=_bg_doc_write, args=(doc_id, topic), daemon=True).start()
        return f"DOC_WRITE_DATA:\nStarted writing {topic} to the doc. I'll let you know when it's done."

    # ── Google Docs write / append ──
    m = _DOC_WRITE_PAT2.search(text)
    if m:
        doc_id  = _extract_doc_id(m.group(1).strip())
        content = m.group(2).strip()
        doc_id  = await _resolve_doc_id(doc_id, text)
        if not doc_id:
            return "DOC_WRITE_DATA:\nERROR: No Google Doc URL found. Please include the doc URL."
        _remember_doc_id(doc_id)
        # Pronoun referencing the previous response — write it directly
        if content.lower() in ("it", "this", "that") and _last_assistant_response:
            import threading
            threading.Thread(target=_bg_doc_write, args=(doc_id, "previous response", _last_assistant_response), daemon=True).start()
            return "DOC_WRITE_DATA:\nStarted writing my previous response to the doc. I'll let you know when it's done."
        content = _re.sub(r'\s+(?:and\s+)?(?:write|put|add|paste)\s+it\b.*$', '', content, flags=_re.I).strip()
        if _CREATIVE_NOUNS.search(content) or _CREATIVE_DESCRIPTION_PAT.search(content):
            _about = _re.search(r'\babout\s+(.{2,200}?)(?:\s*[:\-]?\s*(?:https?://|$))', text, _re.I)
            topic = content
            if _about:
                topic = f"{content} about {_about.group(1).strip()}"
            import threading
            threading.Thread(target=_bg_doc_write, args=(doc_id, topic), daemon=True).start()
            return f"DOC_WRITE_DATA:\nStarted writing {topic} to the doc. I'll let you know when it's done."
        try:
            await _stream_write_to_doc(doc_id, "\n\n" + content)
        except Exception as e:
            return f"DOC_WRITE_DATA:\nERROR: Failed to write to doc: {e}"
        return "DOC_WRITE_DATA:\nWrote to the doc successfully."

    m = _DOC_WRITE_PAT.search(text)
    if m:
        content = m.group(1).strip()
        raw_id  = (m.group(2) or "").strip()
        doc_id  = _extract_doc_id(raw_id) if raw_id else ""
        doc_id  = await _resolve_doc_id(doc_id, text)
        if not doc_id:
            return "DOC_WRITE_DATA:\nERROR: No Google Doc URL found. Please include the doc URL."
        _remember_doc_id(doc_id)
        # Pronoun referencing the previous response — write it directly
        if content.lower() in ("it", "this", "that") and _last_assistant_response:
            import threading
            threading.Thread(target=_bg_doc_write, args=(doc_id, "previous response", _last_assistant_response), daemon=True).start()
            return "DOC_WRITE_DATA:\nStarted writing my previous response to the doc. I'll let you know when it's done."
        content = _re.sub(r'\s+(?:and\s+)?(?:write|put|add|paste)\s+it\b.*$', '', content, flags=_re.I).strip()
        if _CREATIVE_NOUNS.search(content) or _CREATIVE_DESCRIPTION_PAT.search(content):
            # Enrich topic with any "about X" clause from the full message
            _about = _re.search(r'\babout\s+(.{2,200}?)(?:\s*[:\-]?\s*(?:https?://|$))', text, _re.I)
            topic = content
            if _about:
                topic = f"{content} about {_about.group(1).strip()}"
            import threading
            threading.Thread(target=_bg_doc_write, args=(doc_id, topic), daemon=True).start()
            return f"DOC_WRITE_DATA:\nStarted writing {topic} to the doc. I'll let you know when it's done."
        try:
            await _stream_write_to_doc(doc_id, "\n\n" + content)
        except Exception as e:
            return f"DOC_WRITE_DATA:\nERROR: Failed to write to doc: {e}"
        return "DOC_WRITE_DATA:\nWrote to the doc successfully."

    # ── Google Docs broad catch-all (write a story … doc URL) ──
    m = _DOC_WRITE_BROAD.search(text)
    if m:
        creative_type = m.group(1).strip()          # e.g. "story", "poem"
        # Extract an "about X" topic from the full message
        _about_m = _re.search(r'\babout\s+(.{2,120}?)(?:\s*[:\-]?\s*https?://|\s*$)', text, _re.I)
        topic = f"a {creative_type} about {_about_m.group(1).strip()}" if _about_m else f"a {creative_type}"
        # Extract doc ID from the full message
        _url_m = _re.search(r'docs\.google\.com/document/d/([\w-]+)', text)
        doc_id = _url_m.group(1) if _url_m else ""
        doc_id = await _resolve_doc_id(doc_id, text)
        if not doc_id:
            return "DOC_WRITE_DATA:\nERROR: No Google Doc found. Include the doc URL or open a Google Doc in Chrome."
        _remember_doc_id(doc_id)
        import threading
        threading.Thread(target=_bg_doc_write, args=(doc_id, topic), daemon=True).start()
        return f"DOC_WRITE_DATA:\nStarted writing {topic} to the doc. I'll let you know when it's done."

    # ── Google Docs find & replace ──
    m = _DOC_REPLACE_PAT.search(text)
    if m:
        find_text    = m.group(1).strip()
        replace_text = m.group(2).strip()
        raw_id       = (m.group(3) or "").strip()
        doc_id       = _extract_doc_id(raw_id) if raw_id else ""
        doc_id       = await _resolve_doc_id(doc_id, text)
        if not doc_id:
            return "DOC_WRITE_DATA:\nERROR: No Google Doc URL found. Please include the doc URL."
        r = await executor.execute({"type": "command", "action": "doc_replace", "args": {"doc_id": doc_id, "find": find_text, "replace": replace_text}})
        return f"DOC_WRITE_DATA:\n{_cmd_result(r)}"

    # ── Live browser queries (via Chrome extension bridge) ────────────────────
    # These MUST come before the headless browser patterns so live queries
    # about "my current page" don't fall through to the headless reader.
    from api.browser_bridge import send_command, is_connected, get_active_tab

    if is_connected():
        # "what tabs do I have open?" / "what's open in my browser?"
        # Must come BEFORE what-page so "what's open in my browser" returns all tabs
        if _BROWSER_TABS_PAT.search(text) or _BROWSER_ALL_TABS_PAT.search(text):
            result = await send_command("get_tabs")
            if result.get("success"):
                tabs = result.get("tabs", [])
                lines = [f"{len(tabs)} tab(s) open:"]
                for t in tabs:
                    marker = " ← active" if t.get("active") else ""
                    lines.append(f"  {t.get('title', '?')[:60]}{marker}")
                return "BROWSER_DATA:\n" + "\n".join(lines)
            return "BROWSER_DATA:\nCouldn't list tabs."

        # "what page do I have open?" / "what tab am I on?"
        if (_BROWSER_WHAT_PAGE_PAT.search(text) or _BROWSER_WHAT_PAGE_PAT2.search(text)
                or _BROWSER_WHAT_PAGE_PAT3.search(text)):
            tab = get_active_tab()
            if tab.get("title") or tab.get("url"):
                return f"BROWSER_DATA:\n{tab.get('title', '?')} — {tab.get('url', '?')}"
            # Fallback: ask extension directly
            result = await send_command("get_active_tab")
            if result.get("success") and result.get("tab"):
                t = result["tab"]
                return f"BROWSER_DATA:\n{t.get('title', '?')} — {t.get('url', '?')}"
            return "BROWSER_DATA:\nCouldn't get active tab info."

        # "read my current page" / "what's on my screen" / "summarize this page"
        if _BROWSER_READ_CURRENT_PAT.search(text):
            result = await send_command("get_page_content", {"max_chars": 5000})
            if result.get("success"):
                title = result.get("title", "")
                url = result.get("url", "")
                page_text = result.get("text", "(no content)")
                if len(page_text) > 3000:
                    page_text = page_text[:3000] + "\n... [truncated]"
                return (f"BROWSER_DATA:\nPage: {title} ({url})\n"
                        f"Content:\n{page_text}")
            return "BROWSER_DATA:\nCouldn't read the page content."

        # "type X into the browser/search bar"
        m = _BROWSER_TYPE_PAT.search(text) or _BROWSER_TYPE_PAT2.search(text)
        if m:
            typed_text = m.group(1).strip().strip("'\"")
            result = await send_command("type_text", {"text": typed_text})
            if result.get("success"):
                return f"Typed \"{typed_text}\" into {result.get('element', 'the page')}."
            return f"Couldn't type — {result.get('error', 'no focused input found')}."

        # "click the Submit button" / "click Sign In"
        m = _BROWSER_CLICK_PAT.search(text)
        if m:
            click_text = m.group(1).strip().strip("'\"")
            result = await send_command("click_element", {"text": click_text})
            if result.get("success"):
                return f"Clicked \"{click_text}\"."
            return f"Couldn't find an element matching \"{click_text}\"."

        # "scroll down/up"
        if _BROWSER_SCROLL_PAT.search(text):
            direction = "down"
            if _re.search(r'\bup\b', text, _re.I):
                direction = "up"
            elif _re.search(r'\btop\b', text, _re.I):
                direction = "top"
            elif _re.search(r'\bbottom\b', text, _re.I):
                direction = "bottom"
            await send_command("scroll_page", {"direction": direction, "amount": 500})
            return f"Scrolled {direction}."

    # ── Browser read page (headless — for URLs) ──
    m = _BROWSER_READ_PAT.search(text)
    if m:
        url = m.group(1).strip()
        r = await executor.execute({"type": "command", "action": "browser_read", "args": {"url": url}})
        return _cmd_result(r)

    # ── Browser page info ──
    m = _BROWSER_INFO_PAT.search(text)
    if m:
        url = m.group(1).strip()
        r = await executor.execute({"type": "command", "action": "browser_info", "args": {"url": url}})
        return _cmd_result(r)

    # ── Open known site by name ("open youtube") ──
    m = _OPEN_SITE_PAT.search(text)
    if m:
        site = m.group(1).strip().lower()
        url = _SITE_URLS.get(site, f"https://www.{site}.com")
        r = await executor.execute({"type": "command", "action": "open_url", "args": {"url": url}})
        return _cmd_result(r)

    # ── Open URL ("open google.com") ──
    m = _OPEN_URL_PAT.search(text)
    if m:
        url = m.group(1).strip()
        r = await executor.execute({"type": "command", "action": "open_url", "args": {"url": url}})
        return _cmd_result(r)

    # ── YouTube search ("search youtube for X") ──
    m = _YT_SEARCH_PAT.search(text) or _YT_SEARCH_PAT2.search(text)
    if m:
        query = m.group(1).strip()
        r = await executor.execute({"type": "command", "action": "youtube_search", "args": {"query": query}})
        return _cmd_result(r)

    # ── YouTube play ("play X on youtube") ──
    m = _YT_PLAY_PAT.search(text) or _YT_PLAY_PAT2.search(text)
    if m:
        query = m.group(1).strip()
        r = await executor.execute({"type": "command", "action": "youtube_play", "args": {"query": query}})
        return _cmd_result(r)

    # ── Compound search-then-site ("look up X then open it on amazon") ──
    m = _COMPOUND_SEARCH_SITE_PAT.search(text)
    if m:
        query = _clean_search_query(m.group(1).strip())
        site = m.group(2).strip().lower()
        r = await executor.execute({"type": "command", "action": "site_search", "args": {"site": site, "query": query}})
        return _cmd_result(r)
    m = _COMPOUND_SEARCH_SITE_PAT2.search(text)
    if m:
        query = _clean_search_query(m.group(1).strip())
        site = m.group(2).strip().lower()
        r = await executor.execute({"type": "command", "action": "site_search", "args": {"site": site, "query": query}})
        return _cmd_result(r)

    # ── Site-specific search ("search amazon for X", "find X on ebay") ──
    m = _SITE_SEARCH_PAT.search(text)
    if m:
        site = m.group(1).strip().lower()
        query = _clean_search_query(m.group(2).strip())
        r = await executor.execute({"type": "command", "action": "site_search", "args": {"site": site, "query": query}})
        return _cmd_result(r)
    m = _SITE_SEARCH_PAT2.search(text)
    if m:
        query = _clean_search_query(m.group(1).strip())
        site = m.group(2).strip().lower()
        r = await executor.execute({"type": "command", "action": "site_search", "args": {"site": site, "query": query}})
        return _cmd_result(r)

    # ── Read webpage content ──
    m = _WEB_READ_PAT.search(text) or _WEB_READ_PAT2.search(text)
    if m:
        url = m.group(1).strip()
        r = await executor.execute({"type": "command", "action": "web_read", "args": {"url": url}})
        return _cmd_result(r)

    # ── GitHub repo lookup ──
    m = _GITHUB_PAT2.search(text) or _GITHUB_PAT.search(text) or _GITHUB_URL_PAT.search(text)
    if m:
        repo = m.group(1).strip()
        r = await executor.execute({"type": "command", "action": "github_repo", "args": {"repo": repo}})
        return _cmd_result(r)

    # ── Web search ("search for X", "google X") ──
    m = _WEB_SEARCH_PAT.search(text)
    if m:
        query = _clean_search_query(m.group(1).strip())
        r = await executor.execute({"type": "command", "action": "web_search", "args": {"query": query}})
        return _cmd_result(r)

    # ── Website/category discovery ("find me a gaming website", "open a news site") ──
    m = _FIND_WEBSITE_PAT.search(text)
    if m:
        import urllib.parse
        category = m.group(1).strip().lower()
        # Discard captures that are clearly not a category (backtrack artifacts)
        _JUNK_CATS = {'me a', 'me an', 'me some', 'me', 'a', 'an', 'some', 'good',
                      'great', 'cool', 'nice', 'awesome', 'me a good', 'me a great',
                      'me a cool', 'the', 'any', 'me any'}
        if category in _JUNK_CATS or len(category) < 3:
            category = ""
        if not category:
            # No recognizable category — let AI handle it
            pass
        else:
            # Check direct category mapping first
            url = _CATEGORY_SITES.get(category)
            if not url:
                # Try word-level match only (e.g. "online gaming" → "gaming")
                # Split both sides into words so "a" never matches inside "gaming"
                cat_words = set(category.split())
                for key, val in _CATEGORY_SITES.items():
                    key_words = set(key.split())
                    if key_words & cat_words:  # any word in common
                        url = val
                        break
            if url:
                r = await executor.execute({"type": "command", "action": "open_url", "args": {"url": url}})
                return _cmd_result(r)
            # Fallback: Google search for "[category] websites"
            search_url = f"https://www.google.com/search?q={urllib.parse.quote_plus(category + ' websites')}"
            r = await executor.execute({"type": "command", "action": "open_url", "args": {"url": search_url}})
            return _cmd_result(r)

    # ── "find me X" (broad: "find me something to watch", "find me a good podcast") ──
    m = _FIND_ME_PAT.search(text)
    if m:
        query = _clean_search_query(m.group(1).strip())
        r = await executor.execute({"type": "command", "action": "web_search", "args": {"query": query}})
        return _cmd_result(r)

    # ── Open app ──
    # Weather app special case — open weather.com
    if _OPEN_WEATHER_PAT.search(text):
        r = await executor.execute({"type": "command", "action": "open_url", "args": {"url": "https://weather.com"}})
        return _cmd_result(r)

    m = _OPEN_APP_PAT.search(text)
    if m:
        app_name = m.group(1).strip()
        r = await executor.execute({"type": "command", "action": "open_app", "args": {"name": app_name}})
        return _cmd_result(r)

    # ── Volume set ──
    m = _VOLUME_SET_PAT.search(text) or _VOLUME_SET_PAT2.search(text)
    if m:
        level = min(100, max(0, int(m.group(1))))
        r = await executor.execute({"type": "command", "action": "volume_set", "args": {"level": level}})
        return _cmd_result(r)

    # ── Volume up/down ──
    if _VOLUME_UP_PAT.search(text):
        r = await executor.execute({"type": "command", "action": "volume_set", "args": {"level": "+10"}})
        return _cmd_result(r)
    if _VOLUME_DOWN_PAT.search(text):
        r = await executor.execute({"type": "command", "action": "volume_set", "args": {"level": "-10"}})
        return _cmd_result(r)

    # ── Spotify / Music commands ──
    # Check if Spotify is configured (client exists) vs fully connected (authenticated)
    _spotify_configured = (hasattr(executor, '_spotify_client')
                           and executor._spotify_client is not None)
    _spotify_ok = (_spotify_configured
                   and executor._spotify_client.is_authenticated)

    # Explicit "on Spotify" requests always go to Spotify
    m = _SPOTIFY_PLAY_PAT.search(text) or _SPOTIFY_PLAY_PAT2.search(text)
    if m:
        query = (m.group(1) or "").strip()
        if query:
            r = await executor.execute({"type": "command", "action": "spotify_play", "args": {"query": query}})
            return _cmd_result(r)

    if _spotify_configured:
        # "play a song" / "play some music" / "play something from my playlist"
        if _SPOTIFY_PLAY_ANYTHING.search(text):
            r = await executor.execute({"type": "command", "action": "spotify_resume", "args": {}})
            return _cmd_result(r)

        # "pause the music" / "stop the song"
        if _SPOTIFY_PAUSE_PAT.search(text):
            r = await executor.execute({"type": "command", "action": "spotify_pause", "args": {}})
            return _cmd_result(r)

        if _SPOTIFY_RESUME_PAT.search(text):
            r = await executor.execute({"type": "command", "action": "spotify_resume", "args": {}})
            return _cmd_result(r)

        if _SPOTIFY_NEXT_PAT.search(text):
            r = await executor.execute({"type": "command", "action": "spotify_next", "args": {}})
            return _cmd_result(r)

        if _SPOTIFY_PREV_PAT.search(text):
            r = await executor.execute({"type": "command", "action": "spotify_prev", "args": {}})
            return _cmd_result(r)

        if _SPOTIFY_CURRENT_PAT.search(text):
            r = await executor.execute({"type": "command", "action": "spotify_current", "args": {}})
            return _cmd_result(r)

        m = _SPOTIFY_QUEUE_PAT.search(text)
        if m:
            query = (m.group(1) or m.group(2) or "").strip()
            if query:
                r = await executor.execute({"type": "command", "action": "spotify_queue", "args": {"query": query}})
                return _cmd_result(r)

        # Generic "play [query]" → search & play on Spotify
        m = _SPOTIFY_PLAY_GENERIC.search(text)
        if m:
            query = (m.group(1) or "").strip()
            # Filter out words that are just media control, not a search query
            _skip = {'music', 'song', 'track', 'something', 'anything', 'a song',
                     'some music', 'the music', 'the song', 'it', 'media', 'audio'}
            if query.lower() not in _skip and len(query) > 1:
                r = await executor.execute({"type": "command", "action": "spotify_play", "args": {"query": query}})
                return _cmd_result(r)

    # ── Media play/pause/next/prev (fallback when Spotify not connected) ──
    if _MEDIA_NEXT_PAT.search(text):
        r = await executor.execute({"type": "command", "action": "media_next", "args": {}})
        return _cmd_result(r)
    if _MEDIA_PREV_PAT.search(text):
        r = await executor.execute({"type": "command", "action": "media_prev", "args": {}})
        return _cmd_result(r)
    if _MEDIA_PAUSE_PAT.search(text) or _MEDIA_PLAY_PAT.search(text):
        r = await executor.execute({"type": "command", "action": "media_play_pause", "args": {}})
        return _cmd_result(r)

    # ── Timer ──
    m = _TIMER_PAT.search(text) or _TIMER_PAT2.search(text)
    if m:
        seconds = _parse_timer_seconds(m.group(1), m.group(2))
        r = await executor.execute({"type": "command", "action": "set_timer", "args": {"seconds": seconds}})
        return _cmd_result(r)

    # ── Screenshot ──
    if _SCREENSHOT_PAT.search(text):
        r = await executor.execute({"type": "command", "action": "screenshot", "args": {}})
        return _cmd_result(r)

    # ── Find files ──
    m = _FIND_FILE_PAT.search(text)
    if m:
        pattern = m.group(1).strip()
        r = await executor.execute({"type": "command", "action": "find_files", "args": {"pattern": pattern, "path": "~"}})
        return _cmd_result(r)

    # ── System status ──
    if _SYS_STATUS_PAT.search(text):
        r = await executor.execute({"type": "command", "action": "system_status", "args": {}})
        return _cmd_result(r)

    # ── Darklock status ──
    if _DARKLOCK_STATUS_PAT.search(text) or _DARKLOCK_STATUS_PAT2.search(text):
        r = await executor.execute({"type": "command", "action": "darklock_status", "args": {}})
        return _cmd_result(r)

    # ── Darklock bug reports ──
    if _DARKLOCK_BUGS_PAT.search(text) or _DARKLOCK_BUGS_PAT2.search(text) or _DARKLOCK_BUGS_PAT3.search(text):
        r = await executor.execute({"type": "command", "action": "darklock_bug_reports", "args": {}})
        return _cmd_result(r)

    # ── Darklock restart ──
    if _DARKLOCK_RESTART_PAT.search(text) or _DARKLOCK_RESTART_PAT2.search(text):
        r = await executor.execute({"type": "command", "action": "darklock_restart", "args": {}})
        return _cmd_result(r)

    # ── Darklock logs ──
    if _DARKLOCK_LOGS_PAT.search(text):
        r = await executor.execute({"type": "command", "action": "darklock_logs", "args": {}})
        return _cmd_result(r)

    # ── Pi5 health ──
    if _PI5_HEALTH_PAT.search(text) or _PI5_HEALTH_PAT2.search(text):
        r = await executor.execute({"type": "command", "action": "pi5_health", "args": {}})
        return _cmd_result(r)

    # ── Time / date ──
    if _TIME_PAT.search(text):
        r = await executor.execute({"type": "command", "action": "system_time", "args": {}})
        return _cmd_result(r)

    # ── Open terminal window ──
    if _OPEN_TERMINAL_PAT.search(text):
        r = await executor.execute({"type": "command", "action": "open_terminal", "args": {}})
        return _cmd_result(r)

    # ── Run terminal command ──
    # Quoted first: run "ls -la", execute `git status`
    m = _RUN_CMD_QUOTED_PAT.search(text)
    if m:
        command = m.group(1).strip()
        r = await executor.execute({"type": "command", "action": "run_command", "args": {"command": command}})
        return _cmd_result(r)

    # "run X in terminal"
    m = _RUN_CMD_TERMINAL_PAT.search(text)
    if m:
        command = m.group(1).strip()
        r = await executor.execute({"type": "command", "action": "run_command", "args": {"command": command}})
        return _cmd_result(r)

    # Plain: "run ls", "run git status", "execute pip list"
    m = _RUN_CMD_PAT.search(text)
    if m:
        command = m.group(1).strip()
        r = await executor.execute({"type": "command", "action": "run_command", "args": {"command": command}})
        return _cmd_result(r)

    return None


# ── Pi5 Security Reports ───────────────────────────

class Pi5ReportReq(BaseModel):
    title: str
    message: str
    level: str = "info"          # info | warning | critical
    service: str = ""
    source: str = "pi5-monitor"


@router.post("/pi5/report")
async def pi5_report(req: Pi5ReportReq, request: Request):
    """
    Receive a security / health report from the Pi5 nova-monitor and push
    it to all connected Nova UI clients as a proactive notification.
    """
    from api.websocket import broadcast_proactive

    level_emoji = {"info": "ℹ️", "warning": "⚠️", "critical": "🚨"}.get(req.level, "📡")
    service_tag = f" [{req.service}]" if req.service else ""

    content = f"{level_emoji} **Pi5{service_tag}:** {req.title}\n{req.message}"

    await broadcast_proactive({
        "type": "proactive",
        "content": content,
        "category": "pi5_report",
        "level": req.level,
        "service": req.service,
        "source": req.source,
    })

    return {"ok": True}


# ── Chat ───────────────────────────────────────────

@router.post("/chat")
async def chat(req: ChatReq, request: Request):
    print(f"[CHAT] msg={req.message!r} voice={req.voice_mode}", flush=True)
    m = _m(request)
    ai = m["ai_engine"]
    memory = m["memory"]
    executor = m["executor"]

    conv_id = req.conversation_id
    if not conv_id:
        conv_id = memory.create_conversation()

    memory.add_message(conv_id, "user", req.message)

    # Session continuity — track messages and auto-start sessions
    session_cont = m.get("session_continuity")
    if session_cont:
        session_cont.on_message(req.message, is_user=True)

    # Persistent memory — extract facts from every user message
    persistent_mem = m.get("persistent_memory")
    if persistent_mem:
        persistent_mem.extract_facts_from_message(req.message)

    # Emotional engine — react to user message
    emotions = m.get("emotions")
    if emotions:
        emotions.on_user_message(req.message)

    # Notify proactive engine that user is active
    proactive = m.get("proactive")
    if proactive:
        proactive.on_user_message()

    # Conversation awareness — track topic/entities for this conversation
    conv_awareness = m.get("conversation_awareness")
    if conv_awareness:
        conv_awareness.on_user_message(conv_id, req.message)

    # Detect smart home commands in ANY mode (voice or text)
    voice_cmd_result = None
    try:
        voice_cmd_result = await _detect_voice_command(req.message, executor)
        if voice_cmd_result:
            print(f"[CMD] {req.message!r} → {voice_cmd_result!r}", flush=True)
    except Exception as _vce:
        print(f"[CMD] error: {_vce}", flush=True)
        voice_cmd_result = f"Smart home command failed: {_vce}"

    # In voice mode, tell the AI to respond conversationally (no code/JSON)
    if req.voice_mode:
        # Calendar data: deliver real calendar data with strict no-hallucination
        if voice_cmd_result and voice_cmd_result.startswith("CALENDAR_DATA:\n"):
            cal_text = voice_cmd_result.removeprefix("CALENDAR_DATA:\n")
            voice_msg = (
                f"[VOICE MODE — Cayden asked about his calendar. "
                f"Read this calendar data EXACTLY as written. Do NOT add, invent, or make up "
                f"ANY events, meetings, or appointments that are not listed below. "
                f"If it says no events, tell him he has nothing scheduled. "
                f"Keep it natural and conversational. NEVER use markdown or bullet points.]\n\n"
                f"ACTUAL CALENDAR DATA (only report what is here):\n{cal_text}"
            )
            response = await ai.send_message(voice_msg)
        # Morning briefing: deliver the real data verbatim instead of
        # letting the LLM rephrase (and hallucinate extra details).
        elif voice_cmd_result and voice_cmd_result.startswith("MORNING_BRIEFING:\n"):
            briefing_text = voice_cmd_result.removeprefix("MORNING_BRIEFING:\n")
            voice_msg = (
                f"[VOICE MODE — Cayden just said good morning. "
                f"Read this morning briefing EXACTLY as written. Do NOT add, invent, or embellish "
                f"ANY information — no fake schedule items, no investments, no made-up events. "
                f"If the briefing says no events or no reminders, say that. "
                f"Keep it natural and conversational but stick STRICTLY to the facts below. "
                f"Use natural contractions. NEVER use markdown, bullet points, code blocks, or asterisk actions.]\n\n"
                f"BRIEFING DATA (read this to Cayden):\n{briefing_text}"
            )
            response = await ai.send_message(voice_msg)
        else:
            ctx = ""
            if voice_cmd_result:
                # Determine success: failed only if ALL indicators are negative
                _fail_words = ("failed", "error", "couldn't", "not found", "not set", "none of", "no lights found")
                _ok_words = ("Turned", "Set", "Opened", "Done", "light(s)", "Started", "Stopped", "Listed")
                result_lower = voice_cmd_result.lower()
                has_ok = any(w.lower() in result_lower for w in _ok_words)
                has_fail = any(w in result_lower for w in _fail_words)
                # If there's any success signal, treat it as success (offline warnings don't count as failure)
                if has_ok and not has_fail:
                    success = "succeeded"
                elif has_ok and has_fail:
                    success = "partially succeeded (some devices may be offline, which is normal)"
                else:
                    success = "failed"
                ctx = f" [You just ran a smart home command that {success}. System result: \"{voice_cmd_result}\". Report what happened briefly. Ignore any warnings about offline devices — those are always offline and Cayden knows. Focus on what DID work.]"
            voice_msg = (
                f"[VOICE MODE — Cayden is speaking to you. "
                f"Respond the way JARVIS would: composed, articulate, efficient. "
                f"Keep it SHORT — 1-3 sentences max. "
                f"Use natural contractions (I'm, don't, can't, won't, it's). "
                f"NEVER use markdown, bullet points, code blocks, JSON, or any formatting. "
                f"NEVER use asterisks for emphasis or actions like *pauses* or *thinks*. "
                f"Be direct and clean. Dry wit is welcome when it fits. "
                f"You're his personal AI — confident, sharp, subtly warm. "
                f"Don't repeat what Cayden just said back to him.{ctx}] {req.message}"
            )
            response = await ai.send_message(voice_msg)
    elif voice_cmd_result and voice_cmd_result.startswith("CALENDAR_DATA:\n"):
        # Text-mode calendar query — strict no-hallucination
        cal_text = voice_cmd_result.removeprefix("CALENDAR_DATA:\n")
        response = await ai.send_message(
            f"[SYSTEM: Cayden asked about his calendar. Present this data naturally. "
            f"Do NOT add, invent, or make up ANY events, meetings, or appointments. "
            f"If the data says no events, say he has nothing scheduled. "
            f"ONLY report what is listed below — nothing else.]\n\n"
            f"ACTUAL CALENDAR DATA:\n{cal_text}"
        )
    elif voice_cmd_result and voice_cmd_result.startswith("MORNING_BRIEFING:\n"):
        # Text-mode morning briefing — same treatment, stick to real data
        briefing_text = voice_cmd_result.removeprefix("MORNING_BRIEFING:\n")
        response = await ai.send_message(
            f"[SYSTEM: Cayden said good morning. Present this briefing naturally. "
            f"Do NOT add, invent, or embellish ANY information — no fake schedule items, "
            f"no investments, no made-up events. Stick to the facts below.]\n\n"
            f"BRIEFING DATA:\n{briefing_text}"
        )
    elif voice_cmd_result and voice_cmd_result.startswith("DOC_WRITE_DATA:\n"):
        # Doc write confirmation — tell user what happened, no creative generation
        doc_result = voice_cmd_result.removeprefix("DOC_WRITE_DATA:\n")
        if doc_result.startswith("ERROR:"):
            response = await ai.send_message(
                f"[SYSTEM: Cayden tried to write to a Google Doc but it failed. "
                f"Tell him this EXACT problem and ask him to include the doc URL next time. "
                f"Problem: {doc_result}. One sentence.]"
            )
        elif doc_result.startswith("Started"):
            # Don't call LLM — canned response to avoid blocking on Ollama
            # while the background doc write is also using Ollama
            response = "I'm on it — you'll see the text appear in your doc shortly."
        else:
            response = await ai.send_message(
                f"[SYSTEM: Cayden asked you to write something to his Google Doc. "
                f"The write completed successfully. Result: {doc_result}. "
                f"Confirm briefly in one sentence. Do NOT repeat or restate the content that was written. "
                f"Do NOT write any creative content. Just confirm it was added to the doc.]"
            )
    elif voice_cmd_result:
        # Don't send the user message to the AI (it was a command, not a question).
        # Just confirm the action was done. Keep it short and clear.
        response = await ai.send_message(
            f"[SYSTEM: A command was just run automatically. Result: {voice_cmd_result}. "
            f"Briefly confirm what was done to the user. Be specific and match the action: "
            f"if a URL was opened, say which site; if lights changed, say what changed; etc. "
            f"Do NOT confuse this with any previous commands. One sentence max.]"
        )
    else:
        response = await ai.send_message(req.message)

    # Strip any accidental JSON/code blocks/actions from voice responses
    if req.voice_mode:
        import re as _re
        response = _re.sub(r'```[\s\S]*?```', '', response).strip()
        response = _re.sub(r'\{[\s\S]*?\}', '', response).strip()
        # Strip *action* markers like *pauses*, *thinks*, *laughs*
        response = _re.sub(r'\*[^*]{1,40}\*', '', response).strip()
        # Strip markdown emphasis
        response = _re.sub(r'\*\*(.+?)\*\*', r'\1', response)
        response = _re.sub(r'\*(.+?)\*', r'\1', response)
        # Strip bullet points and numbered lists
        response = _re.sub(r'^[\s]*(?:[-•]|\d+\.)\s+', '', response, flags=_re.MULTILINE)
        # Collapse excessive whitespace
        response = _re.sub(r'\n{2,}', ' ', response)
        response = _re.sub(r'\s{2,}', ' ', response).strip()
        if not response:
            response = "Hmm, I'm not sure what to say to that."

    memory.add_message(conv_id, "assistant", response)
    _set_last_response(response)

    # Conversation awareness — track Nova's reply
    if conv_awareness:
        conv_awareness.on_nova_message(conv_id, response)

    # Background: LLM-powered memory extraction (doesn't block response)
    if persistent_mem:
        asyncio.create_task(
            persistent_mem.extract_memories_with_ai(req.message, response)
        )

    # Execute any commands embedded in the response (skip in voice mode)
    commands = ai.extract_commands(response) if not req.voice_mode else []
    cmd_results = []
    for cmd in commands:
        result = await executor.execute(cmd)
        cmd_results.append(result)

    # Strip JSON command blocks from the displayed response
    if commands:
        import re as _strip_re
        cleaned = _strip_re.sub(r'```json\s*\{[\s\S]*?\}\s*```', '', response)
        cleaned = _strip_re.sub(r'\{\s*"type"\s*:\s*"command"[\s\S]*?\}', '', cleaned)
        cleaned = cleaned.strip()
        # Build a summary of what was done
        summaries = []
        for r in cmd_results:
            if r.get("success") and r.get("result"):
                summaries.append(str(r["result"]))
            elif not r.get("success") and r.get("error"):
                summaries.append(f"Error: {r['error']}")
        if summaries:
            response = (cleaned + " " + " ".join(summaries)).strip() if cleaned else " ".join(summaries)
        elif cleaned:
            response = cleaned
        # else keep original response

    # Auto-title from first user message
    for c in memory.list_conversations():
        if c["id"] == conv_id and c["title"] == "New Conversation":
            title = req.message[:50] + ("..." if len(req.message) > 50 else "")
            memory.rename_conversation(conv_id, title)
            break

    return {
        "response": response,
        "conversation_id": conv_id,
        "commands": cmd_results,
    }


@router.post("/chat/new")
async def new_chat(request: Request):
    m = _m(request)

    # End the previous session (summarize it) before starting a new one
    session_cont = m.get("session_continuity")
    emotions = m.get("emotions")
    current_mood = emotions.state.dominant_feeling if emotions else "neutral"

    if session_cont:
        # Find the most recent conversation to summarize
        convs = m["memory"].list_conversations()
        if convs:
            session_cont.on_session_end(
                conversation_id=convs[0]["id"],
                current_mood=current_mood,
            )

    m["ai_engine"].clear_history()
    conv_id = m["memory"].create_conversation()

    # Start the new session
    if session_cont:
        session_cont.on_session_start(
            conversation_id=conv_id,
            current_mood=current_mood,
        )

    # Fresh session emotional boost
    if emotions:
        emotions.on_new_session()

    return {"conversation_id": conv_id}


# ── Conversations ──────────────────────────────────

@router.get("/conversations")
async def list_conversations(request: Request):
    return _m(request)["memory"].list_conversations()


@router.get("/conversations/{cid}/messages")
async def get_messages(cid: int, request: Request):
    return _m(request)["memory"].get_messages(cid)


@router.delete("/conversations/{cid}")
async def delete_conversation(cid: int, request: Request):
    _m(request)["memory"].delete_conversation(cid)
    return {"ok": True}


@router.patch("/conversations/{cid}")
async def rename_conversation(cid: int, req: RenameReq, request: Request):
    _m(request)["memory"].rename_conversation(cid, req.title)
    return {"ok": True}


# ── Command approval ──────────────────────────────

@router.get("/commands/pending")
async def pending_commands(request: Request):
    return _m(request)["executor"].list_pending()


@router.post("/commands/approve")
async def approve_command(req: ApprovalReq, request: Request):
    return await _m(request)["executor"].approve(req.approval_id)


@router.post("/commands/reject")
async def reject_command(req: ApprovalReq, request: Request):
    return _m(request)["executor"].reject(req.approval_id)


@router.get("/commands")
async def list_commands(request: Request):
    from commands.registry import CommandRegistry
    return CommandRegistry().list_commands()


# ── Tasks ──────────────────────────────────────────

@router.get("/tasks")
async def list_tasks(request: Request, status: Optional[str] = None):
    return _m(request)["memory"].get_tasks(status)


@router.post("/tasks")
async def add_task(req: TaskReq, request: Request):
    tid = _m(request)["memory"].add_task(req.title, req.description, req.priority)
    return {"id": tid}


@router.patch("/tasks/{tid}")
async def update_task(tid: int, req: TaskUpdateReq, request: Request):
    ok = _m(request)["memory"].update_task(tid, req.status)
    return {"ok": ok}


# ── Learning / self-improvement ────────────────────

@router.get("/improvements")
async def list_improvements(request: Request):
    return _m(request)["learning"].list_pending()


@router.post("/improvements/approve")
async def approve_improvement(req: ApprovalReq, request: Request):
    return _m(request)["learning"].approve(req.approval_id)


@router.post("/improvements/reject")
async def reject_improvement(req: ApprovalReq, request: Request):
    return _m(request)["learning"].reject(req.approval_id)


# ── Security ───────────────────────────────────────

@router.get("/security/status")
async def security_status(request: Request):
    m = _m(request)
    return {
        "process_watcher": m["watcher"].get_status(),
        "integrity": m["integrity"].get_status(),
    }


@router.post("/security/integrity/rescan")
async def integrity_rescan(request: Request):
    """Force an immediate file-integrity check of Nova + Darklock files."""
    changes = _m(request)["integrity"].rescan()
    return {"changes": changes}


@router.get("/security/logs")
async def security_logs(request: Request, count: int = 50):
    return _m(request)["audit"].recent(count, source="security")


# ── Audit trail ────────────────────────────────────

@router.get("/audit")
async def audit_logs(request: Request, count: int = 50, source: Optional[str] = None):
    return _m(request)["audit"].recent(count, source=source)


# ── Project manager ────────────────────────────────

@router.get("/project/scan")
async def project_scan(path: str, request: Request):
    return _m(request)["project_mgr"].scan(path)


@router.get("/project/todos")
async def project_todos(path: str, request: Request):
    return _m(request)["project_mgr"].extract_todos(path)


# ── Settings / personality ─────────────────────────

@router.get("/settings")
async def get_settings(request: Request):
    m = _m(request)
    cfg = m["config"]
    emotions = m.get("emotions")
    ai = m.get("ai_engine")
    return {
        "model": cfg.ai_model,
        "model_fast": cfg.ai_model_fast,
        "auto_route": cfg.ai_auto_route,
        "models": ai.active_models if ai else {},
        "temperature": cfg.ai_temperature,
        "voice_enabled": cfg.voice_enabled,
        "personality": cfg.get("personality.name"),
        "tone": cfg.get("personality.tone"),
        "emotion": emotions.state.to_dict() if emotions else None,
    }


@router.get("/models")
async def get_models(request: Request):
    ai = _m(request).get("ai_engine")
    if not ai:
        return {"error": "AI engine not available"}
    return ai.active_models


@router.post("/models/mode")
async def set_model_mode(request: Request):
    body = await request.json()
    mode = body.get("mode")  # "fast", "deep"/"heavy", "claude", "auto"
    # Normalize frontend alias
    if mode == "heavy":
        mode = "deep"
    ai = _m(request).get("ai_engine")
    if not ai:
        return {"error": "AI engine not available"}
    ai.set_mode(mode if mode not in ("auto", None) else None)
    return {"ok": True, "mode": mode, "models": ai.active_models}


# ── Security Pipeline Status ──────────────────────

@router.get("/pipeline/status")
async def pipeline_status():
    """Check the status of each security pipeline component."""
    import subprocess, shutil

    def _systemd_active(service: str) -> bool:
        try:
            r = subprocess.run(["systemctl", "is-active", service],
                               capture_output=True, text=True, timeout=3)
            return r.stdout.strip() == "active"
        except Exception:
            return False

    def _port_open(port: int) -> bool:
        import socket
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=2):
                return True
        except Exception:
            return False

    def _socket_exists(path: str) -> bool:
        return os.path.exists(path)

    steps = [
        {
            "step": 1, "name": "Falco + auditd",
            "installed": shutil.which("falco") is not None,
            "active": _systemd_active("falco"),
            "detail": "eBPF process/network monitoring",
        },
        {
            "step": 2, "name": "Vector",
            "installed": shutil.which("vector") is not None,
            "active": _systemd_active("vector-agent") or _systemd_active("vector-aggregator"),
            "detail": "Log aggregation & routing",
        },
        {
            "step": 3, "name": "8B Triage",
            "installed": True,
            "active": _port_open(8089),
            "detail": "Fast event classification on :8089",
        },
        {
            "step": 4, "name": "Redis Queue",
            "installed": shutil.which("redis-server") is not None,
            "active": _socket_exists("/var/run/redis/redis.sock"),
            "detail": "Unix socket event broker",
        },
        {
            "step": 5, "name": "32B Security Analyst",
            "installed": True,
            "active": _systemd_active("jarvis-security-analyst"),
            "detail": "Deep threat analysis + correlation",
        },
        {
            "step": 6, "name": "Playbook Runner",
            "installed": True,
            "active": _socket_exists("/var/run/playbook-runner.sock"),
            "detail": "Automated response execution",
        },
        {
            "step": 7, "name": "Hardening",
            "installed": os.path.exists("/var/lib/security-pipeline/jarvis-integrity.sha256"),
            "active": _systemd_active("jarvis-watchdog") or _systemd_active("jarvis-integrity.timer"),
            "detail": "Heartbeat, integrity, fallback",
        },
        {
            "step": 8, "name": "Claude Expert",
            "installed": bool(os.environ.get("ANTHROPIC_API_KEY", "")),
            "active": bool(os.environ.get("ANTHROPIC_API_KEY", "")),
            "detail": "Optional cloud escalation",
        },
        {
            "step": 9, "name": "Stress Tests",
            "installed": os.path.exists(os.path.expanduser("~/discord bot/discord bot/security-pipeline/step9-stress-test/run_pipeline_tests.sh")),
            "active": None,
            "detail": "Attack simulation suite",
        },
        {
            "step": 10, "name": "Injection Tests",
            "installed": os.path.exists(os.path.expanduser("~/discord bot/discord bot/security-pipeline/step10-injection-tests/injection_test_harness.py")),
            "active": _systemd_active("injection-test.timer"),
            "detail": "Weekly prompt injection testing",
        },
    ]

    fallback_active = os.path.exists("/var/run/security-pipeline/fallback-active")

    return {
        "steps": steps,
        "fallback_active": fallback_active,
        "deployed_count": sum(1 for s in steps if s["active"]),
        "installed_count": sum(1 for s in steps if s["installed"]),
        "total": len(steps),
    }


# ── Alerts / Anomaly Detection ────────────────────

@router.get("/alerts")
async def get_alerts(request: Request, unread: bool = False, count: int = 50):
    anomaly = _m(request).get("anomaly")
    if not anomaly:
        return []
    return anomaly.get_alerts(unread_only=unread, count=count)


@router.get("/alerts/count")
async def alert_count(request: Request):
    anomaly = _m(request).get("anomaly")
    return {"unread": anomaly.get_unread_count() if anomaly else 0}


@router.post("/alerts/{alert_id}/ack")
async def acknowledge_alert(alert_id: str, request: Request):
    anomaly = _m(request).get("anomaly")
    if anomaly:
        return {"ok": anomaly.acknowledge_alert(alert_id)}
    return {"ok": False}


@router.post("/alerts/ack-all")
async def acknowledge_all_alerts(request: Request):
    anomaly = _m(request).get("anomaly")
    if anomaly:
        anomaly.acknowledge_all()
    return {"ok": True}


# ── Project Indexer ────────────────────────────────

class IndexReq(BaseModel):
    path: str

@router.post("/index")
async def index_project(req: IndexReq, request: Request):
    indexer = _m(request).get("indexer")
    if not indexer:
        return {"error": "Indexer not available"}
    return indexer.index_directory(req.path)


@router.get("/index/overview")
async def index_overview(request: Request):
    indexer = _m(request).get("indexer")
    if not indexer:
        return {"overview": None}
    return {"overview": indexer.get_project_overview()}


# ── Persistent Memory ─────────────────────────────

@router.get("/memory/profile")
async def user_profile(request: Request):
    pm = _m(request).get("persistent_memory")
    return pm.get_all_user_facts() if pm else {}


@router.get("/memory/recent")
async def recent_memories(request: Request, count: int = 20):
    pm = _m(request).get("persistent_memory")
    return pm.get_recent_memories(count) if pm else []


@router.get("/memory/search")
async def search_memories(request: Request, q: str):
    pm = _m(request).get("persistent_memory")
    return pm.recall(q) if pm else []


@router.get("/memory/all")
async def all_memories(request: Request, limit: int = 100):
    pm = _m(request).get("persistent_memory")
    return pm.get_all_memories(limit) if pm else []


@router.get("/memory/stats")
async def memory_stats(request: Request):
    pm = _m(request).get("persistent_memory")
    return pm.get_memory_stats() if pm else {}


@router.delete("/memory/{memory_id}")
async def delete_memory(memory_id: int, request: Request):
    pm = _m(request).get("persistent_memory")
    if not pm:
        return {"ok": False}
    return {"ok": pm.forget(memory_id)}


@router.delete("/memory/profile/{key}")
async def delete_profile_fact(key: str, request: Request):
    pm = _m(request).get("persistent_memory")
    if not pm:
        return {"ok": False}
    return {"ok": pm.delete_user_fact(key)}


@router.post("/memory/remember")
async def explicit_remember(req: MemoryReq, request: Request):
    pm = _m(request).get("persistent_memory")
    if not pm:
        return {"ok": False}
    pm.remember("explicit", req.key, req.value, importance=8, source="user_explicit")
    return {"ok": True}


@router.post("/memory/decay")
async def trigger_decay(request: Request):
    pm = _m(request).get("persistent_memory")
    if not pm:
        return {"affected": 0}
    affected = pm.decay_old_memories()
    return {"affected": affected}


# ── Emotional State ────────────────────────────────

@router.get("/emotion")
async def get_emotion(request: Request):
    emotions = _m(request).get("emotions")
    if not emotions:
        return {"state": None}
    return {
        "state": emotions.state.to_dict(),
        "feeling": emotions.state.dominant_feeling,
        "greeting": emotions.get_greeting_modifier(),
    }


# ── File Watcher ───────────────────────────────────

@router.get("/watcher/status")
async def watcher_status(request: Request):
    fw = _m(request).get("file_watcher")
    return fw.get_status() if fw else {"running": False}


@router.get("/watcher/events")
async def watcher_events(request: Request, count: int = 50):
    fw = _m(request).get("file_watcher")
    return fw.get_recent_events(count) if fw else []


# ── Image Upload ───────────────────────────────────

UPLOAD_DIR = Path(__file__).parent.parent / "data" / "uploads"
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


@router.post("/upload")
async def upload_image(request: Request, file: UploadFile = File(...)):
    ext = Path(file.filename or "image.png").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        return {"error": "Unsupported file type"}

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        return {"error": "File too large (max 10MB)"}

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}{ext}"
    filepath = UPLOAD_DIR / filename
    filepath.write_bytes(content)

    # Use vision engine for real image description if available
    description = f"{file.filename} ({len(content) // 1024}KB image)"
    vision = _m(request).get("vision_engine")
    if vision and vision.enabled:
        try:
            vision_desc = await vision.describe_image(content)
            if vision_desc and not vision_desc.startswith("[Vision error"):
                description = vision_desc
        except Exception:
            pass

    return {
        "url": f"/api/uploads/{filename}",
        "filename": filename,
        "description": description,
    }


@router.get("/uploads/{filename}")
async def serve_upload(filename: str):
    # Sanitize: only allow simple filenames
    safe = Path(filename).name
    filepath = UPLOAD_DIR / safe
    if not filepath.exists() or not filepath.is_file():
        return {"error": "Not found"}
    return FileResponse(filepath)


# ══════════════════════════════════════════════════════
#  LEARNING SYSTEM — Feedback, Patterns, Training
# ══════════════════════════════════════════════════════


class FeedbackReq(BaseModel):
    conv_id: int
    signal: str             # positive, negative, correction, preference
    user_msg: str = ""
    nova_msg: str = ""
    correction: str = ""
    category: str = "general"
    strength: float = 1.0
    message_id: Optional[int] = None


class TrainingEditReq(BaseModel):
    nova_msg: str


@router.post("/learning/feedback")
async def submit_feedback(req: FeedbackReq, request: Request):
    sl = _m(request).get("supervised_learning")
    if not sl:
        return {"error": "Learning system not available"}
    fid = sl.record_feedback(
        conv_id=req.conv_id, signal=req.signal, user_msg=req.user_msg,
        nova_msg=req.nova_msg, correction=req.correction,
        category=req.category, strength=req.strength, message_id=req.message_id,
    )
    return {"ok": True, "feedback_id": fid}


@router.get("/learning/feedback")
async def get_feedback(request: Request, limit: int = 50):
    sl = _m(request).get("supervised_learning")
    return sl.get_feedback_summary(limit) if sl else []


@router.get("/learning/stats")
async def learning_stats(request: Request):
    sl = _m(request).get("supervised_learning")
    return sl.get_training_stats() if sl else {}


# ── Patterns ──

@router.get("/learning/patterns")
async def get_patterns(request: Request, limit: int = 30):
    sl = _m(request).get("supervised_learning")
    return sl.get_active_patterns(limit) if sl else []


@router.post("/learning/patterns/{pattern_id}/deactivate")
async def deactivate_pattern(pattern_id: int, request: Request):
    sl = _m(request).get("supervised_learning")
    if sl:
        sl.deactivate_pattern(pattern_id)
    return {"ok": True}


@router.post("/learning/patterns/discover")
async def discover_patterns(request: Request):
    sl = _m(request).get("supervised_learning")
    if not sl:
        return {"error": "Learning system not available"}
    result = await sl.run_pattern_recognition()
    return result


# ── Training Pairs ──

@router.get("/learning/training/pending")
async def pending_training(request: Request, limit: int = 100):
    sl = _m(request).get("supervised_learning")
    return sl.get_pending_training_pairs(limit) if sl else []


@router.get("/learning/training/approved")
async def approved_training(request: Request, limit: int = 200):
    sl = _m(request).get("supervised_learning")
    return sl.get_approved_training_pairs(limit) if sl else []


@router.post("/learning/training/{pair_id}/approve")
async def approve_pair(pair_id: int, request: Request):
    sl = _m(request).get("supervised_learning")
    if sl:
        return {"ok": sl.approve_training_pair(pair_id)}
    return {"ok": False}


@router.post("/learning/training/{pair_id}/reject")
async def reject_pair(pair_id: int, request: Request):
    sl = _m(request).get("supervised_learning")
    if sl:
        return {"ok": sl.reject_training_pair(pair_id)}
    return {"ok": False}


@router.post("/learning/training/{pair_id}/edit")
async def edit_pair(pair_id: int, req: TrainingEditReq, request: Request):
    sl = _m(request).get("supervised_learning")
    if sl:
        return {"ok": sl.edit_training_pair(pair_id, req.nova_msg)}
    return {"ok": False}


@router.post("/learning/training/harvest")
async def harvest_training(request: Request):
    sl = _m(request).get("supervised_learning")
    if not sl:
        return {"error": "Learning system not available"}
    count = sl.harvest_conversations()
    return {"ok": True, "pairs_created": count}


@router.post("/learning/training/export")
async def export_training(request: Request):
    sl = _m(request).get("supervised_learning")
    if not sl:
        return {"error": "Learning system not available"}
    try:
        path = sl.export_training_data()
        return {"ok": True, "path": str(path)}
    except ValueError as e:
        return {"ok": False, "error": str(e)}


@router.post("/learning/finetune/modelfile")
async def generate_modelfile(request: Request):
    sl = _m(request).get("supervised_learning")
    if not sl:
        return {"error": "Learning system not available"}
    path = sl.generate_modelfile()
    return {"ok": True, "path": str(path)}


@router.get("/learning/finetune/runs")
async def finetune_runs(request: Request, limit: int = 20):
    sl = _m(request).get("supervised_learning")
    return sl.get_fine_tune_runs(limit) if sl else []


# ── Nova Command Center: unified dashboard endpoint ─────────

@router.get("/dashboard")
async def dashboard(request: Request):
    """Single endpoint for the DarkLock Command Center to fetch all Nova state."""
    m = _m(request)
    emotions = m.get("emotions")
    ai = m.get("ai_engine")
    cfg = m.get("config")
    pm = m.get("persistent_memory")
    anomaly = m.get("anomaly")
    conv_aware = m.get("conversation_awareness")
    session_cont = m.get("session_continuity")
    tracker = m.get("activity_tracker")

    emotion_data = None
    if emotions:
        emotion_data = {
            **emotions.state.to_dict(),
            "dominant_feeling": emotions.state.dominant_feeling,
        }

    return {
        "online": True,
        "emotion": emotion_data,
        "personality": {
            "name": cfg.get("personality.name") if cfg else "Nova",
            "tone": cfg.get("personality.tone") if cfg else "casual",
            "owner": cfg.get("personality.owner") if cfg else "Cayden",
        },
        "models": {
            "deep": cfg.ai_model if cfg else None,
            "fast": cfg.ai_model_fast if cfg else None,
            "auto_route": cfg.ai_auto_route if cfg else True,
            "active": ai.active_models if ai else {},
        },
        "memory_count": len(pm.get_all_user_facts()) if pm else 0,
        "alert_count": anomaly.get_unread_count() if anomaly else 0,
        "conversation_count": len(m["memory"].list_conversations()) if m.get("memory") else 0,
        "session": {
            "active": session_cont.is_active() if session_cont and hasattr(session_cont, 'is_active') else False,
        },
    }


# ── Nova Command Center: integration health endpoint ───────

@router.get("/integrations/status")
async def integrations_status(request: Request):
    """Check which integrations are available and their status."""
    m = _m(request)
    results = {}

    # Weather
    try:
        from integrations.weather import WeatherClient
        results["weather"] = {"available": True, "status": "ready"}
    except Exception:
        results["weather"] = {"available": False, "status": "not configured"}

    # Google Calendar
    try:
        from integrations.google_calendar import GoogleCalendarClient
        results["google_calendar"] = {"available": True, "status": "ready"}
    except Exception:
        results["google_calendar"] = {"available": False, "status": "not configured"}

    # Govee
    try:
        from integrations.govee import GoveeClient
        results["govee"] = {"available": True, "status": "ready"}
    except Exception:
        results["govee"] = {"available": False, "status": "not configured"}

    # GitHub
    try:
        from integrations.github import GitHubClient
        results["github"] = {"available": True, "status": "ready"}
    except Exception:
        results["github"] = {"available": False, "status": "not configured"}

    # Browser bridge
    try:
        from api.browser_bridge import is_connected
        results["browser"] = {"available": True, "status": "connected" if is_connected() else "disconnected"}
    except Exception:
        results["browser"] = {"available": False, "status": "not loaded"}

    # Voice TTS
    try:
        import edge_tts
        results["voice_tts"] = {"available": True, "status": "ready"}
    except ImportError:
        results["voice_tts"] = {"available": False, "status": "edge-tts not installed"}

    # Voice STT
    try:
        from faster_whisper import WhisperModel
        results["voice_stt"] = {"available": True, "status": "ready"}
    except ImportError:
        results["voice_stt"] = {"available": False, "status": "faster-whisper not installed"}

    # Pi5 SSH
    try:
        from integrations.pi5_ssh import Pi5SSH
        results["pi5"] = {"available": True, "status": "ready"}
    except Exception:
        results["pi5"] = {"available": False, "status": "not configured"}

    # DarkLock
    try:
        from integrations.darklock import DarklockBridge
        results["darklock"] = {"available": True, "status": "ready"}
    except Exception:
        results["darklock"] = {"available": False, "status": "not configured"}

    # Vision
    results["vision"] = {"available": True, "status": "ready (llava:13b via ollama)"}

    # Terminal
    results["terminal"] = {"available": True, "status": "ready (sandboxed)"}

    return results


# ══════════════════════════════════════════════════════
#  ADVANCED SYSTEMS — Activity, Health, Recovery,
#  File Manager, Scheduler, Guardian
# ══════════════════════════════════════════════════════


# ── Activity Dashboard ─────────────────────────────

@router.get("/activity/feed")
async def activity_feed(request: Request, count: int = 50, category: Optional[str] = None):
    tracker = _m(request).get("activity_tracker")
    if not tracker:
        return []
    return tracker.recent(count, category=category)


@router.get("/activity/processes")
async def activity_processes(request: Request):
    tracker = _m(request).get("activity_tracker")
    return tracker.active_processes() if tracker else []


@router.get("/activity/stats")
async def activity_stats(request: Request):
    tracker = _m(request).get("activity_tracker")
    return tracker.stats() if tracker else {}


# ── Health Monitor ─────────────────────────────────

@router.get("/health/detailed")
async def health_detailed(request: Request):
    monitor = _m(request).get("health_monitor")
    if not monitor:
        return {"error": "Health monitor not available"}
    return monitor.get_status()


@router.get("/health/heartbeat")
async def heartbeat(request: Request):
    monitor = _m(request).get("health_monitor")
    if not monitor:
        return {"alive": True, "uptime_seconds": 0}
    return monitor.heartbeat()


@router.post("/health/check")
async def run_health_check(request: Request):
    monitor = _m(request).get("health_monitor")
    if not monitor:
        return {"error": "Health monitor not available"}
    return monitor.run_checks()


# ── Self-Recovery ──────────────────────────────────

@router.get("/recovery/status")
async def recovery_status(request: Request):
    recovery = _m(request).get("self_recovery")
    return recovery.get_status() if recovery else {}


@router.get("/recovery/history")
async def recovery_history(request: Request, count: int = 50):
    recovery = _m(request).get("self_recovery")
    return recovery.get_history(count) if recovery else []


@router.post("/recovery/reset/{service}")
async def recovery_reset(service: str, request: Request):
    recovery = _m(request).get("self_recovery")
    if recovery:
        recovery.reset_retries(service)
        return {"ok": True}
    return {"ok": False}


# ── Watchdog ───────────────────────────────────────

@router.get("/watchdog/status")
async def watchdog_status(request: Request):
    wd = _m(request).get("watchdog")
    return wd.get_status() if wd else {"error": "Watchdog not available"}


# ── File Manager ───────────────────────────────────

class FileReadReq(BaseModel):
    path: str

class FileCreateReq(BaseModel):
    path: str
    content: str

class FileModifyReq(BaseModel):
    path: str
    content: str

class FileDirReq(BaseModel):
    path: str


@router.post("/files/read")
async def file_read(req: FileReadReq, request: Request):
    fm = _m(request).get("file_manager")
    if not fm:
        return {"ok": False, "error": "File manager not available"}
    return fm.read_file(req.path)


@router.post("/files/create")
async def file_create(req: FileCreateReq, request: Request):
    fm = _m(request).get("file_manager")
    if not fm:
        return {"ok": False, "error": "File manager not available"}
    return fm.create_file(req.path, req.content)


@router.post("/files/modify")
async def file_modify(req: FileModifyReq, request: Request):
    fm = _m(request).get("file_manager")
    if not fm:
        return {"ok": False, "error": "File manager not available"}
    return fm.modify_file(req.path, req.content)


@router.post("/files/delete")
async def file_delete(req: FileReadReq, request: Request):
    fm = _m(request).get("file_manager")
    if not fm:
        return {"ok": False, "error": "File manager not available"}
    return fm.delete_file(req.path)


@router.post("/files/list")
async def file_list(req: FileDirReq, request: Request):
    fm = _m(request).get("file_manager")
    if not fm:
        return {"ok": False, "error": "File manager not available"}
    return fm.list_dir(req.path)


# ── Scheduler ──────────────────────────────────────

class ScheduleTaskReq(BaseModel):
    name: str
    run_at: str = ""
    action: str = "reminder"
    repeat_seconds: int = 0
    data: dict = {}

class ScheduleReminderReq(BaseModel):
    name: str
    minutes_from_now: int = 0
    at_time: str = ""
    message: str = ""


@router.get("/scheduler/status")
async def scheduler_status(request: Request):
    sched = _m(request).get("scheduler")
    return sched.get_status() if sched else {}


@router.get("/scheduler/tasks")
async def scheduler_tasks(request: Request, active_only: bool = False):
    sched = _m(request).get("scheduler")
    return sched.list_tasks(active_only) if sched else []


@router.post("/scheduler/tasks")
async def scheduler_add_task(req: ScheduleTaskReq, request: Request):
    sched = _m(request).get("scheduler")
    if not sched:
        return {"error": "Scheduler not available"}
    tid = sched.add_task(req.name, req.run_at or sched.now_cst(),
                         req.action, req.repeat_seconds, req.data or None)
    return {"id": tid}


@router.delete("/scheduler/tasks/{tid}")
async def scheduler_remove_task(tid: int, request: Request):
    sched = _m(request).get("scheduler")
    if sched:
        return {"ok": sched.remove_task(tid)}
    return {"ok": False}


@router.post("/scheduler/reminder")
async def scheduler_reminder(req: ScheduleReminderReq, request: Request):
    sched = _m(request).get("scheduler")
    if not sched:
        return {"error": "Scheduler not available"}
    tid = sched.schedule_reminder(req.name, req.minutes_from_now,
                                  req.at_time, req.message)
    return {"id": tid}


@router.get("/scheduler/time")
async def scheduler_time(request: Request):
    sched = _m(request).get("scheduler")
    if sched:
        return {"timezone": "America/Chicago (CST)", "now": sched.now_cst()}
    from datetime import datetime
    from zoneinfo import ZoneInfo
    return {"timezone": "America/Chicago (CST)",
            "now": datetime.now(ZoneInfo("America/Chicago")).isoformat()}


# ── Guardian ───────────────────────────────────────

@router.get("/guardian/status")
async def guardian_status(request: Request):
    guardian = _m(request).get("guardian")
    return guardian.get_status() if guardian else {}


@router.get("/guardian/decisions")
async def guardian_decisions(request: Request, count: int = 50,
                             blocked_only: bool = False):
    guardian = _m(request).get("guardian")
    return guardian.recent_decisions(count, blocked_only) if guardian else []


# ── Calendar API ───────────────────────────────────

@router.get("/calendar/today")
async def calendar_today():
    try:
        from integrations.local_calendar import LocalCalendarClient
        cal = LocalCalendarClient()
        events = cal.get_today()
        return {"events": events, "count": len(events)}
    except Exception as e:
        return {"error": str(e), "events": []}

@router.get("/calendar/tomorrow")
async def calendar_tomorrow():
    try:
        from integrations.local_calendar import LocalCalendarClient
        cal = LocalCalendarClient()
        events = cal.get_tomorrow()
        return {"events": events, "count": len(events)}
    except Exception as e:
        return {"error": str(e), "events": []}

@router.get("/calendar/upcoming")
async def calendar_upcoming(days: int = 7):
    try:
        from integrations.local_calendar import LocalCalendarClient
        cal = LocalCalendarClient()
        events = cal.get_upcoming(days=days)
        return {"events": events, "count": len(events)}
    except Exception as e:
        return {"error": str(e), "events": []}

class CalendarCreateReq(BaseModel):
    text: str

@router.post("/calendar/create")
async def calendar_create(req: CalendarCreateReq):
    try:
        from integrations.local_calendar import LocalCalendarClient
        cal = LocalCalendarClient()
        event = cal.create_quick_event(req.text)
        return {"event": event}
    except Exception as e:
        return {"error": str(e)}

@router.delete("/calendar/{event_id}")
async def calendar_delete(event_id: str):
    try:
        from integrations.local_calendar import LocalCalendarClient
        cal = LocalCalendarClient()
        cal.delete_event(event_id)
        return {"deleted": True}
    except Exception as e:
        return {"error": str(e)}


class CalendarUpdateReq(BaseModel):
    summary: str | None = None
    description: str | None = None
    location: str | None = None
    start: str | None = None  # ISO datetime
    end: str | None = None    # ISO datetime


@router.put("/calendar/{event_id}")
async def calendar_update(event_id: str, req: CalendarUpdateReq):
    """Update an existing calendar event. Nova uses this for full event management."""
    try:
        from datetime import datetime as _dt
        from integrations.local_calendar import LocalCalendarClient
        cal = LocalCalendarClient()
        kwargs = {}
        if req.summary is not None:
            kwargs["summary"] = req.summary
        if req.description is not None:
            kwargs["description"] = req.description
        if req.location is not None:
            kwargs["location"] = req.location
        if req.start is not None:
            kwargs["start"] = _dt.fromisoformat(req.start)
        if req.end is not None:
            kwargs["end"] = _dt.fromisoformat(req.end)
        event = cal.update_event(event_id, **kwargs)
        return {"event": event}
    except Exception as e:
        return {"error": str(e)}


class CalendarCreateDetailedReq(BaseModel):
    summary: str
    start: str         # ISO datetime
    end: str           # ISO datetime
    description: str = ""
    location: str = ""


@router.post("/calendar/create-detailed")
async def calendar_create_detailed(req: CalendarCreateDetailedReq):
    """Create event with full detail (used by Nova calendar app). Unlike
    quick-add, this accepts structured start/end datetimes."""
    try:
        from datetime import datetime as _dt
        from integrations.local_calendar import LocalCalendarClient
        cal = LocalCalendarClient()
        event = cal.create_event(
            summary=req.summary,
            start=_dt.fromisoformat(req.start),
            end=_dt.fromisoformat(req.end),
            description=req.description,
            location=req.location,
        )
        return {"event": event}
    except Exception as e:
        return {"error": str(e)}


@router.get("/calendar/range")
async def calendar_range(start: str, end: str, max_results: int = 50):
    """Get events within a date range (ISO date strings). Used by Nova calendar
    app for view-based fetching."""
    try:
        from datetime import datetime as _dt
        from zoneinfo import ZoneInfo
        from integrations.local_calendar import LocalCalendarClient
        cal = LocalCalendarClient()
        tz = ZoneInfo("America/Chicago")
        s = _dt.fromisoformat(start).replace(tzinfo=tz) if "T" in start else _dt.fromisoformat(start + "T00:00:00").replace(tzinfo=tz)
        e = _dt.fromisoformat(end).replace(tzinfo=tz) if "T" in end else _dt.fromisoformat(end + "T23:59:59").replace(tzinfo=tz)
        events = cal.get_events(s, e, max_results=max_results)
        return {"events": events, "count": len(events)}
    except Exception as e:
        return {"error": str(e), "events": []}


class CalendarBulkSyncReq(BaseModel):
    events: list[dict]


@router.post("/calendar/sync")
async def calendar_bulk_sync(req: CalendarBulkSyncReq):
    """Bulk sync events from the calendar desktop app into local SQLite.
    Accepts events in the calendar-app format (date, startTime, endTime, title)."""
    try:
        from datetime import datetime as _dt
        from zoneinfo import ZoneInfo
        from integrations.local_calendar import LocalCalendarClient
        cal = LocalCalendarClient()
        tz = ZoneInfo("America/Chicago")
        conn = cal._conn()
        now_iso = _dt.now(tz).isoformat()
        imported = 0
        for e in req.events:
            event_id = e.get("id", "")
            title = e.get("title", "") or e.get("summary", "")
            date_str = e.get("date", "")
            if not event_id or not title or not date_str:
                continue
            start_time = e.get("startTime", "09:00")
            end_time = e.get("endTime", "10:00")
            desc = e.get("description", "")
            loc = e.get("location", "") or e.get("_location", "")
            all_day = 1 if e.get("allDay", False) else 0
            start_iso = _dt.fromisoformat(f"{date_str}T{start_time}:00").replace(tzinfo=tz).isoformat()
            end_iso = _dt.fromisoformat(f"{date_str}T{end_time}:00").replace(tzinfo=tz).isoformat()
            conn.execute(
                "INSERT OR REPLACE INTO events (id, summary, start, end, description, location, all_day, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (event_id, title, start_iso, end_iso, desc, loc, all_day, now_iso, now_iso),
            )
            imported += 1
        conn.commit()
        return {"imported": imported, "total": len(req.events)}
    except Exception as e:
        return {"error": str(e)}


# ── Smart Home (Home Assistant) ───────────────────

def _get_ha():
    """Return a HomeAssistant client or None if not configured."""
    try:
        from integrations.home_assistant import HomeAssistant
        return HomeAssistant.from_env()
    except Exception:
        return None


@router.get("/smarthome/status")
async def smarthome_status():
    """Check if Home Assistant is reachable and return a summary."""
    ha = _get_ha()
    if not ha:
        return {"available": False, "reason": "HA_URL and HA_TOKEN not configured"}
    try:
        summary = await ha.summary()
        return summary
    except Exception as e:
        return {"available": False, "error": str(e)}


@router.get("/smarthome/devices")
async def smarthome_devices(domain: Optional[str] = None):
    """List all Home Assistant entity states, optionally filtered by domain."""
    ha = _get_ha()
    if not ha:
        return {"error": "Home Assistant not configured", "devices": []}
    try:
        states = await ha.get_states()
        if domain:
            states = [s for s in states if s.get("entity_id", "").startswith(f"{domain}.")]
        return {"devices": states, "count": len(states)}
    except Exception as e:
        return {"error": str(e), "devices": []}


class SmartHomeControlReq(BaseModel):
    entity_id: str
    action: str          # "turn_on", "turn_off", "toggle"
    brightness: Optional[int] = None   # 0-100 for lights
    r: Optional[int] = None
    g: Optional[int] = None
    b: Optional[int] = None
    kelvin: Optional[int] = None


@router.post("/smarthome/control")
async def smarthome_control(req: SmartHomeControlReq):
    """Control a Home Assistant entity."""
    ha = _get_ha()
    if not ha:
        return {"ok": False, "error": "Home Assistant not configured"}
    try:
        if req.action == "toggle":
            result = await ha.toggle(req.entity_id)
        elif req.action == "turn_on":
            kwargs = {}
            if req.brightness is not None:
                kwargs["brightness_pct"] = max(0, min(100, req.brightness))
            if req.r is not None and req.g is not None and req.b is not None:
                kwargs["rgb_color"] = [req.r, req.g, req.b]
            if req.kelvin is not None:
                kwargs["kelvin"] = req.kelvin
            result = await ha.turn_on(req.entity_id, **kwargs)
        elif req.action == "turn_off":
            result = await ha.turn_off(req.entity_id)
        else:
            return {"ok": False, "error": f"Unknown action: {req.action!r}"}
        return {"ok": True, **result}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.get("/smarthome/entity/{entity_id:path}")
async def smarthome_entity(entity_id: str):
    """Get the state of a specific entity."""
    ha = _get_ha()
    if not ha:
        return {"error": "Home Assistant not configured"}
    try:
        return await ha.get_entity_state(entity_id)
    except Exception as e:
        return {"error": str(e)}


# ── Weather API ────────────────────────────────────

@router.get("/weather")
async def weather_current(city: str = ""):
    try:
        import os as _os
        from integrations.weather import WeatherClient
        api_key = _os.environ.get("OPENWEATHER_API_KEY", "")
        if not api_key:
            return {"error": "OPENWEATHER_API_KEY not set in .env"}
        w = WeatherClient(api_key)
        weather = await w.get_current(city or None)
        return {
            "temp_f": weather.temp_f,
            "feels_like_f": weather.feels_like_f,
            "description": weather.description,
            "humidity": weather.humidity,
            "wind_mph": weather.wind_mph,
            "high_f": weather.high_f,
            "low_f": weather.low_f,
            "city": weather.city,
            "summary": weather.summary(),
        }
    except Exception as e:
        return {"error": str(e)}

@router.get("/weather/forecast")
async def weather_forecast(city: str = "", days: int = 3):
    try:
        import os as _os
        from integrations.weather import WeatherClient
        api_key = _os.environ.get("OPENWEATHER_API_KEY", "")
        if not api_key:
            return {"error": "OPENWEATHER_API_KEY not set in .env"}
        w = WeatherClient(api_key)
        forecast = await w.get_forecast(city or None, days)
        return {"forecast": [{"date": f.date, "high_f": f.high_f, "low_f": f.low_f, "description": f.description} for f in forecast]}
    except Exception as e:
        return {"error": str(e)}


# ── Google Integration Status ──────────────────────

@router.get("/google/status")
async def google_status():
    try:
        from integrations.google_auth import is_configured, is_authenticated
        return {
            "credentials_file_exists": is_configured(),
            "authenticated": is_authenticated(),
        }
    except Exception as e:
        return {"error": str(e)}


# ── Darklock / Pi5 Integration ─────────────────────

@router.get("/darklock/status")
async def darklock_status(request: Request):
    dl = _m(request).get("darklock")
    if not dl:
        return {"error": "Darklock integration not enabled"}
    return await dl.check_server_health()


@router.get("/darklock/summary")
async def darklock_summary(request: Request):
    dl = _m(request).get("darklock")
    if not dl:
        return {"error": "Darklock integration not enabled"}
    return {"summary": await dl.get_darklock_status()}


@router.get("/darklock/bug-reports")
async def darklock_bug_reports(request: Request, status: str = None,
                               severity: str = None, limit: int = 20):
    dl = _m(request).get("darklock")
    if not dl:
        return {"error": "Darklock integration not enabled"}
    reports = await dl.get_bug_reports(status=status, severity=severity, limit=limit)
    return {"reports": [{"id": r.id, "title": r.title, "severity": r.severity,
                         "status": r.status, "source": r.source, "reporter": r.reporter,
                         "created_at": r.created_at} for r in reports]}


@router.get("/darklock/bug-reports/{report_id}")
async def darklock_bug_detail(report_id: int, request: Request):
    dl = _m(request).get("darklock")
    if not dl:
        return {"error": "Darklock integration not enabled"}
    report = await dl.get_bug_report(report_id)
    if not report:
        return {"error": f"Bug report #{report_id} not found"}
    return {"report": report.__dict__}


@router.post("/darklock/restart")
async def darklock_restart(request: Request):
    dl = _m(request).get("darklock")
    if not dl:
        return {"error": "Darklock integration not enabled"}
    msg = await dl.restart_darklock()
    return {"ok": "successfully" in msg or "verified" in msg, "message": msg}


@router.get("/darklock/logs")
async def darklock_logs(request: Request, lines: int = 30):
    dl = _m(request).get("darklock")
    if not dl:
        return {"error": "Darklock integration not enabled"}
    return {"logs": await dl.get_darklock_logs(lines=min(lines, 50))}


@router.get("/darklock/pi5")
async def pi5_health(request: Request):
    dl = _m(request).get("darklock")
    if not dl:
        return {"error": "Darklock integration not enabled"}
    health = await dl.pi5_health_check()
    return health.to_dict()


# ── Darklock Security Bridge ───────────────────────────────

@router.get("/darklock/security")
async def darklock_security_status(request: Request):
    """Get Darklock file-integrity monitoring status from Nova's security bridge."""
    ds = _m(request).get("darklock_security")
    if not ds:
        return {"monitored": False, "reason": "DarklockSecurityBridge not initialized"}
    return ds.get_status()


@router.get("/darklock/security/violations")
async def darklock_violations(request: Request, unacked_only: bool = False, limit: int = 50):
    """List Darklock file-tamper violations detected by Nova."""
    ds = _m(request).get("darklock_security")
    if not ds:
        return []
    return ds.get_violations(limit=limit, unacked_only=unacked_only)


@router.post("/darklock/security/acknowledge")
async def darklock_acknowledge(request: Request):
    """Acknowledge a Darklock tamper alert (clears it from the unacknowledged list)."""
    body = await request.json()
    ds = _m(request).get("darklock_security")
    if not ds:
        return {"ok": False, "reason": "Bridge not initialized"}
    if body.get("all"):
        ds.acknowledge_all()
        return {"ok": True, "acknowledged": "all"}
    file_name = body.get("file", "")
    ok = ds.acknowledge(file_name)
    return {"ok": ok, "file": file_name}


@router.post("/darklock/security/rebaseline")
async def darklock_rebaseline(request: Request):
    """Re-hash all Darklock files after an intentional deploy. Clears tamper alerts."""
    ds = _m(request).get("darklock_security")
    integrity = _m(request).get("integrity")
    if not ds or not integrity:
        return {"ok": False, "reason": "Bridge or IntegrityChecker not available"}
    ds.rebaseline_darklock(integrity)
    return {"ok": True, "message": "Darklock files re-baselined successfully"}


# ── Proactive Engine ───────────────────────────────

@router.get("/proactive/status")
async def proactive_status(request: Request):
    p = _m(request).get("proactive")
    if not p:
        return {"error": "Proactive engine not enabled"}
    return p.get_status()


@router.post("/proactive/trigger")
async def proactive_trigger(request: Request):
    """Manually trigger a proactive check cycle (for testing)."""
    p = _m(request).get("proactive")
    if not p:
        return {"error": "Proactive engine not enabled"}
    p._tick()
    from api.websocket import broadcast_proactive
    # Flush any queued messages
    with p._queue_lock:
        pending = p._queue[:]
        p._queue.clear()
    for msg in pending:
        await broadcast_proactive(msg)
    return {"triggered": True, "sent": len(pending)}


@router.post("/proactive/test")
async def proactive_test(request: Request):
    """Send a test proactive message (for verifying the pipeline)."""
    from api.websocket import broadcast_proactive
    msg = {
        "type": "proactive",
        "category": "thought",
        "priority": "low",
        "content": "Just checking in — everything's running smoothly on my end. Let me know if you need anything!",
        "sound": False,
        "ts": __import__("time").time(),
    }
    await broadcast_proactive(msg)
    return {"sent": True}


# ── Process Manager ────────────────────────────────

@router.get("/processes")
async def list_processes(request: Request):
    pm = _m(request).get("process_manager")
    if not pm:
        return {"error": "Process manager not available"}
    return {"processes": pm.list_processes()}


@router.post("/processes/spawn")
async def spawn_process(request: Request):
    pm = _m(request).get("process_manager")
    if not pm:
        return {"error": "Process manager not available"}
    body = await request.json()
    name = body.get("name", "unnamed")
    command = body.get("command", "")
    if not command:
        return {"error": "command is required"}
    proc = await pm.spawn(name, command)
    return {"process": proc}


@router.post("/processes/{proc_id}/kill")
async def kill_process(proc_id: str, request: Request):
    pm = _m(request).get("process_manager")
    if not pm:
        return {"error": "Process manager not available"}
    ok = await pm.kill(proc_id)
    return {"killed": ok}


@router.get("/processes/{proc_id}/output")
async def get_process_output(proc_id: str, request: Request):
    pm = _m(request).get("process_manager")
    if not pm:
        return {"error": "Process manager not available"}
    output = pm.get_output(proc_id)
    return output


# ── System Monitor ─────────────────────────────────

@router.get("/system/snapshot")
async def system_snapshot(request: Request):
    sm = _m(request).get("system_monitor")
    if not sm:
        return {"error": "System monitor not available"}
    snap = sm.get_snapshot()
    if snap:
        return snap if isinstance(snap, dict) else snap.__dict__
    return {"error": "No snapshot available yet"}


@router.get("/system/summary")
async def system_summary(request: Request):
    sm = _m(request).get("system_monitor")
    if not sm:
        return {"error": "System monitor not available"}
    return {"summary": sm.get_summary()}


# ── Goals ──────────────────────────────────────────

@router.get("/goals")
async def list_goals(request: Request, status: str = "active"):
    gt = _m(request).get("goal_tracker")
    if not gt:
        return {"error": "Goal tracker not available"}
    return {"goals": gt.list_goals(status)}


@router.post("/goals")
async def create_goal(request: Request):
    gt = _m(request).get("goal_tracker")
    if not gt:
        return {"error": "Goal tracker not available"}
    body = await request.json()
    title = body.get("title", "")
    if not title:
        return {"error": "title is required"}
    goal = gt.create_goal(
        title=title,
        description=body.get("description", ""),
        steps=body.get("steps"),
        priority=body.get("priority", "normal"),
    )
    return {"goal": goal}


@router.get("/goals/{goal_id}")
async def get_goal(goal_id: int, request: Request):
    gt = _m(request).get("goal_tracker")
    if not gt:
        return {"error": "Goal tracker not available"}
    goal = gt.get_goal(goal_id)
    if not goal:
        return {"error": "Goal not found"}
    return {"goal": goal}


@router.post("/goals/{goal_id}/steps/{step_index}")
async def update_goal_step(goal_id: int, step_index: int, request: Request):
    gt = _m(request).get("goal_tracker")
    if not gt:
        return {"error": "Goal tracker not available"}
    body = await request.json()
    result = gt.update_step(
        goal_id, step_index,
        status=body.get("status", "done"),
        note=body.get("note", ""),
    )
    return result


@router.delete("/goals/{goal_id}")
async def delete_goal(goal_id: int, request: Request):
    gt = _m(request).get("goal_tracker")
    if not gt:
        return {"error": "Goal tracker not available"}
    ok = gt.delete_goal(goal_id)
    return {"deleted": ok}


# ── Skills ─────────────────────────────────────────

@router.get("/skills")
async def list_skills(request: Request):
    skm = _m(request).get("skill_memory")
    if not skm:
        return {"error": "Skill memory not available"}
    return {"skills": skm.list_skills()}


@router.post("/skills")
async def save_skill(request: Request):
    skm = _m(request).get("skill_memory")
    if not skm:
        return {"error": "Skill memory not available"}
    body = await request.json()
    name = body.get("name", "")
    if not name:
        return {"error": "name is required"}
    skill = skm.save_skill(
        name=name,
        description=body.get("description", ""),
        steps=body.get("steps"),
        tags=body.get("tags"),
    )
    return {"skill": skill}


@router.get("/skills/search")
async def search_skills(request: Request, q: str = ""):
    skm = _m(request).get("skill_memory")
    if not skm:
        return {"error": "Skill memory not available"}
    return {"skills": skm.find_skill(q)}


@router.delete("/skills/{name}")
async def delete_skill(name: str, request: Request):
    skm = _m(request).get("skill_memory")
    if not skm:
        return {"error": "Skill memory not available"}
    ok = skm.delete_skill(name)
    return {"deleted": ok}


# ── Tools ──────────────────────────────────────────

@router.get("/tools")
async def list_tools(request: Request):
    tr = _m(request).get("tool_registry")
    if not tr:
        return {"error": "Tool registry not available"}
    return {"tools": tr.list_tools()}


# ── Service Overseer ───────────────────────────────

@router.get("/services")
async def list_services(request: Request):
    ov = _m(request).get("service_overseer")
    if not ov:
        return {"error": "Service overseer not available"}
    return ov.get_status()


@router.get("/services/{name}")
async def get_service(name: str, request: Request):
    ov = _m(request).get("service_overseer")
    if not ov:
        return {"error": "Service overseer not available"}
    svc = ov.get_service(name)
    if not svc:
        return {"error": f"Service '{name}' not found"}
    return svc


@router.post("/services/{name}/start")
async def start_service(name: str, request: Request):
    ov = _m(request).get("service_overseer")
    if not ov:
        return {"error": "Service overseer not available"}
    ok = await ov.start_service(name)
    return {"started": ok}


@router.post("/services/{name}/stop")
async def stop_service(name: str, request: Request):
    ov = _m(request).get("service_overseer")
    if not ov:
        return {"error": "Service overseer not available"}
    ok = await ov.stop_service(name, reason="API request")
    return {"stopped": ok}


@router.post("/services/{name}/restart")
async def restart_service(name: str, request: Request):
    ov = _m(request).get("service_overseer")
    if not ov:
        return {"error": "Service overseer not available"}
    ok = await ov.restart_service(name, reason="API request")
    return {"restarted": ok}


@router.post("/services/start-all")
async def start_all_services(request: Request):
    ov = _m(request).get("service_overseer")
    if not ov:
        return {"error": "Service overseer not available"}
    await ov.start_all()
    return {"status": "started"}


@router.post("/services/stop-all")
async def stop_all_services(request: Request):
    ov = _m(request).get("service_overseer")
    if not ov:
        return {"error": "Service overseer not available"}
    await ov.stop_all(reason="API stop-all")
    return {"status": "stopped"}


# ── Activity Ledger ────────────────────────────────

@router.get("/ledger/events")
async def ledger_events(
    request: Request,
    count: int = 100,
    category: str = "",
    severity: str = "",
):
    ledger = _m(request).get("activity_ledger")
    if not ledger:
        return {"error": "Activity ledger not available"}
    return {
        "events": ledger.get_events(
            count=count,
            category=category or None,
            severity=severity or None,
        )
    }


@router.get("/ledger/summary")
async def ledger_summary(request: Request, minutes: int = 60):
    ledger = _m(request).get("activity_ledger")
    if not ledger:
        return {"error": "Activity ledger not available"}
    return ledger.get_summary(minutes=minutes)


@router.get("/ledger/status")
async def ledger_status(request: Request):
    ledger = _m(request).get("activity_ledger")
    if not ledger:
        return {"error": "Activity ledger not available"}
    return ledger.get_status()


@router.post("/ledger/acknowledge/{event_id}")
async def ledger_acknowledge(event_id: str, request: Request):
    ledger = _m(request).get("activity_ledger")
    if not ledger:
        return {"error": "Activity ledger not available"}
    ok = ledger.acknowledge(event_id)
    return {"acknowledged": ok}


# ── Code Workshop ──────────────────────────────────

class AnalyzeReq(BaseModel):
    path: str

class EditReq(BaseModel):
    path: str
    old_text: str
    new_text: str
    description: str = ""

class ReplaceBlockReq(BaseModel):
    path: str
    block_name: str
    new_source: str
    description: str = ""

class CreateFileReq(BaseModel):
    path: str
    content: str
    description: str = ""

class ScaffoldReq(BaseModel):
    base_path: str
    project_name: str
    project_type: str
    features: list[str] = []

class BuildReq(BaseModel):
    path: str
    force_type: str = ""

class ValidateReq(BaseModel):
    source: str


@router.post("/workshop/analyze")
async def workshop_analyze(req: AnalyzeReq, request: Request):
    ws = _m(request).get("code_workshop")
    if not ws:
        return {"error": "Code workshop not available"}
    analysis = ws.analyze_file(req.path)
    return analysis.to_dict()


@router.post("/workshop/find-block")
async def workshop_find_block(request: Request, path: str = "", name: str = ""):
    ws = _m(request).get("code_workshop")
    if not ws:
        return {"error": "Code workshop not available"}
    block = ws.find_block(path, name)
    if not block:
        return {"error": f"Block '{name}' not found in {path}"}
    return {
        "name": block.name,
        "type": block.block_type,
        "start_line": block.start_line,
        "end_line": block.end_line,
        "source": block.source,
        "parent": block.parent,
    }


@router.post("/workshop/edit")
async def workshop_edit(req: EditReq, request: Request):
    ws = _m(request).get("code_workshop")
    if not ws:
        return {"error": "Code workshop not available"}
    patch = ws.edit_file(req.path, req.old_text, req.new_text, req.description)
    if not patch:
        return {"error": "Edit failed — text not found or access denied"}
    return patch.to_dict()


@router.post("/workshop/replace-block")
async def workshop_replace_block(req: ReplaceBlockReq, request: Request):
    ws = _m(request).get("code_workshop")
    if not ws:
        return {"error": "Code workshop not available"}
    patch = ws.replace_block(req.path, req.block_name, req.new_source, req.description)
    if not patch:
        return {"error": "Block not found or access denied"}
    return patch.to_dict()


@router.post("/workshop/apply-patch/{patch_id}")
async def workshop_apply_patch(patch_id: str, request: Request):
    ws = _m(request).get("code_workshop")
    if not ws:
        return {"error": "Code workshop not available"}
    ok = ws.apply_patch(patch_id)
    return {"applied": ok}


@router.post("/workshop/create-file")
async def workshop_create_file(req: CreateFileReq, request: Request):
    ws = _m(request).get("code_workshop")
    if not ws:
        return {"error": "Code workshop not available"}
    ok = ws.create_file(req.path, req.content, req.description)
    return {"created": ok}


@router.post("/workshop/scaffold")
async def workshop_scaffold(req: ScaffoldReq, request: Request):
    ws = _m(request).get("code_workshop")
    if not ws:
        return {"error": "Code workshop not available"}
    return ws.scaffold_project(req.base_path, req.project_name, req.project_type, req.features)


@router.post("/workshop/build")
async def workshop_build(req: BuildReq, request: Request):
    ws = _m(request).get("code_workshop")
    if not ws:
        return {"error": "Code workshop not available"}
    result = ws.build_project(req.path, req.force_type)
    return result.to_dict()


@router.post("/workshop/validate")
async def workshop_validate(req: ValidateReq, request: Request):
    ws = _m(request).get("code_workshop")
    if not ws:
        return {"error": "Code workshop not available"}
    return ws.validate_python(req.source)


@router.get("/workshop/status")
async def workshop_status(request: Request):
    ws = _m(request).get("code_workshop")
    if not ws:
        return {"error": "Code workshop not available"}
    return ws.get_status()


# ── Autonomous Agent ───────────────────────────────

class TaskReq(BaseModel):
    title: str
    trigger: str = "manual"
    steps: list[dict] = []
    reasoning: str = ""
    timeout: float = 600.0


@router.get("/agent/status")
async def agent_status(request: Request):
    agent = _m(request).get("autonomous_agent")
    if not agent:
        return {"error": "Autonomous agent not available"}
    return agent.get_status()


@router.get("/agent/tasks")
async def agent_tasks(request: Request, state: str = "", limit: int = 20):
    agent = _m(request).get("autonomous_agent")
    if not agent:
        return {"error": "Autonomous agent not available"}
    return {"tasks": agent.list_tasks(state=state or None, limit=limit)}


@router.get("/agent/tasks/{task_id}")
async def agent_get_task(task_id: str, request: Request):
    agent = _m(request).get("autonomous_agent")
    if not agent:
        return {"error": "Autonomous agent not available"}
    task = agent.get_task(task_id)
    if not task:
        return {"error": "Task not found"}
    return task


@router.post("/agent/tasks")
async def agent_create_task(req: TaskReq, request: Request):
    agent = _m(request).get("autonomous_agent")
    if not agent:
        return {"error": "Autonomous agent not available"}
    task = agent.create_task(
        title=req.title,
        trigger=req.trigger,
        steps=req.steps,
        reasoning=req.reasoning,
        timeout=req.timeout,
    )
    return task.to_dict()


@router.post("/agent/tasks/{task_id}/approve/{step_index}")
async def agent_approve_step(task_id: str, step_index: int, request: Request):
    agent = _m(request).get("autonomous_agent")
    if not agent:
        return {"error": "Autonomous agent not available"}
    ok = agent.approve_step(task_id, step_index)
    return {"approved": ok}


@router.post("/agent/tasks/{task_id}/reject/{step_index}")
async def agent_reject_step(task_id: str, step_index: int, request: Request):
    agent = _m(request).get("autonomous_agent")
    if not agent:
        return {"error": "Autonomous agent not available"}
    ok = agent.reject_step(task_id, step_index)
    return {"rejected": ok}


@router.post("/agent/tasks/{task_id}/cancel")
async def agent_cancel_task(task_id: str, request: Request):
    agent = _m(request).get("autonomous_agent")
    if not agent:
        return {"error": "Autonomous agent not available"}
    ok = agent.cancel_task(task_id)
    return {"cancelled": ok}


# ── Security Sentinel ────────────────────────────────────────────

@router.get("/sentinel/status")
async def sentinel_status(request: Request):
    sentinel = _m(request).get("security_sentinel")
    if not sentinel:
        return {"error": "Security sentinel not available"}
    return sentinel.get_status()


@router.get("/sentinel/findings")
async def sentinel_findings(request: Request, limit: int = 50,
                            threat_level: str = None, service: str = None):
    sentinel = _m(request).get("security_sentinel")
    if not sentinel:
        return {"error": "Security sentinel not available"}
    return sentinel.get_findings(limit=limit, threat_level=threat_level, service=service)


@router.get("/sentinel/programs")
async def sentinel_programs(request: Request, limit: int = 50, status: str = None):
    sentinel = _m(request).get("security_sentinel")
    if not sentinel:
        return {"error": "Security sentinel not available"}
    return sentinel.get_programs(limit=limit, status=status)


@router.get("/sentinel/programs/{program_id}/source")
async def sentinel_program_source(program_id: str, request: Request):
    sentinel = _m(request).get("security_sentinel")
    if not sentinel:
        return {"error": "Security sentinel not available"}
    source = sentinel.get_program_source(program_id)
    if source is None:
        return {"error": "Program not found"}
    return {"id": program_id, "source": source}


@router.post("/sentinel/programs/{program_id}/approve")
async def sentinel_approve_program(program_id: str, request: Request):
    sentinel = _m(request).get("security_sentinel")
    if not sentinel:
        return {"error": "Security sentinel not available"}
    result = sentinel.approve_program(program_id)
    if result is None:
        return {"error": "Program not found or already resolved"}
    return result


@router.post("/sentinel/programs/{program_id}/reject")
async def sentinel_reject_program(program_id: str, request: Request):
    sentinel = _m(request).get("security_sentinel")
    if not sentinel:
        return {"error": "Security sentinel not available"}
    ok = sentinel.reject_program(program_id)
    return {"rejected": ok}


@router.post("/sentinel/programs/reject-all")
async def sentinel_reject_all_programs(request: Request):
    sentinel = _m(request).get("security_sentinel")
    if not sentinel:
        return {"error": "Security sentinel not available"}
    count = sentinel.reject_all_pending()
    return {"rejected": count}


@router.get("/sentinel/scans")
async def sentinel_scans(request: Request, limit: int = 20):
    sentinel = _m(request).get("security_sentinel")
    if not sentinel:
        return {"error": "Security sentinel not available"}
    return sentinel.get_scans(limit=limit)


@router.post("/sentinel/scan")
async def sentinel_trigger_scan(request: Request):
    sentinel = _m(request).get("security_sentinel")
    if not sentinel:
        return {"error": "Security sentinel not available"}
    return sentinel.trigger_scan()


@router.post("/sentinel/findings/{finding_id}/ack")
async def sentinel_ack_finding(finding_id: str, request: Request):
    sentinel = _m(request).get("security_sentinel")
    if not sentinel:
        return {"error": "Security sentinel not available"}
    ok = sentinel.acknowledge_finding(finding_id)
    return {"acknowledged": ok}


@router.post("/sentinel/findings/ack-all")
async def sentinel_ack_all(request: Request):
    sentinel = _m(request).get("security_sentinel")
    if not sentinel:
        return {"error": "Security sentinel not available"}
    sentinel.acknowledge_all()
    return {"acknowledged": True}


@router.get("/sentinel/services")
async def sentinel_services(request: Request):
    sentinel = _m(request).get("security_sentinel")
    if not sentinel:
        return {"error": "Security sentinel not available"}
    return sentinel.get_services()


@router.post("/sentinel/programs/{program_id}/retry")
async def sentinel_retry_program(program_id: str, request: Request):
    sentinel = _m(request).get("security_sentinel")
    if not sentinel:
        return {"error": "Security sentinel not available"}
    result = sentinel.retry_program(program_id)
    if result is None:
        return {"error": "Program not found or not in failed state"}
    return result


@router.post("/sentinel/programs/{program_id}/improve")
async def sentinel_improve_program(program_id: str, request: Request):
    sentinel = _m(request).get("security_sentinel")
    if not sentinel:
        return {"error": "Security sentinel not available"}
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    note = body.get("note", "")
    result = sentinel.improve_program(program_id, note)
    if result is None:
        return {"error": "Program not found"}
    return result


@router.post("/sentinel/programs/reset")
async def sentinel_reset_programs(request: Request):
    sentinel = _m(request).get("security_sentinel")
    if not sentinel:
        return {"error": "Security sentinel not available"}
    result = sentinel.reset_programs()
    # Kick off a fresh scan in the background so Nova rebuilds a clean set
    import asyncio
    asyncio.get_event_loop().run_in_executor(None, sentinel.run_scan)
    return result


# ── Spotify API ────────────────────────────────────

@router.get("/spotify/auth")
async def spotify_auth(request: Request):
    """Get the Spotify authorization URL for the user to visit."""
    spotify = _m(request).get("spotify_client")
    if not spotify:
        return {"error": "Spotify not configured. Set SPOTIFY_CLIENT_ID/SECRET in .env"}
    return {"url": spotify.get_auth_url()}


@router.post("/spotify/callback")
async def spotify_callback(request: Request):
    """Exchange authorization code for tokens."""
    spotify = _m(request).get("spotify_client")
    if not spotify:
        return {"error": "Spotify not configured"}
    body = await request.json()
    code = body.get("code", "")
    if not code:
        return {"error": "Missing authorization code"}
    ok = await spotify.exchange_code(code)
    if ok:
        return {"status": "connected", "message": "Spotify connected successfully!"}
    return {"error": "Failed to exchange code — check credentials"}


@router.get("/spotify/status")
async def spotify_status(request: Request):
    """Check Spotify connection status."""
    spotify = _m(request).get("spotify_client")
    if not spotify:
        return {"connected": False, "reason": "not_configured"}
    if not spotify.is_authenticated:
        return {"connected": False, "reason": "not_authorized", "auth_url": spotify.get_auth_url()}
    return {"connected": True}


@router.get("/spotify/now-playing")
async def spotify_now_playing(request: Request):
    """Get the currently playing track."""
    spotify = _m(request).get("spotify_client")
    if not spotify or not spotify.is_authenticated:
        return {"error": "Spotify not connected"}
    np = await spotify.get_playback()
    return {
        "is_playing": np.is_playing,
        "track": np.track,
        "artist": np.artist,
        "album": np.album,
        "progress_ms": np.progress_ms,
        "duration_ms": np.duration_ms,
        "device": np.device,
        "shuffle": np.shuffle,
        "repeat": np.repeat,
        "volume": np.volume,
        "summary": np.summary(),
    }


@router.get("/spotify/devices")
async def spotify_devices(request: Request):
    """List available Spotify playback devices."""
    spotify = _m(request).get("spotify_client")
    if not spotify or not spotify.is_authenticated:
        return {"error": "Spotify not connected"}
    devices = await spotify.get_devices()
    return {"devices": devices}


@router.get("/spotify/queue")
async def spotify_queue(request: Request):
    """Get the current playback queue."""
    spotify = _m(request).get("spotify_client")
    if not spotify or not spotify.is_authenticated:
        return {"error": "Spotify not connected"}
    queue_text = await spotify.get_queue()
    return {"queue": queue_text}
