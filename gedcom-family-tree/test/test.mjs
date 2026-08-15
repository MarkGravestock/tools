// Unit tests for the parser, the 5.5.1 validator and the layout engine.
// No dependencies — run with `npm test` (or `node test/test.mjs`).
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { parseGedcom, parseGedcomDate, tokenizeGedcom } from '../src/gedcom.js';
import { validateGedcom } from '../src/validate.js';
import { layoutGraph, relatedSubset } from '../src/layout.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (n) => readFileSync(join(here, 'fixtures', n), 'utf8');

let pass = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; return; }
  failures.push(name + (extra === undefined ? '' : '  (got ' + JSON.stringify(extra) + ')'));
}
const eq = (name, got, want) => check(name, Object.is(got, want) || got === want, got);
const section = (t) => console.log('\n' + t);

// ── Dates ───────────────────────────────────────────────────────────────────
section('DATE_VALUE parsing');
const D = parseGedcomDate;
eq('day month year', D('12 JAN 1898').display, '12 Jan 1898');
eq('  → year', D('12 JAN 1898').year, 1898);
eq('  → conforming', D('12 JAN 1898').conforming, true);
eq('month year', D('APR 1866').display, 'Apr 1866');
eq('year only', D('1898').year, 1898);
eq('dual year', D('1750/51').display, '1750/51');
eq('about', D('ABT 1780').display, 'abt. 1780');
eq('  → qualifier', D('ABT 1780').qualifier, 'about');
eq('before', D('BEF 1900').display, 'before 1900');
eq('after', D('AFT 1900').display, 'after 1900');
eq('estimated', D('EST 1812').qualifier, 'estimated');
eq('between', D('BET 1900 AND 1910').display, 'between 1900–1910');
eq('  → start year', D('BET 1900 AND 1910').year, 1900);
eq('  → end year', D('BET 1900 AND 1910').endYear, 1910);
eq('period', D('FROM 1920 TO 1958').display, '1920–1958');
eq('open period', D('FROM 1920').display, 'from 1920');
eq('phrase', D('(sometime in the war)').display, 'sometime in the war');
eq('calendar escape', D('@#DGREGORIAN@ 12 JAN 1898').year, 1898);
eq('empty', D('').display, '');

// Non-conforming forms still have to be readable — the tree needs the year.
eq('full month name', D('January 1906').year, 1906);
eq('  → not conforming', D('January 1906').conforming, false);
eq('  → tidied display', D('January 1906').display, 'Jan 1906');
eq('lower-case month', D('Apr 2000').year, 2000);
eq('  → not strictly conforming', D('Apr 2000').conforming, false);
eq('d/m/y', D('29/12/1903').display, '29 Dec 1903');
eq('  → year', D('29/12/1903').year, 1903);
eq('m/d/y fallback', D('12/29/1903').display, '29 Dec 1903');
eq('hyphen range', D('1914-1920').year, 1914);
eq('  → end', D('1914-1920').endYear, 1920);
eq('ISO', D('1898-01-12').year, 1898);
eq('Abt. with stop', D('Abt. 1780').year, 1780);
eq('bare month', D('DEC').year, null);
eq('unreadable keeps text', D('St Pauls, Hemel Hempstead').display, 'St Pauls, Hemel Hempstead');
eq('  → nothing parsed', D('St Pauls, Hemel Hempstead').parsed, false);

// ── Tokenizer ───────────────────────────────────────────────────────────────
section('Tokenizing');
eq('CRLF', tokenizeGedcom('0 HEAD\r\n1 CHAR UTF-8\r\n0 TRLR\r\n').lines.length, 3);
eq('LF', tokenizeGedcom('0 HEAD\n1 CHAR UTF-8\n0 TRLR\n').lines.length, 3);
eq('lone CR', tokenizeGedcom('0 HEAD\r1 CHAR UTF-8\r0 TRLR\r').lines.length, 3);
eq('BOM stripped', tokenizeGedcom('﻿0 HEAD\n0 TRLR\n').lines[0].tag, 'HEAD');
eq('xref captured', tokenizeGedcom('0 @I1@ INDI\n').lines[0].xref, '@I1@');
eq('value with spaces', tokenizeGedcom('1 NAME John /Smith/ Jr\n').lines[0].value, 'John /Smith/ Jr');
eq('empty value', tokenizeGedcom('1 BIRT\n').lines[0].value, '');
eq('bad line reported', tokenizeGedcom('0 HEAD\nnot a gedcom line\n').problems.length, 1);
eq('  → good line still read', tokenizeGedcom('0 HEAD\nnot a gedcom line\n').lines.length, 1);

