# Personal Chess Teacher

A local web app for a personal chess teacher that can play against you, review your games, explain mistakes, track weaknesses, and turn your own mistakes into targeted practice.

The app does not try to learn chess from scratch. It combines proven chess tools with a personal learning profile:

- `chess.js` handles legal moves, PGN, FEN, and game state.
- Stockfish is used when available for engine-grade move selection and analysis.
- Supabase stores long-term games, positions, weaknesses, Skill Lab practice, and practice history.
- The coaching layer learns your habits from your games and turns repeated issues into drills.

## Current Implementation

This repository is a runnable local web app.

```sh
npm start
```

Then open:

```text
http://localhost:5173
```

Play always works locally (chess.js + bundled Stockfish). The conversational coach needs the local OpenAI server. Accounts and long-term history sync need Supabase configured on the server (see Account And Sync Setup); when configured, the app requires sign-in and every user's history is isolated by account. Apply `supabase/schema.sql` on fresh projects, or run `supabase/migrations/001_multi_tenant.sql` to upgrade an existing single-user database.

## What The Platform Does Today

The platform is a personal chess teacher rather than a generic chessboard.

- Plays full legal games in the browser with `chess.js`, with drag-and-drop or click-to-move on SVG pieces (Merida set).
- Uses one quick calibration game to establish a baseline, then calibrates continuously from every graded move.
- Runs Stockfish from bundled local assets when available, with CDN and heuristic fallbacks; opponent strength is Elo-limited (`UCI_LimitStrength`) for human-like play.
- Adapts opponent strength from a per-dimension skill model (tactics, openings, endgames, calculation), recent results, and mistake severity.
- Reviews learner moves with heuristics, Stockfish eval deltas, best alternatives, and principal variations.
- Shows post-calibration move-quality cues after each learner move while playing: best, excellent, good, book, inaccuracy, mistake, blunder, and missed win.
- Highlights played and best moves in Review so the learner can compare choices visually.
- Tracks recurring weaknesses and turns mistakes into practice positions.
- Provides Skill Labs for focused tactics, mixed recognition, and retry positions from the learner's own games.
- Talks with you during games through a conversational coach: proactive comments at key moments, questions about your thinking (stored as reasoning traces), durable memory notes, and a coach-offered rethink on serious blunders instead of a free undo.
- Runs a guided post-game review: the coach picks 2-3 key moments, asks what you were thinking, then teaches.
- Trains openings from a built-in repertoire (12 openings, every learner move explained) with SM-2-lite spaced repetition on both opening lines and mistake drills.
- Stores games and learning data locally, and syncs to Supabase when configured.

## OpenAI Setup

Do not put an OpenAI API key in `app.js` or any browser field. OpenAI API keys are server-side secrets.

Create a local `.env` file:

```sh
cp .env.example .env
```

Edit `.env`:

