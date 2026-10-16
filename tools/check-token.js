/**
 * Kiem tra mot Access Token truoc khi dan vao dashboard.
 *
 * Tra loi 4 cau hoi:
 *   1. Token con song khong, cua ai?
 *   2. Bao gio het han? (quan trong nhat - token User chet sau ~60 ngay)
 *   3. Co du quyen ads_read / read_insights khong?
 *   4. Doc duoc bao nhieu trong so 10 tai khoan cua BM?
 *
 * Cach dung:
 *   node tools/check-token.js                 -> kiem tra token trong .env
 *   node tools/check-token.js EAAxxxxx...     -> kiem tra mot token bat ky
 *
 * Token KHONG bao gio bi in ra man hinh hay ghi vao file.
 */
import { config } from '../src/config.js';

const BASE = 'https://graph.facebook.com';
const V = config.apiVersion;

const token = (process.argv[2] || config.accessToken || '').trim();

if (!token || token === 'your_meta_access_token_here') {
  console.error('\n  Chua co token de kiem tra.');
  console.error('  Dung: node tools/check-token.js <access_token>');
  console.error('  Hoac dat META_ADS_ACCESS_TOKEN trong .env roi chay lai.\n');
  process.exit(1);
}

/**
 * Che token truoc khi in bat cu thu gi ra man hinh.
 * Meta ECHO nguyen token vao mot so thong bao loi (vi du "Malformed access token
 * EAAxxx..."), nen neu in thang err.message thi token se nam lai trong terminal.
 * Quy tac du an §3: khong in token ra log/chat/screenshot.
 */
function redact(text) {
  if (!text) return '';
  let out = String(text);
  if (token.length > 8) {
    out = out.split(token).join(`${token.slice(0, 6)}...${token.slice(-4)}`);
  }
  // Phong them: bat moi chuoi trong giong token Meta con sot lai.
  return out.replace(/\bEAA[A-Za-z0-9_-]{12,}/g, (m) => `${m.slice(0, 6)}...${m.slice(-4)}`);
}

