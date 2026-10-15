# Waypoint (no API keys)

A static website. No server, no environment variables, no accounts needed.
Files: `index.html` and `keyless.js`. Keep them in the same folder.

## Put it online with Vercel
Option A (GitHub): create a repository, upload BOTH files at the top level, then import it at
https://vercel.com/new and click Deploy. Leave every setting as it is.
Option B (command line): in this folder run `npx vercel`, accept the defaults, then `npx vercel --prod`.

## Or open it on your own computer
Run `python3 -m http.server 8000` in this folder and open http://localhost:8000
(opening the file by double-click may block some requests).

## Where the data comes from (all free, no key)
- Learning path and notes: Wikipedia and Wikibooks (open APIs), and public GitHub repositories.
- Videos: real YouTube videos, but only if you paste a free YouTube key under Customize (it stays in your browser). Without a key, video steps show a YouTube search link, because no free keyless source gave relevant videos.
- Tests: fill-in-the-blank questions made from the text of that phase's own pages.
- Nothing here uses an AI model, so notes are auto-summaries, not rewritten explanations.

## Limits to know about
- Works best for topics that have a Wikipedia article. Very new or very niche topics may return nothing.
- GitHub allows only a few anonymous searches per minute per visitor. If it is busy, the GitHub item is skipped.
- PeerTube has far fewer videos than YouTube. If none match, the step shows a link to search YouTube.
- Only Wikipedia, Wikibooks and GitHub steps can be turned into notes. Other links need to be read on their own sites.
- If a public service changes or goes down, that part is skipped or shows a message.
