// GEDCOM 5.5.1 lineage-linked parser. No DOM, no dependencies — the browser
// page and the Node test suite both import this.
//
// Three stages, each usable on its own:
//   tokenizeGedcom(text)  -> flat lines with level/xref/tag/value + syntax problems
//   buildRecords(lines)   -> a record tree, with CONC/CONT folded into values
//   buildModel(records)   -> individuals/families with events, names and links
// parseGedcom(text) runs all three.

// ---- Tags -------------------------------------------------------------------

// INDIVIDUAL_EVENT_STRUCTURE + INDIVIDUAL_ATTRIBUTE_STRUCTURE (5.5.1 p.32-34).
const INDI_EVENT_TAGS = {
  BIRT: 'Born', CHR: 'Christened', DEAT: 'Died', BURI: 'Buried', CREM: 'Cremated',
  ADOP: 'Adopted', BAPM: 'Baptised', BARM: 'Bar mitzvah', BASM: 'Bas mitzvah',
  BLES: 'Blessing', CHRA: 'Adult christening', CONF: 'Confirmed', FCOM: 'First communion',
  ORDN: 'Ordained', NATU: 'Naturalised', EMIG: 'Emigrated', IMMI: 'Immigrated',
  CENS: 'Census', PROB: 'Probate', WILL: 'Will', GRAD: 'Graduated', RETI: 'Retired',
  EVEN: 'Event',
};
const INDI_ATTR_TAGS = {
  CAST: 'Caste', DSCR: 'Description', EDUC: 'Education', IDNO: 'ID number',
  NATI: 'Nationality', NCHI: 'Children', NMR: 'Marriages', OCCU: 'Occupation',
  PROP: 'Property', RELI: 'Religion', RESI: 'Residence', SSN: 'Social security number',
  TITL: 'Title', FACT: 'Fact',
};
// FAMILY_EVENT_STRUCTURE (5.5.1 p.31).
const FAM_EVENT_TAGS = {
  ANUL: 'Annulled', CENS: 'Census', DIV: 'Divorced', DIVF: 'Divorce filed',
  ENGA: 'Engaged', MARR: 'Married', MARB: 'Marriage banns', MARC: 'Marriage contract',
  MARL: 'Marriage licence', MARS: 'Marriage settlement', RESI: 'Residence', EVEN: 'Event',
};
// Vendor extensions seen in the wild that carry a date/place worth showing.
const EXT_EVENT_TAGS = {
  _MILT: 'Military service', _EMPLOY: 'Employment', _DEG: 'Degree', _ELEC: 'Election',
  _EXCM: 'Excommunicated', _FUN: 'Funeral', _MDCL: 'Medical', _MILTID: 'Military ID',
  _NAMS: 'Namesake', _WEIG: 'Weight', _HEIG: 'Height',
};

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MONTH_FULL = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY',
  'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---- Stage 1: tokenize ------------------------------------------------------

// A GEDCOM line is `level [xref] tag [value]`, delimiter is one space. Real
// files pad and indent, so the split is lenient; anything that still cannot be
// read is reported rather than silently dropped.
const LINE_RE = /^(\d+)(?:[ \t]+(@[^@\s]*@))?[ \t]+([A-Za-z0-9_]+)(?:[ \t](.*))?$/;

function tokenizeGedcom(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip UTF-8 BOM
  // Split on CRLF, LF or a lone CR (old Mac exports).
  const raw = text.split(/\r\n|\n|\r/);
  const lines = [];
  const problems = [];
  let blank = 0;

  for (let i = 0; i < raw.length; i++) {
    const s = raw[i];
    if (s.trim() === '') { if (i < raw.length - 1 && s !== '') blank++; continue; }
    const m = LINE_RE.exec(s.replace(/^[ \t]+/, ''));
    if (!m) {
      problems.push({ line: i + 1, text: s.slice(0, 120) });
      continue;
    }
    lines.push({
      no: i + 1,
      level: parseInt(m[1], 10),
      xref: m[2] || null,
      tag: m[3].toUpperCase(),
      value: m[4] === undefined ? '' : m[4],
      length: s.length,
    });
  }
  return { lines, problems, blankLines: blank };
}