/** Goi Graph API, khong bao gio nem token vao thong bao loi. */
async function call(endpoint, params = {}) {
  const url = new URL(`${BASE}/${V}/${endpoint}`);
  url.searchParams.set('access_token', token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  const json = await res.json();
  if (json.error) {
    const e = new Error(redact(json.error.message));
    e.code = json.error.code;
    e.type = json.error.type;
    throw e;
  }
  return json;
}

const fmtDate = (unix) => {
  if (!unix || unix === 0) return null;
  return new Date(unix * 1000).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
};

const line = () => console.log('  ' + '-'.repeat(62));

async function main() {
  console.log('');
  console.log('  ==============================================================');
  console.log('   KIEM TRA ACCESS TOKEN');
  console.log('  ==============================================================');
  console.log(`  Do dai token: ${token.length} ky tu | Graph API ${V}`);
  line();

  // --- 1. Token con song khong? -------------------------------------------
  let owner = null;
  try {
    owner = await call('me', { fields: 'id,name' });
    console.log(`  [OK]  Token con hieu luc.`);
    console.log(`        Thuoc ve: ${owner.name || '(khong co ten)'} (id ${owner.id})`);
  } catch (err) {
    console.log(`  [LOI] Token KHONG dung duoc.`);
    console.log(`        Ma loi ${err.code}: ${err.message}`);
    if (err.code === 190) {
      console.log('');
      console.log('        => Token da het han hoac bi thu hoi. Can lay token moi.');
    }
    console.log('');
    process.exit(1);
  }

  // --- 2. Loai token & han su dung ----------------------------------------
  line();
  let debug = null;
  try {
    // Khong co App Secret thi van thu duoc bang chinh token do.
    const res = await call('debug_token', { input_token: token });
    debug = res.data;
  } catch {
    console.log('  [?]   Khong doc duoc chi tiet han su dung.');
    console.log('        (Binh thuong khi chua dat META_APP_SECRET trong .env)');
  }

  if (debug) {
    const typeLabel = {
      USER: 'User token (gan voi tai khoan nguoi that)',
      PAGE: 'Page token (chi dung cho Page/Messenger)',
      APP: 'App token',
      SYSTEM_USER: 'System User token (danh tinh robot trong BM)'
    }[debug.type] || debug.type;

    console.log(`  Loai token : ${typeLabel}`);
    if (debug.app_id) console.log(`  App phat   : ${debug.app_id}`);

    const expires = debug.expires_at;
    const dataExpires = debug.data_access_expires_at;

    if (!expires || expires === 0) {
      console.log(`  Han su dung: VINH VIEN - khong het han`);
    } else {
      const left = Math.round((expires * 1000 - Date.now()) / 86400000);
      console.log(`  Han su dung: ${fmtDate(expires)}`);
      if (left < 0) console.log(`               >> DA HET HAN ${Math.abs(left)} ngay truoc`);
      else if (left <= 7) console.log(`               >> CHI CON ${left} NGAY - nen doi sang System User token`);
      else console.log(`               >> Con ${left} ngay`);
    }
    if (dataExpires && dataExpires !== 0) {
      console.log(`  Han doc data: ${fmtDate(dataExpires)}`);
    }

    // --- 3. Quyen --------------------------------------------------------
    const scopes = debug.scopes || [];
    if (scopes.length) {
      const need = ['ads_read', 'read_insights'];
      line();
      console.log('  Quyen can cho dashboard:');
      for (const s of need) {
        const has = scopes.includes(s) || scopes.includes('ads_management');
        console.log(`    ${has ? '[CO]  ' : '[THIEU]'} ${s}`);
      }
      const extra = scopes.filter(s => !need.includes(s));
      if (extra.length) console.log(`  Quyen khac: ${extra.join(', ')}`);
    }
  }

  // --- 4. Doc duoc nhung tai khoan nao? -----------------------------------
  line();
  console.log(`  Tai khoan quang cao token nay nhin thay:`);

  let visible = [];

  // Buoc 1: hoi thang BM. Chi thanh cong khi token thuoc mot System User la ADMIN cua BM.
  try {
    const res = await call(`${config.businessId}/owned_ad_accounts`, {
      fields: 'id,name,account_id', limit: 100
    });
    visible = res.data || [];
    if (visible.length) console.log(`  Trong BM ${config.businessId}: ${visible.length} tai khoan`);
  } catch (err) {
    console.log(`  Khong hoi duoc BM truc tiep (${err.code}: ${err.message.slice(0, 50)})`);
  }

  // Buoc 2: fallback. BAT BUOC chay ca khi buoc 1 tra ve RONG chu khong chi khi loi —
  // mot System User duoc gan QUYEN TUNG TAI KHOAN (khong phai admin BM) se khien
  // /owned_ad_accounts tra ve 0 ma khong bao loi, du token doc duoc cac tai khoan do.
  // Day dung la cach src/meta-api.js getUserAdAccounts() hoat dong.
  if (visible.length === 0) {
    console.log(`  BM tra ve 0 tai khoan -> doi sang /me/adaccounts (giong dashboard)`);
    try {
      const res = await call('me/adaccounts', {
        fields: 'id,name,account_id,business{id,name}', limit: 100
      });
      const all = res.data || [];
      visible = all.filter(a => a.business?.id === config.businessId);
      console.log(`  Token nhin thay tong cong ${all.length} tai khoan, trong do ${visible.length} thuoc BM ${config.businessId}`);

      const others = all.filter(a => a.business?.id !== config.businessId);
      if (others.length) {
        const byBiz = {};
        for (const a of others) {
          const k = a.business ? `${a.business.name || a.business.id}` : '(khong thuoc business nao)';
          byBiz[k] = (byBiz[k] || 0) + 1;
        }
        console.log('  Ngoai BM nay (dashboard se bo qua):');
        for (const [k, v] of Object.entries(byBiz)) console.log(`    ${v} tai khoan - ${k}`);
      }
    } catch (err) {
      console.log(`  Khong liet ke duoc tai khoan nao (${err.code}: ${err.message.slice(0, 50)})`);
    }
  }

  if (visible.length) {
    for (const a of visible.slice(0, 15)) {
      console.log(`    ${a.id.padEnd(22)} ${a.name || ''}`);
    }
    if (visible.length > 15) console.log(`    ... va ${visible.length - 15} tai khoan nua`);
  }

  // --- 5. Thu doc insights that -------------------------------------------
  line();
  const sample = visible.slice(0, 3);
  if (sample.length === 0) {
    console.log('  Bo qua buoc doc thu insights (khong co tai khoan nao).');
  } else {
    console.log(`  Thu doc insights that (${sample.length} tai khoan dau):`);
    for (const a of sample) {
      try {
        const r = await call(`${a.id}/insights`, { date_preset: 'last_7d', fields: 'spend', limit: 1 });
        const spend = r.data?.[0]?.spend;
        console.log(`    [OK]  ${a.id} ${spend !== undefined ? `- 7 ngay chi ${Number(spend).toLocaleString('vi-VN')} d` : '- khong co du lieu 7 ngay'}`);
      } catch (err) {
        console.log(`    [LOI] ${a.id} - ${err.code}: ${err.message.slice(0, 55)}`);
      }
    }
  }

  // --- Ket luan ------------------------------------------------------------
  line();
  const perm = debug && (!debug.expires_at || debug.expires_at === 0);
  if (perm) {
    console.log('  KET LUAN: Token vinh vien, dung duoc lau dai.');
    console.log('            Dan vao dashboard qua nut "Cai dat Token".');
  } else if (debug) {
    console.log('  KET LUAN: Token CO HAN - se chet va phai lay lai.');
    console.log('            Nen tao System User token voi han "Never".');
  } else {
    console.log('  KET LUAN: Token dung duoc, nhung khong xac dinh duoc han.');
  }
  console.log('');
}

main().catch(err => {
  console.error('\n  [LOI]', err.message, '\n');
  process.exitCode = 1;
});
