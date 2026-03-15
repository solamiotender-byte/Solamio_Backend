// utils/locationUtils.js
// ✅ BACKEND ONLY — no browser APIs (navigator, window, document) here

import axios from "axios";

/**
 * Calculate distance between two coordinates in km (Haversine formula)
 */
export const calculateDistanceKm = (lat1, lon1, lat2, lon2) => {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(2));
};

/**
 * Calculate bounding box around a point for geospatial queries
 */
export const calculateBoundingBox = (lat, lng, radiusKm = 5) => {
  const earthRadius = 6371;
  const angularDistance = radiusKm / earthRadius;
  const latRad = (lat * Math.PI) / 180;
  return {
    minLat: Number((lat - (angularDistance * 180) / Math.PI).toFixed(6)),
    maxLat: Number((lat + (angularDistance * 180) / Math.PI).toFixed(6)),
    minLng: Number((lng - (angularDistance * 180) / Math.PI / Math.cos(latRad)).toFixed(6)),
    maxLng: Number((lng + (angularDistance * 180) / Math.PI / Math.cos(latRad)).toFixed(6)),
  };
};

/**
 * Get address from coordinates using Google Maps Geocoding API with retry logic
 */
export const getAddressFromCoords = async (lat, lng, retries = 2) => {
  const fallbackAddress = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;

  if (!process.env.GOOGLE_MAPS_API_KEY) {
    console.warn("Google Maps API key not found");
    return fallbackAddress;
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(
        "https://maps.googleapis.com/maps/api/geocode/json",
        {
          params: { latlng: `${lat},${lng}`, key: process.env.GOOGLE_MAPS_API_KEY, language: "en" },
          timeout: 5000,
        }
      );
      if (response.data.status === "OK" && response.data.results?.length > 0) {
        return response.data.results[0].formatted_address;
      } else if (response.data.status === "OVER_QUERY_LIMIT") {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      return fallbackAddress;
    } catch (error) {
      console.error(`Geocoding error (attempt ${attempt + 1}):`, error.message);
      if (attempt < retries) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  return fallbackAddress;
};

/**
 * Get travel distance and time using Google Distance Matrix API with retry logic
 */
export const getTravelInfo = async (originLat, originLng, destLat, destLng, retries = 2) => {
  const distanceKm = calculateDistanceKm(originLat, originLng, destLat, destLng);
  const avgSpeedKmph = 40;
  const estimatedTimeMin = Math.round((distanceKm / avgSpeedKmph) * 60);
  const fallbackResponse = {
    distanceKm,
    distanceText: `${distanceKm.toFixed(1)} km`,
    durationMinutes: estimatedTimeMin,
    durationText: `${estimatedTimeMin} mins`,
    isEstimated: true,
  };

  if (!process.env.GOOGLE_MAPS_API_KEY) return fallbackResponse;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(
        "https://maps.googleapis.com/maps/api/distancematrix/json",
        {
          params: {
            origins: `${originLat},${originLng}`,
            destinations: `${destLat},${destLng}`,
            key: process.env.GOOGLE_MAPS_API_KEY,
            mode: "driving",
            units: "metric",
            traffic_model: "best_guess",
            departure_time: "now",
          },
          timeout: 5000,
        }
      );
      if (
        response.data.status === "OK" &&
        response.data.rows[0]?.elements[0]?.status === "OK"
      ) {
        const element = response.data.rows[0].elements[0];
        return {
          distanceKm: element.distance.value / 1000,
          distanceText: element.distance.text,
          durationMinutes: Math.round(element.duration.value / 60),
          durationText: element.duration.text,
          durationSeconds: element.duration.value,
          isEstimated: false,
        };
      } else if (response.data.status === "OVER_QUERY_LIMIT") {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      return fallbackResponse;
    } catch (error) {
      console.error(`Distance Matrix error (attempt ${attempt + 1}):`, error.message);
      if (attempt < retries) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  return fallbackResponse;
};

/**
 * Decode Google Maps polyline — backend utility for route processing
 */
export const decodePolyline = (encoded) => {
  const points = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : result >> 1;
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
};

/**
 * Check if a point is within a geofence with buffer
 */
export const isWithinGeofence = (
  centerLat, centerLng, pointLat, pointLng,
  radiusMeters = 100, bufferMeters = 10
) => {
  const distance = calculateDistanceKm(centerLat, centerLng, pointLat, pointLng) * 1000;
  return distance <= radiusMeters + bufferMeters;
};

/**
 * Calculate estimated travel time based on distance and mode
 */
export const estimateTravelTime = (distanceKm, mode = "driving") => {
  const speeds = { walking: 5, bicycling: 15, driving: 40, transit: 30 };
  const speedKmph = speeds[mode] || speeds.driving;
  const hours = distanceKm / speedKmph;
  const minutes = hours * 60;
  return {
    minutes: Math.round(minutes),
    hours: Math.round(hours * 10) / 10,
    text:
      minutes >= 60
        ? `${Math.floor(hours)} hr ${Math.round((hours % 1) * 60)} min`
        : `${Math.round(minutes)} min`,
  };
};

/**
 * Calculate accuracy score (0-100) based on accuracy in meters
 */
export const calculateAccuracyScore = (accuracyInMeters) => {
  if (accuracyInMeters <= 10)  return 100;
  if (accuracyInMeters <= 20)  return 90;
  if (accuracyInMeters <= 30)  return 80;
  if (accuracyInMeters <= 50)  return 70;
  if (accuracyInMeters <= 100) return 50;
  return 30;
};

/**
 * Get accuracy description based on meters
 */
export const getAccuracyDescription = (accuracyInMeters) => {
  if (accuracyInMeters <= 10)  return "Excellent";
  if (accuracyInMeters <= 20)  return "Very good";
  if (accuracyInMeters <= 30)  return "Good";
  if (accuracyInMeters <= 50)  return "Fair";
  if (accuracyInMeters <= 100) return "Poor";
  return "Very poor";
};

/**
 * Validate if coordinates are within India bounds
 */
export const isWithinIndia = (lat, lng) => {
  return lat >= 6.0 && lat <= 37.0 && lng >= 68.0 && lng <= 97.0;
};

// ✅ REMOVED: getHighAccuracyLocation — used navigator.geolocation (browser API).
//    This is frontend code. Move it to your frontend utils if needed.