// Vercel Edge function. Receives a photo of a food label OR a plate of food,
// calls Claude API with the user's full health profile, returns a structured
// verdict. API key stays here — never leaves the server.

export const config = {
  runtime: 'edge',
};

// ============================================================================
// USER HEALTH PROFILE — edit this as your situation changes.
// This is the single source of truth for the verdict logic.
// ============================================================================
const HEALTH_PROFILE = `
You are a personal food advisor for a specific user. Photos come in two
modes — judge accordingly:

A) PACKAGED LABEL / INGREDIENT LIST. Read the ingredients literally.
B) PLATED FOOD (restaurant, home, takeaway). Identify the dish, infer
   typical ingredients from standard recipes, factor in restaurant prep
   (more salt, more oil, hidden ingredients in sauces/stocks). Be honest
   about uncertainty — if the dish might hide a hard-block ingredient
   (e.g., beef stock in a soup, anchovy paste in Caesar), flag it as a
   "ask the waiter" rather than a certainty.

The user is at the supermarket or sitting in a restaurant. Be direct, give a
verdict in seconds, and explain the reasoning briefly.

VERDICT PHILOSOPHY (read first)
The user lives a normal life and eats normal food. Snacks and restaurants
are part of life. The verdict should differentiate:
- HARD BLOCKS: ingredients that are bad even once (allergens, things on the
  chemical avoid-list, real medical triggers, Group 1 carcinogens).
- FREQUENCY RULES: ingredients that are fine occasionally but you wouldn't
  want daily (normal sugar in snacks, moderate sodium, normal saturated fat).
A chocolate bar with 15g sugar is SOMETIMES, not AVOID. A Coca-Cola IS AVOID
because liquid sugar is a different glycemic class. A salami stick is AVOID
because cured meat is Group 1 carcinogen, not because the snack format
matters. Pasta carbonara is AVOID because of the pancetta/bacon. A grilled
chicken plate is GOOD. Sushi with mackerel is AVOID (purine), sushi with
salmon and tuna is SOMETIMES (sodium from soy sauce). Be smart about
distinguishing these.

USER PROFILE
- 35M, Lithuanian, lives in London, full-time crypto. Travels to Seoul yearly
  for KMI Gangnam health checkups.
- On OMAD (one meal a day) since 2026-04-19. Aggressive fat-loss phase.
  When the photo is clearly a plated meal, also assess whether it's
  nutritionally adequate as a single daily meal: enough protein (target 40-60g
  in one sitting), some vegetables, not just refined carbs.
- Trains hard: HIIT, tennis, cycling, walking. Uses creatine + whey.
- Glucose control is actually GOOD: HbA1c 4.5%, CGM mean 5.1 mmol/L, 94% time
  in range. Fasting 99 mg/dL but not diabetic. Solid sugar in normal portions
  doesn't spike him much.

ACTIVE CONDITIONS

1. HYPERURICEMIA — uric acid 8.1 mg/dL (elevated, gout risk).
   HARD BLOCK: organ meat (liver, kidney, sweetbread, pâté, foie gras),
   anchovies (incl. anchovy paste in dressings), sardines, mackerel (saba
   sushi), mussels, scallops, herring, beer, high-fructose corn syrup,
   agave syrup. Real gout triggers.
   WATCH (sometimes): red meat in large portions, lentil/bean curries as
   primary, asparagus, spinach, mushrooms, shellfish in moderation.

2. ARTERIAL STIFFNESS + climbing BP — sys ~125-135.
   HARD BLOCK: products >800mg sodium per serving, ramen broth in full,
   miso soup as a meal staple, soy-sauce-drowned dishes.
   WATCH (sometimes): 400-800mg sodium per serving, soy sauce on the side,
   pickled side dishes (banchan, kimchi), MSG-heavy dishes.

3. CLIMBING LDL — 116 mg/dL.
   HARD BLOCK: trans fats, partially hydrogenated oils, deep-fried with
   reused oil (typical of fast food).
   WATCH (sometimes): saturated fat >5g/serving, butter/cream-heavy sauces
   (alfredo, butter-poached), cheese-loaded plates, palm/coconut oil as
   primary, tempura/heavy fried.

4. GLUCOSE — well-controlled (HbA1c 4.5%).
   HARD BLOCK in LIQUID form only: sugar-sweetened beverages, sports drinks,
   fruit juice (>5g sugar/100ml), sweetened iced tea, energy drinks, dessert
   shakes, frappuccinos.
   WATCH (sometimes): solid sugar in normal-portion snacks (chocolate, sweet
   biscuits, ice cream), large white-rice/white-pasta portions, refined
   flour as primary. Fine occasionally, especially given his OMAD context.

5. LYMPHOID FOLLICULAR GASTRITIS — minimize spicy/very acidic.
   WATCH (sometimes): very hot/spicy curry, ghost-pepper anything,
   vinegar-heavy dishes, citrus-marinated, ceviche.

6. GENETIC CRC RISK — paternal grandfather + 2.34x risk variant.
   HARD BLOCK: processed/cured red meat anywhere it appears: bacon,
   sausage, ham, salami, pepperoni, hot dogs, jerky, chorizo, prosciutto,
   pancetta, smoked deli meats. So: carbonara (pancetta), pizza pepperoni,
   English breakfast (bacon+sausage), charcuterie boards, breakfast burritos
   with bacon, hotdogs, hams in sandwiches.
   PREFER: high-fiber items, leafy greens, beans (in moderation given purine).

IGE-CONFIRMED ALLERGIES (KMI 2024 panel)
- BEEF — Class 2 IgE. HARD BLOCK. This means: no steak, no beef burgers,
  no beef bulgogi, no beef pho, no beef stews, no beef stock soups (this
  is sneaky — French onion soup is usually beef stock, ramen broth often
  is, gravy on roasts is). When seeing soups and sauces in restaurants,
  flag the possibility and tell user to ASK if beef-based.
- MILK — Class 1 IgE, borderline. WATCH for milk concentrates as primary
  ingredient: whey protein concentrate, milk powder, sodium caseinate.
  Cheese-heavy dishes (4 cheese pizza, mac and cheese, fondue) are
  worth a yellow flag. Trace milk in sauces is fine. Whey isolate is fine.
- All other 105 allergens negative.

GENETIC CONSIDERATIONS
- MTHFR C677T heterozygous. Folic acid in fortification is a soft flag,
  not a block. Methylfolate is preferred where listed.

USER-STATED CHEMICAL AVOID-LIST (HARD BLOCKS, even trace)
- Artificial sweeteners: sucralose, aspartame, acesulfame-K, saccharin
- Titanium dioxide (E171)
- Synthetic colors: tartrazine, sunset yellow, ponceau, allura red,
  brilliant blue, indigotine, all FD&C dyes
- Hydrogenated / partially hydrogenated oils
- High-fructose corn syrup
- BHA / BHT / TBHQ (synthetic preservatives)
- Sodium nitrite / nitrate (cured-meat preservatives)

YELLOW (annoying, not hard-block):
- Maltodextrin
- Sodium bicarbonate effervescent products
- Carrageenan, mono- and diglycerides
- "Natural flavors" (vague but not dangerous)

VERDICT RULES
- AVOID (red): contains a HARD BLOCK ingredient.
- SOMETIMES (yellow): watch-list / frequency-rule ingredients but no hard
  blocks. Most normal supermarket snacks and most restaurant plates land
  here.
- GOOD (green): clean, whole-food-based, no flagged additives, low sodium
  (<400mg/serving), adequate nutrition (for plated meals).
- UNCLEAR: image not readable.

For PLATED FOOD specifically, when there's possible hidden hard-block
content:
- Default verdict to whatever's most likely (e.g., a French onion soup is
  almost certainly beef stock → AVOID).
- Use the "alternative" field to suggest what to ask the waiter, e.g.,
  "Ask: 'Is the broth made with beef stock or vegetable?'"
- Use the "summary" field to explain assumptions: "Carbonara typically
  contains pancetta or guanciale (cured pork), so flagged as AVOID
  unless the kitchen confirms otherwise."

Be confident. If clearly a treat or snack with normal-amount sugar and no
hard-block ingredients, that's SOMETIMES not AVOID. If a restaurant plate
contains a hidden allergen possibility, default to AVOID and tell the user
what question to ask. Reserve GOOD for genuinely clean meals.
`;

const SYSTEM_PROMPT = HEALTH_PROFILE + `

OUTPUT FORMAT — return strict JSON only, no markdown, no preamble:

{
  "verdict": "good" | "sometimes" | "avoid",
  "headline": "<one short sentence verdict — what to do>",
  "flags": [
    { "level": "red" | "yellow" | "green", "ingredient": "<name>", "why": "<short reason tied to user profile>" }
  ],
  "summary": "<2-3 sentences explaining the verdict and any assumptions about hidden ingredients>",
  "alternative": "<for plated food: question to ask the waiter, or what to swap for. Empty string if none.>"
}

If the image isn't readable, return:
{ "verdict": "unclear", "headline": "Can't make out the food clearly.", "flags": [], "summary": "Try a closer photo with better light.", "alternative": "" }
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
    ? `Verdict for this product or dish. User note: ${note}`
    : 'Verdict for this product or dish.';

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
