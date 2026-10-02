// ============================================================
// Cloudflare Worker — cầu nối Telegram -> Apps Script (project "meal")
// ============================================================
// Vì sao cần: Web App của Apps Script luôn trả "302 Found" cho webhook, Telegram coi đó là lỗi nên giữ tin lại
// và gửi lại nhiều lần, làm bot chậm hoặc im. Worker này trả 200 cho Telegram NGAY, rồi tự chuyển tin sang
// Apps Script ở phía sau (Apps Script vẫn tự bỏ qua tin trùng theo update_id).
//
// Biến cần đặt trong Worker (Settings > Variables and Secrets, loại Secret):
//   GAS_URL   = <URL /exec của Web App meal>?tg=<giá trị Script Property TELEGRAM_WEBHOOK_SECRET>
//   TG_SECRET = giá trị Script Property TELEGRAM_WEBHOOK_SECRET (Telegram gửi kèm trong header, Worker kiểm tra)
// Cài đặt đầy đủ: xem apps-script/README.md, mục "Proxy Cloudflare".

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') return new Response('ok');
    // Chỉ nhận tin do Telegram gửi (đúng secret_token đã đăng ký ở setWebhook).
    if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TG_SECRET) {
      return new Response('forbidden', { status: 403 });
    }
    const body = await request.text();
    // Chuyển sang Apps Script ở nền (waitUntil), không bắt Telegram chờ.
    ctx.waitUntil(
      fetch(env.GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        redirect: 'follow',
      }).catch(() => {})
    );
    return new Response('ok');
  },
};
