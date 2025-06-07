// bot.js

import pkg from "@whiskeysockets/baileys";
const { makeWASocket, useMultiFileAuthState } = pkg;
import pino from "pino";
import readline from "readline";
import fs from "fs";
import path from "path";
import schedule from "node-schedule";

// ======= PENGATURAN & STATE GLOBAL =======

// Password admin
const ADMIN_PASSWORD = "megalodon";

// Set user‐JID yang sudah login sebagai admin
const authenticatedAdmins = new Set();

// ======= UTILITY: PROMPT PAIRING CODE =======
function question(text = "question") {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(`\x1b[32;1m?\x1b[0m\x20\x1b[1m${text}\x1b[0m `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ======= PATH FILE JSON =======
const SCHEDULE_FILE   = path.join("session", "schedules.json");
const ONETIME_FILE    = path.join("session", "onetime.json");
const CHATS_FILE      = path.join("session", "chats.json");
const BANNED_FILE     = path.join("session", "banned.json");
const SETTINGS_FILE   = path.join("session", "settings.json");
const INFO_FILE       = path.join("session", "info.json");

// ======= MAP HARI (IND→0..6) =======
const DAYS_MAP = {
  minggu: 0,
  senin:  1,
  selasa: 2,
  rabu:   3,
  kamis:  4,
  jumat:  5,
  sabtu:  6,
};

// ======= HELPER JSON LOAD / SAVE =======
function loadJSON(filePath, defaultValue) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch (e) {
    console.error(`Gagal memuat ${filePath}:`, e);
  }
  return defaultValue;
}
function saveJSON(filePath, data) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) {
    console.error(`Gagal menyimpan ${filePath}:`, e);
  }
}

function loadSchedules()    { return loadJSON(SCHEDULE_FILE, []); }
function saveSchedules(arr) { saveJSON(SCHEDULE_FILE, arr); }

function loadOneTime()      { return loadJSON(ONETIME_FILE, {}); }
function saveOneTime(obj)   { saveJSON(ONETIME_FILE, obj); }

function loadChats()        { return loadJSON(CHATS_FILE, {}); }
function saveChats(obj)     { saveJSON(CHATS_FILE, obj); }

function loadBanned()       { return loadJSON(BANNED_FILE, ["anjing","goblok","babi","tolol","idiot","bangsat"]); }
function saveBanned(arr)    { saveJSON(BANNED_FILE, arr); }

function loadSettings()     { return loadJSON(SETTINGS_FILE, {}); }
function saveSettings(obj)  { saveJSON(SETTINGS_FILE, obj); }

function loadInfo()         { return loadJSON(INFO_FILE, ""); }
function saveInfo(text)     { saveJSON(INFO_FILE, text); }

// ======= PARSE MENTION: Cari pola "@628xxx" atau "@+628xxx" =======
function parseMentions(text) {
  const mentionRegex = /@(\+?\d{8,15})/g;
  const mentions = [];
  let cleaned = text.replace(mentionRegex, (match, number) => {
    const digits = number.replace(/\D/g, "");
    const jid = `${digits}@s.whatsapp.net`;
    mentions.push(jid);
    return "";
  });
  cleaned = cleaned.replace(/\s{2,}/g, " ").trim();
  return { cleaned, mentions };
}

// ======= HELPERS: ALIAS ⇄ JID =======
function computeAlias(jid) {
  if (jid.endsWith("@g.us")) {
    const num = jid.split("@")[0];
    return num.slice(-8);
  } else {
    return jid.split("@")[0];
  }
}
function resolveAlias(input, chatsMap) {
  // input bisa "alias" atau "jid" 
  if (input.includes("@")) {
    // dianggap JID langsung
    return input;
  }
  // cari JID yang alias-nya sama
  for (const jid of Object.keys(chatsMap)) {
    if (computeAlias(jid) === input) return jid;
  }
  return null;
}

// ======= PENJADWALAN MINGGUAN =======
function scheduleWeeklyJob(entry, bot) {
  const dayLower = entry.day.toLowerCase();
  if (!(dayLower in DAYS_MAP)) {
    console.warn(`Hari tidak dikenal: ${entry.day}`);
    return;
  }
  const rule = new schedule.RecurrenceRule();
  rule.tz = "Asia/Jakarta";
  rule.dayOfWeek = DAYS_MAP[dayLower];
  rule.hour = entry.hour;
  rule.minute = entry.minute;

  schedule.scheduleJob(entry.id, rule, async () => {
    try {
      if (!entry.chatId || typeof entry.chatId !== "string" || !entry.chatId.includes("@")) {
        console.warn(`❌ JID tidak valid: "${entry.chatId}" — lewati job ini.`);
        return;
      }
      const { cleaned, mentions } = parseMentions(entry.message);
      const msgPayload = { text: cleaned };
      if (mentions.length) msgPayload.mentions = mentions;
      await bot.sendMessage(entry.chatId, msgPayload);
      console.log(
        `📨 Pesan terkirim ke ${entry.chatId} — "${entry.message}" (${entry.day} ${String(entry.hour).padStart(2,"0")}:${String(entry.minute).padStart(2,"0")})`
      );
    } catch (err) {
      if (err.output?.statusCode === 428 || err.output?.statusCode === 408) {
        console.warn(
          `⚠️ Gagal kirim jadwal [${entry.id}] ke ${entry.chatId}: ${err.output.payload.error} (${err.output.payload.message})`
        );
      } else {
        console.error("Gagal mengirim pesan terjadwal:", err);
      }
    }
  });
}

