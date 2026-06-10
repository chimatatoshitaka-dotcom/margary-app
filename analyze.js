export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action } = req.body;

  // ── AI画像解析 ──
  if (action === 'analyze') {
    try {
      const { images } = req.body;
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

      const imageContent = images.map(img => ({
        type: 'image',
        source: { type: 'base64', media_type: img.mediaType || 'image/jpeg', data: img.data }
      }));

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
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
      if (!response.ok) return res.status(response.status).json({ error: data.error?.message || 'API error' });

      const text = data.content?.[0]?.text || '{}';
      const clean = text.replace(/```json|```/g, '').trim();
      return res.status(200).json({ result: JSON.parse(clean) });

    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── Notion登録 ──
  if (action === 'register') {
    try {
      const { notionToken, product, inventory } = req.body;
      if (!notionToken) return res.status(400).json({ error: 'Notion token missing' });

      const PRODUCTS_DB = '9e95822d-a525-42c7-81da-c2b725c649a5';
      const INVENTORY_DB = 'c55bd93b-3920-410e-b21a-88b828408130';

      // 商品マスター登録
      const productRes = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${notionToken}`,
          'Content-Type': 'application/json',
          'Notion-Version': '2022-06-28'
        },
        body: JSON.stringify({
          parent: { database_id: PRODUCTS_DB },
          properties: {
            '商品名': { title: [{ text: { content: product.name } }] },
            '品番': { rich_text: [{ text: { content: product.sku } }] },
            'ブランド': { select: { name: product.brand } },
            'カテゴリ': { select: { name: product.category } },
            '仕入れ店舗': { select: { name: product.store } },
            'アウトレット価格（EUR）': { number: product.price },
            '出品ステータス': { select: { name: '未出品' } },
            'メモ': { rich_text: [{ text: { content: product.memo } }] },
            '仕入れ日': { date: { start: product.date || new Date().toISOString().split('T')[0] } }
          }
        })
      });

      const productData = await productRes.json();
      if (!productRes.ok) return res.status(productRes.status).json({ error: productData.message });

      // 在庫バリエーション登録
      const invRes = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${notionToken}`,
          'Content-Type': 'application/json',
          'Notion-Version': '2022-06-28'
        },
        body: JSON.stringify({
          parent: { database_id: INVENTORY_DB },
          properties: {
            'バリエーション名': { title: [{ text: { content: inventory.name } }] },
            'カラー': { select: { name: 'その他' } },
            'サイズ': { select: { name: inventory.size } },
            '在庫数': { number: inventory.stock },
            'BUYMAステータス': { select: { name: '買付可' } },
            'メモ': { rich_text: [{ text: { content: inventory.color } }] },
            '商品': { relation: [{ id: productData.id }] }
          }
        })
      });

      const invData = await invRes.json();
      if (!invRes.ok) return res.status(invRes.status).json({ error: invData.message });

      return res.status(200).json({ success: true, productUrl: productData.url, productId: productData.id });

    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(400).json({ error: 'Invalid action' });
}
