// utils/generateFullUrl.js
export const generateFullUrl = (filename) => {
  if (!filename) return null;

  // Remove leading slash if present
  const cleanFilename = filename.startsWith("/")
    ? filename.slice(1)
    : filename;

  const fallbackBaseUrl =
    process.env.NODE_ENV === "production"
      ? "https://solar-backend-6vaa.onrender.com"
      : "https://solar-backend-6vaa.onrender.com";

  const baseUrl =
    process.env.BASE_URL?.replace(/\/$/, "") ||
    fallbackBaseUrl;

  return `${baseUrl}/public/${cleanFilename}`;
};
