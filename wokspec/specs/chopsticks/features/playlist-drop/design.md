# Feature Design: Playlist Drop / Audio File Uploads
**Feature ID:** `playlist-drop`  
**Phase:** 4 — Playlist Drop / Audio Files  
**Status:** Spec (pending owner decisions — see `missing_inputs.json`)  
**Last updated:** see git log

---

## 1. Feature Summary

Allow Discord users to attach audio files (mp3, ogg, wav, flac) to a voice-channel queue via slash command. The bot validates, stores, transcodes if necessary, and enqueues the track in Lavalink for playback. The feature respects guild upload quotas, rate limits, and provenance metadata requirements.

---

## 2. Upload Flow

```
User attaches file to /music upload (or /playlist add-file)
  │
  ▼
Discord delivers InteractionCreate event
  │  • attachment.size ≤ 25 MB?
  │  • content_type matches audio/* ?
  ▼
[Validator] ──FAIL──▶ HTTP 400 ephemeral reply (see §2.1)
  │ PASS
  ▼
[Uploader] stream attachment URL → download to temp buffer
  │
  ▼
[Virus Scanner] ClamAV / VirusTotal (see security.md §1)
  │  INFECTED ──▶ HTTP 400 + delete temp buffer + alert
  │ CLEAN
  ▼
[Duration Probe] ffprobe → duration ≤ 15 min?
  │  FAIL ──▶ HTTP 400 ephemeral reply
  │ PASS
  ▼
[Storage Uploader] stream to S3-compatible bucket OR local volume
  │  key = {guild_id}/{uploader_id}/{uuid}.{ext}
  │  store checksum_sha256 for dedup
  ▼
[Dedup Check] SELECT id FROM audio_uploads WHERE checksum_sha256 = ?
  │  EXISTS ──▶ return existing track URL; skip re-transcode
  │ NEW
  ▼
[DB Insert] INSERT INTO audio_uploads (status='pending_transcode')
  │
  ▼
[Ingest Job] publish to job queue (Redis stream chopsticks:jobs:transcode)
  │
  ▼
[Transcoder Worker] ffmpeg -i {input} -c:a libopus -b:a 128k {output}.ogg
  │  on failure ──▶ UPDATE audio_uploads SET status='failed'; DM user
  │ SUCCESS
  ▼
UPDATE audio_uploads SET status='ready', storage_key={ogg_key}
  │
  ▼
[Lavalink Enqueuer] POST /v4/sessions/{session}/players/{guild}
  │  body: { encodedTrack or identifier pointing to storage URL }
  │  position_in_queue applied here
  │
  ▼
[Confirmation Reply] edit interaction reply (deferred):
    "✅ **{title}** added to the queue at position #{position}"
```

### 2.1 Validation failure messages

