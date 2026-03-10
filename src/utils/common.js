import Lead from "../models/lead.model.js";

export const getSummaryStats = async () => {
  const summary = await Lead.aggregate([
    { $match: { isDeleted: false } },

    {
      $group: {
        _id: null,
        totalLeads: { $sum: 1 },

        totalVisits: {
          $sum: { $cond: [{ $eq: ["$status", "Visit"] }, 1, 0] },
        },

        totalMissedLeads: {
          $sum: { $cond: [{ $eq: ["$status", "Missed Leads"] }, 1, 0] },
        },

        totalRegistrations: {
          $sum: { $cond: [{ $eq: ["$status", "Registration"] }, 1, 0] },
        },

        totalBankLoanApply: {
          $sum: { $cond: [{ $eq: ["$status", "Bank Loan Apply"] }, 1, 0] },
        },

        totalDocumentSubmission: {
          $sum: { $cond: [{ $eq: ["$status", "Document Submission"] }, 1, 0] },
        },

        totalDisbursement: {
          $sum: { $cond: [{ $eq: ["$status", "Disbursement"] }, 1, 0] },
        },

        totalInstallations: {
          $sum: {
            $cond: [{ $eq: ["$status", "Installation Completion"] }, 1, 0],
          },
        },
      },
    },
  ]);

  return (
    summary?.[0] || {
      totalLeads: 0,
      totalVisits: 0,
      totalMissedLeads: 0,
      totalRegistrations: 0,
      totalBankLoanApply: 0,
      totalDocumentSubmission: 0,
      totalDisbursement: 0,
      totalInstallations: 0,
    }
  );
};

