import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";

import doerRoutes from "./routes/doers.js";
import taskRoutes from "./routes/tasks.js";
import masterRoutes from "./routes/master.js";
import consolidatedRoutes from "./routes/consolidated.js";
import submissionRoutes from "./routes/submissions.js";

dotenv.config();

const app = express();

// In production, Render (backend) and Vercel (frontend) live on different
// domains, so the browser needs an explicit CORS allow-list. Set
// FRONTEND_URL in Render's environment variables to your Vercel URL(s),
// comma-separated if you have more than one (e.g. a preview + prod domain).
// With no FRONTEND_URL set, all origins are allowed — fine for local dev.
const allowedOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(",").map((s) => s.trim())
  : null;

app.use(
  cors({
    origin: allowedOrigins || true,
  })
);
app.use(express.json());

app.use("/api/doers", doerRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/master", masterRoutes);
app.use("/api/consolidated", consolidatedRoutes);
app.use("/api/submissions", submissionRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/reminder_list";

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log("MongoDB connected");
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err.message);
    process.exit(1);
  });
