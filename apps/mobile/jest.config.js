module.exports = {
  preset: '@react-native/jest-preset',
  // The preset's own transformIgnorePatterns assumes a flat node_modules layout
  // and breaks under pnpm's nested `.pnpm/<pkg>@<version>/node_modules/<pkg>`
  // structure: the pattern's negative lookahead is evaluated against the FIRST
  // "node_modules/" segment it finds (which is ".pnpm/...", not "react-native"),
  // so RN's own ESM source files end up excluded from transformation and Jest
  // fails with "Cannot use import statement outside a module". Clearing it here
  // makes babel-jest transform everything under node_modules instead of trying
  // to special-case react-native packages — slightly slower, but correct.
  transformIgnorePatterns: [],
  setupFiles: ['./jest.setup.js'],
};
