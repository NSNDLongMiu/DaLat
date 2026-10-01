// ============================================================
// Bot.gs — chat với bot Telegram trong group để ghi bữa ăn hộ (thuộc project "meal")
// ============================================================
// Cách hoạt động:
//   - Telegram gửi tin nhắn dành cho bot tới doPost (webhook) → handleTelegramUpdate().
//   - Bot nhận tin khi: trả lời (reply) tin của bot, nhắc @tên_bot, gõ /an ..., hoặc nhắn riêng với bot.
//     Không cần tắt Privacy Mode: câu hỏi của bot tự mở khung trả lời cho đúng người được hỏi.
//   - AI đọc tin nhắn (+ ảnh nếu có) → bản nháp bữa ăn → bot gửi tóm tắt kèm nút.
//     Trả lời tin tóm tắt để sửa (kcal, bữa, món, thêm ảnh...). Bấm Ngon/Không ngon/Tệ mới ghi vào tab Meals.
//   - Lần đầu nhắn, bot hỏi bạn là Anh Long hay Bé Uyn và nhớ luôn (Script Property TG_PERSON_<telegram id>).
// Cài đặt: xem apps-script/README.md, mục "Chat với bot".

// false = bot không trả lời chat nữa. Độc lập với TELEGRAM_ENABLED (công tắc tin nhắc tự động).
var TELEGRAM_BOT_ENABLED = true;
var TG_DRAFT_TTL = 6 * 3600;   // bản nháp giữ tối đa 6 giờ (giới hạn của CacheService)
var TG_MEALS = ['Sáng', 'Trưa', 'Xế', 'Tối'];
var TG_SHARE = { 'Sáng': 0.25, 'Trưa': 0.35, 'Xế': 0.10, 'Tối': 0.30 };   // giống MEALS trong an-uong.html
var TG_TASTES = ['Ngon', 'Không ngon', 'Tệ'];
var TG_HELP = '🤖 Mình giúp ghi bữa ăn vào app.\n' +
  '• Trả lời (reply) tin nhắc của bot, nhắc @bot, hoặc gõ /an rồi kể, ví dụ: <i>/an tối nay ăn cơm gà với canh rau ngót</i>\n' +
  '• Gửi kèm ảnh món để ước tính kcal chuẩn hơn và lưu ảnh vào app.\n' +
  '• Mình gửi bản nháp: trả lời bản nháp để sửa, bấm 😋/😕/🤢 để lưu, ❌ để huỷ.\n' +
  '• /huy: huỷ bản nháp · /doinguoi: đổi bạn là Anh Long hay Bé Uyn.';

// ---------- Telegram API ----------
function tgApi(method, payload) {
  var token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
  if (!token) return null;
  var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/' + method, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload || {}),
    muteHttpExceptions: true,
  });
  try { return JSON.parse(res.getContentText()); } catch (err) { return null; }
}

function tgSend(chatId, text, extra) {
  var p = { chat_id: chatId, text: text, parse_mode: 'HTML', allow_sending_without_reply: true };
  for (var k in (extra || {})) p[k] = extra[k];
  var r = tgApi('sendMessage', p);
  return r && r.ok ? r.result : null;
}

function tgEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Tải ảnh Telegram (file_id) về dạng Blob.
function tgDownload(fileId) {
  var token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
  var info = tgApi('getFile', { file_id: fileId });
  if (!token || !info || !info.ok) return null;
  var res = UrlFetchApp.fetch('https://api.telegram.org/file/bot' + token + '/' + info.result.file_path, { muteHttpExceptions: true });
  return res.getResponseCode() === 200 ? res.getBlob().setContentType('image/jpeg') : null;
}

