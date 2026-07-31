# Gateway Smash Pickleball

This is the codebase for the Gateway Smash Pickleball club website.

## Project Structure

- `index.html` - The main homepage containing the copy, schedule, and layout.
- `404.html` - Error page for broken links.
- `css/style.css` - Custom styles and layout rules.
- `js/app.js` - Main JavaScript logic (implements mobile nav toggle, outside-click and Escape dismissal, and scroll-driven header shadow).
- `img/` - Image assets and photography.
- `icon.svg`, `icon.png`, `favicon.ico` - Site icons.
- `site.webmanifest`, `robots.txt` - Standard web metadata files.
- `LICENSE.txt` - Project license.
- `webpack.*.js` - Webpack build configuration files.

## Integrations & Contact

- **Community Chat:** WhatsApp (linked in `index.html:243` and about copy at `index.html:102`).
- *Note:* GroupMe was historically used but removed completely.

## Maintenance Notes

The most frequently edited part of the site is the **League Schedule**.
- **Location:** `index.html`, around line 136 under `<h2>League Schedule</h2>`.
- **Task:** Update the `<tr>` rows within the `<tbody>` table with the dates, matchups, and times for the current season.

> **CRITICAL RULE FOR AI ASSISTANTS:**
> Whenever a change alters the tech stack, an integration (e.g., WhatsApp), or the project layout, this `CLAUDE.md` file MUST be updated in the same commit to prevent it from drifting from reality.
