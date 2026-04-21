# TTS with Edge - Read Aloud Commands

**CRITICAL:** When user says "read" or "and read", you MUST generate audio and play it. This is not optional.

Converts text responses and searched content to audio on demand using the **edge_tts MCP server** with `en-GB-RyanNeural` (English) and `pl-PL-MarekNeural` (Polish) voices.

## Setup (Already Complete)

The MCP server is already set up:
- Repository: `~/git/prv/edge-tts-mcp/`
- Dependencies: Installed via `uv sync`
- Configuration: Registered in `.mcp.json`

**Agents automatically access it via MCP protocol** - no per-agent installation or configuration needed.

To verify it's working:
```bash
cd ~/git/prv/edge-tts-mcp
.venv/bin/python main.py  # Starts the MCP server
```

## Required Behavior

When user includes `read` or `and read` in their message:

1. **Generate the text response** (find content if needed)
2. **Extract the readable text** (remove metadata, system info)
3. **Run edge_tts immediately** - DO NOT SKIP THIS
4. **OPEN/PLAY the audio FILE** - THIS IS MANDATORY

**CRITICAL:** Generating the file is NOT enough. You MUST open/play it.

Failure to open/play audio = failure to complete the command.

### Final Step: Platform-Specific Open/Play Commands

**After MCP server generates the audio file, you MUST open/play it:**

**macOS:**
```bash
open ~/tts_response.mp3
```

**Linux:**
```bash
xdg-open ~/tts_response.mp3
```

**Windows:**
```bash
start ~/tts_response.mp3
```

**Generic (detect and execute appropriate command):**
```bash
# Pseudo-code for agent implementation
if sys.platform == "darwin":
    open ~/tts_response.mp3
elif sys.platform == "linux":
    xdg-open ~/tts_response.mp3
elif sys.platform == "win32":
    start ~/tts_response.mp3
```

**Critical:** The open/play command is the FINAL mandatory step. Without it:
- ✗ Audio file exists but user can't hear it
- ✗ Command incomplete
- ✗ User expected to hear audio

**The complete flow:**
1. MCP server generates MP3 (via call_mcp_tool)
2. Execute platform-specific open command
3. Audio plays in user's default player
4. Confirm: "✓ Audio generated and playing..."

---

## Command 1: `read` (Read Last Response Aloud)

User asks to read something that was just displayed.

**User says:**
```
read last note from my-work
```

**You MUST:**
1. Find and display the last my-work note
2. **IMMEDIATELY** generate audio from the note text
3. Play it

**Implementation (TWO steps, both REQUIRED):**

```
Step 1: Call MCP server to generate audio
  - Use edge_tts_mcp_server via MCP protocol
  - Provide: text, voice (en-GB-RyanNeural), output_file (~/tts_response.mp3)
  - Server generates MP3 file

Step 2: PLAY THE AUDIO (MANDATORY - NOT OPTIONAL)
  - Execute: open ~/tts_response.mp3 (macOS), xdg-open (Linux), start (Windows)
  - File plays in user's audio player
  - Confirm: "✓ Audio generated and playing..."
```

**Both steps must be executed. If you skip step 2 (open/play), the command FAILED.**

MCP server handles file generation reliably - no installation errors across agents.

**Output file:** `~/tts_response.mp3`

---

## Command 2: `find [X] and read` (Find and Read Aloud)

User wants to search for content AND hear it read.

**User says:**
```
find last my-work summary and read
```

**You MUST:**
1. Search for the my-work summary
2. Display the content
3. **IMMEDIATELY** generate audio
4. Play it (do not end response until audio is playing)

**Implementation:**
```
1. Find and display content
   - Use file search or grep to find matching content
   - Display to user for context

2. REQUIRED: Generate audio via MCP server
   - Call MCP edge-tts server with:
     * text: [content you found]
     * voice: en-GB-RyanNeural (or pl-PL-MarekNeural for Polish)
     * output_file: ~/tts_search_result.mp3

3. REQUIRED: Play the audio
   - Execute open command (macOS), xdg-open (Linux), or start (Windows)
   - File plays automatically

4. Confirm to user
   ✓ Found my-work summary (45 lines)
   ✓ Audio generated via MCP server
   ✓ Playing in default audio player...
```

**Output file:** `~/tts_search_result.mp3`

**Supported patterns:**
- `read last [project] summary and read`
- `read last [project] progress and read`
- `read [topic] and read`
- `find [anything] and read`

---

## Command 3: Language-Specific Audio

User specifies language for the audio.

**User says:**
```
read last my-work summary in Polish
```

