import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      default: "",
      trim: true,
    },
    type: {
      type: String,
      default: "general",
      index: true,
    },
    referenceType: {
      type: String,
      default: "",
      trim: true,
    },
    referenceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    read: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true },
);

notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ user: 1, read: 1 });

export default mongoose.model("Notification", notificationSchema);
