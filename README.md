# Robins Scoreboard

A live AVA volleyball scoreboard for match streams filmed on an iPhone with
[Tubeist](https://github.com/Roenbaeck/tubeist). One phone films, another keeps score,
and the score appears on the stream.

- `overlay.html?court=1`: add this link to Tubeist (Settings → Overlays). The page is see-through.
- `scorer.html?court=1`: the scorer page. It needs the club's scorer code.
- `index.html`: overlay links for each court.

Scores are kept by the club's live-score service (a Google Apps Script web app); its address
is in `config.js`. Source, tests and the service code live in the club's private Robins Live repo.

Team, region and AVA logos belong to their owners and are used here to identify teams.
Fonts: Bebas Neue and Barlow Condensed, SIL Open Font License (see `fonts/`).
