// Dán toàn bộ file này vào 1 project Apps Script (script.google.com > New project).
// Không cần tự tạo Google Sheet — hàm getDataSpreadsheet() bên dưới tự tạo 1 Sheet mới
// (tên "DaLat Data") trong Drive của bạn ở lần chạy đầu tiên, và ghi nhớ ID của nó trong
// Script Properties để lần sau dùng lại đúng Sheet đó.
// Sau khi Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone),
// copy URL kết thúc bằng /exec và dán vào GAS_ENDPOINT trong index.html, viewer.html, an-uong.html.

// Trả về Spreadsheet dùng để lưu dữ liệu — tự tạo mới nếu chưa có, dùng lại nếu đã có.
function getDataSpreadsheet() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('DATA_SHEET_ID');
  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (err) {
      // Sheet cũ có thể đã bị xoá — tạo lại bên dưới.
    }
  }
  var ss = SpreadsheetApp.create('DaLat Data');
  props.setProperty('DATA_SHEET_ID', ss.getId());
  return ss;
}

var MEAL_HEADERS = ['Time', 'Date', 'Meal', 'Food', 'Portion', 'Taste', 'Veggie', 'Note', 'Photo'];

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var ss = getDataSpreadsheet();
    var photoId = '';

    if (data.kind === 'gate-log') {
      var logSheet = getOrCreateSheet(ss, 'GateLog', ['Time', 'Name', 'IP', 'Question', 'Answer']);
      logSheet.appendRow([data.time || '', data.name || '', data.ip || '', data.question || '', data.answer || '']);
    } else if (data.kind === 'feedback') {
      var fbSheet = getOrCreateSheet(ss, 'Feedback', ['Time', 'Name', 'Text']);
      fbSheet.appendRow([data.time || '', data.name || '', data.text || '']);
    } else if (data.kind === 'meal') {
      var mealSheet = getOrCreateSheet(ss, 'Meals', MEAL_HEADERS);
      photoId = data.photo ? savePhotoToDrive(data.photo) : '';
      mealSheet.appendRow([
        data.time || '', "'" + (data.date || ''), data.meal || '', data.food || '',
        data.portion || '', data.taste || '', data.veggie || '', data.note || '', photoId,
      ]);
      notifyIfMealIsRough(data);
    } else if (data.kind === 'meal-update') {
      // Chỉ cho sửa bữa của đúng ngày hôm nay — chặn sửa bữa của ngày khác kể cả khi
      // ai đó cố gọi thẳng API (phòng trường hợp bỏ qua giới hạn ở giao diện).
      var mealSheet2 = getOrCreateSheet(ss, 'Meals', MEAL_HEADERS);
      var allRows = mealSheet2.getDataRange().getValues();
      var foundRow = -1;
      for (var i = 1; i < allRows.length; i++) {
        if (allRows[i][0] === data.id) { foundRow = i; break; }
      }
      if (foundRow === -1) {
        return jsonOutput({ ok: false, error: 'không tìm thấy bữa để cập nhật' });
      }
      if (allRows[foundRow][1] !== todayStrGS()) {
        return jsonOutput({ ok: false, error: 'chỉ được sửa bữa của hôm nay' });
      }
      // Có ảnh mới thì upload thay ảnh cũ; không thì giữ nguyên ảnh cũ (photoId truyền lên từ client).
      photoId = data.photo ? savePhotoToDrive(data.photo) : (data.photoId || '');
      // Ghi lại cả cột Time — cho phép chỉnh giờ ăn khi sửa; nếu client không gửi thì giữ giờ gốc.
      mealSheet2.getRange(foundRow + 1, 1, 1, 9).setValues([[
        data.time || allRows[foundRow][0], "'" + (data.date || ''), data.meal || '', data.food || '',
        data.portion || '', data.taste || '', data.veggie || '', data.note || '', photoId,
      ]]);
    } else if (data.kind === 'meal-delete') {
      // Chỉ cho xoá bữa của đúng ngày hôm nay — chặn xoá bữa của ngày khác kể cả khi
      // ai đó cố gọi thẳng API (phòng trường hợp bỏ qua giới hạn ở giao diện).
      var mealSheet3 = getOrCreateSheet(ss, 'Meals', MEAL_HEADERS);
      var allRows3 = mealSheet3.getDataRange().getValues();
      var foundRow3 = -1;
      for (var j = 1; j < allRows3.length; j++) {
        if (allRows3[j][0] === data.id) { foundRow3 = j; break; }
      }
      if (foundRow3 === -1) {
        return jsonOutput({ ok: false, error: 'không tìm thấy bữa để xoá' });
      }
      if (allRows3[foundRow3][1] !== todayStrGS()) {
        return jsonOutput({ ok: false, error: 'chỉ được xoá bữa của hôm nay' });
      }
      mealSheet3.deleteRow(foundRow3 + 1);
    } else if (data.kind === 'ai-estimate') {
      return jsonOutput(aiEstimateCalories(data));
    } else if (data.kind === 'ai-suggest') {
      return jsonOutput(aiSuggestMeals(data));
    } else if (data.kind === 'profile') {
      // Hồ sơ chỉ số cơ thể (1 bản duy nhất) — lưu trong Script Properties cho gọn.
      PropertiesService.getScriptProperties().setProperty('USER_PROFILE', JSON.stringify(data.profile || null));
    } else {
      return jsonOutput({ ok: false, error: 'unknown kind' });
    }

    return jsonOutput({ ok: true, photoId: photoId });
  } catch (err) {
    return jsonOutput({ ok: false, error: String(err) });
  }
}

