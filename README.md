# PIC Competition Software

Inter-school competition buzzer for Penny International College.
Each school is a team of up to 3 students. A school's buzz counts once per round; the first student to buzz
represents the school. Buzz order is decided by the server clock, so slow phone connections do not change who was first.

## Pages
| Path | Who | What |
|------|-----|------|
| `/` | everyone | Landing page and sign-in (school team or quiz master) |
| `/host` | host | Full console with sidebar: Home, Live Console, Scoreboard, Schools & Teams, Round History, Display Screen, Settings |
| `/play?code=ABCD` | students | Choose school, enter name, buzz |

## Host setup (first time)
1. Open `/host`. A 4-letter room code appears.
2. Open **Schools & Teams**. Enter each school's name and upload its logo (up to 8 schools).
3. Optionally upload the competition icon (click the dashed square at the top right, or use Settings).
4. Press **Save setup**. Students can now join and choose their school.

Setup is remembered in the host's browser, so if the server restarts it is restored automatically when the host page reconnects.
Students must rejoin with the new room code after a server restart.

## Host password (optional)
Set an environment variable `HOST_PASSWORD` (on Render: Environment tab). The host console then asks for it before a room can be created. Students never need it.

## Display screen
In the console choose **Display Screen** (or the Display button in Live Console) to show a full-screen projector view with the first school's logo, student and time.

## Fonts
Unbounded (headings) and Plus Jakarta Sans (text) are bundled as `.woff` files in this folder, so no internet font service is needed.

## Run locally
    npm install
    npm start        # http://localhost:3000
    npm test

## Deploy
Needs a host that runs a Node process with WebSockets (Render, Railway, Fly.io, a VPS). On Render:
Build command `npm install`, Start command `npm start`.
All files sit in one flat folder; run a single instance only (state is kept in memory).
