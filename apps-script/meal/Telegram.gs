// ============================================================
// Telegram.gs — nhắc ăn uống và báo cáo qua Telegram (thuộc project "meal")
// ============================================================

// ============ TELEGRAM ============
// Token & Chat ID không nằm trong code — lưu ở Project Settings > Script Properties
// (Apps Script editor > biểu tượng bánh răng bên trái > Script Properties > Add script property):
//   TELEGRAM_BOT_TOKEN = token lấy từ @BotFather
//   TELEGRAM_CHAT_ID   = id của group (số âm, lấy qua getUpdates)
// Nhớ đặt múi giờ project về Asia/Ho_Chi_Minh (Project Settings > General settings) để
// các mốc giờ nhắc nhở bên dưới chạy đúng giờ Việt Nam.

var SNACK_POOL_GS = [
  'Sữa chua + granola', 'Chuối chín', 'Sữa hạt óc chó/hạnh nhân', 'Bánh mì bơ đậu phộng',
  'Súp gà nhẹ', 'Cháo yến mạch', 'Chè đậu xanh ít ngọt', 'Trái cây theo mùa',
  'Sinh tố bơ chuối', 'Khoai lang hấp', 'Ngũ cốc + sữa tươi', 'Bánh flan',
];
var VEGGIE_POOL_GS = [
  'Canh rau ngót', 'Rau luộc chấm kho quẹt', 'Salad trộn dầu giấm', 'Nộm đu đủ/su hào',
  'Rau xào tỏi', 'Sinh tố rau củ', 'Canh bí đỏ', 'Rau cải luộc',
];
var MEAL_IDEA_POOL_GS = [
  'Cơm gà xé', 'Bún bò', 'Phở gà', 'Bánh cuốn', 'Mì trộn', 'Cơm sườn',
  'Bún riêu', 'Bánh mì trứng ốp la', 'Cháo sườn', 'Xôi mặn', 'Cơm tấm', 'Bánh canh',
];
var FRUIT_DESSERT_POOL_GS = [
  'Cam', 'Xoài', 'Dưa hấu', 'Chuối', 'Nho', 'Thanh long', 'Táo', 'Chè trôi nước',
  'Bánh flan', 'Sữa chua', 'Rau câu', 'Chè đậu xanh',
];

function pickRandomGS(pool, count) {
  var copy = pool.slice();
  var out = [];
  while (copy.length && out.length < count) {
    out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  }
  return out;
}

function sendTelegram(text) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('TELEGRAM_BOT_TOKEN');
  var chatId = props.getProperty('TELEGRAM_CHAT_ID');
  if (!token || !chatId) {
    Logger.log('Thiếu TELEGRAM_BOT_TOKEN hoặc TELEGRAM_CHAT_ID trong Script Properties.');
    return;
  }
  UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
    method: 'post',
    payload: { chat_id: chatId, text: text, parse_mode: 'HTML' },
    muteHttpExceptions: true,
  });
}

function todayStrGS() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

// Gọi ngay sau khi ghi 1 bữa — báo lập tức nếu bỏ bữa / ăn ít / không ngon.
function notifyIfMealIsRough(data) {
  var isRough = data.portion === 'Bỏ bữa' || data.portion === 'Ăn ít' || data.taste === 'Không ngon' || data.taste === 'Tệ';
  if (!isRough) return;

  var who = normPerson(data.person);
  var lines = ['⚠️ <b>' + who + '</b> · <b>' + data.meal + '</b> hôm nay: ' + (data.portion || '') + (data.taste ? ' · ' + data.taste : '')];
  if (data.food) lines.push('Món: ' + data.food);
  lines.push('');
  lines.push('🍪 Gợi ý ăn bù nhẹ: ' + pickRandomGS(SNACK_POOL_GS, 3).join(', '));
  if (data.veggie === 'Không rau' || !data.veggie) {
    lines.push('🥗 Đừng quên rau: ' + pickRandomGS(VEGGIE_POOL_GS, 2).join(', '));
  }
  sendTelegram(lines.join('\n'));
}

// ============ 8 JOB TỰ ĐỘNG NHẮC ĂN UỐNG QUA TELEGRAM (tính riêng từng người: Long, Uyn) ============
// Lịch chạy: xem installDailyTriggers() ở cuối file.

var MEAL_SHARE_GS = { 'Sáng': 0.25, 'Trưa': 0.35, 'Tối': 0.30 };

