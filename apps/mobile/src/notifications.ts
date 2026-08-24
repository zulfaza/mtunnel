import { Platform } from "react-native";

const deviceIdKey = "notification-device-id";
const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "https://api.makarima.xyz";

async function loadNativeNotificationModules() {
  try {
    const [Crypto, Notifications, SecureStore] = await Promise.all([
      import("expo-crypto"),
      import("expo-notifications"),
      import("expo-secure-store"),
    ]);
    return { Crypto, Notifications, SecureStore };
  } catch (error) {
    throw new Error(
      "Push notification native modules are unavailable. Rebuild and reinstall the development client.",
      { cause: error },
    );
  }
}

async function notificationDeviceId(): Promise<string> {
  const { Crypto, SecureStore } = await loadNativeNotificationModules();
  const existingDeviceId = await SecureStore.getItemAsync(deviceIdKey);
  if (existingDeviceId !== null) return existingDeviceId;

  const deviceId = Crypto.randomUUID();
  await SecureStore.setItemAsync(deviceIdKey, deviceId);
  return deviceId;
}

async function configuredNotifications() {
  const { Notifications } = await loadNativeNotificationModules();
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  return Notifications;
}

async function devicePushToken(Notifications: Awaited<ReturnType<typeof configuredNotifications>>) {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Default",
      importance: Notifications.AndroidImportance.MAX,
    });
  }

  const existingPermission = await Notifications.getPermissionsAsync();
  const permission =
    existingPermission.status === "granted"
      ? existingPermission
      : await Notifications.requestPermissionsAsync();
  if (permission.status !== "granted") throw new Error("Notification permission was not granted");

  return Notifications.getDevicePushTokenAsync();
}

export async function configureForegroundNotificationHandling(): Promise<void> {
  await configuredNotifications();
}

export async function registerDeviceForPushNotifications(accessToken: string): Promise<string> {
  if (Platform.OS === "web") throw new Error("Push notifications require a native app");
  const Notifications = await configuredNotifications();

  const [deviceId, pushToken] = await Promise.all([
    notificationDeviceId(),
    devicePushToken(Notifications),
  ]);
  const response = await fetch(`${apiUrl}/api/v1/devices/${deviceId}/push-token`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      pushToken: pushToken.data,
      platform: Platform.OS,
      environment: __DEV__ ? "development" : "production",
    }),
  });
  if (!response.ok) throw new Error(`Device registration failed with status ${response.status}`);

  return deviceId;
}

export async function sendDevelopmentNotification(): Promise<void> {
  if (!__DEV__) throw new Error("Test notifications are only available in development");
  if (Platform.OS === "web") throw new Error("Push notifications require a native app");
  const Notifications = await configuredNotifications();
  await devicePushToken(Notifications);
  await Notifications.scheduleNotificationAsync({
    content: {
      title: "mtunnel test",
      body: "Local notifications are working.",
      sound: "default",
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 1,
    },
  });
}

export async function unregisterDeviceFromPushNotifications(accessToken: string): Promise<void> {
  const { SecureStore } = await loadNativeNotificationModules();
  const deviceId = await SecureStore.getItemAsync(deviceIdKey);
  if (deviceId === null) return;

  const response = await fetch(`${apiUrl}/api/v1/devices/${deviceId}/push-token`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok && response.status !== 404)
    throw new Error(`Device unregistration failed with status ${response.status}`);
}
