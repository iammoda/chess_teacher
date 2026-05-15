# Personal Chess Teacher

A local web app for a personal chess teacher that can play against you, review your games, explain mistakes, track weaknesses, and turn your own mistakes into targeted practice.

The app does not try to learn chess from scratch. It combines proven chess tools with a personal learning profile:

- `chess.js` handles legal moves, PGN, FEN, and game state.
- Stockfish is used when available for engine-grade move selection and analysis.
- Supabase stores long-term games, positions, weaknesses, lessons, and practice history.
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

The app works without Supabase by using browser local storage. Supabase project `kajifmxqfcceibwredjf` is prefilled as `https://kajifmxqfcceibwredjf.supabase.co`, and the browser-safe publishable key is configured. The schema has been applied; use the Settings tab to test the connection if sync looks wrong.

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
PORT=5173
```

Start the app:

```sh
npm start
```

The Node server serves the app and exposes `/api/coach`. The browser sends chess context to that endpoint; the server adds the API key and calls OpenAI.

## Placement And Bot Difficulty

The app now starts with placement instead of pretending it knows the player immediately.

Placement uses the first five completed games. Internally, the opponent steps up across those games:

- Game 1: very light opponent
- Game 2: light opponent
- Game 3: balanced opponent
- Game 4: challenging opponent
- Game 5: strongest placement test

During those games, the app records result, player color, opening, opponent strength, move classifications, tagged mistakes, and mistake severity. The OpenAI personal coach stays locked until placement is complete so advice is based on real history instead of a single move.

After placement:

- The app estimates a training score from placement performance and mistake severity.
- Opponent strength becomes adaptive instead of manually chosen.
- Recent wins push opponent strength slightly higher.
- Recent losses or high-severity mistakes lower opponent strength slightly.
- Practice difficulty stays tied to the weakness queue, not only to bot strength.

Current bot behavior:

- If Stockfish loads, the app asks Stockfish for a move at the current placement/adaptive strength.
- If Stockfish does not load, the heuristic engine ranks legal moves and chooses from a wider or narrower candidate pool based on that same strength.
- The main UI does not expose depth controls; the app controls opponent strength from placement and player history.

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
- It tags positions by motif: loose piece, fork, pin, skewer, discovered attack, overloaded defender, back-rank issue, mate threat, and poor trade.
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

When `OPENAI_API_KEY` is configured, the app sends a compact coaching context to `/api/coach`:

- Current FEN, PGN, side to move, phase, and opening.
- Placement progress, estimated score, and current adaptive opponent strength.
- Legal candidate moves generated by `chess.js`.
- Recent moves with notes, classifications, and tags.
- Recurring weakness profile.
- Practice queue and practice history.
- Selected lesson or active drill.
- Available practice modules.

OpenAI returns a personalized summary, plan, candidate explanations, weakness focus, and practice recommendations. That response is centered on how you actually play rather than generic lesson text, and it unlocks after the placement games provide enough evidence.

## MVP Features

- Play a full chess game in the browser.
- Choose player color.
- Play five placement games that calibrate bot difficulty and unlock the personal coach.
- Use Stockfish when available, with a heuristic fallback opponent when it is not.
- Show legal move highlights.
- Track move history and PGN.
- Detect common beginner/intermediate mistakes.
- Generate candidate moves for the current position.
- Create practice positions from mistakes.
- Show a weakness profile.
- Include starter lessons tied to common weakness categories.
- Store data locally by default.
- Sync games, moves, positions, weaknesses, and practice attempts to Supabase when configured.

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
  |-- OpenAI coach endpoint
  |     Server-side API key
  |     Personalized plan and explanations
  |
  |-- Persistence layer
        Local storage fallback
        Supabase sync when configured
```

## Supabase Data Model

The schema lives in `supabase/schema.sql`.

Configured project:

- Project ref: `kajifmxqfcceibwredjf`
- API URL: `https://kajifmxqfcceibwredjf.supabase.co`
- Client key: publishable browser key configured in `app.js`

Main tables:

