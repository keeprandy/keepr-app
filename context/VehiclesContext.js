// context/VehiclesContext.js
import React, { createContext, useContext, useState } from "react";
// ✅ This must match the export name in data/vehicles.js
import { VEHICLES as INITIAL_VEHICLES } from "../data/vehicles";

const VehiclesContext = createContext(null);

export function VehiclesProvider({ children }) {
  // Seed from data/vehicles.js so Garage has demo data
  const [vehicles, setVehicles] = useState(INITIAL_VEHICLES || []);

  const getVehicleById = (id) =>
    vehicles.find((v) => v.id === id) || null;

  /**
   * Log completion of a maintain task (or a one-off service),
   * and update serviceHistory + maintainTasks for that vehicle.
   */
  const logMaintainCompletion = (
    vehicleId,
    {
      taskId = null,
      type = "service", // "pro" | "diy" | "service"
      date,             // string like "2025-11-23"
      titleOverride,
      provider,
      cost,
      notes,
    }
  ) => {
    setVehicles((prev) =>
      prev.map((v) => {
        if (v.id !== vehicleId) return v;

        const existingHistory = v.serviceHistory || [];
        const existingTasks = v.maintainTasks || [];

        // Find task (if any)
        const task = taskId
          ? existingTasks.find((t) => t.id === taskId)
          : null;

        const entryTitle = titleOverride || task?.label || "Service";

        // Build new service history entry for the timeline
        const newEntry = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          date,
          type,
          title: entryTitle,
          provider: provider || "",
          cost: cost || "",
          notes: notes || "",
        };

        // Update tasks if we have a taskId
        const updatedTasks = task
          ? existingTasks.map((t) =>
              t.id === taskId
                ? {
                    ...t,
                    status: "completed",
                    lastCompletedOn: date,
                    lastNotes: notes || t.lastNotes || null,
                  }
                : t
            )
          : existingTasks;

        return {
          ...v,
          maintainTasks: updatedTasks,
          serviceHistory: [newEntry, ...existingHistory],
        };
      })
    );
  };

  const value = {
    vehicles,
    setVehicles,
    getVehicleById,
    logMaintainCompletion,
  };

  return (
    <VehiclesContext.Provider value={value}>
      {children}
    </VehiclesContext.Provider>
  );
}

export function useVehicles() {
  const ctx = useContext(VehiclesContext);
  if (!ctx) {
    throw new Error("useVehicles must be used within a VehiclesProvider");
  }
  return ctx;
}
