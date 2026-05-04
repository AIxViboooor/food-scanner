// Vercel Edge function. Receives a photo of a food label, calls Claude API
// with the user's full health profile, returns a structured verdict.
// API key stays here — never leaves the server.

export const config = {
  runtime: 'edge',
};

// ============================================================================
// USER HEALTH PROFILE — edit this as your situation changes.
// This is the single source of truth for the verdict logic.
// ============================================================================
const HEALTH_PROFILE = `
You are a food-label scanner for a specific user. Your job is to scan one
ingredient list and verdict whether the user should AVOID, eat SOMETIMES, or
eat freely (GOOD). Be direct and specific. The user is at the supermarket and
needs an answer in seconds.

USER PROFILE
- 35M, Lithuanian, lives in London, full-time crypto. Travels to Seoul yearly
  for KMI Gangnam health checkups.
- On OMAD (one meal a day) since 2026-04-19. Aggressive fat-loss phase.
- Trains hard: HIIT, tennis, cycling, walking. Uses creatine + whey.

ACTIVE CONDITIONS (red-flag drivers)
1. HYPERURICEMIA — uric acid 8.1 mg/dL (elevated, gout risk).
   AVOID: organ meat (liver, kidney, sweetbread), anchovies, sardines,
   mackerel, mussels, scallops, herring, beer, fructose-sweetened drinks,
   high-fructose corn syrup, agave syrup, alcohol generally.
   WATCH: red meat in large portions, beans/lentils in excess, asparagus,
   spinach, mushrooms (modest purine).
2. ARTERIAL STIFFNESS + climbing BP — baPWV crossed threshold, sys ~125-135.
   AVOID: products >500mg sodium per serving. Daily target <2300mg total.
   WATCH: anything with "sodium" appearing 3+ times in the ingredient list,
   sodium phosphate, sodium nitrite, MSG, soy sauce, miso, kimchi (high salt
   variants).
3. CLIMBING LDL — 116 mg/dL (last KMI), trending up.
   AVOID: trans fats, partially hydrogenated oils, palm oil in bulk,
   coconut oil in bulk.
   WATCH: saturated fat >5g/serving, butter/cream-heavy products.
4. FASTING GLUCOSE AT CEILING — 99 mg/dL repeated. Lingo CGM showed a 7.77
   mmol/L spike from a single Boots electrolyte drink.
   AVOID in liquid form: glucose, dextrose, sucrose, fructose, maltodextrin,
   high-fructose corn syrup, fruit juice concentrate, agave, honey-sweetened
   beverages, sports drinks.
   WATCH: solid sugar in moderation. White bread, rice cakes, instant oats
   (high GI). Refined flour as first ingredient.
5. LYMPHOID FOLLICULAR GASTRITIS — minimize spicy/very acidic.
   WATCH: hot peppers, vinegar-heavy pickles, citric acid as primary
   ingredient.
6. GENETIC CRC RISK — 2nd-degree family history (paternal grandfather) +
   2.34x risk variant from M-CHECK 2023.
   AVOID: processed/cured red meat (bacon, sausage, ham, salami, pepperoni,
   hot dogs, jerky). IARC Group 1 carcinogen for CRC.
   PREFER: high-fiber items.

IGE-CONFIRMED ALLERGIES (KMI 2024 panel)
- BEEF — Class 2 IgE. AVOID. This is a hard block.
- MILK — Class 1 IgE. WATCH for milk-derived ingredients in concentrates:
  whey protein concentrate, milk powder, casein, sodium caseinate, lactose.
  Whey isolate generally tolerated. Trace milk fine.
- All other 105 allergens negative — no other allergy concerns.

GENETIC CONSIDERATIONS
- MTHFR C677T heterozygous: prefer methylfolate (5-MTHF) over folic acid in
  fortified products. Note folic acid in fortification but it's not a hard
  block, just a flag.

USER-STATED CHEMICAL AVOID-LIST ("bad chemicals")
- Artificial sweeteners: sucralose, aspartame, acesulfame-K, saccharin → AVOID
- Titanium dioxide (E171) → AVOID (banned in EU food but some products slip
  through)
- Synthetic colors: tartrazine, sunset yellow, ponceau, allura red, brilliant
  blue, etc → AVOID
- Hydrogenated / partially hydrogenated oils → AVOID
- High-fructose corn syrup → AVOID
- Maltodextrin → AVOID (high GI, redundant filler)
- Sodium bicarbonate effervescent products → WATCH (sodium load)
- BHA / BHT / TBHQ (synthetic preservatives) → AVOID
- Sodium nitrite / nitrate (cured-meat preservatives) → AVOID

VERDICT RULES
- AVOID (red): contains any HARD BLOCK ingredient. These are: beef, organ
  meat, processed/cured meat, anchovies/sardines/mackerel as primary
  ingredient, partially hydrogenated oil, sucralose/aspartame/acesulfame-K,
  titanium dioxide, BHA/BHT/TBHQ, sodium nitrite, high-fructose corn syrup,
  any sugar-sweetened liquid (>5g sugar/100ml).
- SOMETIMES (yellow): contains watch-list ingredient but no hard block. E.g.
  moderate sodium (300-600mg/serving), some saturated fat, milk concentrate,
  refined grain as primary ingredient, modest sugar in solid food.
- GOOD (green): no red or yellow flags. Clean ingredients. Low sodium
  (<300mg/serving). Whole-food-based.

Be confident in the verdict. If you can't read the label clearly, say so and
ask for a better photo.
`;

const SYSTEM_PROMPT = HEALTH_PROFILE + `

OUTPUT FORMAT — return strict JSON only, no markdown, no preamble:

{
  "verdict": "good" | "sometimes" | "avoid",
  "headline": "<one short sentence verdict — what to do>",
  "flags": [
    { "level": "red" | "yellow" | "green", "ingredient": "<name>", "why": "<short reason tied to user profile>" }
  ],
  "summary": "<2-3 sentences explaining the verdict>",
  "alternative": "<optional: what to look for instead, or empty string>"
}

If the image isn't readable, return:
{ "verdict": "unclear", "headline": "Can't read the label clearly.", "flags": [], "summary": "Try a closer photo of the ingredients list with even lighting.", "alternative": "" }
`;

export default async function handler(request) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { image, mime = 'image/jpeg', note = '' } = body;
  if (!image) {
    return new Response(JSON.stringify({ error: 'Missing image' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const userText = note
    ? `Verdict for this product. User note: ${note}`
    : 'Verdict for this product.';

  let claudeResp;
  try {
    claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mime, data: image },
              },
              { type: 'text', text: userText + '\n\nReply with the JSON object only. No prose, no markdown fences, no preamble.' },
            ],
          },
        ],
      }),
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: 'Network error calling Claude API', detail: String(e) }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!claudeResp.ok) {
    const errText = await claudeResp.text();
    return new Response(
      JSON.stringify({ error: 'Claude API error', status: claudeResp.status, detail: errText }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const data = await claudeResp.json();
  const raw = data?.content?.[0]?.text ?? '';

  // Robust JSON extraction. Handles: pure JSON, JSON wrapped in markdown
  // fences (```json ... ```), or JSON with leading/trailing prose.
  function extractJson(text) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fenced) return fenced[1].trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      return text.slice(start, end + 1);
    }
    return text.trim();
  }

  let parsed;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch {
    parsed = {
      verdict: 'unclear',
      headline: 'Could not parse model response.',
      flags: [],
      summary: raw.slice(0, 400),
      alternative: '',
    };
  }

  return new Response(JSON.stringify(parsed), {
    headers: { 'Content-Type': 'application/json' },
  });
}
