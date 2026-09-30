// ============================================================
// PROJECT "MEAL" — nhật ký ăn uống (an-uong.html)
// Cách cài: xem apps-script/README.md
//
// Project này gồm 4 file, tất cả phải nằm chung 1 project Apps Script:
//   Code.gs      — doPost/doGet (điều phối), Sheet, hồ sơ cơ thể, ảnh Drive   (file này)
//   Ai.gs        — ước tính kcal + gợi ý món bằng AI (Gemini / Claude)
//   Dishes.gs    — nạp món người dùng nhập + tự tìm ảnh món/thương hiệu
//   Telegram.gs  — 8 job nhắc ăn uống và báo cáo qua Telegram
// Thêm chức năng mới = thêm 1 file .gs riêng + 1 nhánh kind trong doPost/doGet ở file này.
//
// Script Properties cần có: DATA_SHEET_ID (trỏ tới Sheet "DaLat Data" đang dùng), PHOTO_FOLDER_ID,
// GEMINI_API_KEY (hoặc ANTHROPIC_API_KEY), TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID.
// Múi giờ project phải là Asia/Ho_Chi_Minh.
// ============================================================

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

var MEAL_HEADERS = ['Time', 'Date', 'Meal', 'Food', 'Portion', 'Taste', 'Veggie', 'Note', 'Photo', 'Person'];
var MEAL_KEYS = ['time', 'date', 'meal', 'food', 'portion', 'taste', 'veggie', 'note', 'photo', 'person'];
// 2 người dùng chung app. Dòng cũ (chưa có cột Person) được tính là của Long.
var PEOPLE_GS = ['Long', 'Uyn'];
function normPerson(p) {
  return PEOPLE_GS.indexOf(p) !== -1 ? p : PEOPLE_GS[0];
}

// Lấy tab Meals; nếu tab được tạo từ trước khi có cột Person thì bổ sung tiêu đề cột Person.
function getMealSheet(ss) {
  var sheet = getOrCreateSheet(ss, 'Meals', MEAL_HEADERS);
  if (!sheet.getRange(1, 10).getValue()) {
    sheet.getRange(1, 10).setNumberFormat('@').setValue('Person');
  }
  return sheet;
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var ss = getDataSpreadsheet();
    var photoId = '';

    if (data.kind === 'meal') {
      var mealSheet = getMealSheet(ss);
      photoId = data.photo ? savePhotoToDrive(data.photo) : '';
      mealSheet.appendRow([
        data.time || '', "'" + (data.date || ''), data.meal || '', data.food || '',
        data.portion || '', data.taste || '', data.veggie || '', data.note || '', photoId,
        normPerson(data.person),
      ]);
      notifyIfMealIsRough(data);
    } else if (data.kind === 'meal-update') {
      // Chỉ cho sửa bữa của đúng ngày hôm nay — chặn sửa bữa của ngày khác kể cả khi
      // ai đó cố gọi thẳng API (phòng trường hợp bỏ qua giới hạn ở giao diện).
      var mealSheet2 = getMealSheet(ss);
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
      // Người nhập giữ nguyên như dòng gốc (dòng cũ chưa có Person => Long), không cho đổi chủ bữa ăn.
      mealSheet2.getRange(foundRow + 1, 1, 1, 10).setValues([[
        data.time || allRows[foundRow][0], "'" + (data.date || ''), data.meal || '', data.food || '',
        data.portion || '', data.taste || '', data.veggie || '', data.note || '', photoId,
        normPerson(allRows[foundRow][9]),
      ]]);
    } else if (data.kind === 'meal-delete') {
      // Chỉ cho xoá bữa của đúng ngày hôm nay — chặn xoá bữa của ngày khác kể cả khi
      // ai đó cố gọi thẳng API (phòng trường hợp bỏ qua giới hạn ở giao diện).
      var mealSheet3 = getMealSheet(ss);
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
    } else if (data.kind === 'dish-learn') {
      return jsonOutput(learnDish(data));
    } else if (data.kind === 'ai-estimate') {
      return jsonOutput(aiEstimateCalories(data));
    } else if (data.kind === 'ai-suggest') {
      return jsonOutput(aiSuggestMeals(data));
    } else if (data.kind === 'profile') {
      // Hồ sơ chỉ số cơ thể của từng người — lưu trong Script Properties cho gọn.
      PropertiesService.getScriptProperties().setProperty(profileKey(normPerson(data.person)), JSON.stringify(data.profile || null));
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

  if (kind === 'meal') {
    var meals = readSheet(ss, 'Meals', MEAL_KEYS);
    // Tương thích dữ liệu cũ lưu dạng yes/no trước khi có 3 mức rau củ.
    meals.forEach(function (m) {
      m.person = normPerson(m.person);
      if (m.veggie === 'yes') m.veggie = 'Có rau';
      else if (m.veggie === 'no' || !m.veggie) m.veggie = 'Không rau';
    });
    return jsonOutput(meals);
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
  // Các món người dùng đã nhập (tab Dishes) — app nạp thêm vào hòm món ăn.
  if (kind === 'dishes') {
    var learned = readSheet(ss, 'Dishes', DISH_KEYS).filter(function (d) { return Number(d.kcal) > 0; });
    return jsonOutput({ ok: true, dishes: learned });
  }
  if (kind === 'profile') {
    return jsonOutput({ ok: true, profile: readProfile(normPerson(e.parameter.person)) });
  }
  if (kind === 'profiles') {
    var all = {};
    PEOPLE_GS.forEach(function (p) { all[p] = readProfile(p); });
    return jsonOutput({ ok: true, profiles: all });
  }
  // Chẩn đoán AI tính kcal: đã có GEMINI_API_KEY / ANTHROPIC_API_KEY chưa, gọi thử 1 câu có ra kết quả không.
  // Mở <URL /exec>?kind=ai-status trên trình duyệt để xem lỗi thật thay vì đoán.
  if (kind === 'ai-status') {
    return jsonOutput(aiStatus());
  }
  return jsonOutput({ ok: false, error: 'missing ?kind=meal|dishes|profile|profiles|ai-status|install-triggers|run-job|list-triggers' });
}

// Hồ sơ chỉ số cơ thể: mỗi người 1 bản. Hồ sơ cũ (trước khi có 2 người) thuộc về Long.
function profileKey(person) {
  return 'USER_PROFILE_' + person;
}
function readProfile(person) {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty(profileKey(person));
  if (!raw && person === PEOPLE_GS[0]) raw = props.getProperty('USER_PROFILE');
  try { return raw ? JSON.parse(raw) : null; } catch (err) { return null; }
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
