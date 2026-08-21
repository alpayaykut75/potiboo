/** Turbopack/webpack: .md → JS string module */
module.exports = function mdLoader(source) {
  return `export default ${JSON.stringify(source)};`;
};
