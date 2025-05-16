const babel = require("@babel/core");

function transformBabel(code) {
  const result = babel.transformSync(code, {
    presets: [[require("@babel/preset-typescript"), { allExtensions: true }]],
    plugins: [require("./esmcjs.js"), require("./topLevelAwait.js")],
    filename: "file.ts",
  });
  return result.code;
}

module.exports = { transformBabel };
