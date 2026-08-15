// Validates a parsed GEDCOM against the 5.5.1 lineage-linked specification,
// then against the softer question of whether the data makes sense.
//
// Findings are grouped: one entry per rule, with a count and a few samples, so
// a file with 446 lowercase month names produces one line in the report rather
// than 446.

import { parseGedcomDate, isPointer, STRICT_DATE_VALUE } from './gedcom.js';

const ERROR = 'error', WARN = 'warning', INFO = 'info';

// ---- 5.5.1 substructure tables ---------------------------------------------
// Only the contexts worth policing: the ones where non-conforming exporters
// actually put things the spec does not allow.

const RECORD_TAGS = ['HEAD', 'SUBM', 'SUBN', 'INDI', 'FAM', 'SOUR', 'REPO', 'OBJE', 'NOTE', 'TRLR'];

const INDI_EVENTS = ['BIRT', 'CHR', 'DEAT', 'BURI', 'CREM', 'ADOP', 'BAPM', 'BARM', 'BASM',
  'BLES', 'CHRA', 'CONF', 'FCOM', 'ORDN', 'NATU', 'EMIG', 'IMMI', 'CENS', 'PROB', 'WILL',
  'GRAD', 'RETI', 'EVEN'];
const INDI_ATTRS = ['CAST', 'DSCR', 'EDUC', 'IDNO', 'NATI', 'NCHI', 'NMR', 'OCCU', 'PROP',
  'RELI', 'RESI', 'SSN', 'TITL', 'FACT'];
const FAM_EVENTS = ['ANUL', 'CENS', 'DIV', 'DIVF', 'ENGA', 'MARB', 'MARC', 'MARR', 'MARL',
  'MARS', 'RESI', 'EVEN'];

const PERMITTED = {
  HEAD: ['SOUR', 'DEST', 'DATE', 'SUBM', 'SUBN', 'FILE', 'COPR', 'GEDC', 'CHAR', 'LANG', 'PLAC', 'NOTE'],
  INDI: ['RESN', 'NAME', 'SEX', ...INDI_EVENTS, ...INDI_ATTRS, 'BAPL', 'CONL', 'ENDL', 'SLGC',
    'FAMC', 'FAMS', 'SUBM', 'ASSO', 'ALIA', 'ANCI', 'DESI', 'RFN', 'AFN', 'REFN', 'RIN',
    'CHAN', 'NOTE', 'SOUR', 'OBJE'],
  FAM: ['RESN', ...FAM_EVENTS, 'HUSB', 'WIFE', 'CHIL', 'NCHI', 'SUBM', 'SLGS', 'REFN', 'RIN',
    'CHAN', 'NOTE', 'SOUR', 'OBJE'],
  SOUR: ['DATA', 'AUTH', 'TITL', 'ABBR', 'PUBL', 'TEXT', 'REPO', 'REFN', 'RIN', 'CHAN', 'NOTE', 'OBJE'],
  OBJE: ['FILE', 'REFN', 'RIN', 'NOTE', 'SOUR', 'CHAN'],
  REPO: ['NAME', 'ADDR', 'PHON', 'EMAIL', 'FAX', 'WWW', 'NOTE', 'REFN', 'RIN', 'CHAN'],
  SUBM: ['NAME', 'ADDR', 'PHON', 'EMAIL', 'FAX', 'WWW', 'OBJE', 'LANG', 'RFN', 'RIN', 'NOTE', 'CHAN'],
};

// EVENT_DETAIL, shared by individual and family events (5.5.1 p.32).
const EVENT_DETAIL = ['TYPE', 'DATE', 'PLAC', 'ADDR', 'PHON', 'EMAIL', 'FAX', 'WWW', 'AGNC',
  'RELI', 'CAUS', 'RESN', 'AGE', 'HUSB', 'WIFE', 'NOTE', 'SOUR', 'OBJE'];
const NAME_DETAIL = ['TYPE', 'NPFX', 'GIVN', 'NICK', 'SPFX', 'SURN', 'NSFX', 'FONE', 'ROMN', 'NOTE', 'SOUR'];

const isCustom = (tag) => tag.startsWith('_');

// ---- Report plumbing --------------------------------------------------------

class Report {
  constructor() { this.groups = new Map(); this.checks = 0; }