// ── The clean fixture ───────────────────────────────────────────────────────
section('A conforming file');
const clean = parseGedcom(fixture('clean.ged'));
const cleanReport = validateGedcom(clean);
eq('individuals', clean.individuals.size, 5);
eq('families', clean.families.size, 2);
eq('no syntax problems', clean.syntaxProblems.length, 0);
eq('no link repairs needed', clean.repairs.length, 0);
check('no specification errors', cleanReport.errors === 0,
  cleanReport.findings.filter((f) => f.severity === 'error').map((f) => f.title));
check('no warnings', cleanReport.warnings === 0,
  cleanReport.findings.filter((f) => f.severity === 'warning').map((f) => f.title));

const alfred = clean.individuals.get('@I1@');
eq('name parsed', alfred.name.full, 'Alfred James Wren');
eq('  → given', alfred.name.given, 'Alfred James');
eq('  → surname', alfred.name.surname, 'Wren');
eq('lifespan', alfred.lifespan, '1898–1971');
eq('birth place', alfred.birth.place, 'Watford, Hertfordshire, England');
eq('attribute kept separate', alfred.attributes.length, 1);
eq('  → occupation value', alfred.attributes[0].value, 'Signalman');
eq('spouse resolved', alfred.spouseRefs[0].name.full, 'Edith Bramley');
eq('child resolved', alfred.childrenRefs[0].name.full, 'Margaret Wren');
eq('grandchild through marriage', clean.individuals.get('@I5@').parents.length, 2);
eq('approximate lifespan marked', clean.individuals.get('@I2@').lifespan, 'c.1900–c.1975');
eq('marriage year', clean.families.get('@F1@').marriageYear, 1923);

// ── The quirks fixture ──────────────────────────────────────────────────────
section('A file full of the things exporters actually do');
const q = parseGedcom(fixture('quirks.ged'));
const qr = validateGedcom(q);
const rule = (id) => qr.findings.find((f) => f.id === id);
const has = (id) => !!rule(id);
const count = (id) => (rule(id) ? rule(id).count : 0);

eq('individuals', q.individuals.size, 13);
eq('families', q.families.size, 5);
eq('multimedia', q.objects.size, 2);

console.log('  rules fired: ' + qr.findings.map((f) => f.id + '×' + f.count).join(', '));

check('CONC/CONT folded into one note',
  q.individuals.get('@I1@').notes[0].text ===
  'This note is split across a CONC line,\nand continues on a CONT line.',
  q.individuals.get('@I1@').notes[0].text);

check('MARR under INDI flagged', has('tag.misplaced.INDI.MARR'));
check('  → still shown on the person', q.individuals.get('@I1@').events.some((e) => e.tag === 'MARR' && e.misplaced));
check('ADDR under INDI flagged', has('tag.misplaced.INDI.ADDR'));
check('DATE under OBJE flagged', has('tag.misplaced.OBJE.DATE'));
check('PLAC under OBJE flagged', has('tag.misplaced.OBJE.PLAC'));
eq('dangling pointer found', count('pointer.dangling'), 1);
check('one-sided HUSB/WIFE found', has('link.oneSided.missingFams'));
check('one-sided FAMS found', has('link.oneSided.missingSpouse'));
eq('empty FILE found', count('obje.emptyFile'), 1);
eq('FILE without FORM found', count('obje.noForm'), 1);
check('hyphen date range flagged', has('date.range'));
check('numeric date flagged', has('date.slashes'));
check('full month name flagged', has('date.fullMonth'));
check('"Abt." flagged', has('date.approxWord'));
check('unreadable date flagged', has('date.unreadable'));
check('padded value flagged', has('syntax.padding'));
check('over-long line flagged', has('syntax.lineLength'));
check('empty OCCU flagged', has('occu.empty'));
check('missing HEAD.FILE noted', has('head.file'));
check('custom tags noted', has('tag.custom'));
check('custom level-0 record noted', has('record.custom'));
check('unreferenced source noted', has('record.unreferenced'));
check('no SEX noted', has('indi.noSex'));
check('two NAMEs noted', has('name.multiple'));
check('child of two families noted', has('indi.multiFamc'));
check('death before birth flagged', has('plaus.deathBeforeBirth'));
check('young parent flagged', has('plaus.youngParent'));
check('every finding has an explanation', qr.findings.every((f) => f.detail && f.detail.length > 30));
check('every finding has a sample', qr.findings.every((f) => f.samples.length > 0));
check('errors are reported', qr.errors > 0, qr.errors);

