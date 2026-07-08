// Scope the ported capture stylesheet (src/capture/capture.css) under `.cap` so its
// global class names (.btn, .card, .chip, .input, …) can't fight the web app's own
// definitions — both stylesheets derive from the Flux tokens but style the same names
// differently. ONLY capture.css is transformed; every other stylesheet passes through.
// The /capture route renders inside <div className="cap"> (see App.tsx).
const prefixer = require('postcss-prefix-selector');

module.exports = {
  plugins: [
    prefixer({
      prefix: '.cap',
      includeFiles: [/[\\/]capture[\\/]capture\.css$/],
      transform(prefix, selector, prefixedSelector) {
        const s = selector.trim();
        // Keyframe steps aren't element selectors — leave them alone.
        if (/^(\d+(\.\d+)?%|from|to)$/.test(s)) return selector;
        // Document-level selectors become the wrapper itself: capture's tokens and
        // page background then apply to (and cascade within) the .cap subtree only.
        if (s === ':root' || s === 'html' || s === 'body' || s === '#root') return prefix;
        // Dark tokens: data-theme lives on <html>, .cap is a descendant — the custom
        // properties re-cascade inside the wrapper.
        if (s.startsWith('[data-theme')) return `${s} ${prefix}`;
        return prefixedSelector;
      },
    }),
  ],
};
