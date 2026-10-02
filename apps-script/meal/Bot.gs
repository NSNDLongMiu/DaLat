// ============================================================
// Bot.gs — chat với bot Telegram trong group để ghi bữa ăn hộ (thuộc project "meal")
// ============================================================
// Cách hoạt động:
//   - Telegram gửi tin nhắn dành cho bot tới doPost (webhook) → handleTelegramUpdate().
//   - Trong group: tin nhắn gửi bot phải @tag tên bot HOẶC trả lời (reply) 1 tin của bot, không thì bỏ qua.
//     Nhắn riêng với bot thì không cần tag. Tên bot lấy tự động qua getMe (lưu ở Script Property TELEGRAM_BOT_USERNAME).
//     Ảnh gửi kèm chú thích có @tag bot, hoặc gửi bằng cách reply tin của bot. Không cần tắt Privacy Mode vì
//     tin có @tag và tin reply bot luôn tới được bot.
//   - AI đọc tin nhắn (+ ảnh nếu có) → bản nháp bữa ăn → bot gửi tóm tắt kèm nút.
//     Trả lời tin tóm tắt để sửa (kcal, bữa, món, thêm ảnh...). Bấm Ngon/Không ngon/Tệ mới ghi vào tab Meals.
//   - Bot tự biết ai đang nhắn theo username Telegram (TG_USERS bên dưới), người khác bị bỏ qua.
// Cài đặt: xem apps-script/README.md, mục "Chat với bot".

// false = bot không trả lời chat nữa. Độc lập với TELEGRAM_ENABLED (công tắc tin nhắc tự động).
var TELEGRAM_BOT_ENABLED = true;
// Username Telegram (chữ thường, không có @) -> tên lưu trong Sheet. Ai đổi username thì sửa ở đây.
var TG_USERS = { 'llong_llong': 'Long', 'minhuyennn': 'Uyn' };
// TẠM THỜI để chẩn đoán: true = ai trong group cũng dùng được bot, người lạ tính là TG_TEMP_FALLBACK_PERSON.
// Chạy ổn rồi thì đặt lại false (nếu không, ai trong group cũng ghi được bữa ăn vào Sheet).
var TG_TEMP_ALLOW_ANYONE = false;
var TG_TEMP_FALLBACK_PERSON = 'Long';
// TẠM THỜI: true = bot gửi dòng "🔧 debug" cho mỗi tin nhận được. Chạy ổn rồi thì đặt false.
var TG_DEBUG = false;
var TG_DRAFT_TTL =6 * 3600;   // bản nháp giữ tối đa 6 giờ (giới hạn của CacheService)
var TG_MEALS = ['Sáng', 'Trưa', 'Xế', 'Tối'];
var TG_SHARE = { 'Sáng': 0.25, 'Trưa': 0.35, 'Xế': 0.10, 'Tối': 0.30 };   // giống MEALS trong an-uong.html
var TG_TASTES = ['Ngon', 'Không ngon', 'Tệ'];
var TG_HELP = '🤖 Mình giúp ghi bữa ăn vào app.\n' +
  '• Trong group, mỗi tin gửi bot phải @tag tên bot hoặc trả lời (reply) 1 tin của bot, ví dụ: <i>@tên_bot tối nay ăn cơm gà với canh rau ngót</i> (nhắn riêng thì không cần).\n' +
  '• Gửi kèm ảnh món (chú thích có @tag bot, hoặc reply tin của bot) để ước tính kcal chuẩn hơn và lưu ảnh vào app.\n' +
  '• Mình gửi bản nháp: trả lời (reply) bản nháp để sửa, bấm 😋/😕/🤢 để lưu, ❌ để huỷ.\n' +
  '• @tên_bot /huy: huỷ bản nháp.';

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
  if (!r || !r.ok) Logger.log('sendMessage lỗi: ' + (r ? r.description : 'không gọi được Telegram (thiếu TELEGRAM_BOT_TOKEN?)'));
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