// ---- Stage 2: records -------------------------------------------------------

// `@@` is the escape for a literal `@` in a value (5.5.1 p.11).
const unescapeAt = (s) => s.replace(/@@/g, '@');
const isPointer = (s) => /^@[^@\s]+@$/.test(s.trim());

// Folds CONC (join) and CONT (newline) continuation lines into their parent's
// value, which is what makes long notes and source text survive the parse.
function buildRecords(lines) {
  const records = [];
  const stack = [];
  const problems = [];

  for (const l of lines) {
    if (l.level === 0) {
      const node = { tag: l.tag, xref: l.xref, value: unescapeAt(l.value), children: [], line: l.no };
      records.push(node);
      stack.length = 0;
      stack[0] = node;
      continue;
    }
    const parent = stack[l.level - 1];
    if (!parent) {
      problems.push({ line: l.no, tag: l.tag, level: l.level, kind: 'orphan' });
      continue;
    }
    if (l.tag === 'CONC' || l.tag === 'CONT') {
      parent.value += (l.tag === 'CONT' ? '\n' : '') + unescapeAt(l.value);
      // Keep the level stack sane if something nests under a continuation.
      stack[l.level] = parent;
      continue;
    }
    const node = { tag: l.tag, xref: l.xref, value: unescapeAt(l.value), children: [], line: l.no };
    parent.children.push(node);
    stack.length = l.level + 1;
    stack[l.level] = node;
  }
  return { records, problems };
}

const kids = (node, tag) => (node ? node.children.filter((c) => c.tag === tag) : []);
const kid = (node, tag) => kids(node, tag)[0] || null;
const kidValue = (node, tag) => { const c = kid(node, tag); return c ? c.value : ''; };

// ---- Dates ------------------------------------------------------------------

// A GEDCOM DATE_VALUE, plus the near-misses genealogy programs actually emit
// (full month names, dd/mm/yyyy, "1914-1920", "Abt."). `conforming` records
// whether the original was strict 5.5.1 — the validator reports on it, the
// viewer just uses whatever could be read.
const DATE_MODIFIERS = [
  [/^(?:ABT|ABOUT|ABT\.|CIRCA|CA\.?|C\.)\s+/i, 'about', 'abt.'],
  [/^(?:EST|ESTIMATED)\s+/i, 'estimated', 'est.'],
  [/^(?:CAL|CALCULATED)\s+/i, 'calculated', 'calc.'],
  [/^(?:BEF|BEFORE)\s+/i, 'before', 'before'],
  [/^(?:AFT|AFTER)\s+/i, 'after', 'after'],
];

function parseDatePart(s) {
  if (!s) return null;
  let t = s.trim().replace(/^@#D[A-Z0-9 ]*@\s*/i, ''); // drop calendar escape
  let m;

  // 12 JAN 1898 / 12 January 1898
  if ((m = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{3,4})(\/\d{1,2})?$/.exec(t))) {
    const mo = monthIndex(m[2]);
    if (mo >= 0) return { day: +m[1], month: mo, year: +m[3], dual: m[4] || '' };
  }
  // JAN 1898 / January 1898
  if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{3,4})(\/\d{1,2})?$/.exec(t))) {
    const mo = monthIndex(m[1]);
    if (mo >= 0) return { day: null, month: mo, year: +m[2], dual: m[3] || '' };
  }
  // 1898 / 1898/99
  if ((m = /^(\d{3,4})(\/\d{1,2})?$/.exec(t))) return { day: null, month: null, year: +m[1], dual: m[2] || '' };
  // 1898-01-12 (ISO) — not GEDCOM, but unambiguous
  if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t))) return { day: +m[3], month: +m[2] - 1, year: +m[1], dual: '' };
  // 29/12/1903 — day-first; treat 13+ in the first slot as the day either way
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t))) {
    let d = +m[1], mo = +m[2];
    if (mo > 12 && d <= 12) { const t2 = d; d = mo; mo = t2; }
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return { day: d, month: mo - 1, year: +m[3], dual: '' };
  }
  // JAN / January on its own
  if ((m = /^([A-Za-z]{3,9})\.?$/.exec(t))) {
    const mo = monthIndex(m[1]);
    if (mo >= 0) return { day: null, month: mo, year: null, dual: '' };
  }
  return null;
}

