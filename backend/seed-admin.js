// Creates (or resets) the first admin account. There's no public sign-up
// in this app on purpose — accounts are created by an admin, and this
// script is how the very first one gets made.
//
// Usage:
//   ADMIN_NAME="Fara" ADMIN_EMAIL="fara@mysoulschool.in" ADMIN_PASSWORD="a-strong-password" npm run seed:admin
//
// Safe to re-run: if the email already exists, this updates its password
// and makes sure it's an active admin — handy if you ever get locked out.
import "dotenv/config";
import mongoose from "mongoose";
import User from "./models/User.js";
import { hashPassword } from "./utils/auth.js";

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/reminder_list";
const { ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;

async function main() {
  if (!ADMIN_NAME || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error(
      "Missing required env vars. Run it like:\n" +
        '  ADMIN_NAME="Your Name" ADMIN_EMAIL="you@example.com" ADMIN_PASSWORD="a-strong-password" npm run seed:admin'
    );
    process.exit(1);
  }
  if (ADMIN_PASSWORD.length < 8) {
    console.error("ADMIN_PASSWORD must be at least 8 characters.");
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  console.log("Connected.");

  const email = ADMIN_EMAIL.toLowerCase().trim();
  const passwordHash = await hashPassword(ADMIN_PASSWORD);

  const existing = await User.findOne({ email });
  if (existing) {
    existing.name = ADMIN_NAME;
    existing.passwordHash = passwordHash;
    existing.role = "admin";
    existing.active = true;
    await existing.save();
    console.log(`Updated existing user "${email}" — now an active admin with the new password.`);
  } else {
    await User.create({ name: ADMIN_NAME, email, passwordHash, role: "admin" });
    console.log(`Created admin "${email}".`);
  }

  await mongoose.disconnect();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
