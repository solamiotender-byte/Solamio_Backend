import { getFuelRate } from "../models/expense.model.js";

export const calculateFuelExpense = ({
  category,
  vehicleType,
  fuelType,
  kilometersTraveled,
}) => {
  if (category !== "Fuel") {
    return {
      amount: 0,
      fuelRatePerKm: 0,
      isFuelCalculated: false,
    };
  }

  if (!kilometersTraveled || kilometersTraveled <= 0) {
    throw new Error("Kilometers must be greater than 0");
  }

  const rate = getFuelRate(vehicleType, fuelType);
  if (!rate) throw new Error("Invalid fuel or vehicle type");

  return {
    fuelRatePerKm: rate,
    amount: kilometersTraveled * rate,
    isFuelCalculated: true,
  };
};