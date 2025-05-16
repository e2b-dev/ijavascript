module.exports = function importEsModulesInCjs(api) {
    // Ensure we are running on a compatible Babel version
    api.assertVersion(7);
  
    const t = api.types;
  
    return {
      name: 'transform-import-esm-to-await-import-commonjs',
  
      visitor: {
        Program(programPath) {
          // Traverse only the immediate body statements so we keep ordering
          programPath.get('body').forEach((path) => {
            if (!path.isImportDeclaration()) return;
  
            const { node } = path;
            const { source, specifiers } = node;
  
            const statements = [];
  
            // ------------------------------------------------------------------
            // 1. Pure side-effect import → `await import('module');`
            // ------------------------------------------------------------------
            if (specifiers.length === 0) {
              statements.push(
                t.expressionStatement(
                  t.awaitExpression(
                    t.callExpression(t.import(), [source]),
                  ),
                ),
              );
              path.replaceWithMultiple(statements);
              return;
            }
  
            // ------------------------------------------------------------------
            // 2. Categorise specifiers                                        
            // ------------------------------------------------------------------
            const defaultSpec = specifiers.find((s) => t.isImportDefaultSpecifier(s));
            const namespaceSpec = specifiers.find((s) => t.isImportNamespaceSpecifier(s));
            const namedSpecs = specifiers.filter((s) => t.isImportSpecifier(s));
  
            // Helper: create `await import('source')` expression once, reuse
            const importCall = t.awaitExpression(t.callExpression(t.import(), [source]));
  
            if (namespaceSpec) {
              // ----------------------------------------------------------------
              // Pattern with `* as ns` (optionally with default / named too).
              // ----------------------------------------------------------------
              const nsId = t.identifier(namespaceSpec.local.name);
  
              // const ns = await import('mod');
              statements.push(
                t.variableDeclaration('const', [
                  t.variableDeclarator(nsId, importCall),
                ]),
              );
  
              // Handle optional default specifier: const def = ns.default;
              if (defaultSpec) {
                statements.push(
                  t.variableDeclaration('const', [
                    t.variableDeclarator(
                      t.identifier(defaultSpec.local.name),
                      t.memberExpression(nsId, t.identifier('default')),
                    ),
                  ]),
                );
              }
  
              // Handle named specifiers: const { foo: fooAlias } = ns;
              namedSpecs.forEach((spec) => {
                const local = t.identifier(spec.local.name);
                const importedKey = t.identifier(spec.imported.name);
                statements.push(
                  t.variableDeclaration('const', [
                    t.variableDeclarator(
                      local,
                      t.memberExpression(nsId, importedKey),
                    ),
                  ]),
                );
              });
            } else {
              // ----------------------------------------------------------------
              // No namespace import ⇒ we can destructure directly from the
              // awaited namespace object.
              // ----------------------------------------------------------------
              const properties = [];
  
              if (defaultSpec) {
                properties.push(
                  t.objectProperty(
                    t.identifier('default'),
                    t.identifier(defaultSpec.local.name),
                  ),
                );
              }
  
              namedSpecs.forEach((spec) => {
                const key = t.identifier(spec.imported.name);
                const value = t.identifier(spec.local.name);
                const shorthand = key.name === value.name && !defaultSpec; // default never shorthand
                properties.push(t.objectProperty(key, value, false, shorthand));
              });
  
              // const { default: def, foo, bar: baz } = await import('mod');
              statements.push(
                t.variableDeclaration('const', [
                  t.variableDeclarator(
                    t.objectPattern(properties),
                    importCall,
                  ),
                ]),
              );
            }
  
            // Replace original `import` declaration with generated statements
            path.replaceWithMultiple(statements);
          });
        },
      },
    };
  }
  