  add(id, severity, category, title, detail, sample) {
    let g = this.groups.get(id);
    if (!g) {
      g = { id, severity, category, title, detail, count: 0, samples: [] };
      this.groups.set(id, g);
    }
    g.count++;
    if (sample && g.samples.length < 6) g.samples.push(sample);
    return g;
  }

  finish(counts) {
    const findings = [...this.groups.values()];
    const order = { error: 0, warning: 1, info: 2 };
    findings.sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count);
    return {
      findings,
      counts,
      errors: findings.filter((f) => f.severity === ERROR).reduce((s, f) => s + f.count, 0),
      warnings: findings.filter((f) => f.severity === WARN).reduce((s, f) => s + f.count, 0),
      infos: findings.filter((f) => f.severity === INFO).reduce((s, f) => s + f.count, 0),
      errorRules: findings.filter((f) => f.severity === ERROR).length,
      warningRules: findings.filter((f) => f.severity === WARN).length,
      checks: this.checks,
    };
  }
}

const at = (line, text) => ({ line, text: String(text == null ? '' : text).slice(0, 110) });

// ---- The validator ----------------------------------------------------------

function validateGedcom(parsed) {
  const r = new Report();
  const { records, lines, syntaxProblems, structuralProblems, individuals, families, header } = parsed;

  checkSyntax(r, lines, syntaxProblems, structuralProblems);
  checkHeaderAndTrailer(r, records, header);
  const defined = checkRecordsAndXrefs(r, records);
  checkGrammar(r, records);
  checkPointers(r, records, defined);
  checkMultimedia(r, records);
  checkIndividuals(r, individuals);
  checkFamilies(r, families);
  checkRepairs(r, parsed.repairs || []);
  checkPlausibility(r, individuals, families);

  return r.finish({
    lines: lines.length,
    records: records.length,
    individuals: individuals.size,
    families: families.size,
    sources: parsed.sources.size,
    objects: parsed.objects.size,
  });
}

// -- syntax -------------------------------------------------------------------

function checkSyntax(r, lines, syntaxProblems, structuralProblems) {
  r.checks += 5;
  for (const p of syntaxProblems) {
    r.add('syntax.unreadable', ERROR, 'Syntax',
      'Line does not match the GEDCOM line grammar',
      'Every line must be `level [xref] tag [value]` (5.5.1 §Grammar). These could not be read and were skipped.',
      at(p.line, p.text));
  }
  for (const p of structuralProblems) {
    r.add('syntax.orphan', ERROR, 'Syntax',
      'Line nested under a level that does not exist',
      'A line at level N must follow a line at level N-1.',
      at(p.line, p.tag + ' at level ' + p.level));
  }

  let prev = -1;
  for (const l of lines) {
    if (l.level > prev + 1) {
      r.add('syntax.levelJump', ERROR, 'Syntax',
        'Level increases by more than one',
        'Levels may only increase one at a time (5.5.1 §Grammar).',
        at(l.no, l.level + ' ' + l.tag));
    }
    prev = l.level;

    if (l.length > 255) {
      r.add('syntax.lineLength', WARN, 'Syntax',
        'Line longer than 255 characters',
        'GEDCOM 5.5.1 limits a physical line to 255 characters; longer text should be split with CONC/CONT.',
        at(l.no, l.tag + ' (' + l.length + ' chars)'));
    }
    if (l.xref && l.xref.length > 22) {
      r.add('syntax.xrefLength', WARN, 'Syntax',
        'Cross-reference identifier longer than 22 characters',
        'XREF_ID is limited to 22 characters including the delimiting @ signs (5.5.1 p.24).',
        at(l.no, l.xref));
    }
    if (/^[ \t]|[ \t]$/.test(l.value) && l.value.trim() !== '') {
      r.add('syntax.padding', WARN, 'Values',
        'Value has leading or trailing whitespace',
        'Line values are taken verbatim, so padding ends up in the data. Trim on export.',
        at(l.no, l.tag + ' ' + JSON.stringify(l.value)));
    }
  }
}

