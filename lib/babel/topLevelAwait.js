/*
 * Babel plugin: transform-top-level-await (CommonJS/REPL semantics)
 * ------------------------------------------------------------------
 * Enables use of true "top-level await" in environments that execute
 * code as CommonJS (e.g. Node.js REPL, scripts evaluated with `vm`).
 *
 * The plugin wraps the entire program into an async IIFE and rewrites
 * top-level declarations so they continue to behave as if they were
 * evaluated in the global scope (mirrors Node.js' internal transform).
 *
 * Key behaviours implemented:
 *   1. Abort when the source does NOT contain a top-level `await` or
 *      when it DOES contain an illegal top-level `return`.
 *   2. Hoist `var` declarations as `var` and `let`/`const`/classes as
 *      `let`, so the bindings stay visible after evaluation.
 *   3. Rewrite top-level variable declarations into assignment
 *      expressions executed *inside* the async IIFE.
 *   4. Ensure the last expression's value is exposed by returning an
 *      object like `{ value: <expr> }` (mimics Node.js REPL result).
 */

"use strict";

module.exports = function babelPluginTopLevelAwait(api) {
  const t = api.types;

  /* ------------------------------------------------------------------ */
  /* Helpers                                                            */
  /* ------------------------------------------------------------------ */
  // Collect all Identifier nodes contained in a binding pattern
  function collectPatternIds(pattern, out) {
    if (!pattern) return;
    switch (pattern.type) {
      case "Identifier":
        out.push(pattern);
        break;
      case "ObjectPattern":
        for (const p of pattern.properties) {
          collectPatternIds(p.value || p.argument, out);
        }
        break;
      case "ArrayPattern":
        for (const el of pattern.elements) collectPatternIds(el, out);
        break;
      case "RestElement":
        collectPatternIds(pattern.argument, out);
        break;
      case "AssignmentPattern":
        collectPatternIds(pattern.left, out);
        break;
    }
  }

  // Determines whether the path is at the program's top level (i.e. not
  // nested within a function/class).
  function isProgramTopLevel(path) {
    return path.parentPath && path.parentPath.isProgram();
  }

  /* ------------------------------------------------------------------ */
  /* Visitor                                                            */
  /* ------------------------------------------------------------------ */
  return {
    name: "transform-top-level-await-commonjs",

    visitor: {
      Program(programPath) {
        const bodyPaths = programPath.get("body");

        /* ------------------------------------------------------------ */
        /* 1. Analyse program for `await`/`return` at the top level.    */
        /* ------------------------------------------------------------ */
        let containsTopLevelAwait = false;
        let containsTopLevelReturn = false;

        programPath.traverse({
          AwaitExpression(path) {
            if (!path.getFunctionParent()) containsTopLevelAwait = true;
          },
          ForOfStatement(path) {
            if (path.node.await && !path.getFunctionParent()) {
              containsTopLevelAwait = true;
            }
          },
          ReturnStatement(path) {
            if (!path.getFunctionParent()) containsTopLevelReturn = true;
          },
        });

        // Abort if no await or illegal return present.
        if (!containsTopLevelAwait || containsTopLevelReturn) return;

        /* ------------------------------------------------------------ */
        /* 2. Prepare hoisted bindings & rewrite declarations.          */
        /* ------------------------------------------------------------ */
        const hoisted = [];

        // Clone original body array; we'll move it into the IIFE later.
        const innerBody = [];

        bodyPaths.forEach((stmtPath) => {
          // `stmtPath` might be manipulated; work with its node clone.
          const node = stmtPath.node;

          // Handle FunctionDeclaration --------------------------------
          if (
            t.isFunctionDeclaration(node) &&
            node.id &&
            isProgramTopLevel(stmtPath)
          ) {
            // Record hoisted var.
            hoisted.push(
              t.variableDeclaration("var", [
                t.variableDeclarator(t.identifier(node.id.name)),
              ])
            );

            // Insert `fn = function fn(...) {}` assignment instead of decl.
            const funcExpr = t.functionExpression(
              node.id,
              node.params,
              node.body,
              node.generator,
              node.async
            );
            innerBody.push(
              t.expressionStatement(
                t.assignmentExpression(
                  "=",
                  t.identifier(node.id.name),
                  funcExpr
                )
              )
            );
            return; // skip default push
          }

          // Handle ClassDeclaration -----------------------------------
          if (
            t.isClassDeclaration(node) &&
            node.id &&
            isProgramTopLevel(stmtPath)
          ) {
            // Hoist as `let`.
            hoisted.push(
              t.variableDeclaration("let", [
                t.variableDeclarator(t.identifier(node.id.name)),
              ])
            );

            // Replace with assignment expression.
            innerBody.push(
              t.expressionStatement(
                t.assignmentExpression("=", t.identifier(node.id.name), node)
              )
            );
            return;
          }

          // Handle VariableDeclaration --------------------------------
          if (t.isVariableDeclaration(node) && isProgramTopLevel(stmtPath)) {
            const ids = [];
            node.declarations.forEach((decl) =>
              collectPatternIds(decl.id, ids)
            );
            if (ids.length) {
              const kind = node.kind === "var" ? "var" : "let"; // const → let
              hoisted.push(
                t.variableDeclaration(
                  kind,
                  ids.map((id) => t.variableDeclarator(t.identifier(id.name)))
                )
              );
            }

            // Build assignment expressions inside IIFE.
            const assignments = node.declarations.map((decl) => {
              const left = decl.id;
              const right = decl.init || t.identifier("undefined");
              return t.assignmentExpression("=", left, right);
            });

            innerBody.push(
              t.expressionStatement(
                assignments.length === 1
                  ? assignments[0]
                  : t.sequenceExpression(assignments)
              )
            );
            return;
          }

          // All remaining statements are pushed unchanged.
          innerBody.push(node);
        });

        /* ------------------------------------------------------------ */
        /* 3. Ensure result of final expression is returned.            */
        /* ------------------------------------------------------------ */
        if (innerBody.length) {
          const lastIdx = innerBody.length - 1;
          const lastNode = innerBody[lastIdx];
          // Only return if the final statement is a plain expression (skip assignments),
          // mirroring Node.js REPL behaviour.
          if (
            t.isExpressionStatement(lastNode) &&
            !t.isAssignmentExpression(lastNode.expression)
          ) {
            innerBody[lastIdx] = t.returnStatement(lastNode.expression);
          }
        }

        /* ------------------------------------------------------------ */
        /* 4. Build async IIFE + replace program body.                  */
        /* ------------------------------------------------------------ */
        const asyncIIFE = t.callExpression(
          t.arrowFunctionExpression(
            [],
            t.blockStatement(innerBody),
            true /* async */
          ),
          []
        );

        programPath.node.body = [...hoisted, t.expressionStatement(asyncIIFE)];
      },
    },
  };
};
