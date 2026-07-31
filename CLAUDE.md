# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Gateway Smash Pickleball is a static website for a grassroots pickleball league in St. Louis. This is a simple frontend-only project built with vanilla HTML, CSS, and JavaScript, using Webpack for bundling and development.

## Common Commands

- **Development server**: `npm start` - Starts webpack dev server with live reload and opens browser
- **Production build**: `npm run build` - Creates optimized production build in `dist/` directory
- **Test**: No test framework configured - `npm test` returns an error message

## Project Structure

The project follows a simple static site structure:

- `index.html` - Main homepage with embedded content sections
- `css/style.css` - All styles for the website
- `js/app.js` - Main JavaScript entry point (currently minimal/empty)
- `img/` - Favicon and icon assets
- `webpack.*.js` - Webpack configuration files for dev and production builds

## Build Configuration

The project uses Webpack with separate configurations:

- `webpack.common.js` - Base configuration with entry point at `js/app.js`
- `webpack.config.dev.js` - Development configuration with live reload and hot module replacement
- `webpack.config.prod.js` - Production configuration that copies static assets (CSS, images, favicon files) and generates optimized output

## Content Management

The website content is entirely contained within `index.html` including:
- Hero section with call-to-action to external registration
- About section with features
- League schedule table with tentative dates
- Contact information with external links to GroupMe and email

External integrations:
- Global Pickleball Network for registration
- GroupMe for community chat
- Notion for FAQs (linked in navigation)

## Development Notes

- This is a frontend-only static website with no backend or database
- All content is hardcoded in HTML - updates require direct HTML editing
- CSS and JavaScript are minimal - mainly static content presentation
- Production build copies all assets to `dist/` directory for deployment