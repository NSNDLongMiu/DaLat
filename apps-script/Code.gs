// Dán toàn bộ file này vào script.google.com (Extensions > Apps Script của 1 Google Sheet mới).
// Sau khi Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone),
// copy URL kết thúc bằng /exec và dán vào GAS_ENDPOINT trong index.html và viewer.html.

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();

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
  var ss = SpreadsheetApp.getActiveSpreadsheet();

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
