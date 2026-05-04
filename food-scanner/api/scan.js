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

VERDICT PHILOSOPHY (read first)
The user lives a normal life and eats normal food. Snacks are part of life.
The verdict should differentiate:
- HARD BLOCKS: ingredients that are bad even once (allergens, things on the
  chemical avoid-list, real medical triggers, Group 1 carcinogens).
- FREQUENCY RULES: ingredients that are fine occasionally but you wouldn't
  want daily (normal sugar in snacks, moderate sodium, normal saturated fat).
A chocolate bar with 15g sugar is SOMETIMES, not AVOID. A Coca-Cola IS AVOID
because liquid sugar is a different glycemic class. A salami stick is AVOID
because cured meat is Group 1 carcinogen, not because the snack format
matters. Be smart about distinguishing these.

USER PROFILE
- 35M, Lithuanian, lives in London, full-time crypto. Travels to Seoul yearly
  for KMI Gangnam health checkups.
- On OMAD (one meal a day) since 2026-04-19. Aggressive fat-loss phase.
- Trains hard: HIIT, tennis, cycling, walking. Uses creatine + whey.
- Glucose control is actually GOOD: HbA1c 4.5%, CGM mean 5.1 mmol/L, 94% time
  in range. Fasting glucose at ceiling of normal (99 mg/dL) but not diabetic.
  Solid-form sugar in normal portions doesn't spike him much.

ACTIVE CONDITIONS

1. HYPERURICEMIA — uric acid 8.1 mg/dL (elevated, gout risk).
   HARD BLOCK: organ meat (liver, kidney, sweetbread), anchovies, sardines,
   mackerel, mussels, scallops, herring as primary ingredient, beer,
   high-fructose corn syrup, agave syrup. These are real gout triggers.
   WATCH (sometimes): red meat in large portions, beans/lentils in excess
   as primary ingredient, asparagus, spinach, mushrooms (modest purine).

2. ARTERIAL STIFFNESS + climbing BP — baPWV crossed threshold, sys ~125-135.
   HARD BLOCK: products >800mg sodium per serving (very high salt loads).
   WATCH (sometimes): 400-800mg sodium per serving, sodium phosphate, MSG,
   soy sauce, miso, kimchi (high salt variants) as primary.
   Daily target <2300mg total but a single moderate-sodium snack is fine.

3. CLIMBING LDL — 116 mg/dL (last KMI), trending up.
   HARD BLOCK: trans fats, partially hydrogenated oils. Real cardiovascular
   harm even in small amounts.
   WATCH (sometimes): saturated fat >5g/serving, butter/cream-heavy products,
   palm oil as primary ingredient, coconut oil as primary ingredient.

4. GLUCOSE — 99 mg/dL fasting, but actually well-controlled (HbA1c 4.5%).
   HARD BLOCK in LIQUID form only: sugar-sweetened beverages, sports drinks,
   fruit juice (>5g sugar/100ml), sweetened iced tea, energy drinks.
   Liquid sugar hits glucose 2-3x harder than solid.
   WATCH (sometimes): solid sugar in normal-portion snacks (chocolate, sweet
   biscuits, ice cream), white bread, rice cakes, instant oats, refined
   flour as first ingredient. Fine occasionally on OMAD.

5. LYMPHOID FOLLICULAR GASTRITIS — minimize spicy/very acidic.
   WATCH (sometimes): hot peppers as primary, vinegar-heavy pickles, citric
   acid as primary ingredient.

6. GENETIC CRC RISK — 2nd-degree family history (paternal grandfather) +
   2.34x risk variant from M-CHECK 2023.
   HARD BLOCK: processed/cured red meat (bacon, sausage, ham, salami,
   pepperoni, hot dogs, jerky, chorizo, prosciutto, smoked deli meats).
   IARC Group 1 carcinogen for CRC. Even occasional adds risk.
   PREFER: high-fiber items.

IGE-CONFIRMED ALLERGIES (KMI 2024 panel)
- BEEF — Class 2 IgE. HARD BLOCK. Even small amounts.
- MILK — Class 1 IgE, borderline. WATCH for milk concentrates as primary
  ingredient: whey protein concentrate, milk powder, sodium caseinate, full
  casein. Whey isolate is generally tolerated. Trace milk fine.
- All other 105 allergens negative — no other allergy concerns.

GENETIC CONSIDERATIONS
- MTHFR C677T heterozygous. Note folic acid in fortification but it's not a
  block, just a soft flag. Methylfolate (5-MTHF) is preferred where listed.

USER-STATED CHEMICAL AVOID-LIST (these are HARD BLOCKS, even trace amounts)
- Artificial sweeteners: sucralose, aspartame, acesulfame-K, saccharin
- Titanium dioxide (E171)
- Synthetic colors: tartrazine, sunset yellow, ponceau, allura red, brilliant
  blue, indigotine, all FD&C dyes
- Hydrogenated / partially hydrogenated oils
- High-fructose corn syrup
- BHA / BHT / TBHQ (synthetic preservatives)
- Sodium nitrite / nitrate (cured-meat preservatives)

YELLOW (not red) for these — annoying but not hard blocks:
- Maltodextrin (high GI filler, prefer to avoid but not a hazard)
- Sodium bicarbonate effervescent products
- Carrageenan
- Mono- and diglycerides
- Natural flavors (vague but not dangerous)

VERDICT RULES SUMMARY
- AVOID (red): contains any HARD BLOCK ingredient from above.
- SOMETIMES (yellow): contains watch-list / frequency-rule ingredients but no
  hard blocks. This is the right call for most normal supermarket snacks.
- GOOD (green): no red or yellow flags. Clean ingredients, whole-food-based,
  low sodium (<400mg/serving), no flagged additives.

Be confident. If clearly a treat/snack with normal-amount sugar and no
hard-block ingredients, that's SOMETIMES not AVOID. Reserve AVOID for real
hazards. If you can't read the label clearly, say so and ask for a better
photo.
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