// Trả về thư mục Drive dùng để lưu ảnh món ăn — tự tạo mới nếu chưa có.
function getPhotoFolder() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('PHOTO_FOLDER_ID');
  if (id) {
    try {
      return DriveApp.getFolderById(id);
    } catch (err) {
      // Thư mục cũ có thể đã bị xoá — tạo lại bên dưới.
    }
  }
  var folder = DriveApp.createFolder('DaLat Meal Photos');
  props.setProperty('PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

// Giải mã ảnh dạng data URL (data:image/jpeg;base64,....) do trình duyệt gửi lên,
// lưu vào Drive, mở quyền xem qua link, và trả về ID file để lưu trong Sheet.
function savePhotoToDrive(dataUrl) {
  var match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl || '');
  if (!match) return '';
  var mimeType = match[1];
  var bytes = Utilities.base64Decode(match[2]);
  var blob = Utilities.newBlob(bytes, mimeType, 'meal-' + Date.now() + '.jpg');
  var file = getPhotoFolder().createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getId();
}

function doGet(e) {
  var kind = (e.parameter.kind || '').toLowerCase();
  var ss = getDataSpreadsheet();

  if (kind === 'gate-log') {
    return jsonOutput(readSheet(ss, 'GateLog', ['time', 'name', 'ip', 'question', 'answer']));
  }
  if (kind === 'feedback') {
    return jsonOutput(readSheet(ss, 'Feedback', ['time', 'name', 'text']));
  }
  if (kind === 'meal') {
    var meals = readSheet(ss, 'Meals', ['time', 'date', 'meal', 'food', 'portion', 'taste', 'veggie', 'note', 'photo']);
    // Tương thích dữ liệu cũ lưu dạng yes/no trước khi có 3 mức rau củ.
    meals.forEach(function (m) {
      if (m.veggie === 'yes') m.veggie = 'Có rau';
      else if (m.veggie === 'no' || !m.veggie) m.veggie = 'Không rau';
    });
    return jsonOutput(meals);
  }
  // Endpoint tạm để debug: xem đúng định dạng ô + kiểu giá trị thật trong tab Meals.
  // Xoá đoạn này sau khi hết cần debug.
  if (kind === 'debug') {
    var dsheet = ss.getSheetByName('Meals');
    if (!dsheet) return jsonOutput({ ok: false, error: 'chưa có tab Meals', version: 'debug-2026-09-29c-apostrophe' });
    var lastRow = Math.max(dsheet.getLastRow(), 1);
    var range = dsheet.getRange(1, 1, Math.min(lastRow, 10), 9);
    var values = range.getValues();
    var formats = range.getNumberFormats();
    var types = values.map(function (row) {
      return row.map(function (c) { return Object.prototype.toString.call(c); });
    });
    return jsonOutput({ ok: true, version: 'debug-2026-09-29c-apostrophe', values: values, formats: formats, types: types });
  }
  // Endpoint tạm để dọn dẹp: xoá tab Meals (nếu có) để lần ghi tiếp theo tạo lại đúng
  // định dạng "Plain text". Xoá đoạn này sau khi hết cần debug.
  if (kind === 'reset-meals') {
    var rsheet = ss.getSheetByName('Meals');
    if (rsheet) {
      ss.deleteSheet(rsheet);
      return jsonOutput({ ok: true, deleted: true });
    }
    return jsonOutput({ ok: true, deleted: false, note: 'không có tab Meals để xoá' });
  }
  // Cài đặt (hoặc cài lại) 8 trigger nhắc nhở/báo cáo hằng ngày qua Telegram.
  // Cần quyền script.scriptapp — nếu chưa được cấp, gọi sẽ báo lỗi rõ ràng.
  if (kind === 'install-triggers') {
    try {
      installDailyTriggers();
      return jsonOutput({ ok: true });
    } catch (err) {
      return jsonOutput({ ok: false, error: String(err) });
    }
  }
  // Gọi thử ngay 1 job nhắc nhở/báo cáo mà không cần chờ đúng giờ trigger — để kiểm tra
  // Telegram có nhận được tin không. Chỉ cho phép gọi đúng tên hàm nằm trong whitelist.
  if (kind === 'run-job') {
    var jobName = e.parameter.name || '';
    var allowedJobs = {
      remindPrepareBreakfast: remindPrepareBreakfast,
      remindUpdateBreakfast: remindUpdateBreakfast,
      remindPrepareLunch: remindPrepareLunch,
      remindUpdateLunch: remindUpdateLunch,
      alertAfternoonFoodIfNeeded: alertAfternoonFoodIfNeeded,
      remindPrepareDinner: remindPrepareDinner,
      remindUpdateDinner: remindUpdateDinner,
      sendDailyReport: sendDailyReport,
    };
    if (!allowedJobs[jobName]) {
      return jsonOutput({ ok: false, error: 'job không hợp lệ', allowed: Object.keys(allowedJobs) });
    }
    try {
      allowedJobs[jobName]();
      return jsonOutput({ ok: true, ran: jobName });
    } catch (err) {
      return jsonOutput({ ok: false, error: String(err) });
    }
  }
  // Liệt kê các trigger hằng ngày đang có (để kiểm tra đã cài đặt thành công chưa).
  if (kind === 'list-triggers') {
    var triggers = ScriptApp.getProjectTriggers().map(function (t) {
      return { handler: t.getHandlerFunction(), type: String(t.getEventType()) };
    });
    return jsonOutput({ ok: true, triggers: triggers });
  }
  if (kind === 'profile') {
    var raw = PropertiesService.getScriptProperties().getProperty('USER_PROFILE');
    return jsonOutput({ ok: true, profile: raw ? JSON.parse(raw) : null });
  }
  return jsonOutput({ ok: false, error: 'missing ?kind=gate-log|feedback|meal|profile' });
}

