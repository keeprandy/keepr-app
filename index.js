// index.js
import "react-native-gesture-handler";
import { registerRootComponent } from "expo";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import App from "./App";

function Root() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <App />
    </GestureHandlerRootView>
  );
}

// This tells Expo to use Root instead of App directly
registerRootComponent(Root);

export default Root;