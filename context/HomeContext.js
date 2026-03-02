// context/HomeContext.js
import React, { createContext, useContext, useState } from "react";

const HomeContext = createContext(null);

export function HomeProvider({ children }) {
  // Supabase-backed homes will be synced into this later (starts empty)
  const [homes, setHomes] = useState([]);

  // No hard-coded default like "home-primary" – will be set from Supabase UUIDs
  const [currentHomeId, setCurrentHomeId] = useState(null);

  const currentHome =
    homes.find((home) => home.id === currentHomeId) || null;

  const value = {
    homes,
    setHomes,
    currentHomeId,
    setCurrentHomeId,
    currentHome,
  };

  return (
    <HomeContext.Provider value={value}>
      {children}
    </HomeContext.Provider>
  );
}

export function useHome() {
  const ctx = useContext(HomeContext);
  if (!ctx) {
    throw new Error("useHome must be used within a HomeProvider");
  }
  return ctx;
}
