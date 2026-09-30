// ============================================================
// Ai.gs — AI ước tính kcal + gợi ý món (thuộc project "meal")
// ============================================================

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

function aiEstimateCalories(data) {
  var meal = String(data.mealName || 'bữa ăn').toLowerCase();
  var desc = (data.name ? ', người dùng gọi món là: "' + data.name + '"' : '') +
    (data.note ? '. Ghi chú của người dùng: "' + data.note + '"' : '');
  // dam_g, tinh_bot_g, beo_g, xo_g = gam đạm (protein), tinh bột (carbohydrate), chất béo, chất xơ.
  var schema = '{"ten_mon":"tên ngắn gọn của bữa","thanh_phan":[{"ten":"...","khau_phan":"...","kcal":0,"dam_g":0,"tinh_bot_g":0,"beo_g":0,"xo_g":0}],' +
    '"tong_kcal":0,"dam_g":0,"tinh_bot_g":0,"beo_g":0,"xo_g":0,"do_tin_cay":"thấp|trung bình|cao","ghi_chu":"một câu nhận xét dinh dưỡng ngắn"}. ' +
    'dam_g là gam đạm, tinh_bot_g là gam tinh bột (carbohydrate), beo_g là gam chất béo, xo_g là gam chất xơ; các trường tổng là tổng của các thành phần';
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