function monthIndex(name) {
  const u = name.toUpperCase();
  let i = MONTHS.indexOf(u);
  if (i >= 0) return i;
  i = MONTH_FULL.indexOf(u);
  if (i >= 0) return i;
  return -1;
}

function showPart(p) {
  if (!p) return '';
  const y = p.year === null ? '' : String(p.year) + p.dual;
  if (p.month === null) return y;
  const mo = MONTH_NAMES[p.month];
  if (p.day === null) return (mo + ' ' + y).trim();
  return (p.day + ' ' + mo + ' ' + y).trim();
}

// Strict 5.5.1 DATE_VALUE, used only to judge conformance.
const STRICT_MON = MONTHS.join('|');
const STRICT_DATE = String.raw`(?:@#D[A-Z ]+@ )?(?:\d{1,2} )?(?:(?:${STRICT_MON}) )?\d{3,4}(?:\/\d{2})?`;
const STRICT_DATE_VALUE = new RegExp(
  `^(?:${STRICT_DATE}|ABT ${STRICT_DATE}|CAL ${STRICT_DATE}|EST ${STRICT_DATE}` +
  `|AFT ${STRICT_DATE}|BEF ${STRICT_DATE}|BET ${STRICT_DATE} AND ${STRICT_DATE}` +
  `|FROM ${STRICT_DATE}|TO ${STRICT_DATE}|FROM ${STRICT_DATE} TO ${STRICT_DATE}` +
  `|INT ${STRICT_DATE}(?: \\(.*\\))?|\\(.*\\))$`
);

function parseGedcomDate(raw) {
  const out = {
    raw: raw || '', display: '', year: null, sortKey: null,
    qualifier: '', conforming: false, parsed: false, phrase: '',
  };
  if (!raw || !raw.trim()) return out;
  const s = raw.trim();
  out.conforming = STRICT_DATE_VALUE.test(s);

  let m;
  // Interpreted / free-text phrase
  if ((m = /^INT\s+(.*?)\s*(\(.*\))?$/i.exec(s))) {
    const p = parseDatePart(m[1]);
    if (p) { finish(out, p, p, 'interpreted'); out.phrase = m[2] || ''; return out; }
  }
  if (/^\(.*\)$/.test(s)) { out.display = s.replace(/^\(|\)$/g, ''); out.phrase = s; return out; }

  // Ranges and periods
  if ((m = /^BET(?:WEEN)?\s+(.+?)\s+AND\s+(.+)$/i.exec(s))) return range(out, m[1], m[2], 'between', '–');
  if ((m = /^FROM\s+(.+?)\s+TO\s+(.+)$/i.exec(s))) return range(out, m[1], m[2], 'from-to', '–');
  if ((m = /^FROM\s+(.+)$/i.exec(s))) return single(out, m[1], 'from', 'from ');
  if ((m = /^TO\s+(.+)$/i.exec(s))) return single(out, m[1], 'to', 'to ');
  // "1914-1920" / "2003-2005" — a period written the way people write periods
  if ((m = /^(\d{4})\s*[-–]\s*(\d{4})$/.exec(s))) return range(out, m[1], m[2], 'from-to', '–');

  for (const [re, name, prefix] of DATE_MODIFIERS) {
    if (re.test(s)) return single(out, s.replace(re, ''), name, prefix + ' ');
  }
  return single(out, s, '', '');
}

function single(out, part, qualifier, prefix) {
  const p = parseDatePart(part);
  out.qualifier = qualifier;
  if (!p) { out.display = part.trim(); return out; }
  finish(out, p, p, qualifier);
  out.display = (prefix + showPart(p)).trim();
  return out;
}

