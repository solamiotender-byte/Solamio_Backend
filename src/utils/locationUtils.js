// utils/locationUtils.js
import axios from 'axios';

/**
 * Calculate distance between two coordinates in kilometers using Haversine formula
 */
export const calculateDistanceKm = (lat1, lon1, lat2, lon2) => {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371; // Earth radius in km
  
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  
  const a = 
    Math.sin(dLat / 2) ** 2 + 
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * 
    Math.sin(dLon / 2) ** 2;
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  
  return Number(distance.toFixed(2));
};

/**
 * Calculate bounding box around a point for geospatial queries
 */
export const calculateBoundingBox = (lat, lng, radiusKm = 5) => {
  const earthRadius = 6371;
  const angularDistance = radiusKm / earthRadius;
  const latRad = (lat * Math.PI) / 180;
  
  const minLat = lat - (angularDistance * 180) / Math.PI;
  const maxLat = lat + (angularDistance * 180) / Math.PI;
  const minLng = lng - (angularDistance * 180) / Math.PI / Math.cos(latRad);
  const maxLng = lng + (angularDistance * 180) / Math.PI / Math.cos(latRad);
  
  return {
    minLat: Number(minLat.toFixed(6)),
    maxLat: Number(maxLat.toFixed(6)),
    minLng: Number(minLng.toFixed(6)),
    maxLng: Number(maxLng.toFixed(6))
  };
};

/**
 * Get address from coordinates using Google Maps Geocoding API with retry logic
 */
export const getAddressFromCoords = async (lat, lng, retries = 2) => {
  // Fallback coordinate string
  const fallbackAddress = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  
  // Check if API key is available
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    console.warn('Google Maps API key not found');
    return fallbackAddress;
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(
        'https://maps.googleapis.com/maps/api/geocode/json',
        {
          params: {
            latlng: `${lat},${lng}`,
            key: process.env.GOOGLE_MAPS_API_KEY,
            language: 'en'
          },
          timeout: 5000 // 5 second timeout
        }
      );
      
      if (response.data.status === 'OK' && response.data.results?.length > 0) {
        return response.data.results[0].formatted_address;
      } else if (response.data.status === 'OVER_QUERY_LIMIT') {
        console.warn('Geocoding API quota exceeded');
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1))); // Exponential backoff
        continue;
      }
      
      return fallbackAddress;
    } catch (error) {
      console.error(`Geocoding error (attempt ${attempt + 1}):`, error.message);
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }
  
  return fallbackAddress;
};

/**
 * Get travel distance and time using Google Distance Matrix API with retry logic
 */
export const getTravelInfo = async (originLat, originLng, destLat, destLng, retries = 2) => {
  // Calculate straight-line distance as fallback
  const distanceKm = calculateDistanceKm(originLat, originLng, destLat, destLng);
  const avgSpeedKmph = 40; // Average driving speed
  const estimatedTimeMin = Math.round((distanceKm / avgSpeedKmph) * 60);
  
  const fallbackResponse = {
    distanceKm,
    distanceText: `${distanceKm.toFixed(1)} km`,
    durationMinutes: estimatedTimeMin,
    durationText: `${estimatedTimeMin} mins`,
    isEstimated: true
  };
  
  // Return fallback if no API key
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    return fallbackResponse;
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(
        'https://maps.googleapis.com/maps/api/distancematrix/json',
        {
          params: {
            origins: `${originLat},${originLng}`,
            destinations: `${destLat},${destLng}`,
            key: process.env.GOOGLE_MAPS_API_KEY,
            mode: 'driving',
            units: 'metric',
            traffic_model: 'best_guess',
            departure_time: 'now'
          },
          timeout: 5000
        }
      );

      if (response.data.status === 'OK' && 
          response.data.rows[0]?.elements[0]?.status === 'OK') {
        
        const element = response.data.rows[0].elements[0];
        
        return {
          distanceKm: element.distance.value / 1000, // Convert meters to km
          distanceText: element.distance.text,
          durationMinutes: Math.round(element.duration.value / 60),
          durationText: element.duration.text,
          durationSeconds: element.duration.value,
          isEstimated: false
        };
      } else if (response.data.status === 'OVER_QUERY_LIMIT') {
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        continue;
      }
      
      return fallbackResponse;
      
    } catch (error) {
      console.error(`Distance Matrix error (attempt ${attempt + 1}):`, error.message);
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }
  
  return fallbackResponse;
};

/**
 * Get route between two points using Google Directions API
 */
