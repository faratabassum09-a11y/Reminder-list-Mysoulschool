import express from "express";
import mongoose from "mongoose";
import Message, { dmKey } from "../models/Message.js";
import User from "../models/User.js";
import Doer from "../models/Doer.js";
import { requireAdmin } from "../middleware/auth.js";

const router = express.Router();

function isValidId(id) {
  return mongoose.isValidObjectId(id);
}

// ============================================================
// GET /people
// ============================================================

router.get("/people", async (req, res) => {
  try {
    const users = await User.find({
      active: true,
      _id: { $ne: req.user._id },
    })
      .select("name email role")
      .sort({ name: 1 })
      .lean();

    res.json({ users });
  } catch (err) {
    res.status(500).json({
      error: "Failed to load people",
      details: err.message,
    });
  }
});

// ============================================================
// GET /conversations
// ============================================================

router.get("/conversations", async (req, res) => {
  try {
    const meId = new mongoose.Types.ObjectId(req.user._id);

    const rows = await Message.aggregate([
      {
        $match: {
          isBroadcast: false,
          deletedFor: { $ne: meId },
          $or: [
            { sender: meId },
            { recipient: meId },
          ],
        },
      },

      {
        $sort: {
          createdAt: -1,
        },
      },

      {
        $group: {
          _id: "$conversationKey",

          lastMessage: {
            $first: "$$ROOT",
          },

          unread: {
            $sum: {
              $cond: [
                {
                  $and: [
                    {
                      $eq: ["$recipient", meId],
                    },
                    {
                      $not: [
                        {
                          $in: [
                            meId,
                            {
                              $ifNull: ["$readBy", []],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },

      {
        $sort: {
          "lastMessage.createdAt": -1,
        },
      },
    ]);

    const otherIds = rows.map((r) =>
      String(r.lastMessage.sender) === String(meId)
        ? r.lastMessage.recipient
        : r.lastMessage.sender
    );

    const others = await User.find({
      _id: { $in: otherIds },
    })
      .select("name email role active")
      .lean();

    const otherMap = new Map(
      others.map((u) => [
        String(u._id),
        u,
      ])
    );

    const conversations = rows
      .map((r) => {
        const otherId =
          String(r.lastMessage.sender) === String(meId)
            ? r.lastMessage.recipient
            : r.lastMessage.sender;

        const person = otherMap.get(
          String(otherId)
        );

        if (!person) {
          return null;
        }

        return {
          user: person,

          lastMessage: {
            text: r.lastMessage.text,
            createdAt: r.lastMessage.createdAt,
            fromMe:
              String(r.lastMessage.sender) ===
              String(meId),
          },

          unread: r.unread,
        };
      })
      .filter(Boolean);

    res.json({
      conversations,
    });
  } catch (err) {
    res.status(500).json({
      error: "Failed to load conversations",
      details: err.message,
    });
  }
});

// ============================================================
// GET /unread-count
// ============================================================

router.get("/unread-count", async (req, res) => {
  try {
    const meId = req.user._id;

    const [dm, broadcast] = await Promise.all([
      Message.countDocuments({
        isBroadcast: false,
        recipient: meId,
        readBy: { $ne: meId },
        deletedFor: { $ne: meId },
      }),

      Message.countDocuments({
        isBroadcast: true,
        readBy: { $ne: meId },
        deletedFor: { $ne: meId },
      }),
    ]);

    res.json({
      dm,
      broadcast,
      total: dm + broadcast,
    });
  } catch (err) {
    res.status(500).json({
      error: "Failed to load unread count",
      details: err.message,
    });
  }
});

// ============================================================
// GET /broadcast
// ============================================================

router.get("/broadcast", async (req, res) => {
  try {
    const messages = await Message.find({
      isBroadcast: true,
      deletedFor: {
        $ne: req.user._id,
      },
    })
      .sort({
        createdAt: 1,
      })
      .limit(300)
      .populate("sender", "name role")
      .lean();

    await Message.updateMany(
      {
        isBroadcast: true,
        readBy: {
          $ne: req.user._id,
        },
      },
      {
        $push: {
          readBy: req.user._id,
        },
      }
    );

    res.json({
      messages,
    });
  } catch (err) {
    res.status(500).json({
      error: "Failed to load announcements",
      details: err.message,
    });
  }
});

// ============================================================
// POST /broadcast
// ADMIN ONLY
// ============================================================

router.post(
  "/broadcast",
  requireAdmin,
  async (req, res) => {
    try {
      const text = (req.body?.text || "")
        .toString()
        .trim()
        .slice(0, 4000);

      if (!text) {
        return res.status(400).json({
          error: "Message can't be empty",
        });
      }

      const doers = await Doer.find({
        active: true,
      })
        .select("email")
        .lean();

      const doerEmails = doers.map((d) =>
        d.email.toLowerCase()
      );

      const recipients = doerEmails.length
        ? await User.find({
            active: true,
            email: {
              $in: doerEmails,
            },
          })
            .select("_id")
            .lean()
        : [];

      const message = await Message.create({
        sender: req.user._id,
        recipient: null,
        conversationKey: "broadcast",
        isBroadcast: true,
        text,
        readBy: [req.user._id],
      });

      const populated =
        await Message.findById(message._id)
          .populate(
            "sender",
            "name role"
          )
          .lean();

      res.status(201).json({
        message: populated,
        doerCount: doers.length,
        reachedUserCount: recipients.length,
      });
    } catch (err) {
      res.status(500).json({
        error: "Failed to send announcement",
        details: err.message,
      });
    }
  }
);

// ============================================================
// GET /thread/:userId
// ============================================================

router.get(
  "/thread/:userId",
  async (req, res) => {
    try {
      const { userId } = req.params;

      if (!isValidId(userId)) {
        return res.status(400).json({
          error: "Invalid user id",
        });
      }

      const otherUser =
        await User.findById(userId)
          .select(
            "name email role active"
          )
          .lean();

      if (!otherUser) {
        return res.status(404).json({
          error: "User not found",
        });
      }

      const key = dmKey(
        req.user._id,
        userId
      );

      const messages =
        await Message.find({
          conversationKey: key,
          isBroadcast: false,
          deletedFor: {
            $ne: req.user._id,
          },
        })
          .sort({
            createdAt: 1,
          })
          .limit(500)
          .lean();

      await Message.updateMany(
        {
          conversationKey: key,
          recipient: req.user._id,
          readBy: {
            $ne: req.user._id,
          },
        },
        {
          $push: {
            readBy: req.user._id,
          },
        }
      );

      res.json({
        user: otherUser,
        messages,
      });
    } catch (err) {
      res.status(500).json({
        error: "Failed to load conversation",
        details: err.message,
      });
    }
  }
);

// ============================================================
// DELETE /thread/:userId
// DELETE CONVERSATION FOR CURRENT USER
// ============================================================

router.delete(
  "/thread/:userId",
  async (req, res) => {
    try {
      const { userId } = req.params;

      if (!isValidId(userId)) {
        return res.status(400).json({
          error: "Invalid user id",
        });
      }

      const key = dmKey(
        req.user._id,
        userId
      );

      await Message.updateMany(
        {
          conversationKey: key,
          isBroadcast: false,
          deletedFor: {
            $ne: req.user._id,
          },
        },
        {
          $addToSet: {
            deletedFor: req.user._id,
          },
        }
      );

      res.json({
        ok: true,
      });
    } catch (err) {
      res.status(500).json({
        error: "Failed to delete conversation",
        details: err.message,
      });
    }
  }
);

// ============================================================
// POST /thread/:userId
// SEND PRIVATE MESSAGE
// ============================================================

router.post(
  "/thread/:userId",
  async (req, res) => {
    try {
      const { userId } = req.params;

      if (!isValidId(userId)) {
        return res.status(400).json({
          error: "Invalid user id",
        });
      }

      if (
        String(userId) ===
        String(req.user._id)
      ) {
        return res.status(400).json({
          error: "You can't message yourself",
        });
      }

      const text = (req.body?.text || "")
        .toString()
        .trim()
        .slice(0, 4000);

      if (!text) {
        return res.status(400).json({
          error: "Message can't be empty",
        });
      }

      const recipient =
        await User.findById(userId)
          .select("_id active")
          .lean();

      if (
        !recipient ||
        recipient.active === false
      ) {
        return res.status(404).json({
          error: "User not found",
        });
      }

      const message =
        await Message.create({
          sender: req.user._id,
          recipient: userId,
          conversationKey: dmKey(
            req.user._id,
            userId
          ),
          text,
        });

      res.status(201).json({
        message: message.toObject(),
      });
    } catch (err) {
      res.status(500).json({
        error: "Failed to send message",
        details: err.message,
      });
    }
  }
);

// ============================================================
// PATCH /message/:id
// EDIT MESSAGE
// ============================================================

router.patch(
  "/message/:id",
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!isValidId(id)) {
        return res.status(400).json({
          error: "Invalid message id",
        });
      }

      const text = (req.body?.text || "")
        .toString()
        .trim()
        .slice(0, 4000);

      if (!text) {
        return res.status(400).json({
          error: "Message can't be empty",
        });
      }

      const message =
        await Message.findById(id);

      if (!message) {
        return res.status(404).json({
          error: "Message not found",
        });
      }

      if (
        String(message.sender) !==
        String(req.user._id)
      ) {
        return res.status(403).json({
          error:
            "You can only edit your own messages",
        });
      }

      if (message.deletedForEveryone) {
        return res.status(400).json({
          error:
            "Can't edit a deleted message",
        });
      }

      message.text = text;
      message.edited = true;
      message.editedAt = new Date();

      await message.save();

      const populated =
        message.isBroadcast
          ? await Message.findById(
              message._id
            )
              .populate(
                "sender",
                "name role"
              )
              .lean()
          : message.toObject();

      res.json({
        message: populated,
      });
    } catch (err) {
      res.status(500).json({
        error: "Failed to edit message",
        details: err.message,
      });
    }
  }
);

// ============================================================
// DELETE /message/:id
//
// DELETE FOR ME:
//     ?forEveryone=0
//
// DELETE FOR EVERYONE:
//     ?forEveryone=1
//
// IMPORTANT:
// We DO NOT set message.text = "".
// The Message schema requires text.
//
// Instead we set:
//     deletedForEveryone = true
//     deletedAt = current date
//
// The frontend displays:
//     "This message was deleted"
// ============================================================

router.delete(
  "/message/:id",
  async (req, res) => {
    try {
      const { id } = req.params;

      // Validate MongoDB ObjectId
      if (!isValidId(id)) {
        return res.status(400).json({
          error: "Invalid message id",
        });
      }

      // Read delete mode from query parameter.
      //
      // Examples:
      // DELETE /messages/message/123?forEveryone=1
      //
      // DELETE /messages/message/123?forEveryone=0
      //
      const forEveryone =
        req.query.forEveryone === "1" ||
        req.query.forEveryone === "true";

      // Find message
      const message =
        await Message.findById(id);

      if (!message) {
        return res.status(404).json({
          error: "Message not found",
        });
      }

      // ======================================================
      // DELETE FOR EVERYONE
      // ======================================================

      if (forEveryone) {
        // Only sender can delete for everyone
        if (
          String(message.sender) !==
          String(req.user._id)
        ) {
          return res.status(403).json({
            error:
              "You can only delete your own messages for everyone",
          });
        }

        // If already deleted, return success
        if (message.deletedForEveryone) {
          return res.json({
            ok: true,
            forEveryone: true,
            message: message.toObject(),
          });
        }

        // IMPORTANT FIX:
        //
        // DO NOT DO THIS:
        //
        // message.text = "";
        // await message.save();
        //
        // because Message.text is required.
        //
        // Keep the original text in MongoDB.
        // The frontend will hide it because
        // deletedForEveryone is true.

        const updated =
          await Message.findByIdAndUpdate(
            id,
            {
              $set: {
                deletedForEveryone: true,
                deletedAt: new Date(),
              },
            },
            {
              new: true,
              runValidators: false,
            }
          );

        if (!updated) {
          return res.status(404).json({
            error: "Message not found",
          });
        }

        return res.json({
          ok: true,
          forEveryone: true,
          message: updated.toObject(),
        });
      }

      // ======================================================
      // DELETE FOR ME
      // ======================================================

      await Message.updateOne(
        {
          _id: id,
        },
        {
          $addToSet: {
            deletedFor: req.user._id,
          },
        }
      );

      return res.json({
        ok: true,
        forEveryone: false,
        messageId: id,
      });
    } catch (err) {
      console.error(
        "DELETE /messages/message:",
        err
      );

      return res.status(500).json({
        error: "Failed to delete message",
        details: err.message,
      });
    }
  }
);

// ============================================================
// EXPORT ROUTER
// ============================================================

export default router;