// ---------- Webhook ----------
// Gọi qua <URL /exec>?kind=set-webhook sau mỗi lần đổi URL deploy. Tự tạo mã bí mật để chỉ Telegram gọi được.
function setupTelegramWebhook() {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('TELEGRAM_WEBHOOK_SECRET');
  if (!secret) {
    secret = Utilities.getUuid().replace(/-/g, '');
    props.setProperty('TELEGRAM_WEBHOOK_SECRET', secret);
  }
  // getUrl() đôi khi trả URL /dev; đặt Script Property MEAL_WEBAPP_URL (URL /exec) để chắc chắn.
  var url = props.getProperty('MEAL_WEBAPP_URL') || String(ScriptApp.getService().getUrl() || '').replace(/\/dev$/, '/exec');
  if (!url) return { ok: false, error: 'chưa deploy Web app' };
  var r = tgApi('setWebhook', {
    url: url + '?tg=' + secret,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  });
  return { ok: !!(r && r.ok), telegram: r ? r.description : 'không gọi được Telegram (thiếu TELEGRAM_BOT_TOKEN?)', url: url };
}

function telegramWebhookInfo() {
  var r = tgApi('getWebhookInfo', {}) || { ok: false };
  if (r.result && r.result.url) r.result.url = r.result.url.replace(/\?tg=.*/, '?tg=***');
  return r;
}

function handleTelegramUpdate(e, upd) {
  var secret = PropertiesService.getScriptProperties().getProperty('TELEGRAM_WEBHOOK_SECRET');
  if (!secret || (e.parameter || {}).tg !== secret) return;
  if (!TELEGRAM_BOT_ENABLED) return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return;
  try {
    // Web App trả 302 nên Telegram có thể gửi lại cùng 1 update — đã xử lý thì bỏ qua.
    var cache = CacheService.getScriptCache();
    var seenKey = 'tgupd_' + upd.update_id;
    if (cache.get(seenKey)) return;
    cache.put(seenKey, '1', 21600);
    if (upd.callback_query) tgOnCallback(upd.callback_query);
    else if (upd.message) tgOnMessage(upd.message);
  } catch (err) {
    Logger.log('Bot lỗi: ' + err);
  } finally {
    lock.releaseLock();
  }
}

// ---------- Người dùng ----------
function tgGroupId() {
  return String(PropertiesService.getScriptProperties().getProperty('TELEGRAM_CHAT_ID') || '');
}
function tgPersonOf(uid) {
  return PropertiesService.getScriptProperties().getProperty('TG_PERSON_' + uid);
}
// Chỉ phục vụ group đã cấu hình, hoặc nhắn riêng từ người đã đăng ký trong group.
function tgChatAllowed(chat, uid) {
  if (String(chat.id) === tgGroupId()) return true;
  return chat.type === 'private' && !!tgPersonOf(uid);
}

function tgAskWho(msg) {
  var uid = String(msg.from.id);
  tgSend(msg.chat.id, 'Chào ' + tgEsc(msg.from.first_name || 'bạn') + '! Bạn là ai trong app ăn uống?', {
    reply_to_message_id: msg.message_id,
    reply_markup: { inline_keyboard: [[
      { text: 'Anh Long', callback_data: 'who|Long|' + uid },
      { text: 'Bé Uyn', callback_data: 'who|Uyn|' + uid },
    ]] },
  });
}

// ---------- Bản nháp (CacheService, theo telegram id người nhắn) ----------
function tgLoadDraft(uid) {
  var raw = CacheService.getScriptCache().get('tgdraft_' + uid);
  try { return raw ? JSON.parse(raw) : null; } catch (err) { return null; }
}
function tgStoreDraft(d) {
  CacheService.getScriptCache().put('tgdraft_' + d.owner, JSON.stringify(d), TG_DRAFT_TTL);
}
function tgDropDraft(d) {
  if (!d) return;
  CacheService.getScriptCache().remove('tgdraft_' + d.owner);
  tgClearButtons(d);
}
// Gỡ nút khỏi tin tóm tắt cũ để không bấm nhầm bản đã thay.
function tgClearButtons(d) {
  if (d && d.summaryMsgId) {
    tgApi('editMessageReplyMarkup', { chat_id: d.chatId, message_id: d.summaryMsgId, reply_markup: { inline_keyboard: [] } });
  }
}

