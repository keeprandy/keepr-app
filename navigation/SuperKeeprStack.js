// navigation/SuperKeeprStack.js
import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ROUTES } from "./routes";

import SuperKeeprDashboardScreen from "../screens/SuperKeeprDashboardScreen";

// Add later if needed
// import SuperKeeprSettingsScreen from "../screens/SuperKeeprSettingsScreen";

const Stack = createNativeStackNavigator();

export default function SuperKeeprStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen
        name={ROUTES.SUPERKEEPR_DASHBOARD}
        component={SuperKeeprDashboardScreen}
      />
      {/* Optional later */}
      {/* <Stack.Screen name={ROUTES.SUPERKEEPR_SETTINGS} component={SuperKeeprSettingsScreen} /> */}
    </Stack.Navigator>
  );
}