// ============ AI (Claude) ============
// Cần Script Property ANTHROPIC_API_KEY. Không có key thì trả về { ok:false, error:'no-key' }
// và an-uong.html tự dùng bảng calo tích hợp sẵn thay thế.
function callClaude(content) {
  var key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) return { ok: false, error: 'no-key' };
  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    },
    payload: JSON.stringify({
      model: 'claude-opus-5-5',
      max_tokens: 8000,
      output_config: { effort: 'low' },
      fallbacks: 'default',
      messages: [{ role: 'user', content: content }],
    }),
  });
  if (res.getResponseCode() !== 200) {
    return { ok: false, error: 'http-' + res.getResponseCode(), detail: res.getContentText().slice(0, 300) };
  }
  var body = JSON.parse(res.getContentText());
  if (body.stop_reason === 'refusal') return { ok: false, error: 'refusal' };
  var text = (body.content || [])
    .filter(function (b) { return b.type === 'text'; })
    .map(function (b) { return b.text; })
    .join('');
  var match = /\{[\s\S]*\}/.exec(text);
  if (!match) return { ok: false, error: 'bad-json' };
  try {
    return { ok: true, result: JSON.parse(match[0]) };
  } catch (err) {
    return { ok: false, error: 'bad-json' };
  }
}

function aiEstimateCalories(data) {
  var meal = String(data.mealName || 'bữa ăn').toLowerCase();
  var desc = (data.name ? ', người dùng gọi món là: "' + data.name + '"' : '') +
    (data.note ? '. Ghi chú của người dùng: "' + data.note + '"' : '');
  var schema = '{"ten_mon":"tên ngắn gọn của bữa","thanh_phan":[{"ten":"...","khau_phan":"...","kcal":0}],' +
    '"tong_kcal":0,"do_tin_cay":"thấp|trung bình|cao","ghi_chu":"một câu nhận xét dinh dưỡng ngắn"}';
  var content = [];
  if (data.image) {
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: data.image } });
    content.push({ type: 'text', text: 'Bạn là chuyên gia dinh dưỡng Việt Nam. Hãy ước tính lượng calo của ' + meal +
      ' trong ảnh' + desc + '. Nhận diện từng thành phần, ước lượng khẩu phần theo kích thước chén đĩa thông thường ở Việt Nam, rồi tính kcal. ' +
      'Trả lời bằng tiếng Việt, CHỈ một đối tượng JSON, không kèm chữ nào khác, theo mẫu: ' + schema });
  } else {
    if (!data.name) return { ok: false, error: 'no-input' };
    content.push({ type: 'text', text: 'Bạn là chuyên gia dinh dưỡng Việt Nam. Hãy ước tính calo cho ' + meal + desc +
      ', với khẩu phần thông thường ở Việt Nam. Trả lời CHỈ một đối tượng JSON theo mẫu: ' + schema });
  }
  return callClaude(content);
}