function checkHeaderAndTrailer(r, records, header) {
  r.checks += 6;
  const first = records[0], last = records[records.length - 1];
  if (!first || first.tag !== 'HEAD') {
    r.add('head.missing', ERROR, 'Structure', 'File does not start with a HEAD record',
      'A lineage-linked file must begin with HEAD and end with TRLR (5.5.1 p.23).', at(1, ''));
  }
  if (!last || last.tag !== 'TRLR') {
    r.add('trlr.missing', ERROR, 'Structure', 'File does not end with a TRLR record',
      'A lineage-linked file must end with a TRLR record (5.5.1 p.23).', at(last ? last.line : 1, ''));
  }
  if (records.filter((x) => x.tag === 'TRLR').length > 1) {
    r.add('trlr.duplicate', ERROR, 'Structure', 'More than one TRLR record', 'TRLR must appear exactly once.', at(0, ''));
  }
  if (!header) return;
  if (!header.source) {
    r.add('head.sour', ERROR, 'Structure', 'HEAD is missing the required SOUR line',
      'HEAD.SOUR (the originating system) is mandatory in 5.5.1.', at(1, ''));
  }
  if (!header.version || !header.form) {
    r.add('head.gedc', ERROR, 'Structure', 'HEAD is missing GEDC.VERS or GEDC.FORM',
      'Both are mandatory inside HEAD.GEDC.', at(1, 'VERS=' + header.version + ' FORM=' + header.form));
  } else {
    if (header.version !== '5.5.1' && header.version !== '5.5') {
      r.add('head.version', INFO, 'Structure', 'GEDCOM version is not 5.5 or 5.5.1',
        'This validator checks against 5.5.1; results for other versions are indicative.',
        at(1, header.version));
    }
    if (header.form.toUpperCase() !== 'LINEAGE-LINKED') {
      r.add('head.form', ERROR, 'Structure', 'HEAD.GEDC.FORM is not LINEAGE-LINKED',
        'Only the LINEAGE-LINKED form is defined by the specification.', at(1, header.form));
    }
  }
  const charsets = ['ANSEL', 'UTF-8', 'UNICODE', 'ASCII'];
  if (!header.charset) {
    r.add('head.char', ERROR, 'Structure', 'HEAD is missing the required CHAR line',
      'HEAD.CHAR (character set) is mandatory in 5.5.1.', at(1, ''));
  } else if (!charsets.includes(header.charset.toUpperCase())) {
    r.add('head.charValue', WARN, 'Structure', 'HEAD.CHAR is not one of the values 5.5.1 defines',
      'Permitted values are ANSEL, UTF-8, UNICODE and ASCII.', at(1, header.charset));
  }
  if (!header.file) {
    r.add('head.file', INFO, 'Structure', 'HEAD has no FILE line',
      'FILE (the name the file was known by) is optional but recommended.', at(1, ''));
  }
}

function checkRecordsAndXrefs(r, records) {
  r.checks += 4;
  const defined = new Map();
  for (const rec of records) {
    if (!RECORD_TAGS.includes(rec.tag) && !isCustom(rec.tag)) {
      r.add('record.unknown', ERROR, 'Structure', 'Record type not defined at level 0 in 5.5.1',
        'Level 0 may hold HEAD, SUBM, SUBN, INDI, FAM, SOUR, REPO, OBJE, NOTE and TRLR.',
        at(rec.line, rec.tag));
    } else if (isCustom(rec.tag)) {
      r.add('record.custom', INFO, 'Extensions', 'Vendor-defined record type at level 0',
        'Underscore-prefixed tags are the specification’s escape hatch for vendor data (5.5.1 p.10). Other programs may ignore them.',
        at(rec.line, rec.tag));
    }
    if (rec.xref) {
      if (defined.has(rec.xref)) {
        r.add('xref.duplicate', ERROR, 'References', 'Cross-reference identifier defined twice',
          'Each XREF_ID must be unique within the file.', at(rec.line, rec.xref));
      }
      defined.set(rec.xref, rec.tag);
    } else if (['INDI', 'FAM', 'SOUR', 'REPO', 'OBJE', 'SUBM'].includes(rec.tag)) {
      r.add('xref.missing', ERROR, 'References', 'Record has no cross-reference identifier',
        'INDI, FAM, SOUR, REPO, OBJE and SUBM records must each carry an XREF_ID so they can be pointed at.',
        at(rec.line, rec.tag));
    }
  }
  return defined;
}

// -- grammar (tag placement) --------------------------------------------------

