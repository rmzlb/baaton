// Baaton AI Proxy — Supabase Edge Function
// Proxies requests to Gemini API, keeping the API key server-side.

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') || '';
const ALLOWED_ORIGINS = [
  'https://app.baaton.dev',
  'https://baaton.dev',
  'http://localhost:3000',
  'http://localhost:5173',
];

function corsHeaders(origin: string): Record<string, string> {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
    'Access-Control-Max-Age': '86400',
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') || '';
  const headers = corsHeaders(origin);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  if (!GEMINI_API_KEY) {
    return new Response(JSON.stringify({ error: 'AI service not configured' }), {
      status: 503,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const model = body.model || 'gemini-2.0-flash';
    
    // Forward the entire request body to Gemini (supports function calling)
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

    // Build the Gemini request from the body
    // The frontend sends the full Gemini-format body (systemInstruction, contents, tools, etc.)
    const geminiBody = {
      systemInstruction: body.systemInstruction,
      contents: body.contents,
      tools: body.tools,
      generationConfig: body.generationConfig || {
        temperature: 0.4,
        maxOutputTokens: 2000,
        topP: 0.9,
      },
    };

    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiBody),
    });

    const geminiData = await geminiRes.json();

    return new Response(JSON.stringify(geminiData), {
      status: geminiRes.status,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Proxy error: ${err.message}` }), {
      status: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }
});
