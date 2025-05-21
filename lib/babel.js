const babel = require("@babel/core");
const { topLevelAwait } = require("ijavascript-babel");

function transformBabel(code) {
  const result = babel.transformSync(code, {
    presets: [[require("@babel/preset-typescript"), { allExtensions: true }]],
    plugins: [
      [
        require("@babel/plugin-transform-modules-commonjs"),
        {
          importInterop: "node",
          strictMode: false,
        },
      ],
      topLevelAwait,
    ],
    filename: "index.ts",
  });
  return result.code;
}

module.exports = { transformBabel };