// ---------- Tin nhắn ----------
function tgOnMessage(msg) {
  if (!msg.from || msg.from.is_bot) return;
  var uid = String(msg.from.id);
  var chat = msg.chat;
  if (!tgChatAllowed(chat, uid)) {
    if (chat.type === 'private') tgSend(chat.id, 'Bot này chỉ dùng trong group gia đình. Hãy nhắn bot trong group trước để đăng ký nhé.');
    return;
  }
  var text = String(msg.text || msg.caption || '').replace(/@\w*bot\b/gi, ' ').trim();
  var cmd = (/^\/(\w+)/.exec(text) || [])[1];
  if (cmd) text = text.replace(/^\/\w+/, '').trim();
  cmd = (cmd || '').toLowerCase();

  var person = tgPersonOf(uid);
  if (!person || cmd === 'doinguoi') {
    if (String(chat.id) !== tgGroupId()) return;
    // Giữ lại tin vừa nhắn để xử lý ngay sau khi người dùng chọn tên.
    if (!person && cmd !== 'doinguoi') CacheService.getScriptCache().put('tgpending_' + uid, JSON.stringify(msg), 3600);
    tgAskWho(msg);
    return;
  }
  if (cmd === 'start' || cmd === 'help') { tgSend(chat.id, TG_HELP); return; }
  if (cmd === 'huy') {
    var old = tgLoadDraft(uid);
    tgDropDraft(old);
    tgSend(chat.id, old ? '❌ Đã huỷ bản nháp.' : 'Không có bản nháp nào để huỷ.', { reply_to_message_id: msg.message_id });
    return;
  }
  var photo = msg.photo && msg.photo.length ? msg.photo[msg.photo.length - 1].file_id : '';
  if (!text && !photo) {
    if (cmd === 'an') tgSend(chat.id, TG_HELP);
    return;
  }
  tgHandleMeal(msg, person, text, photo, cmd === 'an');
}

function tgHandleMeal(msg, person, text, photo, forceNew) {
  var chatId = msg.chat.id;
  var uid = String(msg.from.id);
  var draft = tgLoadDraft(uid);
  var reply = msg.reply_to_message;
  var repliedText = reply && reply.from && reply.from.is_bot ? String(reply.text || '') : '';
  // Trả lời 1 tin khác của bot (vd tin nhắc bữa mới) hoặc gõ /an => bắt đầu bản nháp mới.
  if (draft && (forceNew || (reply && (draft.botMsgIds || []).indexOf(reply.message_id) === -1))) {
    tgDropDraft(draft);
    draft = null;
  }

  var imageB64 = '';
  if (photo) {
    var blob = tgDownload(photo);
    if (blob) imageB64 = Utilities.base64Encode(blob.getBytes());
  }
  var ai = tgAiParse({ person: person, text: text, replied: repliedText, draft: draft, image: imageB64 });
  if (!ai.ok) {
    tgSend(chatId, '😵 AI đang lỗi (' + tgEsc(ai.error) + '). Thử lại sau ít phút, hoặc ghi trong app nhé.', { reply_to_message_id: msg.message_id });
    return;
  }
  var r = ai.result || {};
  if (r.huy) {
    tgDropDraft(draft);
    tgSend(chatId, draft ? '❌ Đã huỷ bản nháp.' : 'Ok, không ghi gì cả.', { reply_to_message_id: msg.message_id });
    return;
  }
  if (!r.lien_quan) {
    tgSend(chatId, tgEsc(r.tra_loi || 'Mình chỉ giúp ghi bữa ăn thôi nha. Ví dụ: "trưa nay ăn cơm gà với canh rau ngót".'),
      { reply_to_message_id: msg.message_id });
    return;
  }

  var d = tgMergeDraft(draft, r, person, uid, chatId);
  if (photo) d.photo = photo;

  if (!d.skip && !d.food) {
    tgAskInDraft(d, msg, 'Bạn ăn món gì vậy? 🍽');
    return;
  }
  if (!d.skip && !(d.kcal > 0)) {
    tgAskInDraft(d, msg, 'Mình chưa ước tính được kcal cho <b>' + tgEsc(d.food) + '</b>. Khoảng bao nhiêu kcal vậy?');
    return;
  }
  tgSendSummary(d, msg.message_id);
}