function checkGrammar(r, records) {
  r.checks += 3;
  for (const rec of records) {
    const permitted = PERMITTED[rec.tag];
    if (!permitted) continue;
    for (const c of rec.children) {
      if (isCustom(c.tag)) {
        r.add('tag.custom', INFO, 'Extensions', 'Vendor-defined tag',
          'Underscore-prefixed tags are permitted but not portable; other software will usually drop them.',
          at(c.line, rec.tag + '.' + c.tag));
        continue;
      }
      if (!permitted.includes(c.tag)) {
        r.add('tag.misplaced.' + rec.tag + '.' + c.tag, ERROR, 'Grammar',
          `${c.tag} is not a permitted substructure of ${rec.tag}`,
          grammarHint(rec.tag, c.tag),
          at(c.line, rec.tag + '.' + c.tag + ' ' + c.value));
      }
      checkEventDetail(r, rec.tag, c);
    }
  }
}

function grammarHint(parent, tag) {
  if (parent === 'INDI' && FAM_EVENTS.includes(tag)) {
    return `${tag} is a family event in 5.5.1 and belongs on the FAM record, not the individual. ` +
      'Some exporters duplicate it here; portable readers will ignore it.';
  }
  if (parent === 'INDI' && tag === 'ADDR') {
    return 'ADDR is part of an ADDRESS_STRUCTURE attached to an event or attribute (for example RESI), ' +
      'not a direct substructure of INDI.';
  }
  return `The 5.5.1 record structure for ${parent} does not list ${tag}. Readers are free to discard it.`;
}

function checkEventDetail(r, recordTag, node) {
  const isEvent = (recordTag === 'INDI' && (INDI_EVENTS.includes(node.tag) || INDI_ATTRS.includes(node.tag))) ||
    (recordTag === 'FAM' && FAM_EVENTS.includes(node.tag));
  const permitted = node.tag === 'NAME' ? NAME_DETAIL : isEvent ? EVENT_DETAIL : null;
  if (!permitted) return;
  for (const c of node.children) {
    if (isCustom(c.tag)) continue; // already reported at the record level
    if (!permitted.includes(c.tag)) {
      r.add('detail.misplaced.' + node.tag + '.' + c.tag, WARN, 'Grammar',
        `${c.tag} is not part of ${node.tag === 'NAME' ? 'PERSONAL_NAME_STRUCTURE' : 'EVENT_DETAIL'}`,
        `${recordTag}.${node.tag}.${c.tag} is outside what 5.5.1 defines here.`,
        at(c.line, recordTag + '.' + node.tag + '.' + c.tag));
    }
  }
  if (node.tag === 'EVEN' && !node.children.some((c) => c.tag === 'TYPE')) {
    r.add('even.type', WARN, 'Grammar', 'EVEN without a TYPE',
      'A generic EVEN carries no meaning without TYPE naming the event (5.5.1 p.33).', at(node.line, recordTag + '.EVEN'));
  }
  if (node.tag === 'OCCU' && !node.value.trim()) {
    r.add('occu.empty', WARN, 'Values', 'OCCU has no value',
      'The occupation belongs in the OCCU line value. An empty OCCU with the trade written into PLAC loses it for other readers.',
      at(node.line, recordTag + '.OCCU'));
  }
}

// -- pointers -----------------------------------------------------------------

function checkPointers(r, records, defined) {
  r.checks += 2;
  const referenced = new Set();
  (function walk(nodes, path) {
    for (const n of nodes) {
      const p = path ? path + '.' + n.tag : n.tag;
      const v = (n.value || '').trim();
      if (isPointer(v)) {
        referenced.add(v);
        if (!defined.has(v)) {
          r.add('pointer.dangling', ERROR, 'References', 'Pointer to a record that does not exist',
            'Every pointer must name a record defined in the same file (5.5.1 p.11). The link cannot be followed.',
            at(n.line, p + ' ' + v));
        }
      }
      walk(n.children, p);
    }
  })(records, '');

  for (const rec of records) {
    if (!rec.xref || !['SOUR', 'OBJE', 'REPO', 'NOTE', 'SUBM'].includes(rec.tag)) continue;
    if (!referenced.has(rec.xref)) {
      r.add('record.unreferenced', INFO, 'References', 'Record is never pointed at',
        'A supporting record nothing refers to is dead weight in the file.',
        at(rec.line, rec.tag + ' ' + rec.xref));
    }
  }
  return referenced;
}

// -- multimedia ---------------------------------------------------------------

