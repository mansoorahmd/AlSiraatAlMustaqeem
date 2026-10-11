import { Alert, Platform, ToastAndroid } from "react-native";

/** Lightweight transient message. Native toast on Android; a soft alert elsewhere. */
export function toast(message: string): void {
  if (Platform.OS === "android") ToastAndroid.show(message, ToastAndroid.SHORT);
  else Alert.alert(message);
}
