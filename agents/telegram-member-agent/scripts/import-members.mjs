import fs from "node:fs/promises";
import path from "node:path";
import { Firestore, FieldValue } from "@google-cloud/firestore";

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: node scripts/import-members.mjs /path/to/members.csv");
  process.exit(2);
}

const queueCollection = process.env.FIRESTORE_QUEUE_COLLECTION || "telegram_member_queue";
const stateCollection = process.env.FIRESTORE_STATE_COLLECTION || "agent_state";
const stateDocument = process.env.FIRESTORE_STATE_DOCUMENT || "telegram-member-agent";
const db = new Firestore();

const text = await fs.readFile(path.resolve(inputPath), "utf8");
const rows = parseCsv(text.replace(/^\uFEFF/, ""));
if (rows.length < 2) throw new Error("CSV contains no member records.");

const header = rows[0].map(value => value.trim().toLowerCase());
const requiredHeaders = ["username", "user id", "access hash", "name", "group", "group id"];
for (const name of requiredHeaders) {
  if (!header.includes(name)) throw new Error(`Missing CSV column: ${name}`);
}

const idx = Object.fromEntries(header.map((name, i) => [name, i]));
let imported = 0;
let batch = db.batch();
let batchCount = 0;

for (let i = 1; i < rows.length; i += 1) {
  const row = rows[i];
  if (row.every(value => !String(value).trim())) continue;
  const sequence = imported + 1;
  const userId = clean(row[idx["user id"]]);
  const username = clean(row[idx.username]).replace(/^@/, "");
  if (!userId && !username) continue;

  const docId = userId ? `u_${userId}` : `s_${String(sequence).padStart(8, "0")}`;
  const ref = db.collection(queueCollection).doc(docId);
  batch.set(ref, {
    sequence,
    username: username || null,
    userId: userId || null,
    accessHash: clean(row[idx["access hash"]]) || null,
    name: clean(row[idx.name]) || null,
    sourceGroup: clean(row[idx.group]) || null,
    sourceGroupId: clean(row[idx["group id"]]) || null,
    status: "pending",
    attempts: 0,
    importedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  imported += 1;
  batchCount += 1;
  if (batchCount >= 400) {
    await batch.commit();
    console.log(`Imported ${imported} records...`);
    batch = db.batch();
    batchCount = 0;
  }
}

if (batchCount > 0) await batch.commit();

await db.collection(stateCollection).doc(stateDocument).set({
  nextSequence: 1,
  running: false,
  blockedUntil: FieldValue.delete(),
  queueImportedAt: FieldValue.serverTimestamp(),
  queueRecordCount: imported
}, { merge: true });

console.log(`Import complete: ${imported} Telegram member records in ${queueCollection}.`);

function clean(value) {
  return String(value ?? "").trim();
}

function parseCsv(input) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = "";
    } else if (ch === '\n') {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }

  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}