function checkMultimedia(r, records) {
  r.checks += 3;
  for (const rec of records) {
    if (rec.tag !== 'OBJE') continue;
    const files = rec.children.filter((c) => c.tag === 'FILE');
    if (!files.length) {
      r.add('obje.noFile', ERROR, 'Multimedia', 'Multimedia record has no FILE',
        'MULTIMEDIA_RECORD requires at least one FILE giving the multimedia reference (5.5.1 p.26).',
        at(rec.line, rec.xref || 'OBJE'));
      continue;
    }
    for (const f of files) {
      if (!f.value.trim()) {
        r.add('obje.emptyFile', ERROR, 'Multimedia', 'FILE has no multimedia reference',
          'The FILE line value carries the path or URL of the image. Empty here, so the record ' +
          'names a format and a title but no actual file — the pictures are not in this export.',
          at(f.line, (rec.xref || 'OBJE') + ' FILE'));
      }
      if (!f.children.some((c) => c.tag === 'FORM')) {
        r.add('obje.noForm', ERROR, 'Multimedia', 'FILE has no FORM',
          'FORM (the multimedia format) is mandatory beneath FILE in 5.5.1.',
          at(f.line, (rec.xref || 'OBJE') + ' FILE'));
      }
    }
  }
}

// -- one-sided links the parser had to repair ---------------------------------

const REPAIR_RULES = {
  missingFams: ['FAMS', 'HUSB/WIFE', 'A family names this individual as a spouse, but the individual has no matching FAMS link.'],
  missingFamc: ['FAMC', 'CHIL', 'A family names this individual as a child, but the individual has no matching FAMC link.'],
  missingSpouse: ['HUSB or WIFE', 'FAMS', 'An individual points at this family with FAMS, but the family does not name them as HUSB or WIFE.'],
  missingChil: ['CHIL', 'FAMC', 'An individual points at this family with FAMC, but the family does not list them as a CHIL.'],
};

function checkRepairs(r, repairs) {
  r.checks += 1;
  for (const rep of repairs) {
    const rule = REPAIR_RULES[rep.kind];
    if (!rule) continue;
    r.add('link.oneSided.' + rep.kind, ERROR, 'References',
      `Missing ${rule[0]} to match a ${rule[1]} link`,
      rule[2] + ' Links must be recorded from both ends (5.5.1 p.26, p.31). ' +
      'The viewer has joined the two sides so the family still draws.',
      at(rep.line, rep.individual + ' ↔ ' + rep.family));
  }
}

// -- individuals --------------------------------------------------------------

function checkIndividuals(r, individuals) {
  r.checks += 8;
  for (const p of individuals.values()) {
    if (!p.names.length) {
      r.add('indi.noName', WARN, 'Individuals', 'Individual has no NAME',
        'NAME is not strictly mandatory, but an individual without one cannot be identified.', at(p.line, p.id));
    }
    for (const n of p.names) {
      if (!n.hasSlashes) {
        r.add('name.noSlashes', WARN, 'Individuals', 'NAME value has no /surname/ delimiters',
          'The name value should be "Given /Surname/ Suffix" so the surname can be told apart (5.5.1 p.54).',
          at(p.line, p.id + ': ' + n.raw));
      }
    }
    if (p.names.length > 1) {
      r.add('name.multiple', INFO, 'Individuals', 'Individual has more than one NAME',
        'Permitted — alternate spellings, married names — but only the first is used as the display name here. ' +
        'Adding TYPE to the extra names says what they are.',
        at(p.line, p.id + ': ' + p.names.map((n) => n.raw).join(' | ')));
    }
    if (p.sex === 'U') {
      r.add('indi.noSex', INFO, 'Individuals', 'Individual has no usable SEX',
        'SEX is optional, but without it the individual cannot be placed as husband or wife.', at(p.line, p.id));
    }
    if (p.famc.length > 1) {
      r.add('indi.multiFamc', INFO, 'Individuals', 'Individual is a child in more than one family',
        'Legitimate for adoption or fostering; PEDI on the FAMC link records which is which.',
        at(p.line, p.id + ' → ' + p.famc.join(' ')));
    }
    for (const ev of [...p.events, ...p.attributes]) checkEventValues(r, ev, p.id);
    if (p.events.some((e) => e.misplaced)) {
      // already reported by the grammar check; nothing further
    }
  }
}

