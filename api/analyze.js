// Vercel Serverless Function — Anthropic API プロキシ
// APIキーはVercelの環境変数 ANTHROPIC_API_KEY から取得（クライアントから渡された場合はそちらを優先）

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Method not allowed' } });
  }

  try {
    const { model, max_tokens, messages, apiKey } = req.body;
    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) {
      return res.status(400).json({ error: { message: 'APIキーが未設定です。Vercelの環境変数 ANTHROPIC_API_KEY を設定するか、アプリの設定画面で入力してください。' } });
    }

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-4-6',
        max_tokens: max_tokens || 1000,
        messages,
      }),
    });

    const data = await aiRes.json();
    return res.status(aiRes.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: { message: e.message } });
  }
}