// Username của bot (chữ thường, không có @), lấy 1 lần qua getMe rồi lưu lại.
function tgBotUsername() {
  var props = PropertiesService.getScriptProperties();
  var name = props.getProperty('TELEGRAM_BOT_USERNAME');
  if (!name) {
    var r = tgApi('getMe', {});
    name = r && r.ok && r.result && r.result.username ? String(r.result.username).toLowerCase() : '';
    if (name) props.setProperty('TELEGRAM_BOT_USERNAME', name);
  }
  return name || '';
}

// Tách @tag bot khỏi tin nhắn. Trả về { tagged: có tag hay không, text: nội dung đã bỏ tag }.
function tgStripBotTag(raw) {
  var name = tgBotUsername();
  var re = name ? new RegExp('@' + name + '(?![A-Za-z0-9_])', 'gi') : /@\w*bot\b/gi;
  var tagged = re.test(raw);
  re.lastIndex = 0;
  return { tagged: tagged, text: String(raw).replace(re, ' ').replace(/\s+/g, ' ').trim() };
}

// Tin này có phải đang trả lời (reply) 1 tin do chính bot này gửi không.
function tgRepliesToBot(msg) {
  var from = msg.reply_to_message && msg.reply_to_message.from;
  if (!from || !from.is_bot) return false;
  var name = tgBotUsername();
  return !name || String(from.username || '').toLowerCase() === name;
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
  // Có TELEGRAM_PROXY_URL (Cloudflare Worker, xem apps-script/telegram-proxy) thì Telegram gọi Worker để tránh lỗi 302
  // của Apps Script; Worker kiểm tra secret_token rồi chuyển tin sang url?tg=secret. Không có thì gọi thẳng Apps Script.
  var proxy = props.getProperty('TELEGRAM_PROXY_URL');
  var hook = { allowed_updates: ['message', 'callback_query'], drop_pending_updates: true };
  if (proxy) { hook.url = proxy; hook.secret_token = secret; } else { hook.url = url + '?tg=' + secret; }
  var r = tgApi('setWebhook', hook);
  return { ok: !!(r && r.ok), telegram: r ? r.description : 'không gọi được Telegram (thiếu TELEGRAM_BOT_TOKEN?)', mode: proxy ? 'proxy' : 'direct', url: proxy || url };
}

function telegramWebhookInfo() {
  var r = tgApi('getWebhookInfo', {}) || { ok: false };
  if (r.result && r.result.url) r.result.url = r.result.url.replace(/\?tg=.*/, '?tg=***');
  return r;
}

// TẠM THỜI: bot gửi lại 1 dòng "🔧 debug" cho mỗi tin nhận được (kể cả tin bị bỏ qua), để thấy tin có tới script không.
function tgDebugEcho(e, upd, secret) {
  var m = upd.message;
  if (!m || !m.chat) return;
  var cache = CacheService.getScriptCache();
  if (cache.get('tgdbg_' + upd.update_id)) return;
  cache.put('tgdbg_' + upd.update_id, '1', 3600);
  var f = m.from || {};
  tgSend(m.chat.id, '🔧 <b>debug</b> update ' + upd.update_id + '\n' +
    'chat: <code>' + m.chat.id + '</code> (' + m.chat.type + ')\n' +
    'từ: @' + tgEsc(f.username || '(không username)') + ' · id ' + f.id + ' · is_bot=' + !!f.is_bot + (m.sender_chat ? ' · sender_chat=' + m.sender_chat.id : '') + '\n' +
    'mã bí mật: ' + (secret && (e.parameter || {}).tg === secret ? 'đúng' : 'SAI/thiếu') + '\n' +
    'group đã cấu hình: ' + (String(m.chat.id) === tgGroupId() ? 'khớp' : 'KHÔNG khớp (' + tgGroupId() + ')') + '\n' +
    'tag bot: ' + (tgStripBotTag(m.text || m.caption || '').tagged ? 'có' : 'không') + ' · reply bot: ' + (tgRepliesToBot(m) ? 'có' : 'không') + '\n' +
    'text: ' + tgEsc(String(m.text || m.caption || '').slice(0, 80)));
}

