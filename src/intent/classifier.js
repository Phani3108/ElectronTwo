/**
 * Intent classifier — rule-based, fast, deterministic.
 *
 * Runs on final transcripts (and optionally interim). Returns:
 *   { isQuestion, toMe, urgency, confidence, reasons }
 *
 * Why not an LLM classifier: latency budget. This runs on every final
 * transcript and must return in <5ms. LLM classifier is a later upgrade
 * behind a feature flag.
 *
 * The auto-draft policy in the orchestrator uses confidence:
 *   confidence >= 0.75  → auto-draft after 400ms silence
 *   confidence >= 0.4   → queue draft, wait for spacebar
 *   otherwise           → ignore
 */

const QUESTION_STARTERS = [
  'who', 'what', 'when', 'where', 'why', 'how',
  'tell me', 'walk me', 'describe', 'explain',
  'share', 'give me', 'talk about', 'what about',
  'can you', 'could you', 'would you', 'do you',
  'have you', 'is there', 'are there',
];

const TO_ME_HINTS = [
  'tell me about',
  'walk me through',
  'describe your',
  'your experience',
  'your approach',
  'your perspective',
  'have you ever',
  'a time you',
  'a time when you',
  'you mentioned',
  'you said',
];

// Phrases that usually indicate filler / not a real question
const FILLER_HINTS = [
  'you know',
  'i mean',
  'sort of',
  'kind of',
  'like i said',
];

export function classifyIntent(text) {
  const t = (text || '').trim().toLowerCase();
  const reasons = [];
  let score = 0;

  if (t.length < 8) return zero('too short');

  // Ends with '?' is a very strong signal
  if (t.endsWith('?')) { score += 0.5; reasons.push('ends_with_?'); }

  // Starts with a question word
  const firstFew = t.slice(0, 40);
  if (QUESTION_STARTERS.some(q => firstFew.startsWith(q) || firstFew.includes(' ' + q + ' '))) {
    score += 0.3; reasons.push('question_starter');
  }

  // "Tell me about" / "walk me through" — behavioral prompts that often lack '?'
  const toMe = TO_ME_HINTS.some(h => t.includes(h));
  if (toMe) { score += 0.25; reasons.push('to_me_hint'); }

  // Too long and rambling → likely not a crisp question
  const wordCount = t.split(/\s+/).filter(Boolean).length;
  if (wordCount > 40) { score -= 0.15; reasons.push('long_rambling'); }

  // Filler-heavy speech
  const fillerHits = FILLER_HINTS.filter(h => t.includes(h)).length;
  if (fillerHits >= 2) { score -= 0.1; reasons.push('filler'); }

  // Imperatives like "describe the..." without '?' are valid questions
  if (/^(describe|walk|tell|explain|share|give)/.test(t)) {
    score += 0.15; reasons.push('imperative_ask');
  }

  const confidence = clamp01(score);
  return {
    isQuestion: confidence >= 0.4,
    toMe,
    urgency: confidence >= 0.75 ? 'high' : confidence >= 0.4 ? 'medium' : 'low',
    confidence,
    reasons,
  };

  function zero(r) {
    return { isQuestion: false, toMe: false, urgency: 'low', confidence: 0, reasons: [r] };
  }
}

function clamp01(x) { return Math.max(0, Math.min(1, x)); }