function range(out, a, b, qualifier, sep) {
  const pa = parseDatePart(a), pb = parseDatePart(b);
  out.qualifier = qualifier;
  if (!pa && !pb) { out.display = (a + ' ' + sep + ' ' + b).trim(); return out; }
  finish(out, pa || pb, pb || pa, qualifier);
  out.display = (qualifier === 'between' ? 'between ' : '') +
    showPart(pa) + sep + showPart(pb);
  return out;
}

function finish(out, start, end) {
  out.parsed = true;
  const p = start || end;
  out.year = p.year;
  out.sortKey = p.year === null ? null
    : p.year * 10000 + (p.month === null ? 0 : (p.month + 1) * 100) + (p.day || 0);
  if (!out.display) out.display = showPart(p);
  out.endYear = end ? end.year : p.year;
}

// ---- Names ------------------------------------------------------------------

// PERSONAL_NAME_STRUCTURE: "Given /Surname/ Suffix", with optional GIVN/SURN/
// NPFX/NSFX/NICK/SPFX subordinates that win when the slash form is absent.
function parseName(node) {
  const raw = (node.value || '').replace(/\s+/g, ' ').trim();
  const n = {
    raw, given: '', surname: '', prefix: '', suffix: '', nickname: '',
    type: kidValue(node, 'TYPE'), full: '', hasSlashes: /\/[^/]*\//.test(raw),
  };
  const m = /^(.*?)\s*\/([^/]*)\/\s*(.*)$/.exec(raw);
  if (m) {
    n.given = m[1].trim();
    n.surname = m[2].trim();
    n.suffix = m[3].trim();
  } else {
    n.given = raw;
  }
  n.given = kidValue(node, 'GIVN') || n.given;
  n.surname = kidValue(node, 'SURN') || n.surname;
  n.prefix = kidValue(node, 'NPFX') || n.prefix;
  n.suffix = kidValue(node, 'NSFX') || n.suffix;
  n.nickname = kidValue(node, 'NICK') || n.nickname;
  const spfx = kidValue(node, 'SPFX');
  if (spfx && !n.surname.startsWith(spfx)) n.surname = (spfx + ' ' + n.surname).trim();

  n.full = [n.prefix, n.given, n.surname, n.suffix].filter(Boolean).join(' ').trim();
  if (!n.full) n.full = '(unknown)';
  return n;
}

// ---- Events -----------------------------------------------------------------

function parseEvent(node, label) {
  const dateNode = kid(node, 'DATE');
  const place = kidValue(node, 'PLAC').trim().replace(/\s*,\s*$/, '');
  const ev = {
    tag: node.tag,
    label: kidValue(node, 'TYPE') || label,
    // A bare `1 DEAT Y` asserts the event happened without saying when.
    asserted: node.value.trim().toUpperCase() === 'Y',
    value: node.value.trim(),
    date: parseGedcomDate(dateNode ? dateNode.value : ''),
    place,
    age: kidValue(node, 'AGE'),
    cause: kidValue(node, 'CAUS'),
    agency: kidValue(node, 'AGNC'),
    notes: collectNotes(node),
    sourceRefs: kids(node, 'SOUR').map((s) => ({
      ref: isPointer(s.value) ? s.value.trim() : null,
      page: kidValue(s, 'PAGE'),
      text: (kid(kid(s, 'DATA'), 'TEXT') || {}).value || '',
      url: kidValue(kid(s, 'DATA'), 'WWW'),
    })),
    objectRefs: kids(node, 'OBJE').filter((o) => isPointer(o.value)).map((o) => o.value.trim()),
    line: node.line,
  };
  ev.hasContent = !!(ev.date.raw || ev.place || ev.asserted || ev.notes.length ||
    ev.value || ev.age || ev.cause);
  return ev;
}

function collectNotes(node) {
  return kids(node, 'NOTE')
    .map((n) => (isPointer(n.value) ? { ref: n.value.trim(), text: '' } : { ref: null, text: n.value }))
    .filter((n) => n.ref || n.text.trim());
}

// ---- Stage 3: model ---------------------------------------------------------

