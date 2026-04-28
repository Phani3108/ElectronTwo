/**
 * Prompt builder — assembles the four-tier prompt used by the LLM orchestrator.
 *
 * Tiers:
 *   1 (stable, cache_control): system identity + voice samples  — changes rarely
 *   2 (stable, cache_control): active role/company context      — per session
 *   3 (per-turn): retrieved story chunks + recent Q&A turns     — every question
 *   4 (per-turn): the current question
 *
 * Output format follows Anthropic's messages API, with `cache_control` markers
 * on tiers 1 and 2 so the API caches the stable prefix (≥1024 tokens) and only
 * reads/writes the variable suffix each turn.
 *
 * Length policy: live-call interview answers should run ~3–4 minutes spoken
 * (~350–500 words / 8–12 sentences). When a prepared story matches the
 * question, deliver its answer near-verbatim AS THE SPINE and naturally expand
 * with concrete detail (project, company, metric, situation, decision,
 * trade-off, outcome, learning). Never compress to 3 lines.
 */

const BASE_INSTRUCTIONS = `You are my live-call copilot for an interview that's happening RIGHT NOW. You answer questions AS ME, in the first person, using my real projects, metrics, and voice.

How to answer (read carefully — interviews are scored on depth, not brevity):

LENGTH AND PACE
- Aim for 350–500 words per answer (~3–4 minutes when spoken). 8–12 sentences typical.
- Don't end after 3 short lines. The interviewer expects substance and specificity.
- One short paragraph is fine, two is better, three when the question warrants depth.
- No bullet lists in the spoken answer (this is a conversation, not a slide). Connectors like "first… then… and finally…" are great.

STRUCTURE
- Open with a one-sentence framing of the situation or stance.
- Walk through what I did concretely: what was happening, what I decided, why, what trade-off was in play, who pushed back and how I handled it.
- Land on the outcome with one or two specific details (a number, a time-frame, a behavioral change).
- Close with the one-line lesson or principle.

GROUNDING
- If a retrieved story's "Q:" closely matches the asked question, deliver THAT story's answer as the spine. Do not paraphrase it away — that text was written deliberately. Naturally expand any short sentence into 2–3 sentences with concrete detail you can faithfully infer (situation context, decision rationale, trade-off, what the team felt, what the next quarter looked like).
- When a story has concrete details (project, company, metric, year), name them. Do not invent numbers if a story is qualitative.
- If retrieved stories don't cover the question, answer from general experience without inventing numbers.

VOICE
- Match the cadence of the voice samples — same kind of sentences, same sharpness, same use of "I" + concrete claims.
- Never preamble ("Great question…", "Sure, I can talk about…"). Start with the answer.
- Never mention that you are an AI, a copilot, or that you have source material.`;

export function buildAnthropicPayload({ profile, retrievedStories, recentTurns, question, notesBlock = '', maxTokens = 1500 }) {
  const identityBlock = [
    `# Identity`,
    profile.identity?.trim() || '(no identity.md set)',
    ``,
    `# Voice samples — imitate this cadence and structure`,
    profile.voice?.trim() || '(no voice-samples.md set)',
  ].join('\n');

  const roleBlock = [
    `# Active role / company context`,
    profile.role?.trim() || '(no role.md set)',
    notesBlock ? `\n# Live notes from this session\n${notesBlock}` : '',
  ].filter(Boolean).join('\n');

  const turnsBlock = recentTurns.length > 0
    ? [
        `# Recent conversation (most recent last) — do NOT repeat these answers verbatim; reference them only if asked.`,
        ...recentTurns.map(t => `Q: ${t.question}\nA: ${t.answer}`),
      ].join('\n\n')
    : '';

  const retrievedBlock = retrievedStories.length > 0
    ? [
        `# Relevant prepared stories (USE THE TOP MATCH AS THE SPINE)`,
        `(If the top story's "Q:" matches the asked question well, deliver its prepared "A:" near-verbatim as the spine, then expand with concrete detail to reach 350–500 words. Cite the project / company / metric.)`,
        ...retrievedStories.map((s, i) => `## Story ${i + 1} — ${s.id} (score ${s.score.toFixed(2)})\n${s.content}`),
      ].join('\n\n')
    : '# Relevant prepared stories\n(none retrieved; answer from general experience without inventing numbers — still target 350–500 words)';

  const system = [
    { type: 'text', text: BASE_INSTRUCTIONS + '\n\n' + identityBlock, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: roleBlock, cache_control: { type: 'ephemeral' } },
  ];

  const userContent = [
    turnsBlock,
    retrievedBlock,
    `# Question\n${question}\n\n# Reminder\nTarget 350–500 words. Open with the situation, walk through the decision and trade-off, land with concrete outcome, close with the one-line lesson. Do NOT cut short.`,
  ].filter(Boolean).join('\n\n');

  return {
    system,
    messages: [{ role: 'user', content: userContent }],
    max_tokens: maxTokens,
    temperature: 0.7,
  };
}
