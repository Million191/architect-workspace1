# AI-Project

A personal project workspace for coursework.

## Barber shop website

A static site in `src/` for a fictional barber shop ("Fade & Line") with:

- Seat availability by date/time (3 chairs, hourly slots, 9am-6pm, closed Sundays)
- An appointment request form
- A list of requested appointments (with cancel)

No build step or server needed — data is saved in the browser via `localStorage`, so it's per-device/per-browser only.

To run it, open `src/index.html` directly in a browser, or serve the folder locally, e.g.:

```
npx serve src
```
