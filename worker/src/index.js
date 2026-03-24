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

// ===== Web Push (native Web Crypto API — no external library) =====

function b64uToBytes(b64u) {
  const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64.padEnd(b64.length + (4 - b64.length % 4) % 4, '=');
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

function bytesToB64u(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function concat(...arrays) {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
}

async function hmacSha256(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

async function hkdfExtract(salt, ikm) {
  return hmacSha256(salt, ikm);
}

async function hkdfExpand(prk, info, len) {
  return (await hmacSha256(prk, concat(info, new Uint8Array([1])))).slice(0, len);
}

// VAPID秘密鍵を正規化してbase64url文字列を返す
function normalizePrivateKey(raw) {
  const s = raw.trim();
  if (s.includes('-----')) {
    const b64 = s.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    const der = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    return bytesToB64u(der.slice(7, 39));
  }
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').replace(/\s+/g, '');
}

// 秘密鍵をECDSA署名用にインポート（JWK形式）
async function importSigningKey(privateKeyB64u) {
  const pubBytes = b64uToBytes(VAPID_PUBLIC_KEY);
  return crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256',
    d: privateKeyB64u,
    x: bytesToB64u(pubBytes.slice(1, 33)),
    y: bytesToB64u(pubBytes.slice(33, 65)),
  }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

// VAPID JWT を生成
async function createVapidJwt(endpoint, subject, privateKeyB64u) {
  const { protocol, host } = new URL(endpoint);
  const enc = obj => btoa(JSON.stringify(obj))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const input = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({
    aud: `${protocol}//${host}`,
    exp: Math.floor(Date.now() / 1000) + 43200,
    sub: subject,
  })}`;
  const key = await importSigningKey(privateKeyB64u);
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(input)
  );
  return `${input}.${bytesToB64u(sig)}`;
}

// ペイロードを RFC 8291 / RFC 8188 (aes128gcm) で暗号化
async function encryptPayload(subscription, payloadStr) {
  const receiverPub = b64uToBytes(subscription.keys.p256dh);
  const auth        = b64uToBytes(subscription.keys.auth);

  // 送信者ECDHキーペア生成
  const senderKP = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
  );
  const receiverKey = await crypto.subtle.importKey(
    'raw', receiverPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );
  const ecdhBits = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: receiverKey }, senderKP.privateKey, 256)
  );
  const senderPub = new Uint8Array(await crypto.subtle.exportKey('raw', senderKP.publicKey));

  // RFC 8291: IKM 導出
  const prkKey = await hkdfExtract(auth, ecdhBits);
  const ikm = await hkdfExpand(
    prkKey,
    concat(new TextEncoder().encode('WebPush: info\x00'), receiverPub, senderPub),
    32
  );

  // RFC 8188: CEK と nonce 導出
  const salt  = crypto.getRandomValues(new Uint8Array(16));
  const prk   = await hkdfExtract(salt, ikm);
  const cek   = await hkdfExpand(prk, new TextEncoder().encode('Content-Encoding: aes128gcm\x00'), 16);
  const nonce = await hkdfExpand(prk, new TextEncoder().encode('Content-Encoding: nonce\x00'), 12);

  // 暗号化
  const cekKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const plain  = concat(new TextEncoder().encode(payloadStr), new Uint8Array([2])); // 0x02 = last record
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cekKey, plain)
  );

  // aes128gcm ヘッダー: salt(16) + rs(4) + idlen(1) + sender_public(65)
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096, false);
  return concat(salt, rs, new Uint8Array([65]), senderPub, ciphertext);
}

// プッシュ通知送信
async function sendPush(env, subscription, payload) {
  const privateKey = normalizePrivateKey(env.VAPID_PRIVATE_KEY);
  const jwt  = await createVapidJwt(subscription.endpoint, env.VAPID_SUBJECT, privateKey);
  const body = await encryptPayload(subscription, JSON.stringify(payload));

  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Authorization':    `vapid t=${jwt},k=${VAPID_PUBLIC_KEY}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type':     'application/octet-stream',
      'TTL':              '86400',
    },
    body,
  });

  if (res.status !== 201) {
    const text = await res.text();
    const err = new Error(text);
    err.statusCode = res.status;
    err.body = text;
    throw err;
  }
  return { statusCode: res.status };
}

// =====================================================

export default {
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

    // POST /settings — 設定保存
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

    // GET /settings — 設定取得
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
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const hh  = String(jst.getUTCHours()).padStart(2, '0');
  const mm  = String(jst.getUTCMinutes()).padStart(2, '0');
  const currentTime = `${hh}:${mm}`;

  console.log(`Cron tick JST: ${currentTime}`);

  const subRaw = await env.YURURUN_KV.get('subscription');
  if (!subRaw) { console.log('No subscription registered'); return; }
  const subscription = JSON.parse(subRaw);

  const settings    = await env.YURURUN_KV.get('settings', 'json') || {};
  const merged      = { ...DEFAULT_SETTINGS, ...settings };
  const disabledIds = merged.disabledIds || [];

  for (const item of SCHEDULE) {
    const scheduledTime = merged[item.tk];
    if (!scheduledTime || scheduledTime !== currentTime) continue;
    if (disabledIds.includes(item.id)) { console.log(`Skipping disabled: ${item.id}`); continue; }

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
      if (e.statusCode === 410 || e.statusCode === 404) {
        console.log('Subscription expired, removing from KV');
        await env.YURURUN_KV.delete('subscription');
      }
    }
  }
}