function buildModel(records) {
  const individuals = new Map();
  const families = new Map();
  const sources = new Map();
  const objects = new Map();
  const notes = new Map();
  const repositories = new Map();
  const submitters = new Map();
  const other = [];
  let header = null;
  let anonymous = 0;

  for (const rec of records) {
    switch (rec.tag) {
      case 'HEAD': header = parseHeader(rec); break;
      case 'TRLR': break;
      case 'INDI': {
        const id = rec.xref || '@_INDI' + (++anonymous) + '@';
        individuals.set(id, parseIndividual(rec, id));
        break;
      }
      case 'FAM': {
        const id = rec.xref || '@_FAM' + (++anonymous) + '@';
        families.set(id, parseFamily(rec, id));
        break;
      }
      case 'SOUR':
        if (rec.xref) sources.set(rec.xref, {
          id: rec.xref, title: kidValue(rec, 'TITL'), author: kidValue(rec, 'AUTH'),
          publication: kidValue(rec, 'PUBL'), repo: kidValue(rec, 'REPO'),
          text: kidValue(rec, 'TEXT'), notes: collectNotes(rec), line: rec.line,
        });
        break;
      case 'OBJE':
        if (rec.xref) {
          const file = kid(rec, 'FILE');
          objects.set(rec.xref, {
            id: rec.xref,
            file: file ? file.value.trim() : '',
            format: file ? kidValue(file, 'FORM') : kidValue(rec, 'FORM'),
            title: (file ? kidValue(file, 'TITL') : '') || kidValue(rec, 'TITL'),
            description: kidValue(rec, '_DSCR'),
            date: parseGedcomDate(kidValue(rec, 'DATE')),
            place: kidValue(rec, 'PLAC'),
            line: rec.line,
          });
        }
        break;
      case 'NOTE': if (rec.xref) notes.set(rec.xref, { id: rec.xref, text: rec.value, line: rec.line }); break;
      case 'REPO': if (rec.xref) repositories.set(rec.xref, { id: rec.xref, name: kidValue(rec, 'NAME'), line: rec.line }); break;
      case 'SUBM': if (rec.xref) submitters.set(rec.xref, { id: rec.xref, name: kidValue(rec, 'NAME'), line: rec.line }); break;
      default: other.push({ tag: rec.tag, xref: rec.xref, line: rec.line });
    }
  }

  const repairs = linkModel(individuals, families);
  return { header, individuals, families, sources, objects, notes, repositories, submitters, other, repairs };
}

function parseHeader(rec) {
  const sour = kid(rec, 'SOUR');
  const gedc = kid(rec, 'GEDC');
  return {
    source: sour ? sour.value : '',
    sourceName: sour ? kidValue(sour, 'NAME') : '',
    sourceVersion: sour ? kidValue(sour, 'VERS') : '',
    tree: sour ? kidValue(sour, '_TREE') : '',
    date: kidValue(rec, 'DATE'),
    version: gedc ? kidValue(gedc, 'VERS') : '',
    form: gedc ? kidValue(gedc, 'FORM') : '',
    charset: kidValue(rec, 'CHAR'),
    file: kidValue(rec, 'FILE'),
    submitter: kidValue(rec, 'SUBM'),
    language: kidValue(rec, 'LANG'),
  };
}

