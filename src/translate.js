// Translates an Egyptian street address from English to Arabic for Bosta.
// Fail-safe: if no API key is set, the text is already Arabic, or the call
// fails, it returns the original text unchanged (never throws). The city is
// handled separately via Bosta's city list, so this only touches the street.

const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

// Heuristic: does the string contain Latin letters? If not, assume it's
// already Arabic and skip translation entirely.
function hasLatinLetters(s) {
  return /[A-Za-z]/.test(String(s || ''));
}

export async function translateAddressToArabic(text) {
  const original = String(text || '').trim();
  if (!original) return original;
  if (!API_KEY) return original;          // translation disabled — keep original
  if (!hasLatinLetters(original)) return original; // already Arabic

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        messages: [
          {
            role: 'user',
            content:
              'Convert this Egyptian delivery address to Arabic script so a local ' +
              'courier can read it. Transliterate proper names (streets, districts, ' +
              'landmarks); translate common words (Street→شارع, Building→عمارة, ' +
              'Floor→الدور, Apartment→شقة). Keep all numbers as digits. ' +
              'Return ONLY the Arabic address text, nothing else.\n\nAddress: ' +
              original,
          },
        ],
      }),
    });

    if (!res.ok) {
      console.warn(`[translate] API ${res.status}; keeping original address`);
      return original;
    }
    const data = await res.json();
    const out = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    return out || original;
  } catch (err) {
    console.warn('[translate] failed, keeping original address:', err.message);
    return original;
  }
}
