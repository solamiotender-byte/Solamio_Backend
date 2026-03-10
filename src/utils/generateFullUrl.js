// utils/generateFullUrl.js
export const generateFullUrl = (filename) => {
  if (!filename) return null;

  // Remove leading slash if present
  const cleanFilename = filename.startsWith("/")
    ? filename.slice(1)
    : filename;

  const baseUrl =
    process.env.BASE_URL?.replace(/\/$/, "") ||
    "https://backend.sunergytechsolar.com";

  return `${baseUrl}/public/${cleanFilename}`;
};