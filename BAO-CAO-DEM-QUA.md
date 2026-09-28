# Báo cáo việc làm đêm qua (tự động, không cần hỏi)

Đã làm xong toàn bộ phần code cho cả 4 việc bạn giao. Có **1 việc duy nhất cần bạn làm bằng tay** (deploy lại Apps Script) vì nó cần đăng nhập Google của bạn — mọi thứ khác đã chạy và test xong.

---

## ✅ Đã xong hoàn toàn (không cần làm gì thêm)

### 1. Thư viện chọn giờ đẹp hơn
`an-uong.html` giờ dùng [flatpickr](https://flatpickr.js.org) (qua CDN) cho ô "Giờ ăn" thay vì `<input type="time">` mặc định xấu của trình duyệt. Vẫn giữ nguyên logic tự cập nhật mỗi phút / dừng khi bạn tự chỉnh.

### 2. Bấm ảnh để phóng to (lightbox)
Ảnh món ăn trong danh sách bữa ăn giờ bấm vào sẽ phóng to full màn hình (nền tối, bấm ra ngoài để đóng) thay vì mở tab Google Drive mới.

### 3. Tính năng "Quay món ăn" kiểu mở hòm CS:GO
- File mới: **`gacha-mon-an.html`** — có link "🎰 Quay món ăn" ở góc trên `an-uong.html`.
- Dữ liệu: **`food-gacha-data.json`** — hơn **200 món ăn** Việt Nam + vài món quốc tế quen thuộc, có phân loại và đánh dấu ~38 món "★ Hiếm" (chỉ để trang trí, không ảnh hưởng tỉ lệ trúng — mọi món có tỉ lệ như nhau).
- Hiệu ứng quay: dải thẻ chạy ngang qua 1 mũi tên cố định, chạy nhanh rồi chậm dần đúng kiểu mở hòm game, dừng chính xác vào món trúng, có lưu lại lịch sử vài lần quay gần nhất (lưu trên trình duyệt).
- **Lưu ý quan trọng**: bạn yêu cầu lấy ảnh thật từ TasteAtlas — tôi đã thử fetch trực tiếp trang TasteAtlas 2 lần, cả 2 lần đều bị chặn (**HTTP 403 Forbidden**, họ chặn truy cập tự động). Vì vậy tôi dùng thẻ màu gradient tự sinh + emoji món ăn thay cho ảnh thật, để tính năng vẫn chạy đầy đủ và đẹp mắt. Cấu trúc JSON đã có sẵn chỗ để bạn tự thêm link ảnh thật sau này nếu muốn (chỉ cần thêm field `"image": "..."` vào từng món, tôi chưa dùng field này ở bản hiện tại nên cần sửa thêm 1 đoạn nhỏ trong `gacha-mon-an.html` để ưu tiên hiển thị ảnh thật khi có).
- Trang gacha cần được mở qua địa chỉ web thật (GitHub Pages) để tải được file JSON — mở trực tiếp file trên máy (`file://...`) sẽ báo lỗi không tải được dữ liệu do trình duyệt chặn (đã có thông báo lỗi rõ ràng ngay trên trang nếu gặp trường hợp này).

### 4. Sửa 1 bug nhỏ phát sinh khi làm mấy việc trên
Khi thêm 3 mức "rau củ" (Không rau/Có rau/Nhiều rau) ở phiên trước, tôi phát hiện dữ liệu cũ (trước khi bạn deploy) vẫn trả về dạng `true/false` — code hiển thị mới chưa xử lý đúng trường hợp này (hiện sai thành "Không rau" dù dữ liệu là có rau). Đã sửa xong, test lại đúng.

### 5. Dọn dữ liệu test
Đã xoá hết rác test tối nay, khôi phục lại đúng bộ 14 bữa ăn mẫu (25–29/9) để bạn xem app sạch sẽ vào sáng mai.

---

## ⚠️ Việc DUY NHẤT cần bạn làm: deploy lại Apps Script

Tôi đã viết xong code cho **8 job tự động nhắc nhở/báo cáo qua Telegram** theo đúng lịch bạn cho, nhưng **không thể tự deploy** (cần đăng nhập Google của bạn) và **không thể tự cài trigger** (thao tác `installDailyTriggers` cần quyền `script.scriptapp` mà project chưa từng xin — y hệt lần trước với quyền Google Drive).

### 8 job đã viết (theo đúng thứ tự bạn yêu cầu):
| # | Giờ | Việc làm |
|---|-----|----------|
| 1 | 7h30 | Nhắc chuẩn bị bữa sáng + gợi ý random món ăn |
| 2 | 8h30 | Nhắc cập nhật bữa sáng (chỉ gửi nếu app chưa thấy bạn ghi) |
| 3 | 10h30 | Nhắc chuẩn bị bữa trưa + gợi ý random món ăn |
| 4 | 12h30 | Nhắc cập nhật bữa trưa (chỉ gửi nếu chưa ghi) |
| 5 | 13h00 | Cảnh báo cần đặt thêm đồ ăn chiều nếu sáng/trưa bỏ bữa hoặc ăn không ngon (giờ này bạn không cho cụ thể, tôi chọn 13h00 — ngay sau job nhắc cập nhật bữa trưa 30 phút để có đủ dữ liệu kiểm tra) |
| 6 | 17h30 | Nhắc chuẩn bị bữa tối + gợi ý món chính + tráng miệng/hoa quả |
| 7 | 20h00 | Nhắc cập nhật bữa tối (chỉ gửi nếu chưa ghi) |
| 8 | 21h00 | Báo cáo tổng kết cả ngày: đã ghi mấy bữa, thiếu/bỏ bữa gì, có ăn rau không, đánh giá tốt/cần chỉnh, gợi ý cho ngày mai |

### Các bước cần làm khi bạn thức dậy:

1. Mở Apps Script editor (project đang dùng cho `an-uong.html`).
2. Dán lại toàn bộ nội dung mới nhất từ [`apps-script/Code.gs`](apps-script/Code.gs) vào (đã có sẵn trên git, hoặc copy từ file trong repo).
3. **Deploy → Manage deployments → bút chì → Version: New version → Deploy** (như mọi lần trước).
4. Lần này có thể sẽ hiện lại màn hình xin quyền mới (liên quan đến việc tạo trigger tự động — quyền `Xem và quản lý các trigger của bạn`) → làm như các lần trước: chọn tài khoản → Advanced → Go to [dự án] (unsafe) → Allow.
5. Sau khi deploy xong, mở đúng 1 trong 2 cách sau để bật lịch tự động (không cần làm cả 2, chọn cách nào tiện hơn):
   - **Cách A (khuyên dùng — không cần vào Apps Script editor)**: mở link này trên trình duyệt bất kỳ (điện thoại cũng được):
     ```
     https://script.google.com/macros/s/AKfycbyM2ODmrwD-mlM4CalUG4pSzGVwsBq9uw2GT6qJBWIDO7EIXPpxyZJNlP22m90m-lXM/exec?kind=install-triggers
     ```
     Nếu thấy `{"ok":true}` là xong. Nếu thấy lỗi nhắc tới quyền (`permission`/`authorization`) thì quay lại bước 4, đảm bảo đã cấp đủ quyền, rồi thử lại link này.
   - **Cách B (dự phòng nếu cách A báo lỗi quyền)**: vào Apps Script editor → dropdown chọn hàm cạnh nút ▷ Run → chọn `installDailyTriggers` → bấm Run → xử lý màn hình xin quyền nếu hiện ra → xong.
6. Kiểm tra đã cài đúng 8 trigger chưa bằng link:
   ```
   https://script.google.com/macros/s/AKfycbyM2ODmrwD-mlM4CalUG4pSzGVwsBq9uw2GT6qJBWIDO7EIXPpxyZJNlP22m90m-lXM/exec?kind=list-triggers
   ```
7. (Tuỳ chọn) Test thử ngay 1 job mà không cần chờ đúng giờ, ví dụ test báo cáo cuối ngày:
   ```
   https://script.google.com/macros/s/AKfycbyM2ODmrwD-mlM4CalUG4pSzGVwsBq9uw2GT6qJBWIDO7EIXPpxyZJNlP22m90m-lXM/exec?kind=run-job&name=sendDailyReport
   ```
   Đổi `name=` thành 1 trong: `remindPrepareBreakfast`, `remindUpdateBreakfast`, `remindPrepareLunch`, `remindUpdateLunch`, `alertAfternoonFoodIfNeeded`, `remindPrepareDinner`, `remindUpdateDinner`, `sendDailyReport`.

⚠️ Điều kiện để Telegram thực sự nhận được tin (đã có sẵn từ trước, không phải việc mới): Script Properties phải có `TELEGRAM_BOT_TOKEN` và `TELEGRAM_CHAT_ID`. Nếu 2 job test ở bước 7 không thấy tin nhắn nào, kiểm tra lại 2 giá trị này trong Apps Script editor (biểu tượng bánh răng bên trái → Script Properties).

---

## Các file đã thay đổi/thêm mới

- `an-uong.html` — flatpickr, lightbox, sửa bug hiển thị rau củ, thêm link Quay món ăn.
- `apps-script/Code.gs` — 8 job Telegram mới + endpoint `install-triggers`/`run-job`/`list-triggers` để tự kiểm tra qua trình duyệt, không cần vào Apps Script editor.
- `gacha-mon-an.html` — trang mới, tính năng quay gacha món ăn.
- `food-gacha-data.json` — dữ liệu tĩnh 204 món ăn cho gacha.

Tất cả đã commit và push lên git (nhánh `main`) — chi tiết commit xem `git log`.
