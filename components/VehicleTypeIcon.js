// VehicleTypeIcon.js — Silhouette-style icons using Ionicons

import React from "react";
import { Ionicons } from "@expo/vector-icons";

export default function VehicleTypeIcon({ type, size = 28, color = "#1F2937" }) {
  switch (type) {
    case "car":
      return <Ionicons name="car-sport-outline" size={size} color={color} />;

    case "sports":
      return <Ionicons name="speedometer-outline" size={size} color={color} />;

    case "moto":
      return <Ionicons name="bicycle-outline" size={size} color={color} />;

    case "boat":
      return <Ionicons name="boat-outline" size={size} color={color} />;

    default:
      return <Ionicons name="ellipse-outline" size={size} color={color} />;
  }
}