// ======= PENJADWALAN ONE‐TIME =======
function scheduleOneTimeJob(key, entry, bot) {
  const targetTime = new Date(entry.timestamp);
  schedule.scheduleJob(key, targetTime, async () => {
    try {
      if (!entry.chatId || typeof entry.chatId !== "string" || !entry.chatId.includes("@")) {
        console.warn(`❌ JID tidak valid untuk one-time: "${entry.chatId}" — lewati job ini.`);
        return;
      }
      const { cleaned, mentions } = parseMentions(entry.message);
      const msgPayload = { text: cleaned };
      if (mentions.length) msgPayload.mentions = mentions;
      await bot.sendMessage(entry.chatId, msgPayload);
      console.log(
        `🔔 One‐time reminder terkirim ke ${entry.chatId} — "${entry.message}" (pada ${targetTime.toString()})`
      );
      let allOneTime = loadOneTime();
      delete allOneTime[key];
      saveOneTime(allOneTime);
    } catch (err) {
      if (err.output?.statusCode === 428 || err.output?.statusCode === 408) {
        console.warn(
          `⚠️ Gagal kirim one‐time [${key}] ke ${entry.chatId}: ${err.output.payload.error} (${err.output.payload.message})`
        );
      } else {
        console.error("Gagal mengirim one‐time reminder:", err);
      }
      let allOneTime = loadOneTime();
      delete allOneTime[key];
      saveOneTime(allOneTime);
    }
  });
}

// ======= VALIDASI ADMIN =======
function isAdmin(userJid) {
  return authenticatedAdmins.has(userJid);
}

