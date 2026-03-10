// payment.service.js
import axios from "axios";
import crypto from "crypto";
import Subscription from "../models/subscription.model.js";

const generateXVerify = (payload, saltKey, saltIndex) => {
  const base64Payload = Buffer.from(JSON.stringify(payload)).toString("base64");
  const finalString = base64Payload + `/pg/v1/pay` + saltKey;
  const xVerify = crypto
    .createHash("sha256")
    .update(finalString)
    .digest("hex");
  return `${xVerify}###${saltIndex}`;
};

export const initiatePhonePePayment = async (req, res) => {
  const {
    amount,
    transactionId,
    merchantOrderId,
    redirectUrl,
  } = req.body;

  const payload = {
    merchantId: process.env.PHONEPE_MERCHANT_ID,
    merchantTransactionId: transactionId,
    amount: amount * 100, // Convert to paise
    merchantOrderId,
    redirectUrl,
    redirectMode: "POST",
    callbackUrl: `${process.env.BASE_URL}/api/payment/phonepe/webhook`,
    paymentInstrument: {
      type: "PAY_PAGE",
    },
  };

  const base64Payload = Buffer.from(JSON.stringify(payload)).toString("base64");
  const xVerify = generateXVerify(payload, process.env.PHONEPE_SALT_KEY, process.env.PHONEPE_SALT_INDEX);

  try {
    const response = await axios.post("https://api.phonepe.com/apis/hermes/pg/v1/pay", {
      request: base64Payload
    }, {
      headers: {
        "Content-Type": "application/json",
        "X-VERIFY": xVerify,
      }
    });

    return res.status(200).json({
      success: true,
      paymentUrl: response.data.data.instrumentResponse.redirectInfo.url,
    });
  } catch (error) {
    console.error("PhonePe Payment Error:", error.response?.data || error.message);
    return res.status(500).json({ 
      success: false, 
      error: error.response?.data?.message || error.message 
    });
  }
};

export const phonePeWebhook = async (req, res) => {
  try {
    const payload = req.body;
    console.log("PhonePe Webhook Data:", payload);

    const { transactionId, code, data } = payload;

    const updateData = {
      paymentStatus: code === "PAYMENT_SUCCESS" ? "paid" : "failed",
      subscriptionStatus: code === "PAYMENT_SUCCESS" ? "active" : "failed",
      updatedAt: new Date(),
      response: payload
    };

    await Subscription.findOneAndUpdate(
      { transactionId },
      updateData
    );

    return res.status(200).send("OK");
  } catch (err) {
    console.error("Webhook Error:", err);
    return res.status(500).send("FAIL");
  }
};

export const verifyPhonePeTransaction = async (req, res) => {
  const { transactionId } = req.params;

  const path = `/pg/v1/status/${process.env.PHONEPE_MERCHANT_ID}/${transactionId}`;
  const finalString = path + process.env.PHONEPE_SALT_KEY;

  const xVerify = crypto.createHash("sha256").update(finalString).digest("hex") + `###${process.env.PHONEPE_SALT_INDEX}`;

  try {
    const response = await axios.get(`https://api.phonepe.com/apis/hermes${path}`, {
      headers: { 
        "X-VERIFY": xVerify, 
        "X-MERCHANT-ID": process.env.PHONEPE_MERCHANT_ID 
      },
    });

    return res.status(200).json(response.data);
  } catch (error) {
    console.error("Verification Error:", error.response?.data || error.message);
    return res.status(500).json({ 
      error: error.response?.data?.message || error.message 
    });
  }
};