function handleTelegramUpdate(e, upd) {
  var secret = PropertiesService.getScriptProperties().getProperty('TELEGRAM_WEBHOOK_SECRET');
  if (TG_DEBUG) { try { tgDebugEcho(e, upd, secret); } catch (err) { Logger.log('debug lỗi: ' + err); } }
  if (!secret || (e.parameter || {}).tg !== secret) { Logger.log('Bot bỏ qua: sai/thiếu mã bí mật ?tg= (update ' + upd.update_id + ')'); return; }
  if (!TELEGRAM_BOT_ENABLED) { Logger.log('Bot bỏ qua: TELEGRAM_BOT_ENABLED = false'); return; }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) { Logger.log('Bot bỏ qua: không lấy được khoá (update ' + upd.update_id + ')'); return; }
  try {
    // Web App trả 302 nên Telegram có thể gửi lại cùng 1 update — đã xử lý thì bỏ qua.
    var cache = CacheService.getScriptCache();
    var seenKey = 'tgupd_' + upd.update_id;
    if (cache.get(seenKey)) { Logger.log('Bot bỏ qua: update ' + upd.update_id + ' đã xử lý rồi'); return; }
    var m = upd.message || {};
    Logger.log('Bot nhận update ' + upd.update_id + ': chat=' + (m.chat && m.chat.id) + ' (' + (m.chat && m.chat.type) + ') từ @' +
      ((m.from && m.from.username) || '?') + ' text="' + String(m.text || m.caption || '').slice(0, 60) + '"');
    cache.put(seenKey, '1', 21600);
    if (upd.callback_query) tgOnCallback(upd.callback_query);
    else if (upd.message) tgOnMessage(upd.message);
  } catch (err) {
    Logger.log('Bot lỗi: ' + err);
    // Báo lỗi ra chat (chỉ group đã cấu hình hoặc chat riêng) để khỏi phải mở log mới biết bot hỏng chỗ nào.
    var em = upd.message;
    if (em && em.chat && (String(em.chat.id) === tgGroupId() || em.chat.type === 'private')) {
      tgSend(em.chat.id, '😵 Lỗi nội bộ: <code>' + tgEsc(String(err && err.stack || err).slice(0, 300)) + '</code>', { reply_to_message_id: em.message_id });
    }
  } finally {
    lock.releaseLock();
  }
}

