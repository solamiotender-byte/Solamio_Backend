import express from "express";
import authRouter from "../routes/auth.routes.js";
import userRouter from "./user.routes.js";
import leadRouter from "./lead.routes.js";
import expenseRouter from "./expense.routes.js";
import reportRouter from "./report.routes.js";
import visitRouter from "./visit.routes.js";
import attendancRouter from "./attendance.routes.js";
import batteryRouter from "./Battery.route.js";
import locationRouter from "./location.routes.js";
import notificationRouter from "./notification.routes.js";

const apiV1Router = express.Router();

apiV1Router.use("/auth", authRouter);
apiV1Router.use("/user", userRouter);
apiV1Router.use("/lead", leadRouter);
apiV1Router.use("/expense", expenseRouter);
apiV1Router.use("/report", reportRouter);
apiV1Router.use("/visit", visitRouter);
apiV1Router.use("/attendance", attendancRouter);
apiV1Router.use("/battery", batteryRouter);
apiV1Router.use("/location", locationRouter);
apiV1Router.use("/notifications", notificationRouter);

export default apiV1Router;
