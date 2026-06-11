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
    const { path, method, body, token, action, filename, contentType, base64 } = req.body;
    // トークンはリクエストから、なければVercel環境変数 NOTION_TOKEN を使用
    const notionToken = token || process.env.NOTION_TOKEN;
    if (!notionToken) {
      return res.status(400).json({ message: 'Notionトークンが未設定です。Vercelの環境変数 NOTION_TOKEN を設定するか、アプリの設定画面で入力してください。' });
    }

    // ===== 画像アップロード（Notion File Upload API） =====
    if (action === 'upload_file') {
      if (!filename || !base64) {
        return res.status(400).json({ message: 'filename and base64 are required' });
      }
      const NV = '2022-06-28';
      // 1. アップロード枠を作成
      const createRes = await fetch('https://api.notion.com/v1/file_uploads', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + notionToken,
          'Notion-Version': NV,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ filename, content_type: contentType || 'image/jpeg' }),
      });
      const created = await createRes.json();
      if (!createRes.ok) return res.status(createRes.status).json({ message: 'file_upload作成失敗: ' + (created.message || JSON.stringify(created)) });
      if (!created.id) return res.status(500).json({ message: 'file_upload IDが取得できませんでした' });

      // 2. ファイル本体を送信（multipart）
      const buffer = Buffer.from(base64, 'base64');
      const form = new FormData();
      form.append('file', new Blob([buffer], { type: contentType || 'image/jpeg' }), filename);
      const sendRes = await fetch(`https://api.notion.com/v1/file_uploads/${created.id}/send`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + notionToken,
          'Notion-Version': NV,
        },
        body: form,
      });
      const sent = await sendRes.json();
      if (!sendRes.ok) return res.status(sendRes.status).json({ message: 'file送信失敗: ' + (sent.message || JSON.stringify(sent)) });
      return res.status(200).json({ id: created.id });
    }

    if (!path) {
      return res.status(400).json({ message: 'path is required' });
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
