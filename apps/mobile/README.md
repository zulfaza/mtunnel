# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Push notifications

Push notifications use native APNs and FCM device tokens and do not require EAS. Push notifications require a native development or production build.

For iOS, create an APNs signing key in the Apple Developer portal and configure `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, and `APNS_BUNDLE_ID` in the API. Development builds use the APNs sandbox automatically.

For Android, configure Firebase in the native app and set `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, and `FCM_PRIVATE_KEY` from a Firebase service account in the API.

After login, pass the WorkOS access token to `registerDeviceForPushNotifications(accessToken)`. Call `unregisterDeviceFromPushNotifications(accessToken)` before discarding the access token during logout.

Set `EXPO_PUBLIC_API_URL` when the app should use an API other than `https://api.makarima.xyz`.

The API's `POST /api/v1/notifications` endpoint is server-to-server and requires `NOTIFICATION_API_KEY`:

```bash
curl https://api.makarima.xyz/api/v1/notifications \
  --header "Authorization: Bearer $NOTIFICATION_API_KEY" \
  --header "Content-Type: application/json" \
  --data '{
    "deviceId": "DEVICE_ID_RETURNED_DURING_REGISTRATION",
    "title": "Tunnel connected",
    "body": "Your tunnel is ready.",
    "data": { "tunnelId": "example" }
  }'
```

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

### Other setup steps

- To set up ESLint for linting, run `npx expo lint`, or follow our guide on ["Using ESLint and Prettier"](https://docs.expo.dev/guides/using-eslint/)
- If you'd like to set up unit testing, follow our guide on ["Unit Testing with Jest"](https://docs.expo.dev/develop/unit-testing/)
- Learn more about the TypeScript setup in this template in our guide on ["Using TypeScript"](https://docs.expo.dev/guides/typescript/)

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
