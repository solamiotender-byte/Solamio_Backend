// utils/emailValidator.js
export const isValidEmail = (email) => {
  if (!email) return true; // optional email allowed

  const emailRegex =
    /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

  const blockedDomains =
    /(test|example|dummy|mailinator|tempmail|10minutemail)\./i;

  return emailRegex.test(email) && !blockedDomains.test(email);
};