```text
OPENAI_API_KEY=replace-with-your-key
OPENAI_MODEL=gpt-5.1
HOST=127.0.0.1
PORT=5173
ENABLE_REMOTE_HISTORY_ERASE=false
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Start the app:

```sh
npm start
```

## Account And Sync Setup

Identity uses Supabase Auth (email + password); data access is server-only.

1. In the Supabase dashboard, enable email auth (on by default) and grab three values from Project Settings -> API: the project URL, the publishable key, and the service role key.
2. Put them in `.env` as `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`, then restart the server.
3. Fresh project: run `supabase/schema.sql` in the SQL editor. Existing single-user database: run `supabase/migrations/001_multi_tenant.sql` instead (it adds `user_id` everywhere, re-keys per-user uniqueness, enables RLS, and revokes anon/authenticated grants).

Security model:

- The browser never talks to the database. All reads/writes go through the Node server (`POST /api/sync`, `GET /api/account/export`, `DELETE /api/account/data`), which verifies the Supabase access token and stamps `user_id` server-side.
- The service role key stays in `.env`. RLS is enabled with no policies and all grants are revoked from `anon`/`authenticated`, so the publishable key alone can read or write nothing.
- The coach endpoints require sign-in whenever Supabase is configured, so only authenticated users can spend OpenAI tokens. Rate limits are per-user.
- Leaving the three variables blank runs the app in legacy local mode: no sign-in, no cloud sync, history stays in the browser.

The Node server serves the app and exposes `/api/coach`. The browser sends chess context to that endpoint; the server adds the API key and calls OpenAI.

## Calibration And Bot Difficulty

The app starts with a single calibration game instead of a five-game placement wall.

During that first game the coach watches silently: no hints, no commentary, no quality badges. It records the result, move classifications, mistake severity, and average centipawn loss when Stockfish grading is available.

After the calibration game:

- The app seeds a per-dimension skill model (tactics, openings, endgames, calculation) from the calibration score.
- Every graded move afterwards updates the relevant dimensions with an exponentially weighted average, so calibration never stops.
- Game results nudge ratings toward the expected score against the opponent's Elo.
- Recent wins push opponent strength slightly higher; recent losses lower it.
- Learner moves receive visual quality cues after analysis completes.

Current bot behavior:

- If Stockfish loads, the app limits its strength with `UCI_LimitStrength`/`UCI_Elo` (and `Skill Level` at the low end) so weak settings blunder like people instead of playing shallow-but-perfect chess.
- If Stockfish does not load, the heuristic engine ranks legal moves and chooses from a wider or narrower candidate pool based on that same strength.
- The main UI does not expose depth controls; the app controls opponent strength from the skill model and player history.

## Product Goal

Build a personal chess teacher for one user. The teacher should:

- Play competitive games at an adjustable level.
- Adapt its coaching to the moves you actually play.
- Detect what you are doing wrong.
- Explain mistakes in plain chess language.
- Show candidate moves you should have considered.
- Teach openings, tactics, plans, and endgames through your own games.
- Track recurring weaknesses over time.
- Turn mistakes into practice positions.

This is a large product if built as a polished commercial platform, but it is manageable as a personal MVP when built in layers.

## Ultimate Chess Teacher Target

The app becomes an "ultimate chess teacher" when it can combine engine truth, personal history, and a serious training loop:

- Engine-grounded review: reliable Stockfish analysis, best alternatives, principal variations, mate-aware scoring, and review screens that explain what changed after each important move.
- Rich motif detection: forks, pins, skewers, discovered attacks, overloaded defenders, back-rank problems, trapped pieces, poor trades, and missed tactics.
- Real learning loop: spaced repetition, retry queues from your own games, success/failure tracking, and difficulty progression.
- Adaptive curriculum: opening repertoire pages, endgame modules, pawn-structure plans, Skill Lab progress, and recommendations based on repeated personal mistakes.
- Stronger player model: separate opening, tactics, calculation, endgame, conversion, and habit weaknesses with trend tracking over time.
- Better teaching UX: arrows, highlights, variation replay, move trees, clear turning points, and coaching that asks useful questions instead of only lecturing.

The analysis foundation is now in place. The next implementation priorities are deeper replay tools, a stronger curriculum loop, and more specific player modeling.

## How It Learns

### Openings

The app learns openings by storing the opening phase of each game:

- It saves PGN, FEN, move history, player color, result, and engine level.
- It matches early SAN move sequences against a small starter opening map.
- It records where you leave known opening patterns.
- It tracks opening-specific mistakes, such as moving the queen too early, delaying castling, neglecting the center, or moving the same piece repeatedly.
- It builds a personal repertoire profile from repeated games.

Over time, this allows the teacher to say things like:

- You often reach this structure from the Italian Game.
- You delay castling in this opening.
- You leave theory here and then lose time finding a plan.
- You should review this recurring position.

### Tactics

The app learns tactical weaknesses from your positions:

- It scans legal moves for checks, captures, promotions, threats, and forcing moves.
- It detects missed candidate moves using tactical heuristics immediately.
- When Stockfish is available, it can compare your move against engine best moves and evaluation swings.
- It tags positions by motif: loose piece, missed mate, missed fork, pin, skewer, line tactic, discovered attack, overloaded defender, back-rank issue, mate threat, and poor trade.
- It converts your mistakes into retryable exercises.

The important part is that practice comes from your actual games first, not random puzzle feeds.

### Plans And Plays

The app learns plans by classifying position themes:

- Opening: center control, development, king safety, early queen moves, repeated piece moves.
- Middlegame: piece activity, weak squares, open files, pawn breaks, threats, trades, initiative.
- Endgame: king activity, passed pawns, rook activity, conversion, simplification.

The coach does not only show the engine move. It explains candidate move families:

- Checks, captures, and threats.
- Improve the worst piece.
- Castle or improve king safety.
- Contest an open file.
- Trade into a better endgame.
- Stop the opponent's threat.

### Personal Weakness Profile

The app keeps a profile of recurring issues:

- Category
- Count
- Severity
- Last seen date
- Recent examples
- Linked practice positions
- Improvement trend

Practice priority is based on frequency, severity, and recency. A frequent small issue and a rare severe blunder can both surface, but for different reasons.

### OpenAI Personal Coach

When `OPENAI_API_KEY` is configured and the server can reach OpenAI, the app runs a conversational coach through `/api/coach/chat`. Each request carries:

- The compacted chat transcript for the current game.
- Coach memory: durable notes about how you think plus recent reasoning traces (your answers to "what was your plan?").
- The per-dimension skill snapshot with next-level guidance per dimension.
- Top recurring weaknesses.
- Current FEN, recent moves, phase, opening, and the triggering moment (blunder, turning point, review moment) with engine data.
- App-generated candidate moves, so the model never invents illegal moves.

The coach replies conversationally, can ask you one question at a time (answers are stored as reasoning traces), offers a rethink before the bot replies to a serious blunder, and drives the guided post-game review. It stays silent during the calibration game.

## MVP Features

- Play a full chess game in the browser.
- Choose player color.
- Play one calibration game that seeds the skill model and unlocks the personal coach.
- Use Stockfish when available, with a heuristic fallback opponent when it is not.
- Show legal move highlights.
- Show post-calibration move-quality cues after each learner move.
- Track move history and PGN.
- Detect common beginner/intermediate mistakes.
- Generate candidate moves for the current position.
- Create practice positions from mistakes.
- Show a weakness profile.
- Include Skill Labs tied to common weakness categories.
- Store data locally by default.
- Sync games, moves, positions, weaknesses, and practice attempts to Supabase when configured.
- Erase local history from Settings; optionally expose a test-only Supabase history wipe with `ENABLE_REMOTE_HISTORY_ERASE=true`.

## Architecture

```text
Browser UI
  |
  |-- chess.js
  |     Legal moves, FEN, PGN, move history
  |
  |-- Engine adapter
  |     Stockfish worker if available
  |     Heuristic fallback if unavailable
  |
  |-- Coach layer
  |     Candidate moves
  |     Mistake tags
  |     Weakness profile
  |     Practice generation
  |
  |-- Supabase Auth (identity only)
  |     Email sign-in, session tokens
  |
  |-- Node server (/api)
        OpenAI coach endpoints (server-side API key)
        /api/sync + account endpoints (service-role Supabase access,
        token verification, user_id stamping, per-user rate limits)
        Local storage remains the in-browser cache
