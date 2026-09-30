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

    if (data.kind === 'gate-log') {
      var logSheet = getOrCreateSheet(ss, 'GateLog', ['Time', 'Name', 'IP', 'Question', 'Answer']);
      logSheet.appendRow([data.time || '', data.name || '', data.ip || '', data.question || '', data.answer || '']);
    } else if (data.kind === 'feedback') {
      var fbSheet = getOrCreateSheet(ss, 'Feedback', ['Time', 'Name', 'Text']);
      fbSheet.appendRow([data.time || '', data.name || '', data.text || '']);
    } else if (data.kind === 'meal') {
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

  if (kind === 'gate-log') {
    return jsonOutput(readSheet(ss, 'GateLog', ['time', 'name', 'ip', 'question', 'answer']));
  }
  if (kind === 'feedback') {
    return jsonOutput(readSheet(ss, 'Feedback', ['time', 'name', 'text']));
  }
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
  // Endpoint tạm để debug: xem đúng định dạng ô + kiểu giá trị thật trong tab Meals.
  // Xoá đoạn này sau khi hết cần debug.
  if (kind === 'debug') {
    var dsheet = ss.getSheetByName('Meals');
    if (!dsheet) return jsonOutput({ ok: false, error: 'chưa có tab Meals', version: 'debug-2026-09-29c-apostrophe' });
    var lastRow = Math.max(dsheet.getLastRow(), 1);
    var range = dsheet.getRange(1, 1, Math.min(lastRow, 10), 10);
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
  // Chẩn đoán AI tính kcal: đã có ANTHROPIC_API_KEY chưa, gọi thử 1 câu có ra kết quả không.
  // Mở <URL /exec>?kind=ai-status trên trình duyệt để xem lỗi thật thay vì đoán.
  if (kind === 'ai-status') {
    return jsonOutput(aiStatus());
  }
  return jsonOutput({ ok: false, error: 'missing ?kind=gate-log|feedback|meal|dishes|profile|profiles|ai-status' });
}

// ============ AI (Claude) ============
// Cần Script Property GEMINI_API_KEY (miễn phí) hoặc ANTHROPIC_API_KEY. Không có key thì trả về { ok:false, error:'no-key' }
// và an-uong.html tự dùng bảng calo tích hợp sẵn thay thế.
// Thử lần lượt vài model: model đầu bị từ chối/không tồn tại/quá tải thì chuyển sang model kế tiếp,
// thay vì báo lỗi luôn. Dùng đúng Messages API chuẩn (không header beta, không tham số thử nghiệm)
// để không bị 400 khi Anthropic đổi/bỏ tính năng thử nghiệm.
var AI_MODELS = ['claude-sonnet-5-5', 'claude-haiku-4-5-20251001', 'claude-opus-5-5'];

function callClaude(content) {
  var key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) return { ok: false, error: 'no-key' };
  var lastErr = { ok: false, error: 'no-model' };
  for (var mi = 0; mi < AI_MODELS.length; mi++) {
    var res;
    try {
      res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
        method: 'post',
        contentType: 'application/json',
        muteHttpExceptions: true,
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        payload: JSON.stringify({
          model: AI_MODELS[mi],
          max_tokens: 1500,
          messages: [{ role: 'user', content: content }],
        }),
      });
    } catch (err) {
      // Thường do chưa cấp quyền script.external_request khi deploy — cần chạy lại + bấm Cho phép.
      return { ok: false, error: 'fetch-failed', detail: String(err).slice(0, 300) };
    }
    var code = res.getResponseCode();
    if (code !== 200) {
      lastErr = { ok: false, error: 'http-' + code, model: AI_MODELS[mi], detail: res.getContentText().slice(0, 300) };
      // Sai key / hết tiền: đổi model cũng vô ích.
      if (code === 401 || code === 403) return lastErr;
      continue;
    }
    var body = JSON.parse(res.getContentText());
    if (body.stop_reason === 'refusal') return { ok: false, error: 'refusal' };
    var text = (body.content || [])
      .filter(function (b) { return b.type === 'text'; })
      .map(function (b) { return b.text; })
      .join('');
    var match = /\{[\s\S]*\}/.exec(text);
    if (!match) { lastErr = { ok: false, error: 'bad-json', model: AI_MODELS[mi] }; continue; }
    try {
      return { ok: true, result: JSON.parse(match[0]), model: AI_MODELS[mi] };
    } catch (err) {
      lastErr = { ok: false, error: 'bad-json', model: AI_MODELS[mi] };
    }
  }
  return lastErr;
}

