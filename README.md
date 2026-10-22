# PIC Competition Software

Inter-school competition buzzer for Penny International College.
Each school is a team of up to 3 students. A school's buzz counts once per round; the first student to buzz
represents the school. Buzz order is decided by the server clock, so slow phone connections do not change who was first.

## Pages
| Path | Who | What |
|------|-----|------|
| `/` | everyone | Landing page |
| `/host` | host | Room code, round control, buzz order with school logos and student names, teams, scores, setup |
| `/play?code=ABCD` | students | Choose school, enter name, buzz |

## Host setup (first time)
1. Open `/host`. A 4-letter room code appears.
2. Open **Competition setup**. Enter each school's name and upload its logo (up to 8 schools).
3. Optionally upload the competition icon (also clickable in the page header).
4. Press **Save setup**. Students can now join and choose their school.

Setup is remembered in the host's browser, so if the server restarts it is restored automatically when the host page reconnects.
Students must rejoin with the new room code after a server restart.

## Run locally
    npm install
    npm start        # http://localhost:3000
    npm test

## Deploy
Needs a host that runs a Node process with WebSockets (Render, Railway, Fly.io, a VPS). On Render:
Build command `npm install`, Start command `npm start`.
All files sit in one flat folder; run a single instance only (state is kept in memory).
