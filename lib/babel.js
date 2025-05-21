const babel = require("@babel/core");
const { esmcjs, topLevelAwait } = require("ijavascript-babel");

function transformBabel(code) {
  const result = babel.transformSync(code, {
    presets: [[require("@babel/preset-typescript"), { allExtensions: true }]],
    plugins: [esmcjs, topLevelAwait],
    filename: "index.ts",
  });
  return result.code;
}

module.exports = { transformBabel };