// ---- Google Gemini (có gói miễn phí, không cần thẻ) ----
// Lấy key tại aistudio.google.com > Get API key, rồi thêm Script Property GEMINI_API_KEY.
// Tên model đổi theo thời gian: muốn dùng model khác, đặt Script Property GEMINI_MODEL (được thử trước).
// Google đã ngừng cấp gemini-2.5-* cho tài khoản mới (báo 404) nên thử dòng 3.5 trước.
var GEMINI_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-2.5-flash'];

// Chuyển nội dung dạng Anthropic (khối text/image) sang "parts" của Gemini.
function toGeminiParts(content) {
  return content.map(function (c) {
    if (c.type === 'image') return { inline_data: { mime_type: c.source.media_type, data: c.source.data } };
    return { text: c.text };
  });
}

function callGemini(content) {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('GEMINI_API_KEY');
  if (!key) return { ok: false, error: 'no-key' };
  var models = GEMINI_MODELS.slice();
  var custom = props.getProperty('GEMINI_MODEL');
  if (custom) models.unshift(custom);
  var lastErr = { ok: false, error: 'no-model' };
  for (var mi = 0; mi < models.length; mi++) {
    var res;
    try {
      res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + models[mi] + ':generateContent', {
        method: 'post',
        contentType: 'application/json',
        muteHttpExceptions: true,
        headers: { 'x-goog-api-key': key },
        payload: JSON.stringify({
          contents: [{ role: 'user', parts: toGeminiParts(content) }],
          generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 4000, temperature: 0.3 },
        }),
      });
    } catch (err) {
      return { ok: false, error: 'fetch-failed', detail: String(err).slice(0, 300) };
    }
    var code = res.getResponseCode();
    if (code !== 200) {
      lastErr = { ok: false, error: 'http-' + code, model: models[mi], detail: res.getContentText().slice(0, 300) };
      if (code === 401 || code === 403) return lastErr;   // sai key: đổi model cũng vô ích
      continue;                                            // 400/404 (sai tên model), 429 (hết hạn mức), 5xx: thử model kế
    }
    var body = JSON.parse(res.getContentText());
    var cand = body.candidates && body.candidates[0];
    var parts = (cand && cand.content && cand.content.parts) || [];
    var text = parts.map(function (p) { return p.text || ''; }).join('');
    var match = /\{[\s\S]*\}/.exec(text);
    if (!match) {
      lastErr = { ok: false, error: (cand && cand.finishReason === 'SAFETY') ? 'refusal' : 'bad-json', model: models[mi] };
      continue;
    }
    try {
      return { ok: true, result: JSON.parse(match[0]), model: models[mi], provider: 'gemini' };
    } catch (err) {
      lastErr = { ok: false, error: 'bad-json', model: models[mi] };
    }
  }
  return lastErr;
}

// Chọn nhà cung cấp AI: Gemini nếu có GEMINI_API_KEY, không được thì Claude nếu có ANTHROPIC_API_KEY.
// Không có key nào => { ok:false, error:'no-key' } và app dùng bảng calo có sẵn.
function callAI(content) {
  var props = PropertiesService.getScriptProperties();
  var hasGemini = !!props.getProperty('GEMINI_API_KEY');
  var hasClaude = !!props.getProperty('ANTHROPIC_API_KEY');
  if (!hasGemini && !hasClaude) return { ok: false, error: 'no-key' };
  var r = hasGemini ? callGemini(content) : { ok: false };
  if (r.ok || !hasClaude) return r;
  var c = callClaude(content);
  if (c.ok) c.provider = 'claude';
  return c.ok ? c : (hasGemini ? r : c);
}

function aiStatus() {
  var props = PropertiesService.getScriptProperties();
  var hasGemini = !!props.getProperty('GEMINI_API_KEY');
  var hasClaude = !!props.getProperty('ANTHROPIC_API_KEY');
  if (!hasGemini && !hasClaude) {
    return { ok: false, hasKey: false, hint: 'Chưa có key AI. Thêm Script Property GEMINI_API_KEY (miễn phí, aistudio.google.com) hoặc ANTHROPIC_API_KEY.' };
  }
  var r = callAI([{ type: 'text', text: 'Trả lời CHỈ JSON {"pong":true}' }]);
  r.hasKey = true;
  r.hasGemini = hasGemini;
  r.hasClaude = hasClaude;
  r.version = 'ai-status-2026-09-30c';
  return r;
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
  return callAI(content);
}

