// Vercel Serverless Function — Notion API プロキシ
// ブラウザから直接Notion APIを呼ぶとCORSエラーになるため、このプロキシ経由でアクセスする

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { path, method, body, token } = req.body;
    // トークンはリクエストから、なければVercel環境変数 NOTION_TOKEN を使用
    const notionToken = token || process.env.NOTION_TOKEN;
    if (!path) {
      return res.status(400).json({ message: 'path is required' });
    }
    if (!notionToken) {
      return res.status(400).json({ message: 'Notionトークンが未設定です。Vercelの環境変数 NOTION_TOKEN を設定するか、アプリの設定画面で入力してください。' });
    }

    const notionRes = await fetch('https://api.notion.com/v1/' + path, {
      method: method || 'POST',
      headers: {
        'Authorization': 'Bearer ' + notionToken,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await notionRes.json();
    return res.status(notionRes.status).json(data);
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}