// Broken data must not stop the file being read.
eq('remarriage keeps both families', q.individuals.get('@I1@').spouseFamilies.length, 2);
eq('  → two spouses', q.individuals.get('@I1@').spouseRefs.length, 2);
eq('step relationship kept', q.families.get('@F3@').childRelations['@I4@'], 'step');
eq('divorce found', q.families.get('@F4@').divorce.tag, 'DIV');
eq('dangling spouse recorded on the family', q.families.get('@F5@').danglingSpouses.length, 1);

// ── Layout ──────────────────────────────────────────────────────────────────
section('Layout');
for (const [label, g] of [['clean', clean], ['quirks', q]]) {
  const lay = layoutGraph(g.individuals, g.families);
  eq(label + ': every individual placed', lay.nodes.length, g.individuals.size);
  eq(label + ': nobody placed twice', new Set(lay.nodes.map((n) => n.id)).size, lay.nodes.length);
  eq(label + ': every family drawn', lay.familyNodes.length, g.families.size);
  check(label + ': bounds are finite', Number.isFinite(lay.bounds.width) && Number.isFinite(lay.bounds.height));

  const rows = new Map();
  for (const n of lay.nodes) {
    if (!rows.has(n.gen)) rows.set(n.gen, []);
    rows.get(n.gen).push(n);
  }
  let overlaps = 0;
  for (const row of rows.values()) {
    row.sort((a, b) => a.x - b.x);
    for (let i = 1; i < row.length; i++) if (row[i].x < row[i - 1].x + row[i - 1].w - 0.01) overlaps++;
  }
  eq(label + ': no overlapping cards', overlaps, 0);

  let wrongWayUp = 0;
  for (const f of g.families.values()) {
    for (const s of f.spouses) {
      for (const c of f.childRefs) {
        const sn = lay.nodeById.get(s.id), cn = lay.nodeById.get(c.id);
        if (sn && cn && cn.y <= sn.y) wrongWayUp++;
      }
    }
  }
  eq(label + ': children sit below their parents', wrongWayUp, 0);

  let notLevel = 0;
  for (const f of g.families.values()) {
    if (f.spouses.length === 2) {
      const [a, b] = f.spouses.map((s) => lay.nodeById.get(s.id));
      if (a && b && a.y !== b.y) notLevel++;
    }
  }
  eq(label + ': couples share a row', notLevel, 0);
}

const quirkLayout = layoutGraph(q.individuals, q.families);
eq('unconnected branches are separated', quirkLayout.components, 2);
check('remarried person sits between both spouses', (() => {
  const w = quirkLayout.nodeById.get('@I1@');
  const a = quirkLayout.nodeById.get('@I2@');
  const b = quirkLayout.nodeById.get('@I3@');
  return (a.x < w.x && w.x < b.x) || (b.x < w.x && w.x < a.x);
})());