| Condition              | Ephemeral reply                                                                 |
|------------------------|---------------------------------------------------------------------------------|
| Size > 25 MB           | "❌ File too large. Maximum size is **25 MB** (free) or **100 MB** (Premium)." |
| Content-type ≠ audio/* | "❌ Invalid file type. Supported: mp3, ogg, wav, flac."                        |
| Duration > 15 min      | "❌ Track too long. Maximum duration is **15 minutes**."                        |
| Virus detected         | "❌ File rejected: security scan failed. Contact a server admin."              |
| Rate limit hit         | "⏳ Upload limit reached. You can upload **5 files/hour**. Try again <t:…:R>." |

---

## 3. API Contract — Slash Commands

### `/music upload`

| Option           | Type        | Required | Constraints                               |
|------------------|-------------|----------|-------------------------------------------|
| `file`           | Attachment  | Yes      | content-type audio/*; size ≤ 25 MB (free) / 100 MB (premium) |
| `title`          | String      | No       | Max 100 chars; defaults to filename (stripped of extension) |
| `position`       | Integer     | No       | 1-based queue position; defaults to end of queue (`0` = next) |

**Response:** Deferred reply (acknowledge within 3s); edit with confirmation or error once processing completes.

### `/playlist add-file`

Alias for `/music upload` that additionally accepts:

| Option           | Type        | Required | Constraints                |
|------------------|-------------|----------|----------------------------|
| `playlist`       | String      | Yes      | Name of an existing saved playlist to append to |

---

## 4. Storage Schema

```sql
CREATE TABLE audio_uploads (
    id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    guild_id         TEXT         NOT NULL,
    uploader_id      TEXT         NOT NULL,
    filename         TEXT         NOT NULL,
    storage_key      TEXT         NOT NULL UNIQUE,  -- S3 key or local path of transcoded ogg
    original_key     TEXT,                          -- S3 key of original file (pre-transcode); nullable if transcoded in place
    checksum_sha256  CHAR(64)     NOT NULL,
    duration_sec     INTEGER      NOT NULL,
    format           TEXT         NOT NULL,         -- original format: mp3|ogg|wav|flac
    size_bytes       BIGINT       NOT NULL,
    status           TEXT         NOT NULL DEFAULT 'pending_transcode',
                                                    -- pending_transcode | transcoding | ready | failed | expired | deleted
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    expires_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW() + INTERVAL '30 days',
    pinned           BOOLEAN      NOT NULL DEFAULT FALSE,
    title            TEXT,
    playlist_id      UUID         REFERENCES playlists(id) ON DELETE SET NULL
);

CREATE INDEX idx_audio_uploads_guild    ON audio_uploads (guild_id, created_at DESC);
CREATE INDEX idx_audio_uploads_uploader ON audio_uploads (guild_id, uploader_id, created_at DESC);
CREATE INDEX idx_audio_uploads_checksum ON audio_uploads (checksum_sha256);
CREATE INDEX idx_audio_uploads_status   ON audio_uploads (status) WHERE status NOT IN ('ready','deleted');
```

**Provenance metadata** (columns): `uploader_id`, `guild_id`, `created_at`, `checksum_sha256`. These are never nullable and are never altered after insert.

**Storage decision (TBD):** See `missing_inputs.json` — owner must choose between S3-compatible (e.g. MinIO / AWS S3) and local volume. The `storage_key` column format differs: `s3://{bucket}/{key}` vs. `/data/uploads/{key}`.

---

## 5. Voice Playback Flow

```
audio_uploads.status = 'ready'
  │
  ▼
[Queue Manager] receives enqueue request
  │  source: /music upload completion OR /music play {track}
  ▼
[Lavalink Session Check]
  │  no active session? ──▶ join voice channel first
  │  Lavalink unavailable? ──▶ store in chopsticks:queue:{guild_id} (Redis list)
  │                             play when Lavalink reconnects (handled by LavalinkManager.onReconnect)
  ▼
[Track Resolver] build Lavalink track from storage URL
  │  GET /v4/loadtracks?identifier={presigned_url | public_url}
  ▼
[Player Update] PATCH /v4/sessions/{session}/players/{guild_id}
  │  body: { track: { encoded }, position: 0 }
  ▼
Lavalink streams audio to Discord voice gateway (Opus frames)
  │
  ▼
[NowPlaying Embed] bot posts / updates Now Playing message in text channel
    Fields: title, uploader, duration, queue_position, expires_at
```

**Lavalink unavailable:** The enqueue request is stored in a Redis list `chopsticks:queue:{guild_id}`. When `LavalinkManager` emits the `reconnect` event, the bot drains the list and re-enqueues all pending tracks. A warning message is posted to the music channel.

---

## 6. Provenance Metadata

Every audio upload stores the following immutable provenance fields:

| Field              | Source                          | Purpose                                     |
|--------------------|---------------------------------|---------------------------------------------|
| `uploader_id`      | Discord interaction user ID     | Audit, abuse recovery, `/music purge-uploads` |
| `guild_id`         | Discord interaction guild ID    | Quota enforcement, scoped deletion          |
| `created_at`       | Server timestamp at INSERT      | Expiry calculation, chronological ordering  |
| `checksum_sha256`  | SHA-256 of raw downloaded bytes | Deduplication, integrity verification       |
| `filename`         | Discord attachment filename     | Display, format detection                   |

These fields are included in the audit log and in the admin `/music purge-uploads` confirmation embed.
