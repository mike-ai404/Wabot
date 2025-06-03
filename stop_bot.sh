#!/bin/sh
# ───────────────────────────────────────────────
# stop_bot.sh
#
#   Membaca PID dari bot.pid, lalu kill proses tsb.
#   Jika PID tidak ditemukan atau proses sudah mati,
#   maka tampilkan pesan “Bot tidak ditemukan”.
# ───────────────────────────────────────────────

# 1) Path ke direktori bot (harus sama dengan start_bot.sh)
BOT_DIR="$HOME/wabase"

# 2) File PID
PID_FILE="$BOT_DIR/bot.pid"

echo "⏹ Menghentikan bot (jika ada) di $BOT_DIR ..."

# 3) Pastikan bot.pid ada
if [ ! -f "$PID_FILE" ]; then
  echo "❌ Bot.pid tidak ditemukan di $PID_FILE (mungkin bot belum dijalankan atau sudah dihentikan)."
  exit 1
fi

# 4) Baca PID
BOT_PID=$(cat "$PID_FILE")

# 5) Cek apakah proses dengan PID itu masih hidup
if ps -p "$BOT_PID" > /dev/null 2>&1; then
  # Jika hidup, kirim sinyal TERM
  kill "$BOT_PID"
  echo "✅ Bot (PID: $BOT_PID) telah dihentikan."

  # Hapus PID file
  rm -f "$PID_FILE"
else
  # Proses sudah mati tetapi bot.pid masih ada
  echo "❌ Proses PID $BOT_PID tidak ditemukan (mungkin sudah mati)."
  echo "   Menghapus file $PID_FILE"
  rm -f "$PID_FILE"
fi
