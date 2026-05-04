// Tiny Vercel Edge function. Asks Claude (Haiku, cheap+fast) to read the
// numeric digits printed below a barcode in a photo. Used as a fallback
// when local barcode decoders fail. Returns { code: "5012345678901" } or
// { code: null } if unreadable.

export const config = { runtime: 'edge' };

const SYSTEM_PROMPT = `You are a barcode digit reader.
The user will send a photo of a product. Look at the photo and find the
barcode (the black-and-white striped rectangle). Below or beside the
barcode there will be printed digits — usually 8, 12, or 13 digits.
Respond with ONLY those digits, nothing else.
If you cannot read the digits clearly, respond with the word: NONE
Do not guess. Do not add explanations. No prose. Just the digits, or NONE.`;

export default async function handler(request) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body;
  try { body = await request.json(); }
  catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { image, mime = 'image/jpeg' } = body;
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
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 60,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mime, data: image } },
              { type: 'text', text: 'Read the barcode digits.' },
            ],
          },
        ],
      }),
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: 'Network error', detail: String(e) }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!claudeResp.ok) {
    const errText = await claudeResp.text();
    return new Response(
      JSON.stringify({ error: 'Claude error', detail: errText.slice(0, 300) }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const data = await claudeResp.json();
  const raw = (data?.content?.[0]?.text || '').trim();
  // Extract digits only — strip everything non-numeric
  const digits = raw.replace(/\D/g, '');
  // Sanity-check: real barcodes are 8, 12, 13, or 14 digits
  const valid = digits.length >= 8 && digits.length <= 14 ? digits : null;
  return new Response(JSON.stringify({ code: valid, raw }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
