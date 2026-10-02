# Apps Script: 2 project riêng

| Project | Thư mục | Phục vụ | Thay đổi |
|---|---|---|---|
| **trip** | `trip/Code.gs` | `index.html`, `viewer.html` (cổng vào `gate-log`, phản hồi `feedback`) | Ổn định, hạn chế sửa |
| **meal** | `meal/*.gs` (5 file) | `an-uong.html` (bữa ăn, AI, món đã nhập, hồ sơ, Telegram, chat bot) | Sửa thường xuyên |

Hai project có URL Web App riêng, nên lỗi khi sửa phần ăn uống không thể làm hỏng cổng vào của trang chính.
Cả hai dùng chung 1 Google Sheet "DaLat Data" (qua Script Property `DATA_SHEET_ID`).

## Project trip
Giữ nguyên project Apps Script đang chạy hiện tại, **không cần làm gì** và giữ nguyên URL trong `index.html`, `viewer.html`.
Nếu muốn dọn code cũ: xoá trigger trước (xem bước 5 bên dưới), rồi dán `trip/Code.gs` đè lên.

## Cài project meal (làm 1 lần)
1. script.google.com → **New project**, đặt tên `DaLat Meal`.
2. Tạo đủ 4 file, tên đúng như sau rồi dán nội dung tương ứng:
   `Code.gs`, `Ai.gs`, `Dishes.gs`, `Telegram.gs`, `Bot.gs` (mọi file `.gs` trong cùng 1 project dùng chung phạm vi hàm).
3. **Project Settings**:
   - Đặt múi giờ `Asia/Ho_Chi_Minh` (Show "appsscript.json" hoặc mục General settings).
   - Script Properties, **đặt `DATA_SHEET_ID` trước khi chạy lần đầu** (nếu không, project tự tạo Sheet mới trống):
     - `DATA_SHEET_ID`: ID của Sheet "DaLat Data" (đoạn giữa `/d/` và `/edit` trong URL của Sheet).
     - `PHOTO_FOLDER_ID`: ID thư mục Drive "DaLat Meal Photos" đang có (cuối URL thư mục), để ảnh cũ vẫn hiện.
     - `GEMINI_API_KEY`: key Gemini (hoặc `ANTHROPIC_API_KEY`). Tuỳ chọn `GEMINI_MODEL`.
     - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
   - Hồ sơ cơ thể Long/Uyn đang nằm ở Script Properties của project cũ (`USER_PROFILE_Long`, `USER_PROFILE_Uyn`, hoặc `USER_PROFILE` bản cũ). Sao chép sang hoặc nhập lại trong app.
4. **Deploy → New deployment → Web app** (Execute as: Me, Who has access: Anyone). Cấp quyền khi Google hỏi (Sheet, Drive, gọi ra ngoài). Sao chép URL `/exec`.
5. **Trigger Telegram: tránh gửi trùng**
   - Ở project **cũ**: mở `<URL cũ>?kind=list-triggers` xem có 8 trigger, xoá chúng ở mục **Triggers** (biểu tượng đồng hồ) của project cũ.
   - Ở project **mới**: mở `<URL mới>?kind=install-triggers` (hoặc chạy hàm `installDailyTriggers` trong editor), rồi `?kind=list-triggers` để kiểm tra đủ 8.
6. Gửi URL mới để đổi `GAS_ENDPOINT` trong `an-uong.html`. Đổi xong mới commit.

## Kiểm tra sau mỗi lần deploy project meal
- `?kind=ai-status` → `"ok":true`
- `?kind=meal` → trả về mảng các bữa ăn
- `?kind=profiles` → `"ok":true`
- Lưu thử 1 bữa trong app, xem có dòng mới trong tab Meals.

## Deploy bản mới mà không đổi URL
Deploy → **Manage deployments** → biểu tượng bút chì → Version: **New version** → Deploy.
Bản hỏng thì cũng ở đó chọn lại version trước để rollback, không mất dữ liệu.

## Chat với bot để ghi bữa ăn (Bot.gs)
Cài 1 lần:
1. Thêm file `Bot.gs` vào project meal, dán bản mới của `Code.gs`, rồi Save.
2. Deploy version mới (như mục dưới). Lần này Google sẽ hỏi thêm quyền **Cache/Lock**, bấm Cho phép.
3. Mở `<URL /exec>?kind=set-webhook`, kết quả phải là `"ok":true`. Kiểm tra `"url"` đúng là URL `/exec` đang dùng.
   Nếu sai (ra URL `/dev` hoặc URL khác), thêm Script Property `MEAL_WEBAPP_URL` = URL `/exec` rồi mở lại.
