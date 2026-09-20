import ts from 'typescript';
export interface WrapperCall { callee: string; method: string }
export interface LiteralCall { callee: string; url?: string; method?: string; line: number; reason?: string }
function name(node: ts.Expression): string | undefined {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) { const parent = name(node.expression); return parent ? `${parent}.${node.name.text}` : undefined; }
  return undefined;
}
export function literalCalls(source: ts.SourceFile, wrappers: readonly WrapperCall[]): LiteralCall[] {
  const calls: LiteralCall[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = name(node.expression);
      const wrapper = wrappers.find(item => item.callee === callee);
      const directFetch = callee === 'fetch' || callee === 'globalThis.fetch' || callee === 'window.fetch';
      const possibleClient = callee && /\.(?:get|post|put|patch|delete|request|fetch)$/i.test(callee);
      if (callee && (directFetch || wrapper || possibleClient)) {
        const call: LiteralCall = { callee, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 };
        const argument = node.arguments[0];
        if (!directFetch && !wrapper) call.reason = 'Unconfigured client or dependency-injected call';
        else if (!argument || !(ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) call.reason = 'Dynamic or missing request URL';
        else {
          call.url = argument.text;
          call.method = wrapper?.method.toUpperCase() ?? 'GET';
          const options = node.arguments[1];
          if (directFetch && options) {
            if (!ts.isObjectLiteralExpression(options)) call.reason = 'Request options are not a static object';
            else for (const property of options.properties) {
              if (ts.isSpreadAssignment(property)) call.reason = 'Request options contain a spread';
              else if (property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) && property.name.text === 'method') {
                if (ts.isPropertyAssignment(property) && ts.isStringLiteral(property.initializer)) call.method = property.initializer.text.toUpperCase();
                else call.reason = 'HTTP method is not a literal';
              } else if (property.name && ts.isComputedPropertyName(property.name)) call.reason = 'Computed request option';
            }
          }
        }
        calls.push(call);
      }
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require')) calls.push({ callee: 'module-loader', line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, reason: 'Runtime module loading is outside static import support' });
    }
    ts.forEachChild(node, visit);
  };
  visit(source); return calls;
}