function aiSuggestMeals(data) {
  var prompt = 'Bạn là chuyên gia dinh dưỡng Việt Nam. ' + (data.who || '') +
    'Mục tiêu của người dùng là ' + data.goal + ' kcal/ngày. Hôm nay họ đã ăn: ' + (data.eaten || 'chưa ăn gì') +
    '. Tổng sáng + trưa: ' + data.eatenMain + ' kcal. Mức calo đề xuất: bữa chiều khoảng ' + data.chieu +
    ' kcal, bữa tối khoảng ' + data.toi + ' kcal. Hãy gợi ý 3 món ăn Việt Nam dễ tìm cho mỗi bữa chưa ăn, ' +
    'mỗi món kèm khẩu phần và kcal ước tính, cân bằng đạm, rau và tinh bột, bù đắp phần còn thiếu của bữa sáng, trưa. ' +
    'Nếu sáng và trưa ăn quá ít thì nhắc nhẹ nhàng. Trả lời CHỈ JSON: ' +
    '{"chieu":{"mon":["Tên món – khẩu phần – ~kcal"]},"toi":{"mon":["..."]},"nhan_xet":"1–2 câu nhận xét và lời khuyên"}';
  return callClaude([{ type: 'text', text: prompt }]);
}

function getOrCreateSheet(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    // Định dạng cả cột thành "Plain text" TRƯỚC khi ghi dữ liệu, để Sheets không tự ý
    // chuyển các chuỗi kiểu "2026-09-29" hoặc timestamp ISO thành giá trị Ngày/Giờ
    // (nếu không, đọc lại sẽ ra Date object thay vì đúng chuỗi đã lưu, làm sai lệch so khớp ngày).
    sheet.getRange(1, 1, sheet.getMaxRows(), headers.length).setNumberFormat('@');
    sheet.appendRow(headers);
  }
  return sheet;
}