section('Sibling groups stay together');
// Two unrelated sibling groups (Alice/Bob/Carol and Dave/Eve/Frank), joined
// into one component only through a grandchild-generation marriage — so
// nobody at generation 1 is married across the two families. If the
// generation-1 walk ever degrades to visiting clusters in raw birth-year
// order (the failure mode of a broken parent→child recursion), interleaving
// by birth year would put Dave (1802) and Eve (1807) between Alice (1800)
// and Bob (1805)/Carol (1810). A working walk keeps each family's row
// contiguous regardless of birth-year interleaving between families.
const sibs = parseGedcom([
  '0 HEAD', '1 SOUR X', '1 GEDC', '2 VERS 5.5.1', '2 FORM LINEAGE-LINKED', '1 CHAR UTF-8',
  '0 @PA1@ INDI', '1 NAME PA1 /A/', '1 SEX M', '1 FAMS @FA@',
  '0 @PA2@ INDI', '1 NAME PA2 /A/', '1 SEX F', '1 FAMS @FA@',
  '0 @Alice@ INDI', '1 NAME Alice /A/', '1 SEX F', '1 BIRT', '2 DATE 1800', '1 FAMC @FA@',
  '0 @Bob@ INDI', '1 NAME Bob /A/', '1 SEX M', '1 BIRT', '2 DATE 1805', '1 FAMC @FA@', '1 FAMS @FBob@',
  '0 @Carol@ INDI', '1 NAME Carol /A/', '1 SEX F', '1 BIRT', '2 DATE 1810', '1 FAMC @FA@',
  '0 @PB1@ INDI', '1 NAME PB1 /B/', '1 SEX M', '1 FAMS @FB@',
  '0 @PB2@ INDI', '1 NAME PB2 /B/', '1 SEX F', '1 FAMS @FB@',
  '0 @Dave@ INDI', '1 NAME Dave /B/', '1 SEX M', '1 BIRT', '2 DATE 1802', '1 FAMC @FB@',
  '0 @Eve@ INDI', '1 NAME Eve /B/', '1 SEX F', '1 BIRT', '2 DATE 1807', '1 FAMC @FB@', '1 FAMS @FEve@',
  '0 @Frank@ INDI', '1 NAME Frank /B/', '1 SEX M', '1 BIRT', '2 DATE 1812', '1 FAMC @FB@',
  '0 @BobSpouse@ INDI', '1 NAME Bob /Spouse/', '1 SEX F', '1 FAMS @FBob@',
  '0 @BobChild@ INDI', '1 NAME Bob /Child/', '1 SEX M', '1 FAMC @FBob@', '1 FAMS @FCousins@',
  '0 @EveSpouse@ INDI', '1 NAME Eve /Spouse/', '1 SEX M', '1 FAMS @FEve@',
  '0 @EveChild@ INDI', '1 NAME Eve /Child/', '1 SEX F', '1 FAMC @FEve@', '1 FAMS @FCousins@',
  '0 @FA@ FAM', '1 HUSB @PA1@', '1 WIFE @PA2@', '1 CHIL @Alice@', '1 CHIL @Bob@', '1 CHIL @Carol@',
  '0 @FB@ FAM', '1 HUSB @PB1@', '1 WIFE @PB2@', '1 CHIL @Dave@', '1 CHIL @Eve@', '1 CHIL @Frank@',
  '0 @FBob@ FAM', '1 HUSB @Bob@', '1 WIFE @BobSpouse@', '1 CHIL @BobChild@',
  '0 @FEve@ FAM', '1 HUSB @EveSpouse@', '1 WIFE @Eve@', '1 CHIL @EveChild@',
  '0 @FCousins@ FAM', '1 HUSB @BobChild@', '1 WIFE @EveChild@',
  '0 TRLR',
].join('\n'));
const sibLay = layoutGraph(sibs.individuals, sibs.families);
eq('joined into one component via the cousin marriage', sibLay.components, 1);
const spanOf = (...ids) => {
  const xs = ids.map((id) => sibLay.nodeById.get(id).x);
  return { min: Math.min(...xs), max: Math.max(...xs) };
};
const familyASpan = spanOf('@Alice@', '@Bob@', '@Carol@');
const familyBSpan = spanOf('@Dave@', '@Eve@', '@Frank@');
const inSpan = (id, span) => { const x = sibLay.nodeById.get(id).x; return x >= span.min && x <= span.max; };
check('family A siblings occupy a contiguous block', !inSpan('@Dave@', familyASpan) && !inSpan('@Eve@', familyASpan) && !inSpan('@Frank@', familyASpan));
check('family B siblings occupy a contiguous block', !inSpan('@Alice@', familyBSpan) && !inSpan('@Bob@', familyBSpan) && !inSpan('@Carol@', familyBSpan));
check("Bob's spouse sits inside family A's block (expected, not an interloper)", inSpan('@BobSpouse@', familyASpan));
check("Eve's spouse sits inside family B's block (expected, not an interloper)", inSpan('@EveSpouse@', familyBSpan));