function checkEventValues(r, ev, ownerId) {
  if (ev.date.raw && !ev.date.conforming) {
    const why = describeDateProblem(ev.date.raw);
    r.add('date.' + why.id, why.severity, 'Dates', why.title, why.detail,
      at(ev.line, ownerId + ' ' + ev.tag + ' DATE ' + ev.date.raw));
  }
  if (ev.date.raw && !ev.date.parsed && ev.date.conforming === false && !/^\(.*\)$/.test(ev.date.raw)) {
    r.add('date.unreadable', WARN, 'Dates', 'Date could not be read as a date at all',
      'Nothing resembling a day, month or year could be extracted, so the event cannot be placed in time.',
      at(ev.line, ownerId + ' ' + ev.tag + ' DATE ' + ev.date.raw));
  }
}

function describeDateProblem(raw) {
  const s = raw.trim();
  if (/^\d{4}\s*[-–]\s*\d{4}$/.test(s)) {
    return {
      id: 'range', severity: ERROR, title: 'Date range written with a hyphen',
      detail: 'A period is written `FROM 1914 TO 1920` and a range `BET 1914 AND 1920` (5.5.1 p.45). ' +
        '"1914-1920" is not a DATE_VALUE and most readers will store it as text.',
    };
  }
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) {
    return {
      id: 'slashes', severity: ERROR, title: 'Date written in numeric d/m/y form',
      detail: 'GEDCOM dates are `DD MMM YYYY` with a three-letter English month (5.5.1 p.45). ' +
        'A numeric form is ambiguous between day-first and month-first readers.',
    };
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return {
      id: 'iso', severity: WARN, title: 'Date written in ISO 8601 form',
      detail: 'Unambiguous but not a GEDCOM DATE_VALUE; 5.5.1 expects `DD MMM YYYY`.',
    };
  }
  if (/\b(JANUARY|FEBRUARY|MARCH|APRIL|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\b/i.test(s)) {
    return {
      id: 'fullMonth', severity: WARN, title: 'Date uses a full month name',
      detail: 'The month must be the three-letter abbreviation JAN–DEC (5.5.1 p.45).',
    };
  }
  if (/^(ABT\.|ABOUT|CIRCA|CA\.?|C\.)\s/i.test(s)) {
    return {
      id: 'approxWord', severity: WARN, title: 'Approximation keyword is not the GEDCOM one',
      detail: 'The defined keywords are ABT, CAL and EST — without a full stop (5.5.1 p.46).',
    };
  }
  if (/^\d{1,2}\s+[A-Za-z]{3}\.?\s+\d{3,4}$/.test(s) || /[a-z]/.test(s)) {
    return {
      id: 'case', severity: INFO, title: 'Date keyword or month is not upper case',
      detail: 'The specification writes months and keywords in upper case. Readers generally cope, ' +
        'but it is not the defined form.',
    };
  }
  return {
    id: 'other', severity: WARN, title: 'Date does not match DATE_VALUE',
    detail: 'The value is not one of the forms defined in 5.5.1 p.45–46 and will be treated as free text.',
  };
}

// -- families -----------------------------------------------------------------

function checkFamilies(r, families) {
  r.checks += 6;
  for (const f of families.values()) {
    const members = f.spouses.length + f.childRefs.length;
    if (!members) {
      r.add('fam.empty', WARN, 'Families', 'Family record with no members',
        'A FAM with no HUSB, WIFE or CHIL links nothing together.', at(f.line, f.id));
    } else if (members === 1) {
      r.add('fam.lone', WARN, 'Families', 'Family record with only one member that exists',
        'A family joins people together; with a single resolvable member there is no relationship ' +
        'to record and nothing to draw. Usually the other side is a pointer to a record ' +
        'that is not in the file.',
        at(f.line, f.id + (f.danglingSpouses.length || f.danglingChildren.length
          ? ' — broken link to ' + [...f.danglingSpouses, ...f.danglingChildren].join(', ') : '')));
    }
    if (f.husbandRef && f.husbandRef.sex === 'F') {
      r.add('fam.sexMismatch', WARN, 'Families', 'HUSB points at an individual recorded as female',
        'HUSB and WIFE are defined by SEX in 5.5.1; the pairing here contradicts the individual record.',
        at(f.line, f.id + ' HUSB ' + f.husband));
    }
    if (f.wifeRef && f.wifeRef.sex === 'M') {
      r.add('fam.sexMismatch', WARN, 'Families', 'WIFE points at an individual recorded as male',
        'HUSB and WIFE are defined by SEX in 5.5.1; the pairing here contradicts the individual record.',
        at(f.line, f.id + ' WIFE ' + f.wife));
    }
    for (const c of f.childRefs) {
      if (c === f.husbandRef || c === f.wifeRef) {
        r.add('fam.selfChild', ERROR, 'Families', 'Individual is both spouse and child in the same family',
          'This makes the person their own parent.', at(f.line, f.id + ' ' + c.id));
      }
    }
    const seen = new Set();
    for (const c of f.children) {
      if (seen.has(c)) {
        r.add('fam.dupChild', WARN, 'Families', 'The same child is listed twice in one family',
          'Duplicate CHIL pointers inflate sibling counts.', at(f.line, f.id + ' ' + c));
      }
      seen.add(c);
    }
  }
}

