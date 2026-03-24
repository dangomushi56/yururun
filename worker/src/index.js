import webpush from 'web-push';

const VAPID_PUBLIC_KEY = 'BLO97ZZkpHn7gJTmOWg41zVWOVxlP82xU-Ry4izt8VEBarCVaXeOd2o_lztwv7PScz7Yu4xXcTRbuRqWKE9HJGs';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// 通知スケジュール定義: { taskId, settingsKey, title, body }
const SCHEDULE = [
  { id: 'breakfast',   tk: 't-breakfast',   title: '朝ごはんの時間 🍳', body: '朝ごはん、食べましたか？' },
  { id: 'lunch',       tk: 't-lunch',       title: '昼ごはんの時間 🥗', body: '席を立って、ちゃんとお昼を食べましょう。' },
  { id: 'dinner-prep', tk: 't-dinner-prep', title: 'そろそろ台所へ 🍲',  body: 'この通知が来たら台所へ！夜ごはんを大事に。' },
  { id: 'dinner',      tk: 't-dinner',      title: '夕ごはんの時間 🍽️', body: '今日の締めくくりに、ちゃんと食べましょう。' },
  { id: 'walk',        tk: 't-walk',        title: '散歩の時間 🚶',      body: '少し外に出てみましょう。' },
  { id: 'stretch-day', tk: 't-stretch-day', title: 'ストレッチの時間 🤸', body: 'デスクから離れて体を動かしましょう。' },
  { id: 'stretch-night', tk: 't-stretch-night', title: '夜のストレッチ 🌙', body: '寝る前にほぐしておきましょう。' },
  { id: 'cat-morning', tk: 't-cat-morning', title: '猫タイム（朝）🐱',  body: 'もふもふタイムです。' },
  { id: 'cat-night',   tk: 't-cat-night',   title: '猫タイム（夜）🐱',  body: 'もふもふタイムです。' },
  { id: 'bath-morning',  tk: 't-bath-morning',  title: 'お風呂の時間（朝）🛁',  body: '朝風呂でリフレッシュ！' },
  { id: 'bath-evening',  tk: 't-bath-evening',  title: 'お風呂の時間（夕方）🛁', body: '夕方に湯船、いかがですか。' },
  { id: 'bath-night',    tk: 't-bath-night',    title: 'お風呂の時間（夜）🛁',  body: 'ゆっくり温まりましょう。' },
  { id: 'sleep',      tk: 't-sleep',       title: '就寝準備の時間 😴',  body: 'そろそろ寝る準備をしましょう。' },
];

