import express from "express";
import mongoose from "mongoose";
import TaskInstance from "../models/TaskInstance.js";
import Doer from "../models/Doer.js";
import Notification from "../models/Notification.js";
import { generateAllUpcoming, dedupeTaskInstances } from "../utils/generateOccurrences.js";
import { sendCsv } from "../utils/csv.js";
import { requireAdmin } from "../middleware/auth.js";
import { claimCooldown } from "../utils/cache.js";

const router = express.Router();

// A member only ever sees rows assigned to their own Doer record
// (matched by email, same pairing used everywhere else in this file).
// Admins see everything.
async function scopeToOwnDoer(req) {
  if (req.user.role === "admin") return {};

  const doer = await Doer.findOne({
    email: req.user.email
  })
    .select("_id")
    .lean();

  return {
    doer: doer ? doer._id : "000000000000000000000000"
  };
}


// ------------------------------------------------------------
// OBJECT ID VALIDATION HELPER
// ------------------------------------------------------------
// Prevents errors like:
//
// CastError: Cast to ObjectId failed for value "review-count"
//
// from crashing the server.
function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}


// ------------------------------------------------------------
// MEMBER / ADMIN OWN-DOER AUTHORIZATION
// ------------------------------------------------------------

async function requireOwnDoerOrAdmin(req, res, next) {
  if (req.user.role === "admin") {
    return next();
  }

  try {
    const id = req.params.id;

    // Prevent invalid IDs from reaching MongoDB
    if (!isValidObjectId(id)) {
      return res.status(400).json({
        error: "Invalid task instance ID"
      });
    }

    const entry = await TaskInstance.findById(id).populate("doer");

    if (!entry) {
      return res.status(404).json({
        error: "Not found"
      });
    }

    if (entry.doer?.email !== req.user.email) {
      return res.status(403).json({
        error: "You can only update your own tasks"
      });
    }

    req._entry = entry;
    next();
  } catch (err) {
    console.error("[requireOwnDoerOrAdmin]", err);

    res.status(400).json({
      error: err.message
    });
  }
}


// ------------------------------------------------------------
// CSV EXPORT
// ------------------------------------------------------------

router.get("/export.csv", async (req, res) => {
  try {
    const filter = {
      ...(await scopeToOwnDoer(req))
    };

    if (req.query.status) {
      filter.status = req.query.status;
    }

    const rows = await TaskInstance.find(filter)
      .populate("doer")
      .populate("task")
      .sort({ planned: -1 })
      .limit(20000)
      .lean();

    const headers = [
      "Doer",
      "Task",
      "Department",
      "Planned",
      "Actual",
      "Status"
    ];

    const body = rows.map((r) => [
      r.doer?.name || "",
      r.task?.taskName || "",
      r.doer?.department || "",
      r.planned ? new Date(r.planned).toLocaleString() : "",
      r.actual ? new Date(r.actual).toLocaleString() : "",
      r.status || ""
    ]);

    sendCsv(res, "master.csv", headers, body);
  } catch (err) {
    console.error("[master/export.csv]", err);

    res.status(500).json({
      error: err.message
    });
  }
});


// ------------------------------------------------------------
// GENERATE UPCOMING
// ------------------------------------------------------------

// Tops up Master with any upcoming occurrences that are due to exist
// for every active, schedule-driven task.
//
// Automatic call uses a 60-second cooldown.
// Manual Generate Upcoming can use ?force=1 to bypass cooldown.

router.post("/generate-upcoming", async (req, res) => {
  try {
    if (req.query.force !== "1") {
      const claimed = await claimCooldown(
        "generate:upcoming:cooldown",
        60
      );

      if (!claimed) {
        return res.json({
          created: 0,
          tasksChecked: 0,
          horizonMissing: false,
          skipped: true
        });
      }
    }

    const result = await generateAllUpcoming();

    res.json(result);
  } catch (err) {
    console.error("[master/generate-upcoming]", err);

    res.status(500).json({
      error: err.message
    });
  }
});


// ------------------------------------------------------------
// DEDUPE
// ------------------------------------------------------------

router.post("/dedupe", requireAdmin, async (req, res) => {
  try {
    const result = await dedupeTaskInstances();

    res.json(result);
  } catch (err) {
    console.error("[master/dedupe]", err);

    res.status(500).json({
      error: err.message
    });
  }
});


