import cron from "node-cron";
import admin, { isFirebaseReady } from "../config/firebase.config.js";
import Lead from "../models/lead.model.js";
import User from "../models/user.model.js";

const buildLeadName = (lead) =>
  [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim() || "customer";

const buildNotificationBody = (lead) => {
  const action = lead.followUpAction || "Follow Up";
  const name = buildLeadName(lead);
  const note = lead.followUpNotes ? ` - ${lead.followUpNotes}` : "";
  return `${action}: ${name}${note}`;
};

const markSent = async (leadId) => {
  await Lead.updateOne(
    { _id: leadId, followUpNotificationSentAt: null },
    { $set: { followUpNotificationSentAt: new Date() } }
  );
};

export const sendDueFollowUpNotifications = async () => {
  if (!isFirebaseReady()) return;

  const now = new Date();
  const leads = await Lead.find({
    isDeleted: false,
    visitStatus: "Follow Up",
    followUpDate: { $lte: now },
    followUpNotificationSentAt: null,
    assignedUser: { $ne: null },
  })
    .select("firstName lastName phone followUpAction followUpNotes followUpDate assignedUser")
    .limit(50)
    .lean();

  for (const lead of leads) {
    try {
      const user = await User.findById(lead.assignedUser)
        .select("fcmTokens")
        .lean();
      const tokens = [...new Set((user?.fcmTokens || []).map((item) => item.token).filter(Boolean))];

      if (!tokens.length) {
        continue;
      }

      const response = await admin.messaging().sendEachForMulticast({
        tokens,
        notification: {
          title: "Follow up reminder",
          body: buildNotificationBody(lead),
        },
        data: {
          type: "follow_up",
          leadId: String(lead._id),
          followUpAction: lead.followUpAction || "",
          followUpDate: lead.followUpDate ? new Date(lead.followUpDate).toISOString() : "",
        },
        android: {
          priority: "high",
          notification: {
            channelId: "default",
            sound: "default",
          },
        },
      });

      const invalidTokens = [];
      response.responses.forEach((item, index) => {
        const code = item.error?.code || "";
        if (
          code.includes("registration-token-not-registered") ||
          code.includes("invalid-registration-token")
        ) {
          invalidTokens.push(tokens[index]);
        }
      });

      if (invalidTokens.length) {
        await User.updateOne(
          { _id: lead.assignedUser },
          { $pull: { fcmTokens: { token: { $in: invalidTokens } } } }
        );
      }

      if (response.successCount > 0) {
        await markSent(lead._id);
      }
    } catch (error) {
      console.error("Follow up notification failed:", error.message);
    }
  }
};

export const startFollowUpNotificationCron = () => {
  cron.schedule("* * * * *", async () => {
    try {
      await sendDueFollowUpNotifications();
    } catch (error) {
      console.error("Follow up notification cron failed:", error.message);
    }
  });
};