// ======= MAIN BOT =======
(async function start(usePairingCode = true) {
  const { state, saveCreds } = await useMultiFileAuthState("session");
  const bot = makeWASocket({
    printQRInTerminal: !usePairingCode,
    auth: state,
    logger: pino({ level: "error" }),
  });

  // Jika pairing‐code mode
  if (usePairingCode && !bot.user && !state.creds.registered) {
    const pakaiPairing =
      (await question("Ingin terhubung menggunakan pairing code? [Y/n]: ")).toLowerCase() !== "n";
    if (!pakaiPairing) return start(false);
    const waNumber = await question("Masukkan nomor WhatsApp Anda: +");
    const numeric = waNumber.replace(/\D/g, "");
    const code = await bot.requestPairingCode(numeric);
    console.log(`PAIRING CODE: ${code}`);
  }

  // ======= EVENT: CONNECTION.UPDATE =======
  bot.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
    if (connection === "close") {
      console.log("⛔ Koneksi terputus:", lastDisconnect.error?.output?.payload || lastDisconnect.error);
      const statusCode = lastDisconnect.error?.output?.payload?.statusCode;
      const error = lastDisconnect.error?.output?.payload?.error;
      if (statusCode === 401 && error === "Unauthorized") {
        await fs.promises.rm("session", { recursive: true, force: true });
      }
      return start();
    }
    if (connection === "open") {
      console.log("✅ Terhubung sebagai:", bot.user.id.split(":")[0]);

      // Jadwalkan ulang jadwal mingguan
      const schedules = loadSchedules();
      schedules.forEach((entry) => scheduleWeeklyJob(entry, bot));
      console.log(`   • Jadwal mingguan: ${schedules.length} job`);

      // Jadwalkan ulang one‐time
      const allOneTime = loadOneTime();
      let countOne = 0;
      for (const [key, entry] of Object.entries(allOneTime)) {
        if (Date.now() > entry.timestamp) {
          delete allOneTime[key];
        } else {
          scheduleOneTimeJob(key, entry, bot);
          countOne++;
        }
      }
      saveOneTime(allOneTime);
      console.log(`   • One‐time reminder: ${countOne} job`);
    }
  });

  // Simpan kredensial
  bot.ev.on("creds.update", saveCreds);

  // ======= EVENT: GROUP PARTICIPANTS UPDATE (WELCOME/FAREWELL) =======
  bot.ev.on("group-participants.update", async (update) => {
    /*
      update = {
        id: "<groupJid>@g.us",
        participants: [ "62xxx@s.whatsapp.net", ... ],
        action: "add" || "remove"
      }
    */
    const groupJid = update.id;
    const settings = loadSettings();
    // default welcome/antilink off
    const groupSettings = settings[groupJid] || { welcome: false, antilink: false };

    for (const userJid of update.participants) {
      if (update.action === "add" && groupSettings.welcome) {
        await bot.sendMessage(groupJid, {
          text: `👋 Selamat datang @${userJid.split("@")[0]}!`,
          mentions: [userJid],
        });
      }
      if (update.action === "remove" && groupSettings.welcome) {
        await bot.sendMessage(groupJid, {
          text: `👋 Sampai jumpa @${userJid.split("@")[0]}!`,
          mentions: [userJid],
        });
      }
    }
  });

  // ======= EVENT: PESAN MASUK =======
  bot.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid; // JID chat (grup atau privat)
    const sender = msg.key.participant || from; // JID pengirim
    const pushName = msg.pushName || ""; // Nama tampilan

    const conversation = msg.message.conversation;
    const extendedText = msg.message.extendedTextMessage?.text;
    const text = conversation || extendedText;
    if (!text) return;
    const trimmed = text.trim();

    // ======= SIMPAN CHAT ID & NAMA =======
    let chatsMap = loadChats();
    if (!chatsMap[from]) {
      let displayName = from;
      try {
        if (from.endsWith("@g.us")) {
          const meta = await bot.groupMetadata(from);
          displayName = meta.subject || from;
        } else {
          displayName = pushName || from;
        }
      } catch {
        displayName = from;
      }
      chatsMap[from] = displayName;
      saveChats(chatsMap);
    }

    // ======= COMMAND UNTUK SEMUA: .info =======
    if (trimmed === ".info") {
      const infoText = loadInfo();
      if (!infoText) {
        await bot.sendMessage(from, { text: "ℹ️ Belum ada informasi yang disetel oleh admin." });
      } else {
        await bot.sendMessage(from, { text: `ℹ️ Informasi:\n\n${infoText}` });
      }
      return;
    }

    // ======= FITUR BARU UNTUK SEMUA =======

    // 1. .flip <teks> => membalik teks
    if (trimmed.startsWith(".flip ")) {
      const toFlip = trimmed.slice(6).trim();
      if (!toFlip) {
        await bot.sendMessage(from, { text: "❗ Contoh: .flip Halo Dunia" });
      } else {
        const flipped = toFlip.split("").reverse().join("");
        await bot.sendMessage(from, { text: `🔄 ${flipped}` });
      }
      return;
    }

    // 2. .rand <min> <max> => angka random antara min dan max
    if (trimmed.startsWith(".rand ")) {
      const parts = trimmed.slice(6).trim().split(" ");
      if (parts.length !== 2) {
        await bot.sendMessage(from, { text: "❗ Contoh: .rand 1 100" });
      } else {
        const min = parseInt(parts[0], 10);
        const max = parseInt(parts[1], 10);
        if (isNaN(min) || isNaN(max) || min > max) {
          await bot.sendMessage(from, { text: "❗ Pastikan min dan max adalah angka dengan min ≤ max." });
        } else {
          const rnd = Math.floor(Math.random() * (max - min + 1)) + min;
          await bot.sendMessage(from, { text: `🎲 Angka random: *${rnd}*` });
        }
      }
      return;
    }

    // 3. .calc <ekspresi> => hitung ekspresi aritmatika sederhana
    if (trimmed.startsWith(".calc ")) {
      const expr = trimmed.slice(6).trim();
      if (!expr) {
        await bot.sendMessage(from, { text: "❗ Contoh: .calc 12*(3+4)/2" });
      } else {
        try {
          // Hanya izinkan angka, operator + - * / () dan spasi
          if (!/^[\d+\-*/().\s]+$/.test(expr)) {
            throw new Error("Ekspresi mengandung karakter tidak valid.");
          }
          // eslint-disable-next-line no-eval
          const result = eval(expr);
          await bot.sendMessage(from, { text: `🧮 Hasil: *${result}*` });
        } catch (err) {
          await bot.sendMessage(from, { text: "❗ Gagal menghitung. Pastikan format benar." });
        }
      }
      return;
    }

    // 4. .timezonetime <zona> => waktu di zona waktu tertentu
    if (trimmed.startsWith(".timezonetime ")) {
      const zone = trimmed.slice(13).trim();
      if (!zone) {
        await bot.sendMessage(from, { text: "❗ Contoh: .timezonetime Asia/Tokyo" });
      } else {
        try {
          const now = new Date();
          const options = { timeZone: zone, hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" };
          const timeStr = now.toLocaleTimeString("en-US", options);
          await bot.sendMessage(from, { text: `🕒 Waktu di ${zone}: ${timeStr}` });
        } catch (err) {
          await bot.sendMessage(from, { text: "❗ Zona waktu tidak valid." });
        }
      }
      return;
    }

    // 5. .whois <@mention> => info dasar user
    if (trimmed.startsWith(".whois ")) {
      const after = trimmed.slice(7).trim();
      const { mentions } = parseMentions(after);
      if (mentions.length === 0) {
        await bot.sendMessage(from, { text: "❗ Contoh: .whois @+6281234567890" });
      } else {
        const userJid = mentions[0];
        const displayName = loadChats()[userJid] || userJid.split("@")[0];
        await bot.sendMessage(from, {
          text: `👤 Info User:\n• Nama: ${displayName}\n• JID: ${userJid}`
        });
      }
      return;
    }

    // ======= LOGIN ADMIN (hanya di chat privat) =======
    if (!from.endsWith("@g.us") && trimmed.startsWith(".login ")) {
      const pass = trimmed.slice(7).trim();
      if (pass === ADMIN_PASSWORD) {
        authenticatedAdmins.add(sender);
        await bot.sendMessage(from, { text: "✅ Berhasil login sebagai admin." });
      } else {
        await bot.sendMessage(from, { text: "❌ Password salah. Akses ditolak." });
      }
      return;
    }

    // ======= LOGOUT ADMIN =======
    if (!from.endsWith("@g.us") && trimmed === ".logout") {
      if (isAdmin(sender)) {
        authenticatedAdmins.delete(sender);
        await bot.sendMessage(from, { text: "🔒 Anda telah logout dari akses admin." });
      } else {
        await bot.sendMessage(from, { text: "❗ Anda belum login sebagai admin." });
      }
      return;
    }

    // Jika bukan login/logout atau .info dan belum admin, tolak semua perintah yang dimulai "."
    if (!isAdmin(sender) && trimmed.startsWith(".") && trimmed !== ".info") {
      await bot.sendMessage(from, {
        text: "❗ Anda harus login sebagai admin dulu di chat pribadi. Gunakan: .login <password>",
      });
      return;
    }

    // ======= COMMANDS UNTUK ADMIN =======

    // ===== .setinfo =====
    if (trimmed.startsWith(".setinfo ")) {
      const infoText = trimmed.slice(9).trim();
      if (!infoText) {
        await bot.sendMessage(from, {
          text: "❗ Contoh: .setinfo Ini adalah informasi grup yang ditampilkan kepada semua pengguna.",
        });
        return;
      }
      saveInfo(infoText);
      await bot.sendMessage(from, { text: "✅ Informasi berhasil disetel." });
      return;
    }

    // ===== .help =====
    if (trimmed === ".help") {
      const helpText =
        "📖 *Daftar Perintah Bot (Admin saja)*\n\n" +
        "1. *.login <password>*\n" +
        "   - Login sebagai admin di chat pribadi. Contoh: .login megalodon\n\n" +
        "2. *.logout*\n" +
        "   - Logout dari akses admin.\n\n" +
        "3. *.help*\n" +
        "   - Menampilkan menu bantuan ini.\n\n" +
        "4. *.chatid*\n" +
        "   - Menampilkan daftar chat dengan format alias (id)-(jid)-(nama).\n\n" +
        "5. *.jadwal <alias>+<hari>+<jam.menit>(<pesan>)*\n" +
        "   - Tambah jadwal mingguan otomatis (alias diperbolehkan, contoh: 48137449).\n\n" +
        "6. *.listjadwal*\n" +
        "   - Daftar semua jadwal mingguan.\n\n" +
        "7. *.nextjadwal*\n" +
        "   - Jadwal mingguan berikutnya.\n\n" +
        "8. *.editjadwal <nomor> <hari>+<jam.menit>(<pesan>)*\n" +
        "   - Edit jadwal mingguan.\n\n" +
        "9. *.hapusjadwal <nomor>*\n" +
        "   - Hapus satu jadwal.\n\n" +
        "10. *.clearjadwal*\n" +
        "    - Hapus semua jadwal mingguan.\n\n" +
        "11. *.ingat <YYYY-MM-DD>+<jam.menit>(<pesan>)*\n" +
        "    - Pengingat one-time (alias diperbolehkan untuk chatId).\n\n" +
        "12. *.listonetime*\n" +
        "    - Daftar pengingat one-time.\n\n" +
        "13. *.hapusot <nomor>*\n" +
        "    - Hapus satu pengingat one-time.\n\n" +
        "14. *.nextonetime*\n" +
        "    - Pengingat one-time berikutnya.\n\n" +
        "15. *.status*\n" +
        "    - Status bot (uptime, jumlah job, dll).\n\n" +
        "16. *.broadcast <pesan>*\n" +
        "    - Kirim pesan ke semua chat yang tersimpan.\n\n" +
        "17. *.ping*\n" +
        "    - Cek respons bot (pong!).\n\n" +
        "18. *.time*\n" +
        "    - Tampilkan waktu server (Asia/Jakarta).\n\n" +
        "19. *.addbadword <kata>*\n" +
        "    - Tambah kata kasar baru yang dilarang.\n\n" +
        "20. *.removebadword <kata>*\n" +
        "    - Hapus kata kasar dari daftar.\n\n" +
        "21. *.listbadwords*\n" +
        "    - Daftar kata-kata kasar yang dilarang.\n\n" +
        "22. *.groupinfo*\n" +
        "    - Menampilkan nama grup, jumlah anggota, daftar admin.\n\n" +
        "23. *.admins*\n" +
        "    - Menampilkan daftar admin grup saja.\n\n" +
        "24. *.welcome <on/off>*\n" +
        "    - Aktifkan/matikan pesan welcome/farewell.\n\n" +
        "25. *.antilink <on/off>*\n" +
        "    - Aktifkan/matikan hapus otomatis pesan berisi link.\n\n" +
        "26. *.setdesc <deskripsi>*\n" +
        "    - Ubah deskripsi grup.\n\n" +
        "27. *.promote <userJid>*\n" +
        "    - Promosikan user menjadi admin.\n\n" +
        "28. *.demote <userJid>*\n" +
        "    - Turunkan admin menjadi user biasa.\n\n" +
        "29. *.tagall*\n" +
        "    - Mention seluruh member grup.\n\n" +
        "30. *.groupinvite <pesan>*\n" +
        "    - Kirim link undangan grup beserta pesan opsional.\n\n" +
        "31. *.setinfo <teks>*\n" +
        "    - Admin menetapkan informasi global. Semua orang bisa lihat dengan .info.\n\n" +
        "_Gunakan: .login <password> untuk login admin, lalu ketik perintah di atas._\n";
      await bot.sendMessage(from, { text: helpText });
      return;
    }

    // ===== .chatid =====
    if (trimmed === ".chatid") {
      const chatsMap = loadChats(); // { "<jid>": "<nama>" }
      const entries = Object.entries(chatsMap);

      if (entries.length === 0) {
        await bot.sendMessage(from, { text: "❗ Belum ada chat yang tersimpan." });
        return;
      }

      let reply = "📋 Chat id 🪪\n\n";
      entries.forEach(([jid, name], idx) => {
        const alias = computeAlias(jid);
        // format dengan spasi: alias (jid)-(nama)
        reply += `${idx + 1}. ${alias} (${jid})-(${name})\n`;
      });

      await bot.sendMessage(from, { text: reply });
      return;
    }

    // ===== .jadwal =====
    if (trimmed.startsWith(".jadwal ")) {
      const payload = trimmed.slice(8).trim();
      const parts = payload.split("+");
      if (parts.length < 3) {
        await bot.sendMessage(from, {
          text:
            "❗ Format salah. Contoh:\n" +
            ".jadwal 48137449+senin+09.00(Halo @+6281234567890, jangan lupa besok rapat)",
        });
        return;
      }

      const rawTarget = parts[0].trim();
      const chatIdResolved = resolveAlias(rawTarget, loadChats());
      if (!chatIdResolved) {
        await bot.sendMessage(from, {
          text: `❗ Alias/JID tidak ditemukan: "${rawTarget}". Gunakan .chatid untuk melihat daftar.`,
        });
        return;
      }
      const hari = parts[1].trim().toLowerCase();
      const timeAndMsg = parts.slice(2).join("+");
      const bracketOpen = timeAndMsg.indexOf("(");
      const bracketClose = timeAndMsg.lastIndexOf(")");
      if (bracketOpen === -1 || bracketClose === -1 || bracketClose < bracketOpen) {
        await bot.sendMessage(from, {
          text: "❗ Format jam.pesan salah. Gunakan: jam.menit(pesan).",
        });
        return;
      }

      const timeStr = timeAndMsg.slice(0, bracketOpen).trim();
      const msgContent = timeAndMsg.slice(bracketOpen + 1, bracketClose).trim();
      if (!timeStr.includes(".")) {
        await bot.sendMessage(from, { text: "❗ Format waktu harus jam.menit, contoh 08.30." });
        return;
      }

      const [jamStr, menitStr] = timeStr.split(".");
      const jam = parseInt(jamStr, 10);
      const menit = parseInt(menitStr, 10);
      if (
        isNaN(jam) ||
        isNaN(menit) ||
        jam < 0 ||
        jam > 23 ||
        menit < 0 ||
        menit > 59
      ) {
        await bot.sendMessage(from, { text: "❗ Waktu tidak valid." });
        return;
      }
      if (!(hari in DAYS_MAP)) {
        await bot.sendMessage(from, {
          text:
            "❗ Hari tidak dikenal. Gunakan: senin, selasa, rabu, kamis, jumat, sabtu, minggu.",
        });
        return;
      }

      const jobId = `job_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const newEntry = {
        id: jobId,
        chatId: chatIdResolved,
        day: hari,
        hour: jam,
        minute: menit,
        message: msgContent,
      };

      const schedules = loadSchedules();
      schedules.push(newEntry);
      saveSchedules(schedules);
      scheduleWeeklyJob(newEntry, bot);

      await bot.sendMessage(from, {
        text:
          `✅ Jadwal ditambahkan:\n` +
          `• Alias: ${rawTarget}\n` +
          `• JID: ${chatIdResolved}\n` +
          `• Hari: ${hari}\n` +
          `• Waktu: ${String(jam).padStart(2, "0")}:${String(menit).padStart(2, "00")}\n` +
          `• Pesan: "${msgContent}"\n` +
          `Bot akan kirim tiap minggu.`,
      });
      return;
    }

    // ===== .listjadwal =====
    if (trimmed === ".listjadwal") {
      const schedules = loadSchedules();
      if (schedules.length === 0) {
        await bot.sendMessage(from, { text: "❗ Tidak ada jadwal tersimpan." });
        return;
      }
      let reply = "📋 Daftar Jadwal Mingguan:\n\n";
      schedules.forEach((entry, idx) => {
        const alias = computeAlias(entry.chatId);
        reply +=
          `${idx + 1}. [${entry.id}]\n` +
          `   • Alias: ${alias}\n` +
          `   • JID: ${entry.chatId}\n` +
          `   • Hari: ${entry.day}\n` +
          `   • Waktu: ${String(entry.hour).padStart(2, "0")}:${String(
            entry.minute
          ).padStart(2, "00")}\n` +
          `   • Pesan: ${entry.message}\n\n`;
      });
      reply +=
        "Gunakan:\n" +
        "• `.editjadwal <nomor> <hari>+<jam.menit>(<pesan>)`\n" +
        "• `.hapusjadwal <nomor>`\n" +
        "• `.clearjadwal`";
      await bot.sendMessage(from, { text: reply });
      return;
    }

    // ===== .nextjadwal =====
    if (trimmed === ".nextjadwal") {
      const schedules = loadSchedules();
      if (schedules.length === 0) {
        await bot.sendMessage(from, { text: "❗ Tidak ada jadwal tersimpan." });
        return;
      }
      const now = new Date();
      const nextList = schedules.map((entry) => {
        const dayIndex = DAYS_MAP[entry.day.toLowerCase()];
        const nextDate = new Date(now);
        nextDate.setHours(entry.hour, entry.minute, 0, 0);
        const diffDay = (dayIndex - nextDate.getDay() + 7) % 7;
        nextDate.setDate(
          nextDate.getDate() + (diffDay === 0 && nextDate < now ? 7 : diffDay)
        );
        return { entry, timestamp: nextDate.getTime() };
      });
      nextList.sort((a, b) => a.timestamp - b.timestamp);
      const nearest = nextList[0];
      const selisihMs = nearest.timestamp - now.getTime();
      const totalMin = Math.floor(selisihMs / 60000);
      const jamSisa = Math.floor(totalMin / 60);
      const menitSisa = totalMin % 60;
      const displayWaktu = `~${jamSisa} jam ${menitSisa} menit lagi`;

      const e = nearest.entry;
      const alias = computeAlias(e.chatId);
      let reply =
        "⏰ Jadwal berikutnya:\n\n" +
        `• [${e.id}]\n` +
        `  • Alias: ${alias}\n` +
        `  • JID: ${e.chatId}\n` +
        `  • Hari: ${e.day}\n` +
        `  • Waktu: ${String(e.hour).padStart(2, "00")}:${String(e.minute).padStart(2, "00")}\n` +
        `  • Pesan: ${e.message}\n\n` +
        `(Disetel ${displayWaktu})`;
      await bot.sendMessage(from, { text: reply });
      return;
    }

    // ===== .editjadwal =====
    if (trimmed.startsWith(".editjadwal ")) {
      const partsAll = trimmed.split(" ");
      if (partsAll.length < 3) {
        await bot.sendMessage(from, {
          text: "❗ Contoh: .editjadwal 2 kamis+18.45(Halo @+62812, ...)",
        });
        return;
      }
      const idx = parseInt(partsAll[1], 10);
      const schedules = loadSchedules();
      if (isNaN(idx) || idx < 1 || idx > schedules.length) {
        await bot.sendMessage(from, { text: "❗ Nomor jadwal tidak valid." });
        return;
      }
      const payload = partsAll.slice(2).join(" ");
      const subParts = payload.split("+");
      if (subParts.length < 2) {
        await bot.sendMessage(from, { text: "❗ Format: <hari>+<jam.menit>(<pesan>)" });
        return;
      }
      const hariBaru = subParts[0].trim().toLowerCase();
      const tmMsg = subParts.slice(1).join("+");
      const ob = tmMsg.indexOf("(");
      const cb = tmMsg.lastIndexOf(")");
      if (ob === -1 || cb === -1 || cb < ob) {
        await bot.sendMessage(from, {
          text: "❗ Format pesan salah—harus ada tanda `( )`.",
        });
        return;
      }
      const timeStrNew = tmMsg.slice(0, ob).trim();
      const msgNew = tmMsg.slice(ob + 1, cb).trim();
      if (!timeStrNew.includes(".")) {
        await bot.sendMessage(from, { text: "❗ Format waktu: jam.menit (contoh 14.00)." });
        return;
      }
      const [jamStrN, menitStrN] = timeStrNew.split(".");
      const jamBaru = parseInt(jamStrN, 10);
      const menitBaru = parseInt(menitStrN, 10);
      if (
        isNaN(jamBaru) ||
        isNaN(menitBaru) ||
        jamBaru < 0 ||
        jamBaru > 23 ||
        menitBaru < 0 ||
        menitBaru > 59
      ) {
        await bot.sendMessage(from, { text: "❗ Waktu baru tidak valid." });
        return;
      }
      if (!(hariBaru in DAYS_MAP)) {
        await bot.sendMessage(from, { text: "❗ Hari baru tidak dikenal." });
        return;
      }

      const oldEntry = schedules[idx - 1];
      const oldJob = schedule.scheduledJobs[oldEntry.id];
      if (oldJob) oldJob.cancel();

      const updatedEntry = {
        id: oldEntry.id,
        chatId: oldEntry.chatId,
        day: hariBaru,
        hour: jamBaru,
        minute: menitBaru,
        message: msgNew,
      };
      schedules[idx - 1] = updatedEntry;
      saveSchedules(schedules);
      scheduleWeeklyJob(updatedEntry, bot);

      await bot.sendMessage(from, {
        text:
          `✏️ Jadwal ke-${idx} berhasil diedit:\n` +
          `• Hari: ${hariBaru}\n` +
          `• Waktu: ${String(jamBaru).padStart(2, "00")}:${String(
            menitBaru
          ).padStart(2, "00")}\n` +
          `• Pesan: {msgNew}`,
      });
      return;
    }

    // ===== .hapusjadwal =====
    if (trimmed.startsWith(".hapusjadwal ")) {
      const idx = parseInt(trimmed.split(" ")[1], 10);
      const schedules = loadSchedules();
      if (isNaN(idx) || idx < 1 || idx > schedules.length) {
        await bot.sendMessage(from, { text: "❗ Nomor jadwal tidak valid." });
        return;
      }
      const removed = schedules.splice(idx - 1, 1)[0];
      saveSchedules(schedules);
      const oldJob = schedule.scheduledJobs[removed.id];
      if (oldJob) oldJob.cancel();
      await bot.sendMessage(from, { text: `🗑️ Jadwal [${removed.id}] berhasil dihapus.` });
      return;
    }

    // ===== .clearjadwal =====
    if (trimmed === ".clearjadwal") {
      const schedules = loadSchedules();
      schedules.forEach((entry) => {
        const job = schedule.scheduledJobs[entry.id];
        if (job) job.cancel();
      });
      saveSchedules([]);
      await bot.sendMessage(from, { text: "🗑️ Semua jadwal mingguan berhasil dihapus." });
      return;
    }

    // ===== .ingat =====
    if (trimmed.startsWith(".ingat ")) {
      const payload = trimmed.slice(7).trim();
      const parts = payload.split("+");
      if (parts.length < 2) {
        await bot.sendMessage(from, {
          text:
            "❗ Format salah. Contoh:\n" +
            ".ingat 2025-06-05+14.30(Hai @48137449, ingat rapat!)",
        });
        return;
      }
      const targetAlias = parts[0].trim();
      const chatIdResolved = resolveAlias(targetAlias, loadChats());
      if (!chatIdResolved) {
        await bot.sendMessage(from, {
          text: `❗ Alias/JID tidak ditemukan: "${targetAlias}". Gunakan .chatid untuk melihat daftar.`,
        });
        return;
      }
      const tmMsg = parts.slice(1).join("+");
      const ob = tmMsg.indexOf("(");
      const cb = tmMsg.lastIndexOf(")");
      if (ob === -1 || cb === -1 || cb < ob) {
        await bot.sendMessage(from, {
          text: "❗ Format waktu atau pesan salah. Gunakan: <alias>+YYYY-MM-DD+HH.mm(pesan).",
        });
        return;
      }
      const dateStr = tmMsg.slice(0, ob).trim();
      const msgContent = tmMsg.slice(ob + 1, cb).trim();

      if (!dateStr.includes(".")) {
        await bot.sendMessage(from, { text: "❗ Format waktu harus HH.mm, contohnya 07.15." });
        return;
      }
      const [tglPart, timePart] = dateStr.split("+");
      const [year, month, day] = tglPart.split("-").map((x) => parseInt(x, 10));
      const [jamStrI, menitStrI] = timePart.split(".");
      const jamI = parseInt(jamStrI, 10);
      const menitI = parseInt(menitStrI, 10);

      if (
        isNaN(year) ||
        isNaN(month) ||
        isNaN(day) ||
        month < 1 ||
        month > 12 ||
        day < 1 ||
        day > 31 ||
        isNaN(jamI) ||
        isNaN(menitI) ||
        jamI < 0 ||
        jamI > 23 ||
        menitI < 0 ||
        menitI > 59
      ) {
        await bot.sendMessage(from, { text: "❗ Format tanggal atau waktu tidak valid." });
        return;
      }

      const target = new Date(year, month - 1, day, jamI, menitI, 0);
      if (isNaN(target.getTime()) || target.getTime() < Date.now()) {
        await bot.sendMessage(from, { text: "❗ Waktu pengingat sudah lewat atau tidak valid." });
        return;
      }
      const key = `ot_${target.getTime()}_${Math.floor(Math.random() * 1000)}`;
      const newOneTimeEntry = {
        chatId: chatIdResolved,
        timestamp: target.getTime(),
        message: msgContent,
      };
      let allOneTime = loadOneTime();
      allOneTime[key] = newOneTimeEntry;
      saveOneTime(allOneTime);
      scheduleOneTimeJob(key, newOneTimeEntry, bot);

      await bot.sendMessage(from, {
        text:
          `🔔 Pengingat tersimpan:\n` +
          `• Alias: ${targetAlias}\n` +
          `• JID: ${chatIdResolved}\n` +
          `• Waktu: ${target.toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}\n` +
          `• Pesan: "${msgContent}"\n\n` +
          `Bot akan mengirim ini satu kali pada waktu yang ditentukan.`,
      });
      return;
    }

    // ===== .listonetime =====
    if (trimmed === ".listonetime") {
      const allOneTime = loadOneTime();
      const entries = Object.entries(allOneTime);
      if (entries.length === 0) {
        await bot.sendMessage(from, { text: "❗ Tidak ada pengingat one-time tersimpan." });
        return;
      }
      let reply = "📋 Daftar Pengingat One-Time:\n\n";
      entries.forEach(([key, entry], idx) => {
        const alias = computeAlias(entry.chatId);
        const dt = new Date(entry.timestamp).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
        reply +=
          `${idx + 1}. [${key}]\n` +
          `   • Alias: ${alias}\n` +
          `   • JID: ${entry.chatId}\n` +
          `   • Waktu: ${dt}\n` +
          `   • Pesan: ${entry.message}\n\n`;
      });
      reply += "Gunakan:\n• `.hapusot <nomor>` untuk menghapus pengingat one-time.\n";
      await bot.sendMessage(from, { text: reply });
      return;
    }

    // ===== .hapusot =====
    if (trimmed.startsWith(".hapusot ")) {
      const arg = trimmed.split(" ")[1];
      const idx = parseInt(arg, 10);
      let allOneTime = loadOneTime();
      const entries = Object.entries(allOneTime);
      if (isNaN(idx) || idx < 1 || idx > entries.length) {
        await bot.sendMessage(from, { text: "❗ Nomor pengingat tidak valid." });
        return;
      }
      const [key, entry] = entries[idx - 1];
      const job = schedule.scheduledJobs[key];
      if (job) job.cancel();
      delete allOneTime[key];
      saveOneTime(allOneTime);
      await bot.sendMessage(from, { text: `🗑️ Pengingat one-time [${key}] berhasil dihapus.` });
      return;
    }

    // ===== .nextonetime =====
    if (trimmed === ".nextonetime") {
      const allOneTime = loadOneTime();
      const upcoming = Object.entries(allOneTime)
        .map(([key, entry]) => ({ key, timestamp: entry.timestamp, message: entry.message, chatId: entry.chatId }))
        .filter((item) => item.timestamp > Date.now())
        .sort((a, b) => a.timestamp - b.timestamp);

      if (upcoming.length === 0) {
        await bot.sendMessage(from, { text: "❗ Tidak ada pengingat one-time yang aktif." });
        return;
      }
      const next = upcoming[0];
      const alias = computeAlias(next.chatId);
      const dt = new Date(next.timestamp).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
      const reply =
        "🔔 Pengingat One-Time Berikutnya:\n\n" +
        `• Key: ${next.key}\n` +
        `• Alias: ${alias}\n` +
        `• JID: ${next.chatId}\n` +
        `• Waktu: ${dt}\n` +
        `• Pesan: ${next.message}\n`;
      await bot.sendMessage(from, { text: reply });
      return;
    }

    // ===== .status =====
    if (trimmed === ".status") {
      const uptimeSeconds = Math.floor(process.uptime());
      const hours   = Math.floor(uptimeSeconds / 3600);
      const minutes = Math.floor((uptimeSeconds % 3600) / 60);
      const seconds = uptimeSeconds % 60;
      const schedules = loadSchedules();
      const allOneTime = loadOneTime();
      const upcoming = Object.entries(allOneTime)
        .map(([key, entry]) => ({ key, timestamp: entry.timestamp, message: entry.message }))
        .filter((item) => item.timestamp > Date.now())
        .sort((a, b) => a.timestamp - b.timestamp);

      let nextOT = "–";
      if (upcoming.length > 0) {
        nextOT = new Date(upcoming[0].timestamp).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
      }

      const statusText =
        "🤖 *Status Bot*\n\n" +
        `• Uptime: ${hours} jam ${minutes} menit ${seconds} detik\n` +
        `• Jumlah jadwal mingguan: ${schedules.length}\n` +
        `• Jumlah pengingat one-time aktif: ${upcoming.length}\n` +
        `• Pengingat one-time berikutnya: ${nextOT}\n`;
      await bot.sendMessage(from, { text: statusText });
      return;
    }

    // ===== .broadcast =====
    if (trimmed.startsWith(".broadcast ")) {
      const msgToSend = trimmed.slice(11).trim();
      if (!msgToSend) {
        await bot.sendMessage(from, { text: "❗ Contoh: .broadcast Halo semua, ini pesan broadcast!" });
        return;
      }
      const chatsMapAll = loadChats();
      const recipients = Object.keys(chatsMapAll);
      let successCount = 0, failCount = 0;
      for (const jid of recipients) {
        try {
          await bot.sendMessage(jid, { text: `📢 *Broadcast:*\n\n${msgToSend}` });
          successCount++;
        } catch {
          failCount++;
        }
      }
      await bot.sendMessage(from, {
        text: `✅ Broadcast selesai.\n• Berhasil: ${successCount}\n• Gagal: ${failCount}`
      });
      return;
    }

    // ===== .ping =====
    if (trimmed === ".ping") {
      const startMs = Date.now();
      await bot.sendMessage(from, { text: "pong!" });
      const latency = Date.now() - startMs;
      await bot.sendMessage(from, { text: `🏓 Latency: ${latency} ms` });
      return;
    }

    // ===== .time =====
    if (trimmed === ".time") {
      const nowStr = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
      await bot.sendMessage(from, { text: `🕒 Waktu server: ${nowStr}` });
      return;
    }

    // ===== .addbadword =====
    if (trimmed.startsWith(".addbadword ")) {
      const word = trimmed.slice(12).trim().toLowerCase();
      if (!word) {
        await bot.sendMessage(from, { text: "❗ Contoh: .addbadword kacau" });
        return;
      }
      let bannedList = loadBanned();
      if (bannedList.includes(word)) {
        await bot.sendMessage(from, { text: `❗ Kata "${word}" sudah ada dalam daftar.` });
        return;
      }
      bannedList.push(word);
      saveBanned(bannedList);
      await bot.sendMessage(from, {
        text: `✅ Kata "${word}" berhasil ditambahkan ke daftar terlarang.`,
      });
      return;
    }

    // ===== .removebadword =====
    if (trimmed.startsWith(".removebadword ")) {
      const word = trimmed.slice(15).trim().toLowerCase();
      if (!word) {
        await bot.sendMessage(from, { text: "❗ Contoh: .removebadword kacau" });
        return;
      }
      let bannedList = loadBanned();
      if (!bannedList.includes(word)) {
        await bot.sendMessage(from, { text: `❗ Kata "${word}" tidak ditemukan di daftar.` });
        return;
      }
      bannedList = bannedList.filter((w) => w !== word);
      saveBanned(bannedList);
      await bot.sendMessage(from, {
        text: `✅ Kata "${word}" berhasil dihapus dari daftar terlarang.`,
      });
      return;
    }

    // ===== .listbadwords =====
    if (trimmed === ".listbadwords") {
      const bannedList = loadBanned();
      if (bannedList.length === 0) {
        await bot.sendMessage(from, { text: "✅ Tidak ada kata terlarang dalam daftar." });
        return;
      }
      let reply = "📋 *Daftar Kata Terlarang:*\n\n";
      bannedList.forEach((w, idx) => {
        reply += `${idx + 1}. ${w}\n`;
      });
      await bot.sendMessage(from, { text: reply });
      return;
    }

    // ===== .groupinfo =====
    if (trimmed === ".groupinfo") {
      if (!from.endsWith("@g.us")) {
        await bot.sendMessage(from, { text: "❗ Perintah ini hanya berlaku di grup." });
        return;
      }
      try {
        const metadata = await bot.groupMetadata(from);
        const groupName = metadata.subject || "–";
        const participants = metadata.participants || [];
        const memberCount = participants.length;
        const admins = participants.filter((p) => p.admin !== null).map((p) => p.id);
        let reply =
          `👥 *Info Grup*\n\n` +
          `• Nama Grup: ${groupName}\n` +
          `• Jumlah Anggota: ${memberCount}\n\n` +
          `*Daftar Admin:*\n`;
        if (admins.length === 0) {
          reply += "   – Belum ada admin. –";
        } else {
          admins.forEach((jid, i) => {
            const nama = loadChats()[jid] || jid.split("@")[0];
            reply += `   ${i + 1}. ${nama} (${jid})\n`;
          });
        }
        await bot.sendMessage(from, { text: reply });
      } catch (err) {
        console.error("Gagal mengambil groupinfo:", err);
        await bot.sendMessage(from, { text: "❗ Gagal mengambil info grup." });
      }
      return;
    }

    // ===== .admins =====
    if (trimmed === ".admins") {
      if (!from.endsWith("@g.us")) {
        await bot.sendMessage(from, { text: "❗ Perintah ini hanya berlaku di grup." });
        return;
      }
      try {
        const metadata = await bot.groupMetadata(from);
        const participants = metadata.participants || [];
        const admins = participants.filter((p) => p.admin !== null).map((p) => p.id);
        if (admins.length === 0) {
          await bot.sendMessage(from, { text: "✅ Belum ada admin di grup ini." });
        } else {
          let reply = "🛡️ *Daftar Admin Grup:*\n\n";
          admins.forEach((jid, idx) => {
            const nama = loadChats()[jid] || jid.split("@")[0];
            reply += `   ${idx + 1}. ${nama} (${jid})\n`;
          });
          await bot.sendMessage(from, { text: reply });
        }
      } catch (err) {
        console.error("Gagal mengambil daftar admin:", err);
        await bot.sendMessage(from, { text: "❗ Gagal mengambil daftar admin grup." });
      }
      return;
    }

    // ===== PENGUJIAN PERINTAH TIDAK DIKENAL =======
    if (trimmed.startsWith(".")) {
      await bot.sendMessage(from, {
        text: "❓ Perintah tidak dikenali. Ketik .help untuk daftar perintah.",
      });
    }

    // ===== PENDERTEKSI PESAN KASAR & ANTI-LINK (GRUP) =======
    if (from.endsWith("@g.us")) {
      const settings = loadSettings();
      const groupSettings = settings[from] || { welcome: false, antilink: false };

      // Auto‐hapus pesan berisi link jika antilink ON
      if (groupSettings.antilink && /https?:\/\/\S+/.test(text)) {
        try {
          await bot.sendMessage(from, {
            delete: {
              remoteJid: from,
              fromMe: false,
              id: msg.key.id,
              participant: sender,
            },
          });
        } catch {}
        await bot.sendMessage(from, {
          text: `⚠️ @${sender.split("@")[0]} link tidak diperbolehkan.`,
          mentions: [sender],
        });
        return;
      }

      // Periksa kata kasar
      const bannedListNow = loadBanned();
      const lowerMsg = text.toLowerCase();
      const foundBad = bannedListNow.find((w) => lowerMsg.includes(w));
      if (foundBad) {
        try {
          await bot.sendMessage(from, {
            delete: {
              remoteJid: from,
              fromMe: false,
              id: msg.key.id,
              participant: sender,
            },
          });
        } catch {}
        await bot.sendMessage(from, {
          text: `⚠️ @${sender.split("@")[0]} gunakan bahasa yang sopan! Pesan dihapus.`,
          mentions: [sender],
        });
        return;
      }
    }
  }); // end messages.upsert

})(); // end start()

