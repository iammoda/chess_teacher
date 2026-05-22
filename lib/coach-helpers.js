function validateCoachPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "Coach payload must be a JSON object.";
  }
  if (typeof payload.context !== "string") {
    return "Coach payload is missing a context string.";
  }
  if (!payload.currentPosition || typeof payload.currentPosition.fen !== "string") {
    return "Coach payload is missing the current position.";
  }
  return null;
}

function stripJsonFence(text) {
  return String(text || "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function extractOutputText(data) {
  if (data.output_text) return data.output_text;
  const parts = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.text) parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

function normalizeCoachResponse(text) {
  try {
    const parsed = JSON.parse(stripJsonFence(text));
    return {
      configured: true,
      summary: String(parsed.summary || "No summary returned."),
      plan: String(parsed.plan || ""),
      candidate_explanations: Array.isArray(parsed.candidate_explanations)
        ? parsed.candidate_explanations.slice(0, 5)
        : [],
      weakness_focus: String(parsed.weakness_focus || ""),
      practice_recommendations: Array.isArray(parsed.practice_recommendations)
        ? parsed.practice_recommendations.slice(0, 4)
        : [],
    };
  } catch {
    return {
      configured: true,
      summary: text || "OpenAI returned an empty response.",
      plan: "",
      candidate_explanations: [],
      weakness_focus: "",
      practice_recommendations: [],
    };
  }
}

function buildCoachPrompt(payload) {
  return `You are a personal chess teacher for one user.

Your job is to tailor coaching to how this user plays, not give generic chess advice.
Use the provided current position, recent moves, candidate moves, tagged mistakes, profile, practice history, and selected lesson/drill.

Rules:
- Do not invent illegal moves. Candidate moves are provided by the app; prefer explaining those.
- If the user repeatedly makes a mistake, explicitly connect today's advice to that pattern.
- Teach the plan: what the player should look for, why it matters, and what to practice next.
- Keep language direct and concrete.
- Return only valid JSON with this exact shape:
{
  "configured": true,
  "summary": "1-2 sentence personalized read of the current moment",
  "plan": "2-4 sentence plan tailored to this user's games",
  "candidate_explanations": [{"move":"SAN or UCI","reason":"why this move should be considered"}],
  "weakness_focus": "one recurring weakness or strength to focus on",
  "practice_recommendations": ["specific drill or lesson", "specific drill or lesson"]
}

Context:
${JSON.stringify(payload, null, 2)}`;
}

module.exports = {
  validateCoachPayload,
  stripJsonFence,
  extractOutputText,
  normalizeCoachResponse,
  buildCoachPrompt,
};
