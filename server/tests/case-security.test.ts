import test from 'node:test';
import assert from 'node:assert/strict';
import {hasPermission,caseBranchScope,duplicateCaseKey,sanitizeCaseText,safeSpreadsheetText,documentMagicMatches} from '../src/case-security';

test('case permissions are explicit',()=>{
 assert.equal(hasPermission(['case.read','case.report'],'case.read'),true);
 assert.equal(hasPermission(['case.read'],'case.update'),false);
 assert.equal(hasPermission(['case.create','case.read','case.update','case.report','case.upload'],'case.upload'),true);
});
test('case branch scope is strict for officers and empty for super admin',()=>{
 assert.deepEqual(caseBranchScope({branchId:7,branch:{isHead:false},role:{name:'System Case Register Officer'}}),{branchId:7});
 assert.deepEqual(caseBranchScope({branchId:1,branch:{isHead:false},role:{name:'ADMIN'}}),{branchId:1});
 assert.deepEqual(caseBranchScope({branchId:1,branch:{isHead:false},role:{name:'SUPER_ADMIN'}}),{});
});
test('duplicate case key is unique by case type and normalized number',()=>{
 assert.equal(duplicateCaseKey(2,' ABC-123 '),duplicateCaseKey(2,'abc-123'));
 assert.notEqual(duplicateCaseKey(1,'ABC-123'),duplicateCaseKey(2,'ABC-123'));
});
test('case text sanitization removes control and markup characters',()=>{
 assert.equal(sanitizeCaseText('  Hello <b>citizen</b>\u0000  '),'Hello citizen');
});
test('xlsx formula-like values are neutralized',()=>{
 assert.equal(safeSpreadsheetText('=HYPERLINK(\"x\")'),"'=HYPERLINK(\"x\")");
 assert.equal(safeSpreadsheetText('+SUM(A1)'),"'+SUM(A1)");
 assert.equal(safeSpreadsheetText('Normal name'),'Normal name');
});
test('document magic bytes match accepted types',()=>{
 assert.equal(documentMagicMatches('application/pdf',Buffer.from('%PDF-1.7')),true);
 assert.equal(documentMagicMatches('image/png',Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])),true);
 assert.equal(documentMagicMatches('image/jpeg',Buffer.from([0xff,0xd8,0xff,0xe0])),true);
 assert.equal(documentMagicMatches('image/png',Buffer.from('%PDF-1.7')),false);
});