// ------------------------------------------------------------
// GET MASTER LOG
// ------------------------------------------------------------

router.get("/", async (req, res) => {
  try {
    const page = Math.max(
      parseInt(req.query.page) || 1,
      1
    );

    const limit = Math.min(
      Math.max(parseInt(req.query.limit) || 100, 1),
      500
    );

    const filter = {
      ...(await scopeToOwnDoer(req))
    };

    // Admins may filter by doer
    if (
      req.query.doer &&
      req.user.role === "admin"
    ) {
      if (!isValidObjectId(req.query.doer)) {
        return res.status(400).json({
          error: "Invalid doer ID"
        });
      }

      filter.doer = req.query.doer;
    }

    // Status filter
    if (req.query.status) {
      filter.status = req.query.status;
    }

    // Single-row lookup
    // Example:
    // /master?id=68abc123...
    if (req.query.id) {
      if (!isValidObjectId(req.query.id)) {
        return res.status(400).json({
          error: "Invalid task instance ID"
        });
      }

      filter._id = req.query.id;
    }

    // Today's Tasks filter
    if (req.query.today === "1") {
      const start = new Date();

      start.setHours(0, 0, 0, 0);

      const end = new Date(start);

      end.setDate(end.getDate() + 1);

      filter.planned = {
        $gte: start,
        $lt: end
      };
    }

    const [rows, total] = await Promise.all([
      TaskInstance.find(filter)
        .select("-submission.image")
        .populate("doer")
        .populate("task")
        .sort({ planned: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),

      TaskInstance.countDocuments(filter)
    ]);

    res.json({
      rows,
      total,
      page,
      limit,
      pages: Math.max(
        Math.ceil(total / limit),
        1
      )
    });
  } catch (err) {
    console.error("[master/]", err);

    res.status(500).json({
      error: err.message
    });
  }
});


// ------------------------------------------------------------
// CREATE A REMINDER OCCURRENCE
// ------------------------------------------------------------

router.post("/", requireAdmin, async (req, res) => {
  try {
    const entry = await TaskInstance.create(req.body);

    const populated = await entry.populate([
      "doer",
      "task"
    ]);

    res.status(201).json(populated);
  } catch (err) {
    console.error("[master/create]", err);

    res.status(400).json({
      error: err.message
    });
  }
});


// ------------------------------------------------------------
// GET PROOF FOR ONE TASK INSTANCE
// ------------------------------------------------------------

router.get("/:id/proof", async (req, res) => {
  try {
    const { id } = req.params;

    // IMPORTANT:
    // Prevent "review-count" or other strings
    // from reaching MongoDB.
    if (!isValidObjectId(id)) {
      return res.status(400).json({
        error: "Invalid task instance ID"
      });
    }

    const entry = await TaskInstance.findById(id)
      .select("submission")
      .lean();

    if (!entry) {
      return res.status(404).json({
        error: "Not found"
      });
    }

    res.json(
      entry.submission || {
        state: "none"
      }
    );
  } catch (err) {
    console.error("[master/:id/proof]", err);

    res.status(400).json({
      error: err.message
    });
  }
});


// ------------------------------------------------------------
// GET ONE TASK INSTANCE
// ------------------------------------------------------------
// IMPORTANT:
// This route is deliberately kept AFTER the static routes.
// ObjectId validation prevents values like:
//
// /review-count
// /stats
// /something
//
// from being passed into MongoDB as _id values.

router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // FIX FOR YOUR CURRENT CRASH
    if (!isValidObjectId(id)) {
      return res.status(400).json({
        error: "Invalid task instance ID"
      });
    }

    const filter = {
      _id: id,
      ...(await scopeToOwnDoer(req))
    };

    const entry = await TaskInstance.findOne(filter)
      .select("-submission.image")
      .populate("doer")
      .populate("task")
      .lean();

    if (!entry) {
      return res.status(404).json({
        error: "Not found"
      });
    }

    res.json(entry);
  } catch (err) {
    console.error("[master/:id]", err);

    res.status(400).json({
      error: err.message
    });
  }
});


// ------------------------------------------------------------
// DOER: MARK TASK AS DONE
// ------------------------------------------------------------