// Hỏi thêm: bật khung trả lời cho đúng người được hỏi (force_reply + selective), để tin trả lời tới được bot.
function tgAskInDraft(d, msg, question) {
  var sent = tgSend(d.chatId, question, {
    reply_to_message_id: msg.message_id,
    reply_markup: { force_reply: true, selective: true },
  });
  if (sent) d.botMsgIds.push(sent.message_id);
  tgStoreDraft(d);
}

function tgMergeDraft(draft, r, person, uid, chatId) {
  var d = draft || { id: Utilities.getUuid().slice(0, 8), owner: uid, chatId: chatId, botMsgIds: [], photo: '' };
  var people = (r.nguoi || []).filter(function (p) { return PEOPLE_GS.indexOf(p) !== -1; });
  d.persons = people.length ? people : (d.persons || [person]);
  var hour = Number(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'H'));
  var fallbackMeal = hour < 10 ? 'Sáng' : hour < 14 ? 'Trưa' : hour < 17 ? 'Xế' : 'Tối';
  d.meal = TG_MEALS.indexOf(r.bua) !== -1 ? r.bua : (d.meal || fallbackMeal);
  d.dayOffset = Number(r.ngay) === -1 ? -1 : 0;
  d.skip = !!r.bo_bua;
  d.food = String(r.ten_mon || '').trim().slice(0, 120);
  var num = function (v) { var n = Number(v); return isFinite(n) && n > 0 ? n : 0; };
  d.kcal = Math.min(5000, Math.round(num(r.kcal)));
  d.p = num(r.dam_g); d.c = num(r.tinh_bot_g); d.f = num(r.beo_g); d.s = num(r.xo_g);
  d.userKcal = !!r.kcal_do_nguoi_dung;
  d.taste = TG_TASTES.indexOf(r.khau_vi) !== -1 ? r.khau_vi : '';
  d.comment = String(r.nhan_xet || '').slice(0, 300);
  return d;
}

function tgDraftText(d) {
  var who = d.persons.map(dispName).join(' & ');
  var day = d.dayOffset === -1 ? 'hôm qua' : 'hôm nay';
  var r1 = function (x) { return Math.round(x * 10) / 10; };
  var lines = ['<b>' + tgEsc(who) + '</b> · Bữa <b>' + d.meal + '</b> ' + day];
  if (d.skip) {
    lines.push('Bỏ bữa');
  } else {
    lines.push('Món: ' + tgEsc(d.food));
    lines.push('≈ <b>' + d.kcal + ' kcal</b>' + (d.userKcal ? '' : ' (AI ước tính)') + (d.persons.length > 1 ? ' mỗi người' : ''));
    lines.push('Đạm ' + r1(d.p) + 'g · Tinh bột ' + r1(d.c) + 'g · Béo ' + r1(d.f) + 'g · Xơ ' + r1(d.s) + 'g');
    lines.push(d.photo ? '📷 Có ảnh' : '📷 Chưa có ảnh');
  }
  return lines.join('\n');
}

