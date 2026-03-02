// navigation/ConsumerStack.js
import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ROUTES } from "./routes";

import DashboardScreen from "../screens/DashboardScreen";
// ... other screens

const Stack = createNativeStackNavigator();

export default function ConsumerStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name={ROUTES.DASHBOARD} component={DashboardScreen} />
      {/* existing routes: HomeStory, BoatStory, etc */}
    </Stack.Navigator>
  );
}
