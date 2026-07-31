import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import handlebars from 'vite-plugin-handlebars';

// How assets reach dist/, since none of it is obvious from index.html alone:
//
//   css/style.css  imported by js/app.js, so Vite hashes and minifies it and
//                  injects the <link> itself. index.html deliberately has no
//                  hardcoded stylesheet link.
//   js/app.js      declared as <script type="module"> in index.html. Vite
//                  rewrites src to the hashed filename in place. The old
//                  HtmlWebpackPlugin injected that tag instead of reading it.
//   public/*       copied to dist/ verbatim. This replaces the nine CopyPlugin
//                  patterns the webpack config carried. Output paths and public
//                  URLs are unchanged from the webpack build.
export default defineConfig({
  // Shared header and footer live in partials/ and are pulled in with
  // {{> header}}. Vite has no partials of its own, and #18, #19 and #20 all
  // propose further pages; hand-copying a 37-line header across four files is
  // a drift problem waiting to happen.
  //
  // 404.html deliberately does not use them. It carries its own inline styles
  // and a cut-down header so it still renders when the hashed stylesheet is
  // the thing that failed, and pulling in the site nav would undo that.
  plugins: [
    handlebars({
      partialDirectory: resolve(import.meta.dirname, 'partials'),
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        // 404.html is an entry rather than a public/ passthrough so it stays in
        // the pipeline. It imports no assets today, so it emits byte-identical
        // to the source, but restyling it in #12 will not need a config change.
        main: resolve(import.meta.dirname, 'index.html'),
        404: resolve(import.meta.dirname, '404.html'),
      },
    },
  },
});
