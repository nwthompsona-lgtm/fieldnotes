/**
 * Base construction lexicon (spec §8a) — the reusable, write-once list of terms
 * that are *unguessable as audio* and that generic STT reliably mangles. This is
 * NOT proper nouns (those live per-project in Project.glossary); these are the
 * domain-common words a model mis-hears: trades, assemblies, document phrasing.
 *
 * Used as Deepgram `keyterms` / Whisper `prompt` bias at transcription time.
 * Kept in contracts because both the server (STT) and admin (display) reference it.
 */
export const BASE_CONSTRUCTION_LEXICON: string[] = [
  // Envelope / exterior assemblies
  'EIFS', 'soffit', 'fascia', 'parapet', 'flashing', 'weep holes', 'mullion',
  'curtain wall', 'storefront', 'spandrel', 'sheathing', 'air barrier',
  'vapor barrier', 'through-wall flashing', 'cant strip', 'coping',
  // Concrete / structure
  'screed', 'rebar', 'formwork', 'shoring', 'reshoring', 'post-tension',
  'slab on grade', 'slab on deck', 'shear wall', 'grade beam', 'pile cap',
  'caisson', 'embed', 'doweling', 'cold joint', 'honeycombing', 'spalling',
  'efflorescence',
  // Rough-in / MEP
  'rough-in', 'top-out', 'stub-up', 'sleeve', 'penetration', 'firestopping',
  'condensate', 'VAV box', 'fan coil', 'ductwork', 'gypsum', 'demising wall',
  'furring', 'soffited', 'whip', 'home run', 'panelboard', 'switchgear',
  'busduct', 'cable tray', 'pull box',
  // Finishes
  'drywall', 'mud', 'tape', 'skim coat', 'underlayment', 'thinset', 'grout',
  'sealant', 'backer rod', 'casework', 'millwork', 'reveal', 'kerf',
  // Sitework
  'subgrade', 'aggregate base', 'compaction', 'proctor', 'silt fence',
  'dewatering', 'undercut', 'lift',
  // Process / documents
  'RFI', 'submittal', 'punch list', 'punchlist', 'as-built', 'shop drawing',
  'change order', 'ASI', 'addendum', 'NCR', 'mock-up', 'turnover',
  'substantial completion', 'TCO', 'inspection hold',
];

/** Stable id referenced by Project.baseLexiconRef. */
export const BASE_LEXICON_ID = 'base-construction-v1';