// -- plausibility -------------------------------------------------------------

function checkPlausibility(r, individuals, families) {
  r.checks += 7;
  for (const p of individuals.values()) {
    const b = p.birthYear, d = p.deathYear;
    if (b !== null && d !== null) {
      if (d < b) {
        r.add('plaus.deathBeforeBirth', ERROR, 'Plausibility', 'Death is before birth',
          'The dates on this individual cannot both be right.', at(p.line, p.id + ' ' + b + ' → ' + d));
      } else if (d - b > 115) {
        r.add('plaus.longLife', WARN, 'Plausibility', 'Lifespan over 115 years',
          'Possible, but usually a transcription error or two people merged into one.',
          at(p.line, p.id + ' ' + b + '–' + d + ' (' + (d - b) + ')'));
      }
    }
    for (const parent of p.parents || []) {
      if (parent.birthYear !== null && b !== null) {
        const gap = b - parent.birthYear;
        if (gap < 12) {
          r.add('plaus.youngParent', WARN, 'Plausibility', 'Parent under 12 at the child’s birth',
            'Check the generation links and the birth years.',
            at(p.line, parent.id + ' (' + parent.birthYear + ') → ' + p.id + ' (' + b + ')'));
        } else if (gap > 65) {
          r.add('plaus.oldParent', WARN, 'Plausibility', 'Parent over 65 at the child’s birth',
            'Often a sign that a generation has been skipped or two people share a name.',
            at(p.line, parent.id + ' (' + parent.birthYear + ') → ' + p.id + ' (' + b + ')'));
        }
      }
      if (parent.deathYear !== null && b !== null && b - parent.deathYear > 1) {
        r.add('plaus.bornAfterParentDeath', WARN, 'Plausibility', 'Child born more than a year after a parent died',
          'Allowing one year for a posthumous birth, this pairing does not work.',
          at(p.line, parent.id + ' d.' + parent.deathYear + ' → ' + p.id + ' b.' + b));
      }
    }
  }

  for (const f of families.values()) {
    const y = f.marriageYear;
    if (y === null) continue;
    for (const s of f.spouses) {
      if (s.birthYear !== null && y - s.birthYear < 12) {
        r.add('plaus.youngMarriage', WARN, 'Plausibility', 'Spouse under 12 at marriage',
          'Check the marriage year against the birth year.', at(f.line, f.id + ' ' + s.id + ' b.' + s.birthYear + ' m.' + y));
      }
      if (s.deathYear !== null && y > s.deathYear) {
        r.add('plaus.marriedAfterDeath', WARN, 'Plausibility', 'Marriage recorded after a spouse died',
          'One of the two dates is wrong, or the marriage belongs to a different family.',
          at(f.line, f.id + ' ' + s.id + ' d.' + s.deathYear + ' m.' + y));
      }
    }
  }

  // Ancestry loops make a family tree impossible to lay out.
  const state = new Map();
  const loops = [];
  (function () {
    const visit = (p, path) => {
      const st = state.get(p.id);
      if (st === 2) return;
      if (st === 1) { loops.push(path.slice(path.indexOf(p.id)).concat(p.id)); return; }
      state.set(p.id, 1);
      for (const parent of p.parents || []) visit(parent, path.concat(p.id));
      state.set(p.id, 2);
    };
    for (const p of individuals.values()) visit(p, []);
  })();
  for (const loop of loops) {
    r.add('plaus.ancestryLoop', ERROR, 'Plausibility', 'Individual is their own ancestor',
      'A cycle in the parent links. No generation ordering exists while it is there.',
      at(0, loop.join(' → ')));
  }
}

export { validateGedcom, PERMITTED, EVENT_DETAIL, NAME_DETAIL, RECORD_TAGS };
