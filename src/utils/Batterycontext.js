import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { createUser, logBattery, getBatteryHistory, getLatestBattery } from '../api';

const BatteryContext = createContext();

export const BatteryProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [currentBattery, setCurrentBattery] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [livePercentage, setLivePercentage] = useState(null);
  const [isCharging, setIsCharging] = useState(false);

  // Read actual device battery
  const readDeviceBattery = useCallback(async () => {
    if ('getBattery' in navigator) {
      const battery = await navigator.getBattery();
      setLivePercentage(Math.round(battery.level * 100));
      setIsCharging(battery.charging);

      battery.addEventListener('levelchange', () => {
        setLivePercentage(Math.round(battery.level * 100));
      });
      battery.addEventListener('chargingchange', () => {
        setIsCharging(battery.charging);
      });
    }
  }, []);

  useEffect(() => {
    readDeviceBattery();
    const stored = localStorage.getItem('bt_user');
    if (stored) setUser(JSON.parse(stored));
  }, [readDeviceBattery]);

  const loginUser = async (name, email) => {
    setLoading(true);
    try {
      const res = await createUser({ name, email });
      const u = res.data.data;
      setUser(u);
      localStorage.setItem('bt_user', JSON.stringify(u));
      await fetchHistory(u._id);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const saveBatteryLog = async () => {
    if (!user || livePercentage === null) return;
    try {
      const res = await logBattery({
        userId: user._id,
        percentage: livePercentage,
        isCharging,
        deviceInfo: navigator.userAgent.split(')')[0].split('(')[1] || 'Browser'
      });
      setCurrentBattery(res.data.data);
      await fetchHistory(user._id);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchHistory = async (userId) => {
    try {
      const res = await getBatteryHistory(userId, 30);
      setHistory(res.data.data.reverse());
    } catch (err) {
      console.error(err);
    }
  };

  const logout = () => {
    setUser(null);
    setHistory([]);
    localStorage.removeItem('bt_user');
  };

  return (
    <BatteryContext.Provider value={{
      user, currentBattery, history, loading,
      livePercentage, isCharging,
      loginUser, saveBatteryLog, fetchHistory, logout
    }}>
      {children}
    </BatteryContext.Provider>
  );
};

export const useBattery = () => useContext(BatteryContext);