function parseIndividual(rec, id) {
  const p = {
    id, kind: 'INDI', line: rec.line,
    names: kids(rec, 'NAME').map(parseName),
    sex: (kidValue(rec, 'SEX').trim().charAt(0).toUpperCase() || 'U'),
    events: [], attributes: [],
    famc: kids(rec, 'FAMC').filter((n) => isPointer(n.value)).map((n) => n.value.trim()),
    fams: kids(rec, 'FAMS').filter((n) => isPointer(n.value)).map((n) => n.value.trim()),
    notes: collectNotes(rec),
    sourceRefs: kids(rec, 'SOUR').filter((s) => isPointer(s.value)).map((s) => s.value.trim()),
    objectRefs: kids(rec, 'OBJE').filter((o) => isPointer(o.value)).map((o) => o.value.trim()),
    changed: kidValue(kid(rec, 'CHAN'), 'DATE'),
    // Filled in by linkModel
    parentFamilies: [], spouseFamilies: [],
  };
  if (p.sex !== 'M' && p.sex !== 'F') p.sex = 'U';

  for (const c of rec.children) {
    if (INDI_EVENT_TAGS[c.tag]) p.events.push(parseEvent(c, INDI_EVENT_TAGS[c.tag]));
    else if (INDI_ATTR_TAGS[c.tag]) p.attributes.push(parseEvent(c, INDI_ATTR_TAGS[c.tag]));
    else if (EXT_EVENT_TAGS[c.tag]) p.events.push(parseEvent(c, EXT_EVENT_TAGS[c.tag]));
    // MARR under INDI is not 5.5.1, but Ancestry emits it; keep it visible.
    else if (FAM_EVENT_TAGS[c.tag] && !INDI_EVENT_TAGS[c.tag]) {
      const ev = parseEvent(c, FAM_EVENT_TAGS[c.tag]);
      ev.misplaced = true;
      p.events.push(ev);
    }
  }

  p.name = p.names[0] || { full: '(unknown)', given: '', surname: '', suffix: '', prefix: '', nickname: '' };
  p.birth = firstEvent(p.events, ['BIRT', 'CHR', 'BAPM']);
  p.death = firstEvent(p.events, ['DEAT', 'BURI', 'CREM', 'PROB']);
  p.birthYear = p.birth ? p.birth.date.year : null;
  p.deathYear = p.death ? p.death.date.year : null;
  p.lifespan = lifespan(p);
  return p;
}

function firstEvent(events, tags) {
  for (const t of tags) {
    const e = events.find((x) => x.tag === t && (x.date.year !== null || x.place || x.asserted));
    if (e) return e;
  }
  return null;
}

function lifespan(p) {
  const b = p.birthYear, d = p.deathYear;
  const approx = (ev) => (ev && /^(about|estimated|calculated|before|after|between|from-to)$/.test(ev.date.qualifier) ? 'c.' : '');
  if (b !== null && d !== null) return approx(p.birth) + b + '–' + approx(p.death) + d;
  if (b !== null) return 'b. ' + approx(p.birth) + b;
  if (d !== null) return 'd. ' + approx(p.death) + d;
  if (p.death) return 'deceased';
  return '';
}

function parseFamily(rec, id) {
  const f = {
    id, kind: 'FAM', line: rec.line,
    husband: (kid(rec, 'HUSB') || {}).value || null,
    wife: (kid(rec, 'WIFE') || {}).value || null,
    children: kids(rec, 'CHIL').filter((c) => isPointer(c.value)).map((c) => c.value.trim()),
    // Relationship qualifiers Ancestry hangs off CHIL (adopted, step, foster).
    childRelations: {},
    events: [], notes: collectNotes(rec),
    sourceRefs: kids(rec, 'SOUR').filter((s) => isPointer(s.value)).map((s) => s.value.trim()),
    objectRefs: kids(rec, 'OBJE').filter((o) => isPointer(o.value)).map((o) => o.value.trim()),
    spouses: [], childRefs: [],
  };
  if (f.husband && !isPointer(f.husband)) f.husband = null;
  if (f.wife && !isPointer(f.wife)) f.wife = null;
  if (f.husband) f.husband = f.husband.trim();
  if (f.wife) f.wife = f.wife.trim();

  for (const c of kids(rec, 'CHIL')) {
    const rel = kidValue(c, '_FREL') || kidValue(c, '_MREL') || kidValue(c, 'PEDI');
    if (rel && isPointer(c.value)) f.childRelations[c.value.trim()] = rel;
  }
  for (const c of rec.children) {
    if (FAM_EVENT_TAGS[c.tag]) f.events.push(parseEvent(c, FAM_EVENT_TAGS[c.tag]));
  }
  f.marriage = f.events.find((e) => e.tag === 'MARR') ||
    f.events.find((e) => ['MARB', 'MARC', 'MARL', 'MARS', 'ENGA'].includes(e.tag)) || null;
  f.divorce = f.events.find((e) => e.tag === 'DIV' || e.tag === 'ANUL') || null;
  f.marriageYear = f.marriage ? f.marriage.date.year : null;
  return f;
}

