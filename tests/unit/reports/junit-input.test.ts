import {expect,it} from 'vitest';
import {parseJunit} from '../../../packages/core/src/domain/junit-parser.js';
const parse=(xml:string)=>parseJunit(new TextEncoder().encode(xml));
it('counts actual nested cases and ignores inflated suite totals',()=>{
 const result=parse('<testsuites tests="999"><testsuite tests="999"><testcase id="T1" name="one"/><testsuite><testcase name="two"><skipped/></testcase><testcase name="three"><failure>secret</failure></testcase></testsuite></testsuite></testsuites>');
 expect(result.ok).toBe(true);if(!result.ok)return;expect(result.cases.map(c=>c.status)).toEqual(['PASS','SKIPPED','FAIL']);expect(result.cases[0]?.id).toBe('T1');
});
it('keeps empty suites empty and recognizes explicit retry evidence',()=>{
 expect(parse('<testsuite tests="42"/>')).toEqual({ok:true,cases:[]});
 const result=parse('<testsuite><testcase name="flaky"><flakyFailure>first attempt</flakyFailure></testcase></testsuite>');expect(result.ok&&result.cases[0]?.flaky).toBe(true);
});
it.each(['<testsuite>','<!DOCTYPE testsuite [<!ENTITY x SYSTEM "file:///secret">]><testsuite/>','<testsuite><testcase name="x"/><testcase name="x"/></testsuite>','<testsuite><testcase name="x" id="same"/><testcase name="y" id="same"/></testsuite>','<html/>','<testsuite><unknown/></testsuite>','<testsuite><testcase name="x"><skipped/><failure/></testcase></testsuite>'])('rejects malformed, entity or ambiguous XML %s',xml=>expect(parse(xml).ok).toBe(false));
it('bounds bytes, XML depth and invalid UTF8 without parsing a partial success',()=>{
 expect(parseJunit(new Uint8Array(8*1024*1024+1)).ok).toBe(false);expect(parse('<testsuite>'.repeat(40)+'</testsuite>'.repeat(40)).ok).toBe(false);expect(parseJunit(new Uint8Array([0xff])).ok).toBe(false);
});
it('decodes predefined entities and supports failure CDATA without exposing messages',()=>{
 const result=parse('<?xml version="1.0" encoding="UTF-8"?><testsuite><testcase name="a &amp; b"><error><![CDATA[password=secret]]></error></testcase></testsuite>');expect(result.ok).toBe(true);if(result.ok){expect(result.cases[0]?.name).toBe('a & b');expect(JSON.stringify(result)).not.toContain('password');}
});
it('supports stackgate-id properties while rejecting contradictory stable identities',()=>{
 const result=parse('<testsuite><testcase name="a"><properties><property name="stackgate-id" value="stable"/></properties></testcase></testsuite>');expect(result.ok&&result.cases[0]?.id).toBe('stable');
 expect(parse('<testsuite><testcase id="first" name="a"><properties><property name="stackgate-id" value="second"/></properties></testcase></testsuite>').ok).toBe(false);
});
it('rejects significant CDATA outside result message elements',()=>expect(parse('<testsuite><![CDATA[unrecognized inventory]]></testsuite>').ok).toBe(false));
