export const SKILL_CATALOG = [
  {
    id: "checkmates",
    label: "Checkmates",
    shortLabel: "Mates",
    level: "beginner",
    categoryAliases: ["missed_mate"],
    relatedCategories: ["candidate_moves"],
    concepts: ["forcing checks", "escape squares", "protected attackers"],
    summary: "Train the habit of checking forcing moves before quiet improvements.",
    focusPrompt: "Every board has a mating idea. Start with checks and prove the king has no escape.",
    mixedPrompt: "Scan the position without assuming the answer. Decide whether mate, material, or defense matters first.",
    transferPrompt: "Retry the position from your game and find the forcing idea you missed.",
    scanPrompt: "Check every legal check, then test king moves, captures, and blocks.",
  },
  {
    id: "forks",
    label: "Forks",
    shortLabel: "Forks",
    level: "beginner",
    categoryAliases: ["missed_fork"],
    relatedCategories: ["candidate_moves"],
    concepts: ["two targets", "knight jumps", "forcing tempo"],
    summary: "Practice moves that attack two valuable targets at once.",
    focusPrompt: "Every board has a fork. Find the move that creates two threats at the same time.",
    mixedPrompt: "Look for forks, but verify whether another forcing idea is stronger.",
    transferPrompt: "Retry your game position and look for the two-target move.",
    scanPrompt: "Start with checks, then look for moves that hit the king and a loose high-value piece.",
  },
  {
    id: "pins",
    label: "Pins",
    shortLabel: "Pins",
    level: "beginner",
    categoryAliases: ["missed_pin", "missed_line_tactic"],
    relatedCategories: ["candidate_moves"],
    concepts: ["line pieces", "immobile defenders", "king alignment"],
    summary: "Use bishops, rooks, and queens to freeze defenders in front of something valuable.",
    focusPrompt: "Every board has a pin or line tactic. Find the line piece move that restricts a defender.",
    mixedPrompt: "Scan line tactics, then compare them with checks, captures, and threats.",
    transferPrompt: "Replay your game position and line up the piece that should not move.",
    scanPrompt: "Trace bishop, rook, and queen lines through enemy pieces toward the king or queen.",
  },
  {
    id: "skewers",
    label: "Skewers",
    shortLabel: "Skewers",
    level: "intermediate",
    categoryAliases: ["missed_skewer"],
    relatedCategories: ["missed_line_tactic", "candidate_moves"],
    concepts: ["king in front", "line pressure", "forced movement"],
    summary: "Attack the valuable front piece so what sits behind it becomes exposed.",
    focusPrompt: "Every board has a skewer. Find the forcing line move that pushes the front piece away.",
    mixedPrompt: "Look for skewers, but compare pins and forks before deciding.",
    transferPrompt: "Retry your game position and ask what sits behind the king or queen.",
    scanPrompt: "Look along open ranks, files, and diagonals for a valuable piece behind the first target.",
  },
  {
    id: "discovered-attacks",
    label: "Discovered Attacks",
    shortLabel: "Discoveries",
    level: "intermediate",
    categoryAliases: ["discovered_attack"],
    relatedCategories: ["candidate_moves"],
    concepts: ["blocked lines", "tempo", "opened attacks"],
    summary: "Move one piece with tempo so another piece suddenly attacks through the opened line.",
    focusPrompt: "Every board has a discovery. Move the blocker while creating a forcing threat.",
    mixedPrompt: "Scan blocked lines and compare discoveries with direct tactics.",
    transferPrompt: "Replay your game position and find the line you could have opened.",
    scanPrompt: "Find your blocked bishop, rook, or queen, then move the blocker with check or attack.",
  },
  {
    id: "loose-pieces",
    label: "Loose Pieces",
    shortLabel: "Loose",
    level: "beginner",
    categoryAliases: ["missed_capture", "hanging_piece"],
    relatedCategories: ["poor_trade", "candidate_moves"],
    concepts: ["undefended pieces", "safe captures", "recaptures"],
    summary: "Train the simple scan for pieces that can be won safely.",
    focusPrompt: "Every board has a loose-piece idea. Find the capture or move that wins material safely.",
    mixedPrompt: "Scan loose pieces, but make sure the tactic still works after the recapture.",
    transferPrompt: "Retry your game position and identify what was undefended.",
    scanPrompt: "Name attacked pieces, count defenders, then calculate the recapture.",
  },
  {
    id: "king-safety",
    label: "King Safety",
    shortLabel: "King",
    level: "beginner",
    categoryAliases: ["king_safety"],
    relatedCategories: ["opening_principle"],
    concepts: ["castling", "checks", "king shelter"],
    summary: "Stop threats before an exposed king turns normal moves into tactics.",
    focusPrompt: "Every board has a king-safety decision. Find the move that reduces checks or stops mate.",
    mixedPrompt: "Decide whether defense, development, or a forcing tactic matters most.",
    transferPrompt: "Replay your game position and fix the danger before taking material.",
    scanPrompt: "Ask what checks the opponent has next, then block, capture, move, or castle.",
  },
  {
    id: "opening-development",
    label: "Opening Development",
    shortLabel: "Opening",
    level: "beginner",
    categoryAliases: ["opening_principle"],
    relatedCategories: ["king_safety"],
    concepts: ["center", "development", "castling"],
    summary: "Build playable positions with center control, new pieces, and king safety.",
    focusPrompt: "Every board asks for a clean opening move. Develop, castle, or contest the center.",
    mixedPrompt: "Choose between development, king safety, and an immediate tactic.",
    transferPrompt: "Replay your game position and choose the move that improves your opening habits.",
    scanPrompt: "Prefer one new piece, center control, and castling before side attacks.",
  },
  {
    id: "trade-quality",
    label: "Trade Quality",
    shortLabel: "Trades",
    level: "intermediate",
    categoryAliases: ["poor_trade"],
    relatedCategories: ["hanging_piece", "missed_capture"],
    concepts: ["recapture", "piece value", "final position"],
    summary: "Calculate what remains after the capture sequence, not only what you can take now.",
    focusPrompt: "Every board has a trade decision. Calculate capture, recapture, and final material.",
    mixedPrompt: "Compare captures with quiet tactics before choosing the trade.",
    transferPrompt: "Retry your game position and calculate the final position before moving.",
    scanPrompt: "After every capture, ask what recaptures and whether the final piece is safe.",
  },
  {
    id: "candidate-moves",
    label: "Candidate Moves",
    shortLabel: "Candidates",
    level: "beginner",
    categoryAliases: ["candidate_moves"],
    relatedCategories: [],
    concepts: ["checks", "captures", "threats", "defense"],
    summary: "Build a short list before moving so tactics and opponent threats are not missed.",
    focusPrompt: "Every board has a forcing candidate. Compare checks, captures, and threats.",
    mixedPrompt: "Find the move type first: mate, fork, pin, capture, defense, or improvement.",
    transferPrompt: "Retry your game position and name at least two candidates before choosing.",
    scanPrompt: "Check checks first, then captures, threats, opponent threats, and one improving move.",
  },
];

const SKILL_BY_ID = new Map(SKILL_CATALOG.map((skill) => [skill.id, skill]));

export function getSkillById(id) {
  return SKILL_BY_ID.get(String(id || "")) || null;
}

export function getSkillCategories(skill) {
  if (!skill) return [];
  return [...new Set([...(skill.categoryAliases || []), ...(skill.relatedCategories || [])])];
}

export function skillMatchesCategory(skill, category) {
  return getSkillCategories(skill).includes(String(category || ""));
}

export function getSkillForCategory(category) {
  const normalized = String(category || "");
  return SKILL_CATALOG.find((skill) => (skill.categoryAliases || []).includes(normalized))
    || SKILL_CATALOG.find((skill) => (skill.relatedCategories || []).includes(normalized))
    || getSkillById("candidate-moves");
}