router.post(
  "/:id/submit-done",
  requireOwnDoerOrAdmin,
  async (req, res) => {
    try {
      const entry =
        req._entry ||
        (await TaskInstance.findById(req.params.id));

      if (!entry) {
        return res.status(404).json({
          error: "Not found"
        });
      }

      if (entry.actual) {
        return res.status(400).json({
          error: "This task is already complete"
        });
      }

      const note = String(
        req.body.note || ""
      ).trim();

      const link = String(
        req.body.link || ""
      ).trim();

      const image = String(
        req.body.image || ""
      );

      // Optional proof link
      if (
        link &&
        !/^https?:\/\//i.test(link)
      ) {
        return res.status(400).json({
          error:
            "Proof link must start with http:// or https://"
        });
      }

      // Optional proof image
      if (
        image &&
        !/^data:image\/(png|jpe?g|webp);base64,/.test(
          image
        )
      ) {
        return res.status(400).json({
          error:
            "Proof image must be a PNG, JPG or WebP"
        });
      }

      // 2 MB maximum
      if (image.length > 2_000_000) {
        return res.status(400).json({
          error: "Proof image is too large"
        });
      }

      const at = new Date();

      entry.submission = {
        state: "done",
        at,
        by: req.user.name,
        note,
        link,
        image
      };

      entry.actual = req.body.actual
        ? new Date(req.body.actual)
        : at;

      await entry.save();

      const populated = await entry.populate([
        "doer",
        "task"
      ]);

      const out = populated.toObject();

      // Don't send image back in response
      delete out.submission.image;

      // Create notification
      Notification.create({
        type: "task_done",
        taskInstance: entry._id,
        doer: entry.doer,
        task: entry.task,
        doerName:
          out.doer?.name ||
          req.user.name,
        taskName:
          out.task?.taskName || ""
      }).catch((err) =>
        console.error(
          "[notifications] failed to create:",
          err.message
        )
      );

      res.json(out);
    } catch (err) {
      console.error("[master/:id/submit-done]", err);

      res.status(400).json({
        error: err.message
      });
    }
  }
);


// ------------------------------------------------------------
// ADMIN: MANUALLY COMPLETE TASK
// ------------------------------------------------------------

router.patch(
  "/:id/complete",
  requireAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!isValidObjectId(id)) {
        return res.status(400).json({
          error: "Invalid task instance ID"
        });
      }

      const entry =
        await TaskInstance.findById(id);

      if (!entry) {
        return res.status(404).json({
          error: "Not found"
        });
      }

      entry.actual = req.body.actual
        ? new Date(req.body.actual)
        : new Date();

      await entry.save();

      const populated = await entry.populate([
        "doer",
        "task"
      ]);

      const out = populated.toObject();

      if (out.submission) {
        delete out.submission.image;
      }

      res.json(out);
    } catch (err) {
      console.error("[master/:id/complete]", err);

      res.status(400).json({
        error: err.message
      });
    }
  }
);


// ------------------------------------------------------------
// UPDATE TASK
// ------------------------------------------------------------

router.put(
  "/:id",
  requireOwnDoerOrAdmin,
  async (req, res) => {
    try {
      const entry = req._entry;

      const body = {
        ...req.body
      };

      // Members cannot modify completion-related fields
      if (req.user.role !== "admin") {
        delete body.actual;
        delete body.status;
        delete body.submission;
        delete body.doer;
        delete body.task;
      }

      Object.assign(entry, body);

      await entry.save();

      const populated = await entry.populate([
        "doer",
        "task"
      ]);

      res.json(populated);
    } catch (err) {
      console.error("[master/:id/update]", err);

      res.status(400).json({
        error: err.message
      });
    }
  }
);


// ------------------------------------------------------------
// DELETE TASK
// ------------------------------------------------------------

router.delete(
  "/:id",
  requireAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!isValidObjectId(id)) {
        return res.status(400).json({
          error: "Invalid task instance ID"
        });
      }

      await TaskInstance.findByIdAndDelete(id);

      res.json({
        ok: true
      });
    } catch (err) {
      console.error("[master/:id/delete]", err);

      res.status(400).json({
        error: err.message
      });
    }
  }
);


export default router;