// CSV import for the question bank (admin "Upload CSV"). RFC 4180: quoted
// fields may contain commas, quotes ("") and line breaks. Save sheets as
// "CSV UTF-8" so Tamil text survives.

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

export const CSV_COLUMNS = [
  'unit', 'subtopic', 'difficulty', 'answer',
  'text_ta', 'option_a_ta', 'option_b_ta', 'option_c_ta', 'option_d_ta', 'explanation_ta',
  'text_en', 'option_a_en', 'option_b_en', 'option_c_en', 'option_d_en', 'explanation_en',
  'source', 'book_ref', 'image_url',
] as const;

export const CSV_TEMPLATE =
  CSV_COLUMNS.join(',') +
  '\n' +
  [
    'polity', 'Constitution · அரசியலமைப்பு', '2', 'A',
    'அடிப்படை உரிமைகள் அரசியலமைப்பின் எந்தப் பகுதியில் உள்ளன?', 'பகுதி III', 'பகுதி IV', 'பகுதி II', 'பகுதி V',
    'பகுதி III (உறுப்புகள் 12–35).',
    'Fundamental Rights are in which Part of the Constitution?', 'Part III', 'Part IV', 'Part II', 'Part V',
    'Part III (Articles 12–35).', 'original', 'Samacheer 9th Social Science, Civics Unit 1', '',
  ]
    .map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v))
    .join(',') +
  '\n';

/** Turns CSV rows (with header) into objects for admin_import_questions. */
export function csvToQuestions(text: string) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { items: [], missing: [] as string[] };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const missing = ['unit', 'subtopic', 'difficulty', 'answer'].filter((c) => !header.includes(c));
  const col = (r: string[], name: string) => {
    const i = header.indexOf(name);
    return i >= 0 ? (r[i] ?? '').trim() : '';
  };
  const items = rows.slice(1).map((r) => {
    const opts = (lang: 'ta' | 'en') => ['a', 'b', 'c', 'd'].map((k) => col(r, `option_${k}_${lang}`));
    return {
      unit: col(r, 'unit'),
      subtopic: col(r, 'subtopic'),
      difficulty: col(r, 'difficulty'),
      answer: col(r, 'answer'),
      text_ta: col(r, 'text_ta'),
      options_ta: col(r, 'text_ta') ? opts('ta') : null,
      explanation_ta: col(r, 'explanation_ta'),
      text_en: col(r, 'text_en'),
      options_en: col(r, 'text_en') ? opts('en') : null,
      explanation_en: col(r, 'explanation_en'),
      source: col(r, 'source'),
      book_ref: col(r, 'book_ref'),
      image_url: col(r, 'image_url'),
    };
  });
  return { items, missing };
}