function aiSuggestMeals(data) {
  var prompt = 'Bạn là chuyên gia dinh dưỡng Việt Nam. ' + (data.who || '') +
    'Mục tiêu của người dùng là ' + data.goal + ' kcal/ngày. Hôm nay họ đã ăn: ' + (data.eaten || 'chưa ăn gì') +
    '. Tổng sáng + trưa: ' + data.eatenMain + ' kcal. Mức calo đề xuất: bữa chiều khoảng ' + data.chieu +
    ' kcal, bữa tối khoảng ' + data.toi + ' kcal. Hãy gợi ý 3 món ăn Việt Nam dễ tìm cho mỗi bữa chưa ăn, ' +
    'mỗi món kèm khẩu phần và kcal ước tính, cân bằng đạm, rau và tinh bột, bù đắp phần còn thiếu của bữa sáng, trưa. ' +
    'Nếu sáng và trưa ăn quá ít thì nhắc nhẹ nhàng. Trả lời CHỈ JSON: ' +
    '{"chieu":{"mon":["Tên món – khẩu phần – ~kcal"]},"toi":{"mon":["..."]},"nhan_xet":"1–2 câu nhận xét và lời khuyên"}';
  return callAI([{ type: 'text', text: prompt }]);
}

// ============ TỰ TÌM NGUỒN + ẢNH CHO MÓN NGƯỜI DÙNG NHẬP ============
// Sau khi lưu 1 bữa ăn, app gọi kind=dish-learn:
//  1. Ghi món đó (tên + kcal người dùng đã chốt) vào tab "Dishes" để nạp thêm vào nguồn món của hòm món ăn.
//  2. Nếu bữa đó KHÔNG có ảnh người dùng đẩy lên: tự tìm ảnh món/sản phẩm (Wikimedia Commons cho món ăn,
//     Open Food Facts cho đồ đóng gói, thương hiệu), tải về Drive rồi gắn vào đúng bữa đó.
// Cả 2 nguồn đều miễn phí, không cần API key.
var DISH_HEADERS = ['Name', 'Kcal', 'Portion', 'Group', 'Source', 'ImageUrl', 'Person', 'Time'];
var DISH_KEYS = ['name', 'kcal', 'portion', 'group', 'source', 'imageUrl', 'person', 'time'];
var SLOT_GROUP_GS = { 'Sáng': 'sang', 'Trưa': 'trua_toi', 'Tối': 'trua_toi', 'Khuya': 'trua_toi', 'Xế': 'an_them', 'Ăn vặt': 'an_them' };
var FETCH_HEADERS_GS = { 'User-Agent': 'DalatMealApp/1.0 (personal project)' };
var MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function normText(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Tên ảnh/sản phẩm tìm được phải khớp phần lớn từ trong tên món, tránh gắn nhầm ảnh không liên quan.
function titleMatches(query, title, minRatio) {
  var words = normText(query).split(' ').filter(function (w) { return w.length > 1; });
  if (!words.length) return false;
  var t = ' ' + normText(title) + ' ';
  var hit = words.filter(function (w) { return t.indexOf(' ' + w + ' ') !== -1; }).length;
  return hit / words.length >= (minRatio || 0.6);
}

function getJsonSafe(url) {
  try {
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: FETCH_HEADERS_GS });
    if (res.getResponseCode() !== 200) return null;
    return JSON.parse(res.getContentText());
  } catch (err) {
    return null;
  }
}

// Sản phẩm đóng gói / thương hiệu (Vinamilk, Probi, Choco Pie...): Open Food Facts.
// Tên sản phẩm hay viết khác nhau (Probi/Proby) nên chỉ cần khớp khoảng nửa số từ.
function findImageOpenFoodFacts(name) {
  var d = getJsonSafe('https://search.openfoodfacts.org/search?page_size=10&fields=product_name,brands,image_front_url&q=' + encodeURIComponent(name));
  var hits = (d && d.hits) || [];
  for (var i = 0; i < hits.length; i++) {
    var h = hits[i];
    var brands = Array.isArray(h.brands) ? h.brands.join(' ') : (h.brands || '');
    if (h.image_front_url && titleMatches(name, brands + ' ' + (h.product_name || ''), 0.5)) {
      return { url: h.image_front_url, source: 'Open Food Facts' };
    }
  }
  return null;
}

