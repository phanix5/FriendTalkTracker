# Friend Talk Tracker

A simple, modern, dark-ish web app to track when you last talked to friends, prioritize who to reach out to, and jot notes for your next chat. Data is saved to your browser (localStorage). Works offline in modern browsers (Chrome, Firefox).

## Features

- Add friends with category: Friend, Close friend, Best friend
- Record conversations with mode (Call, Text, DM, Meetup) and optional backdating
- Quick action: “Talked today”
- Running notes per friend that clear automatically when you log a conversation
- Prioritized list: longest time since last talked at the top; category as tiebreaker
- Highlight when time since last talk exceeds configurable thresholds per category
- Import/Export JSON (export includes settings). Import replaces all data.
- Dark, modern UI with smooth animations and visual progress bar

## Getting started

1. Open `index.html` in your browser (double-click it or drag it into a browser).
2. Add friends and start tracking.

## Data & Settings

- Stored under the localStorage key `ftt_state_v1`.
- Default thresholds (days): Best 7, Close 14, Friend 30.
- Export produces a JSON with `friends`, `order`, `settings`, `version`.
- Import replaces all current data and settings.

## Notes

- If a friend has never been talked to, they get a “New” badge and appear near the top.
- The progress bar reflects how close you are to the category threshold; it glows and turns warm when overdue.