function readSheet(ss, name, keys) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) return [];
  var values = sheet.getDataRange().getValues();
  var rows = values.slice(1); // bỏ dòng tiêu đề
  return rows
    .filter(function (row) { return row.some(function (cell) { return cell !== ''; }); })
    .map(function (row) {
      var obj = {};
      keys.forEach(function (k, i) { obj[k] = row[i]; });
      return obj;
    });
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

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
  var isRough = data.portion === 'Bỏ bữa' || data.portion === 'Ăn ít' || data.taste === 'Không ngon';
  if (!isRough) return;

  var lines = ['⚠️ <b>' + data.meal + '</b> hôm nay: ' + (data.portion || '') + (data.taste ? ' · ' + data.taste : '')];
  if (data.food) lines.push('Món: ' + data.food);
  lines.push('');
  lines.push('🍪 Gợi ý ăn bù nhẹ: ' + pickRandomGS(SNACK_POOL_GS, 3).join(', '));
  if (data.veggie === 'Không rau' || !data.veggie) {
    lines.push('🥗 Đừng quên rau: ' + pickRandomGS(VEGGIE_POOL_GS, 2).join(', '));
  }
  sendTelegram(lines.join('\n'));
}

// ============ 8 JOB TỰ ĐỘNG NHẮC ĂN UỐNG QUA TELEGRAM ============
// Lịch chạy: xem installDailyTriggers() ở cuối file.

function getTodayMeals() {
  var ss = getDataSpreadsheet();
  var meals = readSheet(ss, 'Meals', ['time', 'date', 'meal', 'food', 'portion', 'taste', 'veggie', 'note', 'photo']);
  var today = todayStrGS();
  return meals.filter(function (m) { return m.date === today; });
}

function mealIsBad(m) {
  return m.portion === 'Bỏ bữa' || m.portion === 'Ăn ít' || m.taste === 'Không ngon';
}

// 1. 7h30 — nhắc chuẩn bị bữa sáng, kèm gợi ý random món ăn.
function remindPrepareBreakfast() {
  var picks = pickRandomGS(MEAL_IDEA_POOL_GS, 3);
  sendTelegram('🌅 7h30 rồi, chuẩn bị bữa sáng thôi!\nGợi ý: ' + picks.join(', '));
}

// 2. 8h30 — nhắc cập nhật bữa sáng nếu chưa ghi vào app.
function remindUpdateBreakfast() {
  var logged = getTodayMeals().some(function (m) { return m.meal === 'Sáng'; });
  if (logged) return;
  sendTelegram('⏰ Chưa thấy cập nhật bữa Sáng hôm nay — ăn xong nhớ ghi vào app nhé!');
}

// 3. 10h30 — nhắc chuẩn bị bữa trưa, kèm gợi ý random món ăn.
function remindPrepareLunch() {
  var picks = pickRandomGS(MEAL_IDEA_POOL_GS, 3);
  sendTelegram('☀️ 10h30 rồi, chuẩn bị bữa trưa thôi!\nGợi ý: ' + picks.join(', '));
}

// 4. 12h30 — nhắc cập nhật bữa trưa nếu chưa ghi vào app.
function remindUpdateLunch() {
  var logged = getTodayMeals().some(function (m) { return m.meal === 'Trưa'; });
  if (logged) return;
  sendTelegram('⏰ Chưa thấy cập nhật bữa Trưa hôm nay — ăn xong nhớ ghi vào app nhé!');
}

