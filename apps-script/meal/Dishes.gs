// ============================================================
// Dishes.gs — nạp món người dùng nhập + tự tìm ảnh (thuộc project "meal")
// ============================================================

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
