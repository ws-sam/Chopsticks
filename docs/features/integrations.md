# External API Integrations

Chopsticks integrates with several free external APIs that require no API key unless noted.  
All integrations are non-blocking — a network failure returns a graceful fallback rather than breaking the command.

---

## Free, No Key Required

| Command | API | Endpoint | Cache |
|---------|-----|----------|-------|
| `/weather` | [Open-Meteo](https://open-meteo.com/) + [Nominatim](https://nominatim.openstreetmap.org/) | Forecast + geocoding | Redis 15 min |
| `/fact` | [Useless Facts](https://uselessfacts.jsph.pl/) | Random fact | None |
| `/dadjoke` | [icanhazdadjoke](https://icanhazdadjoke.com/) | Random dad joke | None |
| `/joke` | [JokeAPI v2](https://jokeapi.dev/) | Category-filtered jokes | None |
| `/wiki` | [Wikipedia REST API](https://en.wikipedia.org/api/rest_v1/) | Page summary + thumbnail | None |
| `/urban` | [Urban Dictionary](https://api.urbandictionary.com/v0/define) | Term definitions + votes | None |
| `/book` | [Open Library](https://openlibrary.org/search.json) | Book search + cover art | None |
| `/anime` | [AniList GraphQL](https://graphql.anilist.co/) | Anime metadata | None |
| `/steam` | [Steam Community XML](https://steamcommunity.com/<id>?xml=1) | Public profile data | None |
| `/color` | Local canvas | No external call — rendered in-process | N/A |
| Trivia fallback | [Open Trivia DB](https://opentdb.com/api.php) | Live trivia questions | None |

---

## Optional API Keys

### Last.fm (`LASTFM_API_KEY`)
Used by **`/music now`** to enrich now-playing embeds with artist bio, tags, and album art.

- Free tier: 5 requests/second
- Get key: <https://www.last.fm/api/account/create>
- Without key: `/music now` still works, just without Last.fm enrichment

```env
LASTFM_API_KEY=your_key_here
```

### NASA (`NASA_API_KEY`)
Used by **`/apod`** (Astronomy Picture of the Day).

- Free tier: 1,000 requests/day per key
- Without key: falls back to `DEMO_KEY` (30 req/hour, 50 req/day — sufficient for casual use)
- Get key: <https://api.nasa.gov>

```env
NASA_API_KEY=your_key_here
```

---

## Rate Limiting & Resilience

All API calls:
- Use [`undici`](https://undici.nodejs.org/) with explicit `bodyTimeout` + `headersTimeout`
- Catch all network errors and return safe fallback content
- Log warnings via `botLogger.warn` (never throw to the user on API failure)
- Never expose raw API error messages to Discord users

For weather specifically, geocoding results and forecast data are cached in Redis for 15 minutes per location to avoid hammering the free tier.

---

## Adding a New Integration

1. Create `src/commands/<name>.js` with a `SlashCommandBuilder` + `execute()` export
2. Use `request()` from `undici` with explicit timeouts
3. Wrap the fetch in try/catch with a fallback value
4. Log failures with `botLogger.warn({ err }, "[<name>] fetch failed")`
5. Add to README command table and this doc
6. Register the command via `scripts/deploy-commands.js`

See `src/commands/fact.js` for a minimal reference implementation.
