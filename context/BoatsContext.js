// context/BoatsContext.js
import React, { createContext, useContext, useState } from "react";
import { boats as initialBoats } from "../data/boats";

const BoatsContext = createContext(null);

export function BoatsProvider({ children }) {
  const [boats, setBoats] = useState(initialBoats || []);

  const getBoatById = (id) =>
    boats.find((b) => b.id === id) || null;

  /**
   * Add a new boat created from a chat-driven flow.
   * Keeps defaults safe and simple so we don't break any existing UI.
   */
  const addBoatFromChat = (partialBoat) => {
    setBoats((prev) => {
      const fallbackTemplate = prev[0] || initialBoats?.[0] || {};

      const newBoat = {
        id:
          partialBoat.id ||
          `boat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: "boat",

        // Core identity
        name: partialBoat.name || "New boat",
        role: partialBoat.role || "Boat",

        // Status & health
        status: partialBoat.status || "Unknown",
        statusLevel: partialBoat.statusLevel || "ok",
        nextService: partialBoat.nextService || null,
        lastService: partialBoat.lastService || null,
        usage: partialBoat.usage || "",

        // Story / notes
        notes:
          partialBoat.notes ||
          "Boat added via chat. You can refine this story later.",
        location: partialBoat.location || fallbackTemplate.location || "",

        // Keepr Tag (optional)
        tagStatus: partialBoat.tagStatus || fallbackTemplate.tagStatus || null,
        tagBattery:
          partialBoat.tagBattery !== undefined
            ? partialBoat.tagBattery
            : fallbackTemplate.tagBattery ?? null,

        // Hero image + gallery – reuse template images if none provided
        image: partialBoat.image || fallbackTemplate.image || null,
        photos:
          partialBoat.photos && partialBoat.photos.length > 0
            ? partialBoat.photos
            : fallbackTemplate.photos || [],

        // Don’t auto-mark as primary
        isPrimary: false,

        // Service history
        serviceHistory: partialBoat.serviceHistory || [],
      };

      return [...prev, newBoat];
    });
  };

  return (
    <BoatsContext.Provider
      value={{ boats, setBoats, getBoatById, addBoatFromChat }}
    >
      {children}
    </BoatsContext.Provider>
  );
}

export function useBoats() {
  const ctx = useContext(BoatsContext);
  if (!ctx) {
    throw new Error("useBoats must be used within a BoatsProvider");
  }
  return ctx;
}

