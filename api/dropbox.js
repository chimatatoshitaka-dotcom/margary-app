// Vercel Serverless Function — Dropbox API プロキシ
// リフレッシュトークンからアクセストークンを自動取得し、画像保存・フォルダ操作を行う

let cachedToken = null;
let cachedExpiry = 0;
let cachedRootNs = null;

async function getAccessToken() {
  // キャッシュが有効なら再利用（4時間有効なので余裕をもって使い回す）
  if (cachedToken && Date.now() < cachedExpiry) return cachedToken;

  const appKey = process.env.DROPBOX_APP_KEY;
  const appSecret = process.env.DROPBOX_APP_SECRET;
  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;
  if (!appKey || !appSecret || !refreshToken) {
    throw new Error('Dropboxの環境変数（DROPBOX_APP_KEY / DROPBOX_APP_SECRET / DROPBOX_REFRESH_TOKEN）が未設定です');
  }

  const params = new URLSearchParams();
  params.append('grant_type', 'refresh_token');
  params.append('refresh_token', refreshToken);
  params.append('client_id', appKey);
  params.append('client_secret', appSecret);

  const res = await fetch('https://api.dropbox.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  const data = await res.json();
  if (!res.ok) throw new Error('Dropboxトークン取得失敗: ' + (data.error_description || JSON.stringify(data)));
  cachedToken = data.access_token;
  cachedExpiry = Date.now() + (data.expires_in - 300) * 1000; // 5分マージン
  return cachedToken;
}

// チームスペース（Dropbox Business）のルート名前空間IDを取得
// 環境変数 DROPBOX_ROOT_NAMESPACE_ID があればそれを優先
async function getRootNamespaceId(token) {
  if (cachedRootNs !== null) return cachedRootNs;
  if (process.env.DROPBOX_ROOT_NAMESPACE_ID) {
    cachedRootNs = process.env.DROPBOX_ROOT_NAMESPACE_ID;
    return cachedRootNs;
  }
  // アカウント情報からroot_infoを取得
  const res = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token },
  });
  const data = await res.json();
  // root_info.root_namespace_id がチームスペースのルート
  cachedRootNs = data?.root_info?.root_namespace_id || false;
  return cachedRootNs;
}

// Dropbox-API-Path-Root ヘッダーを生成（チームスペース対応）
async function pathRootHeader(token) {
  const ns = await getRootNamespaceId(token);
  if (!ns) return {};
  return { 'Dropbox-API-Path-Root': JSON.stringify({ '.tag': 'root', 'root': ns }) };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  try {
    const { action } = req.body;
    const token = await getAccessToken();

    // ===== 画像をアップロード =====
    if (action === 'upload') {
      const { path, base64 } = req.body;
      if (!path || !base64) return res.status(400).json({ message: 'path and base64 are required' });
      const buffer = Buffer.from(base64, 'base64');
      const upRes = await fetch('https://content.dropboxapi.com/2/files/upload', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/octet-stream',
          'Dropbox-API-Arg': JSON.stringify({ path, mode: 'overwrite', autorename: false, mute: true }),
        },
        body: buffer,
      });
      const upData = await upRes.json();
      if (!upRes.ok) return res.status(upRes.status).json({ message: 'アップロード失敗: ' + JSON.stringify(upData) });
      return res.status(200).json({ ok: true, path: upData.path_display });
    }

    // ===== フォルダの共有リンクを取得（or 作成） =====
    if (action === 'share_link') {
      const { path } = req.body;
      if (!path) return res.status(400).json({ message: 'path is required' });
      // 既存リンクを探す
      let linkRes = await fetch('https://api.dropboxapi.com/2/sharing/list_shared_links', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, direct_only: true }),
      });
      let linkData = await linkRes.json();
      if (linkRes.ok && linkData.links && linkData.links.length > 0) {
        return res.status(200).json({ url: linkData.links[0].url });
      }
      // なければ新規作成
      linkRes = await fetch('https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      linkData = await linkRes.json();
      if (!linkRes.ok) return res.status(linkRes.status).json({ message: '共有リンク作成失敗: ' + JSON.stringify(linkData) });
      return res.status(200).json({ url: linkData.url });
    }

    // ===== フォルダを移動（ステータス変更時） =====
    if (action === 'move') {
      const { from_path, to_path } = req.body;
      if (!from_path || !to_path) return res.status(400).json({ message: 'from_path and to_path are required' });
      const mvRes = await fetch('https://api.dropboxapi.com/2/files/move_v2', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_path, to_path, autorename: false, allow_ownership_transfer: false }),
      });
      const mvData = await mvRes.json();
      if (!mvRes.ok) {
        // 移動先が既に存在する等は警告扱い
        return res.status(mvRes.status).json({ message: 'フォルダ移動失敗: ' + JSON.stringify(mvData) });
      }
      return res.status(200).json({ ok: true, path: mvData.metadata?.path_display });
    }

    return res.status(400).json({ message: 'Unknown action: ' + action });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}
