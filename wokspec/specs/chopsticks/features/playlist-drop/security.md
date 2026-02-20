# Security & Abuse Plan: Playlist Drop / Audio File Uploads
**Feature:** `playlist-drop`  
**Audience:** Security reviewers, ops, bot admins  
**Status:** Spec

---

## 1. Virus / Malware Scanning

### Policy
All uploaded audio files **must** be scanned before being written to persistent storage. A file that fails the scan is **never stored**; the temp buffer is deleted immediately and an alert is emitted.

### Implementation options

| Option              | Latency   | Cost   | Decision needed |
|---------------------|-----------|--------|-----------------|
| **ClamAV (local)**  | ~200–800ms| Free   | Requires running ClamAV daemon as a sidecar container (`clamav:latest`). Updated via `freshclam` cron. |
| **VirusTotal API**  | 1–5s      | Paid   | Free tier: 4 req/min. Suitable for low-volume guilds. Requires `VIRUSTOTAL_API_KEY` env var. |

**Decision:** See `missing_inputs.json`. Default implementation: ClamAV local, with VirusTotal as optional fallback if `VIRUSTOTAL_API_KEY` is set.

### Flow

```
[Temp buffer ready]
  │
  ▼
virusScanner.scan(buffer) ──┐
  │                         │
  │  CLEAN                  │  INFECTED / ERROR
  ▼                         ▼
continue pipeline        deleteTempBuffer()
                         emit metric: chopsticks_virus_detected_total{guild_id}
                         reply (ephemeral): "❌ File rejected: security scan failed."
                         alert: POST to #security-alerts webhook
```

### Error handling
- If ClamAV daemon is unreachable: **fail closed** (reject upload, do not store). Log `ERROR virus_scanner_unavailable`.
- If VirusTotal returns rate-limit (429): queue scan for retry (up to 3× with backoff); reply to user that processing is delayed.

---

## 2. Audio Profanity / NSFW Detection (Optional, Guild Opt-In)

### Policy
Guilds may opt in to audio moderation. When enabled, transcribed content is screened before playback.

### Opt-in
```
/admin settings audio-moderation enable
/admin settings audio-moderation disable
```
Stored in `guild_settings.audio_moderation_enabled` (boolean, default `false`).

### Integration options

| Option                           | Notes                                                              |
|----------------------------------|--------------------------------------------------------------------|
| **Sightengine Audio API**        | Commercial API. Requires `SIGHTENGINE_API_KEY`. Returns NSFW/profanity scores. |
| **Local Whisper + classifier**   | Run `openai/whisper` model locally; pipe transcript to a text classifier (e.g. `toxic-bert`). Requires GPU or is slow on CPU. |

**Decision:** See `missing_inputs.json`. Default: disabled. If `AUDIO_MODERATION_BACKEND` env var is set to `sightengine` or `whisper`, that backend is activated for opted-in guilds.

### Action on detection
- NSFW score ≥ threshold (configurable, default 0.7): reject upload; ephemeral reply; optionally alert mod channel.
- Log `chopsticks_audio_nsfw_rejected_total{guild_id, backend}`.

---

## 3. Rate Limits per Uploader

| Limit                         | Value       | Scope                         | Configurable via               |
|-------------------------------|-------------|-------------------------------|--------------------------------|
| Max uploads per user per hour | 5           | user + guild                  | `UPLOAD_USER_HOURLY_LIMIT`     |
| Max uploads per guild per day | 50          | guild                         | `UPLOAD_GUILD_DAILY_LIMIT`     |

### Implementation
Rate limits are enforced in `src/middleware/uploadRateLimit.ts` using the same sliding-window Redis backend as the main rate limiter. Keys:
- `chopsticks:upload_rl:user:{guild_id}:{user_id}` — TTL 3600s
- `chopsticks:upload_rl:guild:{guild_id}` — TTL 86400s (reset at midnight UTC)

On 429:
- User: "⏳ Upload limit reached. You can upload **5 files/hour**. Try again <t:{reset_epoch}:R>."
- Guild: "⏳ This server has reached its daily upload limit (50 files/day). Try again tomorrow."

Both responses are ephemeral.

---

## 4. Size Quotas

| Tier     | Max file size   | Storage per guild per month | Enforcement point     |
|----------|-----------------|-----------------------------|------------------------|
| Free     | 25 MB           | 500 MB                      | Step 2 (metadata check) + monthly quota check |
| Premium  | 100 MB          | Unlimited                   | Step 2 only            |

### Monthly quota enforcement
Before step 7 (store_original), query:

```sql
SELECT COALESCE(SUM(size_bytes), 0) AS used
FROM audio_uploads
WHERE guild_id = $1
  AND status NOT IN ('deleted', 'failed')
  AND created_at >= date_trunc('month', NOW());
```

If `used + incoming_size > quota`: reject with ephemeral message.

Monthly usage is exposed in `/admin quota status` for guild administrators.

---

## 5. Automatic Expiry

### Policy
- Files expire **30 days** after upload unless pinned by a guild admin.
- Pinned files (`pinned = true`) never expire unless explicitly unpinned.
- Expired files are soft-deleted (status set to `expired`) in the database, then storage objects are removed by the cron job.

### Cron job: `expireAudioUploads` (runs daily at 02:00 UTC)

```
1. UPDATE audio_uploads SET status='expired'
   WHERE expires_at < NOW() AND pinned = FALSE AND status = 'ready'

2. For each newly expired row:
   a. Delete storage object (S3 DeleteObject / local unlink)
   b. UPDATE audio_uploads SET status='deleted', storage_key=NULL
   c. Log deletion: chopsticks_audio_expired_total{guild_id}

3. If Lavalink queue contains an expired track:
   a. Remove from queue; send "⚠️ Track '{title}' was removed from the queue (upload expired)." to music channel.
```

### Admin pin/unpin
```
/admin uploads pin   <upload_id>   — sets pinned=true, extends expires_at to NULL
/admin uploads unpin <upload_id>   — sets pinned=false, expires_at = NOW() + INTERVAL '30 days'
```

---

## 6. Abuse Recovery

### Admin purge command
```
/music purge-uploads user:<@user> confirm:true
```

Actions:
1. Fetch all `audio_uploads` rows where `uploader_id = user.id AND guild_id = interaction.guild_id AND status NOT IN ('deleted')`.
2. For each row: delete storage object, `UPDATE status='deleted'`.
3. Reply with embed: "🗑️ Purged **{count}** uploads from {user.tag}. {total_size} freed."
4. Write audit log entry: `action=PURGE_UPLOADS, actor_id, target_user_id, guild_id, count, total_size_bytes, timestamp`.

### Audit log
All uploads and purges are written to the `audit_log` table:

```sql
CREATE TABLE IF NOT EXISTS audit_log (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    action      TEXT         NOT NULL,  -- UPLOAD, PURGE_UPLOADS, EXPIRE, VIRUS_REJECTED
    actor_id    TEXT,
    target_id   TEXT,                   -- user_id or upload_id depending on action
    guild_id    TEXT         NOT NULL,
    metadata    JSONB,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

### Reporting
Guild admins can view an upload history report:
```
/admin uploads report [user:<@user>] [since:<date>]
```
Returns a paginated embed with: uploader, filename, size, uploaded_at, status.
