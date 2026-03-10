import moment from 'moment';

// Set current timestamp in "MM/DD/YYYY HH:mm:ss" format
export const setCurrentTimestamp = () => {
  return moment().format("MM/DD/YYYY HH:mm:ss");
};

// Set current date in compact format "MMDDYYYYHHmmss"
export const setCurrentDate = () => {
  return moment().format("MMDDYYYYHHmmss");
};

// Format only date as "MM/DD/YYYY"
export const formatDate = () => {
  return moment().format("MM/DD/YYYY");
};

// Add time to current date and return UNIX timestamp (in seconds)
export const addTimeToCurrentDate = (duration, type) => {
  return moment().add(duration, type).unix(); // same as .format("X")
};