export const getRouteBetweenPoints = async (originLat, originLng, destLat, destLng, retries = 2) => {
  // Calculate straight-line as fallback
  const distance = calculateDistanceKm(originLat, originLng, destLat, destLng);
  const avgSpeedKmph = 40;
  const duration = (distance / avgSpeedKmph) * 60;
  
  const fallbackRoute = {
    distance,
    duration,
    durationText: `${Math.round(duration)} mins`,
    distanceText: `${distance.toFixed(1)} km`,
    path: [
      { lat: originLat, lng: originLng },
      { lat: destLat, lng: destLng }
    ],
    isEstimated: true
  };

  // Return fallback if no API key
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    return fallbackRoute;
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(
        'https://maps.googleapis.com/maps/api/directions/json',
        {
          params: {
            origin: `${originLat},${originLng}`,
            destination: `${destLat},${destLng}`,
            key: process.env.GOOGLE_MAPS_API_KEY,
            mode: 'driving',
            alternatives: false,
            traffic_model: 'best_guess',
            departure_time: 'now'
          },
          timeout: 5000
        }
      );

      if (response.data.status === 'OK' && response.data.routes?.length > 0) {
        const route = response.data.routes[0];
        const leg = route.legs[0];
        
        // Decode polyline if available
        let path = [];
        if (route.overview_polyline?.points) {
          path = decodePolyline(route.overview_polyline.points);
        } else {
          path = [
            { lat: originLat, lng: originLng },
            { lat: destLat, lng: destLng }
          ];
        }
        
        return {
          distance: leg.distance.value / 1000, // km
          duration: leg.duration.value / 60, // minutes
          durationText: leg.duration.text,
          distanceText: leg.distance.text,
          polyline: route.overview_polyline?.points || null,
          path,
          startAddress: leg.start_address,
          endAddress: leg.end_address,
          isEstimated: false
        };
      } else if (response.data.status === 'OVER_QUERY_LIMIT') {
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        continue;
      }
      
      return fallbackRoute;
      
    } catch (error) {
      console.error(`Directions API error (attempt ${attempt + 1}):`, error.message);
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }
  
  return fallbackRoute;
};

/**
 * Decode Google Maps polyline
 */
const decodePolyline = (encoded) => {
  const points = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  
  while (index < encoded.length) {
    let b;
    let shift = 0;
    let result = 0;
    
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    
    const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += dlat;
    
    shift = 0;
    result = 0;
    
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    
    const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += dlng;
    
    points.push({
      lat: lat / 1e5,
      lng: lng / 1e5
    });
  }
  
  return points;
};

/**
 * Check if a point is within a geofence with buffer
 */
export const isWithinGeofence = (centerLat, centerLng, pointLat, pointLng, radiusMeters = 100, bufferMeters = 10) => {
  const distance = calculateDistanceKm(centerLat, centerLng, pointLat, pointLng) * 1000;
  return distance <= (radiusMeters + bufferMeters);
};

/**
 * Calculate estimated travel time based on distance and mode
 */
export const estimateTravelTime = (distanceKm, mode = 'driving') => {
  const speeds = {
    walking: 5,
    bicycling: 15,
    driving: 40,
    transit: 30
  };
  
  const speedKmph = speeds[mode] || speeds.driving;
  const hours = distanceKm / speedKmph;
  const minutes = hours * 60;
  
  return {
    minutes: Math.round(minutes),
    hours: Math.round(hours * 10) / 10,
    text: minutes >= 60 
      ? `${Math.floor(hours)} hr ${Math.round((hours % 1) * 60)} min` 
      : `${Math.round(minutes)} min`
  };
};

/**
 * Get high accuracy location with multiple attempts
 */
export const getHighAccuracyLocation = (timeout = 15000, maximumAge = 0, enableHighAccuracy = true) => {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'));
      return;
    }

    const options = {
      enableHighAccuracy,
      timeout,
      maximumAge
    };

    // Try multiple times to get accurate location
    let attempts = 0;
    const maxAttempts = 3;
    let bestLocation = null;

    const tryGetLocation = () => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          // If this is the first successful attempt or accuracy is better than previous
          if (!bestLocation || position.coords.accuracy < bestLocation.coords.accuracy) {
            bestLocation = position;
          }

          // If accuracy is good enough (< 50m) or we've tried enough times, resolve
          if (position.coords.accuracy <= 50 || attempts >= maxAttempts - 1) {
            resolve(bestLocation);
          } else {
            attempts++;
            setTimeout(tryGetLocation, 1000); // Try again after 1 second
          }
        },
        (error) => {
          if (attempts >= maxAttempts - 1) {
            reject(error);
          } else {
            attempts++;
            setTimeout(tryGetLocation, 1000);
          }
        },
        options
      );
    };

    tryGetLocation();
  });
};

/**
 * Calculate accuracy score (0-100) based on accuracy in meters
 */
export const calculateAccuracyScore = (accuracyInMeters) => {
  if (accuracyInMeters <= 10) return 100; // Excellent
  if (accuracyInMeters <= 20) return 90;  // Very good
  if (accuracyInMeters <= 30) return 80;  // Good
  if (accuracyInMeters <= 50) return 70;  // Fair
  if (accuracyInMeters <= 100) return 50; // Poor
  return 30; // Very poor
};

/**
 * Get accuracy description based on meters
 */
export const getAccuracyDescription = (accuracyInMeters) => {
  if (accuracyInMeters <= 10) return 'Excellent';
  if (accuracyInMeters <= 20) return 'Very good';
  if (accuracyInMeters <= 30) return 'Good';
  if (accuracyInMeters <= 50) return 'Fair';
  if (accuracyInMeters <= 100) return 'Poor';
  return 'Very poor';
};

/**
 * Validate if coordinates are within India bounds (optional)
 */
export const isWithinIndia = (lat, lng) => {
  // India approximate bounds
  const indiaBounds = {
    minLat: 6.0,
    maxLat: 37.0,
    minLng: 68.0,
    maxLng: 97.0
  };
  
  return (
    lat >= indiaBounds.minLat &&
    lat <= indiaBounds.maxLat &&
    lng >= indiaBounds.minLng &&
    lng <= indiaBounds.maxLng
  );
};