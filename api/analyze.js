export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { images } = req.body;
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: 'API key not configured' });
    }

    const imageContent = images.map(img => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.mediaType || 'image/jpeg',
        data: img.data
      }
    }));

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [
            ...imageContent,
            {
              type: 'text',
              text: `これらはラグジュアリーブランド商品のラベル・商品写真です。
ラベルから以下の情報を抽出してJSONで返してください。
見つからない場合は空文字にしてください。

{
  "brand": "ブランド名（LOEWE/PRADA/MIU MIU/GUCCI/CELINE/BOTTEGA VENETA/SAINT LAURENT/BURBERRY/FENDI/VALENTINO/その他）",
  "sku": "品番",
  "model": "モデル名（品番のアンダースコア以降）",
  "color": "カラー名",
  "price_eur": "価格（数字のみ）",
  "date": "日付（YYYY-MM-DD形式）",
  "account": "買付アカウント（MはMargary）",
  "category": "カテゴリ推定（バッグ/財布・小物/シューズ/アクセサリー/アパレル）"
}

JSONのみ返してください。`
            }
          ]
        }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'API error' });
    }

    const text = data.content?.[0]?.text || '{}';
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    return res.status(200).json({ result: parsed });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
