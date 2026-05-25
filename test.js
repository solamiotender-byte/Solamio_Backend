import axios from "axios";

/* ===============================
   Haversine Distance (KM)
================================ */
export const calculateDistanceKm = (lat1, lon1, lat2, lon2) => {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371; // Earth radius in KM

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return Number(
    (R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))).toFixed(2)
  );
};

/* ===============================
   Reverse Geocoding
================================ */
export const getAddressFromCoords = async (lat, lng) => {
  try {
    const response = await axios.get(
      "https://maps.googleapis.com/maps/api/geocode/json",
      {
        params: {
          latlng: `${lat},${lng}`,
          key: "AIzaSyCqM7uF9c0ZMQjdssHqSMJJ3mBcmz5RNS0",
        },
      }
    );

    return response.data.results?.[0]?.formatted_address || "Address not found";
  } catch (error) {
    console.error("Geocoding error:", error.message);
    return "Address not available";
  }
};

/* ===============================
   Final Combined API
================================ */
export const getDistanceAndAddress = async (
  originLat,
  originLng,
  destLat,
  destLng
) => {
  const distanceKm = calculateDistanceKm(
    originLat,
    originLng,
    destLat,
    destLng
  );

  const avgSpeedKmph = 40; // estimated city speed
  const estimatedTimeMin = Math.round((distanceKm / avgSpeedKmph) * 60);

  const [originAddress, destinationAddress] = await Promise.all([
    getAddressFromCoords(originLat, originLng),
    getAddressFromCoords(destLat, destLng),
  ]);

  return {
    origin: {
      latitude: originLat,
      longitude: originLng,
      address: originAddress,
    },
    destination: {
      latitude: destLat,
      longitude: destLng,
      address: destinationAddress,
    },
    travel: {
      distanceKm,
      estimatedTime: `${estimatedTimeMin} mins`,
    },
  };
};

(async () => {
  const result = await getDistanceAndAddress(
    20.04299, 85.419555, // Bhubaneswar
    20.2727643, 85.8334598  // Khordha
  );

  //console.log(JSON.stringify(result, null, 2));
})();