// 5. ~13h00 — cảnh báo cần đặt thêm đồ ăn chiều nếu sáng/trưa bỏ bữa hoặc ăn không ngon
//    (kể cả trường hợp chưa ghi bữa nào, coi như chưa ăn để không bỏ sót).
function alertAfternoonFoodIfNeeded() {
  var meals = getTodayMeals();
  var breakfast = meals.filter(function (m) { return m.meal === 'Sáng'; });
  var lunch = meals.filter(function (m) { return m.meal === 'Trưa'; });
  var breakfastBad = !breakfast.length || breakfast.some(mealIsBad);
  var lunchBad = !lunch.length || lunch.some(mealIsBad);
  if (!breakfastBad && !lunchBad) return;

  var reasons = [];
  if (breakfastBad) reasons.push('bữa sáng ' + (breakfast.length ? 'ăn không ngon/ăn ít' : 'chưa ghi hoặc bỏ bữa'));
  if (lunchBad) reasons.push('bữa trưa ' + (lunch.length ? 'ăn không ngon/ăn ít' : 'chưa ghi hoặc bỏ bữa'));
  sendTelegram('⚠️ Long ơi, cần đặt thêm đồ ăn chiều nay vì ' + reasons.join(' và ') + '. Đừng để đói bụng nhé!');
}

// 6. 17h30 — nhắc chuẩn bị bữa tối, gợi ý món chính + tráng miệng/hoa quả.
function remindPrepareDinner() {
  var mains = pickRandomGS(MEAL_IDEA_POOL_GS, 2);
  var desserts = pickRandomGS(FRUIT_DESSERT_POOL_GS, 2);
  sendTelegram('🌙 17h30 rồi, chuẩn bị bữa tối thôi!\nMón chính gợi ý: ' + mains.join(', ') + '\nTráng miệng/hoa quả: ' + desserts.join(', '));
}

// 7. 20h00 — nhắc cập nhật bữa tối nếu chưa ghi vào app.
function remindUpdateDinner() {
  var logged = getTodayMeals().some(function (m) { return m.meal === 'Tối'; });
  if (logged) return;
  sendTelegram('⏰ Chưa thấy cập nhật bữa Tối hôm nay — ăn xong nhớ ghi vào app nhé!');
}

// 8. 21h00 — báo cáo tổng kết cả ngày ăn uống, kèm góp ý cho ngày mai.
function sendDailyReport() {
  var meals = getTodayMeals();
  var coreMeals = ['Sáng', 'Trưa', 'Tối'];
  var loggedMeals = {};
  meals.forEach(function (m) { loggedMeals[m.meal] = true; });
  var missingCore = coreMeals.filter(function (m) { return !loggedMeals[m]; });
  var skipped = meals.filter(function (m) { return m.portion === 'Bỏ bữa'; });
  var rough = meals.filter(function (m) { return m.portion === 'Ăn ít' || m.taste === 'Không ngon'; });
  var hasVeggie = meals.some(function (m) { return m.veggie === 'Có rau' || m.veggie === 'Nhiều rau'; });

  var lines = ['📋 <b>Báo cáo ăn uống hôm nay (' + todayStrGS() + ')</b>'];
  lines.push('Đã ghi ' + meals.length + ' bữa.');
  if (missingCore.length) lines.push('Còn thiếu: ' + missingCore.join(', ') + '.');
  if (skipped.length) lines.push('Bỏ bữa: ' + skipped.map(function (m) { return m.meal; }).join(', ') + '.');
  if (rough.length) lines.push('Ăn không ngon/ăn ít: ' + rough.map(function (m) { return m.meal; }).join(', ') + '.');
  lines.push(hasVeggie ? 'Có ăn rau trong ngày. 👍' : 'Chưa ăn rau hôm nay.');

  var overallGood = !missingCore.length && !skipped.length && !rough.length && hasVeggie;
  if (overallGood) {
    lines.push('✅ Hôm nay ăn uống rất ổn định, tiếp tục duy trì nhé!');
  } else {
    var tips = [];
    if (missingCore.length) tips.push('ghi đủ 3 bữa chính');
    if (skipped.length || rough.length) tips.push('cố gắng không bỏ bữa, ăn ngon miệng hơn');
    if (!hasVeggie) tips.push('bổ sung thêm rau xanh');
    lines.push('💡 Ngày mai nên: ' + tips.join(', ') + '.');
  }
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
