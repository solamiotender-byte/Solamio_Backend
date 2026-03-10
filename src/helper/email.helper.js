import nodemailer from "nodemailer";


console.log("data...", process.env.EMAIL_USERNAME)
export const sendEmail = async (to, subject, html) => {

  const transporter = nodemailer.createTransport({
    host: 'smtp.mailer91.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USERNAME,
      pass: process.env.EMAIL_PASSWORD,
    },
  });

  const mailOptions = {
    from: process.env.EMAIL_FROM,
    to,
    subject,
    html,
  };

  return transporter.sendMail(mailOptions);
};
