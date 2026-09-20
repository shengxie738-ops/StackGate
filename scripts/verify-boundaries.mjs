import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--root')) {
  console.error('Usage: node scripts/verify-boundaries.mjs [--root directory]');
  process.exit(64);
}
const root = path.resolve(args[1] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const normalize = filename => filename.replaceAll('\\', '/');
const relative = filename => normalize(path.relative(root, filename));
const sourcePattern = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const files = [];
function walk(directory) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git'].includes(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(target);
    else if (entry.isFile() && sourcePattern.test(entry.name)) files.push(target);
  }
}
for (const directory of ['apps', 'packages', 'presets', 'integrations']) walk(path.join(root, directory));
if (!files.length) { console.error('Boundary verification has no product source files'); process.exit(1); }
let compilerOptions = { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowJs: true, resolveJsonModule: true };
const tsconfig = path.join(root, 'tsconfig.json');
if (existsSync(tsconfig)) {
  const loaded = ts.readConfigFile(tsconfig, ts.sys.readFile);
  if (loaded.error) throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, '\n'));
  compilerOptions = { ...compilerOptions, ...ts.parseJsonConfigFileContent(loaded.config, ts.sys, root).options };
}
const issues = new Set();
const records = new Map();
const runtimeGlobals = new Set(['process', 'global', 'globalThis', 'performance', 'fetch', 'XMLHttpRequest', 'WebSocket', 'Worker', 'setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask', 'crypto', 'console', 'require', 'eval', 'Function', 'Deno', 'Bun']);
const reporterTypes = new Set(['RunService', 'RunnerPort', 'AuthorizedRunner', 'ExecutionContext', 'execute']);
function issue(filename, source, node, code, message) {
  const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
  issues.add(`${relative(filename)}:${line + 1} [${code}] boundary forbidden: ${message}`);
}
function propertyName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression)) return node.argumentExpression.text;
  return null;
}
function typeOnlyImport(node) {
  if (ts.isImportDeclaration(node)) {
    if (node.importClause?.isTypeOnly) return true;
    const clause = node.importClause;
    return !!clause && !clause.name && !!clause.namedBindings && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every(item => item.isTypeOnly);
  }
  return node.isTypeOnly === true;
}
for (const filename of files) {
  const source = ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
  const record = { filename, source, imports: [], domainEffects: [], reporterEffects: [] };
  records.set(path.resolve(filename), record);
  function addImport(value, node, typeOnly = false, names = []) {
    const resolved = ts.resolveModuleName(value, filename, compilerOptions, ts.sys).resolvedModule?.resolvedFileName;
    const target = resolved ? path.resolve(resolved) : value.startsWith('.') ? path.resolve(path.dirname(filename), value) : null;
    record.imports.push({ value, node, typeOnly, target });
    if (/(^|[/\\])tests?([/\\]|$)|fake[-_]adapters?/i.test(value) || (target && /(^|\/)tests?\//i.test(normalize(target)))) issue(filename, source, node, 'PRODUCT_TEST_IMPORT', value);
    if (/(?:^|[/\\])(?:runner|run[-_]?service)(?:\.|[/\\]|$)/i.test(value) || names.some(name => reporterTypes.has(name))) record.reporterEffects.push({ node, message: `execution dependency ${value}` });
  }
  function inspect(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
        const names = [];
        if (ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) for (const item of node.importClause.namedBindings.elements) names.push(item.propertyName?.text ?? item.name.text);
        if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) for (const item of node.exportClause.elements) names.push(item.propertyName?.text ?? item.name.text);
        addImport(node.moduleSpecifier.text, node, typeOnlyImport(node), names);
      }
      return;
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteralLike(node.moduleReference.expression)) addImport(node.moduleReference.expression.text, node, node.isTypeOnly);
    if (ts.isTypeNode(node)) return;
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const module = node.arguments[0];
      if (module && ts.isStringLiteralLike(module)) addImport(module.text, node);
      else issue(filename, source, node, 'DYNAMIC_IMPORT', 'module imports must use statically inspectable names');
    }
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const isKey = (ts.isPropertyAccessExpression(parent) && parent.name === node) || (ts.isPropertyAssignment(parent) && parent.name === node) || (ts.isMethodDeclaration(parent) && parent.name === node);
      if (!isKey && runtimeGlobals.has(node.text)) record.domainEffects.push({ node, message: `runtime global ${node.text}` });
      if (node.text === 'Date' && !isKey) {
        const deterministic = (ts.isPropertyAccessExpression(parent) && parent.expression === node && ['parse', 'UTC'].includes(parent.name.text)) || (ts.isNewExpression(parent) && parent.expression === node && (parent.arguments?.length ?? 0) > 0 && !parent.arguments.some(ts.isSpreadElement));
        if (!deterministic) record.domainEffects.push({ node, message: 'system clock Date must be injected' });
      }
      if (node.text === 'Math' && !isKey && !((ts.isPropertyAccessExpression(parent) && parent.expression === node && parent.name.text !== 'random') || (ts.isElementAccessExpression(parent) && parent.expression === node && parent.argumentExpression && ts.isStringLiteralLike(parent.argumentExpression) && parent.argumentExpression.text !== 'random'))) record.domainEffects.push({ node, message: 'Math aliases or randomness are not allowed in domain' });
    }
    if (ts.isBindingElement(node) && (node.propertyName ?? node.name).getText(source) === 'execute') record.reporterEffects.push({ node, message: 'reporter cannot acquire an execute capability by destructuring' });
    const property = propertyName(node);
    if (property === 'random' && (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && ts.isIdentifier(node.expression) && node.expression.text === 'Math') record.domainEffects.push({ node, message: 'randomness must be injected' });
    if (property === 'execute') record.reporterEffects.push({ node, message: 'reporter cannot execute checks or RunService' });
    ts.forEachChild(node, inspect);
  }
  inspect(source);
}
function verifyReachable(origin, mode) {
  const visited = new Set();
  function visit(record) {
    if (visited.has(record.filename)) return;
    visited.add(record.filename);
    for (const effect of mode === 'domain' ? record.domainEffects : record.reporterEffects) issue(record.filename, record.source, effect.node, mode === 'domain' ? 'DOMAIN_PURITY' : 'REPORTER_EXECUTION', `${effect.message}; reached from ${relative(origin.filename)}`);
    for (const dependency of record.imports) {
      if (dependency.typeOnly) continue;
      if (mode === 'domain') {
        const target = dependency.target ? relative(dependency.target) : dependency.value;
        if (!dependency.target || /(^|\/)(?:apps\/cli|adapter-[^/]+|services|storage|reporters|tests)(\/|$)/.test(target) || dependency.value.startsWith('node:')) issue(record.filename, record.source, dependency.node, 'DOMAIN_IMPORT', `${dependency.value}; reached from ${relative(origin.filename)}`);
      }
      const next = dependency.target && records.get(dependency.target);
      if (next) visit(next);
    }
  }
  visit(origin);
}
for (const record of records.values()) {
  const file = relative(record.filename);
  if (/(^|\/)domain\//.test(file)) verifyReachable(record, 'domain');
  if (/^packages\/reporters\//.test(file)) verifyReachable(record, 'reporter');
}
if (issues.size) { console.error([...issues].sort().join('\n')); process.exitCode = 1; }
else console.log(`Verified module boundaries for ${files.length} product source files using the TypeScript AST.`);