**You MUST:**
1. Find and display the content
2. Generate audio using the requested language voice
3. Play it

**Implementation:**
```
1. Detect language from user request
   - Check for "Polish", "English", etc.
   - Default to English if not specified

2. Determine correct voice
   - Polish request → pl-PL-MarekNeural
   - English request → en-GB-RyanNeural

3. Call MCP server with detected voice
   - Call MCP edge-tts server
   - Provide: text, voice (language-specific), output_file

4. Play the audio
   - Execute open/xdg-open/start
   - File plays in user's player

5. Confirm language
   ✓ Generated Polish audio: ~/tts_result.mp3
   ✓ Playing in default audio player...
```

**Supported languages:**
- English (default: `en-GB-RyanNeural`)
- Polish (request: "in Polish" → `pl-PL-MarekNeural`)

## Voice Reference

| Voice | Language | Type | Best For |
|-------|----------|------|----------|
| `en-GB-RyanNeural` | English (British) | Male | Default, professional |
| `en-US-RyanNeural` | English (US) | Male | Alternative US accent |
| `pl-PL-MarekNeural` | Polish | Male | Polish content |
| `pl-PL-ZofiaNeural` | Polish | Female | Polish alternative |

---

## MANDATORY Implementation for All Agents

**Any request containing `read` or `and read` MUST trigger audio generation and playback.**

### Step-by-Step Flowchart

```
User says "read" or "find X and read"
    ↓
FIND/DISPLAY content (required)
    ↓
EXTRACT clean text (required)
    ↓
DETERMINE voice (check for language in request)
    ↓
RUN edge_tts (MANDATORY - no skipping)
    ↓
PLAY audio with open command (MANDATORY)
    ↓
CONFIRM to user ("Audio generated and playing...")
```

### Pseudo-code Template

```python
def handle_read_command(user_request):
    # 1. FIND content (if "find X" in request)
    if "find" in user_request:
        content = search_files(user_request)
        display(content)
    else:
        content = last_response

    # 2. EXTRACT text (clean, readable)
    text = extract_readable_text(content)

    # 3. DETERMINE voice
    voice = "pl-PL-MarekNeural" if "Polish" in user_request else "en-GB-RyanNeural"

    # 4. GENERATE AUDIO VIA MCP SERVER (NO EXCEPTIONS)
    # Call MCP edge-tts server with the 'tts' tool
    try:
        tts_result = call_mcp_tool(
            server="edge-tts",
            tool="tts",  # The MCP tool name
            arguments={
                "text": text,
                "voice": voice,
                "srt_enable": False
            }
        )
        audio_path = tts_result["audio_path"]
    except Exception as e:
        print(f"Error generating audio: {e}")
        return

    # 5. PLAY AUDIO FILE - THIS IS MANDATORY (NO EXCEPTIONS)
    # Choose platform-specific command:
    if sys.platform == "darwin":  # macOS
        run_command(f'open {audio_path}')
    elif sys.platform == "linux":  # Linux
        run_command(f'xdg-open {audio_path}')
    elif sys.platform == "win32":  # Windows
        run_command(f'start {audio_path}')
    else:
        # Fallback: at least report file location
        print(f"Audio generated: {audio_path}")
        print("Please open manually if auto-open not supported")

    # 6. CONFIRM TO USER
    print(f"✓ Audio generated: {audio_path}")
    print(f"✓ Playing in audio player...")

    # DO NOT return/exit until step 5 (open) has been executed
```

**MCP Tools Available:**
- `tts(text, voice, srt_enable=False)` - Generate audio from text
  - Returns: `{"audio_path": "path/to/file.mp3"}`
- `list_voice()` - Get available voices

**Benefits of MCP approach:**
- ✓ Centralized service running in ~/git/prv/edge-tts-mcp/
- ✓ No per-agent installation (agents call via MCP)
- ✓ Configuration: ~/.mcp.json (already set up)
- ✓ Consistent behavior across Claude, Copilot, and other models

### Checklist for Every "Read" Command

**ALL steps are MANDATORY. Skipping ANY step = command failure.**

- [ ] Found or retrieved the content
- [ ] Displayed the content to user
- [ ] Extracted clean, readable text (no metadata)
- [ ] Determined correct voice (English=en-GB-RyanNeural, Polish=pl-PL-MarekNeural)
- [ ] Ran `edge-tts --text "..." --voice "..." --write-media ~/file.mp3`
- [ ] **Waited for edge-tts to complete**
- [ ] **Ran `open ~/file.mp3` (or xdg-open on Linux, start on Windows)** ← MOST CRITICAL
- [ ] File now plays in user's default audio player
- [ ] Confirmed to user: "✓ Audio generated and playing..."

