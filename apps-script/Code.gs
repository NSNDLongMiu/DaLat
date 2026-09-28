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
        data.portion || '', data.taste || '', data.veggie ? 'yes' : 'no', data.note || '', photoId,
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
      mealSheet2.getRange(foundRow + 1, 2, 1, 8).setValues([[
        "'" + (data.date || ''), data.meal || '', data.food || '',
        data.portion || '', data.taste || '', data.veggie ? 'yes' : 'no', data.note || '', photoId,
      ]]);
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
    meals.forEach(function (m) { m.veggie = m.veggie === 'yes'; });
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
  return jsonOutput({ ok: false, error: 'missing ?kind=gate-log|feedback|meal' });
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
  if (!data.veggie) {
    lines.push('🥗 Đừng quên rau: ' + pickRandomGS(VEGGIE_POOL_GS, 2).join(', '));
  }
  sendTelegram(lines.join('\n'));
}

// Chạy bằng trigger giờ cố định — nhắc nếu đến giờ mà chưa ghi bữa đó hôm nay.
function reminderIfMealMissing(mealName) {
  var ss = getDataSpreadsheet();
  var meals = readSheet(ss, 'Meals', ['time', 'date', 'meal', 'food', 'portion', 'taste', 'veggie', 'note']);
  var today = todayStrGS();
  var logged = meals.some(function (m) { return m.date === today && m.meal === mealName; });
  if (logged) return;
  sendTelegram('⏰ Chưa thấy ghi bữa <b>' + mealName + '</b> hôm nay — ăn gì đó nhé, đừng để đói bụng!');
}

function reminderBreakfast() { reminderIfMealMissing('Sáng'); }
function reminderLunch() { reminderIfMealMissing('Trưa'); }
function reminderDinner() { reminderIfMealMissing('Tối'); }

// Chạy mỗi sáng — gợi ý món ăn cho cả ngày, không phụ thuộc dữ liệu đã ghi.
function morningMealSuggestion() {
  var picks = pickRandomGS(MEAL_IDEA_POOL_GS, 3);
  sendTelegram('☀️ Gợi ý hôm nay ăn gì:\n' + picks.map(function (p) { return '• ' + p; }).join('\n'));
}

// Chạy 1 LẦN bằng tay trong Apps Script editor (chọn hàm này > bấm Run) để cài đặt
// lịch tự động. Chạy lại vẫn an toàn — nó xoá trigger cũ cùng tên trước khi tạo lại.
function installDailyTriggers() {
  var handlers = ['morningMealSuggestion', 'reminderBreakfast', 'reminderLunch', 'reminderDinner'];
  var existing = ScriptApp.getProjectTriggers();
  existing.forEach(function (t) {
    if (handlers.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger('morningMealSuggestion').timeBased().atHour(7).everyDays(1).create();
  ScriptApp.newTrigger('reminderBreakfast').timeBased().atHour(9).everyDays(1).create();
  ScriptApp.newTrigger('reminderLunch').timeBased().atHour(13).everyDays(1).create();
  ScriptApp.newTrigger('reminderDinner').timeBased().atHour(19).everyDays(1).create();

  Logger.log('Đã cài xong 4 trigger hằng ngày.');
}