// ---------- Người dùng ----------
function tgGroupId() {
  return String(PropertiesService.getScriptProperties().getProperty('TELEGRAM_CHAT_ID') || '');
}
// Nhận ra người nhắn theo username Telegram (chữ thường, không có @).
function tgPersonOf(user) {
  var known = TG_USERS[String((user && user.username) || '').toLowerCase()];
  if (known) return known;
  return TG_TEMP_ALLOW_ANYONE ? TG_TEMP_FALLBACK_PERSON : null;
}
// Chỉ phục vụ group đã cấu hình, hoặc nhắn riêng từ Anh Long / Bé Uyn.
function tgChatAllowed(chat, user) {
  if (String(chat.id) === tgGroupId()) return true;
  return chat.type === 'private' && !!tgPersonOf(user);
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
  var person = tgPersonOf(msg.from);
  if (!tgChatAllowed(chat, msg.from)) {
    Logger.log('Bot bỏ qua: chat ' + chat.id + ' không được phép (TELEGRAM_CHAT_ID=' + tgGroupId() + ', người nhắn @' + (msg.from.username || '?') + ')');
    if (chat.type === 'private') tgSend(chat.id, 'Bot này chỉ dùng cho Anh Long và Bé Uyn thôi nha.');
    else if (tgStripBotTag(msg.text || msg.caption || '').tagged) {
      // Group lạ (hoặc id group trong TELEGRAM_CHAT_ID bị sai/đổi) mà có tag bot: báo id thật để sửa Script Property.
      tgSend(chat.id, 'Group này (id <code>' + chat.id + '</code>) chưa được cấu hình. Nếu đúng group của mình, hãy đặt Script Property <b>TELEGRAM_CHAT_ID</b> = <code>' + chat.id + '</code>.',
        { reply_to_message_id: msg.message_id });
    }
    return;
  }
  if (!person) {   // người lạ trong group
    Logger.log('Bot bỏ qua: username @' + (msg.from.username || '(không có)') + ' không có trong TG_USERS');
    if (tgStripBotTag(msg.text || msg.caption || '').tagged || tgRepliesToBot(msg)) {
      tgSend(chat.id, msg.from.username
        ? 'Mình chưa nhận ra username <code>@' + tgEsc(msg.from.username) + '</code>. Nếu đây là bạn, hãy thêm username này vào <b>TG_USERS</b> ở đầu Bot.gs.'
        : 'Tài khoản của bạn chưa đặt username Telegram nên mình không nhận ra. Hãy đặt username trong Cài đặt Telegram rồi thêm vào <b>TG_USERS</b> ở Bot.gs.',
        { reply_to_message_id: msg.message_id });
    }
    return;
  }
  var stripped = tgStripBotTag(msg.text || msg.caption || '');
  // Trong group: phải @tag bot hoặc trả lời (reply) 1 tin của bot thì bot mới nhận.
  if (chat.type !== 'private' && !stripped.tagged && !tgRepliesToBot(msg)) {
    Logger.log('Bot bỏ qua: tin trong group không @' + tgBotUsername() + ' và không reply tin của bot');
    return;
  }
  var text = stripped.text;
  var cmd = (/^\/(\w+)/.exec(text) || [])[1];
  if (cmd) text = text.replace(/^\/\w+/, '').trim();
  cmd = (cmd || '').toLowerCase();

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
  // Báo ngay là đang xử lý (AI mất vài giây), xong thì xoá tin này đi cho đỡ rối.
  var ack = tgSend(chat.id, '⏳ Em đang xử lý cho <b>' + tgEsc(dispName(person)) + '</b>, đợi em xíu nhé...', { reply_to_message_id: msg.message_id });
  try {
    tgHandleMeal(msg, person, text, photo, cmd === 'an');
  } catch (err) {
    Logger.log('Bot lỗi: ' + err);
    tgSend(chat.id, '😵 Em bị lỗi khi xử lý (' + tgEsc(String(err).slice(0, 150)) + '). Thử lại giúp em nhé.', { reply_to_message_id: msg.message_id });
  } finally {
    if (ack) tgApi('deleteMessage', { chat_id: chat.id, message_id: ack.message_id });
  }
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

// Nhắc người dùng @tag bot khi trả lời trong group (chat riêng không cần).
function tgTagHint(chat) {
  var name = tgBotUsername();
  return chat && chat.type !== 'private' && name ? '\n<i>(reply tin này hoặc @tag @' + name + ' khi trả lời nhé)</i>' : '';
}

// Hỏi thêm: bật khung trả lời cho đúng người được hỏi (force_reply + selective), để tin trả lời tới được bot.
function tgAskInDraft(d, msg, question) {
  var sent = tgSend(d.chatId, question + tgTagHint(msg.chat), {
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
  text += '\n\nTrả lời (reply) tin này để sửa hoặc bổ sung (vd: "650 kcal", "bữa trưa", "cả Uyn nữa")' +
    (d.photo || d.skip ? '' : ', hoặc reply bằng ảnh món để lưu kèm và ước tính chuẩn hơn') + '.\n' +
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
  var msg = cq.message;
  var answer = function (t) { tgApi('answerCallbackQuery', { callback_query_id: cq.id, text: t || '' }); };
  if (!msg || !tgChatAllowed(msg.chat, cq.from)) { answer(); return; }
  if (parts[0] !== 'sv' && parts[0] !== 'cx') { answer(); return; }
  if (!tgPersonOf(cq.from)) { answer('Nút này chỉ dành cho Anh Long và Bé Uyn.'); return; }
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