// デフォルト設定
const DEFAULT_SETTINGS = {
  't-breakfast':    '07:30',
  't-lunch':        '12:30',
  't-dinner-prep':  '19:30',
  't-dinner':       '20:00',
  't-walk':         '09:30',
  't-stretch-day':  '15:00',
  't-stretch-night':'21:30',
  't-cat-morning':  '07:00',
  't-cat-night':    '21:00',
  't-bath-morning': '06:30',
  't-bath-evening': '16:30',
  't-bath-night':   '20:45',
  't-sleep':        '22:00',
  disabledIds: [],
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// VAPID秘密鍵を正規化（PEM・base64・base64url どの形式でも対応）
function normalizePrivateKey(raw) {
  const s = raw.trim();
  // PEM形式の場合: DERから32バイトの秘密鍵を取り出す
  if (s.includes('-----')) {
    const b64 = s.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    const der = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    // SEC1 DER: 30 77 02 01 01 04 20 <32bytes private key> ...
    // private keyは offset 7 から32バイト（固定位置）
    const keyBytes = der.slice(7, 39);
    return btoa(String.fromCharCode(...keyBytes))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }
  // base64 → base64url 変換（+/ を -_ に）
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').replace(/\s+/g, '');
}

async function sendPush(env, subscription, payload) {
  const privateKey = normalizePrivateKey(env.VAPID_PRIVATE_KEY);
  webpush.setVapidDetails(
    env.VAPID_SUBJECT,
    VAPID_PUBLIC_KEY,
    privateKey
  );
  const result = await webpush.sendNotification(subscription, JSON.stringify(payload));
  return result;
}

export default {
  // HTTP リクエストハンドラ
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // POST /subscribe — サブスクリプション保存
    if (pathname === '/subscribe' && request.method === 'POST') {
      try {
        const sub = await request.json();
        await env.YURURUN_KV.put('subscription', JSON.stringify(sub));
        console.log('Subscription saved:', sub.endpoint.slice(-30));
        return json({ ok: true });
      } catch (e) {
        console.error('subscribe error:', e);
        return json({ error: e.message }, 500);
      }
    }

    // POST /settings — 設定保存（フロントエンドから毎回送られる）
    if (pathname === '/settings' && request.method === 'POST') {
      try {
        const settings = await request.json();
        await env.YURURUN_KV.put('settings', JSON.stringify(settings));
        return json({ ok: true });
      } catch (e) {
        console.error('settings error:', e);
        return json({ error: e.message }, 500);
      }
    }

    // GET /settings — 設定取得（別端末での復元用）
    if (pathname === '/settings' && request.method === 'GET') {
      try {
        const s = await env.YURURUN_KV.get('settings', 'json');
        return json(s || {});
      } catch (e) {
        return json({});
      }
    }

    // POST /test — テスト通知送信
    if (pathname === '/test' && request.method === 'POST') {
      try {
        const subRaw = await env.YURURUN_KV.get('subscription');
        if (!subRaw) return json({ error: 'No subscription' }, 404);
        const sub = JSON.parse(subRaw);
        const result = await sendPush(env, sub, {
          title: 'ゆるるん テスト通知 🔔',
          body:  '通知が届いています！',
          tag:   'test',
          url:   'https://dangomushi56.github.io/yururun/',
        });
        console.log('Test push result:', result.statusCode);
        return json({ ok: true, status: result.statusCode });
      } catch (e) {
        console.error('test push error:', e);
        return json({ error: e.message }, 500);
      }
    }

    return new Response('Not found', { status: 404, headers: CORS_HEADERS });
  },

  // Cron トリガー（毎分実行）
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduled(env));
  },
};

async function runScheduled(env) {
  // JST (UTC+9) の現在時刻を HH:MM 形式で取得
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000;
  const jst = new Date(now.getTime() + jstOffset);
  const hh = String(jst.getUTCHours()).padStart(2, '0');
  const mm = String(jst.getUTCMinutes()).padStart(2, '0');
  const currentTime = `${hh}:${mm}`;

  console.log(`Cron tick JST: ${currentTime}`);

  // サブスクリプション取得
  const subRaw = await env.YURURUN_KV.get('subscription');
  if (!subRaw) {
    console.log('No subscription registered');
    return;
  }
  const subscription = JSON.parse(subRaw);

  // 設定取得
  const settings = await env.YURURUN_KV.get('settings', 'json') || {};
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  const disabledIds = merged.disabledIds || [];

  // 現在時刻に一致する通知を探す
  for (const item of SCHEDULE) {
    const scheduledTime = merged[item.tk];
    if (!scheduledTime || scheduledTime !== currentTime) continue;
    if (disabledIds.includes(item.id)) {
      console.log(`Skipping disabled: ${item.id}`);
      continue;
    }

    console.log(`Sending push for: ${item.id} at ${currentTime}`);
    try {
      const result = await sendPush(env, subscription, {
        title: item.title,
        body:  item.body,
        tag:   item.id,
        url:   'https://dangomushi56.github.io/yururun/',
      });
      console.log(`Push response: ${result.statusCode}`);
    } catch (e) {
      console.error(`Push failed for ${item.id}:`, e.statusCode, e.body);
      // サブスクリプションが無効な場合は削除
      if (e.statusCode === 410 || e.statusCode === 404) {
        console.log('Subscription expired, removing from KV');
        await env.YURURUN_KV.delete('subscription');
      }
    }
  }
}