function tgSendSummary(d, replyTo) {
  tgClearButtons(d);
  var text = '🍽 <b>Bản nháp</b>\n' + tgDraftText(d);
  if (d.comment && !d.skip) text += '\n<i>' + tgEsc(d.comment) + '</i>';
  text += '\n\nTrả lời tin này để sửa hoặc bổ sung (vd: "650 kcal", "bữa trưa", "cả Uyn nữa")' +
    (d.photo || d.skip ? '' : ', hoặc gửi ảnh món để lưu kèm và ước tính chuẩn hơn') + '.\n' +
    (d.skip ? 'Bấm để lưu:' : 'Món có ngon không? Bấm để lưu:');
  var base = '|' + d.owner + '|' + d.id + '|';
  var mark = function (t, label) { return (d.taste === t ? '✅ ' : '') + label; };
  var rows = d.skip
    ? [[{ text: '✅ Lưu bỏ bữa', callback_data: 'sv' + base + '0' }]]
    : [[
      { text: mark('Ngon', '😋 Ngon'), callback_data: 'sv' + base + '0' },
      { text: mark('Không ngon', '😕 Không ngon'), callback_data: 'sv' + base + '1' },
      { text: mark('Tệ', '🤢 Tệ'), callback_data: 'sv' + base + '2' },
    ]];
  rows.push([{ text: '❌ Huỷ', callback_data: 'cx' + base + '0' }]);
  var sent = tgSend(d.chatId, text, { reply_to_message_id: replyTo, reply_markup: { inline_keyboard: rows } });
  if (sent) {
    d.summaryMsgId = sent.message_id;
    d.botMsgIds.push(sent.message_id);
  }
  tgStoreDraft(d);
}

// ---------- Nút bấm ----------
function tgOnCallback(cq) {
  var parts = String(cq.data || '').split('|');
  var uid = String(cq.from.id);
  var msg = cq.message;
  var answer = function (t) { tgApi('answerCallbackQuery', { callback_query_id: cq.id, text: t || '' }); };
  if (!msg || !tgChatAllowed(msg.chat, uid)) { answer(); return; }

  if (parts[0] === 'who') {
    if (parts[2] !== uid) { answer('Nút này dành cho người khác.'); return; }
    var person = parts[1];
    if (PEOPLE_GS.indexOf(person) === -1) { answer(); return; }
    PropertiesService.getScriptProperties().setProperty('TG_PERSON_' + uid, person);
    answer('Đã nhớ!');
    tgApi('editMessageText', {
      chat_id: msg.chat.id, message_id: msg.message_id, parse_mode: 'HTML',
      text: '👋 Đã nhớ: ' + tgEsc(cq.from.first_name || '') + ' là <b>' + dispName(person) + '</b>.\n\n' + TG_HELP,
    });
    var cache = CacheService.getScriptCache();
    var pending = cache.get('tgpending_' + uid);
    if (pending) {
      cache.remove('tgpending_' + uid);
      tgOnMessage(JSON.parse(pending));
    }
    return;
  }

  if (parts[0] !== 'sv' && parts[0] !== 'cx') { answer(); return; }
  if (!tgPersonOf(uid)) { answer('Bạn chưa đăng ký, nhắn bot 1 tin trước nhé.'); return; }
  var d = tgLoadDraft(parts[1]);
  if (!d || d.id !== parts[2]) {
    answer('Bản nháp này đã hết hạn hoặc đã xử lý.');
    tgApi('editMessageReplyMarkup', { chat_id: msg.chat.id, message_id: msg.message_id, reply_markup: { inline_keyboard: [] } });
    return;
  }
  CacheService.getScriptCache().remove('tgdraft_' + d.owner);
  if (parts[0] === 'cx') {
    answer('Đã huỷ');
    tgApi('editMessageText', { chat_id: msg.chat.id, message_id: msg.message_id, parse_mode: 'HTML', text: '❌ Đã huỷ bản nháp.\n' + tgDraftText(d) });
    return;
  }
  if (!d.skip) d.taste = TG_TASTES[Number(parts[3])] || 'Ngon';
  try {
    tgSaveDraft(d);
  } catch (err) {
    tgStoreDraft(d);   // lỗi thì giữ bản nháp để bấm lại
    answer('Lưu lỗi: ' + String(err).slice(0, 150));
    return;
  }
  answer('Đã lưu ✅');
  tgApi('editMessageText', {
    chat_id: msg.chat.id, message_id: msg.message_id, parse_mode: 'HTML',
    text: '✅ <b>Đã lưu vào app</b>\n' + tgDraftText(d) + (d.skip ? '' : '\nKhẩu vị: ' + d.taste),
  });
}

