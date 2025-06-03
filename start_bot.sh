#!/bin/sh
# ───────────────────────────────────────────────
# start_bot.sh
#
#   Jalankan bot di background, simpan PID ke bot.pid,
#   dan arahkan semua log (stdout/stderr) ke bot.log.
# ───────────────────────────────────────────────

# 1) Path ke direktori bot (ubah jika perlu)
BOT_DIR="$HOME/wabase"

# 2) File untuk menyimpan log dan PID
LOG_FILE="$BOT_DIR/bot.log"
PID_FILE="$BOT_DIR/bot.pid"

echo "🚀 Menjalankan bot di $BOT_DIR ..."

# 3) Pindah ke direktori proyek
cd "$BOT_DIR" || {
  echo "❌ Gagal: direktori $BOT_DIR tidak ditemukan!"
  exit 1
}

# 4) Pastikan ada index.js atau bot.js
if [ ! -f "index.js" ] && [ ! -f "bot.js" ]; then
  echo "❌ Gagal: Tidak menemukan index.js atau bot.js di $BOT_DIR"
  exit 1
fi

# 5) Hapus bot.pid lama (jika ada), agar tidak bingung
if [ -f "$PID_FILE" ]; then
  rm -f "$PID_FILE"
fi

# 6) Jalankan bot dengan nohup, arahkan log ke bot.log
#    Lalu simpan PID ($!) ke bot.pid
nohup npm start > "$LOG_FILE" 2>&1 &
# Jika Anda ingin jalankan langsung node (tanpa npm start), 
# uncomment baris di bawah ini dan komen baris nohup npm start di atas:
# nohup node index.js > "$LOG_FILE" 2>&1 &

BOT_PID=$!
echo "$BOT_PID" > "$PID_FILE"

echo "✅ Bot dinyalakan! (PID: $BOT_PID)"
echo "   Log akan tertulis di: $LOG_FILE"
echo "   PID disimpan ke:     $PID_FILE"
