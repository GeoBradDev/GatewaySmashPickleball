const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  entry: {
    app: './js/app.js',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    clean: true,
    filename: './js/app.js',
  },
  plugins: [
    // Shared with the dev server on purpose. index.html has no hardcoded
    // script tag, so the dev config needs this plugin too or development
    // would load no JavaScript at all.
    new HtmlWebpackPlugin({
      template: './index.html',
    }),
  ],
};