// Resolves every pointer to an object, and repairs one-sided links so a family
// drawn from either end shows the same people. Every repair is recorded, since
// a link recorded from only one end is a specification violation the validator
// should report rather than quietly paper over.
function linkModel(individuals, families) {
  const repairs = [];
  for (const f of families.values()) {
    f.husbandRef = f.husband ? individuals.get(f.husband) || null : null;
    f.wifeRef = f.wife ? individuals.get(f.wife) || null : null;
    f.spouses = [f.husbandRef, f.wifeRef].filter(Boolean);
    f.childRefs = f.children.map((c) => individuals.get(c)).filter(Boolean);
    f.danglingSpouses = [f.husband, f.wife].filter((x) => x && !individuals.has(x));
    f.danglingChildren = f.children.filter((c) => !individuals.has(c));

    for (const s of f.spouses) {
      if (!s.fams.includes(f.id)) {
        s.fams.push(f.id);
        repairs.push({ kind: 'missingFams', individual: s.id, family: f.id, line: s.line });
      }
    }
    for (const c of f.childRefs) {
      if (!c.famc.includes(f.id)) {
        c.famc.push(f.id);
        repairs.push({ kind: 'missingFamc', individual: c.id, family: f.id, line: c.line });
      }
    }
  }
  for (const p of individuals.values()) {
    for (const fid of p.fams) {
      const f = families.get(fid);
      if (!f) continue;
      if (f.husband !== p.id && f.wife !== p.id) {
        // FAMS with no matching HUSB/WIFE — attach on the free side. A slot
        // holding a pointer to a record that does not exist counts as free;
        // the broken pointer is already recorded in f.danglingSpouses.
        if (p.sex === 'F' && !f.wifeRef) { f.wife = p.id; f.wifeRef = p; }
        else if (!f.husbandRef) { f.husband = p.id; f.husbandRef = p; }
        else if (!f.wifeRef) { f.wife = p.id; f.wifeRef = p; }
        else continue;
        f.spouses = [f.husbandRef, f.wifeRef].filter(Boolean);
        repairs.push({ kind: 'missingSpouse', individual: p.id, family: f.id, line: f.line });
      }
    }
    for (const fid of p.famc) {
      const f = families.get(fid);
      if (f && !f.children.includes(p.id)) {
        f.children.push(p.id);
        f.childRefs.push(p);
        repairs.push({ kind: 'missingChil', individual: p.id, family: f.id, line: f.line });
      }
    }
  }
  for (const p of individuals.values()) {
    p.parentFamilies = p.famc.map((id) => families.get(id)).filter(Boolean);
    p.spouseFamilies = p.fams.map((id) => families.get(id)).filter(Boolean);
    p.parents = [];
    for (const f of p.parentFamilies) for (const s of f.spouses) if (!p.parents.includes(s)) p.parents.push(s);
    p.childrenRefs = [];
    for (const f of p.spouseFamilies) for (const c of f.childRefs) if (!p.childrenRefs.includes(c)) p.childrenRefs.push(c);
    p.spouseRefs = [];
    for (const f of p.spouseFamilies) for (const s of f.spouses) if (s !== p && !p.spouseRefs.includes(s)) p.spouseRefs.push(s);
    p.siblings = [];
    for (const f of p.parentFamilies) for (const c of f.childRefs) if (c !== p && !p.siblings.includes(c)) p.siblings.push(c);
  }
  return repairs;
}

// ---- Entry point ------------------------------------------------------------

function parseGedcom(text) {
  const { lines, problems, blankLines } = tokenizeGedcom(text);
  const { records, problems: structural } = buildRecords(lines);
  const model = buildModel(records);
  return {
    ...model,
    records, lines,
    syntaxProblems: problems,
    structuralProblems: structural,
    blankLines,
  };
}

export {
  parseGedcom, tokenizeGedcom, buildRecords, buildModel,
  parseGedcomDate, parseName, parseEvent,
  isPointer, kids, kid, kidValue,
  INDI_EVENT_TAGS, INDI_ATTR_TAGS, FAM_EVENT_TAGS, EXT_EVENT_TAGS,
  STRICT_DATE_VALUE, MONTH_NAMES,
};