export const getDashboardCharts = async () => {
  try {
    // 🔹 Get yearly monthly statistics
    const monthlyStats = await Lead.aggregate([
      {
        $match: {
          isDeleted: false,
          createdAt: {
            $gte: new Date(new Date().getFullYear(), 0, 1), // from Jan 1st
          },
        },
      },
      {
        $group: {
          _id: { month: { $month: "$createdAt" } },
          totalLeads: { $sum: 1 },
          totalVisits: {
            $sum: {
              $cond: [{ $eq: ["$status", "Visit"] }, 1, 0],
            },
          },
          totalRegistrations: {
            $sum: {
              $cond: [{ $eq: ["$status", "Registration"] }, 1, 0],
            },
          },
          totalMissedLeads: {
            $sum: {
              $cond: [{ $eq: ["$status", "Missed Leads"] }, 1, 0],
            },
          },
        },
      },
      { $sort: { "_id.month": 1 } },
    ]);

    // 🔹 Status distribution (Pie Chart)
    const statusStats = await Lead.aggregate([
      {
        $match: {
          isDeleted: false,
        },
      },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    // 🔹 Recent 6-month trend (line chart)
    const sixMonthTrend = await Lead.aggregate([
      {
        $match: {
          isDeleted: false,
          createdAt: {
            $gte: new Date(new Date().setMonth(new Date().getMonth() - 6)),
          },
        },
      },
      {
        $group: {
          _id: {
            month: { $month: "$createdAt" },
            year: { $year: "$createdAt" },
          },
          leads: { $sum: 1 },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]);

    // 🔹 Format monthly stats for frontend
    const formattedMonthly = monthlyStats.map((m) => ({
      month: m._id.month,
      totalLeads: m.totalLeads,
      totalVisits: m.totalVisits,
      totalRegistrations: m.totalRegistrations,
      totalMissedLeads: m.totalMissedLeads,
    }));

    // 🔹 Format pie chart data
    const formattedPie = statusStats.map((s) => ({
      status: s._id || "Unknown",
      count: s.count,
    }));

    // 🔹 Format 6-month trend
    const formattedTrend = sixMonthTrend.map((t) => ({
      month: t._id.month,
      year: t._id.year,
      leads: t.leads,
    }));

    return {
      monthly: formattedMonthly,
      statusDistribution: formattedPie,
      sixMonthTrend: formattedTrend,
    };
  } catch (err) {
    console.error("Dashboard chart error:", err);
    return {
      monthly: [],
      statusDistribution: [],
      sixMonthTrend: [],
    };
  }
};

export const getTeamSummaryStatistics = async (asmId, teamIds) => {
  try {
    const allUserIds = [asmId, ...teamIds];

    const [totalLeads, totalVisits, totalMissed, totalRegistrations] =
      await Promise.all([
        Lead.countDocuments({
          $or: [
            { assignedManager: asmId },
            { assignedUser: { $in: teamIds } },
            { createdBy: { $in: allUserIds } },
          ],
          isDeleted: false,
        }),

        Lead.countDocuments({
          $or: [
            { assignedManager: asmId },
            { assignedUser: { $in: teamIds } },
            { createdBy: { $in: allUserIds } },
          ],
          status: "Visit",
          isDeleted: false,
        }),

        Lead.countDocuments({
          $or: [
            { assignedManager: asmId },
            { assignedUser: { $in: teamIds } },
            { createdBy: { $in: allUserIds } },
          ],
          status: "Missed Leads",
          isDeleted: false,
        }),

        Lead.countDocuments({
          $or: [
            { assignedManager: asmId },
            { assignedUser: { $in: teamIds } },
            { createdBy: { $in: allUserIds } },
          ],
          status: "Registration",
          isDeleted: false,
        }),
      ]);

    return {
      totalLeads,
      totalVisits,
      totalMissed,
      totalRegistrations,
    };
  } catch (err) {
    console.error("getTeamSummaryStatistics Error:", err);
    return {};
  }
};

export const getTeamPerformanceMetrics = async (teamIds) => {
  try {
    const performance = await Lead.aggregate([
      {
        $match: {
          assignedUser: { $in: teamIds },
          isDeleted: false,
        },
      },
      {
        $group: {
          _id: "$assignedUser",
          visits: { $sum: { $cond: [{ $eq: ["$status", "Visit"] }, 1, 0] } },
          registrations: {
            $sum: { $cond: [{ $eq: ["$status", "Registration"] }, 1, 0] },
          },
          missed: {
            $sum: { $cond: [{ $eq: ["$status", "Missed Leads"] }, 1, 0] },
          },
          totalLeads: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: "$user" },
      {
        $project: {
          userId: "$user._id",
          name: { $concat: ["$user.firstName", " ", "$user.lastName"] },
          visits: 1,
          registrations: 1,
          missed: 1,
          totalLeads: 1,
          conversionRate: {
            $cond: [
              { $eq: ["$totalLeads", 0] },
              0,
              {
                $multiply: [
                  { $divide: ["$registrations", "$totalLeads"] },
                  100,
                ],
              },
            ],
          },
        },
      },
    ]);

    return performance;
  } catch (err) {
    console.error("getTeamPerformanceMetrics Error:", err);
    return [];
  }
};

export const getPersonalSummaryStatistics = async (userId) => {
  try {
    const [totalLeads, totalVisits, totalMissed, totalRegistrations] =
      await Promise.all([
        Lead.countDocuments({
          $or: [{ assignedUser: userId }, { createdBy: userId }],
          isDeleted: false,
        }),

        Lead.countDocuments({
          $or: [{ assignedUser: userId }, { createdBy: userId }],
          status: "Visit",
          isDeleted: false,
        }),

        Lead.countDocuments({
          $or: [{ assignedUser: userId }, { createdBy: userId }],
          status: "Missed Leads",
          isDeleted: false,
        }),

        Lead.countDocuments({
          $or: [{ assignedUser: userId }, { createdBy: userId }],
          status: "Registration",
          isDeleted: false,
        }),
      ]);

    return {
      totalLeads,
      totalVisits,
      totalMissed,
      totalRegistrations,
    };
  } catch (err) {
    console.error("getPersonalSummaryStatistics Error:", err);
    return {};
  }
};

export const getPersonalPerformance = async (userId) => {
  try {
    const performance = await Lead.aggregate([
      {
        $match: {
          $or: [{ assignedUser: userId }, { createdBy: userId }],
          isDeleted: false,
        },
      },
      {
        $group: {
          _id: {
            day: { $dayOfMonth: "$createdAt" },
            month: { $month: "$createdAt" },
            year: { $year: "$createdAt" },
          },
          visits: { $sum: { $cond: [{ $eq: ["$status", "Visit"] }, 1, 0] } },
          registrations: {
            $sum: {
              $cond: [{ $eq: ["$status", "Registration"] }, 1, 0],
            },
          },
          missed: {
            $sum: {
              $cond: [{ $eq: ["$status", "Missed Leads"] }, 1, 0],
            },
          },
          totalLeads: { $sum: 1 },
        },
      },
      {
        $project: {
          date: {
            $concat: [
              { $toString: "$_id.day" },
              "-",
              { $toString: "$_id.month" },
              "-",
              { $toString: "$_id.year" },
            ],
          },
          visits: 1,
          registrations: 1,
          missed: 1,
          totalLeads: 1,
          conversionRate: {
            $cond: [
              { $eq: ["$totalLeads", 0] },
              0,
              {
                $multiply: [
                  { $divide: ["$registrations", "$totalLeads"] },
                  100,
                ],
              },
            ],
          },
        },
      },
      { $sort: { date: 1 } },
    ]);

    return performance;
  } catch (err) {
    console.error("getPersonalPerformance Error:", err);
    return [];
  }
};