// ---------- Ghi vào tab Meals (cùng định dạng như an-uong.html) ----------
function tgSaveDraft(d) {
  var ss = getDataSpreadsheet();
  var sheet = getMealSheet(ss);
  var date = Utilities.formatDate(new Date(Date.now() + d.dayOffset * 86400000), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var photoId = '';
  if (d.photo) {
    var blob = tgDownload(d.photo);
    if (blob) photoId = savePhotoToDrive('data:image/jpeg;base64,' + Utilities.base64Encode(blob.getBytes()));
  }
  var all = readSheet(ss, 'Meals', MEAL_KEYS);
  var base = Date.now();
  d.persons.forEach(function (p, i) {
    var row = tgMealRow(d, p, date, all);
    row.time = new Date(base + i).toISOString();   // cột Time là mã của dòng, mỗi người 1 mã riêng
    row.photo = photoId;
    sheet.appendRow([row.time, "'" + row.date, row.meal, row.food, row.portion, row.taste, row.veggie, row.note, row.photo, p]);
    notifyIfMealIsRough(row);
  });
}

function tgMealRow(d, person, date, all) {
  if (d.skip) {
    return { date: date, meal: d.meal, food: '', portion: 'Bỏ bữa', taste: '', veggie: 'Không rau', note: '[0 kcal] Ghi qua Telegram', person: person };
  }
  // "Ăn ít" khi tổng kcal của bữa (kể cả món đã ghi trước) dưới nửa phần chia — giống saveMeal() trong app.
  var goal = goalOfPerson(person);
  var sameSlot = { 'Sáng': ['Sáng'], 'Trưa': ['Trưa'], 'Xế': ['Xế', 'Ăn vặt'], 'Tối': ['Tối', 'Khuya'] }[d.meal];
  var baseline = all.filter(function (m) {
    return m.date === date && normPerson(m.person) === person && sameSlot.indexOf(m.meal) !== -1;
  }).reduce(function (sum, m) { return sum + kcalOrEstimate(m, goal); }, 0);
  var portion = d.meal !== 'Xế' && baseline + d.kcal < goal * TG_SHARE[d.meal] * 0.5 ? 'Ăn ít' : 'Ăn hết';
  var veggie = d.s >= 6 ? 'Nhiều rau' : (d.s >= 3 ? 'Có rau' : 'Không rau');
  var r1 = function (x) { return Math.round(x * 10) / 10; };
  var note = '[' + d.kcal + ' kcal P' + r1(d.p) + ' C' + r1(d.c) + ' F' + r1(d.f) + ' S' + r1(d.s) + (d.userKcal ? '' : ' AI') + '] Ghi qua Telegram';
  return { date: date, meal: d.meal, food: d.food, portion: portion, taste: d.taste || 'Ngon', veggie: veggie, note: note, person: person };
}

// ---------- AI đọc tin nhắn ----------
function tgAiParse(o) {
  var tz = Session.getScriptTimeZone();
  var now = new Date();
  var today = todayStrGS();
  var logged = getTodayMeals(o.person).map(function (m) {
    return m.meal + ': ' + (m.portion === 'Bỏ bữa' ? 'bỏ bữa' : m.food);
  }).join('; ') || 'chưa ghi bữa nào';
  var draft = o.draft ? {
    nguoi: o.draft.persons, bua: o.draft.meal, ngay: o.draft.dayOffset, ten_mon: o.draft.food, kcal: o.draft.kcal,
    dam_g: o.draft.p, tinh_bot_g: o.draft.c, beo_g: o.draft.f, xo_g: o.draft.s,
    kcal_do_nguoi_dung: o.draft.userKcal, khau_vi: o.draft.taste, bo_bua: o.draft.skip, co_anh: !!o.draft.photo,
  } : null;
  var prompt = 'Bạn là trợ lý ghi nhật ký ăn uống trong group Telegram của 2 người: Long (gọi là "Anh Long") và Uyn (gọi là "Bé Uyn"). ' +
    'Người đang nhắn: ' + o.person + '. Bây giờ là ' + Utilities.formatDate(now, tz, 'HH:mm') + ' ngày ' + today + '. ' +
    'Hôm nay ' + o.person + ' đã ghi: ' + logged + '.\n' +
    (o.replied ? 'Tin nhắn này đang trả lời tin của bot: "' + o.replied.slice(0, 600) + '"\n' : '') +
    'Bản nháp bữa ăn hiện tại (null nếu chưa có): ' + JSON.stringify(draft) + '\n' +
    'Tin nhắn mới: "' + (o.text || '') + '"' + (o.image ? ' (kèm ảnh ở trên)' : '') + '\n\n' +
    'Quy tắc:\n' +
    '- lien_quan: true nếu tin nhắn kể/sửa/bổ sung bữa ăn, hoặc gửi ảnh món ăn; false nếu là chuyện khác.\n' +
    '- Cập nhật bản nháp theo tin mới và trả về bản nháp ĐẦY ĐỦ; trường nào người dùng không nhắc thì giữ nguyên.\n' +
    '- nguoi: mảng gồm "Long" và/hoặc "Uyn". Mặc định chỉ người đang nhắn; thêm người kia nếu nói "cả hai", "hai đứa", "anh với em", "cả Uyn/anh Long nữa".\n' +
    '- bua: "Sáng"|"Trưa"|"Xế"|"Tối". Lấy theo lời người dùng, hoặc theo tin bot đang được trả lời, hoặc theo giờ hiện tại ' +
    '(trước 10h là Sáng, 10h–14h Trưa, 14h–17h Xế, sau 17h Tối). Ăn vặt/bữa chiều là Xế, ăn khuya là Tối.\n' +
    '- ngay: 0 là hôm nay, -1 là hôm qua.\n' +
    '- ten_mon: tên ngắn gọn các món, nối bằng " + ", viết hoa chữ đầu (vd "Cơm gà + canh rau ngót").\n' +
    '- kcal, dam_g, tinh_bot_g, beo_g, xo_g: tổng cho 1 người, khẩu phần thông thường ở Việt Nam (dựa vào ảnh nếu có; "ăn ít/nửa suất" thì giảm). ' +
    'Nếu người dùng tự nói số kcal thì dùng đúng số đó, đặt kcal_do_nguoi_dung=true và chỉnh đạm/tinh bột/béo/xơ theo tỉ lệ.\n' +
    '- khau_vi: "Ngon"|"Không ngon"|"Tệ" nếu người dùng có nói, không thì "".\n' +
    '- bo_bua: true nếu nói nhịn/bỏ bữa. huy: true nếu muốn huỷ/không ghi nữa.\n' +
    '- nhan_xet: 1 câu nhận xét dinh dưỡng ngắn, thân thiện. tra_loi: nếu lien_quan=false thì 1 câu trả lời ngắn thân thiện (xưng "mình"), ngược lại "".\n' +
    'Trả lời CHỈ một đối tượng JSON theo mẫu: {"lien_quan":true,"huy":false,"nguoi":["Long"],"bua":"Tối","ngay":0,"ten_mon":"","kcal":0,' +
    '"dam_g":0,"tinh_bot_g":0,"beo_g":0,"xo_g":0,"kcal_do_nguoi_dung":false,"khau_vi":"","bo_bua":false,"nhan_xet":"","tra_loi":""}';
  var content = [];
  if (o.image) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: o.image } });
  content.push({ type: 'text', text: prompt });
  return callAI(content);
}
