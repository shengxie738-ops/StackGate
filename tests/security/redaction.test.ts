import {expect,it} from 'vitest';
import {RedactionStream,redactText,escapeLogPresentation} from '../../packages/core/src/evidence/redaction.js';
it('redacts split headers, known secrets, cookies and URL passwords before emitting text',()=>{
 const stream=new RedactionStream(['secret-canary']);let output='';for(const chunk of ['Author','ization: Bea','rer secret-canary\nCookie: abc=123\nSet-Coo','kie: session=456\nhttps://user:password@host/path\nsecret-','canary\n'])output+=stream.push(Buffer.from(chunk));output+=stream.finish();
 for(const secret of ['secret-canary','abc=123','session=456','password'])expect(output).not.toContain(secret);expect(output).toContain('[REDACTED]');
});
it('preserves split UTF-8 while stripping ANSI and escaping untrusted Markdown presentation',()=>{
 const stream=new RedactionStream([]),bytes=Buffer.from('中文\u001b[31mred\u001b[0m\n');let output='';for(const byte of bytes)output+=stream.push(Uint8Array.of(byte));output+=stream.finish();expect(output).toBe('中文red\n');
 expect(escapeLogPresentation('[click](javascript:bad) <script>')).toBe('\\[click\\]\\(javascript:bad\\) &lt;script&gt;');
});
it('discards overlong unfinished lines instead of exposing their secret suffix',()=>{
 const stream=new RedactionStream(['CANARY'],{maxLineBytes:32});expect(stream.push(Buffer.from('Authorization: '+ 'x'.repeat(100)))).not.toContain('xxx');const text=stream.push(Buffer.from('CANARY\n'))+stream.finish();expect(text).not.toContain('CANARY');expect(text).not.toContain('xxx');
});
it('redacts common database password fields without storing a raw secret hash',()=>{expect(redactText('{"password":"tiny","token":"KNOWN"}\nBearer another-secret',['KNOWN'])).not.toMatch(/tiny|KNOWN|another-secret/);});
it('redacts each line of a supplied multiline credential across stream chunks',()=>{const stream=new RedactionStream(['PRIVATE_FIRST\nPRIVATE_SECOND']);const output=stream.push(Buffer.from('PRIVATE_FIRST\n'))+stream.push(Buffer.from('PRIVATE_SECOND\n'))+stream.finish();expect(output).not.toContain('PRIVATE_FIRST');expect(output).not.toContain('PRIVATE_SECOND');});
it('redacts quoted JSON header values embedded in ordinary log text',()=>{expect(redactText('log {"Authorization":"canary-header","Cookie":"canary-cookie"}')).not.toMatch(/canary-header|canary-cookie/);});
