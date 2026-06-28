/**
 * Construction vocabulary for transcription accuracy (spec §8a).
 *
 * Two lists, two jobs:
 *
 * 1. BASE_CONSTRUCTION_LEXICON — the LEAN, high-signal set sent to Deepgram as
 *    `keyterm` bias on every clip. Deepgram nova-3 (English) caps keyterms at ~100 and
 *    works best at 20–50: over-stuffing makes the model OVERFIT and force-match terms
 *    that weren't said (this is how "framing inspection" became "grade inspection").
 *    So this stays small and interior-weighted (the pilot walks interiors). NOT proper
 *    nouns — those belong per-project in Project.glossary.
 *
 * 2. INTERIOR_CONSTRUCTION_CORPUS — a broad reference pool of interior terminology.
 *    NOT sent to STT (it would blow the keyterm budget). It's the curation source for
 *    per-project glossaries: pick the dozen-or-so terms a given job actually uses.
 */
export const BASE_CONSTRUCTION_LEXICON: string[] = [
  // Inspections & process (where the misses hurt most)
  'framing inspection', 'above-ceiling inspection', 'in-wall inspection',
  'fire-stopping inspection', 'AHJ', 'RFI', 'punch list', 'backcharge',
  // Interior framing & rough carpentry
  'metal stud', 'king stud', 'jack stud', 'shaft wall', 'deflection track', 'hat channel',
  // Drywall, gypsum & insulation
  'type X', 'mold-resistant board', 'cement board', 'corner bead', 'mineral wool', 'firestopping',
  // Acoustical & suspended ceilings
  'ACT', 'ceiling grid', 'main runner', 'cross tee', 'hard-lid ceiling',
  // Flooring & floor prep
  'self-leveler', 'LVT', 'VCT', 'cove base',
  // Doors, frames & hardware
  'hollow metal frame', 'knockdown frame', 'vision lite', 'mortise lock', 'panic device', 'mag lock',
  // Painting & wall finishes
  'dryfall', 'intumescent paint', 'FRP panel',
  // Casework, millwork & specialties
  'plastic laminate', 'solid surface', 'toilet partition',
  // Interior MEP rough-in & trim
  'mud ring', 'flex duct', 'VAV', 'diffuser', 'trap primer',
  // Fire protection & life safety
  'sprinkler head', 'fire damper', 'smoke damper', 'FACP',
];

/** Stable id referenced by Project.baseLexiconRef. Bump when the active list changes. */
export const BASE_LEXICON_ID = 'base-construction-v2-interior';

/**
 * Broad interior-construction terminology — reference pool for curating per-project
 * glossaries (spec §8b). Deliberately NOT sent to Deepgram (see note above). Generated
 * across trades and grouped by discipline.
 */
