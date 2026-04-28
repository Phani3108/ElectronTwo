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
 * reads/writes the variable suffix each turn. Expected effect: ~5× faster TTFT
 * after first call, ~90% cost reduction on tier 1/2 bytes.
 *
 * Why few-shot voice samples instead of rules: prescribed structure in the
 * system prompt (e.g., "always 5 bullets, first bullet must be a metric")
 * makes answers robotic. Examples teach cadence better than any rule.
 */

const BASE_INSTRUCTIONS = `You are my live-call copilot. You answer questions AS ME, in the first person, using my real projects, metrics, and voice.

Rules you must follow:
- Answer only the question. Don't summarize; don't preamble.
- Match the cadence and length of the voice samples below — same kind of sentences, same sharpness.
- If a retrieved story's "Question pattern" closely matches the asked question, prefer delivering its prepared answer near-verbatim — that text was written deliberately. Light edits to fit the exact phrasing of the question are fine; do not rewrite it.
- When a story has concrete details (project, company, metric), name them. If the story is qualitative, do not invent numbers.
- If the retrieved stories don't cover the question, say so briefly and answer from general experience — do not invent numbers.
- Never mention that you're an AI, a copilot, or that you have source material.`;

export function buildAnthropicPayload({ profile, retrievedStories, recentTurns, question, notesBlock = '', maxTokens = 700 }) {
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
        `# Recent conversation (most recent last)`,
        ...recentTurns.map(t => `Q: ${t.question}\nA: ${t.answer}`),
      ].join('\n\n')
    : '';

  const retrievedBlock = retrievedStories.length > 0
    ? [
        `# Relevant stories retrieved for this question`,
        `(Use one as the primary anchor. Cite the project/company/number.)`,
        ...retrievedStories.map((s, i) => `## Story ${i + 1} — ${s.id} (score ${s.score.toFixed(2)})\n${s.content}`),
      ].join('\n\n')
    : '# Relevant stories retrieved for this question\n(none retrieved; answer from general experience without inventing numbers)';

  // System blocks — tier 1 cached, tier 2 cached.
  const system = [
    { type: 'text', text: BASE_INSTRUCTIONS + '\n\n' + identityBlock, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: roleBlock, cache_control: { type: 'ephemeral' } },
  ];

  // Tier 3 + 4 fold into the user message — variable per turn, uncached.
  const userContent = [
    turnsBlock,
    retrievedBlock,
    `# Question\n${question}`,
  ].filter(Boolean).join('\n\n');

  return {
    system,
    messages: [{ role: 'user', content: userContent }],
    max_tokens: maxTokens,
    temperature: 0.7,
  };
}
