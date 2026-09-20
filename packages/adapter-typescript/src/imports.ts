import path from 'node:path';
import ts from 'typescript';
export interface StaticCompilerOptions { baseUrl?: string; paths?: Record<string, string[]>; plugins?: unknown; extends?: unknown; [key: string]: unknown }
export function importSpecifiers(source: ts.SourceFile): string[] {
  const result: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) result.push(node.moduleSpecifier.text);
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)) result.push(node.moduleReference.expression.text);
    ts.forEachChild(node, visit);
  };
  visit(source); return [...new Set(result)];
}
export function resolveStaticImport(specifier: string, from: string, files: ReadonlySet<string>, options: StaticCompilerOptions): string | undefined {
  const roots: string[] = [];
  if (specifier.startsWith('.')) roots.push(path.posix.join(path.posix.dirname(from), specifier));
  else {
    for (const [pattern, targets] of Object.entries(options.paths ?? {})) {
      if (!Array.isArray(targets) || !targets.every(item => typeof item === 'string') || pattern.split('*').length > 2) continue;
      const [start = '', end = ''] = pattern.split('*');
      const wildcard = pattern.includes('*');
      if (wildcard ? !specifier.startsWith(start) || !specifier.endsWith(end) : specifier !== pattern) continue;
      const substitution = wildcard ? specifier.slice(start.length, specifier.length - end.length) : '';
      for (const target of targets) if (target.split('*').length <= 2) roots.push(path.posix.join(typeof options.baseUrl === 'string' ? options.baseUrl : '.', target.replace('*', substitution)));
    }
  }
  for (const root of roots) {
    if (root === '..' || root.startsWith('../') || path.posix.isAbsolute(root) || root.includes('\\') || root.includes(':')) continue;
    const stem = root.replace(/\.(?:mjs|cjs|js|jsx)$/, '');
    const candidates = [root, ...['.ts', '.tsx', '.mts', '.cts', '.d.ts', '/index.ts', '/index.tsx'].map(extension => stem + extension)];
    const matches = [...new Set(candidates)].filter(candidate => files.has(candidate));
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return undefined;
  }
  return undefined;
}
