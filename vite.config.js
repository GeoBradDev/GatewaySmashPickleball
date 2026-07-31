import { defineConfig } from 'vite';
import { resolve } from 'node:path';

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