4. Không cần đăng ký: bot tự nhận ra người nhắn theo username (`@llong_llong` = Anh Long, `@MinhUyennn` = Bé Uyn, sửa ở `TG_USERS` đầu `Bot.gs`).

Cách dùng: **trong group, mỗi tin gửi bot phải @tag tên bot hoặc trả lời (reply) 1 tin của bot** (kể cả `/an`, ảnh kèm chú thích); không thì bot bỏ qua.
Nhắn riêng với bot thì không cần.
Ví dụ `@tên_bot tối nay anh ăn cơm gà với canh rau ngót`. Bot gửi bản nháp có kcal do AI ước tính. Reply bản nháp để sửa
(`650 kcal`, `bữa trưa`, `cả Uyn nữa`, gửi ảnh...). Bấm 😋/😕/🤢 để lưu vào tab Meals, ❌ để huỷ, `@tên_bot /huy` để huỷ bản nháp.

- Tên bot tự lấy qua `getMe` và lưu ở Script Property `TELEGRAM_BOT_USERNAME` (đổi bot khác thì xoá property này đi).
- Không cần tắt Privacy Mode của bot: tin có @tag và tin reply bot luôn tới được bot.
- Bot chỉ phục vụ group có `TELEGRAM_CHAT_ID`, và chỉ trả lời 2 username trên.
- `TELEGRAM_BOT_ENABLED` (đầu `Bot.gs`) bật/tắt riêng phần chat. `TELEGRAM_ENABLED` (đầu `Telegram.gs`) bật/tắt tin nhắc tự động.
- `?kind=webhook-info` xem Telegram có gọi được không (`last_error_message` báo 302 là bình thường với Apps Script, bot vẫn chạy).

### Proxy Cloudflare (nên dùng nếu bot lúc trả lời lúc im)
Apps Script luôn trả `302` cho webhook nên Telegram coi là lỗi, giữ tin lại và gửi lại nhiều lần. Worker miễn phí của Cloudflare
đứng giữa: trả `200` cho Telegram ngay rồi chuyển tin sang Apps Script ở phía sau.
1. Đăng ký `dash.cloudflare.com/sign-up` (chỉ cần email, không cần thẻ), vào **Workers & Pages** > **Create** > **Create Worker**, đặt tên
   (vd `meal-bot-proxy`), Deploy, rồi **Edit code** và dán toàn bộ `apps-script/telegram-proxy/worker.js`, Deploy.
2. Worker > **Settings** > **Variables and Secrets**, thêm 2 Secret (giá trị `TELEGRAM_WEBHOOK_SECRET` xem ở Apps Script > Project Settings > Script Properties):
   - `TG_SECRET` = giá trị `TELEGRAM_WEBHOOK_SECRET`
   - `GAS_URL` = `<URL /exec của Web App meal>?tg=<giá trị TELEGRAM_WEBHOOK_SECRET>`
3. Apps Script > Script Properties, thêm `TELEGRAM_PROXY_URL` = địa chỉ Worker (dạng `https://meal-bot-proxy.<tên>.workers.dev`).
4. Dán bản mới của `Bot.gs`, deploy New version, rồi mở `<URL /exec>?kind=set-webhook` (kết quả có `"mode":"proxy"`).
   Muốn quay lại gọi thẳng Apps Script thì xoá Script Property `TELEGRAM_PROXY_URL` và mở lại `set-webhook`.

## Thêm chức năng mới cho meal
Tạo 1 file `.gs` riêng cho chức năng, rồi thêm 1 nhánh `kind` trong `doPost` (ghi) hoặc `doGet` (đọc) ở `Code.gs`.

## Ghi chú
- Đã bỏ 2 endpoint tạm `?kind=debug` và `?kind=reset-meals` khỏi project meal. `reset-meals` cho phép bất kỳ ai biết URL xoá cả tab Meals.
- Web App để "Anyone" nên ai có URL đều gọi được các endpoint. Không đưa URL ra ngoài, và không lưu dữ liệu nhạy cảm.
