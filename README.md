# Gateway Smash Pickleball

Welcome to the Gateway Smash Pickleball club website! This is a grassroots, volunteer-run alternative to corporate pickleball leagues.

## Prerequisites

- Node.js (version 20 or higher recommended)
- npm

## Getting Started

1. Install dependencies:
   ```bash
   npm ci
   ```
2. Start the local development server:
   ```bash
   npm start
   ```
3. Build the production site:
   ```bash
   npm run build
   ```

## Project Layout

- `index.html` - The main homepage and schedule
- `404.html` - Error page
- `css/` - Stylesheets
- `js/` - JavaScript logic (mobile nav, outside-click, scroll-driven header shadow)
- `img/` - Image assets

## 🗓️ How to Update the League Schedule

Updating the schedule is the most common recurring maintenance task.
1. Open `index.html`.
2. Locate the league schedule section (starts around line 136 `<h2>League Schedule</h2>`).
3. Update the `<tr>` rows within the `<tbody>` table with the new dates, times, and matchup details for the current season.

## Deployment

Changes to the `main` branch are automatically built and deployed.

## License & Contact

- **License:** MIT
- **Contact:** Join our WhatsApp group (link available on the website) for community chat and updates.