- `games`: one row per played game.
- `moves`: move-by-move history, FENs, classifications, and tags.
- `positions`: important positions extracted from games.
- `weaknesses`: aggregate personal weakness profile.
- `weakness_events`: each detected weakness occurrence.
- `lessons`: curriculum-ready lesson metadata.
- `exercises`: practice positions linked to weaknesses or lessons.
- `practice_attempts`: attempts on generated or curated exercises.

This keeps the first version personal-only while leaving room for auth later.

## Coaching Strategy

The teacher should avoid dumping raw engine lines. The useful coaching flow is:

1. Identify the main decision point.
2. Explain the idea in human terms.
3. Show candidate moves to consider.
4. Explain why the played move was risky.
5. Create a small practice task from the position.
6. Update the weakness profile.

The first implementation uses immediate heuristics and optional Stockfish support. Later versions should deepen this with engine evaluation deltas, richer tactic detection, and language-model explanations grounded in engine output.

## Curriculum Strategy

The app is curriculum-ready from day one, but it does not start with a full lesson authoring studio.

Included now:

- Starter lessons for common chess improvement areas.
- Weakness-linked lesson recommendations.
- Practice positions generated from personal games.
- Basic repetition through the practice queue.

Deferred:

- Full lesson editor.
- Rich branching move trees.
- Lesson versioning.
- Large curated course library.
- Polished authoring workflow.

This sequencing keeps the app focused on becoming a useful personal teacher first.

## Lessons Versus Practice

Lessons and practice are intentionally different.

- Lessons explain a concept, connect it to your recent games, and can launch an interactive board lesson.
- Practice is where you drill the skill on the board until you can execute it.

This follows the pattern used by major chess trainers: Chess.com Practice separates openings, drills, master games, and custom positions, while lessons teach concepts and include challenges. Lichess Practice organizes concrete drills by checkmates, tactics, pawn endgames, and rook endgames.

Current practice modules:

- Four-move checkmate
- Defending four-move checkmate
- Queen and king checkmate
- Back-rank mate
- Italian Game development
- Queen's Gambit development

Recommended practice is still personalized from your games first. The general library fills in foundational skills like checkmating patterns, opening traps, tactics, and opening plans.

The app keeps a priority queue for lessons and practice. Priority is based on:

- Recurring weakness count and severity.
- Recent mistakes from the current game.
- Missed practice attempts.
- Practice positions waiting from your own games.
- Solved practice, which lowers priority for that category.

Clicking a lesson selects it and shows why it matters now. Starting the interactive lesson changes the board position and walks you through the move. Clicking a practice tile starts that drill directly on the board.

## Starter Lessons

The app includes lightweight starter lessons for:

- Loose pieces
- Checks, captures, and threats
- Opening principles
- King safety
- Poor trades
- Candidate moves

Each lesson is tied to one or more weakness categories so the coach can recommend it after real games.

## Testing Plan

Manual checks:

- Play a legal full game.
- Confirm castling, promotion, checkmate, stalemate, and draw handling through `chess.js`.
- Confirm illegal moves are rejected.
- Confirm the engine or fallback opponent replies after player moves.
- Confirm mistake tags appear after risky moves.
- Confirm practice positions are generated from mistakes.
- Confirm local profile updates after repeated mistakes.
- Confirm Supabase configuration saves and sync attempts succeed after schema setup.

Future automated checks:

- Known tactical FENs classify expected motifs.
- Known opening lines map to expected opening names.
- Supabase inserts use the expected payload shape.
- Practice queue deduplicates repeated positions.
- Engine adapter handles timeout and fallback.

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

- Reliable bundled Stockfish assets.
- Evaluation-before and evaluation-after comparison.
- Better tactic motif detection.
- Review screen with turning points.
- More accurate blunder/mistake/inaccuracy labels.

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
- `index.html`, `styles.css`, and `app.js` are the whole runnable app.
- Stockfish is loaded opportunistically from jsDelivr. If browser security or network conditions prevent it, the app falls back to a heuristic opponent.
- Supabase credentials are stored in browser local storage for this personal MVP. Do not use this model for a public multi-user app without proper auth and security rules.