**If you did steps 1-6 but SKIPPED step 7 (open command), the command FAILED.**
- User still hears no audio
- File sits on disk unplayed
- Task incomplete

**Copilot example (what went wrong):**
```
✓ Audio file created: notes/my-work/2026-02-10_daily_standup.mp3
✗ No open command executed
✗ User sees file path but hears nothing
✗ COMMAND FAILED
```

**Correct flow:**
```
✓ Audio file created: notes/my-work/2026-02-10_daily_standup.mp3
✓ open ~/notes/my-work/2026-02-10_daily_standup.mp3 (executed)
✓ Audio player opens and plays automatically
✓ User hears the audio
✓ COMMAND SUCCEEDED
```

## File Naming Convention

| Request | Output File |
|---------|-------------|
| `read` | `~/tts_response.mp3` |
| `find X and read` | `~/tts_search_result.mp3` |
| `find X and read in Polish` | `~/tts_result_pl.mp3` |

Overwrites on each request (clean up old files automatically).

## Example Flow

```
User: "find last my-work daily summary and read"

Agent response:
[SEARCH OUTPUT]
## my-work Daily Summary - Feb 10
Carousel SVG mask React render issue...

[AUDIO GENERATION]
$ edge-tts --text "Carousel SVG mask React render issue..." \
  --voice "en-GB-RyanNeural" \
  --write-media ~/tts_search_result.mp3

[PLAYBACK]
$ open ~/tts_search_result.mp3

✓ Audio ready - playing in default player
```

---

## What NOT to Do (Common Failures)

### ❌ WRONG: Find and display WITHOUT audio

```
User: "find last my-work summary and read"

Agent: [finds and displays summary]
✗ STOPS HERE - NO AUDIO GENERATED
✗ User asked to "read" but heard nothing
✗ COMMAND FAILED
```

**Why this fails:** User explicitly asked to READ (hear audio), not just display text.

---

### ❌ WRONG: Ask user what they want instead of reading

```
User: "read"

Agent: "What would you like me to read?"
✗ User already said what to read (the last response)
✗ COMMAND FAILED
```

**Why this fails:** "read" is a complete command. Don't ask for clarification.

---

### ❌ WRONG: Only generate audio, don't play it (Copilot's mistake)

```
$ edge-tts --text "Daily Standup..." --voice "en-GB-RyanNeural" --write-media ~/daily_standup.mp3
✓ Audio file created: ~/daily_standup.mp3

✗ NO `open ~/daily_standup.mp3` COMMAND
✗ NO audio player opened
✗ User can see file was created, but hears nothing
✗ COMMAND FAILED
```

**What Copilot did:**
1. Generated the MP3 file ✓
2. Reported: "Audio file created" ✓
3. **FORGOT** to open/play it ✗

**Why this fails:** User asked to "read" (hear audio). A file that exists but isn't played = failed command.

**Fix:** After generating the file, ALWAYS execute:
```bash
open ~/daily_standup.mp3      # macOS
xdg-open ~/daily_standup.mp3  # Linux
start ~/daily_standup.mp3     # Windows
```

---

### ✅ CORRECT: Complete "read" command

```
User: "find last my-work summary and read"

Agent:
1. [finds my-work summary file]
2. [displays summary content]
3. $ edge-tts --text "[summary text]" --voice "en-GB-RyanNeural" --write-media ~/tts_result.mp3
4. $ open ~/tts_result.mp3
5. ✓ Audio generated and playing...

User hears audio of the summary.
COMMAND SUCCEEDED.
```

---

## Error Handling

| Error | Solution |
|-------|----------|
| `edge-tts: command not found` | Install: `pipx install edge-tts` |
| `No module named edge_tts` | Reinstall: `pipx install --force-reinstall edge-tts` |
| Text too long (>5000 chars) | Trim to first 3000 chars, generate audio anyway |
| Network timeout | Retry edge_tts, or inform user and display text |
| Invalid voice | Fall back to `en-GB-RyanNeural` and generate audio |
| User says "read" without context | Read the most recent agent response |

## Quick Test

To verify MCP server is working:

```bash
# Test if edge_tts_mcp_server is installed and accessible
python3 -m edge_tts_mcp_server --help

# The MCP server will be called automatically by agents
# Try asking Claude: "read hello world"
# Or ask any agent: "find last [project] summary and read"
```

MCP server handles all audio generation - agents call it transparently.

## See Also

- TTS Skill: `~/.claude/skills/tts-with-edge/SKILL.md` (for Python/async patterns)
- README.md: Full project documentation with TTS integration guide