function getTodayMeals(person) {
  var ss = getDataSpreadsheet();
  var meals = readSheet(ss, 'Meals', MEAL_KEYS);
  var today = todayStrGS();
  return meals.filter(function (m) {
    return m.date === today && (!person || normPerson(m.person) === person);
  });
}

function mealIsBad(m) {
  return m.portion === 'Bỏ bữa' || m.portion === 'Ăn ít' || m.taste === 'Không ngon' || m.taste === 'Tệ';
}

// Đạm / tinh bột / béo / chất xơ ghi ở đầu Note: "[650 kcal P30 C80 F20 S6 AI] ...". Không có thì trả null.
function macrosOfMeal(m) {
  var r = /^\[\d+\s*kcal((?:\s+[PCFS]\d+(?:\.\d+)?)*)/i.exec(m.note || '');
  if (!r || !r[1].trim()) return null;
  var out = { p: 0, c: 0, f: 0, s: 0 };
  r[1].trim().split(/\s+/).forEach(function (t) { out[t.charAt(0).toLowerCase()] = Number(t.slice(1)) || 0; });
  return out;
}

// Số kcal ghi ở đầu cột Note dạng "[650 kcal] ..." (giống an-uong.html). Không có thì trả null.
function kcalOfMeal(m) {
  var r = /^\[(\d+)\s*kcal/i.exec(m.note || '');
  return r ? Number(r[1]) : null;
}

// kcal của 1 dòng bữa ăn; bữa ghi từ trước khi có kcal thì ước lượng thô theo phần chia của bữa.
function kcalOrEstimate(m, goal) {
  if (m.portion === 'Bỏ bữa') return 0;
  var k = kcalOfMeal(m);
  if (k !== null) return k;
  return Math.round(goal * (MEAL_SHARE_GS[m.meal] || 0.1) * (m.portion === 'Ăn ít' ? 0.6 : 1));
}

// Mục tiêu kcal/ngày của 1 người, tính từ hồ sơ (cùng công thức Mifflin-St Jeor như an-uong.html).
function goalOfPerson(person) {
  var p = readProfile(person);
  if (!p || !p.sex || !p.age || !p.height || !p.weight) return 2000;
  var bmr = 10 * p.weight + 6.25 * p.height - 5 * p.age + (p.sex === 'nam' ? 5 : -161);
  var tdee = bmr * Number(p.act || 1.2);
  var floor = p.sex === 'nam' ? 1500 : 1200;
  var target = tdee;
  if (p.plan === 'lose') target = Math.max(floor, Math.max(tdee - 500, bmr));
  if (p.plan === 'gain') target = tdee + 300;
  return Math.round(target / 10) * 10;
}

// Tình trạng ăn hôm nay của 1 người: đã nhập gì, ăn được bao nhiêu kcal, bữa nào thiếu.
function personDayStatus(person) {
  var meals = getTodayMeals(person);
  var goal = goalOfPerson(person);
  var byMeal = {};
  var kcal = 0;
  meals.forEach(function (m) {
    (byMeal[m.meal] = byMeal[m.meal] || []).push(m);
    kcal += kcalOrEstimate(m, goal);
  });
  var missing = [];   // chưa nhập
  var poor = [];      // bỏ bữa / ăn ít / không ngon
  ['Sáng', 'Trưa', 'Tối'].forEach(function (name) {
    var list = byMeal[name] || [];
    if (!list.length) missing.push(name);
    else if (list.some(mealIsBad)) poor.push(name);
  });
  return { person: person, meals: meals, byMeal: byMeal, goal: goal, kcal: kcal, missing: missing, poor: poor };
}

// Nhắc những ai chưa nhập bữa `mealName` (chỉ nêu tên người chưa nhập, ai nhập rồi thì không nhắc).
function remindWhoNotLogged(mealName) {
  var who = PEOPLE_GS.filter(function (p) {
    return !(personDayStatus(p).byMeal[mealName] || []).length;
  });
  if (!who.length) return;
  sendTelegram('⏰ Chưa thấy <b>' + who.join(' và ') + '</b> cập nhật bữa ' + mealName + ' hôm nay — ăn xong nhớ ghi vào app nhé!');
}

// 1. 7h30 — nhắc chuẩn bị bữa sáng, kèm gợi ý random món ăn.
function remindPrepareBreakfast() {
  var picks = pickRandomGS(MEAL_IDEA_POOL_GS, 3);
  sendTelegram('🌅 7h30 rồi, chuẩn bị bữa sáng thôi Long, Uyn!\nGợi ý: ' + picks.join(', '));
}

// 2. 8h30 — nhắc ai chưa cập nhật bữa sáng vào app.
function remindUpdateBreakfast() {
  remindWhoNotLogged('Sáng');
}

// 3. 10h30 — nhắc chuẩn bị bữa trưa, kèm gợi ý random món ăn.
function remindPrepareLunch() {
  var picks = pickRandomGS(MEAL_IDEA_POOL_GS, 3);
  sendTelegram('☀️ 10h30 rồi, chuẩn bị bữa trưa thôi Long, Uyn!\nGợi ý: ' + picks.join(', '));
}

// 4. 12h30 — nhắc ai chưa cập nhật bữa trưa vào app.
function remindUpdateLunch() {
  remindWhoNotLogged('Trưa');
}

// 5. ~13h00 — nói rõ ai cần ăn thêm đồ chiều nếu sáng/trưa chưa nhập, bỏ bữa, ăn không ngon hoặc quá ít
//    (chưa nhập coi như chưa ăn để không bỏ sót). Ai ổn thì không nhắc.
function alertAfternoonFoodIfNeeded() {
  var lines = [];
  PEOPLE_GS.forEach(function (person) {
    var st = personDayStatus(person);
    var noLog = ['Sáng', 'Trưa'].filter(function (n) { return st.missing.indexOf(n) !== -1; });
    var bad = ['Sáng', 'Trưa'].filter(function (n) { return st.poor.indexOf(n) !== -1; });
    var eatenMain = 0;
    ['Sáng', 'Trưa'].forEach(function (n) {
      (st.byMeal[n] || []).forEach(function (m) { eatenMain += kcalOrEstimate(m, st.goal); });
    });
    var expected = Math.round(st.goal * (MEAL_SHARE_GS['Sáng'] + MEAL_SHARE_GS['Trưa']));
    var thin = eatenMain < expected * 0.6;
    if (!noLog.length && !bad.length && !thin) return;

    var why = [];
    if (noLog.length) why.push('chưa nhập bữa ' + noLog.join(', '));
    if (bad.length) why.push('bữa ' + bad.join(', ') + ' bỏ/ăn ít/không ngon');
    if (thin && !noLog.length) why.push('sáng + trưa mới ~' + eatenMain + '/' + expected + ' kcal');
    var need = Math.max(0, Math.round((st.goal - eatenMain) / 10) * 10);
    lines.push('• <b>' + person + '</b>: ' + why.join('; ') + ' → cần ăn thêm đồ chiều; còn thiếu ~' + need + ' kcal cho chiều + tối.');
  });
  if (!lines.length) return;
  sendTelegram('⚠️ <b>Cần đặt thêm đồ ăn chiều nay</b>\n' + lines.join('\n') + '\nĐừng để đói bụng nhé!');
}

// 6. 17h30 — nhắc chuẩn bị bữa tối, gợi ý món chính + tráng miệng/hoa quả.
function remindPrepareDinner() {
  var mains = pickRandomGS(MEAL_IDEA_POOL_GS, 2);
  var desserts = pickRandomGS(FRUIT_DESSERT_POOL_GS, 2);
  sendTelegram('🌙 17h30 rồi, chuẩn bị bữa tối thôi Long, Uyn!\nMón chính gợi ý: ' + mains.join(', ') + '\nTráng miệng/hoa quả: ' + desserts.join(', '));
}

// 7. 20h00 — nhắc ai chưa cập nhật bữa tối vào app.
function remindUpdateDinner() {
  remindWhoNotLogged('Tối');
}

// 8. 21h00 — báo cáo tổng kết cả ngày, tách riêng từng người: ai chưa nhập, ai ăn thiếu, ai cần ăn thêm.
function sendDailyReport() {
  var lines = ['📋 <b>Báo cáo ăn uống hôm nay (' + todayStrGS() + ')</b>'];
  var notEntered = [], undereat = [], needMore = [];

  PEOPLE_GS.forEach(function (person) {
    var st = personDayStatus(person);
    var pct = Math.round(st.kcal / st.goal * 100);
    lines.push('');
    lines.push('👤 <b>' + person + '</b> — ' + st.meals.length + ' bữa · ' + st.kcal + '/' + st.goal + ' kcal (' + pct + '%)');
    if (!st.meals.length) {
      notEntered.push(person);
      needMore.push(person + ' (~' + st.goal + ' kcal)');
      lines.push('  ❌ Chưa nhập gì hôm nay.');
      return;
    }
    if (st.missing.length) lines.push('  Chưa nhập: ' + st.missing.join(', ') + '.');
    var skipped = st.meals.filter(function (m) { return m.portion === 'Bỏ bữa'; });
    if (skipped.length) lines.push('  Bỏ bữa: ' + skipped.map(function (m) { return m.meal; }).join(', ') + '.');
    var rough = st.meals.filter(function (m) { return m.portion === 'Ăn ít' || m.taste === 'Không ngon' || m.taste === 'Tệ'; });
    if (rough.length) lines.push('  Ăn ít/không ngon: ' + rough.map(function (m) { return m.meal; }).join(', ') + '.');
    var hasVeggie = st.meals.some(function (m) { return m.veggie === 'Có rau' || m.veggie === 'Nhiều rau'; });
    lines.push(hasVeggie ? '  Có ăn rau. 👍' : '  Chưa ăn rau hôm nay.');
    // Tổng dinh dưỡng của những bữa đã có số đo (bữa cũ chưa có thì bỏ qua).
    var macroSum = { p: 0, c: 0, f: 0, s: 0 }, macroMeals = 0;
    st.meals.forEach(function (m) {
      var mc = macrosOfMeal(m);
      if (mc && m.portion !== 'Bỏ bữa') { macroSum.p += mc.p; macroSum.c += mc.c; macroSum.f += mc.f; macroSum.s += mc.s; macroMeals++; }
    });
    if (macroMeals) {
      lines.push('  Đạm ' + Math.round(macroSum.p) + 'g · Tinh bột ' + Math.round(macroSum.c) + 'g · Béo ' + Math.round(macroSum.f) + 'g · Xơ ' + Math.round(macroSum.s) + 'g');
    }

    if (pct < 80) {
      undereat.push(person + ' (' + pct + '%)');
      needMore.push(person + ' (~' + (st.goal - st.kcal) + ' kcal)');
      lines.push('  ⚠️ Ăn thiếu ~' + (st.goal - st.kcal) + ' kcal so với mục tiêu.');
    } else if (!st.missing.length && !skipped.length && !rough.length && hasVeggie) {
      lines.push('  ✅ Hôm nay ăn rất ổn.');
    }
  });

  lines.push('');
  lines.push('<b>Tóm tắt</b>');
  lines.push('• Chưa nhập: ' + (notEntered.length ? notEntered.join(', ') : 'không ai, cả hai đã nhập ✅'));
  lines.push('• Ăn thiếu (dưới 80% mục tiêu): ' + (undereat.length ? undereat.join(', ') : 'không ai'));
  lines.push('• Cần ăn thêm: ' + (needMore.length ? needMore.join(', ') + ' — ăn nhẹ trước khi ngủ hoặc bù vào sáng mai.' : 'không ai'));
  sendTelegram(lines.join('\n'));
}

// Chạy 1 LẦN bằng tay trong Apps Script editor (chọn hàm này > bấm Run) để cài đặt
// lịch tự động. Chạy lại vẫn an toàn — nó xoá trigger cũ cùng tên trước khi tạo lại.
function installDailyTriggers() {
  var handlers = [
    'remindPrepareBreakfast', 'remindUpdateBreakfast',
    'remindPrepareLunch', 'remindUpdateLunch',
    'alertAfternoonFoodIfNeeded',
    'remindPrepareDinner', 'remindUpdateDinner',
    'sendDailyReport',
  ];
  var existing = ScriptApp.getProjectTriggers();
  existing.forEach(function (t) {
    if (handlers.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger('remindPrepareBreakfast').timeBased().atHour(7).nearMinute(30).everyDays(1).create();
  ScriptApp.newTrigger('remindUpdateBreakfast').timeBased().atHour(8).nearMinute(30).everyDays(1).create();
  ScriptApp.newTrigger('remindPrepareLunch').timeBased().atHour(10).nearMinute(30).everyDays(1).create();
  ScriptApp.newTrigger('remindUpdateLunch').timeBased().atHour(12).nearMinute(30).everyDays(1).create();
  ScriptApp.newTrigger('alertAfternoonFoodIfNeeded').timeBased().atHour(13).nearMinute(0).everyDays(1).create();
  ScriptApp.newTrigger('remindPrepareDinner').timeBased().atHour(17).nearMinute(30).everyDays(1).create();
  ScriptApp.newTrigger('remindUpdateDinner').timeBased().atHour(20).nearMinute(0).everyDays(1).create();
  ScriptApp.newTrigger('sendDailyReport').timeBased().atHour(21).nearMinute(0).everyDays(1).create();

  Logger.log('Đã cài xong 8 trigger hằng ngày.');
}
