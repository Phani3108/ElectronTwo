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

GROUNDING — THIS IS THE PRIMARY RULE
- If a retrieved story's "Q:" matches the asked question (closely or exactly), output the prepared "A:" essentially as written. Light edits to fit the exact phrasing of the asked question are fine. Do NOT add paragraphs of new context. Do NOT expand or reorganize the prepared answer. The prepared text is the answer.
- If no prepared answer matches, answer from general experience in the same voice — without inventing numbers.

SHAPE — KEEP IT SHARP
- Exactly 3 paragraphs. Not 4. Not 5.
- ~150–250 words total (~90 seconds spoken). Sharp beats long.
- Paragraph 1: situation / stance — one or two sentences setting up the answer.
- Paragraph 2: what I did and why — the concrete decision, trade-off, or move. Name the project / company / metric when the story has them.
- Paragraph 3: outcome + one-line lesson — what changed, what I learned.

VOICE
- Match the cadence of the voice samples — same sentence rhythm, same sharpness, same first-person concrete claims.
- No bullet lists in the spoken answer. Connectors ("first… then…", "the trade-off was…") flow better.
- Never preamble ("Great question…", "Sure, I can…"). Start with the answer.
- Never mention you are an AI, a copilot, or that you have source material.`;

export function buildAnthropicPayload({ profile, retrievedStories, recentTurns, question, notesBlock = '', maxTokens = 900 }) {
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
        `# Prepared answer to use`,
        `Story 1 below is THE answer. Its "Q:" matches the asked question. Output its "A:" essentially as written — 3 paragraphs, ~150–250 words. Light wording edits to fit the exact question phrasing are fine. Do NOT swap to Story 2. Do NOT mix stories. Do NOT add new paragraphs.`,
        ...retrievedStories.map((s, i) => `## Story ${i + 1} — ${s.id} (score ${s.score.toFixed(2)})\n${s.content}`),
        retrievedStories.length > 1
          ? `\n(Story 2 is reference only — do NOT use it unless Story 1's "Q:" clearly does not match the asked question.)`
          : '',
      ].filter(Boolean).join('\n\n')
    : '# Prepared answer to use\n(no prepared answer matched; answer from general experience in the same voice — 3 paragraphs, ~150–250 words, no invented numbers)';

  const system = [
    { type: 'text', text: BASE_INSTRUCTIONS + '\n\n' + identityBlock, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: roleBlock, cache_control: { type: 'ephemeral' } },
  ];

  const userContent = [
    turnsBlock,
    retrievedBlock,
    `# Question\n${question}\n\n# Reminder\nExactly 3 paragraphs, ~150–250 words. If a prepared story matches, deliver it essentially as written — do NOT expand. Sharp, contextual, relevant.`,
  ].filter(Boolean).join('\n\n');

  return {
    system,
    messages: [{ role: 'user', content: userContent }],
    max_tokens: maxTokens,
    temperature: 0.7,
  };
}
