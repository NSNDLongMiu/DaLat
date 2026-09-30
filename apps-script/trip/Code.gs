// ============================================================
// PROJECT "TRIP" — cổng vào + phản hồi của trang chính (index.html, viewer.html)
// Chỉ có 2 chức năng: gate-log và feedback. Ổn định, hạn chế sửa.
// Nhật ký ăn uống nằm ở project riêng: apps-script/meal/ (xem apps-script/README.md).
//
// Dán file này vào 1 project Apps Script, Deploy > New deployment > Web app
// (Execute as: Me, Who has access: Anyone), rồi dán URL /exec vào GAS_ENDPOINT
// trong index.html và viewer.html.
// ============================================================

// Spreadsheet lưu dữ liệu ("DaLat Data"). Tự tạo nếu chưa có, dùng lại nếu đã có (ID nằm ở Script Property DATA_SHEET_ID).
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

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var ss = getDataSpreadsheet();

    if (data.kind === 'gate-log') {
      var logSheet = getOrCreateSheet(ss, 'GateLog', ['Time', 'Name', 'IP', 'Question', 'Answer']);
      logSheet.appendRow([data.time || '', data.name || '', data.ip || '', data.question || '', data.answer || '']);
    } else if (data.kind === 'feedback') {
      var fbSheet = getOrCreateSheet(ss, 'Feedback', ['Time', 'Name', 'Text']);
      fbSheet.appendRow([data.time || '', data.name || '', data.text || '']);
    } else {
      return jsonOutput({ ok: false, error: 'unknown kind' });
    }

    return jsonOutput({ ok: true });
  } catch (err) {
    return jsonOutput({ ok: false, error: String(err) });
  }
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
  return jsonOutput({ ok: false, error: 'missing ?kind=gate-log|feedback' });
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
