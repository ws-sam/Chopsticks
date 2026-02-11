# Music & Voice Testing Guide

## ✅ System Status
All 4 agents are now ONLINE and connected!

## Test Music Feature

### Step 1: Join a voice channel
Join any voice channel in your Discord server.

### Step 2: Run music command
```
/music play never gonna give you up
```

### What Should Happen:
1. One of the 4 agents will join your voice channel
2. The song starts playing
3. You'll see a "Now Playing" embed

### If it doesn't work, check:
1. Run `/agents status` to confirm agents are online
2. Check if agents have been invited to your server (they need to be members)
3. Check Docker logs:
   ```bash
   docker logs chopsticks-main-bot --tail 50
   docker logs chopsticks-agent-runner --tail 50
   ```

## Test Custom Voice Feature

### What is "custom voice"?
I need to understand what you mean by "custom voice". This could be:

1. **Voice Assistant** (`/assistant` command) - AI voice chat in voice channels
2. **Custom TTS** (Text-to-Speech) - Custom voice models for bot responses
3. **Voice Models** - Linking custom voice models to agents

### Check if voice services are running:
```bash
docker ps | grep voice
```

You should see:
- `chopsticks-voice-stt` (speech-to-text) on port 9000
- `chopsticks-voice-llm` (AI model) on port 9001  
- `chopsticks-voice-tts` (text-to-speech) on port 9002

### Test voice assistant:
```
/assistant config
/assistant start
```

Then speak in voice channel and the bot should respond.

---

## Debugging Issues

### Music not working?

Check these logs for errors:
```bash
# Main bot errors
docker logs chopsticks-main-bot 2>&1 | grep -i "error\|fail" | tail -20

# Agent errors  
docker logs chopsticks-agent-runner 2>&1 | grep -i "error\|fail" | tail -20

# Lavalink status
docker logs chopsticks-lavalink-1 --tail 30
```

### Custom voice not working?

1. **Check if voice services are responding:**
   ```bash
   curl http://localhost:9000/health  # STT
   curl http://localhost:9001/health  # LLM
   curl http://localhost:9002/health  # TTS
   ```

2. **Check voice service logs:**
   ```bash
   docker logs chopsticks-voice-stt --tail 30
   docker logs chopsticks-voice-llm --tail 30
   docker logs chopsticks-voice-tts --tail 30
   ```

---

## Common Issues

### Issue: "No music agents available"
**Solution**: Agents aren't in your server. Get invite links:
```
/agents invite
```
Then invite all 4 agents to your server.

### Issue: "Music agents are still starting up"
**Solution**: Wait 10-20 seconds for agents to fully connect, then try again.

### Issue: Agent joins but no audio plays
**Check**:
1. Is Lavalink running? `docker logs chopsticks-lavalink-1 --tail 20`
2. Did agent connect to Lavalink? Look for "Lavalink initialized successfully"
3. Is the song URL valid? Try a different song.

### Issue: Voice assistant doesn't respond
**Check**:
1. Are voice services running? `docker ps | grep voice`
2. Is Ollama responding? `curl http://localhost:11434/api/tags`
3. Check voice-llm logs: `docker logs chopsticks-voice-llm --tail 50`

---

## Next Steps

**Try the commands in Discord and tell me:**
1. What happened when you tried `/music play <song>`?
2. What happened when you tried custom voice (or tell me which command you used)?
3. Any error messages you saw?

I'll fix whatever isn't working! 🚀
