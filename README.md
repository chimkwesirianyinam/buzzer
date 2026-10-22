# Quiz Buzzer

A real-time buzzer web app. The host creates a room and shares a 4-letter code; contestants join on their phones and buzz in. The host sees the exact buzz order, with timings measured on the server so network lag on one phone doesn't change who was first.

## Pages

| Path | Who | What |
|------|-----|------|
| `/` | everyone | Landing page (join or host) |
| `/host` | host | Creates a room, shows code + join link, opens/locks buzzers, shows buzz order, scores, kick |
| `/play?code=ABCD` | contestants | Name entry, then a big buzz button |

### Host controls
- **Open buzzers (new round)** clears the previous buzzes and opens the buzzers.
- **Lock** stops further buzzes. **Clear** wipes the buzz list and locks.
- **Lock automatically after first buzz** gives a strict single winner.
- **Sound** beeps (and vibrates on phones) when the first buzz arrives.
- Per-contestant **+ / −** scoring and remove button.

Refreshing the host page or a contestant page keeps them in the room automatically.

## Run locally

```bash
npm install
npm start          # http://localhost:3000
npm test           # end-to-end smoke test
```

## Deploy

This app needs a host that supports a long-running Node process and WebSockets (not static-only hosting like GitHub Pages or plain Netlify/Vercel static).

### Render (easiest)
1. Push this folder to a GitHub repo.
2. Render → New → **Web Service** → pick the repo.
3. Build command: `npm install` · Start command: `npm start`
4. Deploy. Your URL (e.g. `https://your-app.onrender.com`) is the link for everyone. HTTPS and `wss://` work automatically.

### Railway / Fly.io / Heroku
Same idea: it reads the `PORT` environment variable, and `/healthz` is available for health checks.

### Any VPS
```bash
npm install --omit=dev
PORT=3000 node server.js   # put nginx/Caddy in front for HTTPS, with WebSocket upgrade for /ws
```

## Notes and limits
- State is kept in memory: restarting the server ends all rooms. Run **one instance** (don't scale horizontally) so everyone in a room reaches the same process.
- Rooms are removed after 6 hours of inactivity; max 100 contestants per room.
- Free tiers that sleep when idle (e.g. Render free) can take ~30s to wake up, so open the host page a minute before the game.