// Món ăn thông thường: Wikimedia Commons (chỉ nhận file ảnh jpeg có tên khớp).
function findImageCommons(name) {
  var url = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=8' +
    '&gsrsearch=' + encodeURIComponent(name + ' filetype:bitmap') + '&prop=imageinfo&iiprop=url|mime&iiurlwidth=600';
  var d = getJsonSafe(url);
  var pages = (d && d.query && d.query.pages) ? Object.keys(d.query.pages).map(function (k) { return d.query.pages[k]; }) : [];
  pages.sort(function (a, b) { return (a.index || 0) - (b.index || 0); });
  for (var i = 0; i < pages.length; i++) {
    var ii = pages[i].imageinfo && pages[i].imageinfo[0];
    var title = String(pages[i].title || '').replace(/^File:/, '').replace(/\.[a-z]+$/i, '');
    if (ii && ii.mime === 'image/jpeg' && (ii.thumburl || ii.url) && titleMatches(name, title)) {
      return { url: ii.thumburl || ii.url, source: 'Wikimedia Commons' };
    }
  }
  return null;
}

function findDishImage(name) {
  // Commons trước (khớp chặt tên món); không có thì tới sản phẩm đóng gói/thương hiệu.
  return findImageCommons(name) || findImageOpenFoodFacts(name);
}

// Tải ảnh tìm được về Drive và ghi ID vào ô Photo của đúng bữa (chỉ khi bữa đó đang chưa có ảnh).
function attachFoundPhoto(ss, mealTime, imageUrl) {
  var sheet = getMealSheet(ss);
  var rows = sheet.getDataRange().getValues();
  var row = -1;
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === mealTime) { row = i; break; }
  }
  if (row === -1 || rows[row][8]) return '';
  try {
    var res = UrlFetchApp.fetch(imageUrl, { muteHttpExceptions: true, headers: FETCH_HEADERS_GS });
    if (res.getResponseCode() !== 200) return '';
    var blob = res.getBlob();
    if (!/^image\//.test(blob.getContentType() || '') || blob.getBytes().length > MAX_IMAGE_BYTES) return '';
    blob.setName('food-' + Date.now() + '.jpg');
    var file = getPhotoFolder().createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    sheet.getRange(row + 1, 9).setValue(file.getId());
    return file.getId();
  } catch (err) {
    return '';
  }
}

function learnDish(data) {
  var name = String(data.name || '').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 80) return { ok: false, error: 'no-name' };
  var ss = getDataSpreadsheet();
  var sheet = getOrCreateSheet(ss, 'Dishes', DISH_HEADERS);
  var key = normText(name);
  var rows = sheet.getDataRange().getValues();
  var found = -1;
  for (var i = 1; i < rows.length; i++) {
    if (normText(rows[i][0]) === key) { found = i; break; }
  }
  var kcal = Math.round(Number(data.kcal));
  if (!isFinite(kcal) || kcal < 0 || kcal > 5000) kcal = found !== -1 ? Number(rows[found][1]) || 0 : 0;
  var imageUrl = found !== -1 ? String(rows[found][5] || '') : '';
  var source = found !== -1 ? String(rows[found][4] || '') : '';

  var photoId = '';
  if (!data.hasPhoto) {
    if (!imageUrl) {
      var hit = findDishImage(name);
      if (hit) { imageUrl = hit.url; source = hit.source; }
    }
    if (imageUrl && data.time) photoId = attachFoundPhoto(ss, data.time, imageUrl);
  }

  var group = SLOT_GROUP_GS[data.meal] || 'trua_toi';
  var line = [name, kcal, data.portion || '', group, source, imageUrl, normPerson(data.person), new Date().toISOString()];
  if (found === -1) sheet.appendRow(line);
  else sheet.getRange(found + 1, 1, 1, line.length).setValues([line]);
  return { ok: true, photoId: photoId, source: source, foundImage: !!imageUrl };
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
  return m.portion === 'Bỏ bữa' || m.portion === 'Ăn ít' || m.taste === 'Không ngon';
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
    var rough = st.meals.filter(function (m) { return m.portion === 'Ăn ít' || m.taste === 'Không ngon'; });
    if (rough.length) lines.push('  Ăn ít/không ngon: ' + rough.map(function (m) { return m.meal; }).join(', ') + '.');
    var hasVeggie = st.meals.some(function (m) { return m.veggie === 'Có rau' || m.veggie === 'Nhiều rau'; });
    lines.push(hasVeggie ? '  Có ăn rau. 👍' : '  Chưa ăn rau hôm nay.');

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