section('Focused subsets');
const sub = relatedSubset(q.individuals, '@I4@', 1, 1);
check('subset holds the person', sub.has('@I4@'));
check('  → their parents', sub.has('@I1@') && sub.has('@I2@'));
check('  → their children', sub.has('@I8@'));
check('  → their spouse', sub.has('@I7@'));
check('  → not the unrelated branch', !sub.has('@I11@'));
const subLay = layoutGraph(sub, q.families);
eq('subset lays out', subLay.nodes.length, sub.size);

section('Edge cases');
const empty = parseGedcom('0 HEAD\n1 GEDC\n2 VERS 5.5.1\n2 FORM LINEAGE-LINKED\n1 CHAR UTF-8\n1 SOUR X\n0 TRLR\n');
eq('empty file parses', empty.individuals.size, 0);
eq('  → lays out without throwing', layoutGraph(empty.individuals, empty.families).nodes.length, 0);
const lone = parseGedcom('0 HEAD\n1 SOUR X\n1 GEDC\n2 VERS 5.5.1\n2 FORM LINEAGE-LINKED\n1 CHAR UTF-8\n0 @I1@ INDI\n1 NAME A /B/\n0 TRLR\n');
eq('single individual lays out', layoutGraph(lone.individuals, lone.families).nodes.length, 1);
const dup = validateGedcom(parseGedcom('0 HEAD\n1 SOUR X\n1 GEDC\n2 VERS 5.5.1\n2 FORM LINEAGE-LINKED\n1 CHAR UTF-8\n0 @I1@ INDI\n0 @I1@ INDI\n0 TRLR\n'));
check('duplicate xref flagged', dup.findings.some((f) => f.id === 'xref.duplicate'));
const noTrlr = validateGedcom(parseGedcom('0 HEAD\n1 SOUR X\n1 GEDC\n2 VERS 5.5.1\n2 FORM LINEAGE-LINKED\n1 CHAR UTF-8\n'));
check('missing TRLR flagged', noTrlr.findings.some((f) => f.id === 'trlr.missing'));
const badLevel = validateGedcom(parseGedcom('0 HEAD\n1 SOUR X\n1 GEDC\n2 VERS 5.5.1\n2 FORM LINEAGE-LINKED\n1 CHAR UTF-8\n0 @I1@ INDI\n3 NAME A /B/\n0 TRLR\n'));
check('level jump flagged', badLevel.findings.some((f) => f.id === 'syntax.levelJump'));

// A marriage loop must not hang the generation solver.
const loop = parseGedcom([
  '0 HEAD', '1 SOUR X', '1 GEDC', '2 VERS 5.5.1', '2 FORM LINEAGE-LINKED', '1 CHAR UTF-8',
  '0 @I1@ INDI', '1 NAME A /X/', '1 SEX M', '1 FAMS @F1@',
  '0 @I2@ INDI', '1 NAME B /X/', '1 SEX F', '1 FAMC @F1@', '1 FAMS @F2@',
  '0 @I3@ INDI', '1 NAME C /X/', '1 SEX M', '1 FAMC @F2@', '1 FAMS @F3@',
  '0 @I4@ INDI', '1 NAME D /X/', '1 SEX F', '1 FAMC @F1@', '1 FAMS @F3@',
  '0 @F1@ FAM', '1 HUSB @I1@', '1 CHIL @I2@', '1 CHIL @I4@',
  '0 @F2@ FAM', '1 WIFE @I2@', '1 CHIL @I3@',
  '0 @F3@ FAM', '1 HUSB @I3@', '1 WIFE @I4@',
  '0 TRLR',
].join('\n'));
const loopLay = layoutGraph(loop.individuals, loop.families);
eq('uncle-niece marriage still places everyone', loopLay.nodes.length, 4);
check('  → the couple is still level',
  loopLay.nodeById.get('@I3@').y === loopLay.nodeById.get('@I4@').y);

// ── Result ──────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(60));
if (failures.length) {
  console.log(pass + ' passed, ' + failures.length + ' FAILED:');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('ALL PASS — ' + pass + ' assertions');
