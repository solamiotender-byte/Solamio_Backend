// utils/generateFullUrl.js
export const generateFullUrl = (filename) => {
  if (!filename) return null;

  // Remove leading slash if present
  const cleanFilename = filename.startsWith("/")
    ? filename.slice(1)
    : filename;

  const fallbackBaseUrl =
    process.env.NODE_ENV === "production"
      ? "http://localhost:9001"
      : "http://localhost:9001";

  const baseUrl =
    process.env.BASE_URL?.replace(/\/$/, "") ||
    fallbackBaseUrl;

  return `${baseUrl}/public/${cleanFilename}`;
};
