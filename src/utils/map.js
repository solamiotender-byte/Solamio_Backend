import axios from "axios";
import { AppError } from "../errors/customError.js";

class MapService {
  constructor() {
    this.googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;
    this.baseUrl = "https://maps.googleapis.com/maps/api";
  }

  // Geocode address to get coordinates
  async geocodeAddress(address) {
    try {
      const response = await axios.get(`${this.baseUrl}/geocode/json`, {
        params: {
          address,
          key: this.googleMapsApiKey
        }
      });

      if (response.data.status === "OK" && response.data.results.length > 0) {
        const result = response.data.results[0];
        return {
          lat: result.geometry.location.lat,
          lng: result.geometry.location.lng,
          address: result.formatted_address,
          placeId: result.place_id
        };
      }
      throw new AppError("Location not found", 404);
    } catch (error) {
      throw new AppError("Failed to geocode address", 500);
    }
  }

  // Reverse geocode coordinates to get address
  async reverseGeocode(lat, lng) {
    try {
      const response = await axios.get(`${this.baseUrl}/geocode/json`, {
        params: {
          latlng: `${lat},${lng}`,
          key: this.googleMapsApiKey
        }
      });

      if (response.data.status === "OK" && response.data.results.length > 0) {
        const result = response.data.results[0];
        return {
          locationName: result.formatted_address,
          address: result.formatted_address,
          placeId: result.place_id
        };
      }
      return {
        locationName: `${lat}, ${lng}`,
        address: null,
        placeId: null
      };
    } catch (error) {
      return {
        locationName: `${lat}, ${lng}`,
        address: null,
        placeId: null
      };
    }
  }

  // Calculate distance between two coordinates
  calculateDistance(lat1, lon1, lat2, lon2) {
    const toRad = (v) => (v * Math.PI) / 180;
    const R = 6371; // Earth's radius in km

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) ** 2;

    return Number((R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))).toFixed(2));
  }

  // Get route polyline between two points
  async getRoutePolyline(origin, destination) {
    try {
      const response = await axios.get(`${this.baseUrl}/directions/json`, {
        params: {
          origin: `${origin.lat},${origin.lng}`,
          destination: `${destination.lat},${destination.lng}`,
          key: this.googleMapsApiKey
        }
      });

      if (response.data.status === "OK" && response.data.routes.length > 0) {
        return response.data.routes[0].overview_polyline.points;
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  // Get place autocomplete suggestions
  async getPlaceAutocomplete(input, sessionToken) {
    try {
      const response = await axios.get(`${this.baseUrl}/place/autocomplete/json`, {
        params: {
          input,
          key: this.googleMapsApiKey,
          sessiontoken: sessionToken
        }
      });

      if (response.data.status === "OK" || response.data.status === "ZERO_RESULTS") {
        return response.data.predictions.map(prediction => ({
          placeId: prediction.place_id,
          description: prediction.description,
          mainText: prediction.structured_formatting.main_text,
          secondaryText: prediction.structured_formatting.secondary_text
        }));
      }
      return [];
    } catch (error) {
      return [];
    }
  }

  // Get place details by placeId
  async getPlaceDetails(placeId, sessionToken) {
    try {
      const response = await axios.get(`${this.baseUrl}/place/details/json`, {
        params: {
          place_id: placeId,
          key: this.googleMapsApiKey,
          sessiontoken: sessionToken,
          fields: "name,formatted_address,geometry,place_id"
        }
      });

      if (response.data.status === "OK") {
        const result = response.data.result;
        return {
          locationName: result.name || result.formatted_address,
          lat: result.geometry.location.lat,
          lng: result.geometry.location.lng,
          address: result.formatted_address,
          placeId: result.place_id
        };
      }
      throw new AppError("Place not found", 404);
    } catch (error) {
      throw new AppError("Failed to get place details", 500);
    }
  }
}

export default new MapService();