export const INTERIOR_CONSTRUCTION_CORPUS: string[] = [
  // Interior framing & rough carpentry
  'metal stud', 'runner track', 'king stud', 'jack stud', 'cripple stud', 'double header',
  'blocking', 'backing', 'bridging', 'strongback', 'hat channel', 'resilient channel', 'RC-1',
  'shaft wall', 'shaft liner', 'deflection track', 'slip track', 'deep-leg track', 'kicker',
  'diagonal brace', 'X-brace', 'non-load-bearing', 'load-bearing', 'partition layout',
  'CMU backup', 'CMU', 'stud spacing', 'top plate',
  // Drywall, gypsum & insulation
  'type X', 'type C', 'abuse-resistant board', 'mold-resistant board', 'moisture-resistant board',
  'MR board', 'cement board', 'backer board', 'cementitious backer unit', 'CBU',
  'five-eighths board', 'corner bead', 'bullnose bead', 'L-bead', 'J-bead', 'setting compound',
  'topping compound', 'level five finish', 'level four finish', 'rated assembly', 'UL assembly',
  'STC rating', 'batt insulation', 'mineral wool', 'acoustic sealant', 'acoustical batt',
  'fire-rated partition', 'shaft wall assembly', 'area separation wall',
  // Acoustical & suspended ceilings
  'ACT', 'acoustical ceiling tile', 'suspended ceiling', 'ceiling grid', 'main runner', 'cross tee',
  'wall angle', 'hold-down clip', 'seismic clip', 'seismic bracing', 'hard-lid ceiling', 'hard lid',
  'GWB ceiling', 'bulkhead', 'plenum', 'above-ceiling inspection', 'access panel', 'hanger wire',
  'compression post', 'compression strut', 'perimeter closure', 'NRC rating', 'CAC rating',
  'lay-in tile', 'tegular tile', 'reveal edge', 'spline ceiling', 'concealed spline', 'T-bar',
  'drop ceiling',
  // Flooring & floor prep
  'self-leveler', 'self-leveling compound', 'LVT', 'VCT', 'sheet vinyl', 'vinyl composition tile',
  'luxury vinyl tile', 'click-lock flooring', 'RH testing', 'relative humidity test',
  'in-situ RH probe', 'calcium chloride test', 'moisture vapor emission rate', 'MVER',
  'moisture mitigation', 'epoxy moisture barrier', 'epoxy terrazzo', 'terrazzo divider strips',
  'cove base', 'rubber cove base', 'flash cove', 'transition strip', 'reducer strip', 'T-molding',
  'sleepers', 'floor flatness', 'FF/FL numbers', 'shot blasting', 'scarifying', 'seam sealer',
  'penetrating sealer', 'acclimation period',
  // Doors, frames & hardware (Div 8)
  'hollow metal frame', 'knockdown frame', 'welded frame', 'prehung door', 'vision lite', 'lite kit',
  'astragal', 'door closer', 'concealed closer', 'panic device', 'exit device', 'rim device',
  'mortise lock', 'cylindrical lock', 'lockset', 'strike plate', 'electric strike', 'mag lock',
  'electromagnetic lock', 'electrified hardware', 'card reader', 'continuous hinge', 'piano hinge',
  'kick plate', 'threshold', 'fire label', 'intumescent seal', 'smoke seal', 'door schedule',
  'hardware set', 'HM', 'ADA hardware',
  // Painting & wall finishes
  'sealer coat', 'eggshell finish', 'satin sheen', 'semi-gloss', 'dryfall paint', 'dryfall overspray',
  'intumescent paint', 'intumescent coating', 'epoxy coating', 'epoxy floor coating', 'two-part epoxy',
  'FRP panel', 'FRP adhesive', 'vinyl wallcovering', 'Type II wallcovering', 'wallcovering seam',
  'orange peel texture', 'knockdown texture', 'mil thickness', 'DFT', 'WFT', 'VOC compliant',
  'back-roll', 'cut-in', 'flash coat', 'substrate prep',
  // Casework, millwork & interior specialties
  'base cabinet', 'upper cabinet', 'tall cabinet', 'cabinet carcass', 'face frame', 'frameless cabinet',
  'adjustable shelf', 'shelf pin', 'toekick', 'plam', 'plastic laminate', 'solid surface', 'quartz top',
  'post-form top', 'backsplash', 'scribe molding', 'grab bar', 'toilet partition', 'pilaster',
  'floor-anchored', 'ceiling-hung partition', 'corner guard', 'FEC', 'extinguisher cabinet',
  'locker bank', 'sloped top locker', 'ADA signage', 'tactile sign', 'room number sign',
  // Interior MEP rough-in & trim
  'mud ring', 'j-box', 'EMT', 'MC cable', 'flex duct', 'VAV', 'FCU', 'diffuser', 'supply grille',
  'return grille', 'linear diffuser', 'disconnect', 'above-ceiling rough-in', 'trap primer', 'p-trap',
  'cleanout', 'backflow preventer', 'condensate line', 'condensate trap', 'raceway', 'conduit homerun',
  'pull string', 'low-voltage bracket', 'electrical homerun', 'in-wall blocking', 'fire caulk',
  'intumescent wrap', 'pressure-independent VAV', 'AHU', 'GFI',
  // Fire protection & life safety (interior)
  'sprinkler head', 'escutcheon', 'pendent head', 'upright head', 'sidewall head', 'concealed head',
  'armover', 'drop nipple', 'sprinkler drop', 'branchline', 'crossmain', 'fire riser',
  'inspector test valve', 'fire damper', 'smoke damper', 'combination fire smoke damper',
  'duct detector', 'FACP', 'horn strobe', 'pull station', 'two-hour rating', 'annunciator',
  'tamper switch', 'flow switch', 'OS&Y valve', 'PIV', 'FDC', 'wet pipe system', 'pre-action system',
  // Inspections, process & documents
  'framing inspection', 'rough framing', 'in-wall inspection', 'MEP rough', 'life-safety inspection',
  'sign-off', 'hold tag', 'deficiency list', 'backcharge', 'pre-inspection walk', 'correction notice',
  'stop-work order', 'occupancy inspection', 'pre-drywall inspection', 'field verification',
  'closeout document', 'permit card', 'notice of violation', 'open item', 'deferred inspection',
  'special inspection', 'special inspector', 'threshold inspection', 'inspection card',
  'fire-stopping inspection', 'certificate of occupancy', 'AHJ', 'COR',
];
