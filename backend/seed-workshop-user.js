// Creates (or updates) a WORKSHOP-ONLY account — one that can open Workshop PMS
// (and fill the New Workshop form) but has no access to the Reminder List.
//
// Usage:
//   WS_NAME="Tanvi Negi" WS_EMAIL="tanvi_negi@mysoulschool.in" WS_PASSWORD="a-strong-password" npm run seed:workshop-user
//
// Safe to re-run: if the email exists it resets the password and re-applies
// the workshop-only access. Admin accounts are never touched.
import "dotenv/config";
import mongoose from "mongoose";
import User from "./models/User.js";
import { hashPassword } from "./utils/auth.js";

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/reminder_list";
const { WS_NAME, WS_EMAIL, WS_PASSWORD } = process.env;

async function main() {
  if (!WS_NAME || !WS_EMAIL || !WS_PASSWORD) {
    console.error('Missing env vars. Run:\n  WS_NAME="Tanvi Negi" WS_EMAIL="tanvi_negi@mysoulschool.in" WS_PASSWORD="a-strong-password" npm run seed:workshop-user');
    process.exit(1);
  }
  if (WS_PASSWORD.length < 8) {
    console.error("WS_PASSWORD must be at least 8 characters.");
    process.exit(1);
  }
  await mongoose.connect(MONGO_URI);
  const email = WS_EMAIL.toLowerCase().trim();
  const existing = await User.findOne({ email });
  if (existing?.role === "admin") {
    console.error(`"${email}" is an admin — admins always have both apps. Nothing changed.`);
  } else if (existing) {
    existing.name = WS_NAME;
    existing.passwordHash = await hashPassword(WS_PASSWORD);
    existing.active = true;
    existing.apps = ["workshop"];
    existing.canRequestWorkshops = true;
    await existing.save();
    console.log(`Updated "${email}" — Workshop PMS only, can add new workshops.`);
  } else {
    await User.create({
      name: WS_NAME,
      email,
      passwordHash: await hashPassword(WS_PASSWORD),
      role: "member",
      apps: ["workshop"],
      canRequestWorkshops: true,
    });
    console.log(`Created "${email}" — Workshop PMS only, can add new workshops.`);
  }
  await mongoose.disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