```

## Supabase Data Model

The schema lives in `supabase/schema.sql` (fresh installs) and `supabase/migrations/` (upgrades).

Every user-data table carries `user_id uuid references auth.users`, RLS is enabled with no policies, and grants are revoked from `anon`/`authenticated`: only the server's service role can touch data. Per-user uniqueness replaces the old single-user keys (`weaknesses (user_id, category)`, `skill_ratings (user_id, dimension)`, `repertoire_progress (user_id, line_id)`).

Main tables:

- `games`: one row per played game.
- `moves`: move-by-move history, FENs, classifications, tags, engine evals, best alternatives, principal variations, and move-quality cues.
- `positions`: important positions extracted from games.
- `weaknesses`: aggregate personal weakness profile.
- `weakness_events`: each detected weakness occurrence.
- `lessons`: curriculum-ready lesson metadata.
- `exercises`: practice positions linked to weaknesses or lessons.
- `practice_attempts`: attempts on generated or curated exercises.

Accounts are live: each user's history is isolated by `user_id`, enforced server-side.

## Coaching Strategy

The teacher should avoid dumping raw engine lines. The useful coaching flow is:

1. Identify the main decision point.
2. Explain the idea in human terms.
3. Show candidate moves to consider.
4. Explain why the played move was risky.
5. Create a small practice task from the position.
6. Update the weakness profile.

The current implementation combines immediate heuristics with Stockfish analysis when available. Later versions should deepen this with variation replay, richer tactic detection, and language-model explanations grounded in engine output.

## Skill Lab Strategy

The app is curriculum-ready, but the primary teaching surface is not a generic lesson library. It uses Skill Labs: focused board training for one skill, mixed recognition, and game-transfer retries from the user's own games.

Included now:

- Focused labs for checkmates, forks, pins, skewers, discoveries, loose pieces, king safety, opening development, trade quality, and candidate moves.
- Weakness-linked Skill Lab recommendations.
- Practice positions generated from personal games.
- Basic repetition through the practice queue.

Deferred:

- Full lesson editor.
- Rich branching move trees.
- Large curated course library.
- Polished authoring workflow.

This sequencing keeps the app focused on becoming a useful personal teacher first.

## Skill Labs Versus Practice

Skill Labs and Practice are intentionally different.

- Skill Labs let the learner intentionally train one idea, such as forks, then advance to mixed recognition and positions from their own games.
- Practice is the adaptive daily queue: personal mistakes first, then foundation drills.

This keeps teaching close to the board. The app still has concept text, but it appears just in time inside Coach, Review, Skill Labs, and Practice rather than as a browsing-heavy course catalog.

Current Skill Lab foundations:

- Checkmates
- Forks
- Pins and line tactics
- Skewers
- Discovered attacks
- Loose pieces and trades
- King safety and opening development

Recommended practice is still personalized from your games first. The foundation boards fill in tactical and opening habits when there are not enough personal positions yet.

The app keeps a priority queue for Skill Labs and practice. Priority is based on:

- Recurring weakness count and severity.
- Recent mistakes from the current game.
- Missed practice attempts.
- Practice positions waiting from your own games.
- Solved practice, which lowers priority for that category.

Clicking a Skill Lab selects it and shows why it matters now. Focus boards isolate the pattern, mixed boards test recognition, and game-transfer boards retry positions from review.

## Testing Plan

Manual checks:

- Play a legal full game.
- Confirm castling, promotion, checkmate, stalemate, and draw handling through `chess.js`.
- Confirm illegal moves are rejected.
- Confirm the engine or fallback opponent replies after player moves.
- Confirm mistake tags appear after risky moves.
- Confirm post-calibration move-quality cues appear on learner moves and do not appear during the calibration game.
- Confirm engine evals, best alternatives, short principal variations, and played/best move highlights appear in Review when Stockfish is available.
- Confirm practice positions are generated from mistakes.
- Confirm local profile updates after repeated mistakes.
- Confirm Supabase configuration saves and sync attempts succeed after schema setup.

Future automated checks:

- Known tactical FENs classify expected motifs.
- Known opening lines map to expected opening names.
- Supabase inserts use the expected payload shape.
- Engine analysis fields normalize correctly, including mate scores.
- Practice queue deduplicates repeated positions.
- Engine adapter handles timeout and fallback.

## What Is Left To Build

The biggest remaining work is turning strong analysis into a complete training system:

- Variation replay: clickable engine lines, arrows, step-through branches, and "show continuation" controls.
- Stronger quality labels: reliable brilliant/great detection using sacrifice, only-move, and engine-verification criteria.
- Deeper motif detection: discovered attacks, overloaded defenders, trapped pieces, back-rank weaknesses, deflection, decoy, and clearance.
- Spaced repetition: scheduled retry queues, due dates, mastery states, and per-theme retention tracking.
- Player model: separate ratings for openings, tactics, calculation, endgames, conversion, time management, and recurring habits.
- Curriculum pages: opening repertoire, endgame modules, pawn-structure plans, lesson completion, and next-lesson recommendations.
- Practice analytics: solve streaks, repeated miss tracking, trend charts, and improvement summaries.
- Teaching polish: better arrows/highlights, mistake comparison cards, coach questions, and cleaner mobile/tablet layouts.
- Data hardening: migrations tooling, backup/restore, and more automated sync tests. (Auth, RLS lockdown, and per-user isolation shipped.)

## Roadmap

### Phase 1: Personal MVP

- Browser chessboard.
- Engine opponent.
- Move history and PGN.
- Heuristic coach.
- Weakness profile.
- Practice queue.
- Supabase persistence.

### Phase 2: Stronger Analysis

- Reliable bundled Stockfish assets with CDN and heuristic fallbacks.
- Evaluation-before and evaluation-after comparison, including mate-aware scoring.
- Persisted engine analysis fields for move review and long-term learning.
- Best engine alternatives and short principal variations in the review screen.
- Better tactic motif detection and more accurate blunder/mistake/inaccuracy labels.
- Post-calibration move-quality cues during play.

### Phase 3: Adaptive Curriculum

- Repetition scheduling.
- Lesson completion tracking.
- Opening repertoire pages.
- Endgame modules.
- Drill performance trends.

### Phase 4: Authoring And Polish

- Lesson authoring UI.
- Branching move trees.
- Rich lesson templates.
- Lesson quality checks.
- Better visual review tools.

## Implementation Notes

- The current app is static and intentionally avoids a build step.
- `index.html`, `styles.css`, and `app.js` are the whole runnable app; `server.js` serves it and owns every secret.
- Stockfish is loaded from bundled files in `vendor/stockfish` first, then jsDelivr. If both fail, the app falls back to a heuristic opponent.
- The browser holds no database credentials. Supabase Auth issues session tokens (via the server-provided publishable key); the server verifies each token and performs all database access with the service role key. Local storage is a per-account cache, namespaced by user id.
